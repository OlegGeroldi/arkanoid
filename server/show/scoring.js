export const FIRST_CLEAR_BONUS = 50;
const CLEAR_POINTS = 100;
const BRICK_POINTS = 2;
const BRICK_POINTS_CAP = 60;

/** Points rank the match; coins go to the shop. */
export function scoreArena(result, clearOrder) {
  const bricks = Math.max(0, Math.floor(result.bricks || 0));
  const coins = bricks;
  if (result.cleared) {
    const bonus = clearOrder === 0 ? FIRST_CLEAR_BONUS : 0;
    return { points: CLEAR_POINTS + Math.round(Math.max(0, result.timeLeft)) + bonus, coins };
  }
  return { points: Math.min(BRICK_POINTS_CAP, bricks * BRICK_POINTS), coins };
}
