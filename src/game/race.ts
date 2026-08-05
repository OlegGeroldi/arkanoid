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
  BOSS_TURN_LIVES,
  BOSS_TURN_SECONDS,
  CARDS,
  CARD_REDRAW,
  FINALE_KNOCKBACK,
  HAND_SIZE,
  IDLE_INFLUENCE,
  JAM_KEY,
  JAM_PER_TURN,
  SEAT_KEYS,
  SEAT_KEY_LABELS,
  TURN_LIVES,
  TURN_SECONDS,
  WORMHOLES,
  cardAllowed,
  cardCost,
  drawCard,
  influenceForTurn,
  levelForCell,
  makeBoard,
  makePlayer,
  resolveWormhole,
  rollDice,
  type CardDef,
  type RacePlayer,
  type Roll,
  type TurnResult,
  type WormholeOutcome,
} from '../core/race';

const HUD_W = 236;
const PANEL_W = 292;
const GAP = 16;
const SCENE_W = PANEL_W + GAP + ARENA_W + GAP + HUD_W;
const SCENE_H = ARENA_H;

export interface RaceOptions {
  names: string[];
  distance: number;
  levels: LevelData[];
  superId: SuperId;
  speed?: number;
}

type Phase = 'board' | 'play' | 'result' | 'over';

interface LogLine {
  text: string;
  color: string;
  t: number;
}

/** Hot-seat race: everyone shares one keyboard, one plays a short level at a
 *  time, and the rest spend influence on that level while it happens. */
