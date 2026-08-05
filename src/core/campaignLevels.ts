import { BUILTIN_LEVELS } from './builtinLevels';
import { generateLevel } from './levelGen';
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

/** Scatters explosives through a boss's shield band. Seeded by level index, so
 *  the same fight always looks the same. */
function seedCharges(rows: string[], boss: BossId, index: number): string[] {
  const rng = new Rng((0x5eed + index * 40503) >>> 0);
  const share = CHARGE_SHARE[boss];
  return rows.map((row) =>
    [...row]
      .map((ch) => (ch !== '.' && ch !== 'x' && ch !== 'e' && rng.chance(share) ? 'e' : ch))
      .join(''),
  );
}

export const CAMPAIGN_SIZE = 100;
/** Where the generator stops designing and starts breaking things. */
export const CHAOS_FROM = Math.floor(CAMPAIGN_SIZE * 0.8) + 1; // level 81

/** The full campaign: ten handcrafted openers, then generated stages that grow
 *  denser and faster, with the last fifth fully randomised and hostile. */
function buildCampaign(): LevelData[] {
  const levels: LevelData[] = BUILTIN_LEVELS.map((level, i) => ({
    ...level,
    id: `campaign-${i + 1}`,
  }));
  for (let i = levels.length; i < CAMPAIGN_SIZE; i++) {
    const generated = generateLevel(i, CAMPAIGN_SIZE);
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
    return { ...level, boss, name: BOSSES[boss].name, rows: seedCharges(shield, boss, i) };
  });
}

export const CAMPAIGN_LEVELS: LevelData[] = buildCampaign();

export const isChaosLevel = (index: number): boolean => index + 1 >= CHAOS_FROM;

/** Coarse difficulty band, used for colour-coding the level select. */
export function levelTier(index: number): 'easy' | 'normal' | 'hard' | 'chaos' {
  if (isChaosLevel(index)) return 'chaos';
  if (index < 10) return 'easy';
  if (index < 50) return 'normal';
  return 'hard';
}
