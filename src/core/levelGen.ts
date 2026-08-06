import { COLS, ROWS } from './constants';
import { EMPTY, type BrickCode } from './bricks';
import { normalizeLevel, type LevelData } from './level';
import { Rng } from './rng';
import type { RouteDef } from './routes';
import { GLYPHS, WORDS, wordGlyph, type Glyph } from './glyphs';

/** Difficulty knobs derived from the campaign position, 0 (easy) to 1 (brutal). */
interface Recipe {
  /** How much of the grid gets filled. */
  density: number;
  /** Share of filler bricks swapped for charges. */
  charge: number;
  /** Rows of bricks to use, from the top. */
  rows: number;
  /** Weighted pool of brick codes for this stage. */
  palette: BrickCode[];
  ballSpeed: number;
  /** Chaos levels drop symmetry and hand-drawn shapes altogether. */
  chaos: boolean;
}

type Shaper = (rng: Rng, grid: string[][], r: Recipe) => void;

const blank = (): string[][] => Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => EMPTY));

const put = (grid: string[][], col: number, row: number, ch: string): void => {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  grid[row][col] = ch;
};

/** Mirror the left half onto the right so generated fields still look designed. */
function symmetrise(grid: string[][], rows: number): void {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS / 2; c++) {
      grid[r][COLS - 1 - c] = grid[r][c];
    }
  }
}

// ------------------------------------------------------------------ shapes --

const solidBlock: Shaper = (rng, grid, r) => {
  for (let row = 0; row < r.rows; row++) {
    for (let col = 0; col < COLS; col++) {
      if (rng.next() < r.density) put(grid, col, row, rng.pick(r.palette));
    }
  }
};

const checker: Shaper = (rng, grid, r) => {
  for (let row = 0; row < r.rows; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((row + col) % 2 === 0 || rng.next() < r.density * 0.4) {
        put(grid, col, row, rng.pick(r.palette));
      }
    }
  }
};

const pyramid: Shaper = (rng, grid, r) => {
  const mid = (COLS - 1) / 2;
  for (let row = 0; row < r.rows; row++) {
    const half = Math.round(((row + 1) / r.rows) * (COLS / 2));
    for (let col = Math.ceil(mid - half); col <= Math.floor(mid + half); col++) {
      put(grid, col, row, rng.pick(r.palette));
    }
  }
};

const columns: Shaper = (rng, grid, r) => {
  const step = rng.int(2, 4);
  for (let col = 0; col < COLS; col++) {
    if (col % step === 0) continue;
    for (let row = 0; row < r.rows; row++) {
      if (rng.next() < r.density + 0.2) put(grid, col, row, rng.pick(r.palette));
    }
  }
};

const rings: Shaper = (rng, grid, r) => {
  const cx = (COLS - 1) / 2;
  const cy = (r.rows - 1) / 2;
  for (let row = 0; row < r.rows; row++) {
    for (let col = 0; col < COLS; col++) {
      const d = Math.hypot((col - cx) * 0.55, row - cy);
      if (Math.round(d) % 2 === 0) put(grid, col, row, rng.pick(r.palette));
    }
  }
};

const diagonals: Shaper = (rng, grid, r) => {
  const width = rng.int(2, 4);
  for (let row = 0; row < r.rows; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((col + row) % (width + 1) !== 0) put(grid, col, row, rng.pick(r.palette));
    }
  }
};

const arena: Shaper = (rng, grid, r) => {
  for (let row = 0; row < r.rows; row++) {
    for (let col = 0; col < COLS; col++) {
      const edge = row === 0 || row === r.rows - 1 || col === 0 || col === COLS - 1;
      if (edge) put(grid, col, row, 's');
      else if (rng.next() < r.density) put(grid, col, row, rng.pick(r.palette));
    }
  }
};

