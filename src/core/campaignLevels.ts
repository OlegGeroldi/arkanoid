import { BUILTIN_LEVELS } from './builtinLevels';
import { generateLevel } from './levelGen';
import type { LevelData } from './level';

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
  return levels;
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
