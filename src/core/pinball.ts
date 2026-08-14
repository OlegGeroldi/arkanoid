import { ARENA_H, ARENA_W, BRICK_H, GRID_LEFT, GRID_TOP, ROWS, WALL, brickWidthFor } from './constants';
import { BRICK_KINDS, isBrickCode, type Brick } from './bricks';
import { LOCKS_FOR_MULTIBALL, LOCK_HOLD, PROPS, makeProp, type Prop } from './props';
import type { LevelData } from './level';
import { Rng } from './rng';

/** A real pinball table, and deliberately not the Arena.
 *
 *  The arkanoid field has no gravity and a paddle that owns the bottom of the
 *  screen; a table has both reversed. Bolting one onto the other would have put
 *  a branch in every line of the code every other mode depends on, so this is
 *  its own simulation — it borrows the bricks, the attic props and the look, and
 *  nothing else.
 *
 *  Everything below is deterministic given the same seed and inputs, like the
 *  Arena, so the table could go over the network later without being rewritten. */

export const GRAVITY = 780;
/** Nothing may exceed this, or the ball tunnels through a flipper in one step. */
export const PINBALL_MAX_SPEED = 900;
export const PINBALL_BALLS = 3;

/** How bouncy each surface is. A table that returns all the energy is a table
 *  where the ball never settles. */
const WALL_BOUNCE = 0.72;
const BRICK_BOUNCE = 0.86;

export interface PinBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** In the plunger lane, waiting to be launched. */
  waiting: boolean;
  /** Held by a lock. */
  captured: boolean;
  trail: { x: number; y: number }[];
}

export interface Flipper {
  side: -1 | 1;
  /** Pivot point. */
  x: number;
  y: number;
  length: number;
  /** Radians: where it rests and where it swings to. */
  rest: number;
  up: number;
  angle: number;
  /** Radians per second, kept for the kick it imparts. */
  omega: number;
  /** True while its key is held. */
  active: boolean;
}

export type PinEvent =
  | { t: 'flip'; side: -1 | 1 }
  | { t: 'wall' }
  | { t: 'brick'; x: number; y: number; color: string; big: boolean }
  | { t: 'prop'; kind: Prop['kind']; x: number; y: number; score: number }
  | { t: 'targetsDown'; x: number; y: number }
  | { t: 'launch'; power: number }
  | { t: 'drain' }
  | { t: 'cleared' }
  | { t: 'over' };

export interface PinInput {
  left: boolean;
  right: boolean;
  /** Held to charge the plunger; released to fire. */
  plunger: boolean;
}

export const noPinInput = (): PinInput => ({ left: false, right: false, plunger: false });

/** The lane on the right the ball is launched up. */
const LANE_W = 26;
const LANE_X = ARENA_W - WALL - LANE_W / 2;
/** Where the lane ends and the table begins. */
const LANE_TOP = ARENA_H - 240;

export class PinballTable {
  readonly rng: Rng;
  level: LevelData;
  bricks: Brick[] = [];
  props: Prop[] = [];
  balls: PinBall[] = [];
  flippers: [Flipper, Flipper];

  ballsLeft = PINBALL_BALLS;
  score = 0;
  /** Rises with every hit and pays a multiplier; a drain resets it. */
  combo = 0;
  comboT = 0;
  locked = 0;
  /** 0..1 while the plunger is being pulled back. */
  plunger = 0;
  remaining = 0;
  state: 'ready' | 'play' | 'drained' | 'cleared' | 'over' = 'ready';
  events: PinEvent[] = [];
  shake = 0;
  time = 0;

  constructor(level: LevelData, seed = Date.now() >>> 0) {
    this.rng = new Rng(seed);
    this.level = level;
    this.flippers = [makeFlipper(-1), makeFlipper(1)];
    this.load(level);
  }

  load(level: LevelData): void {
    this.level = level;
    const brickW = brickWidthFor(ARENA_W - LANE_W, 12);
    this.bricks = [];
    // Only the upper half carries bricks: the lower half is the table, and a
    // brick down there would be unreachable behind the flippers.
    for (let r = 0; r < Math.min(ROWS - 8, level.rows.length); r++) {
      const row = level.rows[r] ?? '';
      for (let c = 0; c < 12; c++) {
        const ch = row[c];
        if (!ch || !isBrickCode(ch)) continue;
        const kind = BRICK_KINDS[ch];
        this.bricks.push({
          col: c,
          row: r,
          x: GRID_LEFT + c * brickW,
          y: GRID_TOP + r * BRICK_H,
          kind,
          hp: kind.hp,
          alive: true,
          regenTimer: 0,
          regensLeft: kind.regenLimit ?? 0,
          flash: 0,
        });
      }
    }
    this.brickW = brickW;
    this.props = (level.props ?? []).map((p) => makeProp(p, brickW));
    this.furnishMiddle();
    this.remaining = this.bricks.filter((b) => b.kind.hp > 0).length;
    this.balls = [];
    this.serve();
  }

