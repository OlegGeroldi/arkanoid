import { ARENA_H, ARENA_W, BRICK_H, WALL } from '../core/constants';
import { PIN_LANE, type PinballTable } from '../core/pinball';
import type { ArenaFx } from './fx';
import { FONT } from './renderer';

/** Draws the table. It borrows the arkanoid look — same neon, same bricks — so
 *  the two modes read as one game, and adds only what a table has: flippers, a
 *  plunger, and the slopes that feed the ball back to them. */

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function drawTable(ctx: CanvasRenderingContext2D, table: PinballTable, fx: ArenaFx, t: number): void {
  ctx.save();
  if (table.shake > 0.01) {
    const s = table.shake * 6;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  drawBackground(ctx, t);
  drawSlopes(ctx);
  drawBricks(ctx, table);
  drawProps(ctx, table, t);
  drawLane(ctx, table);
  drawFlippers(ctx, table);
  drawBalls(ctx, table);
  fx.draw(ctx);
  drawOverlay(ctx, table);
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, t: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, ARENA_H);
  g.addColorStop(0, '#0d1228');
  g.addColorStop(0.6, '#0a0f1f');
  g.addColorStop(1, '#0c0a18');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // A slow sheen across the glass.
  const sweep = ((t * 26) % (ARENA_H + 300)) - 150;
  const sg = ctx.createLinearGradient(0, sweep - 90, 0, sweep + 90);
  sg.addColorStop(0, 'rgba(176,107,255,0)');
  sg.addColorStop(0.5, 'rgba(176,107,255,0.05)');
  sg.addColorStop(1, 'rgba(176,107,255,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, sweep - 90, ARENA_W, 180);

  ctx.fillStyle = '#16203c';
  ctx.fillRect(0, 0, WALL, ARENA_H);
  ctx.fillRect(ARENA_W - WALL, 0, WALL, ARENA_H);
  ctx.fillRect(0, 0, ARENA_W, WALL);
  ctx.fillStyle = 'rgba(176,107,255,0.35)';
  ctx.fillRect(WALL - 2, 0, 2, ARENA_H);
  ctx.fillRect(ARENA_W - WALL, 0, 2, ARENA_H);
  ctx.fillRect(0, WALL - 2, ARENA_W, 2);
}

/** The two diagonals that funnel a falling ball towards the flippers. */
function drawSlopes(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(120,150,220,0.5)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(WALL, ARENA_H - 150);
  ctx.lineTo(WALL + 92, ARENA_H - 150 + 69);
  ctx.moveTo(ARENA_W - WALL - PIN_LANE.w, ARENA_H - 150);
  ctx.lineTo(ARENA_W - WALL - PIN_LANE.w - 92, ARENA_H - 150 + 69);
  ctx.stroke();
  ctx.restore();
}

function drawBricks(ctx: CanvasRenderingContext2D, table: PinballTable): void {
  for (const b of table.bricks) {
    if (!b.alive) continue;
    const x = b.x + 1.5;
    const y = b.y + 1.5;
    const w = table.brickW - 3;
    const h = BRICK_H - 3;
    ctx.save();
    ctx.fillStyle = withAlpha(b.kind.color, 0.22);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = withAlpha(b.kind.color, 0.75);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (b.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${b.flash * 0.6})`;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawProps(ctx: CanvasRenderingContext2D, table: PinballTable, t: number): void {
  for (const p of table.props) {
    const { def } = p;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.kind === 'target' && p.down) {
      ctx.strokeStyle = withAlpha(def.color, 0.25);
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 12 + p.flash * 24;
    ctx.strokeStyle = withAlpha(def.color, 0.6 + p.flash * 0.4);
    ctx.fillStyle = withAlpha(def.color, 0.18 + p.flash * 0.5);
    ctx.lineWidth = 2.5;

    if (p.kind === 'spinner') {
      ctx.rotate(p.spin);
      ctx.beginPath();
      ctx.moveTo(-def.radius, 0);
      ctx.lineTo(def.radius, 0);
      ctx.stroke();
    } else if (p.kind === 'target') {
      ctx.beginPath();
      ctx.roundRect(-def.radius, -5, def.radius * 2, 10, 3);
      ctx.fill();
      ctx.stroke();
    } else if (p.kind === 'lock') {
      ctx.fillStyle = p.holdT > 0 ? withAlpha(def.color, 0.5) : 'rgba(4,7,16,0.9)';
      ctx.beginPath();
      ctx.arc(0, 0, def.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -t * 12;
      ctx.stroke();
    } else if (p.kind === 'sling') {
      const dir = p.x < ARENA_W / 2 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(-def.radius * dir, -def.radius);
      ctx.lineTo(def.radius * dir, 0);
      ctx.lineTo(-def.radius * dir, def.radius);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, def.radius + p.flash * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = withAlpha('#ffffff', 0.5 + p.flash * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** The launch lane, with the plunger's charge shown as a filling bar. */
function drawLane(ctx: CanvasRenderingContext2D, table: PinballTable): void {
  const x = ARENA_W - WALL - PIN_LANE.w;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(x, ARENA_H - 240, PIN_LANE.w, 240);
  ctx.strokeStyle = 'rgba(120,150,220,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, ARENA_H - 240);
  ctx.lineTo(x, ARENA_H);
  ctx.stroke();

  if (table.plunger > 0) {
    const h = 70 * table.plunger;
    ctx.fillStyle = 'rgba(255,210,77,0.85)';
    ctx.fillRect(x + 5, ARENA_H - 24 - h, PIN_LANE.w - 10, h);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(x + 3, ARENA_H - 20, PIN_LANE.w - 6, 8);
  ctx.restore();
}

function drawFlippers(ctx: CanvasRenderingContext2D, table: PinballTable): void {
  for (const f of table.flippers) {
    const tipX = f.x + Math.cos(f.angle) * f.length * f.side;
    const tipY = f.y + Math.sin(f.angle) * f.length;
    ctx.save();
    ctx.strokeStyle = f.active ? '#ffd24d' : '#4de2ff';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = f.active ? 22 : 12;
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawBalls(ctx: CanvasRenderingContext2D, table: PinballTable): void {
  for (const b of table.balls) {
    ctx.save();
    for (let i = 0; i < b.trail.length; i++) {
      const p = b.trail[i];
      ctx.globalAlpha = (i / b.trail.length) * 0.3;
      ctx.fillStyle = '#9fd8ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 16;
    const g = ctx.createRadialGradient(b.x - 2, b.y - 3, 1, b.x, b.y, b.r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#8fb8d8');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawOverlay(ctx: CanvasRenderingContext2D, table: PinballTable): void {
  if (table.state !== 'ready' && table.state !== 'drained') return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText('Пробел — натянуть плунжер, отпустить — выстрел', ARENA_W / 2, ARENA_H - 200);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText('A и D — флипперы', ARENA_W / 2, ARENA_H - 180);
  ctx.restore();
}
