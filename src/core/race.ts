import type { BallTypeId } from './balls';
import type { DebuffId } from './debuffs';
import type { PowerupId } from './powerups';
import type { Rng } from './rng';

/** The board-game race: everybody runs the same campaign, but as a track. You
 *  play a short level, roll, move — and while you play, everyone else spends
 *  influence on helping or wrecking you. This module is the rules only: no DOM,
 *  no canvas, no arena. The scene owns those. */

export const RACE_DISTANCES = [20, 50, 100] as const;
export type RaceDistance = (typeof RACE_DISTANCES)[number];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** Seconds a normal turn lasts, and the longer leash a boss cell gets. */
export const TURN_SECONDS = 75;
export const BOSS_TURN_SECONDS = 130;
export const TURN_LIVES = 2;
export const BOSS_TURN_LIVES = 3;

/** Cards land instantly, so a hand that never runs dry would let one player
 *  bury the runner. A played slot stays empty this long before it refills. */
export const CARD_REDRAW = 7;
export const HAND_SIZE = 3;

/** Failing the mega-boss throws you back this far — the race stays open until
 *  somebody actually kills it. */
export const FINALE_KNOCKBACK = 5;

// ------------------------------------------------------------------ board ---

export type WormholeKind = 'leap' | 'pit' | 'roulette' | 'swap' | 'spring';

export interface WormholeDef {
  kind: WormholeKind;
  name: string;
  icon: string;
  color: string;
  desc: string;
}

export const WORMHOLES: Record<WormholeKind, WormholeDef> = {
  leap: { kind: 'leap', name: 'Прыжок', icon: '➤', color: '#3ddc84', desc: 'Бросает вперёд на 3-8 клеток' },
  pit: { kind: 'pit', name: 'Провал', icon: '▼', color: '#ff4d6d', desc: 'Отбрасывает на 2-5 клеток назад' },
  roulette: { kind: 'roulette', name: 'Рулетка', icon: '◆', color: '#ffd24d', desc: 'Далеко вперёд или далеко назад' },
  swap: { kind: 'swap', name: 'Обмен', icon: '⇄', color: '#b06bff', desc: 'Меняет вас местами с ближайшим игроком' },
  spring: {
    kind: 'spring',
    name: 'Катапульта',
    icon: '⇑',
    color: '#4de2ff',
    desc: 'Дальний бросок, но следующий уровень начнётся с помехой',
  },
};

export interface RaceCell {
  index: number;
  hole: WormholeKind | null;
  /** Wormholes are single-use: the first player through burns it. */
  used: boolean;
}

/** Cells 0..distance. Zero is the start, the last one is the mega-boss and
 *  never carries a wormhole — the finale should be earned, not teleported to. */
