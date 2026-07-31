export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const TAU = Math.PI * 2;

export const len = (x: number, y: number): number => Math.hypot(x, y);

/** Anything with a velocity: balls carry `x/y` for position too, so velocity
 *  helpers take `vx/vy` explicitly and can never be handed a position. */
export interface Velocity {
  vx: number;
  vy: number;
}

/** Rescale a velocity to `speed`, keeping direction. A zero vector goes up. */
export function setSpeed(v: Velocity, speed: number): void {
  const l = Math.hypot(v.vx, v.vy);
  if (l < 1e-6) {
    v.vx = 0;
    v.vy = -speed;
    return;
  }
  v.vx = (v.vx / l) * speed;
  v.vy = (v.vy / l) * speed;
}

/** Nudge a near-horizontal direction away from horizontal so the ball can never
 *  get stuck ping-ponging between the side walls. */
export function avoidShallow(v: Velocity, minRatio = 0.22): void {
  const speed = Math.hypot(v.vx, v.vy);
  if (speed < 1e-6) return;
  const minY = speed * minRatio;
  if (Math.abs(v.vy) < minY) {
    v.vy = (v.vy < 0 ? -1 : 1) * minY;
    const maxX = Math.sqrt(Math.max(speed * speed - v.vy * v.vy, 0));
    v.vx = (v.vx < 0 ? -1 : 1) * maxX;
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const pointInRect = (px: number, py: number, r: Rect): boolean =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
