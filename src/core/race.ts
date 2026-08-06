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
/** An ally's clear pays every teammate a card — the standing perk of a union. */
export const ALLY_CARDS = 1;

/** Letters shown for teams. Six seats can split at most three ways and still
 *  be a race rather than a duel of blocks. */
export const TEAM_LABELS = ['A', 'B', 'C'];
export const TEAM_COLORS = ['#4de2ff', '#ff5fa2', '#3ddc84'];

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
  /** Union this player belongs to, or null for a lone racer. Two seats sharing
   *  a team are allies; a team may hold three, which is what makes 3-on-3 over
   *  the network a thing rather than two duels. */
  team: number | null;
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
    team: null,
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

/** Teammates cannot hit each other: buffs only, or a union means nothing. There
 *  is no price on a card beyond having earned it. */
export function allied(a: RacePlayer, b: RacePlayer): boolean {
  return a !== b && a.team !== null && a.team === b.team;
}

export function teammates(players: RacePlayer[], p: RacePlayer): RacePlayer[] {
  return players.filter((q) => allied(p, q));
}

export function cardAllowed(def: CardDef, from: RacePlayer, to: RacePlayer): boolean {
  return !(allied(from, to) && def.kind === 'debuff');
}

/** The smallest free team number, or null when all three are taken. */
export function freeTeam(players: RacePlayer[]): number | null {
  for (let i = 0; i < TEAM_LABELS.length; i++) {
    if (!players.some((p) => p.team === i)) return i;
  }
  return null;
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

/** Scores a die that has already been thrown. Over the network the die comes
 *  from the server, and every client has to arrive at the same total — so the
 *  scoring lives here, apart from the throwing. */
export function makeRoll(die: number, rng: Rng, r: TurnResult, diceMod: number): Roll {
  const bonuses = playBonuses(r, diceMod);
  const sum = bonuses.reduce((a, b) => a + b.value, 0);
  return { die, bonuses, total: Math.max(1, die + sum), line: dieLine(rng, die) };
}

/** Death costs the whole move. Anything else advances at least one cell, so a
 *  bad level never freezes you in place. */
export function rollDice(rng: Rng, r: TurnResult, diceMod: number): Roll {
  return makeRoll(rng.int(1, 7), rng, r, diceMod);
}

/** Cards handed out by a turn, per seat. Over the network these are drawn by
 *  the client that played the turn and travel as plain ids: card draws must not
 *  come off the shared random stream, or a capsule caught on one screen would
 *  desync every other one. */
export interface TurnAward {
  seat: number;
  cards: CardId[];
}

/** The turn result as it goes over the wire: what the level did, plus the cards
 *  it paid out. */
export interface TurnReport extends TurnResult {
  awards: TurnAward[];
}

/** Cards the turn itself paid out, on top of the ones caught at the paddle. */
export function cardsForTurn(r: TurnResult): number {
  if (!r.cleared) return 0;
  return r.boss ? BOSS_CLEAR_CARDS : CLEAR_CARDS;
}

// ------------------------------------------------------------- commentary ---

/** Positions before the move, seat -> cell. */
export type Standings = Map<number, number>;

export function snapshot(players: RacePlayer[]): Standings {
  return new Map(players.map((p) => [p.seat, p.cell]));
}

// Player names are free text, so no line may bend one into another case or
// assume a gender: every template keeps the name in the nominative and builds
// the sentence around it. "Обходит Машу" would need declension we cannot do.
// Numbers do have to agree, though, hence the two forms of "клетка".
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** "на 1 клетку", "на 2 клетки", "на 5 клеток" */
const cellsAcc = (n: number): string => `${n} ${plural(n, 'клетку', 'клетки', 'клеток')}`;
/** "осталась 1 клетка", "осталось 5 клеток" */
const cellsNom = (n: number): string => `${n} ${plural(n, 'клетка', 'клетки', 'клеток')}`;

const LEAD_TAKEN = [
  (x: string, y: string) => `${x} выходит вперёд, ${y} — на вторую строчку`,
  (x: string, y: string) => `Лидер сменился: впереди ${x}, следом ${y}`,
  (x: string, y: string) => `Первая строчка — ${x}. ${y} уступает`,
  (x: string) => `${x} возглавляет гонку`,
];

const LEAD_KEPT = [
  (x: string, n: number) => `${x} отрывается на ${cellsAcc(n)}`,
  (x: string, n: number) => `Отрыв растёт — ${x} впереди на ${cellsAcc(n)}`,
  (x: string, n: number) => `${x} идёт первым: преимущество в ${cellsAcc(n)}`,
];

const OVERTAKE = [
  (x: string, y: string) => `${x} обгоняет — ${y} остаётся позади`,
  (x: string, y: string) => `Позиции поменялись: ${x} выше, ${y} ниже`,
  (x: string, y: string) => `${x} проходит вперёд, ${y} пропускает`,
];

const TO_LAST = [
  (x: string) => `${x} теперь замыкает гонку`,
  (x: string) => `${x} становится самым последним`,
  (x: string) => `Последняя строчка — ${x}`,
];

const OFF_LAST = [
  (x: string) => `${x} выбирается с последнего места`,
  (x: string) => `${x} больше не замыкает таблицу`,
];

const BEHIND = [
  (x: string, y: string, n: number) => `${x} позади на ${cellsAcc(n)}, впереди ${y}`,
  (x: string, y: string, n: number) => `Отставание в ${cellsAcc(n)}: лидер ${y}, следом ${x}`,
];

const LEAD_THIN = [
  (x: string, n: number) => `${x} первый, но отрыв всего ${cellsNom(n)}`,
  (x: string, n: number) => `${x} впереди — преимущество пока ${cellsNom(n)}`,
];

const TIED = [
  (x: string, y: string) => `${x} и ${y} на одной клетке — ноздря в ноздрю`,
  (x: string, y: string) => `Одна клетка на двоих: ${x} и ${y}`,
];

const SETBACK = [
  (x: string, n: number) => `${x} — назад на ${cellsAcc(n)}`,
  (x: string, n: number) => `Откат: ${x} теряет ${cellsAcc(n)}`,
  (x: string, n: number) => `Трасса наказывает: ${x} минус ${cellsAcc(n)}`,
];

const SURGE = [
  (x: string, n: number) => `${x} прыгает вперёд сразу на ${cellsAcc(n)}`,
  (x: string, n: number) => `Сразу на ${cellsAcc(n)} — это ${x}`,
];

const HALFWAY = [
  (x: string) => `${x}: половина трассы позади`,
  (x: string) => `Половина трассы пройдена: ${x}`,
];

const NEAR_END = [
  (x: string, n: number) => `${x} — до мега-босса ${cellsNom(n)}`,
  (x: string, n: number) => `${x} уже видит DOH: осталось ${cellsNom(n)}`,
];

const AT_END = [
  (x: string) => `${x} на последней клетке — следующий ход за мега-босса`,
  (x: string) => `${x} у самого DOH. Дальше только он`,
];

/** What the table looks like after a move, said out loud. Positions are
 *  compared with the snapshot taken before the turn, so a swap or a pit shows
 *  up here as readily as a good roll.
 *
 *  Only a couple of lines come back: a commentator who says everything says
 *  nothing. */
export function raceComments(
  before: Standings,
  players: RacePlayer[],
  mover: RacePlayer,
  distance: number,
  rng: Rng,
): string[] {
  const out: string[] = [];
  const name = (p: RacePlayer): string => p.name;
  const rank = (cells: Standings): RacePlayer[] =>
    [...players].sort((a, b) => (cells.get(b.seat) ?? 0) - (cells.get(a.seat) ?? 0));

  const now = snapshot(players);
  const wasOrder = rank(before);
  const nowOrder = rank(now);
  const delta = (now.get(mover.seat) ?? 0) - (before.get(mover.seat) ?? 0);

  // A change at the top always leads.
  if (nowOrder[0] === mover && wasOrder[0] !== mover) {
    out.push(rng.pick(LEAD_TAKEN)(name(mover), name(wasOrder[0])));
  } else if (nowOrder[0] === mover && nowOrder.length > 1) {
    const gap = mover.cell - nowOrder[1].cell;
    if (gap >= 3) out.push(rng.pick(LEAD_KEPT)(name(mover), gap));
  } else {
    // Whoever the mover physically passed this turn.
    const passed = players.filter(
      (p) =>
        p !== mover &&
        (before.get(mover.seat) ?? 0) <= (before.get(p.seat) ?? 0) &&
        mover.cell > p.cell,
    );
    if (passed.length) out.push(rng.pick(OVERTAKE)(name(mover), name(rng.pick(passed))));
  }

  // Movement worth remarking on by itself.
  if (delta <= -4) out.push(rng.pick(SETBACK)(name(mover), -delta));
  else if (delta >= 7) out.push(rng.pick(SURGE)(name(mover), delta));

  // The bottom of the table.
  const wasLast = wasOrder[wasOrder.length - 1];
  const nowLast = nowOrder[nowOrder.length - 1];
  if (nowLast !== wasLast) {
    if (nowLast === mover) out.push(rng.pick(TO_LAST)(name(mover)));
    else if (wasLast === mover) out.push(rng.pick(OFF_LAST)(name(mover)));
    else out.push(rng.pick(TO_LAST)(name(nowLast)));
  }

  // Milestones, only the first time they are crossed.
  const half = Math.floor(distance / 2);
  if ((before.get(mover.seat) ?? 0) < half && mover.cell >= half && mover.cell < distance) {
    out.push(rng.pick(HALFWAY)(name(mover)));
  }
  if (mover.cell >= distance) {
    out.push(rng.pick(AT_END)(name(mover)));
  } else if (distance - mover.cell <= 5 && distance - (before.get(mover.seat) ?? 0) > 5) {
    out.push(rng.pick(NEAR_END)(name(mover), distance - mover.cell));
  }

  // Nothing dramatic? Then just place the mover in the field — a commentator
  // who goes silent on the opening turn reads as broken.
  if (!out.length) {
    const leader = nowOrder[0];
    const tiedWith = players.find((p) => p !== mover && p.cell === mover.cell);
    if (tiedWith) out.push(rng.pick(TIED)(name(mover), name(tiedWith)));
    else if (leader !== mover) out.push(rng.pick(BEHIND)(name(mover), name(leader), leader.cell - mover.cell));
    else if (nowOrder.length > 1) out.push(rng.pick(LEAD_THIN)(name(mover), mover.cell - nowOrder[1].cell));
  }

  return out.slice(0, 3);
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
