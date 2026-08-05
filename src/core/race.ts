import type { BallTypeId } from './balls';
import type { DebuffId } from './debuffs';
import type { PowerupId } from './powerups';
import type { Rng } from './rng';

/** The board-game race: everybody runs the same campaign, but as a track. You
 *  play a short level against a countdown, roll, move — and while you play, the
 *  others throw cards they earned in their own turns.
 *
 *  This module is the rules only: no DOM, no canvas, no arena. That is also
 *  what the networked version will send over the wire — the whole race state is
 *  a few numbers per player plus one byte per cell, so watchers stay cheap. */

export const RACE_DISTANCES = [20, 50, 100] as const;
export type RaceDistance = (typeof RACE_DISTANCES)[number];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** Seconds a turn starts with, and the longer leash a boss cell gets. The clock
 *  only ever runs down; cards are how you buy it back. */
export const TURN_SECONDS = 75;
export const BOSS_TURN_SECONDS = 130;
export const TURN_LIVES = 2;
export const BOSS_TURN_LIVES = 3;

/** Cards are earned, never regenerated: you catch them at your own paddle and
 *  spend them on other people's turns. Three of your stock sit on your keys. */
export const HAND_SIZE = 3;
export const START_CARDS = 3;
export const STOCK_MAX = 12;
export const CLEAR_CARDS = 2;
export const BOSS_CLEAR_CARDS = 3;
/** An ally's clear pays you one card too — the only standing perk of a pact. */
export const ALLY_CARDS = 1;

export const FINALE_KNOCKBACK = 5;

// ------------------------------------------------------------------ board ---

export type CellKind =
  | 'leap'
  | 'pit'
  | 'roulette'
  | 'swap'
  | 'spring'
  | 'medkit'
  | 'hospital'
  | 'clock'
  | 'stash'
  | 'start'
  | 'reverse'
  | 'toll';

export interface CellDef {
  kind: CellKind;
  name: string;
  icon: string;
  color: string;
  desc: string;
  /** Relative frequency on the board. */
  weight: number;
}

/** Every special cell is face down until somebody lands on it. Once it fires it
 *  stays lit for the rest of the match, for everyone — so the board fills with
 *  known ground, and the dice modifiers on the cards start to mean something:
 *  when you can see the pit at 17, rolling a 4 instead of a 5 is worth buying. */
export const CELL_TYPES: Record<CellKind, CellDef> = {
  leap: { kind: 'leap', name: 'Прыжок', icon: '➤', color: '#3ddc84', desc: 'Бросает вперёд на 3–8 клеток', weight: 3 },
  pit: { kind: 'pit', name: 'Провал', icon: '▼', color: '#ff4d6d', desc: 'Отбрасывает на 2–5 клеток назад', weight: 3 },
  roulette: { kind: 'roulette', name: 'Рулетка', icon: '◆', color: '#ffd24d', desc: 'Далеко вперёд или далеко назад', weight: 2 },
  swap: { kind: 'swap', name: 'Обмен', icon: '⇄', color: '#b06bff', desc: 'Меняет вас местами с ближайшим игроком', weight: 1 },
  spring: { kind: 'spring', name: 'Катапульта', icon: '⇑', color: '#4de2ff', desc: 'Дальний бросок, но следующий уровень начнётся с помехой', weight: 1 },
  medkit: { kind: 'medkit', name: 'Аптечка', icon: '♥', color: '#ff5fa2', desc: '+1 жизнь на следующий ход', weight: 3 },
  hospital: { kind: 'hospital', name: 'Госпиталь', icon: '✚', color: '#ff8fc4', desc: '+3 жизни на следующий ход', weight: 1 },
  clock: { kind: 'clock', name: 'Хронометр', icon: '⏱', color: '#8ef0ff', desc: '+30 секунд к следующему ходу', weight: 2 },
  stash: { kind: 'stash', name: 'Тайник', icon: '🎁', color: '#ffd24d', desc: 'Две карты в запас', weight: 2 },
  start: { kind: 'start', name: 'Обрыв', icon: '⏮', color: '#ff2d55', desc: 'В самое начало трассы', weight: 1 },
  reverse: { kind: 'reverse', name: 'Реверс', icon: '🔄', color: '#c46bff', desc: 'Порядок ходов переворачивается до конца матча', weight: 1 },
  toll: { kind: 'toll', name: 'Мытарь', icon: '⌛', color: '#9fb3c8', desc: '−20 секунд на следующем ходу', weight: 2 },
};

