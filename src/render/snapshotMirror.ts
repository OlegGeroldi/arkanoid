import { ARENA_H, ARENA_W, BRICK_H, GRID_LEFT, GRID_TOP, PADDLE_H, PADDLE_Y, ROWS, WALL, brickWidthFor } from '../core/constants';
import { BRICK_KINDS, isBrickCode } from '../core/bricks';
import { SNAPSHOT_INTERVAL, type ArenaSnapshot } from '../net/protocol';
import { FONT } from './renderer';

/** Interpolated playback of a live field's snapshots, for a TV mirroring an
 *  arena from periodic `ArenaSnapshot`s.
 *
 *  Two snapshots are kept, not one: drawing the newest one as it arrives
 *  means the ball teleports twenty times a second, which reads as lag even
 *  though nothing is late. Playing back one interval behind and
 *  interpolating between the pair makes the motion continuous, and costs
 *  only the interval itself in delay. */
export class SnapshotMirror {
  prev: ArenaSnapshot | null = null;
  current: ArenaSnapshot | null = null;
  /** Seconds since `current` arrived. */
  age = 0;
  /** The gap `current` arrived after — how long to spread the interpolation
   *  over. Widens on its own if the sender starts sending less often. */
  gap = SNAPSHOT_INTERVAL;

  /** Feeds a new snapshot in. Out-of-order packets are dropped rather than
   *  rewound — a frame of the past is worse than a frame of nothing. */
  push(snap: ArenaSnapshot): void {
    if (this.current && snap.n <= this.current.n) return;
    if (!snap.cells && this.current?.cells) snap.cells = this.current.cells;
    if (this.current) this.gap = Math.min(0.5, Math.max(0.02, this.age));
    this.prev = this.current;
    this.current = snap;
    this.age = 0;
  }

  tick(dt: number): void {
    this.age += dt;
  }

  reset(): void {
    this.prev = null;
    this.current = null;
    this.age = 0;
    this.gap = SNAPSHOT_INTERVAL;
  }
}

/** Paints the mirrored field into a fresh `ARENA_W`×`ARENA_H` canvas region
 *  (caller translates/clips beforehand). `waitingLabel` is shown until the
 *  first snapshot arrives. */
export function drawSnapshotMirror(
  ctx: CanvasRenderingContext2D,
  mirror: SnapshotMirror,
  accent: string,
  waitingLabel: string,
): void {
  ctx.save();
  ctx.fillStyle = '#0a0f1f';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.fillStyle = '#16203c';
  ctx.fillRect(0, 0, WALL, ARENA_H);
  ctx.fillRect(ARENA_W - WALL, 0, WALL, ARENA_H);
  ctx.fillRect(0, 0, ARENA_W, WALL);

  const snap = mirror.current;
  if (!snap) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(waitingLabel, ARENA_W / 2, ARENA_H / 2);
    ctx.restore();
    return;
  }

  const a = Math.max(0, Math.min(1, mirror.age / mirror.gap));
  const from = mirror.prev ?? snap;
  const lerp = (x: number, y: number): number => x + (y - x) * a;

  const bw = brickWidthFor(ARENA_W, snap.cols);
  const cells = snap.cells ?? '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < snap.cols; c++) {
      const ch = cells[r * snap.cols + c];
      if (!ch || !isBrickCode(ch)) continue;
      const kind = BRICK_KINDS[ch];
      ctx.fillStyle = kind.color;
      ctx.globalAlpha = 0.62;
      ctx.beginPath();
      ctx.roundRect(GRID_LEFT + c * bw + 1.5, GRID_TOP + r * BRICK_H + 1.5, bw - 3, BRICK_H - 3, 3);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  const paddleX = lerp(from.paddleX, snap.paddleX);
  const paddleW = lerp(from.paddleW, snap.paddleW);
  ctx.fillStyle = accent;
  ctx.fillRect(paddleX - paddleW / 2, PADDLE_Y, paddleW, PADDLE_H);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 12;
  for (let i = 0; i < snap.balls.length; i++) {
    const to = snap.balls[i];
    const was = from.balls[i];
    const x = was ? lerp(was.x, to.x) : to.x;
    const y = was ? lerp(was.y, to.y) : to.y;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  const ms = Math.round(mirror.age * 1000);
  const rate = Math.round(1 / Math.max(0.02, mirror.gap));
  ctx.textAlign = 'right';
  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = ms > 400 ? '#ff4d6d' : 'rgba(255,255,255,0.35)';
  ctx.fillText(`картинка: ${ms} мс · ${rate} кадров/с`, ARENA_W - 12, ARENA_H - 12);
  if (ms > 500) {
    ctx.fillStyle = '#ff4d6d';
    ctx.fillText('окно игрока не в фокусе?', ARENA_W - 12, ARENA_H - 26);
  }
  ctx.restore();
}
