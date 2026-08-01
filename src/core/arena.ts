import {
  ARENA_H,
  ARENA_W,
  BALL_R,
  BALL_SPEED,
  BALL_SPEED_MAX,
  BRICK_H,
  BRICK_W,
  COLS,
  COMBO_MAX,
  COMBO_WINDOW,
  ENERGY_MAX,
  ENERGY_PER_DAMAGE,
  ENERGY_PER_POWERUP,
  GRID_TOP,
  LASER_COOLDOWN,
  LASER_SPEED,
  PADDLE_H,
  PADDLE_MAX_BOUNCE,
  PADDLE_MAX_W,
  PADDLE_MIN_W,
  PADDLE_SPEED,
  PADDLE_W,
  PADDLE_Y,
  POWERUP_BASE_CHANCE,
  POWERUP_FALL,
  POWERUP_H,
  POWERUP_W,
  ROWS,
  SERVE_DELAY,
  START_LIVES,
  WALL,
} from './constants';
import { avoidShallow, clamp, setSpeed } from './math';
import { Rng } from './rng';
import { BRICK_KINDS, type Brick } from './bricks';
import { BALL_TYPES, type BallTypeId } from './balls';
import { buildBricks, breakableCount, type LevelData } from './level';
import { POWERUP_LIST, POWERUPS, type FallingPowerup, type PowerupId } from './powerups';
import { SUPERS, type SuperId } from './supers';
import { baseStats, rollPerks, xpForLevel, XP_RATE, type Perk, type RunStats } from './progression';

export type ArenaMode = 'solo' | 'versus';

export type ArenaState = 'serve' | 'play' | 'levelup' | 'cleared' | 'dead';

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseSpeed: number;
  /** Offset from paddle centre while held by a sticky paddle, or null. */
  held: number | null;
  pierceT: number;
  fireT: number;
  /** Elemental state: drives the ball's colour and what its hits do. */
  type: BallTypeId;
  typeT: number;
  trail: { x: number; y: number }[];
}

export interface Laser {
  x: number;
  y: number;
  vy: number;
}

export type ArenaEvent =
  | { t: 'brick'; x: number; y: number; color: string; big: boolean }
  | { t: 'hit'; x: number; y: number; color: string }
  | { t: 'explosion'; x: number; y: number; r: number }
  | { t: 'powerup'; id: PowerupId; x: number; y: number }
  | { t: 'ballLost'; x: number }
  | { t: 'lifeLost' }
  | { t: 'levelup'; level: number }
  | { t: 'super'; id: SuperId }
  | { t: 'ballType'; id: BallTypeId }
  | { t: 'attack'; power: number }
  | { t: 'cleared' }
  | { t: 'dead' }
  | { t: 'garbage' };

export interface ArenaInput {
  left: boolean;
  right: boolean;
  /** Absolute target position in arena units (mouse), or null for keys only. */
  pointer: number | null;
  /** Serve / fire, edge-triggered. */
  actionPressed: boolean;
  superPressed: boolean;
  /** Perk draft choice 1..3, edge-triggered. */
  pick: 0 | 1 | 2 | 3;
}

export const noInput = (): ArenaInput => ({
  left: false,
  right: false,
  pointer: null,
  actionPressed: false,
  superPressed: false,
  pick: 0,
});

export interface ArenaOptions {
  level: LevelData;
  seed?: number;
  superId?: SuperId;
  mode?: ArenaMode;
  lives?: number;
  /** Carried between campaign levels. */
  stats?: RunStats;
  perksTaken?: Map<string, number>;
  xpTotal?: number;
  xpLevel?: number;
  score?: number;
}

interface Timers {
  expand: number;
  shrink: number;
  laser: number;
  catch: number;
  slow: number;
  speed: number;
  pierce: number;
  /** Incoming sabotage from the opponent. */
  invert: number;
  fog: number;
  haste: number;
}

const zeroTimers = (): Timers => ({
  expand: 0,
  shrink: 0,
  laser: 0,
  catch: 0,
  slow: 0,
  speed: 0,
  pierce: 0,
  invert: 0,
  fog: 0,
  haste: 0,
});

export interface SuperState {
  id: SuperId;
  t: number;
  /** Barrage fire timer / singularity pulse timer. */
  tick: number;
  x: number;
  y: number;
}