export function makeBoard(distance: number, rng: Rng): RaceCell[] {
  const cells: RaceCell[] = [];
  for (let i = 0; i <= distance; i++) cells.push({ index: i, hole: null, used: false });

  const kinds: WormholeKind[] = ['leap', 'leap', 'leap', 'pit', 'pit', 'pit', 'roulette', 'roulette', 'swap', 'spring'];
  for (let at = 3 + rng.int(0, 2); at < distance; at += 3 + rng.int(0, 3)) {
    cells[at].hole = rng.pick(kinds);
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
  influence: number;
  /** Cards in hand; null means the slot is refilling. */
  hand: (CardId | null)[];
  /** Seconds left before an empty slot draws again. */
  cool: number[];
  /** Seat of the ally, or null. A pact is always mutual. */
  pact: number | null;
  /** Dice modifier waiting to be spent on this player's next roll. */
  diceMod: number;
  /** Catapult debt: the next level opens with a debuff. */
  springDebt: boolean;
  /** Turns played, for the closing table. */
  turns: number;
  cleared: number;
}

export function makePlayer(seat: number, name: string): RacePlayer {
  return {
    seat,
    name,
    accent: SEAT_COLORS[seat % SEAT_COLORS.length],
    cell: 0,
    influence: 10,
    hand: new Array(HAND_SIZE).fill(null),
    cool: new Array(HAND_SIZE).fill(0),
    pact: null,
    diceMod: 0,
    springDebt: false,
    turns: 0,
    cleared: 0,
  };
}

// ------------------------------------------------------------------ cards ---

export type CardId =
  | 'multiball'
  | 'expand'
  | 'laser'
  | 'life'
  | 'slow'
  | 'energy'
  | 'lavaball'
  | 'tailwind'
  | 'frost'
  | 'mirror'
  | 'haste'
  | 'blind'
  | 'steel'
  | 'jam'
  | 'quake'
  | 'shrink'
  | 'weight'
  | 'tax';

/** What a card actually does. Kept as data so the scene owns every arena call
 *  and this module stays testable on its own. */
export type CardEffect =
  | { t: 'powerup'; id: PowerupId }
  | { t: 'debuff'; id: DebuffId }
  | { t: 'ball'; id: BallTypeId }
  | { t: 'dice'; delta: number }
  | { t: 'tax'; amount: number };

export interface CardDef {
  id: CardId;
  name: string;
  icon: string;
  color: string;
  /** Influence it costs to play. */
  cost: number;
  kind: 'buff' | 'debuff';
  desc: string;
  effect: CardEffect;
}

/** Eighteen cards. Most reuse effects the game already has — the interesting
 *  ones are the last three, which hit the dice and the economy instead of the
 *  ball, and so only make sense on a board. */
export const CARDS: Record<CardId, CardDef> = {
  multiball: { id: 'multiball', name: 'Мультимяч', icon: '⁘', color: '#ffd24d', cost: 7, kind: 'buff', desc: '+2 мяча — щедрее всего, когда мяч высоко', effect: { t: 'powerup', id: 'multiball' } },
  expand: { id: 'expand', name: 'Расширение', icon: '⬌', color: '#4de2ff', cost: 4, kind: 'buff', desc: 'Ракетка шире', effect: { t: 'powerup', id: 'expand' } },
  laser: { id: 'laser', name: 'Лазер', icon: '↑', color: '#ff7a3d', cost: 6, kind: 'buff', desc: 'Ракетка стреляет', effect: { t: 'powerup', id: 'laser' } },
  life: { id: 'life', name: 'Жизнь', icon: '♥', color: '#ff5fa2', cost: 9, kind: 'buff', desc: '+1 жизнь на этот ход', effect: { t: 'powerup', id: 'life' } },
  slow: { id: 'slow', name: 'Замедление', icon: '≈', color: '#7c6cff', cost: 5, kind: 'buff', desc: 'Мячи успокаиваются', effect: { t: 'powerup', id: 'slow' } },
  energy: { id: 'energy', name: 'Энергия', icon: '⚡', color: '#b06bff', cost: 5, kind: 'buff', desc: '+35 к заряду супера', effect: { t: 'powerup', id: 'energy' } },
  lavaball: { id: 'lavaball', name: 'Лава-болл', icon: '🔥', color: '#ff6a2b', cost: 8, kind: 'buff', desc: 'Мяч прошивает кирпичи', effect: { t: 'ball', id: 'lava' } },
  tailwind: { id: 'tailwind', name: 'Попутный ветер', icon: '⇢', color: '#3ddc84', cost: 6, kind: 'buff', desc: '+1 к его броску кубика', effect: { t: 'dice', delta: 1 } },

  frost: { id: 'frost', name: 'Мороз', icon: '❄', color: '#8ef0ff', cost: 6, kind: 'debuff', desc: 'Ракетка еле ползёт', effect: { t: 'debuff', id: 'frost' } },
  mirror: { id: 'mirror', name: 'Зеркало', icon: '↔', color: '#ff5fa2', cost: 7, kind: 'debuff', desc: 'Управление наоборот', effect: { t: 'debuff', id: 'mirror' } },
  haste: { id: 'haste', name: 'Разгон', icon: '≫', color: '#ff4d6d', cost: 6, kind: 'debuff', desc: 'Мяч срывается с цепи', effect: { t: 'debuff', id: 'haste' } },
  blind: { id: 'blind', name: 'Помехи', icon: '▓', color: '#5a6472', cost: 7, kind: 'debuff', desc: 'Поле заливает рябью', effect: { t: 'debuff', id: 'blind' } },
  steel: { id: 'steel', name: 'Стальной ряд', icon: '▦', color: '#9fb3c8', cost: 9, kind: 'debuff', desc: 'Сверху падает ряд стали', effect: { t: 'debuff', id: 'steel' } },
  jam: { id: 'jam', name: 'Глушилка', icon: '⌁', color: '#ffd24d', cost: 7, kind: 'debuff', desc: 'Скиллы уходят на перезарядку', effect: { t: 'debuff', id: 'jam' } },
  quake: { id: 'quake', name: 'Толчок', icon: '⇊', color: '#3ddc84', cost: 8, kind: 'debuff', desc: 'Поле оседает на ряд вниз', effect: { t: 'debuff', id: 'quake' } },
  shrink: { id: 'shrink', name: 'Сжатие', icon: '⬍', color: '#ff4d6d', cost: 5, kind: 'debuff', desc: 'Ракетка уже', effect: { t: 'powerup', id: 'shrink' } },
  weight: { id: 'weight', name: 'Гиря', icon: '⚓', color: '#9fb3c8', cost: 6, kind: 'debuff', desc: '−1 к его броску кубика', effect: { t: 'dice', delta: -1 } },
  tax: { id: 'tax', name: 'Пошлина', icon: '◍', color: '#c46bff', cost: 5, kind: 'debuff', desc: 'Снимает 4 влияния в вашу пользу', effect: { t: 'tax', amount: 4 } },
};

export const CARD_LIST: CardDef[] = Object.values(CARDS);

export function drawCard(rng: Rng): CardId {
  return rng.pick(CARD_LIST).id;
}

/** Half price for helping an ally — the only mechanical teeth a pact has, and
 *  enough to make one worth offering. */
export function cardCost(def: CardDef, from: RacePlayer, to: RacePlayer): number {
  const allied = from.pact === to.seat;
  return allied && def.kind === 'buff' ? Math.ceil(def.cost / 2) : def.cost;
}

/** A pact bans hitting your ally outright: buffs only, or the pact means
 *  nothing. */
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
}

