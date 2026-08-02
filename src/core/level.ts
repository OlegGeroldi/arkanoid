import { COLS, ROWS, BRICK_W, BRICK_H, GRID_TOP } from './constants';
import { BRICK_KINDS, EMPTY, isBrickCode, type Brick } from './bricks';
import { BOSSES, type BossId } from './bosses';

export interface LevelData {
  id: string;
  name: string;
  author?: string;
  /** Up to ROWS strings of exactly COLS characters. '.' is empty. */
  rows: string[];
  /** Ball speed multiplier for this level. */
  ballSpeed?: number;
  /** Background variant index, purely cosmetic. */
  bg?: number;
  /** Boss guarding this level, if any. */
  boss?: BossId;
}

export function emptyRows(): string[] {
  return Array.from({ length: ROWS }, () => EMPTY.repeat(COLS));
}

/** Accepts anything vaguely level-shaped (hand-written JSON, older saves) and
 *  returns a well-formed level, or null when it is not a level at all. */
export function normalizeLevel(raw: unknown, fallbackId = 'custom'): LevelData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.rows)) return null;

  const rows = emptyRows();
  for (let r = 0; r < ROWS; r++) {
    const src = typeof o.rows[r] === 'string' ? (o.rows[r] as string) : '';
    let line = '';
    for (let c = 0; c < COLS; c++) {
      const ch = src[c] ?? EMPTY;
      line += isBrickCode(ch) ? ch : EMPTY;
    }
    rows[r] = line;
  }

  const speed = typeof o.ballSpeed === 'number' && isFinite(o.ballSpeed) ? o.ballSpeed : 1;
  return {
    id: typeof o.id === 'string' && o.id ? o.id : fallbackId,
    name: typeof o.name === 'string' && o.name ? o.name : 'Без названия',
    author: typeof o.author === 'string' ? o.author : undefined,
    rows,
    ballSpeed: Math.min(Math.max(speed, 0.5), 2.5),
    bg: typeof o.bg === 'number' ? o.bg | 0 : 0,
    boss: typeof o.boss === 'string' && o.boss in BOSSES ? (o.boss as BossId) : undefined,
  };
}

/** Bricks that can actually be destroyed — a level with none of them is unwinnable. */
export function breakableCount(level: LevelData, cols = COLS): number {
  let n = 0;
  for (const row of widenRows(level.rows, cols)) {
    for (const ch of row) {
      if (isBrickCode(ch) && BRICK_KINDS[ch].hp > 0) n++;
    }
  }
  return n;
}

/** Widens a 12-column level to `cols` by mirroring it outward, so a co-op field
 *  reads as one deliberate design rather than two levels glued together. */
export function widenRows(rows: string[], cols: number): string[] {
  if (cols <= COLS) return rows;
  return rows.map((row) => {
    let out = '';
    for (let c = 0; c < cols; c++) {
      // Fold the target column back into the source, alternating direction so
      // each repeat is a mirror of the one before it.
      const block = Math.floor(c / COLS);
      const inner = c % COLS;
      out += row[block % 2 === 0 ? inner : COLS - 1 - inner] ?? EMPTY;
    }
    return out;
  });
}

export function buildBricks(level: LevelData, cols = COLS): Brick[] {
  const out: Brick[] = [];
  const rows = widenRows(level.rows, cols);
  for (let r = 0; r < ROWS; r++) {
    const row = rows[r] ?? '';
    for (let c = 0; c < cols; c++) {
      const ch = row[c];
      if (!ch || !isBrickCode(ch)) continue;
      const kind = BRICK_KINDS[ch];
      out.push({
        col: c,
        row: r,
        x: c * BRICK_W,
        y: GRID_TOP + r * BRICK_H,
        kind,
        hp: kind.hp,
        alive: true,
        regenTimer: 0,
        regensLeft: kind.regenLimit ?? 0,
        flash: 0,
      });
    }
  }
  return out;
}

export function cloneLevel(level: LevelData): LevelData {
  return { ...level, rows: level.rows.slice() };
}

export function setCell(level: LevelData, col: number, row: number, ch: string): void {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  const line = level.rows[row];
  level.rows[row] = line.slice(0, col) + ch + line.slice(col + 1);
}

export function getCell(level: LevelData, col: number, row: number): string {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return EMPTY;
  return level.rows[row][col] ?? EMPTY;
}
