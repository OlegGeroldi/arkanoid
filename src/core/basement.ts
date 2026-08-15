import { ARENA_H, WALL } from './constants';
import { GRAVITY, PINBALL_MAX_SPEED, bounceOff, closestOnSegment, flipperTip, type Flipper } from './pinball';

/** The pinball floor under the arkanoid one. A ball that gets past the paddle
 *  is not lost yet: it drops through the ceiling into here, where gravity and
 *  two flippers take over. Flip it back up through the ceiling and play carries
 *  on upstairs; miss it and only then is the ball gone.
 *
 *  It works in arena coordinates, continued downwards — the ceiling is exactly
 *  the arena's floor, so a ball crosses between the two without conversion. */

/** Tall enough to be a floor of its own rather than a strip under the field:
 *  once the view slides down, the cellar is what the screen is showing. */
export const BASEMENT_H = 520;
/** The drain: below this the ball is really lost. */
export const BASEMENT_FLOOR = ARENA_H + BASEMENT_H;

const BOUNCE = 0.8;
/** A swung flipper throws the ball; one left lying there deadens it. Without
 *  that difference the cellar saves the ball on its own and the floor below the
 *  paddle stops being a threat at all. */
const FLIPPER_BOUNCE = 0.72;
const FLIPPER_LIMP = 0.3;
const BUMPER_R = 17;
const BUMPER_KICK = 300;
const BUMPERS_COOL_AT = 8;
/** Everything the ball meets down here, so a rally can be saved more than once. */
const SLOPE_TOP = BASEMENT_FLOOR - 150;
const PIVOT_Y = BASEMENT_FLOOR - 78;

/** Anything the basement can catch. The arena hands its own balls straight in,
 *  keeps them alive while they are down here, and takes them back unchanged. */
export interface FallingBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export interface Bumper {
  x: number;
  y: number;
  flash: number;
}

export type BasementEvent =
  | { t: 'caught'; x: number }
  | { t: 'bumper'; x: number; y: number }
  | { t: 'flip' }
  | { t: 'saved'; x: number }
  | { t: 'lost'; x: number };

function makeFlipper(cx: number, side: -1 | 1): Flipper {
  return {
    side,
    x: cx + side * 112,
    y: PIVOT_Y,
    length: 74,
    rest: 0.42,
    up: -0.52,
    angle: 0.42,
    omega: 0,
    active: false,
  };
}

export class Basement<T extends FallingBall = FallingBall> {
  balls: T[] = [];
  flippers: [Flipper, Flipper];
  bumpers: Bumper[] = [];
  slopes: { x0: number; y0: number; x1: number; y1: number }[];
  events: BasementEvent[] = [];
  /** Seconds the current ball has spent down here. */
  sinceCatch = 0;
  /** After a while the bumpers go cold and stop paying out, so a ball nobody
   *  flips always comes to an end instead of rattling around for ever. */
  get cold(): boolean {
    return this.sinceCatch > BUMPERS_COOL_AT;
  }
  /** Lit while a ball is down here, for the renderer and the HUD. */
  get busy(): boolean {
    return this.balls.length > 0;
  }

  constructor(readonly width: number) {
    const cx = width / 2;
    this.flippers = [makeFlipper(cx, -1), makeFlipper(cx, 1)];
    this.slopes = this.flippers.map((f) => ({
      x0: f.side < 0 ? WALL : width - WALL,
      y0: SLOPE_TOP,
      x1: f.x,
      y1: f.y,
    }));
    // Two bumpers with a clear lane between them. They keep a fallen ball alive
    // and pay score, but they sit low enough and hit softly enough that neither
    // can throw the ball back through the ceiling on its own — the way home is
    // the flippers. A third one in the middle turned the cellar into a nest the
    // ball could rattle around in forever.
    this.bumpers = [
      { x: cx - 84, y: ARENA_H + BASEMENT_H * 0.42, flash: 0 },
      { x: cx + 84, y: ARENA_H + BASEMENT_H * 0.42, flash: 0 },
      { x: cx, y: ARENA_H + BASEMENT_H * 0.62, flash: 0 },
    ];
  }

  /** The arena drops a ball through the ceiling. */
  take(ball: T): void {
    this.sinceCatch = 0;
    ball.y = ARENA_H + ball.r;
    // It arrives with whatever pace it had: falling through is not a reset.
    ball.vy = Math.max(Math.abs(ball.vy), 120);
    this.balls.push(ball);
    this.events.push({ t: 'caught', x: ball.x });
  }

  clear(): void {
    this.balls.length = 0;
  }