const scatter: Shaper = (rng, grid, r) => {
  const cells = Math.round(r.rows * COLS * r.density);
  for (let i = 0; i < cells; i++) {
    put(grid, rng.int(0, COLS), rng.int(0, r.rows), rng.pick(r.palette));
  }
};

/** Stamps a picture into the field and packs bricks around it. A level built
 *  this way reads as something — a heart, a skull, the word DOH — instead of a
 *  handful of rows, and the shape carries its own idea: the heart's core
 *  regenerates around a charge, the bomb's fuse is a line of them. */
function stampGlyph(grid: string[][], glyph: Glyph, r: Recipe, rng: Rng): boolean[][] {
  const art = glyph.art;
  const w = Math.max(...art.map((row) => row.length));
  const col0 = Math.floor((COLS - w) / 2);
  const row0 = Math.max(0, Math.floor((r.rows - art.length) / 2));
  /** The picture and a one-cell halo around it. Filler and stray charges are
   *  kept out of there — inside a silhouette they turn a skull into gravel —
   *  but the corners of its box stay free, so the field can still be full. */
  const kept: boolean[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  const protect = (row: number, col: number): void => {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = row + dr;
        const cc = col + dc;
        if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) kept[rr][cc] = true;
      }
    }
  };
  for (let row = 0; row < art.length; row++) {
    for (let col = 0; col < art[row].length; col++) {
      if (art[row][col] !== '.') protect(row0 + row, col0 + col);
    }
  }

  // Harder stages build the same picture out of sturdier stock.
  const body: BrickCode = r.density > 0.72 ? (glyph.skin.body === 'n' ? 't' : 's') : glyph.skin.body;

  for (let row = 0; row < art.length; row++) {
    for (let col = 0; col < art[row].length; col++) {
      const ch = art[row][col];
      if (ch === '.') continue;
      const code: BrickCode =
        ch === '@' ? glyph.skin.core : ch === '*' ? glyph.skin.charge : ch === 'x' ? 'x' : body;
      put(grid, col0 + col, row0 + row, code);
    }
  }

  // Something to break outside the picture, thin enough to leave it readable.
  for (let row = 0; row < r.rows; row++) {
    for (let col = 0; col < COLS; col++) {
      if (kept[row][col] || grid[row][col] !== EMPTY) continue;
      if (rng.next() < r.density * 0.85) put(grid, col, row, rng.pick(r.palette));
    }
  }
  return kept;
}

const SHAPERS: Shaper[] = [solidBlock, checker, pyramid, columns, rings, diagonals, arena, scatter];

// ------------------------------------------------------------------ recipe --

function recipeFor(index: number, total: number, route?: RouteDef): Recipe {
  const t = Math.min(1, index / (total - 1));
  let chaos = t >= 0.8; // the final fifth is unhinged

  // Brick palette widens and hardens as the campaign advances.
  const palette: BrickCode[] = ['n', 'n', 'n'];
  if (t > 0.08) palette.push('t');
  if (t > 0.18) palette.push('t', 'p');
  if (t > 0.28) palette.push('s', 'e');
  if (t > 0.42) palette.push('s', 'r', 'g');
  if (t > 0.55) palette.push('s', 't', 'x');
  if (t > 0.7) palette.push('s', 'r', 'x', 'e');
  if (chaos) palette.push('s', 's', 'x', 'r', 'e', 'g');

  // A route stacks its signature bricks on top and bends the numbers its way.
  if (route) {
    palette.push(...route.palette, ...route.palette);
    if (route.id === 'wastes' && t > 0.25) chaos = true;
  }

  return {
    // Fuller than it used to be: a level should feel like a wall you are
    // working through, not a handful of rows.
    density: Math.min(0.96, (0.58 + t * 0.38) * (route?.density ?? 1)),
    charge: 0.08 + t * 0.14,
    rows: Math.min(ROWS - 2, Math.round(7 + t * 9)),
    palette,
    ballSpeed: +((0.95 + t * 0.75) * (route?.ballSpeed ?? 1)).toFixed(2),
    chaos,
  };
}

