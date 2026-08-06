import { App, fitBox, type Scene } from '../app';
import {
  ARENA_H,
  ARENA_W,
  BRICK_H,
  GRID_LEFT,
  GRID_TOP,
  PADDLE_H,
  PADDLE_Y,
  ENERGY_MAX,
  ROWS,
  WALL,
  brickWidthFor,
} from '../core/constants';
import { BRICK_KINDS, isBrickCode } from '../core/bricks';
import { Arena, noInput } from '../core/arena';
import type { LevelData } from '../core/level';
import type { SuperId } from '../core/supers';
import { Rng } from '../core/rng';
import { ArenaFx } from '../render/fx';
import { drawArena, drawHud, FONT } from '../render/renderer';
import { Backdrop } from '../render/backdrop';
import { SOLO_KEYS } from './input';
import { edgeOnce, FixedStepper } from './stepper';
import { button, el } from '../ui/dom';
import { mainMenu } from '../ui/menu';
import { sfx } from '../audio/sfx';
import { music } from '../audio/music';
import { DEBUFF_LIST } from '../core/debuffs';
import {
  ALLY_CARDS,
  BOSS_LIVES_BONUS,
  BOSS_TURN_SECONDS,
  CARDS,
  CELL_TYPES,
  FINALE_KNOCKBACK,
  HAND_SIZE,
  JAM_KEY,
  JAM_PER_TURN,
  SEAT_KEYS,
  SEAT_KEY_LABELS,
  STOCK_MAX,
  TEAM_COLORS,
  TEAM_LABELS,
  MIN_TURN_LIVES,
  TURN_SECONDS,
  canDiscard,
  cardAllowed,
  cardsForTurn,
  drawCardFor,
  freeTeam,
  giveCards,
  levelForCell,
  makeBoard,
  makePlayer,
  makeRoll,
  raceComments,
  resolveCell,
  rollDice,
  snapshot,
  teammates,
  type CardDef,
  type CardId,
  type RaceCell,
  type RacePlayer,
  type Roll,
  type Standings,
  type TurnAward,
  type TurnReport,
  type TurnResult,
} from '../core/race';
import { RaceNet, type RaceLogEntry } from './raceNet';
import {
  RACE_CELLS_INTERVAL,
  RACE_SNAPSHOT_INTERVAL,
  type RaceSnapshot,
} from '../net/raceProtocol';

const HUD_W = 236;
const PANEL_W = 292;
const GAP = 16;
const SCENE_W = PANEL_W + GAP + ARENA_W + GAP + HUD_W;
const SCENE_H = ARENA_H;

/** Seconds the die tumbles before it settles. Short on purpose: it is a beat,
 *  not a cutscene, and it plays every single turn. */
const ROLL_SPIN = 0.9;
/** Seconds per cell while the token walks the track. */
const STEP_TIME = 0.11;

/** Everything the networked race needs that the hot-seat one does not. Absent,
 *  the mode behaves exactly as it did on one laptop. */
export interface RaceNetOptions {
  seed: number;
  /** Seats this client plays; the rest it watches. */
  mySeats: number[];
  /** The race so far, when joining or coming back after a reload. */
  resume?: { log: RaceLogEntry[]; turn: number; index: number };
}

export interface RaceOptions {
  names: string[];
  /** Union per seat, agreed before the match; null is a lone racer. */
  teams?: (number | null)[];
  distance: number;
  net?: RaceNetOptions;
  levels: LevelData[];
  superId: SuperId;
  speed?: number;
}

type Phase = 'board' | 'play' | 'watch' | 'roll' | 'move' | 'over';

interface LogLine {
  text: string;
  color: string;
  t: number;
}

/** Hot-seat race: everyone shares one keyboard, one plays a short level against
 *  a countdown, and the rest spend cards they earned in their own turns. */
