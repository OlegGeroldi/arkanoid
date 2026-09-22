import { ACTS, BOSS_IDS, BOSS_LEVELS, BOSS_ROUNDS, LEVEL_COUNT } from './constants.js';
import { mulberry32, pickInt, shuffle } from './rng.js';

/** Every arena of one match: random non-repeating regular levels, and two
 *  different random bosses at the end of act 2 and in the finale. */
export function buildSchedule(seed) {
  const rand = mulberry32(seed);
  const regularPool = [];
  for (let i = 0; i < LEVEL_COUNT; i++) if ((i + 1) % 10 !== 0) regularPool.push(i);
  const regular = shuffle(rand, regularPool);
  const bosses = shuffle(rand, BOSS_IDS).slice(0, BOSS_ROUNDS.length);

  const rounds = [];
  let index = 0;
  ACTS.forEach((count, a) => {
    for (let k = 0; k < count; k++, index++) {
      const bossSlot = BOSS_ROUNDS.indexOf(index);
      if (bossSlot >= 0) {
        const boss = bosses[bossSlot];
        const levels = BOSS_LEVELS[boss];
        rounds.push({ index, act: a + 1, actRound: k + 1, levelIndex: levels[pickInt(rand, levels.length)], boss });
      } else {
        rounds.push({ index, act: a + 1, actRound: k + 1, levelIndex: regular.pop(), boss: null });
      }
    }
  });
  return rounds;
}