/** One player's playfield: fully deterministic given the same seed and inputs. */
export class Arena {
  readonly mode: ArenaMode;
  readonly rng: Rng;
  readonly seed: number;

  level: LevelData;
  bricks: Brick[] = [];
  grid: (Brick | null)[] = [];
  remaining = 0;

  paddleX = ARENA_W / 2;
  paddleW = PADDLE_W;
  paddleTargetW = PADDLE_W;
  shields = 0;

  balls: Ball[] = [];
  powerups: FallingPowerup[] = [];
  lasers: Laser[] = [];
  laserCooldown = 0;

  lives = START_LIVES;
  score = 0;
  state: ArenaState = 'serve';
  serveTimer = SERVE_DELAY;

  stats: RunStats;
  perksTaken = new Map<string, number>();
  draft: Perk[] = [];
  draftTimer = 0;

  xpTotal = 0;
  xpLevel = 1;
  xpInto = 0;
  xpNeed = xpForLevel(1);
  /** XP earned this run — what the account profile banks afterwards. */
  xpEarned = 0;

  combo = 0;
  comboTimer = 0;

  energy = 0;
  superId: SuperId;
  active: SuperState | null = null;

  timers = zeroTimers();
  shake = 0;
  flash = 0;
  events: ArenaEvent[] = [];
  time = 0;
  bricksBroken = 0;

  constructor(opts: ArenaOptions) {
    this.mode = opts.mode ?? 'solo';
    this.seed = opts.seed ?? (Date.now() >>> 0);
    this.rng = new Rng(this.seed);
    this.superId = opts.superId ?? 'barrage';
    this.stats = opts.stats ?? baseStats();
    if (opts.perksTaken) this.perksTaken = new Map(opts.perksTaken);
    this.xpTotal = opts.xpTotal ?? 0;
    this.xpLevel = opts.xpLevel ?? 1;
    this.xpNeed = xpForLevel(this.xpLevel);
    this.score = opts.score ?? 0;
    this.level = opts.level;
    this.lives = (opts.lives ?? START_LIVES) + this.stats.bonusLives;
    this.shields = this.stats.bonusShields;
    this.loadLevel(opts.level);
  }

  // ---------------------------------------------------------------- level ---

  loadLevel(level: LevelData): void {
    this.level = level;
    this.bricks = buildBricks(level);
    this.grid = new Array(COLS * ROWS).fill(null);
    for (const b of this.bricks) this.grid[b.row * COLS + b.col] = b;
    this.remaining = breakableCount(level);
    this.powerups = [];
    this.lasers = [];
    this.balls = [];
    this.timers = zeroTimers();
    this.active = null;
    this.state = 'serve';
    this.serveTimer = SERVE_DELAY;
    this.combo = 0;
    this.comboTimer = 0;
  }

  private cellAt(col: number, row: number): Brick | null {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    const b = this.grid[row * COLS + col];
    return b && b.alive ? b : null;
  }

  // ---------------------------------------------------------------- update --

  update(dt: number, input: ArenaInput): void {
    if (this.state === 'dead' || this.state === 'cleared') return;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    if (this.state === 'levelup') {
      this.draftTimer = Math.max(0, this.draftTimer - dt);
      if (input.pick > 0 && input.pick <= this.draft.length) {
        this.pickPerk(input.pick - 1);
      } else if (this.draftTimer <= 0 && this.draft.length > 0) {
        this.pickPerk(0);
      }
      return;
    }

    this.tickTimers(dt);
    this.movePaddle(dt, input);

    if (input.superPressed) this.fireSuper();
    this.updateSuper(dt);

    if (this.state === 'serve') {
      this.serveTimer -= dt;
      if (this.balls.length === 0 && this.serveTimer <= 0) this.spawnServeBalls();
      if (this.balls.length > 0 && (input.actionPressed || this.serveTimer < -3)) {
        this.releaseHeldBalls();
        this.state = 'play';
      }
    } else if (input.actionPressed) {
      this.releaseHeldBalls();
    }

    if (this.timers.laser > 0 || this.stats.laserAlways) {
      this.laserCooldown -= dt;
      if (input.actionPressed && this.laserCooldown <= 0) {
        this.fireLasers();
        this.laserCooldown = LASER_COOLDOWN;
      }
    }

    this.updateBalls(dt);
    this.updateLasers(dt);
    this.updatePowerups(dt);
    this.updateBricks(dt);

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // Losing the last ball on the same tick that empties the field counts as death.
    if (this.remaining <= 0 && this.lives > 0) {
      this.state = 'cleared';
      this.events.push({ t: 'cleared' });
    }
  }

