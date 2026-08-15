import {
  ARENA_H,
  ARENA_W,
  BALL_R,
  BALL_SPEED,
  BALL_SPEED_MAX,
  BRICK_H,
  brickWidthFor,
  COLS,
  GRID_LEFT,
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
import { Basement } from './basement';
import { avoidShallow, clamp, setSpeed } from './math';
import { Rng } from './rng';
import { BRICK_KINDS, type Brick, type BrickCode } from './bricks';
import { BALL_TYPES, type BallTypeId } from './balls';
import { DEBUFFS, type DebuffId } from './debuffs';
import { BOSSES, type BossDef, type BossId } from './bosses';
import { LOCKS_FOR_MULTIBALL, LOCK_HOLD, makeProp, type Prop } from './props';
import { SPEC_LEVEL, SPEC_LIST, SPECS, type SpecId } from './specialisation';
import { MAX_RANK, SKILLS, SKILL_SLOTS, skillCooldown, skillDuration, type SkillId } from './skills';
import { buildBricks, widenProps, breakableCount, type LevelData } from './level';
import { POWERUP_LIST, POWERUPS, type FallingPowerup, type PowerupId } from './powerups';
import { SUPERS, type SuperId } from './supers';
import { baseStats, rollPerks, xpForLevel, XP_RATE, type Perk, type RunStats } from './progression';

export type ArenaMode = 'solo' | 'versus' | 'race';

export type ArenaState = 'serve' | 'play' | 'levelup' | 'spec' | 'cleared' | 'dead';

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
  /** PvP sabotage the ball is carrying, and how long it holds it. */
  debuff: DebuffId | null;
  debuffT: number;
  /** Bricks broken since the last charge was fired at the opponent. */
  debuffCharge: number;
  /** Held by the boss: physics are suspended and it rides the boss's body. */
  captured: boolean;
  trail: { x: number; y: number }[];
}

export interface Laser {
  x: number;
  y: number;
  vy: number;
  /** Fired by the plasma barrage rather than by the laser pickup: it punches
   *  through indestructible bricks instead of dying on them. */
  plasma?: boolean;
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
  | { t: 'spec'; id: SpecId }
  | { t: 'skill'; id: SkillId; rank: number }
  | { t: 'bossHit'; x: number; y: number; color: string }
  | { t: 'bossPhase'; phase: 1 | 2 | 3 }
  | { t: 'bossGrab'; taken: boolean; x: number; y: number }
  | { t: 'prop'; kind: Prop['kind']; x: number; y: number; score: number }
  | { t: 'targetsDown'; x: number; y: number }
  | { t: 'multiball'; x: number; y: number }
  | { t: 'cellarPot'; x: number; y: number; amount: number; won: boolean; double?: boolean }
  | { t: 'slot'; kind: 'chips' | 'life' | 'pot' | 'super' | 'capsule' | 'bust'; x: number; y: number }
  | { t: 'bossShotHit'; x: number; y: number }
  | { t: 'bossDead'; id: BossId }
  | { t: 'attack'; power: number }
  | { t: 'debuffArmed'; id: DebuffId }
  | { t: 'debuffSent'; id: DebuffId }
  | { t: 'debuffHit'; id: DebuffId }
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
  /** Active skill slot fired this frame: 1 or 2, edge-triggered. */
  skill: 0 | 1 | 2;
}

export const noInput = (): ArenaInput => ({
  left: false,
  right: false,
  pointer: null,
  actionPressed: false,
  superPressed: false,
  pick: 0,
  skill: 0,
});

export interface ArenaOptions {
  level: LevelData;
  /** Opens the pinball floor under the arena: a ball past the paddle drops in
   *  there instead of being lost, and can be flipped back up. */
  basement?: boolean;
  seed?: number;
  superId?: SuperId;
  mode?: ArenaMode;
  lives?: number;
  /** Field width in arena units. Co-op plays on a double-width field. */
  width?: number;
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
  /** Active-skill effects. */
  magnetSkill: number;
  barrier: number;
  stasis: number;
  ghost: number;
  drone: number;
  /** PvP sabotage received from the opponent. */
  frost: number;
  brittle: number;
  repel: number;
  jam: number;
}

/** One equipped ability: what it is, how far it is upgraded, and how long until
 *  it can be used again. */
export interface SkillSlot {
  id: SkillId;
  rank: number;
  cd: number;
  /** Remaining effect time, for the skills that have one. */
  activeT: number;
}

export interface Fireball {
  x: number;
  y: number;
  vy: number;
  rank: number;
}

/** The boss fights back: it moves, shoots and pushes the field down as it dies. */
export interface BossState {
  def: BossDef;
  x: number;
  y: number;
  vx: number;
  hp: number;
  maxHp: number;
  /** 1 shielded, 2 shooting, 3 desperate. */
  phase: 1 | 2 | 3;
  fireTimer: number;
  pushTimer: number;
  hitFlash: number;
  dead: boolean;
  /** Seconds left of the ball grab, and whether it has been spent. */
  grabT: number;
  grabUsed: boolean;
}

export interface BossShot {
  x: number;
  y: number;
  vy: number;
}

/** Damage an explosive brick does to a boss it goes off against. Comparable to
 *  a super hit, so clearing a boss's shield with explosives is a real tactic. */
const EXPLOSION_BOSS_DAMAGE = 3;

/** The last boss grabs a ball when its health drops to this share, and holds it
 *  for this long. Once per fight. */
const BOSS_GRAB_AT = 0.2;
const BOSS_GRAB_SECONDS = 5;

/** A boss can only be hurt by a blast this often. One charge going off is a
 *  real hit; a chain reaction of nine is still one hit. Without this, the last
 *  boss melts the instant its shield drops, and its own dropped walls — which
 *  are deliberately full of charges — do the melting. */
