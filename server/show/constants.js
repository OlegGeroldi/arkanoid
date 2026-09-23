/** Mirrors src/core/campaignLevels.ts (CAMPAIGN_SIZE) and src/core/bosses.ts
 *  (bossForLevel). This server runs plain Node with no TS build, so change
 *  both sides together. */
export const LEVEL_COUNT = 100;
export const BOSS_LEVELS = {
  sentinel: [9, 19, 29],
  weaver: [39, 49, 59, 69],
  core: [79, 89],
  doh: [99],
};
export const BOSS_IDS = Object.keys(BOSS_LEVELS);

/** Rounds per act; act 4 is the finale. */
export const ACTS = [3, 3, 3, 1];
/** Round indices whose arena is a boss: end of act 2, and the finale. */
export const BOSS_ROUNDS = [5, 9];

export const MAX_PLAYERS = 10;
export const COLORS = [
  '#4de2ff', '#ff5fa2', '#ffd24d', '#3ddc84', '#b06bff',
  '#ff8c42', '#7cf5c4', '#ff4d6d', '#8fa8ff', '#e8f2ff',
];
export const AVATARS = ['🦊', '🐸', '🐙', '🦉', '🐼', '🦄', '🐯', '🐨', '🦖', '🐝', '🐧', '🦁', '🐻', '🐳', '🦩', '🌵'];
export const BOT = { id: 'bot', name: 'Bot', avatar: '🤖' };

/** Seconds. */
export const DUR = {
  countdown: 10,
  intro: 6,
  arena: 75,
  bossArena: 120,
  /** Extra time a client gets to report before the server calls time. */
  grace: 8,
  roundEnd: 7,
};