  private tickTimers(dt: number): void {
    const t = this.timers;
    for (const key of Object.keys(t) as (keyof Timers)[]) {
      if (t[key] > 0) t[key] = Math.max(0, t[key] - dt);
    }
  }

  // --------------------------------------------------------------- paddle ---

  private targetWidth(): number {
    let w = PADDLE_W * this.stats.paddleWidthMul;
    if (this.timers.expand > 0) w *= 1.5;
    if (this.timers.shrink > 0) w *= 0.62;
    if (this.active?.id === 'fracture') w *= 1.55;
    return clamp(w, PADDLE_MIN_W, PADDLE_MAX_W);
  }

  private movePaddle(dt: number, input: ArenaInput): void {
    this.paddleTargetW = this.targetWidth();
    this.paddleW += (this.paddleTargetW - this.paddleW) * Math.min(1, dt * 9);

    const inverted = this.timers.invert > 0 ? -1 : 1;
    const speed = PADDLE_SPEED * this.stats.paddleSpeedMul;

    if (input.pointer !== null) {
      const target = this.timers.invert > 0 ? ARENA_W - input.pointer : input.pointer;
      const d = target - this.paddleX;
      const step = speed * 1.7 * dt;
      this.paddleX += clamp(d, -step, step);
    } else {
      let dir = 0;
      if (input.left) dir -= 1;
      if (input.right) dir += 1;
      this.paddleX += dir * inverted * speed * dt;
    }

    const half = this.paddleW / 2;
    this.paddleX = clamp(this.paddleX, WALL + half, ARENA_W - WALL - half);

    // Held balls ride along with the paddle.
    for (const b of this.balls) {
      if (b.held !== null) {
        b.x = clamp(this.paddleX + b.held, WALL + b.r, ARENA_W - WALL - b.r);
        b.y = PADDLE_Y - b.r - 1;
      }
    }
  }

  // ----------------------------------------------------------------- balls --

  private ballSpeedMul(): number {
    let m = this.stats.ballSpeedMul;
    if (this.timers.slow > 0) m *= 0.65;
    if (this.timers.speed > 0) m *= 1.3;
    if (this.timers.haste > 0) m *= 1.35;
    if (this.active?.id === 'fracture') m *= 0.45;
    return m;
  }

  private makeBall(x: number, y: number, held: number | null): Ball {
    return {
      x,
      y,
      vx: 0,
      vy: -1,
      r: BALL_R,
      baseSpeed: BALL_SPEED * (this.level.ballSpeed ?? 1),
      held,
      pierceT: 0,
      fireT: 0,
      type: 'normal',
      typeT: 0,
      trail: [],
    };
  }

  /** Recolours every ball in play and gives it an element for a while. */
  setBallType(id: BallTypeId): void {
    const def = BALL_TYPES[id];
    for (const b of this.balls) {
      b.type = id;
      b.typeT = def.duration;
    }
    this.events.push({ t: 'ballType', id });
  }

  private spawnServeBalls(): void {
    const count = 1 + this.stats.extraBalls;
    for (let i = 0; i < count; i++) {
      const off = count === 1 ? 0 : (i - (count - 1) / 2) * 26;
      this.balls.push(this.makeBall(this.paddleX + off, PADDLE_Y - BALL_R - 1, off));
    }
  }

  private releaseHeldBalls(): void {
    let any = false;
    for (const b of this.balls) {
      if (b.held === null) continue;
      const off = clamp(b.held / (this.paddleW / 2), -1, 1);
      const angle = off * PADDLE_MAX_BOUNCE;
      b.vx = Math.sin(angle);
      b.vy = -Math.cos(angle);
      b.held = null;
      any = true;
    }
    if (any && this.state === 'serve') this.state = 'play';
  }

  /** Adds an extra ball in play (multiball, perks). */
  addBall(): void {
    const src = this.balls.find((b) => b.held === null) ?? this.balls[0];
    const b = this.makeBall(src?.x ?? this.paddleX, src?.y ?? PADDLE_Y - 20, null);
    const a = this.rng.range(-0.9, 0.9);
    b.vx = Math.sin(a);
    b.vy = -Math.abs(Math.cos(a));
    if (src) b.baseSpeed = src.baseSpeed;
    this.balls.push(b);
    if (this.state === 'serve') this.state = 'play';
  }

