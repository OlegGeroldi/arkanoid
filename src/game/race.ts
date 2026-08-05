import { App, fitBox, type Scene } from '../app';
import { ARENA_H, ARENA_W } from '../core/constants';
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
  BOSS_TURN_LIVES,
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
  TURN_LIVES,
  TURN_SECONDS,
  cardAllowed,
  cardsForTurn,
  giveCards,
  levelForCell,
  makeBoard,
  makePlayer,
  resolveCell,
  rollDice,
  type CardDef,
  type RaceCell,
  type RacePlayer,
  type Roll,
  type TurnResult,
} from '../core/race';

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

export interface RaceOptions {
  names: string[];
  distance: number;
  levels: LevelData[];
  superId: SuperId;
  speed?: number;
}

type Phase = 'board' | 'play' | 'roll' | 'move' | 'over';

interface LogLine {
  text: string;
  color: string;
  t: number;
}

/** Hot-seat race: everyone shares one keyboard, one plays a short level against
 *  a countdown, and the rest spend cards they earned in their own turns. */
export function raceScene(app: App, opts: RaceOptions): Scene {
  const rng = new Rng(Date.now() >>> 0);
  const distance = opts.distance;
  const cells = makeBoard(distance, rng);
  const players = opts.names.map((n, i) => makePlayer(i, n, rng));
  const backdrop = new Backdrop();
  const stepper = new FixedStepper();
  const speed = opts.speed ?? 1;

  let phase: Phase = 'board';
  let turnSeat = 0;
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
  let livesAtStart = TURN_LIVES;
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

  music.setScene('menu');
  showBoard();

  function active(): RacePlayer {
    return players[turnSeat];
  }

  function isFinale(p: RacePlayer): boolean {
    return p.cell >= distance;
  }

  function clockSecondsFor(level: LevelData): number {
    return level.boss ? BOSS_TURN_SECONDS : TURN_SECONDS;
  }

  function livesFor(level: LevelData): number {
    return level.boss ? BOSS_TURN_LIVES : TURN_LIVES;
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
    const level = levelFor(p);
    const finale = isFinale(p);
    const seconds = Math.max(20, clockSecondsFor(level) + p.bonusSeconds);
    const lives = livesFor(level) + p.bonusLives;

    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen' },
        el('h2', { style: `color:${p.accent}` }, finale ? `${p.name}: МЕГА-БОСС` : `Ход: ${p.name}`),
        el(
          'p',
          { class: 'hint' },
          finale
            ? `Финальная клетка. Победит тот, кто снесёт ${level.name}. Проигрыш откидывает на ${FINALE_KNOCKBACK} клеток назад.`
            : `Клетка ${p.cell} из ${distance} · уровень «${level.name}» · ${seconds} секунд · ${lives} жизни. Сначала уровень, потом кубик.`,
        ),
        p.bonusSeconds !== 0 || p.bonusLives > 0 || p.springDebt
          ? el(
              'p',
              { class: 'hint', style: 'color:var(--amber)' },
              [
                p.bonusSeconds > 0 ? `+${p.bonusSeconds} с с клетки` : '',
                p.bonusSeconds < 0 ? `${p.bonusSeconds} с с клетки` : '',
                p.bonusLives > 0 ? `+${p.bonusLives} жизней с клетки` : '',
                p.springDebt ? 'долг катапульты: уровень начнётся с помехой' : '',
              ]
                .filter(Boolean)
                .join(' · '),
            )
          : null,
        buildTrack(),
        el('p', { class: 'hint', style: 'margin:8px 0 0' }, 'Клетки закрыты, пока на них никто не встал. Что сработало — светится до конца матча уже для всех.'),
        standings(),
        el('h3', { style: 'margin-top:18px' }, 'Запас карт'),
        el('p', { class: 'hint', style: 'margin-top:0' }, 'Карты не появляются сами: их ловят на своём уровне (капсула ★) и получают за зачистку. Что накопили — тем и бросаетесь в чужой ход, каждая на своей клавише.'),
        handsPreview(),
        pactRow(),
        el(
          'div',
          { class: 'row', style: 'margin-top:20px' },
          button(finale ? 'На мега-босса' : 'Играть уровень', startTurn, 'btn primary'),
          button('В меню', () => app.setScene(mainMenu), 'btn ghost'),
        ),
      ),
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
          `${p.name} · клетка ${p.cell} · карт ${p.stock.length}${p.pact !== null ? ` · пакт с ${players[p.pact].name}` : ''}`,
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
              return el(
                'div',
                { class: 'desc', style: banned ? 'opacity:.4' : '' },
                `[${SEAT_KEY_LABELS[p.seat][i]}] ${def.icon} ${def.name}${banned ? ' — союзник' : ''}`,
              );
            }),
          ),
        ),
    );
  }

  /** Pacts are agreed out loud; this only records them. Mutual by construction,
   *  and breaking one is public. */
  function pactRow(): HTMLElement {
    const free = players.filter((p) => p.pact === null);
    const rows: HTMLElement[] = [];
    for (const p of players) {
      if (p.pact !== null) {
        // A pact is one deal, not two: only the lower seat renders the button.
        if (p.pact < p.seat) continue;
        rows.push(
          button(
            `Разорвать пакт ${p.name} — ${players[p.pact].name}`,
            () => {
              const ally = players[p.pact!];
              p.stock.splice(0, Math.ceil(p.stock.length / 2));
              ally.pact = null;
              p.pact = null;
              sfx.play('ui');
              showBoard();
            },
            'btn small ghost',
          ),
        );
        continue;
      }
      for (const q of free) {
        if (q.seat <= p.seat) continue;
        rows.push(
          button(
            `Пакт: ${p.name} + ${q.name}`,
            () => {
              p.pact = q.seat;
              q.pact = p.seat;
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
      el('h3', {}, 'Альянсы'),
      el('p', { class: 'hint', style: 'margin-top:0' }, `Пока пакт держится, союзники не могут бить друг друга, а за каждый зачищенный союзником уровень вы получаете карту. Жизни, собранные с клеток, можно отдать союзнику. Разрыв стоит половины запаса и виден всем.`),
      el('div', { class: 'row', style: 'gap:8px' }, ...(rows.length ? rows : [el('span', { class: 'hint' }, 'Все связаны пактами')])),
      giftRow(),
    );
  }

  /** Lives picked up from cells are not spent until your next turn, so up to
   *  then they are transferable — an ally walking into a boss needs them more
   *  than you do. */
  function giftRow(): HTMLElement | null {
    const donors = players.filter((p) => p.pact !== null && p.bonusLives > 0);
    if (!donors.length) return null;

    const give = (from: RacePlayer, n: number): void => {
      const ally = players[from.pact!];
      const moved = Math.min(n, from.bonusLives);
      from.bonusLives -= moved;
      ally.bonusLives += moved;
      sfx.play('powerup');
      showBoard();
    };

    const buttons: HTMLElement[] = [];
    for (const p of donors) {
      const ally = players[p.pact!];
      buttons.push(
        button(`${p.name} → ${ally.name}: 1 жизнь`, () => give(p, 1), 'btn small'),
        button(`${p.name} → ${ally.name}: все ${p.bonusLives}`, () => give(p, p.bonusLives), 'btn small ghost'),
      );
    }
    return el(
      'div',
      { style: 'margin-top:10px' },
      el('p', { class: 'hint', style: 'margin:0 0 6px' }, 'Передать жизни союзнику:'),
      el('div', { class: 'row', style: 'gap:8px' }, ...buttons),
    );
  }

  // --------------------------------------------------------------- a turn --

  function startTurn(): void {
    const p = active();
    const level = levelFor(p);
    clockLimit = Math.max(20, clockSecondsFor(level) + p.bonusSeconds);
    clock = clockLimit;
    livesAtStart = livesFor(level) + p.bonusLives;
    p.bonusSeconds = 0;
    p.bonusLives = 0;
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

  /** A waiting player pressed one of their three keys. */
  function playCard(from: RacePlayer, slot: number): void {
    if (!arena || phase !== 'play' || from.seat === turnSeat) return;
    const id = from.stock[slot];
    if (!id) return;
    const def = CARDS[id];
    const target = active();

    if (!cardAllowed(def, from, target)) {
      note(`${from.name}: пакт не позволяет`, '#5a6472');
      return;
    }

    from.stock.splice(slot, 1);

    // The counter costs the thrower the card anyway — that is what makes
    // baiting the block worth doing.
    if (shieldArmed && def.kind === 'debuff') {
      shieldArmed = false;
      note(`${target.name} отбил ${def.name}`, '#4de2ff');
      fx.text(ARENA_W / 2, 250, 'ОТБИТО', '#4de2ff');
      sfx.play('ui');
      return;
    }

    applyCard(def, from, target);
  }

  function applyCard(def: CardDef, from: RacePlayer, target: RacePlayer): void {
    if (!arena) return;
    switch (def.effect.t) {
      case 'powerup':
        arena.grantPowerup(def.effect.id);
        break;
      case 'debuff':
        arena.applyDebuff(def.effect.id);
        break;
      case 'ball':
        if (arena.balls.length === 0) arena.addBall();
        arena.setBallType(def.effect.id);
        break;
      case 'dice':
        target.diceMod += def.effect.delta;
        break;
      case 'clock':
        clock = Math.max(1, clock + def.effect.delta);
        clockLimit = Math.max(clockLimit, clock);
        break;
    }
    fx.text(ARENA_W / 2, def.kind === 'buff' ? 220 : 260, `${def.icon} ${def.name.toUpperCase()}`, def.color);
    note(`${from.name} → ${def.name}`, def.color);
    sfx.play(def.kind === 'buff' ? 'powerup' : 'garbage');
  }

  function interventionKeys(): void {
    for (const p of players) {
      if (p.seat === turnSeat) continue;
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
    p.turns++;
    if (cleared) p.cleared++;

    const earned = giveCards(p, cardsForTurn(result), rng);
    if (earned > 0) note(`+${earned} карт за зачистку`, '#ffd24d');
    if (cleared && p.pact !== null) giveCards(players[p.pact], ALLY_CARDS, rng);
    app.saveProfile((prof) => (prof.totalXp += Math.round(arena!.xpEarned)));

    if (isFinale(p)) return finishFinale(p, result);

    // Death costs the whole move: no die, no step, straight to the next player.
    if (died) {
      roll = null;
      showRoll();
      return;
    }
    roll = rollDice(rng, result, p.diceMod);
    p.diceMod = 0;
    showRoll();
  }

  function finishFinale(p: RacePlayer, result: TurnResult): void {
    if (result.cleared) {
      phase = 'over';
      sfx.play('levelup');
      app.saveProfile((prof) => (prof.versusWins[0] += 1));
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
        el('h2', { style: `color:${active().accent}`, id: 'move-title' }, headline),
        el('p', { class: 'hint', id: 'move-line' }, `Клетка ${from} → ${to}`),
        buildTrack(),
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
      const outcome = resolveCell(cell.kind, p, players, distance, rng);
      if (outcome.reversed) direction = direction === 1 ? -1 : 1;
      refreshCell(before);
      for (const other of players) refreshCell(other.cell);
      const def = CELL_TYPES[cell.kind];
      sfx.play(outcome.delta < 0 || cell.kind === 'toll' ? 'garbage' : 'powerup');
      setText('move-title', `${def.icon} ${def.name}`, def.color);
      setText('move-line', `${outcome.text}${wasRevealed ? '' : ' · клетка открыта для всех'}`);
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

  function setText(id: string, text: string, color?: string): void {
    const node = app.overlay.querySelector(`#${id}`) as HTMLElement | null;
    if (!node) return;
    node.textContent = text;
    if (color) node.style.color = color;
  }

  function finishMove(): void {
    moveDone = true;
    const p = active();
    const leader = [...players].sort((a, b) => b.cell - a.cell)[0];
    const actions = app.overlay.querySelector('#move-actions');
    if (!actions || actions.childElementCount) return;
    actions.append(
      button('Следующий игрок', nextTurn, 'btn primary'),
      button('В меню', () => app.setScene(mainMenu), 'btn ghost'),
    );
    const line = app.overlay.querySelector('#move-line');
    line?.after(
      el(
        'p',
        { class: 'hint' },
        `${p.name}: клетка ${p.cell} · карт ${p.stock.length}. Впереди ${leader.name} (клетка ${leader.cell}).`,
      ),
    );
  }

  function nextTurn(): void {
    arena = null;
    roll = null;
    moveResolved = false;
    turnSeat = (turnSeat + direction + players.length) % players.length;
    if (turnSeat === 0) round++;
    music.setScene('menu');
    showBoard();
  }

  function showOver(winner: RacePlayer): void {
    const table = [...players].sort((a, b) => b.cell - a.cell);
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${winner.accent}` }, `ПОБЕДА: ${winner.name}`),
        el('p', { class: 'hint' }, `Мега-босс повержен на ${round}-м круге.`),
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
          ctx.fillText('союзник', w - pad, ty);
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
      ctx.fillText('Пробел или клик — дальше', cx, h * 0.72);
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

    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${64 * s}px ${FONT}`;
    ctx.fillText(`ХОД НА ${roll.total}`, cx, by + 58 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `600 ${14 * s}px ${FONT}`;
    ctx.fillText('Пробел или клик — шагаем', cx, by + 92 * s);
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
    startMove(before, to, `${p.name}: ход на ${roll.total}`);
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
        } else if (app.input.anyPressed() || app.input.clicked) {
          advanceFromRoll();
        }
        return;
      }

      if (phase === 'move') {
        stepMove(dt);
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
          if (giveCards(p, 1, rng) > 0) note(`${p.name}: +1 карта в запас`, '#ffd24d');
          else note(`Запас полон (${STOCK_MAX})`, '#5a6472');
        }
      }
      bestCombo = Math.max(bestCombo, arena.combo);

      // The draft freezes the clock: choosing a perk must not cost the turn.
      if (arena.state !== 'levelup' && arena.state !== 'spec') clock -= dt * speed;

      if (arena.state === 'cleared') endTurn(true, false);
      else if (arena.state === 'dead') endTurn(false, true);
      else if (clock <= 0) endTurn(false, false);
    },

    draw(ctx, w, h) {
      if (phase === 'roll') {
        drawRollScreen(ctx, w, h);
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
