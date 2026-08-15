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
/** Chips a hit is worth. Nothing down here pays out on the spot: it all goes
 *  into the pot, and the pot is only ever collected by getting the ball out. */
const POT_BUMPER = 25;
const POT_TARGET = 75;
const POT_WORD = 500;
const POT_SAVE = 150;
/** What sinking the ball in a lock is worth on top of the pot. */
const POT_JACKPOT = 750;
/** Chips a second, once the bumpers are cold. Camping has to cost something. */
const POT_DECAY = 70;
const TARGET_W = 26;
const LOCK_R = 19;
const LOCK_HOLD = 0.9;
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

/** One letter of the word. Knock all five down and the pot pays double for the
 *  rest of the level. */
export interface DropTarget {
  x: number;
  y: number;
  letter: string;
  down: boolean;
  flash: number;
}

/** A hole that swallows the ball, holds it for a beat and spits it back up
 *  through the ceiling — as two balls. */
export interface LockHole<T> {
  x: number;
  y: number;
  armed: boolean;
  holdT: number;
  ball: T | null;
  flash: number;
}

export type BasementEvent =
  | { t: 'caught'; x: number }
  | { t: 'bumper'; x: number; y: number }
  | { t: 'target'; x: number; y: number; letter: string }
  | { t: 'word'; x: number; y: number }
  | { t: 'lockIn'; x: number; y: number }
  | { t: 'multiball'; x: number; y: number }
  | { t: 'flip' }
  | { t: 'saved'; x: number; pot: number }
  | { t: 'lost'; x: number; pot: number };

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
  targets: DropTarget[] = [];
  locks: LockHole<T>[] = [];
  /** Chips won on this visit. Collected by getting the ball out, burnt by
   *  losing it — which is the whole point of coming down here. */
  pot = 0;
  /** Doubled for the rest of the level once the word is spelled. */
  potMul: 1 | 2 = 1;
  slopes: { x0: number; y0: number; x1: number; y1: number }[];
  events: BasementEvent[] = [];
  /** Seconds the current ball has spent down here. */
  sinceCatch = 0;
  /** After a while the bumpers go cold and stop paying out, so a ball nobody
   *  flips always comes to an end instead of rattling around for ever. */
  get cold(): boolean {
    return this.sinceCatch > BUMPERS_COOL_AT;
  }
  /** Lit while a ball is down here — including one sitting inside a lock, which
   *  is very much still in play. */
  get busy(): boolean {
    return this.balls.length > 0 || this.locks.some((l) => l.ball !== null);
  }

  /** What the escape is worth right now. */
  get payout(): number {
    return Math.round((this.pot + POT_SAVE) * this.potMul);
  }

  /** Half the playable span, so the furniture sits sensibly on the wide co-op
   *  field as well as the normal one. */
  private halfWidth: number;

  constructor(readonly width: number) {
    const cx = width / 2;
    this.halfWidth = Math.min(width / 2 - WALL, 240);
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
    // Two banks of drop targets against the walls, out of the ball's way down
    // the middle: reaching them is a choice, not something that just happens.
    const bank = (side: -1 | 1, letters: string[], from: number): DropTarget[] =>
      letters.map((letter, i) => ({
        x: cx + side * (this.halfWidth - 44),
        y: ARENA_H + BASEMENT_H * from + i * 46,
        letter,
        down: false,
        flash: 0,
      }));
    // Two banks that between them spell the word.
    this.targets = [...bank(-1, ['V', 'E', 'G'], 0.24), ...bank(1, ['A', 'S'], 0.28)];
    // The two holes. Sinking the ball in one is the best thing that can happen
    // to a ball that was, a second ago, as good as lost.
    this.locks = [-1, 1].map((side) => ({
      x: cx + side * 128,
      y: ARENA_H + BASEMENT_H * 0.16,
      armed: true,
      holdT: 0,
      ball: null,
      flash: 0,
    }));
  }

  /** The arena drops a ball through the ceiling. */
  take(ball: T): void {
    this.sinceCatch = 0;
    // The holes stay shut until the ball has been struck at least once: falling
    // straight into a jackpot would make the cellar pay for doing nothing.
    for (const l of this.locks) l.armed = false;
    ball.y = ARENA_H + ball.r;
    // It arrives with whatever pace it had: falling through is not a reset.
    ball.vy = Math.max(Math.abs(ball.vy), 120);
    this.balls.push(ball);
    this.events.push({ t: 'caught', x: ball.x });
  }

  clear(): void {
    this.balls.length = 0;
    this.pot = 0;
    for (const l of this.locks) {
      l.ball = null;
      l.holdT = 0;
      l.armed = true;
    }
  }

  /** A fresh level: the word goes back up and the doubling is gone. */
  reset(): void {
    this.clear();
    this.potMul = 1;
    for (const t of this.targets) t.down = false;
  }

  drainEvents(): BasementEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Runs a frame and returns the balls that made it back up to the arena. */
  update(dt: number, left: boolean, right: boolean): T[] {
    for (const b of this.bumpers) b.flash = Math.max(0, b.flash - dt * 3);
    for (const t of this.targets) t.flash = Math.max(0, t.flash - dt * 3);
    for (const l of this.locks) l.flash = Math.max(0, l.flash - dt * 3);

    const escaped: T[] = [];
    this.tickLocks(dt, escaped);
    if (!this.balls.length && !this.locks.some((l) => l.ball)) {
      this.sinceCatch = 0;
      this.swing(dt, left, right);
      return escaped;
    }
    this.sinceCatch += dt;
    // Once the bumpers are cold the pot melts away: standing around down here
    // has to cost something, or the safest play would be to never come out.
    if (this.cold) this.pot = Math.max(0, this.pot - POT_DECAY * dt);

    // The swing crosses more than a ball's width in a frame, so it advances in
    // step with the balls rather than jumping past them.
    const sub = 4;
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
      this.hitTargets(b);
      if (this.sink(b, i)) continue;

      if (b.y - b.r < ARENA_H && b.vy < 0) {
        // Out through the ceiling: back to the paddle floor, pot in hand.
        this.balls.splice(i, 1);
        escaped.push(b);
        this.events.push({ t: 'saved', x: b.x, pot: this.payout });
        this.pot = 0;
      } else if (b.y - b.r > BASEMENT_FLOOR) {
        this.balls.splice(i, 1);
        this.events.push({ t: 'lost', x: b.x, pot: Math.round(this.pot * this.potMul) });
        this.pot = 0;
      }
    }
  }

  /** Drop targets: each letter pays into the pot once, and the full word
   *  doubles everything the cellar pays for the rest of the level. */
  private hitTargets(b: FallingBall): void {
    for (const t of this.targets) {
      if (t.down) continue;
      const dx = Math.abs(b.x - t.x);
      const dy = Math.abs(b.y - t.y);
      if (dx > TARGET_W / 2 + b.r || dy > 6 + b.r) continue;
      t.down = true;
      t.flash = 1;
      if (!this.cold) this.pot += POT_TARGET;
      bounceOff(b, b.x < t.x ? -1 : 1, 0, 0.7);
      this.events.push({ t: 'target', x: t.x, y: t.y, letter: t.letter });
      if (this.targets.every((o) => o.down) && this.potMul === 1) {
        this.potMul = 2;
        this.pot += POT_WORD;
        this.events.push({ t: 'word', x: this.width / 2, y: t.y });
      }
    }
  }

  /** Sinking the ball in a lock is the jackpot: it is held for a beat and then
   *  fired back up through the ceiling, and the arena gets two balls for it. */
  private sink(b: T, i: number): boolean {
    for (const l of this.locks) {
      if (!l.armed || l.ball) continue;
      if (Math.hypot(b.x - l.x, b.y - l.y) > LOCK_R) continue;
      l.armed = false;
      l.ball = b;
      l.holdT = LOCK_HOLD;
      l.flash = 1;
      b.x = l.x;
      b.y = l.y;
      b.vx = 0;
      b.vy = 0;
      this.balls.splice(i, 1);
      this.events.push({ t: 'lockIn', x: l.x, y: l.y });
      return true;
    }
    return false;
  }

  private tickLocks(dt: number, escaped: T[]): void {
    for (const l of this.locks) {
      if (!l.ball) continue;
      l.holdT -= dt;
      if (l.holdT > 0) continue;
      const b = l.ball;
      l.ball = null;
      b.y = ARENA_H - b.r - 1;
      b.vx = 0;
      b.vy = -PINBALL_MAX_SPEED;
      escaped.push(b);
      // A lock is an escape like any other, only a much better paid one.
      this.events.push({ t: 'saved', x: l.x, pot: this.payout + POT_JACKPOT * this.potMul });
      this.pot = 0;
      this.events.push({ t: 'multiball', x: l.x, y: l.y });
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
      if (f.omega !== 0) for (const l of this.locks) l.armed = true;
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
      if (!this.cold) this.pot += POT_BUMPER;
      this.events.push({ t: 'bumper', x: p.x, y: p.y });
    }
  }
}