export const CELL_LIST: CellDef[] = Object.values(CELL_TYPES);

export interface RaceCell {
  index: number;
  kind: CellKind | null;
  /** Face down until somebody lands on it; then lit for everyone, forever. */
  revealed: boolean;
}

/** Cells 0..distance. Zero is the start, the last one is the mega-boss and is
 *  never special — the finale should be earned, not teleported past. */
export function makeBoard(distance: number, rng: Rng): RaceCell[] {
  const cells: RaceCell[] = [];
  for (let i = 0; i <= distance; i++) cells.push({ index: i, kind: null, revealed: false });

  const pool: CellKind[] = [];
  for (const def of CELL_LIST) for (let i = 0; i < def.weight; i++) pool.push(def.kind);

  // Denser than a classic board: about one cell in three does something, so a
  // roll is rarely just a step.
  for (let at = 2 + rng.int(0, 2); at < distance; at += 2 + rng.int(0, 3)) {
    cells[at].kind = rng.pick(pool);
  }
  return cells;
}

/** Which campaign level a cell plays. The track is stretched over the whole
 *  campaign, so a blitz race still ends at DOH. */
export function levelForCell(cell: number, distance: number, total: number): number {
  if (distance <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.round((cell / distance) * (total - 1))));
}

// ---------------------------------------------------------------- players ---

/** Three keys per seat. A waiting player owns one row and nothing else, so six
 *  people can share one keyboard without a modal picker in the way. Movement,
 *  serve, super, skill and perk keys are all avoided on purpose. */
export const SEAT_KEYS: string[][] = [
  ['KeyZ', 'KeyX', 'KeyC'],
  ['KeyB', 'KeyN', 'KeyM'],
  ['Digit7', 'Digit8', 'Digit9'],
  ['Digit4', 'Digit5', 'Digit6'],
  ['Comma', 'Period', 'Slash'],
  ['Semicolon', 'Quote', 'Backslash'],
];

export const SEAT_KEY_LABELS: string[][] = [
  ['Z', 'X', 'C'],
  ['B', 'N', 'M'],
  ['7', '8', '9'],
  ['4', '5', '6'],
  [',', '.', '/'],
  [';', "'", '\\'],
];

export const SEAT_COLORS = ['#4de2ff', '#ff5fa2', '#3ddc84', '#ffd24d', '#b06bff', '#ff7a3d'];

/** The key the player under fire uses to shrug off one incoming card. */
export const JAM_KEY = 'KeyR';
export const JAM_PER_TURN = 1;

export interface RacePlayer {
  seat: number;
  name: string;
  accent: string;
  cell: number;
  /** Cards earned and not yet thrown. The first HAND_SIZE sit on the keys. */
  stock: CardId[];
  /** Seat of the ally, or null. A pact is always mutual. */
  pact: number | null;
  /** Waiting on this player's next roll. */
  diceMod: number;
  /** Waiting on this player's next turn. */
  bonusLives: number;
  bonusSeconds: number;
  /** Catapult debt: the next level opens with a debuff. */
  springDebt: boolean;
  turns: number;
  cleared: number;
}

export function makePlayer(seat: number, name: string, rng: Rng): RacePlayer {
  return {
    seat,
    name,
    accent: SEAT_COLORS[seat % SEAT_COLORS.length],
    cell: 0,
    stock: Array.from({ length: START_CARDS }, () => drawCard(rng)),
    pact: null,
    diceMod: 0,
    bonusLives: 0,
    bonusSeconds: 0,
    springDebt: false,
    turns: 0,
    cleared: 0,
  };
}

