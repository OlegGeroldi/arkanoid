/** Brick catalogue. The single-character `code` is what levels are stored as,
 *  which keeps level JSON readable and hand-editable. */
export type BrickCode = 'n' | 't' | 's' | 'x' | 'e' | 'r' | 'g' | 'p' | 'b';

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
  n: { code: 'n', name: 'Обычный', hp: 1, color: '#4de2ff', xp: 10, dropMul: 1, desc: 'Ломается с одного удара' },
  t: { code: 't', name: 'Прочный', hp: 2, color: '#7c6cff', xp: 22, dropMul: 1.2, desc: 'Два удара' },
  s: { code: 's', name: 'Стальной', hp: 3, color: '#9fb3c8', xp: 40, dropMul: 1.5, desc: 'Три удара' },
  x: { code: 'x', name: 'Неразрушимый', hp: -1, color: '#5a6472', xp: 0, dropMul: 0, desc: 'Не ломается — только препятствие' },
  e: { code: 'e', name: 'Взрывной', hp: 1, color: '#ff7a3d', xp: 26, dropMul: 1, explodes: true, desc: 'Взрывается и сносит соседей' },
  r: {
    code: 'r',
    name: 'Регенератор',
    hp: 2,
    color: '#3ddc84',
    xp: 30,
    dropMul: 1,
    regen: 7,
    regenLimit: 3,
    desc: 'Возрождается трижды, каждый раз медленнее',
  },
  g: { code: 'g', name: 'Золотой', hp: 1, color: '#ffd24d', xp: 90, dropMul: 1.4, desc: 'Втрое больше опыта' },
  p: { code: 'p', name: 'Подарок', hp: 1, color: '#ff5fa2', xp: 14, dropMul: 0, gift: true, desc: 'Гарантированный бонус' },
  b: { code: 'b', name: 'Мусор', hp: 1, color: '#8892a4', xp: 4, dropMul: 0.2, desc: 'Присылается соперником в PvP' },
};

export const BRICK_ORDER: BrickCode[] = ['n', 't', 's', 'e', 'r', 'g', 'p', 'x'];

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
