import { BUILTIN_LEVELS } from './builtinLevels';
import { generateLevel, openRegeneratorPockets, type LevelTheme } from './levelGen';
import { emptyRows, type LevelData } from './level';
import { BOSSES, bossForLevel, type BossId } from './bosses';
import { Rng } from './rng';

/** The boss shield: a short band of bricks, clear of the boss's own body. */
const SHIELD_TOP = 3;
const SHIELD_ROWS = 4;

/** Share of the shield turned into explosive bricks, per boss. Blasts hurt the
 *  boss as well as the shield, so these are both the way in and the opening
 *  damage — and DOH, who has the most hit points and the least patience, is
 *  wired the most heavily. */
const CHARGE_SHARE: Record<BossId, number> = {
  sentinel: 0.18,
  weaver: 0.22,
  core: 0.26,
  doh: 0.34,
};

/** How many energy nodes hold the last boss's shield up. Few enough to hunt,
 *  many enough that the hunt is the fight. */
const SHIELD_NODES = 5;

/** Marks a handful of cells in the band as the nodes that hold the shield.
 *  They are spread across the width so the hunt covers the whole field. */
function plantNodes(rows: string[], index: number): string[] {
  const grid = rows.map((r) => [...r]);
  const spots: [number, number][] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== '.' && grid[r][c] !== 'x') spots.push([r, c]);
    }
  }
  if (!spots.length) return rows;

  const rng = new Rng((0x4e0de ^ (index * 7919)) >>> 0);
  const wanted = Math.min(SHIELD_NODES, spots.length);
  const picked: [number, number][] = [];
  for (let n = 0; n < wanted; n++) {
    // Spread across the width: each node comes from its own vertical band.
    const lo = Math.floor((n / wanted) * spots.length);
    const hi = Math.max(lo + 1, Math.floor(((n + 1) / wanted) * spots.length));
    picked.push(spots[lo + rng.int(0, hi - lo)]);
  }
  for (const [r, c] of picked) grid[r][c] = 'k';
  return grid.map((r) => r.join(''));
}

/** Scatters explosives through a boss's shield band. Seeded by level index, so
 *  the same fight always looks the same. */
function seedCharges(rows: string[], boss: BossId, index: number): string[] {
  const rng = new Rng((0x5eed + index * 40503) >>> 0);
  const share = CHARGE_SHARE[boss];
  return rows.map((row) =>
    [...row]
      .map((ch) => (ch !== '.' && ch !== 'x' && ch !== 'e' && ch !== 'k' && rng.chance(share) ? 'e' : ch))
      .join(''),
  );
}

export const CAMPAIGN_SIZE = 100;
/** Where the generator stops designing and starts breaking things. */
export const CHAOS_FROM = Math.floor(CAMPAIGN_SIZE * 0.8) + 1; // level 81

/** The full campaign: ten handcrafted openers, then generated stages that grow
 *  denser and faster, with the last fifth fully randomised and hostile. */
function buildCampaign(theme: LevelTheme, attic = true): LevelData[] {
  const levels: LevelData[] = BUILTIN_LEVELS.map((level, i) => ({
    ...level,
    id: `campaign-${i + 1}`,
  }));
  for (let i = levels.length; i < CAMPAIGN_SIZE; i++) {
    const generated = generateLevel(i, CAMPAIGN_SIZE, 0x9e37, undefined, theme, attic);
    levels.push({ ...generated, id: `campaign-${i + 1}` });
  }

  // Every tenth level is a boss fight. The bricks become its shield, but only a
  // compact band of them: a whole field would turn the fight into a slog before
  // the boss even wakes up. Rows 0-2 stay empty so the body has room to move.
  return levels.map((level, i) => {
    const boss = bossForLevel(i);
    if (!boss) return level;
    const shield = emptyRows();
    for (let r = 0; r < SHIELD_ROWS; r++) {
      shield[SHIELD_TOP + r] = level.rows[r + 2] ?? level.rows[r] ?? shield[SHIELD_TOP + r];
    }
    const band = BOSSES[boss].nodeShield ? plantNodes(shield, i) : shield;
    // The band is copied out of another level's rows, so a regenerator can end
    // up walled in here even though it was reachable where it came from. The
    // same safety pass has to run again on the result.
    const grid = seedCharges(band, boss, i).map((row) => [...row]);
    openRegeneratorPockets(grid, grid.length);
    return { ...level, boss, name: BOSSES[boss].name, rows: grid.map((row) => row.join('')) };
  });
}

/** The campaign carves runes into its walls. */
export const CAMPAIGN_LEVELS: LevelData[] = buildCampaign('runes');

/** The race plays the same hundred levels with the other set of pictures:
 *  smileys, skulls and short words, which suit a table of people shouting at
 *  each other rather than a lone descent. Same seed, same shapes underneath —
 *  only the drawings differ.
 *
 *  And no attic: bumpers and drop targets belong to the pinball floor, and the
 *  race has none. Left in, they were furniture from another game. */
export const RACE_LEVELS: LevelData[] = buildCampaign('signs', false);

export const isChaosLevel = (index: number): boolean => index + 1 >= CHAOS_FROM;

/** Coarse difficulty band, used for colour-coding the level select. */
export function levelTier(index: number): 'easy' | 'normal' | 'hard' | 'chaos' {
  if (isChaosLevel(index)) return 'chaos';
  if (index < 10) return 'easy';
  if (index < 50) return 'normal';
  return 'hard';
}