export function giveCards(p: RacePlayer, n: number, rng: Rng): number {
  let given = 0;
  for (let i = 0; i < n && p.stock.length < STOCK_MAX; i++) {
    p.stock.push(drawCard(rng));
    given++;
  }
  return given;
}

// ------------------------------------------------------------------ cards ---

export type CardId =
  | 'time10'
  | 'time15'
  | 'multiball'
  | 'life'
  | 'lavaball'
  | 'anchor'
  | 'tailwind'
  | 'burn10'
  | 'burn15'
  | 'frost'
  | 'mirror'
  | 'blind'
  | 'steel'
  | 'jam'
  | 'weight';

/** What a card does. Data, so the scene owns every arena call and this module
 *  stays a pure rulebook. */
export type CardEffect =
  | { t: 'powerup'; id: PowerupId }
  | { t: 'debuff'; id: DebuffId }
  | { t: 'ball'; id: BallTypeId }
  | { t: 'dice'; delta: number }
  | { t: 'clock'; delta: number };

export interface CardDef {
  id: CardId;
  name: string;
  icon: string;
  color: string;
  kind: 'buff' | 'debuff';
  desc: string;
  /** Relative frequency in the deck. */
  weight: number;
  effect: CardEffect;
}

/** Fifteen cards, and the two that matter most are the clock: the turn is a
 *  countdown, so seconds are the currency everything else is measured against.
 *  An ally topping you up by 10 and 15 is worth more than any power-up. */
export const CARDS: Record<CardId, CardDef> = {
  time10: { id: 'time10', name: '+10 секунд', icon: '⏱', color: '#3ddc84', kind: 'buff', weight: 5, desc: 'Добавляет 10 секунд к таймеру хода', effect: { t: 'clock', delta: 10 } },
  time15: { id: 'time15', name: '+15 секунд', icon: '⏱', color: '#3ddc84', kind: 'buff', weight: 3, desc: 'Добавляет 15 секунд к таймеру хода', effect: { t: 'clock', delta: 15 } },
  multiball: { id: 'multiball', name: 'Мультимяч', icon: '⁘', color: '#ffd24d', kind: 'buff', weight: 4, desc: '+2 мяча — щедрее всего, когда мяч высоко', effect: { t: 'powerup', id: 'multiball' } },
  life: { id: 'life', name: 'Жизнь', icon: '♥', color: '#ff5fa2', kind: 'buff', weight: 3, desc: '+1 жизнь прямо сейчас', effect: { t: 'powerup', id: 'life' } },
  lavaball: { id: 'lavaball', name: 'Лава-болл', icon: '🔥', color: '#ff6a2b', kind: 'buff', weight: 3, desc: 'Мяч прошивает кирпичи', effect: { t: 'ball', id: 'lava' } },
  anchor: { id: 'anchor', name: 'Опора', icon: '⬌', color: '#4de2ff', kind: 'buff', weight: 4, desc: 'Ракетка шире', effect: { t: 'powerup', id: 'expand' } },
  tailwind: { id: 'tailwind', name: 'Попутный ветер', icon: '⇢', color: '#3ddc84', kind: 'buff', weight: 3, desc: '+1 к его броску кубика', effect: { t: 'dice', delta: 1 } },

  burn10: { id: 'burn10', name: '−10 секунд', icon: '⌛', color: '#ff4d6d', kind: 'debuff', weight: 5, desc: 'Сжигает 10 секунд таймера', effect: { t: 'clock', delta: -10 } },
  burn15: { id: 'burn15', name: '−15 секунд', icon: '⌛', color: '#ff4d6d', kind: 'debuff', weight: 3, desc: 'Сжигает 15 секунд таймера', effect: { t: 'clock', delta: -15 } },
  frost: { id: 'frost', name: 'Мороз', icon: '❄', color: '#8ef0ff', kind: 'debuff', weight: 4, desc: 'Ракетка еле ползёт', effect: { t: 'debuff', id: 'frost' } },
  mirror: { id: 'mirror', name: 'Зеркало', icon: '↔', color: '#ff5fa2', kind: 'debuff', weight: 4, desc: 'Управление наоборот', effect: { t: 'debuff', id: 'mirror' } },
  blind: { id: 'blind', name: 'Помехи', icon: '▓', color: '#5a6472', kind: 'debuff', weight: 3, desc: 'Поле заливает рябью', effect: { t: 'debuff', id: 'blind' } },
  steel: { id: 'steel', name: 'Стальной ряд', icon: '▦', color: '#9fb3c8', kind: 'debuff', weight: 3, desc: 'Сверху падает ряд стали', effect: { t: 'debuff', id: 'steel' } },
  jam: { id: 'jam', name: 'Глушилка', icon: '⌁', color: '#ffd24d', kind: 'debuff', weight: 3, desc: 'Скиллы уходят на перезарядку', effect: { t: 'debuff', id: 'jam' } },
  weight: { id: 'weight', name: 'Гиря', icon: '⚓', color: '#9fb3c8', kind: 'debuff', weight: 3, desc: '−1 к его броску кубика', effect: { t: 'dice', delta: -1 } },
};