  private updateBalls(dt: number): void {
    const globalMul = this.ballSpeedMul();

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      if (ball.pierceT > 0) ball.pierceT -= dt;
      if (ball.fireT > 0) ball.fireT -= dt;
      if (ball.typeT > 0) {
        ball.typeT -= dt;
        if (ball.typeT <= 0) ball.type = 'normal';
      }
      if (ball.held !== null) continue;

      if (ball.type === 'void') this.voidPull(ball, dt);
      const speed = clamp(ball.baseSpeed * globalMul * BALL_TYPES[ball.type].speed, 60, BALL_SPEED_MAX);
      setSpeed(ball, speed);
      avoidShallow(ball);

      // Sub-step so a fast ball can never tunnel through a brick row.
      const dist = speed * dt;
      const steps = Math.max(1, Math.ceil(dist / (BALL_R * 0.75)));
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        ball.x += ball.vx * sdt;
        ball.y += ball.vy * sdt;
        this.collideWalls(ball);
        this.collideBricks(ball);
        if (this.collidePaddle(ball)) break;
      }

      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 9) ball.trail.shift();

      if (ball.y - ball.r > ARENA_H) {
        if (this.shields > 0) {
          this.shields--;
          ball.y = ARENA_H - 26;
          ball.vy = -Math.abs(ball.vy);
          this.events.push({ t: 'hit', x: ball.x, y: ARENA_H - 20, color: '#4de2ff' });
        } else {
          this.balls.splice(i, 1);
          this.events.push({ t: 'ballLost', x: ball.x });
        }
      }
    }

    if (this.balls.length === 0 && this.state === 'play') this.loseLife();
  }

  private collideWalls(ball: Ball): void {
    if (ball.x - ball.r < WALL) {
      ball.x = WALL + ball.r;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + ball.r > ARENA_W - WALL) {
      ball.x = ARENA_W - WALL - ball.r;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y - ball.r < WALL) {
      ball.y = WALL + ball.r;
      ball.vy = Math.abs(ball.vy);
    }
  }

  private collidePaddle(ball: Ball): boolean {
    if (ball.vy <= 0) return false;
    const half = this.paddleW / 2;
    const left = this.paddleX - half;
    const top = PADDLE_Y;
    if (ball.y + ball.r < top || ball.y - ball.r > top + PADDLE_H) return false;
    if (ball.x + ball.r < left || ball.x - ball.r > left + this.paddleW) return false;

    ball.y = top - ball.r;
    let off = clamp((ball.x - this.paddleX) / half, -1, 1);
    // A perfectly centred hit would send the ball straight up forever; nudge it
    // so a vertical corridor can never turn into a stalemate.
    if (Math.abs(off) < 0.05) off += this.rng.range(-0.09, 0.09);
    const angle = off * PADDLE_MAX_BOUNCE;
    ball.vx = Math.sin(angle);
    ball.vy = -Math.cos(angle);
    if (this.timers.catch > 0) {
      ball.held = clamp(ball.x - this.paddleX, -half, half);
    }
    // Losing the ball ends the combo, but so does a lazy rally: bricks pay, not bounces.
    this.events.push({ t: 'hit', x: ball.x, y: top, color: '#8be9ff' });
    return true;
  }

  /** Void balls bend toward the nearest live brick instead of flying blind. */
  private voidPull(ball: Ball, dt: number): void {
    if (ball.vy > 0) return;
    let best: Brick | null = null;
    let bestD = Infinity;
    for (const b of this.bricks) {
      if (!b.alive || b.kind.hp < 0) continue;
      const dx = b.x + BRICK_W / 2 - ball.x;
      const dy = b.y + BRICK_H / 2 - ball.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) return;
    const dir = best.x + BRICK_W / 2 - ball.x;
    ball.vx += clamp(dir, -1, 1) * 110 * dt;
  }

  private collideBricks(ball: Ball): void {
    const element = BALL_TYPES[ball.type];
    const piercing = ball.pierceT > 0 || ball.fireT > 0 || this.timers.pierce > 0 || element.pierce;
    const minC = Math.floor((ball.x - ball.r) / BRICK_W) - 1;
    const maxC = Math.floor((ball.x + ball.r) / BRICK_W) + 1;
    const minR = Math.floor((ball.y - ball.r - GRID_TOP) / BRICK_H) - 1;
    const maxR = Math.floor((ball.y + ball.r - GRID_TOP) / BRICK_H) + 1;

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const brick = this.cellAt(c, r);
        if (!brick) continue;

        const cx = clamp(ball.x, brick.x, brick.x + BRICK_W);
        const cy = clamp(ball.y, brick.y, brick.y + BRICK_H);
        const dx = ball.x - cx;
        const dy = ball.y - cy;
        if (dx * dx + dy * dy > ball.r * ball.r) continue;

        const indestructible = brick.kind.hp < 0;
        if (!piercing || indestructible) {
          // Reflect along the shallowest penetration axis.
          const overlapX = ball.r + BRICK_W / 2 - Math.abs(ball.x - (brick.x + BRICK_W / 2));
          const overlapY = ball.r + BRICK_H / 2 - Math.abs(ball.y - (brick.y + BRICK_H / 2));
          if (overlapX < overlapY) {
            ball.vx = ball.x < brick.x + BRICK_W / 2 ? -Math.abs(ball.vx) : Math.abs(ball.vx);
            ball.x += ball.vx > 0 ? overlapX : -overlapX;
          } else {
            ball.vy = ball.y < brick.y + BRICK_H / 2 ? -Math.abs(ball.vy) : Math.abs(ball.vy);
            ball.y += ball.vy > 0 ? overlapY : -overlapY;
          }
        }

        let dmg = this.stats.ballDamage + element.damage;
        if (this.stats.critChance > 0 && this.rng.chance(this.stats.critChance)) dmg *= 2;
        if (ball.fireT > 0) dmg += 2;
        this.damageBrick(brick, dmg);
        if (ball.fireT > 0) this.explode(brick, 1.1);
        this.elementalImpact(ball, brick);
        if (!piercing) return;
      }
    }
  }

  /** What each elemental ball does on top of plain damage. */
  private elementalImpact(ball: Ball, brick: Brick): void {
    const cx = brick.x + BRICK_W / 2;
    const cy = brick.y + BRICK_H / 2;

    switch (ball.type) {
      case 'lava':
        this.explode(brick, 1.2);
        break;

      case 'aqua': {
        // A wave washes sideways along the row.
        for (const dc of [-2, -1, 1, 2]) {
          const other = this.cellAt(brick.col + dc, brick.row);
          if (other) this.damageBrick(other, Math.abs(dc) === 1 ? 1 : 0.5);
        }
        this.events.push({ t: 'hit', x: cx, y: cy, color: BALL_TYPES.aqua.color });
        break;
      }

      case 'laser':
        this.lasers.push({ x: cx - 7, y: cy, vy: -LASER_SPEED });
        this.lasers.push({ x: cx + 7, y: cy, vy: -LASER_SPEED });
        break;

      case 'plasma': {
        // Chain lightning to the two closest live bricks.
        const targets = this.bricks
          .filter((b) => b.alive && b !== brick && b.kind.hp > 0)
          .map((b) => ({ b, d: (b.col - brick.col) ** 2 + (b.row - brick.row) ** 2 }))
          .filter((t) => t.d <= 16)
          .sort((a, z) => a.d - z.d)
          .slice(0, 2);
        for (const { b } of targets) {
          this.damageBrick(b, 1);
          this.events.push({ t: 'hit', x: b.x + BRICK_W / 2, y: b.y + BRICK_H / 2, color: BALL_TYPES.plasma.color });
        }
        break;
      }

      case 'void':
      case 'normal':
        break;
    }
  }

  // ---------------------------------------------------------------- bricks --

  private updateBricks(dt: number): void {
    for (const b of this.bricks) {
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 4);
      if (!b.alive && b.regenTimer > 0) {
        b.regenTimer -= dt;
        if (b.regenTimer <= 0) {
          b.alive = true;
          b.hp = b.kind.hp;
          this.remaining++;
        }
      }
    }
  }

  damageBrick(brick: Brick, dmg: number): void {
    if (!brick.alive) return;
    brick.flash = 1;
    if (brick.kind.hp < 0) {
      this.events.push({ t: 'hit', x: brick.x + BRICK_W / 2, y: brick.y + BRICK_H / 2, color: brick.kind.color });
      return;
    }
    brick.hp -= dmg;
    this.energy = Math.min(ENERGY_MAX, this.energy + ENERGY_PER_DAMAGE * this.stats.energyMul);

    if (brick.hp > 0) {
      this.events.push({ t: 'hit', x: brick.x + BRICK_W / 2, y: brick.y + BRICK_H / 2, color: brick.kind.color });
      return;
    }
    this.destroyBrick(brick);
  }

  private destroyBrick(brick: Brick): void {
    brick.alive = false;
    this.remaining--;
    this.bricksBroken++;

    this.combo = Math.min(COMBO_MAX + this.stats.comboBonus, this.combo + 1);
    this.comboTimer = COMBO_WINDOW;

    const mul = 1 + this.combo * 0.12;
    this.addXp(brick.kind.xp * mul);
    this.score += Math.round(brick.kind.xp * mul);

    const cx = brick.x + BRICK_W / 2;
    const cy = brick.y + BRICK_H / 2;
    this.events.push({ t: 'brick', x: cx, y: cy, color: brick.kind.color, big: brick.kind.xp >= 40 });
    this.shake = Math.min(1, this.shake + 0.12);

    // Faster ball as the field empties — keeps late rounds from dragging.
    if (this.bricksBroken % 8 === 0) {
      for (const b of this.balls) b.baseSpeed = Math.min(BALL_SPEED_MAX, b.baseSpeed + 4);
    }

    if (brick.kind.regen) {
      brick.regenTimer = brick.kind.regen;
    }

    if (brick.kind.explodes || this.rng.chance(this.stats.explosiveTouch)) {
      this.explode(brick, 1.6);
    }

    this.rollDrop(brick, cx, cy);
  }

  private explode(brick: Brick, radiusCells: number): void {
    const cx = brick.x + BRICK_W / 2;
    const cy = brick.y + BRICK_H / 2;
    this.events.push({ t: 'explosion', x: cx, y: cy, r: radiusCells * BRICK_W });
    this.shake = Math.min(1, this.shake + 0.3);
    const rc = Math.ceil(radiusCells);
    for (let r = brick.row - rc; r <= brick.row + rc; r++) {
      for (let c = brick.col - rc; c <= brick.col + rc; c++) {
        const other = this.cellAt(c, r);
        if (!other || other === brick) continue;
        const dc = c - brick.col;
        const dr = r - brick.row;
        if (dc * dc + dr * dr > radiusCells * radiusCells + 0.5) continue;
        this.damageBrick(other, 2);
      }
    }
  }

  private rollDrop(brick: Brick, cx: number, cy: number): void {
    const chance = POWERUP_BASE_CHANCE * brick.kind.dropMul * this.stats.dropChanceMul;
    if (!brick.kind.gift && !this.rng.chance(chance)) return;

    const pool: PowerupId[] = [];
    for (const def of POWERUP_LIST) {
      const w = def.bad ? def.weight : def.weight;
      for (let i = 0; i < w; i++) pool.push(def.id);
    }
    const id = this.rng.pick(pool);
    this.powerups.push({
      id,
      def: POWERUPS[id],
      x: cx - POWERUP_W / 2,
      y: cy,
      vy: POWERUP_FALL,
      spin: this.rng.range(0, 6.28),
    });
  }

  // -------------------------------------------------------------- powerups --

  private updatePowerups(dt: number): void {
    const half = this.paddleW / 2;
    // A void ball drags capsules toward the paddle even without the magnet perk.
    const magnet = this.stats.magnet + (this.balls.some((b) => b.type === 'void') ? 0.6 : 0);

    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      p.y += p.vy * dt;
      p.spin += dt * 3;

      if (magnet > 0 && p.y > ARENA_H * 0.45) {
        const dx = this.paddleX - (p.x + POWERUP_W / 2);
        p.x += clamp(dx, -1, 1) * magnet * 130 * dt;
      }

      const caught =
        p.y + POWERUP_H >= PADDLE_Y &&
        p.y <= PADDLE_Y + PADDLE_H &&
        p.x + POWERUP_W >= this.paddleX - half &&
        p.x <= this.paddleX + half;

      if (caught) {
        this.collect(p.id, p.x + POWERUP_W / 2, p.y);
        this.powerups.splice(i, 1);
      } else if (p.y > ARENA_H) {
        this.powerups.splice(i, 1);
      }
    }
  }

  private collect(id: PowerupId, x: number, y: number): void {
    const def = POWERUPS[id];
    this.events.push({ t: 'powerup', id, x, y });
    this.energy = Math.min(ENERGY_MAX, this.energy + ENERGY_PER_POWERUP * this.stats.energyMul);
    this.score += 25;

    switch (id) {
      case 'expand':
        this.timers.expand = def.duration!;
        this.timers.shrink = 0;
        break;
      case 'shrink':
        this.timers.shrink = def.duration!;
        this.timers.expand = 0;
        break;
      case 'multiball':
        this.addBall();
        this.addBall();
        break;
      case 'laser':
        this.timers.laser = def.duration!;
        break;
      case 'catch':
        this.timers.catch = def.duration!;
        break;
      case 'slow':
        this.timers.slow = def.duration!;
        this.timers.speed = 0;
        break;
      case 'speed':
        this.timers.speed = def.duration!;
        this.timers.slow = 0;
        break;
      case 'life':
        this.lives++;
        break;
      case 'shield':
        this.shields++;
        break;
      case 'pierce':
        this.timers.pierce = def.duration!;
        break;
      case 'xp':
        this.addXp(120 * this.stats.xpMul);
        break;
      case 'energy':
        this.energy = Math.min(ENERGY_MAX, this.energy + 35);
        break;
      case 'ballLava':
      case 'ballAqua':
      case 'ballLaser':
      case 'ballPlasma':
      case 'ballVoid':
        if (this.balls.length === 0) this.addBall();
        this.setBallType(def.ball!);
        break;
    }
  }

  // ---------------------------------------------------------------- lasers --

  private fireLasers(): void {
    const half = this.paddleW / 2;
    this.lasers.push({ x: this.paddleX - half + 5, y: PADDLE_Y, vy: -LASER_SPEED });
    this.lasers.push({ x: this.paddleX + half - 5, y: PADDLE_Y, vy: -LASER_SPEED });
  }

  private updateLasers(dt: number): void {
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.y += l.vy * dt;
      if (l.y < 0) {
        this.lasers.splice(i, 1);
        continue;
      }
      const col = Math.floor(l.x / BRICK_W);
      const row = Math.floor((l.y - GRID_TOP) / BRICK_H);
      const brick = this.cellAt(col, row);
      if (brick) {
        this.damageBrick(brick, 1);
        this.lasers.splice(i, 1);
      }
    }
  }

  // ----------------------------------------------------------------- супер --

  get superReady(): boolean {
    return this.energy >= ENERGY_MAX && !this.active;
  }

  fireSuper(): void {
    if (!this.superReady || this.state !== 'play') return;
    const def = SUPERS[this.superId];
    this.energy = 0;
    this.flash = 1;
    this.shake = 1;
    this.active = { id: this.superId, t: def.duration, tick: 0, x: ARENA_W / 2, y: GRID_TOP + 60 };
    this.events.push({ t: 'super', id: this.superId });

    switch (this.superId) {
      case 'meteor':
        for (const b of this.balls) b.fireT = def.duration;
        if (this.balls.length < 2) this.addBall();
        break;
      case 'singularity': {
        // Centre the black hole on the densest cluster of live bricks.
        let best = { x: ARENA_W / 2, y: GRID_TOP + 80, n: -1 };
        for (const b of this.bricks) {
          if (!b.alive) continue;
          let n = 0;
          for (const o of this.bricks) {
            if (!o.alive) continue;
            const dx = o.col - b.col;
            const dy = o.row - b.row;
            if (dx * dx + dy * dy <= 9) n++;
          }
          if (n > best.n) best = { x: b.x + BRICK_W / 2, y: b.y + BRICK_H / 2, n };
        }
        this.active.x = best.x;
        this.active.y = best.y;
        break;
      }
      case 'fracture':
      case 'barrage':
        break;
    }

    // Versus: every super also hurts the other side.
    this.events.push({ t: 'attack', power: 1 });
  }

  private updateSuper(dt: number): void {
    const a = this.active;
    if (!a) return;
    a.t -= dt;
    a.tick -= dt;

    if (a.id === 'barrage' && a.tick <= 0) {
      a.tick = 0.1;
      const half = this.paddleW / 2;
      const x = this.paddleX + this.rng.range(-half, half);
      this.lasers.push({ x, y: PADDLE_Y, vy: -LASER_SPEED * 1.3 });
      this.lasers.push({ x: ARENA_W - x, y: PADDLE_Y, vy: -LASER_SPEED * 1.3 });
    }

    if (a.id === 'singularity' && a.tick <= 0) {
      a.tick = 0.18;
      const radius = 84;
      for (const b of this.bricks) {
        if (!b.alive || b.kind.hp < 0) continue;
        const dx = b.x + BRICK_W / 2 - a.x;
        const dy = b.y + BRICK_H / 2 - a.y;
        if (dx * dx + dy * dy <= radius * radius) this.damageBrick(b, 1);
      }
      this.shake = Math.min(1, this.shake + 0.15);
    }

    if (a.t <= 0) this.active = null;
  }

  /** Sabotage arriving from the opponent in versus play. */
  receiveAttack(power: number): void {
    const def = SUPERS[this.superId];
    void def;
    for (let i = 0; i < power; i++) this.pushGarbageRow();
  }

  applyHazard(kind: 'invert' | 'fog' | 'haste', seconds: number): void {
    this.timers[kind] = Math.max(this.timers[kind], seconds);
  }

  /** Shove the whole field down one row and add a garbage row on top.
   *  Anything pushed past the bottom row crushes the player for a life. */
  pushGarbageRow(): void {
    const sorted = this.bricks.filter((b) => b.alive).sort((a, b) => b.row - a.row);
    let crushed = false;
    for (const b of sorted) {
      this.grid[b.row * COLS + b.col] = null;
      if (b.row + 1 >= ROWS) {
        b.alive = false;
        if (b.kind.hp > 0) this.remaining--;
        crushed = true;
        continue;
      }
      b.row += 1;
      b.y += BRICK_H;
      this.grid[b.row * COLS + b.col] = b;
    }

    for (let c = 0; c < COLS; c++) {
      if (this.rng.chance(0.12)) continue;
      const kind = BRICK_KINDS.b;
      const brick: Brick = {
        col: c,
        row: 0,
        x: c * BRICK_W,
        y: GRID_TOP,
        kind,
        hp: kind.hp,
        alive: true,
        regenTimer: 0,
        flash: 1,
      };
      this.bricks.push(brick);
      this.grid[c] = brick;
      this.remaining++;
    }

    this.events.push({ t: 'garbage' });
    this.shake = Math.min(1, this.shake + 0.4);
    if (crushed) this.loseLife();
  }

  // -------------------------------------------------------------------- xp --

  addXp(amount: number): void {
    const gain = amount * this.stats.xpMul * XP_RATE;
    this.xpTotal += gain;
    this.xpEarned += gain;
    this.xpInto += gain;
    while (this.xpInto >= this.xpNeed) {
      this.xpInto -= this.xpNeed;
      this.xpLevel++;
      this.xpNeed = xpForLevel(this.xpLevel);
      this.onLevelUp();
    }
  }

  private onLevelUp(): void {
    if (this.stats.lifePerLevel) this.lives++;
    this.energy = Math.min(ENERGY_MAX, this.energy + 15);
    this.events.push({ t: 'levelup', level: this.xpLevel });
    this.draft = rollPerks(this.rng, this.perksTaken);
    if (this.draft.length > 0) {
      this.draftTimer = 8;
      this.state = 'levelup';
    }
  }

  pickPerk(index: number): void {
    const perk = this.draft[index];
    if (!perk) return;
    perk.apply(this.stats);
    this.perksTaken.set(perk.id, (this.perksTaken.get(perk.id) ?? 0) + 1);
    if (perk.instant?.lives) this.lives += perk.instant.lives;
    if (perk.instant?.energy) this.energy = Math.min(ENERGY_MAX, this.energy + perk.instant.energy);
    if (perk.instant?.balls) this.addBall();
    if (perk.id === 'bulwark') this.shields += 2;
    this.draft = [];
    this.state = this.balls.length > 0 ? 'play' : 'serve';
  }

  // ------------------------------------------------------------------ life --

  private loseLife(): void {
    this.lives--;
    this.combo = 0;
    this.timers = zeroTimers();
    this.active = null;
    this.powerups = [];
    this.lasers = [];
    this.events.push({ t: 'lifeLost' });
    this.shake = 1;
    if (this.lives <= 0) {
      this.state = 'dead';
      this.events.push({ t: 'dead' });
      return;
    }
    this.balls = [];
    this.state = 'serve';
    this.serveTimer = SERVE_DELAY;
  }

  drainEvents(): ArenaEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