  brickW = brickWidthFor(ARENA_W - LANE_W, 12);

  /** A level's own attic sits at the very top, which on a table leaves the
   *  whole middle empty — the ball falls through nothing for a second and a
   *  half. So the table furnishes that band itself: a triangle of bumpers and
   *  two slings out by the walls, where a falling ball actually goes. */
  private furnishMiddle(): void {
    const midY = ARENA_H * 0.52;
    const cx = (ARENA_W - LANE_W) / 2;
    const add = (kind: Prop['kind'], x: number, y: number): void => {
      this.props.push({
        kind,
        def: PROPS[kind],
        x,
        y,
        flash: 0,
        spin: 0,
        spinRate: 0,
        down: false,
        holdT: 0,
      });
    };
    add('bumper', cx, midY - 46);
    add('bumper', cx - 52, midY + 6);
    add('bumper', cx + 52, midY + 6);
    add('sling', WALL + 34, midY + 96);
    add('sling', ARENA_W - LANE_W - WALL - 34, midY + 96);
  }

  /** Puts a ball in the plunger lane. */
  serve(): void {
    this.balls.push({
      x: LANE_X,
      y: ARENA_H - 60,
      vx: 0,
      vy: 0,
      r: 7,
      waiting: true,
      captured: false,
      trail: [],
    });
    this.state = 'ready';
    this.plunger = 0;
  }

  update(dt: number, input: PinInput): void {
    if (this.state === 'over' || this.state === 'cleared') return;
    this.time += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    this.updateFlippers(dt, input);
    this.updatePlunger(dt, input);
    this.updateProps(dt);
    this.updateBalls(dt);

    if (this.remaining <= 0) {
      this.state = 'cleared';
      this.events.push({ t: 'cleared' });
    }
  }

  private updateFlippers(dt: number, input: PinInput): void {
    for (const f of this.flippers) {
      f.active = f.side < 0 ? input.left : input.right;
      const target = f.active ? f.up : f.rest;
      const was = f.angle;
      // Fast up, slower back down: a flipper should snap and then relax.
      const rate = f.active ? 22 : 13;
      const step = rate * dt;
      f.angle = Math.abs(target - f.angle) <= step ? target : f.angle + Math.sign(target - f.angle) * step;
      f.omega = dt > 0 ? (f.angle - was) / dt : 0;
      if (was !== f.angle && f.angle === f.up) this.events.push({ t: 'flip', side: f.side });
    }
  }

  private updatePlunger(dt: number, input: PinInput): void {
    const ball = this.balls.find((b) => b.waiting);
    if (!ball) {
      this.plunger = 0;
      return;
    }
    if (input.plunger) {
      this.plunger = Math.min(1, this.plunger + dt * 1.6);
      return;
    }
    if (this.plunger > 0) {
      // Let go: everything held goes into the shot. A tap counts as a quarter
      // pull rather than nothing — a ball that refuses to leave the lane reads
      // as a broken game, not as a gentle shot.
      const power = Math.max(0.25, this.plunger);
      ball.waiting = false;
      ball.vy = -(320 + power * 560);
      ball.vx = 0;
      this.state = 'play';
      this.events.push({ t: 'launch', power: Math.max(0.25, this.plunger) });
      this.plunger = 0;
    }
  }