const BOSS_BLAST_COOLDOWN = 0.25;

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
  magnetSkill: 0,
  barrier: 0,
  stasis: 0,
  ghost: 0,
  drone: 0,
  frost: 0,
  brittle: 0,
  repel: 0,
  jam: 0,
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
  /** Playfield width and its brick columns. Solo uses the module constants;
   *  co-op doubles both, so every position in here is measured against these
   *  fields rather than ARENA_W/COLS directly. */
  readonly width: number;
  readonly cols: number;
  /** Brick width for this field: the grid spans the gap between the walls, so a
   *  wider co-op field keeps the same column count per half. */
  readonly brickW: number;

  level: LevelData;
  bricks: Brick[] = [];
  grid: (Brick | null)[] = [];
  remaining = 0;

  paddleX = ARENA_W / 2;
  paddleW = PADDLE_W;
  paddleTargetW = PADDLE_W;
  shields = 0;

  /** Co-op: a second paddle on the same field, driven by the second player.
   *  Everything else — balls, lives, XP, super — stays shared. */
  coop = false;
  p2X = ARENA_W / 2 + 90;
  p2W = PADDLE_W;
  private input2: ArenaInput | null = null;

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
  /** Optional skill upgrade offered alongside the perks, in the last slot. */
  draftSkill: { id: SkillId; toRank: number } | null = null;
  draftTimer = 0;
  /** Chosen once per run at mastery level 5; tilts every later draft. */
  spec: SpecId | null = null;
  /** Rewards of the route this segment belongs to. Set by the campaign scene
   *  per level, so they swap cleanly at a fork instead of accumulating. */
  routeXpMul = 1;
  routeDropMul = 1;

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
  /** Equipped active abilities, up to SKILL_SLOTS of them. */
  skills: SkillSlot[] = [];
  fireballs: Fireball[] = [];
  /** Charges of the hammer buff waiting to be spent on a brick. */
  hammerHits = 0;
  droneTick = 0;
  /** How much width the brittle debuff has chewed off the paddle. */
  brittleWear = 0;
  boss: BossState | null = null;
  bossShots: BossShot[] = [];
  /** The pinball attic: bumpers and friends living in the upper rows. */
  props: Prop[] = [];
  /** Balls swallowed by locks. Two of them and the next one comes back with
   *  company — the oldest promise in pinball. */
  locked = 0;
  /** Seconds until the boss can be hurt by an explosion again. */
  private blastCd = 0;
  /** Admin cheat: losing the ball costs nothing and it is served straight back. */
  god = false;
  shake = 0;
  flash = 0;
  events: ArenaEvent[] = [];
  time = 0;
  /** Seconds spent on the current level. Feeds the time bonus and nothing else —
   *  it never pressures the player, it only rewards speed. */
  levelTime = 0;
  bricksBroken = 0;

  /** The pinball floor below, when the run was started with one. */
  readonly basement: Basement<Ball> | null;

  constructor(opts: ArenaOptions) {
    this.mode = opts.mode ?? 'solo';
    this.width = opts.width ?? ARENA_W;
    this.basement = opts.basement ? new Basement<Ball>(this.width, () => this.rng.next()) : null;
    this.cols = Math.round((this.width / ARENA_W) * COLS);
    this.brickW = brickWidthFor(this.width, this.cols);
    this.paddleX = this.width / 2;
    this.p2X = this.width / 2 + 90;
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
    this.boss = level.boss ? this.spawnBoss(BOSSES[level.boss]) : null;
    this.bossShots = [];
    this.bricks = buildBricks(level, this.cols, this.brickW);
    this.props = widenProps(level.props, this.cols).map((p) => makeProp(p, this.brickW));
    this.locked = 0;
    this.grid = new Array(this.cols * ROWS).fill(null);
    for (const b of this.bricks) this.grid[b.row * this.cols + b.col] = b;
    this.remaining = breakableCount(level, this.cols);
    this.powerups = [];
    this.lasers = [];
    this.balls = [];
    this.basement?.reset();
    this.timers = zeroTimers();
    this.active = null;
    this.state = 'serve';
    this.serveTimer = SERVE_DELAY;
    this.combo = 0;
    this.comboTimer = 0;
    this.levelTime = 0;
  }

  private spawnBoss(def: BossDef): BossState {
    return {
      def,
      x: this.width / 2,
      y: GRID_TOP - 6,
      vx: def.speed,
      hp: def.hp,
      maxHp: def.hp,
      phase: 1,
      fireTimer: 2,
      grabT: 0,
      grabUsed: false,
      pushTimer: 6,
      hitFlash: 0,
      dead: false,
    };
  }

  /** Bricks still standing in front of the boss shield it from damage. Garbage
   *  rows the boss itself drops do not count — otherwise its phase-3 pushes
   *  would restore the shield and the fight could never end. */
  get bossShielded(): boolean {
    if (!this.boss || !this.boss.def.shielded) return false;
    // A node shield hangs on a handful of marked cells, not on the whole field:
    // you hunt five bricks rather than clear a hundred, and the rows the boss
    // keeps dropping are cover for them rather than a wall you must mop up.
    if (this.boss.def.nodeShield) {
      return this.bricks.some((b) => b.alive && b.kind.code === 'k');
    }
    // Only the level's own bricks are a shield. Anything pushed in later — the
    // boss's own mixed wall, an opponent's steel row, a race card — must not
    // re-arm it: a boss that pushes every seven seconds would otherwise make
    // itself permanently invulnerable and the level unfinishable.
    return this.bricks.some((b) => b.alive && b.kind.hp > 0 && !b.pushed);
  }

  private updateBoss(dt: number): void {
    const boss = this.boss;
    if (!boss || boss.dead) return;

    boss.hitFlash = Math.max(0, boss.hitFlash - dt * 3);
    if (this.blastCd > 0) this.blastCd -= dt;
    const half = boss.def.w / 2;
    boss.x += boss.vx * dt;
    if (boss.x < WALL + half) {
      boss.x = WALL + half;
      boss.vx = Math.abs(boss.vx);
    } else if (boss.x > this.width - WALL - half) {
      boss.x = this.width - WALL - half;
      boss.vx = -Math.abs(boss.vx);
    }

    // Phase 1 is the shield: while bricks remain the boss only paces. Once the
    // field is clear it starts shooting, and below 30% it panics.
    const ratio = boss.hp / boss.maxHp;
    const phase: 1 | 2 | 3 = this.bossShielded ? 1 : ratio <= 0.3 ? 3 : 2;
    if (phase !== boss.phase) {
      boss.phase = phase;
      this.events.push({ t: 'bossPhase', phase });
      this.shake = Math.min(1, this.shake + 0.4);
      if (phase === 3) boss.vx = boss.vx > 0 ? boss.def.speed * 1.5 : -boss.def.speed * 1.5;
    }

    if (boss.phase >= 2 && boss.grabT <= 0) {
      boss.fireTimer -= dt;
      if (boss.fireTimer <= 0) {
        boss.fireTimer = boss.def.fireRate * (boss.phase === 3 ? 0.6 : 1);
        this.bossShots.push({ x: boss.x, y: boss.y + boss.def.h, vy: 260 });
        if (boss.phase === 3) {
          this.bossShots.push({ x: boss.x - 26, y: boss.y + boss.def.h, vy: 240 });
          this.bossShots.push({ x: boss.x + 26, y: boss.y + boss.def.h, vy: 240 });
        }
      }
    }

    // Some bosses grind rows down from the opening second; the rest only once
    // they are cornered.
    if (boss.phase === 3 || boss.def.pushesFromStart) {
      boss.pushTimer -= dt;
      if (boss.pushTimer <= 0) {
        boss.pushTimer = boss.phase === 3 ? boss.def.pushEvery * 0.7 : boss.def.pushEvery;
        this.pushGarbageRow();
      }
    }

    this.updateBossGrab(dt, ratio);
    this.updateBossShots(dt);
    this.collideBossWithBalls();
  }

  /** The last boss's one trick: at a fifth of its health it reaches out, takes
   *  a ball and holds it for five seconds. Once per fight, and while it holds
   *  on it stops shooting — it has its hands full, and the player needs to be
   *  able to read what is happening rather than just lose. */
  private updateBossGrab(dt: number, ratio: number): void {
    const boss = this.boss;
    if (!boss || !boss.def.grabsBall) return;

    if (boss.grabT > 0) {
      boss.grabT -= dt;
      const held = this.balls.find((b) => b.captured);
      if (held) {
        held.x = boss.x;
        held.y = boss.y + boss.def.h / 2;
        if (boss.grabT <= 0) {
          // Spat back out, straight down and fast: the ball comes back as a
          // problem, not as a gift.
          held.captured = false;
          held.vx = this.rng.range(-0.35, 0.35);
          held.vy = 1;
          setSpeed(held, held.baseSpeed * 1.35);
          avoidShallow(held);
          this.events.push({ t: 'bossGrab', taken: false, x: held.x, y: held.y });
        }
      } else {
        boss.grabT = 0;
      }
      return;
    }

    if (boss.grabUsed || ratio > BOSS_GRAB_AT) return;
    // Take the ball closest to the boss that is actually in play.
    let target: Ball | null = null;
    for (const b of this.balls) {
      if (b.held !== null || b.captured) continue;
      if (!target || Math.hypot(b.x - boss.x, b.y - boss.y) < Math.hypot(target.x - boss.x, target.y - boss.y)) {
        target = b;
      }
    }
    if (!target) return;
    boss.grabUsed = true;
    boss.grabT = BOSS_GRAB_SECONDS;
    target.captured = true;
    target.vx = 0;
    target.vy = 0;
    this.shake = 1;
    this.flash = 0.6;
    this.events.push({ t: 'bossGrab', taken: true, x: target.x, y: target.y });
  }

  /** The attic. Everything here happens to a ball that is already in flight:
   *  props never move and never fall, they only change where the ball goes and
   *  what it pays on the way. */
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

    for (const ball of this.balls) {
      if (ball.held !== null || ball.captured) continue;
      for (const p of this.props) {
        if (p.down || p.holdT > 0) continue;
        const dx = ball.x - p.x;
        const dy = ball.y - p.y;
        const reach = p.def.radius + ball.r;
        if (dx * dx + dy * dy > reach * reach) continue;
        this.hitProp(p, ball, dx, dy);
      }
    }
  }

  private hitProp(p: Prop, ball: Ball, dx: number, dy: number): void {
    p.flash = 1;
    const combo = 1 + Math.min(this.combo, COMBO_MAX) * 0.1;
    const score = Math.round(p.def.score * combo);
    this.score += score;
    this.energy = Math.min(ENERGY_MAX, this.energy + ENERGY_PER_DAMAGE * this.stats.energyMul);
    this.events.push({ t: 'prop', kind: p.kind, x: p.x, y: p.y, score });

    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    switch (p.kind) {
      case 'bumper': {
        // Straight back out along the normal, faster than it came in. Capped,
        // or a cluster of bumpers would launch the ball past playable speed.
        ball.vx = nx;
        ball.vy = ny;
        setSpeed(ball, Math.min(ball.baseSpeed * 1.35, BALL_SPEED_MAX));
        avoidShallow(ball);
        ball.x = p.x + nx * (p.def.radius + ball.r + 1);
        ball.y = p.y + ny * (p.def.radius + ball.r + 1);
        this.shake = Math.min(1, this.shake + 0.18);
        break;
      }
      case 'sling': {
        // Sideways, away from the field's centre: a sling should throw the ball
        // back into play rather than straight down.
        const outward = p.x < this.width / 2 ? 1 : -1;
        ball.vx = outward * 0.85 + nx * 0.4;
        ball.vy = ny >= 0 ? 0.5 : -0.5;
        setSpeed(ball, Math.min(ball.baseSpeed * 1.2, BALL_SPEED_MAX));
        avoidShallow(ball);
        ball.x = p.x + ball.vx * (p.def.radius + ball.r + 1);
        ball.y = p.y + ball.vy * (p.def.radius + ball.r + 1);
        break;
      }
      case 'spinner':
        // Passes straight through: the pay is for the crossing, not a bounce.
        p.spinRate = 14;
        break;
      case 'target':
        p.down = true;
        if (this.props.every((q) => q.kind !== 'target' || q.down)) {
          // A full set is worth going out of your way for.
          this.events.push({ t: 'targetsDown', x: p.x, y: p.y });
          this.dropReward(p.x, p.y);
        }
        break;
      case 'lock':
        // Swallowed. It comes back on its own, and the second one buys company.
        ball.captured = true;
        ball.vx = 0;
        ball.vy = 0;
        ball.x = p.x;
        ball.y = p.y;
        p.holdT = LOCK_HOLD;
        this.locked++;
        break;
    }
  }

  /** Spits a locked ball back into play, with company once enough have been
   *  swallowed. */
  private releaseLock(p: Prop): void {
    const ball = this.balls.find((b) => b.captured && Math.abs(b.x - p.x) < 2 && Math.abs(b.y - p.y) < 2);
    if (!ball) return;
    ball.captured = false;
    ball.vx = this.rng.range(-0.6, 0.6);
    ball.vy = 1;
    setSpeed(ball, ball.baseSpeed);
    avoidShallow(ball);
    if (this.locked >= LOCKS_FOR_MULTIBALL) {
      this.locked = 0;
      this.addBall();
      this.addBall();
      this.flash = 0.6;
    }
  }

  /** What a full set of drop targets pays: a capsule, dropped where the last
   *  one fell. */
  private dropReward(x: number, y: number): void {
    const pool = POWERUP_LIST.filter((d) => !d.bad && !d.pvpOnly && !d.raceOnly);
    const def = this.rng.pick(pool);
    this.powerups.push({
      id: def.id,
      def,
      x: x - POWERUP_W / 2,
      y,
      vy: POWERUP_FALL,
      spin: this.rng.range(0, 6.28),
    });
  }

  private updateBossShots(dt: number): void {
    const half = this.paddleW / 2;
    for (let i = this.bossShots.length - 1; i >= 0; i--) {
      const s = this.bossShots[i];
      s.y += s.vy * dt;
      if (s.y > ARENA_H) {
        this.bossShots.splice(i, 1);
        continue;
      }
      // A hit does not kill: it crushes the paddle for a few seconds, which is
      // punishing enough without ending the run outright.
      if (s.y >= PADDLE_Y && s.y <= PADDLE_Y + PADDLE_H && Math.abs(s.x - this.paddleX) <= half) {
        this.bossShots.splice(i, 1);
        this.timers.shrink = Math.max(this.timers.shrink, 5);
        this.timers.expand = 0;
        this.shake = Math.min(1, this.shake + 0.5);
        this.events.push({ t: 'bossShotHit', x: s.x, y: s.y });
      }
    }
  }

  private collideBossWithBalls(): void {
    const boss = this.boss;
    if (!boss || boss.dead) return;
    const half = boss.def.w / 2;

    for (const ball of this.balls) {
      // A captured ball rides inside the boss's body. Without this it would
      // register a collision every single frame and chew the boss to death in
      // a quarter of a second — the grab would be a gift, not a threat.
      if (ball.held !== null || ball.captured) continue;
      if (ball.x < boss.x - half - ball.r || ball.x > boss.x + half + ball.r) continue;
      if (ball.y + ball.r < boss.y || ball.y - ball.r > boss.y + boss.def.h) continue;

      // Bounce off regardless; damage only lands once the shield is gone.
      ball.vy = Math.abs(ball.vy);
      ball.y = boss.y + boss.def.h + ball.r;

      if (this.bossShielded) {
        this.events.push({ t: 'hit', x: ball.x, y: ball.y, color: '#5a6472' });
        continue;
      }

      // Everything that makes the ball hit harder applies to the boss as well.
      let dmg = this.stats.ballDamage + BALL_TYPES[ball.type].damage;
      if (ball.fireT > 0) dmg += 2;
      if (ball.pierceT > 0 || this.timers.pierce > 0) dmg += 1;
      if (this.stats.critChance > 0 && this.rng.chance(this.stats.critChance)) dmg *= 2;
      if (this.hammerHits > 0) {
        this.hammerHits--;
        dmg *= 5;
      }
      this.damageBoss(dmg, ball.x, ball.y);
    }
  }

  damageBoss(amount: number, x: number, y: number): void {
    const boss = this.boss;
    if (!boss || boss.dead || this.bossShielded) return;

    boss.hp -= amount;
    boss.hitFlash = 1;
    this.energy = Math.min(ENERGY_MAX, this.energy + ENERGY_PER_DAMAGE * 2 * this.stats.energyMul);
    this.addXp(12 * amount);
    this.score += Math.round(10 * amount);
    this.events.push({ t: 'bossHit', x, y, color: boss.def.color });

    if (boss.hp <= 0) {
      boss.hp = 0;
      boss.dead = true;
      this.bossShots = [];
      // Dying with a ball in its grip must not keep the ball: the boss stops
      // updating the moment it is dead, and the ball would hang there forever.
      if (boss.grabT > 0) {
        boss.grabT = 0;
        for (const b of this.balls) {
          if (!b.captured) continue;
          b.captured = false;
          b.vx = this.rng.range(-0.5, 0.5);
          b.vy = -1;
          setSpeed(b, b.baseSpeed);
          avoidShallow(b);
        }
      }
      this.shake = 1;
      this.flash = 1;
      this.addXp(600);
      this.score += 2000;
      this.lives += 1;
      // A guaranteed skill rank is the reward for a boss.
      const upgradable = this.skills.filter((s) => s.rank < MAX_RANK);
      if (upgradable.length) this.upgradeSkill(this.rng.pick(upgradable).id);
      this.events.push({ t: 'bossDead', id: boss.def.id });
    }
  }

  private cellAt(col: number, row: number): Brick | null {
    if (col < 0 || col >= this.cols || row < 0 || row >= ROWS) return null;
    const b = this.grid[row * this.cols + col];
    return b && b.alive ? b : null;
  }

  // ---------------------------------------------------------------- update --

  update(dt: number, input: ArenaInput, input2?: ArenaInput): void {
    if (this.state === 'dead' || this.state === 'cleared') return;
    this.input2 = input2 ?? null;
    this.time += dt;
    if (this.state === 'play' || this.state === 'serve') this.levelTime += dt;
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    if (this.state === 'levelup') {
      this.draftTimer = Math.max(0, this.draftTimer - dt);
      const options = this.draft.length + (this.draftSkill ? 1 : 0);
      if (input.pick > 0 && input.pick <= options) {
        this.pickDraft(input.pick - 1);
      } else if (this.draftTimer <= 0 && options > 0) {
        this.pickDraft(0);
      }
      return;
    }

    if (this.state === 'spec') {
      this.draftTimer = Math.max(0, this.draftTimer - dt);
      if (input.pick > 0 && input.pick <= SPEC_LIST.length) {
        this.pickSpec(input.pick - 1);
      } else if (this.draftTimer <= 0) {
        this.pickSpec(this.rng.int(0, SPEC_LIST.length));
      }
      return;
    }

    this.tickTimers(dt);
    this.tickSkills(dt);
    this.movePaddle(dt, input);

    // Either player may spend the shared super and the shared skill slots.
    if (input.superPressed || input2?.superPressed) this.fireSuper();
    const skillPressed = input.skill || input2?.skill || 0;
    if (skillPressed > 0) this.useSkill(skillPressed);
    this.updateSuper(dt);
    this.updateFireballs(dt);

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
    this.updateBasement(dt, input, input2);
    // After the balls have moved: the attic reacts to where they ended up.
    this.updateProps(dt);
    this.updateLasers(dt);
    this.updatePowerups(dt);
    this.updateBricks(dt);
    this.updateBoss(dt);

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // On a boss level clearing the bricks only strips the shield: the level
    // ends when the boss does.
    if (this.boss && !this.boss.dead) return;

    // And once it does, the level is over whatever is left standing. A boss
    // spends the fight dropping rows, so demanding an empty field afterwards
    // would mean mopping up its own debris to be allowed to win.
    if (this.boss?.dead && this.lives > 0) {
      this.state = 'cleared';
      this.events.push({ t: 'cleared' });
      return;
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
    // The paddle grows back once the brittle effect wears off.
    if (t.brittle <= 0 && this.brittleWear > 0) this.brittleWear = Math.max(0, this.brittleWear - dt * 18);
  }

  // --------------------------------------------------------------- paddle ---

  private targetWidth(): number {
    let w = PADDLE_W * this.stats.paddleWidthMul;
    if (this.timers.expand > 0) w *= 1.5;
    if (this.timers.shrink > 0) w *= 0.62;
    if (this.active?.id === 'fracture') w *= 1.55;
    // Stasis III widens the paddle for as long as time is slowed.
    if (this.timers.stasis > 0 && (this.skills.find((s) => s.id === 'stasis')?.rank ?? 0) >= 3) w *= 1.3;
    // Brittle: the paddle crumbles a little with every save while it lasts.
    if (this.brittleWear > 0) w -= this.brittleWear;
    return clamp(w, PADDLE_MIN_W, PADDLE_MAX_W);
  }

  private movePaddle(dt: number, input: ArenaInput): void {
    this.paddleTargetW = this.targetWidth();
    this.paddleW += (this.paddleTargetW - this.paddleW) * Math.min(1, dt * 9);

    const inverted = this.timers.invert > 0 ? -1 : 1;
    const speed = PADDLE_SPEED * this.stats.paddleSpeedMul * (this.timers.frost > 0 ? 0.45 : 1);

    if (input.pointer !== null) {
      // The paddle tracks the mouse 1:1. Rate-limiting it here felt like input
      // lag, which is fatal in a game about being under the ball in time.
      this.paddleX = this.timers.invert > 0 ? this.width - input.pointer : input.pointer;
    } else {
      let dir = 0;
      if (input.left) dir -= 1;
      if (input.right) dir += 1;
      this.paddleX += dir * inverted * speed * dt;
    }

    const half = this.paddleW / 2;
    this.paddleX = clamp(this.paddleX, WALL + half, this.width - WALL - half);

    if (this.coop) this.moveSecondPaddle(dt);

    // Held balls ride along with the paddle.
    for (const b of this.balls) {
      if (b.held !== null) {
        b.x = clamp(this.paddleX + b.held, WALL + b.r, this.width - WALL - b.r);
        b.y = PADDLE_Y - b.r - 1;
      }
    }
  }

  /** Co-op second paddle: keys only, same width rules, shares the field. */
  private moveSecondPaddle(dt: number): void {
    const input = this.input2;
    this.p2W += (this.paddleTargetW - this.p2W) * Math.min(1, dt * 9);
    if (!input) return;

    const speed = PADDLE_SPEED * this.stats.paddleSpeedMul * (this.timers.invert > 0 ? -1 : 1);
    let dir = 0;
    if (input.left) dir -= 1;
    if (input.right) dir += 1;
    this.p2X += dir * speed * dt;

    const half = this.p2W / 2;
    this.p2X = clamp(this.p2X, WALL + half, this.width - WALL - half);
  }

  // ----------------------------------------------------------------- balls --

  private ballSpeedMul(): number {
    let m = this.stats.ballSpeedMul;
    if (this.timers.stasis > 0) m *= 0.5;
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
      debuff: null,
      debuffT: 0,
      debuffCharge: 0,
      captured: false,
      trail: [],
    };
  }

  /** Loads every ball with a sabotage charge (PvP capsules). */
  setBallDebuff(id: DebuffId): void {
    const def = DEBUFFS[id];
    for (const b of this.balls) {
      b.debuff = id;
      b.debuffT = def.ballDuration;
      b.debuffCharge = 0;
    }
    this.events.push({ t: 'debuffArmed', id });
  }

  /** Sabotage arriving from the other player. */
  applyDebuff(id: DebuffId): void {
    const def = DEBUFFS[id];
    switch (id) {
      case 'frost':
        this.timers.frost = Math.max(this.timers.frost, def.duration);
        break;
      case 'mirror':
        this.timers.invert = Math.max(this.timers.invert, def.duration);
        break;
      case 'brittle':
        this.timers.brittle = Math.max(this.timers.brittle, def.duration);
        break;
      case 'repel':
        this.timers.repel = Math.max(this.timers.repel, def.duration);
        break;
      case 'blind':
        this.timers.fog = Math.max(this.timers.fog, def.duration);
        break;
      case 'haste':
        this.timers.haste = Math.max(this.timers.haste, def.duration);
        break;
      case 'jam':
        this.timers.jam = Math.max(this.timers.jam, def.duration);
        for (const slot of this.skills) slot.cd = Math.max(slot.cd, def.duration);
        break;
      case 'steel':
        this.pushGarbageRow('s');
        break;
      case 'quake':
        this.pushGarbageRow();
        this.shake = 1;
        break;
      case 'drain':
        this.energy = Math.max(0, this.energy - 45);
        break;
    }
    this.events.push({ t: 'debuffHit', id });
  }

  /** Recolours every ball in play and gives it an element for a while. */
  setBallType(id: BallTypeId): void {
    const def = BALL_TYPES[id];
    const mul = this.spec ? SPECS[this.spec].elementDurationMul ?? 1 : 1;
    for (const b of this.balls) {
      b.type = id;
      b.typeT = def.duration * mul;
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
      // A ball in the boss's grip has no physics: it is scenery until released.
      if (ball.captured) continue;
      if (ball.pierceT > 0) ball.pierceT -= dt;
      if (ball.fireT > 0) ball.fireT -= dt;
      if (ball.typeT > 0) {
        ball.typeT -= dt;
        if (ball.typeT <= 0) ball.type = 'normal';
      }
      if (ball.debuffT > 0) {
        ball.debuffT -= dt;
        if (ball.debuffT <= 0) {
          ball.debuff = null;
          ball.debuffCharge = 0;
        }
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
        const barrier = this.timers.barrier > 0;
        if (barrier || this.shields > 0) {
          if (!barrier) this.shields--;
          ball.y = ARENA_H - 26;
          ball.vy = -Math.abs(ball.vy);
          // Barrier III kicks the ball back up with extra pace.
          if (barrier && (this.skills.find((s) => s.id === 'barrier')?.rank ?? 0) >= 3) {
            ball.baseSpeed = Math.min(BALL_SPEED_MAX, ball.baseSpeed * 1.1);
          }
          this.events.push({ t: 'hit', x: ball.x, y: ARENA_H - 20, color: barrier ? '#3ddc84' : '#4de2ff' });
        } else if (this.basement) {
          // Not lost, only downstairs. The basement hands it back if the player
          // can flip it out through the ceiling.
          this.balls.splice(i, 1);
          this.basement.take(ball);
        } else {
          this.balls.splice(i, 1);
          this.events.push({ t: 'ballLost', x: ball.x });
        }
      }
    }

    // A ball still bouncing around the basement is still in play.
    if (this.balls.length === 0 && !this.basement?.busy && this.state === 'play') this.loseLife();
  }

  /** The pinball floor runs on the same keys as the paddle: while the ball is
   *  down there the paddle has nothing to do anyway. */
  private updateBasement(dt: number, input: ArenaInput, input2?: ArenaInput): void {
    const bs = this.basement;
    if (!bs) return;
    const left = input.left || input2?.left || false;
    const right = input.right || input2?.right || false;
    for (const ball of bs.update(dt, left, right)) {
      // Back upstairs with its own speed restored on the next frame.
      ball.y = ARENA_H - ball.r - 1;
      this.balls.push(ball);
    }
    for (const e of bs.drainEvents()) {
      switch (e.t) {
        case 'bumper':
          // Nothing down there pays on the spot — it all rides on the pot.
          this.events.push({ t: 'prop', kind: 'bumper', x: e.x, y: e.y, score: 0 });
          break;
        case 'target':
          this.events.push({ t: 'prop', kind: 'target', x: e.x, y: e.y, score: 0 });
          break;
        case 'word':
          this.events.push({ t: 'targetsDown', x: e.x, y: e.y });
          break;
        case 'spin':
          this.events.push({ t: 'prop', kind: 'spinner', x: bs.spinner.x, y: bs.spinner.y, score: 0 });
          break;
        case 'lockIn':
          this.events.push({ t: 'prop', kind: 'lock', x: e.x, y: e.y, score: 0 });
          break;
        case 'multiball': {
          // The ball is already on its way back up; it comes home with a twin.
          const twin = this.makeBall(e.x, ARENA_H - BALL_R - 2, 0);
          twin.vx = Math.abs(twin.vx) || 120;
          twin.vy = -Math.abs(twin.vy || 300);
          this.balls.push(twin);
          this.events.push({ t: 'multiball', x: e.x, y: e.y });
          break;
        }
        case 'saved':
          this.score += e.pot;
          this.addXp(e.pot / 8);
          this.events.push({
            t: 'cellarPot',
            x: e.x,
            y: ARENA_H - 40,
            amount: e.pot,
            won: true,
            double: e.double,
          });
          break;
        case 'prize':
          // The bandit pays in the arena's own currency; the pot ones it
          // settles for itself downstairs.
          if (e.kind === 'life') this.lives = Math.min(9, this.lives + 1);
          if (e.kind === 'super') this.energy = ENERGY_MAX;
          if (e.kind === 'capsule') this.dropReward(this.paddleX, GRID_TOP + 40);
          this.events.push({ t: 'slot', kind: e.kind, x: this.width / 2, y: ARENA_H - 60 });
          break;
        case 'lost':
          if (e.pot > 0) this.events.push({ t: 'cellarPot', x: e.x, y: ARENA_H - 40, amount: e.pot, won: false });
          this.events.push({ t: 'ballLost', x: e.x });
          if (this.balls.length === 0 && !bs.busy && this.state === 'play') this.loseLife();
          break;
        default:
          break;
      }
    }
  }

  private collideWalls(ball: Ball): void {
    if (ball.x - ball.r < WALL) {
      ball.x = WALL + ball.r;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + ball.r > this.width - WALL) {
      ball.x = this.width - WALL - ball.r;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y - ball.r < WALL) {
      ball.y = WALL + ball.r;
      ball.vy = Math.abs(ball.vy);
    }
  }

  private collidePaddle(ball: Ball): boolean {
    if (this.bouncePaddle(ball, this.paddleX, this.paddleW, '#8be9ff')) return true;
    if (this.coop && this.bouncePaddle(ball, this.p2X, this.p2W, '#ff5fa2')) return true;
    return false;
  }

  private bouncePaddle(ball: Ball, paddleX: number, paddleW: number, sparkColor: string): boolean {
    if (ball.vy <= 0) return false;
    const half = paddleW / 2;
    const left = paddleX - half;
    const top = PADDLE_Y;
    if (ball.y + ball.r < top || ball.y - ball.r > top + PADDLE_H) return false;
    if (ball.x + ball.r < left || ball.x - ball.r > left + paddleW) return false;

    ball.y = top - ball.r;
    let off = clamp((ball.x - paddleX) / half, -1, 1);
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
    this.events.push({ t: 'hit', x: ball.x, y: top, color: sparkColor });
    return true;
  }

  /** Void balls bend toward the nearest live brick instead of flying blind. */
  private voidPull(ball: Ball, dt: number): void {
    if (ball.vy > 0) return;
    let best: Brick | null = null;
    let bestD = Infinity;
    for (const b of this.bricks) {
      if (!b.alive || b.kind.hp < 0) continue;
      const dx = b.x + this.brickW / 2 - ball.x;
      const dy = b.y + BRICK_H / 2 - ball.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) return;
    const dir = best.x + this.brickW / 2 - ball.x;
    ball.vx += clamp(dir, -1, 1) * 110 * dt;
  }

  private collideBricks(ball: Ball): void {
    const element = BALL_TYPES[ball.type];
    const piercing = ball.pierceT > 0 || ball.fireT > 0 || this.timers.pierce > 0 || element.pierce;
    const minC = Math.floor((ball.x - ball.r - GRID_LEFT) / this.brickW) - 1;
    const maxC = Math.floor((ball.x + ball.r - GRID_LEFT) / this.brickW) + 1;
    const minR = Math.floor((ball.y - ball.r - GRID_TOP) / BRICK_H) - 1;
    const maxR = Math.floor((ball.y + ball.r - GRID_TOP) / BRICK_H) + 1;

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const brick = this.cellAt(c, r);
        if (!brick) continue;

        const cx = clamp(ball.x, brick.x, brick.x + this.brickW);
        const cy = clamp(ball.y, brick.y, brick.y + BRICK_H);
        const dx = ball.x - cx;
        const dy = ball.y - cy;
        if (dx * dx + dy * dy > ball.r * ball.r) continue;

        const indestructible = brick.kind.hp < 0;
        if (!piercing || indestructible) {
          // Reflect along the shallowest penetration axis.
          const overlapX = ball.r + this.brickW / 2 - Math.abs(ball.x - (brick.x + this.brickW / 2));
          const overlapY = ball.r + BRICK_H / 2 - Math.abs(ball.y - (brick.y + BRICK_H / 2));
          if (overlapX < overlapY) {
            ball.vx = ball.x < brick.x + this.brickW / 2 ? -Math.abs(ball.vx) : Math.abs(ball.vx);
            ball.x += ball.vx > 0 ? overlapX : -overlapX;
          } else {
            ball.vy = ball.y < brick.y + BRICK_H / 2 ? -Math.abs(ball.vy) : Math.abs(ball.vy);
            ball.y += ball.vy > 0 ? overlapY : -overlapY;
          }
        }

        let dmg = this.stats.ballDamage + element.damage;
        if (this.stats.critChance > 0 && this.rng.chance(this.stats.critChance)) dmg *= 2;
        if (ball.fireT > 0) dmg += 2;
        if (this.hammerHits > 0) {
          this.hammerHits--;
          dmg *= 5;
          if ((this.skills.find((s) => s.id === 'hammer')?.rank ?? 0) >= 3) this.explode(brick, 1.4);
        }
        const wasAlive = brick.alive;
        this.damageBrick(brick, dmg);
        // A sabotage ball builds a charge as it works; every few bricks the
        // effect ships to the opponent.
        if (ball.debuff && wasAlive && !brick.alive) {
          ball.debuffCharge++;
          if (ball.debuffCharge >= DEBUFFS[ball.debuff].perCharge) {
            ball.debuffCharge = 0;
            this.events.push({ t: 'debuffSent', id: ball.debuff });
          }
        }
        if (ball.fireT > 0) this.explode(brick, 1.1);
        this.elementalImpact(ball, brick);
        if (!piercing) return;
      }
    }
  }

  /** What each elemental ball does on top of plain damage. */
  private elementalImpact(ball: Ball, brick: Brick): void {
    const cx = brick.x + this.brickW / 2;
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
          this.events.push({ t: 'hit', x: b.x + this.brickW / 2, y: b.y + BRICK_H / 2, color: BALL_TYPES.plasma.color });
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
      this.events.push({ t: 'hit', x: brick.x + this.brickW / 2, y: brick.y + BRICK_H / 2, color: brick.kind.color });
      return;
    }
    brick.hp -= dmg;
    this.energy = Math.min(ENERGY_MAX, this.energy + ENERGY_PER_DAMAGE * this.stats.energyMul);

    if (brick.hp > 0) {
      this.events.push({ t: 'hit', x: brick.x + this.brickW / 2, y: brick.y + BRICK_H / 2, color: brick.kind.color });
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

    const cx = brick.x + this.brickW / 2;
    const cy = brick.y + BRICK_H / 2;
    this.events.push({ t: 'brick', x: cx, y: cy, color: brick.kind.color, big: brick.kind.xp >= 40 });
    this.shake = Math.min(1, this.shake + 0.12);

    // Faster ball as the field empties — keeps late rounds from dragging.
    if (this.bricksBroken % 8 === 0) {
      for (const b of this.balls) b.baseSpeed = Math.min(BALL_SPEED_MAX, b.baseSpeed + 4);
    }

    // Regenerators wear out: every revival takes longer, and after the last one
    // the brick stays down. Otherwise a regenerator walled in by indestructible
    // blocks could keep a level alive forever.
    if (brick.kind.regen && brick.regensLeft > 0) {
      const used = (brick.kind.regenLimit ?? 1) - brick.regensLeft;
      brick.regenTimer = brick.kind.regen * (1 + used * 0.6);
      brick.regensLeft--;
    }

    if (brick.kind.explodes || this.rng.chance(this.stats.explosiveTouch)) {
      this.explode(brick, 1.6);
    }

    this.rollDrop(brick, cx, cy);
  }

  private explode(brick: Brick, radiusCells: number): void {
    const cx = brick.x + this.brickW / 2;
    const cy = brick.y + BRICK_H / 2;
    this.events.push({ t: 'explosion', x: cx, y: cy, r: radiusCells * this.brickW });
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

    // A blast next to the boss hurts it too. Everything else in the game that
    // deals damage reaches the boss, and an explosive brick going off against
    // its hull obviously should — it also turns the wall a boss drops on itself
    // into a weapon.
    const boss = this.boss;
    if (boss && !boss.dead) {
      const radius = radiusCells * this.brickW;
      const nx = Math.max(boss.x - boss.def.w / 2, Math.min(cx, boss.x + boss.def.w / 2));
      const ny = Math.max(boss.y, Math.min(cy, boss.y + boss.def.h));
      const dx = cx - nx;
      const dy = cy - ny;
      if (dx * dx + dy * dy <= radius * radius && this.blastCd <= 0) {
        this.blastCd = BOSS_BLAST_COOLDOWN;
        this.damageBoss(EXPLOSION_BOSS_DAMAGE, cx, cy);
      }
    }
  }

  private rollDrop(brick: Brick, cx: number, cy: number): void {
    const chance = POWERUP_BASE_CHANCE * brick.kind.dropMul * this.stats.dropChanceMul * this.routeDropMul;
    if (!brick.kind.gift && !this.rng.chance(chance)) return;

    const pool: PowerupId[] = [];
    for (const def of POWERUP_LIST) {
      // Sabotage capsules exist only where there is someone to sabotage.
      if (def.pvpOnly && this.mode !== 'versus') continue;
      if (def.raceOnly && this.mode !== 'race') continue;
      for (let i = 0; i < def.weight; i++) pool.push(def.id);
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
    const magnetSkill =
      this.timers.magnetSkill > 0 ? ((this.skills.find((s) => s.id === 'magnet')?.rank ?? 1) >= 3 ? 2 : 1) : 0;
    const magnet = this.stats.magnet + (this.balls.some((b) => b.type === 'void') ? 0.6 : 0) + magnetSkill;

    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      p.y += p.vy * dt;
      p.spin += dt * 3;

      if (magnet > 0 && p.y > ARENA_H * 0.45) {
        const dx = this.paddleX - (p.x + POWERUP_W / 2);
        p.x += clamp(dx, -1, 1) * magnet * 130 * dt;
      }
      // Anti-magnet: capsules shy away from the paddle instead.
      if (this.timers.repel > 0) {
        const dx = this.paddleX - (p.x + POWERUP_W / 2);
        p.x -= clamp(dx, -1, 1) * 150 * dt;
        p.x = clamp(p.x, WALL, this.width - WALL - POWERUP_W);
      }

      const inRow = p.y + POWERUP_H >= PADDLE_Y && p.y <= PADDLE_Y + PADDLE_H;
      const caught =
        inRow &&
        ((p.x + POWERUP_W >= this.paddleX - half && p.x <= this.paddleX + half) ||
          // In co-op either paddle may catch the capsule.
          (this.coop && p.x + POWERUP_W >= this.p2X - this.p2W / 2 && p.x <= this.p2X + this.p2W / 2));

      if (caught) {
        this.collect(p.id, p.x + POWERUP_W / 2, p.y);
        this.powerups.splice(i, 1);
      } else if (p.y > ARENA_H) {
        this.powerups.splice(i, 1);
      }
    }
  }

  /** Admin cheat: hand the player a pickup without waiting for a drop. */
  grantPowerup(id: PowerupId): void {
    this.collect(id, this.paddleX, PADDLE_Y - 20);
  }

  /** Blows every energy node at once — what the ally's gift card does. Nothing
   *  else in the game can do this, which is the point of the card. */
  breakShieldNodes(): number {
    let broken = 0;
    for (const b of this.bricks) {
      if (!b.alive || b.kind.code !== 'k') continue;
      this.destroyBrick(b);
      broken++;
    }
    if (broken) {
      this.shake = 1;
      this.flash = 0.7;
    }
    return broken;
  }

  /** Admin cheat: wipe every breakable brick, ending the level immediately. */
  clearField(): void {
    for (const b of this.bricks) {
      if (b.alive && b.kind.hp > 0) this.destroyBrick(b);
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

      default:
        if (def.debuff) {
          if (this.balls.length === 0) this.addBall();
          this.setBallDebuff(def.debuff);
        }
        break;
    }
  }

  // ---------------------------------------------------------------- lasers --

  private fireLasers(): void {
    const half = this.paddleW / 2;
    this.lasers.push({ x: this.paddleX - half + 5, y: PADDLE_Y, vy: -LASER_SPEED });
    this.lasers.push({ x: this.paddleX + half - 5, y: PADDLE_Y, vy: -LASER_SPEED });
  }

  /** True when a projectile at (x, y) is inside the boss body. */
  private hitsBoss(x: number, y: number): boolean {
    const boss = this.boss;
    if (!boss || boss.dead) return false;
    return (
      Math.abs(x - boss.x) <= boss.def.w / 2 && y >= boss.y && y <= boss.y + boss.def.h
    );
  }

  private updateLasers(dt: number): void {
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.y += l.vy * dt;
      if (l.y < 0) {
        this.lasers.splice(i, 1);
        continue;
      }
      // Lasers, the barrage super and the drone all hurt the boss too.
      if (this.hitsBoss(l.x, l.y)) {
        this.damageBoss(this.spec ? SPECS[this.spec].laserDamage ?? 1 : 1, l.x, l.y);
        this.lasers.splice(i, 1);
        continue;
      }
      const col = Math.floor((l.x - GRID_LEFT) / this.brickW);
      const row = Math.floor((l.y - GRID_TOP) / BRICK_H);
      const brick = this.cellAt(col, row);
      if (brick) {
        this.damageBrick(brick, this.spec ? SPECS[this.spec].laserDamage ?? 1 : 1);
        // Plasma goes through an indestructible block rather than dying on it —
        // otherwise a single row of them shrugs off the whole super, and the
        // bricks sheltering behind the wall are the ones you needed to reach.
        if (!(l.plasma && brick.kind.hp < 0)) this.lasers.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- skills --

  equipSkills(ids: (SkillId | null)[], ranks: Partial<Record<SkillId, number>> = {}): void {
    this.skills = ids
      .filter((id): id is SkillId => id !== null)
      .slice(0, SKILL_SLOTS)
      .map((id) => {
        const rank = Math.min(MAX_RANK, Math.max(1, ranks[id] ?? 1));
        // A skill marked for warm-up opens the level charging rather than
        // loaded: the heavy openers should be earned inside the level. Ranks
        // shorten the wait along with the cooldown they came from.
        const cd = SKILLS[id].warmup ? skillCooldown(SKILLS[id], rank) : 0;
        return { id, rank, cd, activeT: 0 };
      });
  }

  upgradeSkill(id: SkillId): void {
    const slot = this.skills.find((s) => s.id === id);
    if (slot && slot.rank < MAX_RANK) slot.rank++;
  }

  private tickSkills(dt: number): void {
    for (const slot of this.skills) {
      if (slot.cd > 0) slot.cd = Math.max(0, slot.cd - dt);
      if (slot.activeT > 0) slot.activeT = Math.max(0, slot.activeT - dt);
    }

    // Drone fires on its own while its timer runs.
    if (this.timers.drone > 0) {
      const rank = this.skills.find((s) => s.id === 'drone')?.rank ?? 1;
      this.droneTick -= dt;
      if (this.droneTick <= 0) {
        this.droneTick = rank >= 2 ? 0.28 : 0.55;
        this.lasers.push({ x: this.paddleX, y: PADDLE_Y - 24, vy: -LASER_SPEED });
        if (rank >= 3) this.lasers.push({ x: this.width - this.paddleX, y: PADDLE_Y - 24, vy: -LASER_SPEED });
      }
    }

    // Ghost paddle mirrors the player and can rescue a ball on the far side.
    if (this.timers.ghost > 0) {
      const gx = this.width - this.paddleX;
      const half = this.paddleW / 2;
      for (const ball of this.balls) {
        if (ball.held !== null || ball.vy <= 0) continue;
        if (ball.y + ball.r < PADDLE_Y || ball.y - ball.r > PADDLE_Y + PADDLE_H) continue;
        if (Math.abs(ball.x - gx) > half) continue;
        const off = clamp((ball.x - gx) / half, -1, 1);
        const angle = off * PADDLE_MAX_BOUNCE;
        ball.vx = Math.sin(angle);
        ball.vy = -Math.cos(angle);
        ball.y = PADDLE_Y - ball.r;
        this.events.push({ t: 'hit', x: ball.x, y: PADDLE_Y, color: '#7c6cff' });
      }
    }
  }

  private updateFireballs(dt: number): void {
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.y += f.vy * dt;
      if (f.y < -20) {
        this.fireballs.splice(i, 1);
        continue;
      }
      // A fireball carries its multiplier into the boss as well.
      if (this.hitsBoss(f.x, f.y)) {
        this.damageBoss(f.rank >= 3 ? 12 : f.rank >= 2 ? 8 : 4, f.x, f.y);
        this.fireballs.splice(i, 1);
        continue;
      }

      const radius = f.rank >= 2 ? 1 : 0;
      const col = Math.floor((f.x - GRID_LEFT) / this.brickW);
      const row = Math.floor((f.y - GRID_TOP) / BRICK_H);
      for (let c = col - radius; c <= col + radius; c++) {
        const brick = this.cellAt(c, row);
        if (!brick) continue;
        if (brick.kind.hp < 0) {
          // Rank III is the only thing in the game that breaks indestructible blocks.
          if (f.rank >= 3) {
            brick.alive = false;
            this.grid[brick.row * this.cols + brick.col] = null;
            this.events.push({ t: 'brick', x: brick.x + this.brickW / 2, y: brick.y + BRICK_H / 2, color: '#ffffff', big: true });
            this.shake = Math.min(1, this.shake + 0.3);
          }
          continue;
        }
        this.damageBrick(brick, f.rank >= 2 ? 3 : 1);
      }
    }
  }

  /** Fires the ability in the given slot (1-based), if it is off cooldown. */
  useSkill(slotIndex: number): void {
    const slot = this.skills[slotIndex - 1];
    if (!slot || slot.cd > 0 || this.state !== 'play') return;
    const def = SKILLS[slot.id];
    const rank = slot.rank;
    slot.cd = skillCooldown(def, rank);
    slot.activeT = skillDuration(def, rank);
    this.events.push({ t: 'skill', id: slot.id, rank });

    switch (slot.id) {
      case 'magnet':
        this.timers.magnetSkill = skillDuration(def, rank);
        break;

      case 'fireball':
        this.fireballs.push({ x: this.paddleX, y: PADDLE_Y - 10, vy: -520, rank });
        break;

      case 'teleport': {
        const target = this.balls.reduce<Ball | null>((m, b) => (!m || b.y > m.y ? b : m), null);
        if (target) {
          this.paddleX = clamp(target.x, WALL + this.paddleW / 2, this.width - WALL - this.paddleW / 2);
          if (rank >= 2) target.baseSpeed = Math.max(120, target.baseSpeed * 0.85);
          if (rank >= 3) {
            target.vx = 0;
            target.vy = -1;
          }
        }
        break;
      }

      case 'barrier':
        this.timers.barrier = skillDuration(def, rank);
        break;

      case 'stasis':
        this.timers.stasis = skillDuration(def, rank);
        break;

      case 'ghost':
        this.timers.ghost = skillDuration(def, rank);
        break;

      case 'drone':
        this.timers.drone = skillDuration(def, rank);
        this.droneTick = 0;
        break;

      case 'hammer':
        this.hammerHits = rank >= 2 ? 3 : 1;
        break;

      case 'chain': {
        // Lightning arcs into the boss as well, not just the bricks.
        if (this.boss && !this.boss.dead) {
          this.damageBoss(rank >= 2 ? 6 : 3, this.boss.x, this.boss.y + this.boss.def.h / 2);
        }
        const live = this.bricks.filter((b) => b.alive && b.kind.hp > 0);
        const count = rank >= 2 ? 9 : 5;
        for (const brick of this.rng.shuffled(live).slice(0, count)) {
          this.damageBrick(brick, 2);
          this.events.push({ t: 'hit', x: brick.x + this.brickW / 2, y: brick.y + BRICK_H / 2, color: '#c46bff' });
          if (rank >= 3) this.explode(brick, 1);
        }
        break;
      }

      case 'repair':
        this.lives += rank >= 3 ? 2 : 1;
        break;

      case 'rain': {
        const count = rank >= 2 ? 10 : 6;
        for (let i = 0; i < count; i++) {
          const pool = POWERUP_LIST.filter((d) => !d.bad);
          const def2 = rank >= 3 && i === 0 ? POWERUPS.ballLava : this.rng.pick(pool);
          this.powerups.push({
            id: def2.id,
            def: def2,
            x: this.rng.range(WALL, this.width - WALL - POWERUP_W),
            y: -this.rng.range(0, 160),
            vy: POWERUP_FALL,
            spin: this.rng.range(0, 6.28),
          });
        }
        break;
      }

      case 'glue':
        this.timers.catch = Math.max(this.timers.catch, skillDuration(def, rank));
        if (rank >= 3) this.stats.ballDamage += 0.25;
        break;

      case 'multiball': {
        const extra = rank >= 2 ? 4 : 2;
        for (let i = 0; i < extra; i++) this.addBall();
        // Rank III sends the new balls out already carrying an element.
        if (rank >= 3) {
          const ids: BallTypeId[] = ['lava', 'aqua', 'laser', 'plasma', 'void'];
          this.setBallType(this.rng.pick(ids));
        }
        break;
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
    this.active = { id: this.superId, t: def.duration, tick: 0, x: this.width / 2, y: GRID_TOP + 60 };
    this.events.push({ t: 'super', id: this.superId });

    switch (this.superId) {
      case 'meteor':
        for (const b of this.balls) b.fireT = def.duration;
        if (this.balls.length < 2) this.addBall();
        break;
      case 'singularity': {
        // Centre the black hole on the densest cluster of live bricks. Counting
        // neighbours through the grid keeps this linear — comparing every brick
        // against every other one used to stall the game once garbage rows had
        // piled hundreds of them up.
        let best = { x: this.width / 2, y: GRID_TOP + 80, n: -1 };
        for (const b of this.bricks) {
          if (!b.alive) continue;
          let n = 0;
          for (let dr = -3; dr <= 3; dr++) {
            for (let dc = -3; dc <= 3; dc++) {
              if (dc * dc + dr * dr > 9) continue;
              if (this.cellAt(b.col + dc, b.row + dr)) n++;
            }
          }
          if (n > best.n) best = { x: b.x + this.brickW / 2, y: b.y + BRICK_H / 2, n };
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
      this.lasers.push({ x, y: PADDLE_Y, vy: -LASER_SPEED * 1.3, plasma: true });
      this.lasers.push({ x: this.width - x, y: PADDLE_Y, vy: -LASER_SPEED * 1.3, plasma: true });
    }

    if (a.id === 'singularity' && a.tick <= 0) {
      a.tick = 0.18;
      const radius = 84;
      // The black hole chews on the boss too if it drifts into range.
      if (this.boss && !this.boss.dead) {
        const bx = this.boss.x;
        const by = this.boss.y + this.boss.def.h / 2;
        if (Math.hypot(bx - a.x, by - a.y) <= radius + this.boss.def.w / 2) {
          this.damageBoss(2, bx, by);
        }
      }
      for (const b of this.bricks) {
        if (!b.alive) continue;
        const dx = b.x + this.brickW / 2 - a.x;
        const dy = b.y + BRICK_H / 2 - a.y;
        if (dx * dx + dy * dy > radius * radius) continue;
        if (b.kind.hp < 0) {
          // A black hole does not care how sturdy a block claims to be. This is
          // the answer to regenerators sealed inside indestructible pockets.
          b.alive = false;
          this.grid[b.row * this.cols + b.col] = null;
          this.events.push({ t: 'brick', x: b.x + this.brickW / 2, y: b.y + BRICK_H / 2, color: '#b06bff', big: true });
        } else {
          this.damageBrick(b, 1);
        }
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
  pushGarbageRow(forceCode?: BrickCode): void {
    const sorted = this.bricks.filter((b) => b.alive).sort((a, b) => b.row - a.row);
    let crushed = false;
    for (const b of sorted) {
      this.grid[b.row * this.cols + b.col] = null;
      if (b.row + 1 >= ROWS) {
        b.alive = false;
        if (b.kind.hp > 0) this.remaining--;
        crushed = true;
        continue;
      }
      b.row += 1;
      b.y += BRICK_H;
      this.grid[b.row * this.cols + b.col] = b;
    }

    // Boss pushes bring a mixed wall rather than a grey slab of garbage, and it
    // is thick with charges: a blast reaches the boss, so the wall it drops on
    // itself is also the player's way back into the fight.
    const palette: BrickCode[] = forceCode
      ? [forceCode]
      : this.boss
        ? ['b', 'n', 'n', 't', 'e', 'e', 'e', 's', 'g', 'r']
        : ['b'];

    for (let c = 0; c < this.cols; c++) {
      if (this.rng.chance(0.12)) continue;
      const kind = BRICK_KINDS[this.rng.pick(palette)];
      const brick: Brick = {
        col: c,
        row: 0,
        x: GRID_LEFT + c * this.brickW,
        y: GRID_TOP,
        kind,
        hp: kind.hp,
        alive: true,
        regenTimer: 0,
        regensLeft: 0,
        flash: 1,
        pushed: true,
      };
      this.bricks.push(brick);
      this.grid[c] = brick;
      this.remaining++;
    }

    // Drop bricks that are dead for good, or a long fight would keep growing the
    // array with every garbage row.
    this.bricks = this.bricks.filter((b) => b.alive || b.regenTimer > 0);

    this.events.push({ t: 'garbage' });
    this.shake = Math.min(1, this.shake + 0.4);
    if (crushed) this.loseLife();
  }

  // -------------------------------------------------------------------- xp --

  addXp(amount: number): void {
    const gain = amount * this.stats.xpMul * this.routeXpMul * XP_RATE;
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

    // Level 5 is the fork in the build: pick a specialisation instead of a perk.
    if (this.xpLevel >= SPEC_LEVEL && !this.spec) {
      this.draftTimer = 12;
      this.state = 'spec';
      return;
    }

    this.draft = rollPerks(this.rng, this.perksTaken, 3, this.spec ? SPECS[this.spec].favours : []);

    // An upgradable skill can take one of the three slots in the draft, so the
    // abilities grow through the same choices as everything else.
    const upgradable = this.skills.filter((s) => s.rank < MAX_RANK);
    if (upgradable.length && this.draft.length === 3 && this.rng.chance(0.45)) {
      const slot = this.rng.pick(upgradable);
      this.draftSkill = { id: slot.id, toRank: slot.rank + 1 };
      this.draft.pop();
    } else {
      this.draftSkill = null;
    }

    if (this.draft.length > 0 || this.draftSkill) {
      this.draftTimer = 8;
      this.state = 'levelup';
    }
  }

  pickSpec(index: number): void {
    const def = SPEC_LIST[index];
    if (!def || this.spec) return;
    this.spec = def.id;
    def.apply(this.stats);
    this.shields += def.id === 'warden' ? 2 : 0;
    if (def.id === 'warden') this.lives += 2;
    this.events.push({ t: 'spec', id: def.id });
    this.state = this.balls.length > 0 ? 'play' : 'serve';
  }

  /** Draft slots are the perks first, then the optional skill upgrade. */
  pickDraft(index: number): void {
    if (index === this.draft.length && this.draftSkill) {
      this.upgradeSkill(this.draftSkill.id);
      this.events.push({ t: 'skill', id: this.draftSkill.id, rank: this.draftSkill.toRank });
      this.draft = [];
      this.draftSkill = null;
      this.state = this.balls.length > 0 ? 'play' : 'serve';
      return;
    }
    this.pickPerk(index);
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
    this.draftSkill = null;
    this.state = this.balls.length > 0 ? 'play' : 'serve';
  }

  // ------------------------------------------------------------------ life --

  private loseLife(): void {
    this.basement?.clear();
    if (this.god) {
      this.balls = [];
      this.state = 'serve';
      this.serveTimer = 0.2;
      return;
    }
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