export function raceScene(app: App, opts: RaceOptions): Scene {
  const rng = new Rng(Date.now() >>> 0);
  const distance = opts.distance;
  const cells = makeBoard(distance, rng);
  const players = opts.names.map((n, i) => makePlayer(i, n));
  const backdrop = new Backdrop();
  const stepper = new FixedStepper();
  const speed = opts.speed ?? 1;

  let phase: Phase = 'board';
  let turnSeat = 0;
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

  music.setScene('menu');
  fillHands();
  showBoard();

  function active(): RacePlayer {
    return players[turnSeat];
  }

  function isFinale(p: RacePlayer): boolean {
    return p.cell >= distance;
  }

  function note(text: string, color: string): void {
    log.unshift({ text, color, t: 0 });
    if (log.length > 7) log.pop();
  }

  /** Every empty, cooled-down slot draws a new card. */
  function fillHands(): void {
    for (const p of players) {
      for (let i = 0; i < HAND_SIZE; i++) {
        if (p.hand[i] === null && p.cool[i] <= 0) p.hand[i] = drawCard(rng);
      }
    }
  }

  function levelFor(p: RacePlayer): LevelData {
    return opts.levels[levelForCell(p.cell, distance, opts.levels.length)];
  }

  // ------------------------------------------------------------- board UI --

  function showBoard(): void {
    phase = 'board';
    const p = active();
    const level = levelFor(p);
    const finale = isFinale(p);

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
            : `Клетка ${p.cell} из ${distance} · уровень «${level.name}» · ${clockSecondsFor(level)} секунд · ${livesFor(level)} жизни. Сначала уровень, потом кубик.`,
        ),
        p.springDebt
          ? el('p', { class: 'hint', style: 'color:var(--amber)' }, 'Долг катапульты: уровень начнётся с помехой.')
          : null,
        boardTrack(),
        standings(),
        el('h3', { style: 'margin-top:18px' }, 'Кто чем бросается'),
        el('p', { class: 'hint', style: 'margin-top:0' }, 'Пока идёт уровень, каждый ждущий игрок жмёт свои три клавиши. Карта уходит мгновенно — момент решает не меньше, чем сама карта.'),
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

  function clockSecondsFor(level: LevelData): number {
    return level.boss ? BOSS_TURN_SECONDS : TURN_SECONDS;
  }

  function livesFor(level: LevelData): number {
    return level.boss ? BOSS_TURN_LIVES : TURN_LIVES;
  }

  /** The track itself: one chip per cell, wormholes coloured, tokens on top. */
  function boardTrack(): HTMLElement {
    const chips: HTMLElement[] = [];
    for (const cell of cells) {
      const hole = cell.hole && !cell.used ? WORMHOLES[cell.hole] : null;
      const here = players.filter((p) => p.cell === cell.index);
      chips.push(
        el(
          'div',
          {
            class: `racecell${hole ? ' hole' : ''}${cell.index === distance ? ' finish' : ''}`,
            style: hole ? `--hole:${hole.color}` : '',
            title: hole ? `${hole.name}: ${hole.desc}` : `Клетка ${cell.index}`,
          },
          el('span', { class: 'n' }, cell.index === distance ? '☠' : String(cell.index)),
          hole ? el('span', { class: 'icon' }, hole.icon) : null,
          here.length
            ? el(
                'span',
                { class: 'tokens' },
                ...here.map((p) => el('i', { style: `background:${p.accent}` })),
              )
            : null,
        ),
      );
    }
    return el('div', { class: 'racetrack' }, ...chips);
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
          `${p.name} · клетка ${p.cell} · влияние ${p.influence}${p.pact !== null ? ` · пакт с ${players[p.pact].name}` : ''}`,
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
            el('div', { class: 'title', style: `color:${p.accent}` }, `${p.name} · ${p.influence}`),
            ...p.hand.map((id, i) => {
              if (!id) return el('div', { class: 'desc' }, `[${SEAT_KEY_LABELS[p.seat][i]}] — добор`);
              const def = CARDS[id];
              const cost = cardCost(def, p, active());
              const banned = !cardAllowed(def, p, active());
              return el(
                'div',
                { class: 'desc', style: banned ? 'opacity:.4' : '' },
                `[${SEAT_KEY_LABELS[p.seat][i]}] ${def.icon} ${def.name} — ${banned ? 'союзник' : `${cost} влияния`}`,
              );
            }),
          ),
        ),
    );
  }

  /** Pacts are agreed out loud; this only records them. Mutual by construction,
   *  and breaking one is deliberately expensive. */
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
              p.influence = Math.max(0, Math.floor(p.influence / 2));
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
      el('p', { class: 'hint', style: 'margin-top:0' }, 'Пока пакт держится, союзники не бьют друг друга, а бафы союзнику стоят вдвое дешевле. Разрыв стоит половины влияния и виден всем.'),
      el('div', { class: 'row', style: 'gap:8px' }, ...(rows.length ? rows : [el('span', { class: 'hint' }, 'Все связаны пактами')])),
    );
  }

  // --------------------------------------------------------------- a turn --

  function startTurn(): void {
    const p = active();
    const level = levelFor(p);
    clockLimit = clockSecondsFor(level);
    clock = clockLimit;
    livesAtStart = livesFor(level);
    bestCombo = 0;
    jamCharges = JAM_PER_TURN;
    shieldArmed = false;
    paused = false;
    log.length = 0;

    arena = new Arena({
      level,
      superId: opts.superId,
      // Solo drops: the PvP sabotage capsules would charge up with nowhere to
      // fire, since in a race only one field is live at a time.
      mode: 'solo',
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
    const id = from.hand[slot];
    if (!id) return;
    const def = CARDS[id];
    const target = active();

    if (!cardAllowed(def, from, target)) {
      note(`${from.name}: пакт не позволяет`, '#5a6472');
      return;
    }
    const cost = cardCost(def, from, target);
    if (from.influence < cost) {
      note(`${from.name}: не хватает влияния (${cost})`, '#5a6472');
      return;
    }

    from.influence -= cost;
    from.hand[slot] = null;
    from.cool[slot] = CARD_REDRAW;

    // The counter costs the thrower the card and the influence anyway — that is
    // what makes baiting the block worth doing.
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
      case 'tax': {
        const taken = Math.min(target.influence, def.effect.amount);
        target.influence -= taken;
        from.influence += taken;
        break;
      }
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
    };
    p.turns++;
    if (cleared) p.cleared++;

    // Every turn pays: the player from their bricks, the table from waiting.
    p.influence += influenceForTurn(result);
    for (const other of players) if (other !== p) other.influence += IDLE_INFLUENCE;
    app.saveProfile((prof) => (prof.totalXp += Math.round(arena!.xpEarned)));

    if (isFinale(p)) return finishFinale(p, result);

    // Losing the balls costs the whole move: no die, no step.
    const roll = result.died ? null : rollDice(rng, result, p.diceMod);
    p.diceMod = 0;
    const before = p.cell;
    if (roll) p.cell = Math.min(distance, p.cell + roll.total);

    let hole: WormholeOutcome | null = null;
    const cell = cells[p.cell];
    if (roll && cell && cell.hole && !cell.used && p.cell !== distance) {
      cell.used = true;
      hole = resolveWormhole(cell.hole, p, players, distance, rng);
    }
    showResult(result, roll, before, hole, false);
  }

  function finishFinale(p: RacePlayer, result: TurnResult): void {
    if (result.cleared) {
      phase = 'over';
      sfx.play('levelup');
      app.saveProfile((prof) => (prof.versusWins[0] += 1));
      showOver(p);
      return;
    }
    p.cell = Math.max(0, distance - FINALE_KNOCKBACK);
    showResult(result, null, distance, null, true);
  }

  function showResult(
    result: TurnResult,
    roll: Roll | null,
    before: number,
    hole: WormholeOutcome | null,
    knockback: boolean,
  ): void {
    phase = 'result';
    const p = active();
    const lines: string[] = [];

    if (result.died) lines.push('Мячи потеряны — ход сгорел, кубик не бросается.');
    else if (result.cleared) lines.push(`Уровень зачищен за ${Math.round(clockLimit - result.timeLeft)} с.`);
    else lines.push('Время вышло: уровень не добит.');

    if (roll) {
      const bonusText = roll.bonuses.length
        ? roll.bonuses.map((b) => `${b.value > 0 ? '+' : ''}${b.value} ${b.label}`).join(' · ')
        : 'без бонусов';
      lines.push(`Кубик: ${roll.die} · ${bonusText} → ход на ${roll.total}`);
      lines.push(`Клетка ${before} → ${p.cell}`);
    } else if (knockback) {
      lines.push(`Мега-босс устоял: откат на клетку ${p.cell}.`);
    }
    if (hole) lines.push(`${WORMHOLES[hole.kind].icon} ${hole.text}`);

    const leader = [...players].sort((a, b) => b.cell - a.cell)[0];
    lines.push(`Впереди: ${leader.name} (клетка ${leader.cell}). Влияние ${p.name}: ${p.influence}.`);

    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${p.accent}` }, `${p.name}: итог хода`),
        ...lines.map((l) => el('p', { class: 'hint' }, l)),
        el(
          'div',
          { class: 'row', style: 'margin-top:18px' },
          button('Следующий игрок', nextTurn, 'btn primary'),
          button('В меню', () => app.setScene(mainMenu), 'btn ghost'),
        ),
      ),
    );
  }

  function nextTurn(): void {
    arena = null;
    turnSeat = (turnSeat + 1) % players.length;
    if (turnSeat === 0) round++;
    fillHands();
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

    // Turn clock.
    const frac = Math.max(0, clock / clockLimit);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(pad, 34, w - pad * 2, 8, 4);
    ctx.fill();
    ctx.fillStyle = clock < 15 ? '#ff4d6d' : '#3ddc84';
    ctx.beginPath();
    ctx.roundRect(pad, 34, (w - pad * 2) * frac, 8, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(`${Math.ceil(clock)} с до конца хода`, pad, 58);

    ctx.fillStyle = shieldArmed ? '#4de2ff' : 'rgba(255,255,255,0.35)';
    ctx.fillText(shieldArmed ? 'ЩИТ ПОДНЯТ — отобьёт одну карту' : `R — щит (осталось ${jamCharges})`, pad, 74);

    let ty = 98;
    for (const other of players) {
      if (other.seat === turnSeat) continue;
      ctx.fillStyle = other.accent;
      ctx.font = `800 12px ${FONT}`;
      ctx.fillText(`${other.name}`, pad, ty);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText(`${other.influence} влияния`, w - pad, ty);
      ctx.textAlign = 'left';
      ty += 6;

      for (let i = 0; i < HAND_SIZE; i++) {
        ty += 17;
        const id = other.hand[i];
        const key = SEAT_KEY_LABELS[other.seat]?.[i] ?? '?';
        if (!id) {
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.font = `600 11px ${FONT}`;
          ctx.fillText(`${key} — добор ${Math.ceil(other.cool[i])} с`, pad + 4, ty);
          continue;
        }
        const def = CARDS[id];
        const cost = cardCost(def, other, p);
        const banned = !cardAllowed(def, other, p);
        const affordable = other.influence >= cost && !banned;
        ctx.globalAlpha = affordable ? 1 : 0.38;
        ctx.fillStyle = def.color;
        ctx.font = `700 11px ${FONT}`;
        ctx.fillText(`${key}  ${def.icon} ${def.name}`, pad + 4, ty);
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(banned ? 'союзник' : String(cost), w - pad, ty);
        ctx.textAlign = 'left';
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

  return {
    update(dt) {
      t += dt;
      for (const line of log) line.t += dt;
      for (const p of players) {
        for (let i = 0; i < HAND_SIZE; i++) {
          if (p.hand[i] === null && p.cool[i] > 0) {
            p.cool[i] -= dt;
            if (p.cool[i] <= 0) p.hand[i] = drawCard(rng);
          }
        }
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
      bestCombo = Math.max(bestCombo, arena.combo);

      // The draft freezes the clock: choosing a perk must not cost the turn.
      if (arena.state !== 'levelup' && arena.state !== 'spec') clock -= dt * speed;

      if (arena.state === 'cleared') endTurn(true, false);
      else if (arena.state === 'dead') endTurn(false, true);
      else if (clock <= 0) endTurn(false, false);
    },

    draw(ctx, w, h) {
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