/** Turns some of the field into charges and, now and then, wires two of them
 *  together with a short fuse. One brick going off is a firework; a fuse that
 *  runs into a cluster is the thing worth aiming at. */
function wireCharges(rng: Rng, grid: string[][], rows: number, share: number, kept?: boolean[][]): void {
  const free = (r: number, c: number): boolean => !kept?.[r]?.[c];
  const spots: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = grid[r][c];
      if (free(r, c) && ch !== EMPTY && ch !== 'x' && ch !== 'e' && ch !== 'r') spots.push([r, c]);
    }
  }
  for (const [r, c] of spots) {
    if (rng.next() < share) grid[r][c] = 'e';
  }

  // A couple of fuses: short runs of charges that carry a blast across the
  // field instead of letting it die where it started.
  const fuses = rng.int(1, 4);
  for (let i = 0; i < fuses; i++) {
    let r = rng.int(0, rows);
    let c = rng.int(0, COLS);
    const len = rng.int(3, 7);
    const dr = rng.chance(0.5) ? 0 : rng.chance(0.5) ? 1 : -1;
    const dc = dr === 0 ? (rng.chance(0.5) ? 1 : -1) : rng.chance(0.5) ? 1 : 0;
    for (let n = 0; n < len; n++) {
      if (r < 0 || r >= rows || c < 0 || c >= COLS) break;
      if (free(r, c) && grid[r][c] !== EMPTY && grid[r][c] !== 'x') grid[r][c] = 'e';
      r += dr;
      c += dc;
    }
  }
}

/** Reserve a couple of escape lanes so a dense field never becomes a wall the
 *  ball cannot get behind. */
function carveLanes(rng: Rng, grid: string[][], rows: number): void {
  const lanes = rng.int(1, 3);
  for (let i = 0; i < lanes; i++) {
    const col = rng.int(0, COLS);
    for (let row = 0; row < rows; row++) {
      if (rng.chance(0.75)) grid[row][col] = EMPTY;
    }
  }
}

/** Indestructible bricks are fun as obstacles and miserable as a ceiling: keep
 *  them from forming a full row that would seal the field off. */
function breakSteelRows(grid: string[][], rows: number): void {
  for (let row = 0; row < rows; row++) {
    if (grid[row].every((ch) => ch === 'x')) {
      grid[row][Math.floor(COLS / 2)] = 'n';
    }
  }
}

/** A regenerator boxed in by indestructible neighbours is a level that never
 *  ends: it revives faster than a ball can reach it. Open one wall.
 *
 *  Exported because a boss shield is assembled from copied rows, which can seal
 *  a pocket that was open in the level it came from. */
export function openRegeneratorPockets(grid: string[][], rows: number): void {
  const at = (c: number, r: number): string => (c < 0 || c >= COLS || r < 0 || r >= rows ? '.' : grid[r][c]);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== 'r') continue;
      const sides: [number, number][] = [
        [c - 1, r],
        [c + 1, r],
        [c, r - 1],
        [c, r + 1],
      ];
      const walls = sides.filter(([sc, sr]) => at(sc, sr) === 'x');
      if (!walls.length) continue;

      const sealed = walls.length >= sides.filter(([sc, sr]) => at(sc, sr) !== '.').length;
      if (sealed) {
        // Every reachable side is a wall. Open one — with an explosive, which
        // takes its neighbours with it: digging a regenerator out from behind
        // indestructible bricks one hit at a time is the least fun the game has.
        const [wc, wr] = walls[0];
        grid[wr][wc] = 'e';
        continue;
      }
      // Not sealed, but hemmed in. Plant a charge on a side that is already
      // breakable, so the pocket can be opened up rather than chipped at.
      if (walls.length >= 2) {
        const soft = sides.find(([sc, sr]) => {
          const ch = at(sc, sr);
          return ch !== '.' && ch !== 'x' && ch !== 'r' && ch !== 'e';
        });
        if (soft) grid[soft[1]][soft[0]] = 'e';
      }
    }
  }
}