  drainEvents(): BasementEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Runs a frame and returns the balls that made it back up to the arena. */
  update(dt: number, left: boolean, right: boolean): T[] {
    for (const b of this.bumpers) b.flash = Math.max(0, b.flash - dt * 3);
    if (!this.balls.length) {
      this.sinceCatch = 0;
      this.swing(dt, left, right);
      return [];
    }
    this.sinceCatch += dt;

    // The swing crosses more than a ball's width in a frame, so it advances in
    // step with the balls rather than jumping past them.
    const sub = 4;
    const escaped: T[] = [];
    for (let s = 0; s < sub; s++) {
      this.swing(dt / sub, left, right);
      this.moveBalls(dt / sub, escaped);
    }
    return escaped;
  }

  private swing(dt: number, left: boolean, right: boolean): void {
    for (const f of this.flippers) {
      f.active = f.side < 0 ? left : right;
      const target = f.active ? f.up : f.rest;
      const was = f.angle;
      const step = (f.active ? 34 : 13) * dt;
      f.angle = Math.abs(target - f.angle) <= step ? target : f.angle + Math.sign(target - f.angle) * step;
      f.omega = dt > 0 ? (f.angle - was) / dt : 0;
      if (was !== f.angle && f.angle === f.up) this.events.push({ t: 'flip' });
    }
  }

  private moveBalls(dt: number, escaped: T[]): void {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.vy += GRAVITY * dt;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > PINBALL_MAX_SPEED) {
        b.vx = (b.vx / speed) * PINBALL_MAX_SPEED;
        b.vy = (b.vy / speed) * PINBALL_MAX_SPEED;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      this.walls(b);
      this.flip(b);
      this.bump(b);

      if (b.y - b.r < ARENA_H && b.vy < 0) {
        // Out through the ceiling: back to the paddle floor.
        this.balls.splice(i, 1);
        escaped.push(b);
        this.events.push({ t: 'saved', x: b.x });
      } else if (b.y - b.r > BASEMENT_FLOOR) {
        this.balls.splice(i, 1);
        this.events.push({ t: 'lost', x: b.x });
      }
    }
  }

  private walls(b: FallingBall): void {
    if (b.x - b.r < WALL) {
      b.x = WALL + b.r;
      b.vx = Math.abs(b.vx) * BOUNCE;
    } else if (b.x + b.r > this.width - WALL) {
      b.x = this.width - WALL - b.r;
      b.vx = -Math.abs(b.vx) * BOUNCE;
    }
    for (const s of this.slopes) {
      const hit = closestOnSegment(b.x, b.y, s.x0, s.y0, s.x1, s.y1);
      const dx = b.x - hit.x;
      const dy = b.y - hit.y;
      const d = Math.hypot(dx, dy);
      if (d > b.r || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      b.x = hit.x + nx * b.r;
      b.y = hit.y + ny * b.r;
      bounceOff(b, nx, ny, BOUNCE);
    }
  }

  private flip(b: FallingBall): void {
    for (const f of this.flippers) {
      const tip = flipperTip(f);
      const hit = closestOnSegment(b.x, b.y, f.x, f.y, tip.x, tip.y);
      const dx = b.x - hit.x;
      const dy = b.y - hit.y;
      const d = Math.hypot(dx, dy);
      if (d > b.r + 6 || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      b.x = hit.x + nx * (b.r + 6);
      b.y = hit.y + ny * (b.r + 6);
      bounceOff(b, nx, ny, f.omega !== 0 ? FLIPPER_BOUNCE : FLIPPER_LIMP);
      b.vx += -(hit.y - f.y) * f.omega;
      b.vy += (hit.x - f.x) * f.omega;
      if (f.omega !== 0 && b.vy > -260) b.vy = -260 - Math.abs(f.omega) * 14;
      const out = Math.hypot(b.vx, b.vy);
      if (out > PINBALL_MAX_SPEED) {
        b.vx = (b.vx / out) * PINBALL_MAX_SPEED;
        b.vy = (b.vy / out) * PINBALL_MAX_SPEED;
      }
    }
  }

  private bump(b: FallingBall): void {
    for (const p of this.bumpers) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > b.r + BUMPER_R || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      b.x = p.x + nx * (b.r + BUMPER_R);
      b.y = p.y + ny * (b.r + BUMPER_R);
      // Bounce outwards without handing out free energy: a bumper that always
      // returned a fixed speed let the ball ping between them for ever.
      const speed = Math.hypot(b.vx, b.vy);
      const out = this.cold ? speed * 0.55 : Math.max(BUMPER_KICK, speed * 0.85);
      b.vx = nx * out;
      b.vy = ny * out;
      p.flash = 1;
      this.events.push({ t: 'bumper', x: p.x, y: p.y });
    }
  }
}
