import { noInput, type Arena, type ArenaInput } from './arena';
import { ARENA_W, PADDLE_Y } from './constants';

/** A simple heuristic Arkanoid opponent: no learning, no lookahead beyond one
 *  bounce-reflection, just enough to be a believable race — a real paddle
 *  tracking a real ball, with human-like lag and imprecision baked in as
 *  tunable constants rather than a difficulty system nobody asked for yet. */

/** Seconds between re-aiming — a real reaction delay, not a per-frame perfect
 *  read of the ball. */
const REACTION_TIME = 0.18;
/** Random offset added to the aim point each time it's re-picked, so the bot
 *  isn't a laser-guided wall. */
const AIM_ERROR = 26;
/** How close the paddle has to be to its target before it stops nudging —
 *  without this a perfectly-aimed bot jitters left/right every tick. */
const DEAD_ZONE = 4;

export class Bot {
  private target = ARENA_W / 2;
  private sinceThink = REACTION_TIME;

  constructor(private rng: () => number = Math.random) {}

  /** One tick's worth of input, mirroring what `InputHub.read` hands a human
   *  pilot — the arena can't tell the two apart. */
  think(arena: Arena, dt: number): ArenaInput {
    if (arena.state === 'serve') {
      return { ...noInput(), actionPressed: true };
    }
    if (arena.state === 'levelup') {
      const pick = (1 + Math.floor(this.rng() * 3)) as 1 | 2 | 3;
      return { ...noInput(), pick };
    }
    if (arena.state !== 'play' && arena.state !== 'spec') return noInput();

    this.sinceThink += dt;
    if (this.sinceThink >= REACTION_TIME) {
      this.sinceThink = 0;
      this.target = predictLanding(arena) + (this.rng() * 2 - 1) * AIM_ERROR;
    }

    const input = noInput();
    if (arena.paddleX > this.target + DEAD_ZONE) input.left = true;
    else if (arena.paddleX < this.target - DEAD_ZONE) input.right = true;
    return input;
  }
}

/** Where the nearest downward-moving ball will cross the paddle's line,
 *  folding repeated wall bounces into one reflection (the classic "triangle
 *  wave" trick) — ignores bricks in the way, which is exactly the blind spot
 *  that keeps this bot beatable. */
function predictLanding(arena: Arena): number {
  const ball = arena.balls.find((b) => b.vy > 0) ?? arena.balls[0];
  if (!ball || ball.vy <= 0) return arena.paddleX;

  const t = (PADDLE_Y - ball.y) / ball.vy;
  if (t <= 0) return arena.paddleX;

  const span = ARENA_W * 2;
  let x = (ball.x + ball.vx * t) % span;
  if (x < 0) x += span;
  return x > ARENA_W ? span - x : x;
}