export function raceScene(app: App, opts: RaceOptions): Scene {
  const netOpts = opts.net ?? null;
  const online = netOpts !== null;
  /** Shared stream: the board and the opening hands come off this, so every
   *  client that was dealt the same seed builds exactly the same race. */
  const rng = new Rng(netOpts ? netOpts.seed >>> 0 : Date.now() >>> 0);
  /** Local stream, for anything that must NOT be shared — card draws happen on
   *  the client that earned them and travel as ids. */
  const localRng = new Rng((Date.now() ^ 0x9e3779b9) >>> 0);
  const distance = opts.distance;
  const cells = makeBoard(distance, rng);
  const players = opts.names.map((n, i) => {
    const p = makePlayer(i, n, rng);
    p.team = opts.teams?.[i] ?? null;
    return p;
  });
  const backdrop = new Backdrop();
  const stepper = new FixedStepper();
  const speed = opts.speed ?? 1;

  let phase: Phase = 'board';
  let turnSeat = 0;
  /** Turn counter, and the random stream that goes with it: cell effects draw
   *  from `turnRng`, so "Прыжок: вперёд на 6" is six on every screen. */
  let turnIndex = 0;
  /** Flipped for the rest of the match by a reverse cell. */
  let direction: 1 | -1 = 1;
  let round = 1;
  let arena: Arena | null = null;
  let fx = new ArenaFx();
  let layout = { scale: 1, ox: 0, oy: 0 };
  let t = 0;

  // Per-turn bookkeeping.
  let clock = 0;
  let clockLimit = TURN_SECONDS;
  let livesAtStart = MIN_TURN_LIVES;
  let bestCombo = 0;
  let jamCharges = 0;
  let shieldArmed = false;
  let paused = false;
  const log: LogLine[] = [];

  // Roll and move animation state.
  let rollT = 0;
  let roll: Roll | null = null;
  let rollFace = 1;
  let movePath: number[] = [];
  let moveTimer = 0;
  let moveResolved = false;
  let moveDone = false;
  let trackEl: HTMLElement | null = null;
  /** Where everyone stood before this turn — the commentator reads the table
   *  against it, so a swap or a pit is remarked on as readily as a good roll. */
  let standingsBefore: Standings = new Map();
  /** The last few lines said, kept for the board screen. */
  const feed: string[] = [];

  // Network state. All of it is inert in hot-seat.
  const mine = new Set(netOpts?.mySeats ?? []);
  /** Cards this client's active seat picked up, to be published at turn end. */
  let earned: CardId[] = [];
  /** Whether the cell that just fired flipped the turn order. */
  let turnReversed = false;
  /** Whether it handed the turn back to whoever played before this one. */
  let turnRewind = false;
  /** The active player's field as last seen by a watcher. */
  let mirror: RaceSnapshot | null = null;
  let mirrorAge = 0;
  let mirrorSeq = -1;
  let snapTimer = 0;
  let cellsTimer = 0;
  let lastCells = '';
  let lastBroken = -1;
  const netio = online
    ? new RaceNet({
        turn: (seat, index) => onTurn(seat, index),
        roll: (seat, index, die, result) => onRoll(seat, index, die, result),
        card: (from, card) => onCard(from, card),
        snapshot: (seat, snap) => onSnapshot(seat, snap),
        timeout: (seat) => onTimeout(seat),
      })
    : null;

  music.setScene('menu');
  showBoard();

  function active(): RacePlayer {
    return players[turnSeat];
  }

  /** Its own stream per turn, keyed by the shared seed. Cell effects and the
   *  die's line draw from this, so every client narrates the same turn. */
  function turnRng(): Rng {
    const seed = netOpts ? netOpts.seed : rng.seedValue;
    return new Rng((seed ^ ((turnIndex + 1) * 2654435761)) >>> 0);
  }

  /** In hot-seat every seat is played here; online only the claimed ones. */
  function isMine(seat: number): boolean {
    return !online || mine.has(seat);
  }

  function isFinale(p: RacePlayer): boolean {
    return p.cell >= distance;
  }

  function clockSecondsFor(level: LevelData): number {
    return level.boss ? BOSS_TURN_SECONDS : TURN_SECONDS;
  }

  /** What a player sits down with: their stock, never below the floor, plus a
   *  loan for a boss. */
  function livesFor(p: RacePlayer, level: LevelData): number {
    return Math.max(MIN_TURN_LIVES, p.lives) + (level.boss ? BOSS_LIVES_BONUS : 0);
  }

  function levelFor(p: RacePlayer): LevelData {
    return opts.levels[levelForCell(p.cell, distance, opts.levels.length)];
  }

  function note(text: string, color: string): void {
    log.unshift({ text, color, t: 0 });
    if (log.length > 7) log.pop();
  }

  // ------------------------------------------------------------- the track --

  /** One chip per cell. Special cells stay face down until somebody lands on
   *  one: the board is meant to be learned, not read off at the start. */
  function cellChip(cell: RaceCell): HTMLElement {
    const def = cell.kind && cell.revealed ? CELL_TYPES[cell.kind] : null;
    const here = players.filter((p) => p.cell === cell.index);
    return el(
      'div',
      {
        class: `racecell${def ? ' known' : ''}${cell.index === distance ? ' finish' : ''}`,
        style: def ? `--hole:${def.color}` : '',
        title: def ? `${def.name}: ${def.desc}` : `Клетка ${cell.index}`,
        'data-cell': String(cell.index),
      },
      el('span', { class: 'n' }, cell.index === distance ? '☠' : String(cell.index)),
      def ? el('span', { class: 'icon' }, def.icon) : null,
      here.length
        ? el('span', { class: 'tokens' }, ...here.map((p) => el('i', { style: `background:${p.accent}` })))
        : null,
    );
  }

  function buildTrack(): HTMLElement {
    trackEl = el('div', { class: 'racetrack' }, ...cells.map(cellChip));
    return trackEl;
  }

  /** Repaints one chip. The move animation touches two cells per step, so the
   *  101-cell board is never rebuilt mid-walk — that is what would stutter on a
   *  weaker laptop, and later on every spectator's screen. */
  function refreshCell(index: number): void {
    if (!trackEl) return;
    const old = trackEl.children[index] as HTMLElement | undefined;
    if (!old) return;
    trackEl.replaceChild(cellChip(cells[index]), old);
  }

  // ------------------------------------------------------------- board UI --

  function showBoard(): void {
    phase = 'board';
    const p = active();
    // Quarantine is served here, at the top of the turn, by whoever owns the
    // seat — everyone else simply waits for the referee to move on.
    if (p.skipTurns > 0) {
      p.skipTurns--;
      showSkipped(p);
      return;
    }
    const level = levelFor(p);
    const finale = isFinale(p);
    const seconds = Math.max(20, clockSecondsFor(level) + p.bonusSeconds);
    const lives = livesFor(p, level);

    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen' },
        el('h2', { class: 'race-headline', style: `color:${p.accent}` }, finale ? `${p.name}: МЕГА-БОСС` : `Ходит ${p.name}`),
        el(
          'p',
          { class: 'race-sub' },
          finale
            ? `Последняя клетка: ${level.name}. Снесёте — гонка ваша.`
            : `Уровень «${level.name}» · сначала уровень, потом кубик`,
        ),
        el(
          'div',
          { class: 'race-facts' },
          fact(`${p.cell}`, `из ${distance} клеток`, p.accent),
          fact(`♥ ${lives}`, level.boss ? 'жизней (+1 взаймы)' : 'жизней', '#ff5fa2'),
          fact(`${p.stock.length}`, 'карт в запасе', '#ffd24d'),
          fact(`${seconds}`, 'секунд на ход', seconds < 75 ? '#ff4d6d' : '#3ddc84'),
        ),
        finale
          ? el('p', { class: 'hint' }, `Не добьёте — откат на ${FINALE_KNOCKBACK} клеток, и гонка продолжится без вас впереди.`)
          : null,
        p.bonusSeconds !== 0 || p.springDebt || p.chargedSuper
          ? el(
              'div',
              { class: 'row', style: 'gap:8px;margin-top:6px' },
              ...[
                p.bonusSeconds > 0 ? `⏱ +${p.bonusSeconds} с с клетки` : '',
                p.bonusSeconds < 0 ? `⌛ ${p.bonusSeconds} с с клетки` : '',
                p.chargedSuper ? '⚡ супер заряжен' : '',
                p.springDebt ? '⇑ долг катапульты: уровень с помехой' : '',
              ]
                .filter(Boolean)
                .map((text) => el('span', { class: 'pill amber' }, text)),
            )
          : null,
        buildTrack(),
        el('p', { class: 'hint', style: 'margin:8px 0 0' }, 'Клетки закрыты, пока на них никто не встал. Что сработало — светится до конца матча уже для всех.'),
        standings(),
        feed.length
          ? el('div', { class: 'commentary', style: 'margin-top:12px' }, ...feed.map((text) => el('p', {}, text)))
          : null,
        el('h3', { style: 'margin-top:18px' }, 'Запас карт'),
        el('p', { class: 'hint', style: 'margin-top:0' }, 'Карты не появляются сами: их ловят на своём уровне (капсула ★) и получают за зачистку. Что накопили — тем и бросаетесь в чужой ход, каждая на своей клавише.'),
        handsPreview(),
        pactRow(),
        el(
          'div',
          { class: 'row', style: 'margin-top:20px' },
          isMine(turnSeat)
            ? button(finale ? 'На мега-босса' : 'Играть уровень', startTurn, 'btn primary')
            : button(`Смотреть ход: ${p.name}`, startWatch, 'btn primary'),
          button('В меню', leaveRace, 'btn ghost'),
        ),
      ),
    );
  }

  /** A turn nobody plays. Shown to the whole table so the pause is explained
   *  rather than mysterious. */
  function showSkipped(p: RacePlayer): void {
    phase = 'board';
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${p.accent}` }, `${p.name}: ход пропущен`),
        el('p', { class: 'hint' }, 'Карантин: бланк подписан, ход отправлен в архив.'),
        p.skipTurns > 0 ? el('p', { class: 'hint' }, `Пропустить ещё ходов: ${p.skipTurns}`) : null,
        el(
          'div',
          { class: 'row', style: 'margin-top:18px' },
          isMine(turnSeat)
            ? button(
                'Дальше',
                () => {
                  if (online) netio?.endTurn(false);
                  else nextTurn();
                },
                'btn primary',
              )
            : el('span', { class: 'hint' }, `Ждём ${p.name}…`),
          button('В меню', leaveRace, 'btn ghost'),
        ),
      ),
    );
  }

  /** One big number with a quiet caption under it. */
  function fact(value: string, caption: string, color?: string): HTMLElement {
    return el(
      'div',
      {},
      el('b', color ? { style: `color:${color}` } : {}, value),
      el('span', {}, caption),
    );
  }

  function standings(): HTMLElement {
    const sorted = [...players].sort((a, b) => b.cell - a.cell);
    return el(
      'div',
      { class: 'row', style: 'gap:8px;margin-top:14px' },
      ...sorted.map((p) =>
        el(
          'span',
          {
            class: 'pill',
            style: `border-color:${p.accent};color:${p.accent}${p.seat === turnSeat ? ';font-weight:800' : ''}`,
          },
          `${p.name} · клетка ${p.cell} · ♥ ${p.lives} · карт ${p.stock.length}${p.team !== null ? ` · союз ${TEAM_LABELS[p.team]}` : ''}`,
        ),
      ),
    );
  }

  function handsPreview(): HTMLElement {
    return el(
      'div',
      { class: 'grid c3', style: 'margin-top:10px' },
      ...players
        .filter((p) => p.seat !== turnSeat)
        .map((p) =>
          el(
            'div',
            { class: 'card', style: `border-color:${p.accent}44` },
            el('div', { class: 'title', style: `color:${p.accent}` }, `${p.name} · карт ${p.stock.length}`),
            ...Array.from({ length: HAND_SIZE }, (_, i) => {
              const id = p.stock[i];
              if (!id) return el('div', { class: 'desc' }, `[${SEAT_KEY_LABELS[p.seat][i]}] — пусто`);
              const def = CARDS[id];
              const banned = !cardAllowed(def, p, active());
              const why = !banned
                ? ''
                : def.kind === 'buff'
                  ? teammates(players, p).length
                    ? ' — ждёт хода союзника'
                    : ' — без союза сбросится'
                  : ' — союзник';
              return el(
                'div',
                { class: 'desc', style: banned ? 'opacity:.4' : '' },
                `[${SEAT_KEY_LABELS[p.seat][i]}] ${def.icon} ${def.name}${why}`,
              );
            }),
          ),
        ),
    );
  }

  /** Unions are usually agreed before the match on the setup screen; this panel
   *  is what is left of that mid-race — a lone racer can still join somebody,
   *  and anybody can walk out. */
  function pactRow(): HTMLElement {
    const rows: HTMLElement[] = [];
    const loners = players.filter((p) => p.team === null);

    for (const p of players) {
      if (p.team === null) continue;
      // One row per union, rendered by its lowest seat.
      const mates = teammates(players, p);
      if (mates.some((m) => m.seat < p.seat)) continue;
      rows.push(
        el(
          'span',
          { class: 'pill', style: `border-color:${TEAM_COLORS[p.team]};color:${TEAM_COLORS[p.team]}` },
          `Союз ${TEAM_LABELS[p.team]}: ${[p, ...mates].map((m) => m.name).join(' + ')}`,
        ),
      );
    }

    for (const p of players) {
      if (p.team === null) continue;
      rows.push(
        button(
          `${p.name} — выйти из союза`,
          () => {
            p.stock.splice(0, Math.ceil(p.stock.length / 2));
            leaveTeam(p);
            sfx.play('ui');
            showBoard();
          },
          'btn small ghost',
        ),
      );
    }

    // Joining: a loner may attach to an existing union or start one with another
    // loner. Three to a team, no more.
    for (const p of loners) {
      for (const q of players) {
        if (q === p) continue;
        if (q.team === null && q.seat < p.seat) continue;
        const size = q.team === null ? 1 : 1 + teammates(players, q).length;
        if (q.team !== null && size >= 3) continue;
        rows.push(
          button(
            q.team === null ? `Союз: ${p.name} + ${q.name}` : `${p.name} → союз ${TEAM_LABELS[q.team]}`,
            () => {
              if (q.team === null) {
                const t = freeTeam(players);
                if (t === null) return;
                q.team = t;
              }
              p.team = q.team;
              sfx.play('ui');
              showBoard();
            },
            'btn small',
          ),
        );
      }
    }

    return el(
      'div',
      { style: 'margin-top:16px' },
      el('h3', {}, 'Союзы'),
      el('p', { class: 'hint', style: 'margin-top:0' }, 'Союзники не могут бить друг друга, за каждый зачищенный ими уровень вы получаете карту, а собранные с клеток жизни можно передать. Втроём — предел. Выход стоит половины запаса карт и виден всем.'),
      el('div', { class: 'row', style: 'gap:8px' }, ...(rows.length ? rows : [el('span', { class: 'hint' }, 'Все сами за себя')])),
      giftRow(),
    );
  }

  /** Leaving empties a team of one, which would otherwise linger and block a
   *  team letter for the rest of the match. */
  function leaveTeam(p: RacePlayer): void {
    const mates = teammates(players, p);
    p.team = null;
    if (mates.length === 1) mates[0].team = null;
  }

  /** Lives picked up from cells are not spent until your next turn, so up to
   *  then they are transferable — an ally walking into a boss needs them more
   *  than you do. */
  /** Lives are now one stock, so what is given away is genuinely your own —
   *  and you can never give away your last one. */
  function giftRow(): HTMLElement | null {
    const donors = players.filter((p) => p.lives > 1 && teammates(players, p).length > 0);
    if (!donors.length) return null;

    const give = (from: RacePlayer, to: RacePlayer, n: number): void => {
      const moved = Math.min(n, from.lives - 1);
      if (moved <= 0) return;
      from.lives -= moved;
      to.lives += moved;
      sfx.play('powerup');
      showBoard();
    };

    const buttons: HTMLElement[] = [];
    for (const p of donors) {
      for (const mate of teammates(players, p)) {
        buttons.push(button(`${p.name} → ${mate.name}: 1 жизнь`, () => give(p, mate, 1), 'btn small'));
        if (p.lives > 2) {
          buttons.push(
            button(`${p.name} → ${mate.name}: ${p.lives - 1}`, () => give(p, mate, p.lives - 1), 'btn small ghost'),
          );
        }
      }
    }
    return el(
      'div',
      { style: 'margin-top:10px' },
      el('p', { class: 'hint', style: 'margin:0 0 6px' }, 'Отдать союзнику свои жизни (последнюю отдать нельзя):'),
      el('div', { class: 'row', style: 'gap:8px' }, ...buttons),
    );
  }

  // --------------------------------------------------------------- a turn --

  function startTurn(): void {
    const p = active();
    const level = levelFor(p);
    clockLimit = Math.max(20, clockSecondsFor(level) + p.bonusSeconds);
    clock = clockLimit;
    livesAtStart = livesFor(p, level);
    p.bonusSeconds = 0;
    bestCombo = 0;
    jamCharges = JAM_PER_TURN;
    shieldArmed = false;
    paused = false;
    log.length = 0;

    arena = new Arena({
      level,
      superId: opts.superId,
      // Race drops: the ★ card capsule exists here and nowhere else.
      mode: 'race',
      lives: livesAtStart,
    });
    arena.equipSkills(app.profile.skills);
    if (p.chargedSuper) {
      p.chargedSuper = false;
      arena.energy = ENERGY_MAX;
      note('Перегрузка: супер заряжен', '#b06bff');
    }
    fx = new ArenaFx();

    // The catapult's price, paid on arrival rather than on take-off.
    if (p.springDebt) {
      p.springDebt = false;
      const def = rng.pick(DEBUFF_LIST);
      arena.applyDebuff(def.id);
      note(`Долг катапульты: ${def.name}`, def.color);
    }

    phase = 'play';
    app.overlay.replaceChildren();
    app.overlay.classList.remove('interactive');
    app.capturePointer();
    music.setScene('versus');
    sfx.play('ui');
  }

  /** Someone else's turn: no arena here, just their field as it arrives and our
   *  own hand on our own keys. */
  function startWatch(): void {
    phase = 'watch';
    arena = null;
    mirror = null;
    mirrorAge = 0;
    mirrorSeq = -1;
    log.length = 0;
    app.overlay.replaceChildren();
    app.overlay.classList.remove('interactive');
    music.setScene('versus');
  }

  /** Packs the field for the watchers. The brick wall is the bulk of it and it
   *  changes rarely, so it only goes out when it actually changed — that is
   *  what keeps a five-watcher room cheap. */
  function makeSnapshot(a: Arena, withCells: boolean): RaceSnapshot {
    let cells = '';
    if (withCells) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < a.cols; c++) {
          const b = a.grid[r * a.cols + c];
          cells += b && b.alive ? b.kind.code : '0';
        }
      }
    }
    const changed = withCells && cells !== lastCells;
    if (changed) lastCells = cells;
    return {
      cells: changed ? cells : undefined,
      cols: a.cols,
      paddleX: Math.round(a.paddleX),
      paddleW: Math.round(a.paddleW),
      balls: a.balls.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })),
      score: a.score,
      lives: a.lives,
      xpLevel: a.xpLevel,
      combo: a.combo,
      energy: Math.round(a.energy),
      n: ++mirrorSeq,
      clock: Math.max(0, Math.round(clock)),
    };
  }

  function onSnapshot(seat: number, snap: RaceSnapshot): void {
    if (seat !== turnSeat) return;
    // Out-of-order packets are dropped rather than rewound: a frame of the
    // past is worse than a frame of nothing when you are aiming a card.
    if (mirror && snap.n <= mirror.n) return;
    if (!snap.cells && mirror?.cells) snap.cells = mirror.cells;
    mirror = snap;
    mirrorAge = 0;
    clock = snap.clock;
  }

  /** A waiting player pressed one of their three keys. Online the card is not
   *  played here — it is sent, and every client (including this one) plays it
   *  when the referee echoes it back, so nobody's table runs ahead. */
  function playCard(from: RacePlayer, slot: number): void {
    if (phase !== 'play' && phase !== 'watch') return;
    if (from.seat === turnSeat) return;
    const id = from.stock[slot];
    if (!id) return;
    const def = CARDS[id];
    const target = active();

    if (!cardAllowed(def, from, target)) {
      // Dead weight can be burnt; a card waiting for an ally's turn is kept.
      if (!canDiscard(def, from, players)) {
        note(
          def.kind === 'buff' ? `${def.name}: помогаем только союзникам` : `${from.name}: союзника не бьём`,
          '#5a6472',
        );
        return;
      }
    }

    if (online) {
      netio?.throwCard(from.seat, id);
      return;
    }
    from.stock.splice(slot, 1);

    // The counter costs the thrower the card anyway — that is what makes
    // baiting the block worth doing.
    if (shieldArmed && def.kind === 'debuff' && def.effect.t !== 'dice') {
      shieldArmed = false;
      note(`${target.name} отбил ${def.name}`, '#4de2ff');
      fx.text(ARENA_W / 2, 250, 'ОТБИТО', '#4de2ff');
      sfx.play('ui');
      return;
    }

    applyCard(def, from, target);
  }

  /** The referee's echo of a throw. Runs on every client so that stocks and
   *  dice modifiers stay identical; only the machine that owns the arena
   *  touches the field. */
  function onCard(fromSeat: number, id: CardId): void {
    const from = players[fromSeat];
    const def = CARDS[id];
    if (!from || !def) return;
    const slot = from.stock.indexOf(id);
    if (slot >= 0) from.stock.splice(slot, 1);

    const target = active();
    // Not a throw but a discard: a lone racer burning a buff nobody can take.
    if (!cardAllowed(def, from, target)) {
      note(`${from.name} сбрасывает ${def.name}: некому дарить`, '#5a6472');
      return;
    }
    // The shield stops what is aimed at the field. A dice card is paperwork,
    // not an attack, so it is never blocked — and every client can therefore
    // apply it without knowing whether a shield was up.
    if (arena && shieldArmed && def.kind === 'debuff' && def.effect.t !== 'dice') {
      shieldArmed = false;
      note(`${target.name} отбил ${def.name}`, '#4de2ff');
      fx.text(ARENA_W / 2, 250, 'ОТБИТО', '#4de2ff');
      sfx.play('ui');
      return;
    }
    applyCard(def, from, target);
  }

  function applyCard(def: CardDef, from: RacePlayer, target: RacePlayer): void {
    switch (def.effect.t) {
      case 'powerup':
        arena?.grantPowerup(def.effect.id);
        break;
      case 'debuff':
        arena?.applyDebuff(def.effect.id);
        break;
      case 'ball':
        if (arena) {
          if (arena.balls.length === 0) arena.addBall();
          arena.setBallType(def.effect.id);
        }
        break;
      case 'dice':
        // State, not simulation: this one lands on every client.
        target.diceMod += def.effect.delta;
        break;
      case 'clock':
        if (arena) {
          clock = Math.max(1, clock + def.effect.delta);
          clockLimit = Math.max(clockLimit, clock);
        }
        break;
      case 'super':
        // Charged and let off at once: a gift is worth what the moment is.
        if (arena) {
          arena.energy = ENERGY_MAX;
          arena.fireSuper();
        }
        break;
      case 'lives':
        // Lives are the shared stock, so this one lands on every client.
        target.lives += def.effect.delta;
        if (arena) arena.lives += def.effect.delta;
        break;
      case 'breakShield':
        if (arena) {
          const broken = arena.breakShieldNodes();
          fx.text(ARENA_W / 2, 180, broken ? 'ЩИТ СБРОШЕН' : 'УЗЛОВ НЕТ', '#ff2d55');
        }
        break;
    }
    if (arena) fx.text(ARENA_W / 2, def.kind === 'buff' ? 220 : 260, `${def.icon} ${def.name.toUpperCase()}`, def.color);
    note(`${from.name} → ${def.name}`, def.color);
    sfx.play(def.kind === 'buff' ? 'powerup' : 'garbage');
  }

  function interventionKeys(): void {
    for (const p of players) {
      if (p.seat === turnSeat || !isMine(p.seat)) continue;
      const keys = SEAT_KEYS[p.seat] ?? [];
      for (let i = 0; i < HAND_SIZE; i++) {
        if (keys[i] && app.input.wasPressed([keys[i]])) playCard(p, i);
      }
    }
    if (app.input.wasPressed([JAM_KEY]) && jamCharges > 0 && !shieldArmed) {
      jamCharges--;
      shieldArmed = true;
      note(`${active().name}: щит поднят`, '#4de2ff');
      fx.text(ARENA_W / 2, 200, 'ЩИТ', '#4de2ff');
      sfx.play('ui');
    }
  }

  function endTurn(cleared: boolean, died: boolean): void {
    if (!arena) return;
    const p = active();
    const result: TurnResult = {
      cleared,
      died,
      timeLeft: Math.max(0, clock),
      timeLimit: clockLimit,
      livesLost: Math.max(0, livesAtStart - arena.lives),
      bestCombo,
      bricks: arena.bricksBroken,
      boss: arena.level.boss !== undefined && arena.level.boss !== null,
    };
    // What is left of the stock carries to the next turn. The boss loan is not
    // yours to keep.
    p.lives = Math.max(0, arena.lives - (arena.level.boss ? BOSS_LIVES_BONUS : 0));
    app.saveProfile((prof) => (prof.totalXp += Math.round(arena!.xpEarned)));

    // Cards are drawn here, on the machine that earned them, and travel as ids
    // — the capsules caught this turn plus the clear bonus and the allies' cut.
    const awards: TurnAward[] = [];
    const clearCards = Array.from({ length: cardsForTurn(result) }, () => drawLocalCard(p));
    const own = [...earned, ...clearCards];
    earned = [];
    if (own.length) awards.push({ seat: p.seat, cards: own });
    if (cleared) {
      for (const mate of teammates(players, p)) {
        awards.push({ seat: mate.seat, cards: Array.from({ length: ALLY_CARDS }, () => drawLocalCard(mate)) });
      }
    }

    const report: TurnReport = { ...result, awards };
    if (online) {
      // The referee owns the die; the turn resumes when it answers.
      netio?.reportResult(report);
      return;
    }
    applyReport(report);
    beginRoll(rollDice(rng, result, p.diceMod).die, report);
  }

  function drawLocalCard(who: RacePlayer): CardId {
    return drawCardFor(who, players, localRng);
  }

  /** Hands out the cards a turn paid. Runs on every client from the same list. */
  function applyReport(report: TurnReport): void {
    standingsBefore = snapshot(players);
    for (const award of report.awards ?? []) {
      const who = players[award.seat];
      if (!who) continue;
      for (const card of award.cards) {
        if (who.stock.length < STOCK_MAX) who.stock.push(card);
      }
      if (award.cards.length && who === active()) note(`+${award.cards.length} карт за ход`, '#ffd24d');
    }
  }

  /** Everything from the die onwards: the same on the player's screen and on
   *  every watcher's, because both are handed the same die and result. */
  function beginRoll(die: number, report: TurnResult | null): void {
    const p = active();
    if (!report || report.died || die <= 0) {
      roll = null;
      p.diceMod = 0;
      showRoll();
      return;
    }
    if (isFinale(p)) {
      finishFinale(p, report);
      return;
    }
    roll = makeRoll(die, turnRng(), report, p.diceMod);
    p.diceMod = 0;
    showRoll();
  }

  function onRoll(seat: number, index: number, die: number, report: TurnReport | null): void {
    turnSeat = seat;
    turnIndex = index;
    if (report) {
      const p = players[seat];
      p.turns++;
      if (report.cleared) p.cleared++;
      applyReport(report);
    }
    beginRoll(die, report);
  }

  function onTurn(seat: number, index: number): void {
    arena = null;
    mirror = null;
    roll = null;
    moveResolved = false;
    turnReversed = false;
    turnRewind = false;
    turnSeat = seat;
    turnIndex = index;
    music.setScene('menu');
    showBoard();
  }

  /** The referee burnt somebody's turn: they went quiet or lost the socket. */
  function onTimeout(seat: number): void {
    const p = players[seat];
    if (p) note(`${p.name}: ход сгорел — нет связи`, '#ff4d6d');
    feed.unshift(`${p?.name ?? 'Игрок'} пропускает ход: связь потеряна`);
    if (feed.length > 5) feed.pop();
  }

  function finishFinale(p: RacePlayer, result: TurnResult): void {
    if (result.cleared) {
      phase = 'over';
      sfx.play('levelup');
      if (isMine(p.seat)) app.saveProfile((prof) => (prof.versusWins[0] += 1));
      showOver(p);
      return;
    }
    const before = p.cell;
    p.cell = Math.max(0, distance - FINALE_KNOCKBACK);
    roll = null;
    startMove(before, p.cell, 'Мега-босс устоял');
  }

  // ------------------------------------------------------- roll and move --

  function showRoll(): void {
    phase = 'roll';
    rollT = 0;
    rollFace = 1;
    app.overlay.replaceChildren();
    app.overlay.classList.remove('interactive');
    sfx.play('ui');
  }

  /** Walks the token from one cell to another, one step at a time, and lets the
   *  landing cell fire when it arrives. */
  function startMove(from: number, to: number, headline: string): void {
    phase = 'move';
    movePath = [];
    const step = to >= from ? 1 : -1;
    for (let c = from + step; step > 0 ? c <= to : c >= to; c += step) movePath.push(c);
    moveTimer = 0;
    moveDone = movePath.length === 0;
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen' },
        el('h2', { class: 'race-headline', style: `color:${active().accent}`, id: 'move-title' }, headline),
        el('p', { class: 'race-sub', id: 'move-line' }, `С клетки ${from} на клетку ${to}`),
        el('div', { id: 'move-effect' }),
        buildTrack(),
        el('div', { id: 'move-say' }),
        el('div', { class: 'row', style: 'margin-top:18px', id: 'move-actions' }),
      ),
    );
    if (moveDone) finishMove();
  }

  function stepMove(dt: number): void {
    if (moveDone) return;
    moveTimer += dt;
    while (moveTimer >= STEP_TIME && movePath.length) {
      moveTimer -= STEP_TIME;
      const p = active();
      const was = p.cell;
      p.cell = movePath.shift()!;
      refreshCell(was);
      refreshCell(p.cell);
      sfx.play('paddle');
    }
    if (movePath.length) return;

    // Arrived. The cell under the token fires once — and a cell that moved us
    // does not get to chain into a second one.
    const p = active();
    const cell = cells[p.cell];
    if (!moveResolved && cell && cell.kind && p.cell !== distance) {
      moveResolved = true;
      const wasRevealed = cell.revealed;
      cell.revealed = true;
      const before = p.cell;
      const outcome = resolveCell(cell.kind, p, players, distance, turnRng());
      if (outcome.reversed) {
        direction = direction === 1 ? -1 : 1;
        turnReversed = true;
      }
      if (outcome.rewind) turnRewind = true;
      refreshCell(before);
      for (const other of players) refreshCell(other.cell);
      const def = CELL_TYPES[cell.kind];
      sfx.play(outcome.delta < 0 || cell.kind === 'toll' || cell.kind === 'skip' ? 'garbage' : 'powerup');
      const slot = app.overlay.querySelector('#move-effect');
      slot?.replaceChildren(
        el(
          'div',
          { class: 'race-effect', style: `--cell:${def.color}` },
          el('div', { class: 'glyph' }, def.icon),
          el(
            'div',
            {},
            el('h4', {}, `${def.name}${wasRevealed ? '' : ' — клетка открыта'}`),
            el('div', { class: 'what' }, outcome.text),
            el('p', { class: 'say' }, outcome.line),
          ),
        ),
      );
      if (outcome.delta !== 0 || outcome.swappedWith !== null) {
        startMoveContinuation(before, p.cell);
        return;
      }
    }
    finishMove();
  }

  /** Second hop: the cell threw us somewhere, so walk that too. */
  function startMoveContinuation(from: number, to: number): void {
    movePath = [];
    const step = to >= from ? 1 : -1;
    for (let c = from + step; step > 0 ? c <= to : c >= to; c += step) movePath.push(c);
    moveTimer = 0;
    if (!movePath.length) finishMove();
  }

  function finishMove(): void {
    moveDone = true;
    const p = active();
    const leader = [...players].sort((a, b) => b.cell - a.cell)[0];
    const actions = app.overlay.querySelector('#move-actions');
    if (!actions || actions.childElementCount) return;
    if (!online) {
      actions.append(button('Следующий игрок', nextTurn, 'btn primary'), button('В меню', leaveRace, 'btn ghost'));
    } else if (isMine(turnSeat)) {
      // Only the player whose turn it was hands it on; everyone else waits for
      // the referee to say who is next.
      actions.append(
        button(
          'Передать ход',
          () => {
            netio?.endTurn(turnReversed, turnRewind);
            actions.replaceChildren(el('span', { class: 'hint' }, 'Передаём ход…'));
          },
          'btn primary',
        ),
        button('В меню', leaveRace, 'btn ghost'),
      );
    } else {
      actions.append(el('span', { class: 'hint' }, `Ждём ${p.name}…`), button('В меню', leaveRace, 'btn ghost'));
    }

    // The commentator draws from the turn's own stream, so every screen hears
    // the same line rather than three different ones.
    const said = raceComments(standingsBefore, players, p, distance, turnRng());
    for (const line of said) {
      feed.unshift(line);
      if (feed.length > 5) feed.pop();
    }

    const say = app.overlay.querySelector('#move-say');
    say?.replaceChildren(
      el(
        'div',
        { class: 'race-facts' },
        fact(`${p.cell}`, `клетка из ${distance}`, p.accent),
        fact(`♥ ${p.lives}`, 'жизней', '#ff5fa2'),
        fact(`${p.stock.length}`, 'карт', '#ffd24d'),
        fact(leader.name, `впереди · клетка ${leader.cell}`, leader.accent),
      ),
      said.length ? el('div', { class: 'commentary' }, ...said.map((text) => el('p', {}, text))) : el('div', {}),
    );
    if (said.length) sfx.play('ui');
  }

  function leaveRace(): void {
    netio?.dispose();
    app.setScene(mainMenu);
  }

  function nextTurn(): void {
    arena = null;
    roll = null;
    moveResolved = false;
    // A rewind steps back instead of forward: the player before this one goes
    // again.
    const step = turnRewind ? -direction : direction;
    turnRewind = false;
    turnSeat = (turnSeat + step + players.length) % players.length;
    turnIndex++;
    if (turnSeat === 0) round++;
    music.setScene('menu');
    showBoard();
  }

  function showOver(winner: RacePlayer): void {
    const table = [...players].sort((a, b) => b.cell - a.cell);
    // A union wins together: whoever of them lands the kill, the team takes it.
    const mates = teammates(players, winner);
    const title =
      winner.team !== null
        ? `ПОБЕДА СОЮЗА ${TEAM_LABELS[winner.team]}: ${[winner, ...mates].map((m) => m.name).join(' + ')}`
        : `ПОБЕДА: ${winner.name}`;
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${winner.team !== null ? TEAM_COLORS[winner.team] : winner.accent}` }, title),
        el(
          'p',
          { class: 'hint' },
          winner.team !== null
            ? `${winner.name} снял мега-босса на ${round}-м круге — победа засчитана всему союзу.`
            : `Мега-босс повержен на ${round}-м круге.`,
        ),
        ...table.map((p) =>
          el('p', { class: 'hint' }, `${p.name}: клетка ${p.cell} · ходов ${p.turns} · зачищено ${p.cleared}`),
        ),
        el(
          'div',
          { class: 'row', style: 'margin-top:18px' },
          button('Ещё раз', () => app.setScene((a) => raceScene(a, opts)), 'btn primary'),
          button('В меню', () => app.setScene(mainMenu), 'btn ghost'),
        ),
      ),
    );
  }

  function showPause(): void {
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: 'color:#4de2ff' }, 'ПАУЗА'),
        el('p', { class: 'hint' }, 'Часы хода стоят. Карты тоже не летят.'),
        el(
          'div',
          { class: 'row', style: 'margin-top:18px' },
          button(
            'Продолжить',
            () => {
              paused = false;
              app.overlay.replaceChildren();
              app.overlay.classList.remove('interactive');
              app.capturePointer();
            },
            'btn primary',
          ),
          button('Сдать ход', () => {
            paused = false;
            app.overlay.replaceChildren();
            app.overlay.classList.remove('interactive');
            endTurn(false, false);
          }),
          button('В меню', () => app.setScene(mainMenu), 'btn ghost'),
        ),
      ),
    );
  }

  // ------------------------------------------------------------- rendering --

  /** Left panel during a turn: the clock, the shield, and every waiting
   *  player's hand with the key that fires it. */
  function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(10,15,32,0.85)';
    ctx.strokeStyle = 'rgba(77,226,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 12);
    ctx.fill();
    ctx.stroke();

    const pad = 13;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const p = active();
    ctx.fillStyle = p.accent;
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(`${p.name} · клетка ${p.cell}/${distance}`, pad, 24);

    // Turn clock: the number the whole turn is fighting, so it is drawn big.
    const frac = Math.max(0, Math.min(1, clock / clockLimit));
    const low = clock <= 15;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(pad, 34, w - pad * 2, 10, 5);
    ctx.fill();
    ctx.fillStyle = low ? '#ff4d6d' : '#3ddc84';
    ctx.beginPath();
    ctx.roundRect(pad, 34, (w - pad * 2) * frac, 10, 5);
    ctx.fill();
    ctx.fillStyle = low ? '#ff4d6d' : '#ffffff';
    ctx.font = `800 30px ${FONT}`;
    ctx.fillText(`${Math.ceil(Math.max(0, clock))}`, pad, 78);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText('секунд до конца хода', pad + 48, 78);

    ctx.fillStyle = shieldArmed ? '#4de2ff' : 'rgba(255,255,255,0.35)';
    ctx.fillText(shieldArmed ? 'ЩИТ ПОДНЯТ — отобьёт одну карту' : `R — щит (осталось ${jamCharges})`, pad, 96);

    let ty = 122;
    for (const other of players) {
      if (other.seat === turnSeat) continue;
      ctx.fillStyle = other.accent;
      ctx.font = `800 12px ${FONT}`;
      ctx.fillText(`${other.name}`, pad, ty);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText(`карт ${other.stock.length}`, w - pad, ty);
      ctx.textAlign = 'left';
      ty += 6;

      for (let i = 0; i < HAND_SIZE; i++) {
        ty += 17;
        const id = other.stock[i];
        const key = SEAT_KEY_LABELS[other.seat]?.[i] ?? '?';
        if (!id) {
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.font = `600 11px ${FONT}`;
          ctx.fillText(`${key} — пусто`, pad + 4, ty);
          continue;
        }
        const def = CARDS[id];
        const banned = !cardAllowed(def, other, p);
        ctx.globalAlpha = banned ? 0.38 : 1;
        ctx.fillStyle = def.color;
        ctx.font = `700 11px ${FONT}`;
        ctx.fillText(`${key}  ${def.icon} ${def.name}`, pad + 4, ty);
        if (banned) {
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.fillText(
            def.kind === 'buff' ? (teammates(players, other).length ? 'своим' : 'сброс') : 'союзник',
            w - pad,
            ty,
          );
          ctx.textAlign = 'left';
        }
        ctx.globalAlpha = 1;
      }
      ty += 22;
    }

    // Newest events at the bottom, fading out.
    let ly = h - 14;
    for (const line of log) {
      ctx.globalAlpha = Math.max(0, 1 - line.t / 6);
      ctx.fillStyle = line.color;
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText(line.text, pad, ly);
      ly -= 15;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** The active player's field as it reaches us. Balls are drawn where they
   *  would be now, not where the last packet put them: a card is aimed at a
   *  moving ball, and a seventieth of a second of lag is a visible miss. */
  function drawMirror(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#0a0f1f';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    ctx.fillStyle = '#16203c';
    ctx.fillRect(0, 0, WALL, ARENA_H);
    ctx.fillRect(ARENA_W - WALL, 0, WALL, ARENA_H);
    ctx.fillRect(0, 0, ARENA_W, WALL);

    if (!mirror) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `600 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`Ждём поле: ${active().name}…`, ARENA_W / 2, ARENA_H / 2);
      ctx.restore();
      return;
    }

    const bw = brickWidthFor(ARENA_W, mirror.cols);
    const cells = mirror.cells ?? '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < mirror.cols; c++) {
        const ch = cells[r * mirror.cols + c];
        if (!ch || !isBrickCode(ch)) continue;
        const kind = BRICK_KINDS[ch];
        ctx.fillStyle = kind.color;
        ctx.globalAlpha = 0.62;
        ctx.beginPath();
        ctx.roundRect(GRID_LEFT + c * bw + 1.5, GRID_TOP + r * BRICK_H + 1.5, bw - 3, BRICK_H - 3, 3);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = active().accent;
    ctx.fillRect(mirror.paddleX - mirror.paddleW / 2, PADDLE_Y, mirror.paddleW, PADDLE_H);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    for (const b of mirror.balls) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Honesty about lag: a watcher can see how old the picture they are aiming
    // at is, instead of guessing why a card missed.
    const ms = Math.round(mirrorAge * 1000);
    ctx.textAlign = 'right';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = ms > 400 ? '#ff4d6d' : 'rgba(255,255,255,0.35)';
    ctx.fillText(`картинка: ${ms} мс`, ARENA_W - 12, ARENA_H - 12);
    ctx.restore();
  }

  /** A watcher's right-hand panel: the same numbers the player has, taken from
   *  the snapshot rather than from an arena we do not run. */
  function drawWatchHud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const p = active();
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(10,15,32,0.85)';
    ctx.strokeStyle = `${p.accent}59`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 12);
    ctx.fill();
    ctx.stroke();

    const pad = 14;
    ctx.textAlign = 'left';
    ctx.fillStyle = p.accent;
    ctx.font = `800 16px ${FONT}`;
    ctx.fillText('ТРАНСЛЯЦИЯ', pad, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(`${p.name} · клетка ${p.cell}/${distance} · круг ${round}`, pad, 44);

    const low = clock <= 15;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('ДО КОНЦА ХОДА', pad, 74);
    ctx.fillStyle = low ? '#ff4d6d' : '#3ddc84';
    ctx.font = `800 26px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.ceil(Math.max(0, clock))), w - pad, 82);
    ctx.textAlign = 'left';

    if (mirror) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText(`Жизни: ${mirror.lives}`, pad, 112);
      ctx.fillText(`Счёт: ${mirror.score}`, pad, 130);
      ctx.fillText(`Серия: ×${mirror.combo}`, pad, 148);
      ctx.fillText(`Мячей в игре: ${mirror.balls.length}`, pad, 166);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText('Ваши карты — слева,', pad, h - 46);
    ctx.fillText('на ваших клавишах.', pad, h - 30);
    ctx.restore();
  }

  /** The die, drawn big in the middle of the screen. */
  function drawDie(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, face: number, wobble: number): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(wobble);
    ctx.fillStyle = '#f2f6ff';
    ctx.strokeStyle = '#4de2ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(77,226,255,0.55)';
    ctx.shadowBlur = 34;
    ctx.beginPath();
    ctx.roundRect(-size / 2, -size / 2, size, size, size * 0.18);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    const u = size / 4;
    const pips: [number, number][][] = [
      [[0, 0]],
      [[-u, -u], [u, u]],
      [[-u, -u], [0, 0], [u, u]],
      [[-u, -u], [u, -u], [-u, u], [u, u]],
      [[-u, -u], [u, -u], [0, 0], [-u, u], [u, u]],
      [[-u, -u], [u, -u], [-u, 0], [u, 0], [-u, u], [u, u]],
    ];
    ctx.fillStyle = '#0b1226';
    for (const [px, py] of pips[Math.min(5, Math.max(0, face - 1))]) {
      ctx.beginPath();
      ctx.arc(px, py, size * 0.075, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRollScreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    backdrop.draw(ctx, w, h);
    const cx = w / 2;
    const p = active();
    const spinning = rollT < ROLL_SPIN;
    // Everything scales with the window: on a short laptop screen the die must
    // not grow into the text under it.
    const s = Math.min(1, h / 720);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = p.accent;
    ctx.font = `800 ${22 * s}px ${FONT}`;
    ctx.fillText(`${p.name.toUpperCase()} БРОСАЕТ КУБИК`, cx, h * 0.12);

    if (!roll) {
      // Death: no die at all, just the verdict.
      ctx.fillStyle = '#ff4d6d';
      ctx.font = `900 ${46 * s}px ${FONT}`;
      ctx.fillText('МЯЧИ ПОТЕРЯНЫ', cx, h * 0.44);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `600 ${18 * s}px ${FONT}`;
      ctx.fillText('Ход сгорел — кубик не бросается', cx, h * 0.54);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `600 ${14 * s}px ${FONT}`;
      ctx.fillText(online ? 'Идём дальше…' : 'Пробел или клик — дальше', cx, h * 0.72);
      ctx.restore();
      return;
    }

    const size = (spinning ? 132 + Math.sin(rollT * 30) * 8 : 148) * s;
    const wobble = spinning ? Math.sin(rollT * 22) * 0.25 : 0;
    drawDie(ctx, cx, h * 0.34, size, spinning ? rollFace : roll.die, wobble);

    if (spinning) {
      ctx.restore();
      return;
    }

    ctx.fillStyle = '#ffd24d';
    ctx.font = `700 ${17 * s}px ${FONT}`;
    ctx.fillText(roll.line, cx, h * 0.34 + size * 0.5 + 30 * s);

    let by = h * 0.34 + size * 0.5 + 58 * s;
    for (const b of roll.bonuses) {
      ctx.fillStyle = b.value > 0 ? '#3ddc84' : '#ff4d6d';
      ctx.font = `700 ${15 * s}px ${FONT}`;
      ctx.fillText(`${b.value > 0 ? '+' : ''}${b.value} · ${b.label}`, cx, by);
      by += 22 * s;
    }

    // Say the number and where it puts you: "ход на 11" left everyone counting
    // cells in their head.
    const target = Math.min(distance, active().cell + roll.total);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${58 * s}px ${FONT}`;
    ctx.fillText(`ВЫПАДАЕТ ${roll.total}`, cx, by + 54 * s);
    ctx.fillStyle = p.accent;
    ctx.font = `700 ${19 * s}px ${FONT}`;
    ctx.fillText(
      target >= distance
        ? `${p.name} выходит на последнюю клетку ${target} — к мега-боссу`
        : `${p.name} перемещается на клетку ${target}`,
      cx,
      by + 84 * s,
    );
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `600 ${14 * s}px ${FONT}`;
    ctx.fillText(online ? 'Шагаем…' : 'Пробел или клик — шагаем', cx, by + 112 * s);
    ctx.restore();
  }

  function advanceFromRoll(): void {
    const p = active();
    const before = p.cell;
    if (!roll) {
      // Nothing to walk: hand over straight away.
      startMove(before, before, 'Ход сгорел');
      return;
    }
    const to = Math.min(distance, p.cell + roll.total);
    startMove(before, to, `${p.name}: выпадает ${roll.total} — на клетку ${to}`);
  }

  return {
    update(dt) {
      t += dt;
      for (const line of log) line.t += dt;

      if (phase === 'roll') {
        rollT += dt;
        if (rollT < ROLL_SPIN) {
          // Cheap tumble: a new face every other frame, no physics.
          if (Math.floor(rollT * 18) !== Math.floor((rollT - dt) * 18)) rollFace = rng.int(1, 7);
        } else if (online) {
          // Online the screens move together on their own: making five people
          // each press a key to see the same die would only add five delays.
          if (rollT > ROLL_SPIN + 1.8) advanceFromRoll();
        } else if (app.input.anyPressed() || app.input.clicked) {
          advanceFromRoll();
        }
        return;
      }

      if (phase === 'move') {
        stepMove(dt);
        return;
      }

      if (phase === 'watch') {
        mirrorAge += dt;
        // The clock keeps running between packets so the countdown does not
        // stutter; each snapshot corrects it.
        clock = Math.max(0, clock - dt);
        fx.update(dt);
        interventionKeys();
        if (app.input.wasPressed(['Escape'])) leaveRace();
        return;
      }

      if (phase !== 'play') {
        backdrop.update(dt);
        return;
      }
      fx.update(dt);

      if (app.input.wasPressed(['Escape'])) {
        paused = !paused;
        if (paused) showPause();
        else {
          app.overlay.replaceChildren();
          app.overlay.classList.remove('interactive');
        }
        return;
      }
      if (paused || !arena) return;

      interventionKeys();

      const pointer = app.pointer;
      const arenaX =
        pointer && layout.scale > 0 ? (pointer.x - layout.ox) / layout.scale - (PANEL_W + GAP) : null;
      const input =
        arena.state === 'cleared' ? noInput() : app.input.read(SOLO_KEYS, clampPointer(arenaX));

      stepper.step(dt * speed, (sdt, first) => arena!.update(sdt, edgeOnce(input, first)));
      const events = arena.drainEvents();
      fx.consume(events);
      sfx.consume(events, arena.combo);
      for (const e of events) {
        // Cards are earned at the paddle, never handed out by a timer.
        if (e.t === 'powerup' && e.id === 'card') {
          const p = active();
          if (giveCards(p, 1, localRng, players) > 0) note(`${p.name}: +1 карта в запас`, '#ffd24d');
          else note(`Запас полон (${STOCK_MAX})`, '#5a6472');
        }
      }
      bestCombo = Math.max(bestCombo, arena.combo);

      // The draft freezes the clock: choosing a perk must not cost the turn.
      if (arena.state !== 'levelup' && arena.state !== 'spec') clock -= dt * speed;

      // Publish the field for the watchers.
      if (online && isMine(turnSeat)) {
        snapTimer -= dt;
        cellsTimer -= dt;
        if (snapTimer <= 0) {
          snapTimer = RACE_SNAPSHOT_INTERVAL;
          const withCells = cellsTimer <= 0 || arena.bricksBroken !== lastBroken;
          if (cellsTimer <= 0) cellsTimer = RACE_CELLS_INTERVAL;
          lastBroken = arena.bricksBroken;
          netio?.sendSnapshot(makeSnapshot(arena, withCells));
        }
      }

      if (arena.state === 'cleared') endTurn(true, false);
      else if (arena.state === 'dead') endTurn(false, true);
      else if (clock <= 0) endTurn(false, false);
    },

    draw(ctx, w, h) {
      if (phase === 'roll') {
        drawRollScreen(ctx, w, h);
        return;
      }
      if (phase === 'watch') {
        ctx.save();
        layout = fitBox(ctx, w, h, SCENE_W, SCENE_H);
        drawPanel(ctx, 0, 0, PANEL_W, SCENE_H);
        ctx.save();
        ctx.translate(PANEL_W + GAP, 0);
        ctx.beginPath();
        ctx.rect(0, 0, ARENA_W, ARENA_H);
        ctx.clip();
        drawMirror(ctx);
        ctx.restore();
        drawWatchHud(ctx, PANEL_W + GAP + ARENA_W + GAP, 0, HUD_W, SCENE_H);
        ctx.restore();
        return;
      }

      if (phase !== 'play' || !arena) {
        backdrop.draw(ctx, w, h);
        return;
      }
      ctx.save();
      layout = fitBox(ctx, w, h, SCENE_W, SCENE_H);

      drawPanel(ctx, 0, 0, PANEL_W, SCENE_H);

      ctx.save();
      ctx.translate(PANEL_W + GAP, 0);
      ctx.beginPath();
      ctx.rect(0, 0, ARENA_W, ARENA_H);
      ctx.clip();
      drawArena(ctx, arena, fx, t, !app.input.locked);
      ctx.restore();

      drawHud(ctx, arena, PANEL_W + GAP + ARENA_W + GAP, 0, HUD_W, SCENE_H, {
        title: 'ГОНКА',
        accent: active().accent,
        subtitle: `${arena.level.name} · круг ${round}`,
        fps: app.fps,
        countdown: { label: 'ДО КОНЦА ХОДА', seconds: clock },
      });
      ctx.restore();
    },

    dispose() {
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };

  function clampPointer(x: number | null): number | null {
    if (x === null) return null;
    return x < -60 || x > ARENA_W + 60 ? null : x;
  }
}