  private updateProps(dt: number): void {
    for (const p of this.props) {
      if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 3);
      if (p.spinRate > 0) {
        p.spin += p.spinRate * dt;
        p.spinRate = Math.max(0, p.spinRate - dt * 6);
      }
      if (p.holdT > 0) {
        p.holdT -= dt;
        if (p.holdT <= 0) this.releaseLock(p);
      }
    }
  }

  private releaseLock(p: Prop): void {
    const ball = this.balls.find((b) => b.captured);
    if (!ball) return;
    ball.captured = false;
    ball.vx = this.rng.range(-90, 90);
    ball.vy = 220;
    if (this.locked >= LOCKS_FOR_MULTIBALL) {
      this.locked = 0;
      for (let i = 0; i < 2; i++) {
        this.balls.push({ ...ball, x: p.x + this.rng.range(-8, 8), vx: this.rng.range(-140, 140), trail: [] });
      }
    }
  }

  private updateBalls(dt: number): void {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.captured) continue;

      if (b.waiting) {
        // Sitting on the plunger, pressed down by the pull.
        b.y = ARENA_H - 60 + this.plunger * 22;
        continue;
      }

      b.vy += GRAVITY * dt;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > PINBALL_MAX_SPEED) {
        b.vx = (b.vx / speed) * PINBALL_MAX_SPEED;
        b.vy = (b.vy / speed) * PINBALL_MAX_SPEED;
      }

      // Substeps: at nine hundred pixels a second a single step would step
      // straight over a flipper.
      const steps = Math.max(1, Math.ceil((speed * dt) / 6));
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        this.collideWalls(b);
        this.collideFlippers(b);
        this.collideBricks(b);
        this.collideProps(b);
      }

      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 8) b.trail.shift();

      if (b.y - b.r > ARENA_H) {
        this.balls.splice(i, 1);
        if (!this.balls.length) this.drain();
      }
    }
  }

  private collideWalls(b: PinBall): void {
    const inLane = b.x > ARENA_W - WALL - LANE_W;
    if (b.x - b.r < WALL) {
      b.x = WALL + b.r;
      b.vx = Math.abs(b.vx) * WALL_BOUNCE;
      this.events.push({ t: 'wall' });
    } else if (b.x + b.r > ARENA_W - WALL) {
      b.x = ARENA_W - WALL - b.r;
      b.vx = -Math.abs(b.vx) * WALL_BOUNCE;
      this.events.push({ t: 'wall' });
    }
    if (b.y - b.r < WALL) {
      b.y = WALL + b.r;
      b.vy = Math.abs(b.vy) * WALL_BOUNCE;
      this.events.push({ t: 'wall' });
    }

    // The lane's inner wall, which the ball leaves over the top.
    const laneLeft = ARENA_W - WALL - LANE_W;
    if (b.y > LANE_TOP && inLane && b.x - b.r < laneLeft) {
      b.x = laneLeft + b.r;
      b.vx = Math.abs(b.vx) * WALL_BOUNCE;
    }

    // A one-way gate across the mouth of the lane. Without it a ball that comes
    // back down the right-hand side falls into the lane and sits on the plunger
    // with no way out — the table looks broken while it is merely stuck.
    if (b.x + b.r > laneLeft && b.vy > 0 && b.y > LANE_TOP - 12 && b.y < LANE_TOP + 24) {
      b.x = laneLeft - b.r;
      b.vx = -Math.abs(b.vx || 60) * WALL_BOUNCE;
    }

    // The two slopes that funnel a falling ball towards the flippers.
    this.collideSlope(b, WALL, ARENA_H - 150, 92, 1);
    this.collideSlope(b, ARENA_W - WALL - LANE_W, ARENA_H - 150, 92, -1);
  }

  /** A diagonal wall running down towards the middle of the table. */
  private collideSlope(b: PinBall, x0: number, y0: number, len: number, dir: 1 | -1): void {
    const x1 = x0 + len * dir;
    const y1 = y0 + len * 0.75;
    const hit = closestOnSegment(b.x, b.y, x0, y0, x1, y1);
    const dx = b.x - hit.x;
    const dy = b.y - hit.y;
    const d = Math.hypot(dx, dy);
    if (d > b.r || d === 0) return;
    const nx = dx / d;
    const ny = dy / d;
    b.x = hit.x + nx * b.r;
    b.y = hit.y + ny * b.r;
    const dot = b.vx * nx + b.vy * ny;
    b.vx = (b.vx - 2 * dot * nx) * WALL_BOUNCE;
    b.vy = (b.vy - 2 * dot * ny) * WALL_BOUNCE;
  }

  private collideFlippers(b: PinBall): void {
    for (const f of this.flippers) {
      const tipX = f.x + Math.cos(f.angle) * f.length * f.side;
      const tipY = f.y + Math.sin(f.angle) * f.length;
      const hit = closestOnSegment(b.x, b.y, f.x, f.y, tipX, tipY);
      const dx = b.x - hit.x;
      const dy = b.y - hit.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const reach = b.r + 7;
      if (d > reach) continue;

      const nx = dx / d;
      const ny = dy / d;
      b.x = hit.x + nx * reach;
      b.y = hit.y + ny * reach;

      // Reflect, then add what the flipper itself is doing: the difference
      // between a dead bat and a swing is entirely in this term.
      const dot = b.vx * nx + b.vy * ny;
      b.vx = (b.vx - 2 * dot * nx) * 0.55;
      b.vy = (b.vy - 2 * dot * ny) * 0.55;

      const armX = hit.x - f.x;
      const armY = hit.y - f.y;
      const surfaceX = -armY * f.omega;
      const surfaceY = armX * f.omega;
      b.vx += surfaceX * 0.55;
      b.vy += surfaceY * 0.55;

      // A moving flipper always sends the ball up, even at the tip.
      if (f.omega !== 0 && b.vy > -120) b.vy = -120 - Math.abs(f.omega) * 12;
      this.events.push({ t: 'wall' });
    }
  }

  private collideBricks(b: PinBall): void {
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      if (b.x + b.r < brick.x || b.x - b.r > brick.x + this.brickW) continue;
      if (b.y + b.r < brick.y || b.y - b.r > brick.y + BRICK_H) continue;

      // Push out along whichever axis is least overlapped.
      const cx = brick.x + this.brickW / 2;
      const cy = brick.y + BRICK_H / 2;
      const ox = this.brickW / 2 + b.r - Math.abs(b.x - cx);
      const oy = BRICK_H / 2 + b.r - Math.abs(b.y - cy);
      if (ox < oy) {
        b.x += b.x < cx ? -ox : ox;
        b.vx = -b.vx * BRICK_BOUNCE;
      } else {
        b.y += b.y < cy ? -oy : oy;
        b.vy = -b.vy * BRICK_BOUNCE;
      }
      this.damageBrick(brick, 1);
      return;
    }
  }

  damageBrick(brick: Brick, dmg: number): void {
    brick.flash = 1;
    if (brick.kind.hp < 0) return;
    brick.hp -= dmg;
    if (brick.hp > 0) {
      this.events.push({ t: 'brick', x: brick.x, y: brick.y, color: brick.kind.color, big: false });
      return;
    }
    brick.alive = false;
    this.remaining--;
    this.combo = Math.min(20, this.combo + 1);
    this.comboT = 2.5;
    this.score += Math.round(brick.kind.xp * (1 + this.combo * 0.1));
    this.events.push({ t: 'brick', x: brick.x, y: brick.y, color: brick.kind.color, big: true });
  }

  private collideProps(b: PinBall): void {
    for (const p of this.props) {
      if (p.down || p.holdT > 0) continue;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const reach = p.def.radius + b.r;
      if (dx * dx + dy * dy > reach * reach) continue;

      p.flash = 1;
      const score = Math.round(p.def.score * (1 + this.combo * 0.1));
      this.score += score;
      this.events.push({ t: 'prop', kind: p.kind, x: p.x, y: p.y, score });

      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      switch (p.kind) {
        case 'bumper':
          b.x = p.x + nx * (reach + 1);
          b.y = p.y + ny * (reach + 1);
          b.vx = nx * 430;
          b.vy = ny * 430;
          this.shake = Math.min(1, this.shake + 0.2);
          break;
        case 'sling': {
          const outward = p.x < ARENA_W / 2 ? 1 : -1;
          b.x = p.x + nx * (reach + 1);
          b.y = p.y + ny * (reach + 1);
          b.vx = outward * 340;
          b.vy = -260;
          break;
        }
        case 'spinner':
          p.spinRate = 14;
          break;
        case 'target':
          p.down = true;
          if (this.props.every((q) => q.kind !== 'target' || q.down)) {
            this.events.push({ t: 'targetsDown', x: p.x, y: p.y });
            this.score += 500;
          }
          break;
        case 'lock':
          b.captured = true;
          b.vx = 0;
          b.vy = 0;
          b.x = p.x;
          b.y = p.y;
          p.holdT = LOCK_HOLD;
          this.locked++;
          break;
      }
    }
  }

  private drain(): void {
    this.combo = 0;
    this.ballsLeft--;
    this.events.push({ t: 'drain' });
    if (this.ballsLeft <= 0) {
      this.state = 'over';
      this.events.push({ t: 'over' });
      return;
    }
    this.state = 'drained';
    this.serve();
  }

  drainEvents(): PinEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}

function makeFlipper(side: -1 | 1): Flipper {
  const gap = 34;
  const x = ARENA_W / 2 + side * gap;
  const y = ARENA_H - 78;
  return {
    side,
    x,
    y,
    length: 62,
    // Angles are measured from the pivot outwards, so both flippers use the
    // same numbers and `side` mirrors them.
    rest: 0.42,
    up: -0.52,
    angle: 0.42,
    omega: 0,
    active: false,
  };
}

/** Closest point on a segment to a point — the workhorse of every collision
 *  here that is not a circle or a box. */
export function closestOnSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: x0 + dx * t, y: y0 + dy * t };
}

export const PIN_LANE = { x: LANE_X, w: LANE_W };