const CHAOS_NAMES = [
  'Аномалия',
  'Разлом',
  'Шторм',
  'Бездна',
  'Коллапс',
  'Сингулярность',
  'Пепел',
  'Ноль',
  'Нейросбой',
  'Предел',
];

const STAGE_NAMES = [
  'Периметр',
  'Каскад',
  'Улей',
  'Бастион',
  'Спираль',
  'Кристалл',
  'Реактор',
  'Мозаика',
  'Батарея',
  'Клетка',
  'Купол',
  'Решётка',
  'Призма',
  'Ядро',
  'Барьер',
];

/** Builds one campaign level. Deterministic: the same index always produces the
 *  same field, so progress and level select stay meaningful between sessions. */
export function generateLevel(index: number, total: number, seed = 0x9e37, route?: RouteDef): LevelData {
  const rng = new Rng((seed + index * 2654435761 + (route ? route.id.length * 7919 : 0)) >>> 0);
  const recipe = recipeFor(index, total, route);
  const grid = blank();

  // Two levels in five are a picture. They are the ones people remember, and
  // they still obey every safety pass below.
  const picture = index % 5 === 1 || index % 5 === 3;
  const glyph = picture ? (rng.chance(0.35) ? wordGlyph(rng.pick(WORDS)) : rng.pick(GLYPHS)) : null;
  const kept = glyph ? stampGlyph(grid, glyph, recipe, rng) : undefined;
  if (!glyph) (recipe.chaos ? rng.pick(SHAPERS) : SHAPERS[index % SHAPERS.length])(rng, grid, recipe);

  if (recipe.chaos) {
    // Chaos levels stack a second pattern on top and skip symmetry entirely.
    rng.pick(SHAPERS)(rng, grid, { ...recipe, density: recipe.density * 0.6 });
  }

  wireCharges(rng, grid, recipe.rows, recipe.charge, kept);
  // A picture keeps its shape: carving lanes through a heart would leave a
  // heart with a hole in it and nothing gained.
  if (!picture) carveLanes(rng, grid, recipe.rows);
  breakSteelRows(grid, recipe.rows);

  // Symmetry before the last safety pass: carving lanes would otherwise break
  // the mirror the shapers set up, and a lopsided field reads as sloppy rather
  // than designed. Chaos levels stay deliberately ragged, and pictures are
  // drawn symmetrical already — mirroring a word would fold it onto itself.
  if (!recipe.chaos && !picture) symmetrise(grid, recipe.rows);

  // Truly last, because mirroring can seal a pocket that was open a moment ago,
  // and one asymmetric cell is a far smaller price than a level that cannot be
  // finished.
  openRegeneratorPockets(grid, recipe.rows);

  const rows = grid.map((row) => row.join(''));
  // A picture names the level after itself: "Сердце" says more than "Каскад 3".
  const baseName = glyph
    ? glyph.name
    : recipe.chaos
      ? `${rng.pick(CHAOS_NAMES)}-${index + 1}`
      : `${STAGE_NAMES[index % STAGE_NAMES.length]} ${Math.floor(index / STAGE_NAMES.length) + 1}`;
  const name = route ? `${route.name}: ${baseName}` : baseName;

  const level = normalizeLevel(
    {
      id: `gen-${index + 1}`,
      name,
      author: 'NEONOID',
      rows,
      ballSpeed: recipe.ballSpeed,
    },
    `gen-${index + 1}`,
  );
  if (!level) throw new Error(`generated level ${index} is malformed`);

  // A field of nothing but indestructible bricks would be unwinnable.
  if (!level.rows.some((row) => [...row].some((ch) => ch !== EMPTY && ch !== 'x'))) {
    level.rows[0] = 'nnnnnnnnnnnn';
  }
  return level;
}
