import { Arena, type ArenaInput } from '../../core/arena';
import { RACE_LEVELS } from '../../core/campaignLevels';
import type { SuperId } from '../../core/supers';
import { CELLS_INTERVAL, SNAPSHOT_INTERVAL, type ArenaSnapshot } from '../../net/protocol';
import type { ArenaResult } from '../../net/showProtocol';
import { edgeOnce, FixedStepper } from '../stepper';

/** One arena of one round, for a human or a bot: steps the sim on a fixed
 *  tick, runs the clock, and settles into a result exactly once. */
export class ArenaRun {
  readonly arena: Arena;
  clock: number;
  done: ArenaResult | null = null;
  private readonly livesAtStart: number;
  private stepper = new FixedStepper();
  private snapTimer = 0;
  private cellsTimer = CELLS_INTERVAL;
  private lastCells = '';
  private seq = -1;

  constructor(levelIndex: number, seconds: number, superId?: SuperId) {
    const level = RACE_LEVELS[levelIndex] ?? RACE_LEVELS[0];
    this.arena = new Arena({ level, superId, mode: 'race', lives: 3 });
    this.livesAtStart = this.arena.lives;
    this.clock = seconds;
  }

  step(dt: number, input: ArenaInput): void {
    if (this.done) return;
    this.stepper.step(dt, (sdt, first) => this.arena.update(sdt, edgeOnce(input, first)));
    this.clock = Math.max(0, this.clock - dt);
    this.snapTimer += dt;
    this.cellsTimer += dt;
    const a = this.arena;
    if (a.state === 'cleared' || a.state === 'dead' || this.clock <= 0) {
      this.done = {
        cleared: a.state === 'cleared',
        died: a.state === 'dead',
        timeLeft: this.clock,
        bricks: a.bricksBroken,
        livesLost: Math.max(0, this.livesAtStart - a.lives),
      };
    }
  }

  snapshot(): ArenaSnapshot | null {
    if (this.snapTimer < SNAPSHOT_INTERVAL) return null;
    this.snapTimer = 0;
    const a = this.arena;
    let cells: string | undefined;
    if (this.cellsTimer >= CELLS_INTERVAL) {
      this.cellsTimer = 0;
      let s = '';
      for (let i = 0; i < a.grid.length; i++) { const b = a.grid[i]; s += b && b.alive ? b.kind.code : '0'; }
      if (s !== this.lastCells || this.lastCells === '') { this.lastCells = s; cells = s; }
    }
    return {
      cells, cols: a.cols, paddleX: Math.round(a.paddleX), paddleW: Math.round(a.paddleW),
      balls: a.balls.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })),
      score: a.score, lives: a.lives, xpLevel: a.xpLevel, combo: a.combo,
      energy: Math.round(a.energy), n: ++this.seq, clock: Math.round(this.clock),
    };
  }
}
