/** Brick catalogue. The single-character `code` is what levels are stored as,
 *  which keeps level JSON readable and hand-editable. */
export type BrickCode = 'n' | 't' | 's' | 'x' | 'e' | 'r' | 'g' | 'p' | 'b' | 'k';

export interface BrickKind {
  code: BrickCode;
  name: string;
  hp: number; // -1 = indestructible
  color: string;
  /** XP awarded on destruction, before combo/perk multipliers. */
  xp: number;
  /** Multiplier on the power-up drop roll. */
  dropMul: number;
  explodes?: boolean;
  /** Seconds until a destroyed brick comes back (regenerating type). */
  regen?: number;
  /** How many times it may come back before it stays dead. */
  regenLimit?: number;
  /** Always drops a power-up. */
  gift?: boolean;
  desc: string;
}

export const BRICK_KINDS: Record<BrickCode, BrickKind> = {
  n: { code: 'n', name: 'Normal', hp: 1, color: '#4de2ff', xp: 10, dropMul: 1, desc: 'Breaks in one hit' },
  t: { code: 't', name: 'Tough', hp: 2, color: '#7c6cff', xp: 22, dropMul: 1.2, desc: 'Two hits' },
  s: { code: 's', name: 'Steel', hp: 3, color: '#9fb3c8', xp: 40, dropMul: 1.5, desc: 'Three hits' },
  x: { code: 'x', name: 'Unbreakable', hp: -1, color: '#5a6472', xp: 0, dropMul: 0, desc: 'Never breaks — an obstacle only' },
  e: { code: 'e', name: 'Explosive', hp: 1, color: '#ff7a3d', xp: 26, dropMul: 1, explodes: true, desc: 'Explodes and takes out neighbors' },
  r: {
    code: 'r',
    name: 'Regenerator',
    hp: 2,
    color: '#3ddc84',
    xp: 30,
    dropMul: 1,
    regen: 7,
    regenLimit: 3,
    desc: 'Comes back three times, slower each time',
  },
  g: { code: 'g', name: 'Gold', hp: 1, color: '#ffd24d', xp: 90, dropMul: 1.4, desc: 'Triple XP' },
  p: { code: 'p', name: 'Gift', hp: 1, color: '#ff5fa2', xp: 14, dropMul: 0, gift: true, desc: 'Guaranteed power-up' },
  b: { code: 'b', name: 'Junk', hp: 1, color: '#8892a4', xp: 4, dropMul: 0.2, desc: 'Sent by a rival in PvP' },
  k: {
    code: 'k',
    name: 'Power Node',
    hp: 4,
    color: '#ff2d55',
    xp: 70,
    dropMul: 1.6,
    desc: 'Holds the boss shield: while one node stands, the body is invincible',
  },
};

export const BRICK_ORDER: BrickCode[] = ['n', 't', 's', 'e', 'r', 'g', 'p', 'x', 'k'];

export const EMPTY = '.';

export function isBrickCode(ch: string): ch is BrickCode {
  return ch in BRICK_KINDS;
}

/** A live brick in a running arena. */
export interface Brick {
  col: number;
  row: number;
  x: number;
  y: number;
  kind: BrickKind;
  hp: number;
  alive: boolean;
  /** Counts down while a regenerating brick is dead. */
  regenTimer: number;
  /** Revivals still available; at zero the brick stays broken for good. */
  regensLeft: number;
  /** Hit feedback, seconds. */
  flash: number;
  /** Arrived from a garbage push rather than from the level. A boss shield is
   *  made of the level's bricks only, so these never count towards it. */
  pushed?: boolean;
}
