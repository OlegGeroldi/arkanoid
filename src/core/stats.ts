/** Per-level record kept for every profile. */
export interface LevelStat {
  /** Best (shortest) clear time in seconds. */
  bestTime: number;
  /** Best score earned on this level alone. */
  bestScore: number;
  /** XP earned on this level, summed over all attempts. */
  xp: number;
  /** How many times it was cleared, and how many attempts died on it. */
  clears: number;
  deaths: number;
}

export type LevelStats = Record<string, LevelStat>;

export const emptyLevelStat = (): LevelStat => ({
  bestTime: 0,
  bestScore: 0,
  xp: 0,
  clears: 0,
  deaths: 0,
});

/** Time bonus: clearing fast is worth points, slow is worth nothing. It never
 *  touches lives or progression — the timer is purely a scoring device. */
export const PAR_TIME = 45;
export const MAX_TIME_BONUS = 2000;

export function timeBonus(seconds: number, levelIndex: number): number {
  // Later levels get a longer par: they are bigger and denser.
  const par = PAR_TIME + Math.floor(levelIndex / 10) * 8;
  if (seconds <= 0) return 0;
  const ratio = par / Math.max(seconds, 1);
  return Math.max(0, Math.round(Math.min(1.5, ratio) * MAX_TIME_BONUS * 0.5));
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)} с`;
}

/** Folds one cleared level into the stats table. */
export function recordClear(
  stats: LevelStats,
  levelIndex: number,
  data: { time: number; score: number; xp: number },
): void {
  const key = String(levelIndex);
  const stat = stats[key] ?? emptyLevelStat();
  stat.clears++;
  stat.xp += Math.round(data.xp);
  stat.bestScore = Math.max(stat.bestScore, Math.round(data.score));
  stat.bestTime = stat.bestTime > 0 ? Math.min(stat.bestTime, data.time) : data.time;
  stats[key] = stat;
}

export function recordDeath(stats: LevelStats, levelIndex: number): void {
  const key = String(levelIndex);
  const stat = stats[key] ?? emptyLevelStat();
  stat.deaths++;
  stats[key] = stat;
}

export interface StatsSummary {
  levelsCleared: number;
  totalClears: number;
  totalDeaths: number;
  totalXp: number;
  bestScore: number;
  fastest: { level: number; time: number } | null;
}

export function summarise(stats: LevelStats): StatsSummary {
  let levelsCleared = 0;
  let totalClears = 0;
  let totalDeaths = 0;
  let totalXp = 0;
  let bestScore = 0;
  let fastest: { level: number; time: number } | null = null;

  for (const [key, stat] of Object.entries(stats)) {
    if (stat.clears > 0) levelsCleared++;
    totalClears += stat.clears;
    totalDeaths += stat.deaths;
    totalXp += stat.xp;
    bestScore = Math.max(bestScore, stat.bestScore);
    if (stat.bestTime > 0 && (!fastest || stat.bestTime < fastest.time)) {
      fastest = { level: Number(key) + 1, time: stat.bestTime };
    }
  }
  return { levelsCleared, totalClears, totalDeaths, totalXp, bestScore, fastest };
}