export const CARD_LIST: CardDef[] = Object.values(CARDS);

const CARD_POOL: CardId[] = CARD_LIST.flatMap((def) => Array.from({ length: def.weight }, () => def.id));

export function drawCard(rng: Rng): CardId {
  return rng.pick(CARD_POOL);
}

/** A pact bans hitting your ally outright: buffs only, or the pact means
 *  nothing. There is no price on a card beyond having earned it. */
export function cardAllowed(def: CardDef, from: RacePlayer, to: RacePlayer): boolean {
  return !(from.pact === to.seat && def.kind === 'debuff');
}

// ------------------------------------------------------------------- dice ---

export interface TurnResult {
  cleared: boolean;
  died: boolean;
  /** Seconds left on the turn clock. */
  timeLeft: number;
  timeLimit: number;
  livesLost: number;
  bestCombo: number;
  bricks: number;
  boss: boolean;
}

export interface RollBonus {
  label: string;
  value: number;
}

/** What the level earned you on top of the d6. Skill drives the race; the die
 *  only colours it. */
export function playBonuses(r: TurnResult, diceMod: number): RollBonus[] {
  const out: RollBonus[] = [];
  if (r.cleared) {
    out.push({ label: 'уровень зачищен', value: 2 });
    if (r.timeLeft > r.timeLimit * 0.4) out.push({ label: 'с запасом времени', value: 2 });
    if (r.livesLost === 0) out.push({ label: 'без потерь', value: 1 });
    if (r.bestCombo >= 8) out.push({ label: `серия ×${r.bestCombo}`, value: 1 });
  } else if (!r.died) {
    out.push({ label: 'не успел', value: -1 });
  }
  if (diceMod !== 0) out.push({ label: diceMod > 0 ? 'попутный ветер' : 'гиря', value: diceMod });
  return out;
}

export interface Roll {
  die: number;
  bonuses: RollBonus[];
  total: number;
  line: string;
}

/** Four readings per face, drawn at random. The die is the loudest moment of
 *  the turn and it deserves a voice. */
export const DIE_LINES: string[][] = [
  ['Единица. Трасса смеётся.', 'Один шаг. Символический.', 'Кубик показал минимум и не извинился.', 'Единица — это тоже движение. Формально.'],
  ['Двойка. Скромно, но честно.', 'Два шага, полёта нет.', 'Двойка: ни туда ни сюда.', 'Кубик выдал двойку и отвернулся.'],
  ['Тройка. Рабочий ход.', 'Три — без подвига, но и без позора.', 'Тройка. Идём дальше.', 'Кубик отмерил три и успокоился.'],
  ['Четвёрка. Уже разговор.', 'Четыре шага вперёд.', 'Четвёрка — крепкий бросок.', 'Кубик расщедрился на четыре.'],
  ['Пятёрка! Почти праздник.', 'Пять шагов — соперники напряглись.', 'Пятёрка. Хороший день.', 'Кубик лёг пятёркой вверх.'],
  ['ШЕСТЬ! Кубик на вашей стороне.', 'Шестёрка — максимум, и он ваш.', 'Шесть. Вот это ход.', 'Кубик выложился полностью: шесть.'],
];