/** Death costs the whole move. Anything else advances at least one cell, so a
 *  bad level never freezes you in place. */
export function rollDice(rng: Rng, r: TurnResult, diceMod: number): Roll {
  const die = rng.int(1, 7);
  const bonuses = playBonuses(r, diceMod);
  const sum = bonuses.reduce((a, b) => a + b.value, 0);
  return { die, bonuses, total: r.died ? 0 : Math.max(1, die + sum) };
}

/** Influence earned by the turn. The player at the table earns from the bricks
 *  they break; everyone waiting earns a flat wage, or they would be spectators
 *  with empty pockets. */
export function influenceForTurn(r: TurnResult): number {
  return 2 + Math.floor(r.bricks / 8) + (r.cleared ? 4 : 0);
}

export const IDLE_INFLUENCE = 5;

// -------------------------------------------------------------- wormholes ---

export interface WormholeOutcome {
  kind: WormholeKind;
  /** Cells moved, signed. */
  delta: number;
  /** Seat swapped with, for the 'swap' hole. */
  swappedWith: number | null;
  text: string;
}

/** Resolves the hole the player just landed on, mutating positions. */
export function resolveWormhole(
  kind: WormholeKind,
  player: RacePlayer,
  players: RacePlayer[],
  distance: number,
  rng: Rng,
): WormholeOutcome {
  const clampCell = (c: number): number => Math.min(distance, Math.max(0, c));

  if (kind === 'swap') {
    let best: RacePlayer | null = null;
    for (const p of players) {
      if (p === player) continue;
      if (!best || Math.abs(p.cell - player.cell) < Math.abs(best.cell - player.cell)) best = p;
    }
    if (!best) return { kind, delta: 0, swappedWith: null, text: 'Меняться не с кем' };
    const from = player.cell;
    player.cell = best.cell;
    best.cell = from;
    return {
      kind,
      delta: player.cell - from,
      swappedWith: best.seat,
      text: `Обмен местами с ${best.name}`,
    };
  }

  let delta: number;
  if (kind === 'leap') delta = rng.int(3, 9);
  else if (kind === 'pit') delta = -rng.int(2, 6);
  else if (kind === 'spring') delta = rng.int(6, 13);
  else delta = rng.chance(0.5) ? rng.int(4, 11) : -rng.int(4, 11);

  const before = player.cell;
  player.cell = clampCell(player.cell + delta);
  const moved = player.cell - before;
  if (kind === 'spring') player.springDebt = true;

  const w = WORMHOLES[kind];
  return {
    kind,
    delta: moved,
    swappedWith: null,
    text:
      moved === 0
        ? `${w.name}: дальше некуда`
        : moved > 0
          ? `${w.name}: вперёд на ${moved}`
          : `${w.name}: назад на ${-moved}`,
  };
}