export function dieLine(rng: Rng, die: number): string {
  return rng.pick(DIE_LINES[Math.min(5, Math.max(0, die - 1))]);
}

/** Death costs the whole move. Anything else advances at least one cell, so a
 *  bad level never freezes you in place. */
export function rollDice(rng: Rng, r: TurnResult, diceMod: number): Roll {
  const die = rng.int(1, 7);
  const bonuses = playBonuses(r, diceMod);
  const sum = bonuses.reduce((a, b) => a + b.value, 0);
  return { die, bonuses, total: Math.max(1, die + sum), line: dieLine(rng, die) };
}

/** Cards the turn itself paid out, on top of the ones caught at the paddle. */
export function cardsForTurn(r: TurnResult): number {
  if (!r.cleared) return 0;
  return r.boss ? BOSS_CLEAR_CARDS : CLEAR_CARDS;
}

// ------------------------------------------------------------------ cells ---

export interface CellOutcome {
  kind: CellKind;
  /** Cells moved, signed. */
  delta: number;
  swappedWith: number | null;
  /** True when the turn order flipped. */
  reversed: boolean;
  text: string;
}

/** Resolves the cell the player just landed on, mutating positions and the
 *  player's pending bonuses. Revealing is the caller's job. */
export function resolveCell(
  kind: CellKind,
  player: RacePlayer,
  players: RacePlayer[],
  distance: number,
  rng: Rng,
): CellOutcome {
  const def = CELL_TYPES[kind];
  const base: CellOutcome = { kind, delta: 0, swappedWith: null, reversed: false, text: def.name };
  const clampCell = (c: number): number => Math.min(distance, Math.max(0, c));

  switch (kind) {
    case 'swap': {
      let best: RacePlayer | null = null;
      for (const p of players) {
        if (p === player) continue;
        if (!best || Math.abs(p.cell - player.cell) < Math.abs(best.cell - player.cell)) best = p;
      }
      if (!best) return { ...base, text: 'Обмен: меняться не с кем' };
      const from = player.cell;
      player.cell = best.cell;
      best.cell = from;
      return { ...base, delta: player.cell - from, swappedWith: best.seat, text: `Обмен местами с ${best.name}` };
    }
    case 'medkit':
      player.bonusLives += 1;
      return { ...base, text: 'Аптечка: +1 жизнь на следующий ход' };
    case 'hospital':
      player.bonusLives += 3;
      return { ...base, text: 'Госпиталь: +3 жизни на следующий ход' };
    case 'clock':
      player.bonusSeconds += 30;
      return { ...base, text: 'Хронометр: +30 секунд к следующему ходу' };
    case 'toll':
      player.bonusSeconds -= 20;
      return { ...base, text: 'Мытарь: −20 секунд на следующем ходу' };
    case 'stash':
      giveCards(player, 2, rng);
      return { ...base, text: 'Тайник: две карты в запас' };
    case 'reverse':
      return { ...base, reversed: true, text: 'Реверс: порядок ходов перевёрнут' };
    case 'start': {
      const before = player.cell;
      player.cell = 0;
      return { ...base, delta: -before, text: 'Обрыв: обратно на старт' };
    }
    default: {
      let delta: number;
      if (kind === 'leap') delta = rng.int(3, 9);
      else if (kind === 'pit') delta = -rng.int(2, 6);
      else if (kind === 'spring') delta = rng.int(6, 13);
      else delta = rng.chance(0.5) ? rng.int(4, 11) : -rng.int(4, 11);

      const before = player.cell;
      player.cell = clampCell(player.cell + delta);
      const moved = player.cell - before;
      if (kind === 'spring') player.springDebt = true;

      return {
        ...base,
        delta: moved,
        text:
          moved === 0
            ? `${def.name}: дальше некуда`
            : moved > 0
              ? `${def.name}: вперёд на ${moved}`
              : `${def.name}: назад на ${-moved}`,
      };
    }
  }
}
