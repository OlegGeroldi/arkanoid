import { BASEMENT_FLOOR, BASEMENT_H, type Basement } from '../core/basement';
import { ARENA_H, WALL } from '../core/constants';
import { flipperTip } from '../core/pinball';

/** Draws the pinball floor under the arena. It is deliberately darker than the
 *  playfield above: this is the cellar, and the eye should always know which
 *  floor the ball is on. */
export function drawBasement(
  ctx: CanvasRenderingContext2D,
  bs: Basement<any>,
  t: number,
  /** 0 while the view is upstairs, 1 once it has fully slid down here. */
  focus = 1,
): void {
  const w = bs.width;
  ctx.save();

  const g = ctx.createLinearGradient(0, ARENA_H, 0, BASEMENT_FLOOR);
  g.addColorStop(0, '#0a0f20');
  g.addColorStop(1, '#07060f');
  ctx.fillStyle = g;
  ctx.fillRect(0, ARENA_H, w, BASEMENT_H);

  ctx.fillStyle = '#131b33';
  ctx.fillRect(0, ARENA_H, WALL, BASEMENT_H);
  ctx.fillRect(w - WALL, ARENA_H, WALL, BASEMENT_H);

  // The ceiling: dashed, because it is the one wall the ball may cross.
  ctx.save();
  ctx.strokeStyle = bs.busy ? 'rgba(61,220,132,0.75)' : 'rgba(120,150,220,0.3)';
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 7]);
  ctx.lineDashOffset = -t * 18;
  ctx.beginPath();
  ctx.moveTo(WALL, ARENA_H);
  ctx.lineTo(w - WALL, ARENA_H);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(120,150,220,0.45)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of bs.slopes) {
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
  }
  ctx.stroke();

  for (const p of bs.bumpers) {
    ctx.save();
    ctx.shadowColor = '#ff5fa2';
    ctx.shadowBlur = 12 + p.flash * 24;
    ctx.strokeStyle = `rgba(255,95,162,${0.6 + p.flash * 0.4})`;
    ctx.fillStyle = `rgba(255,95,162,${0.16 + p.flash * 0.5})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 17 + p.flash * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  for (const f of bs.flippers) {
    const tip = flipperTip(f);
    ctx.save();
    ctx.strokeStyle = f.active ? '#ffd24d' : '#4de2ff';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = f.active ? 22 : 12;
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (focus > 0.35 && bs.busy) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, (focus - 0.35) / 0.4);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '700 15px Inter, system-ui, sans-serif';
    ctx.fillText('Отбей мяч обратно наверх', w / 2, ARENA_H + 44);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillText('A и D — флипперы' + (bs.cold ? ' · бамперы остыли' : ''), w / 2, ARENA_H + 64);
    ctx.restore();
  }

  for (const b of bs.balls) {
    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 16;
    const rg = ctx.createRadialGradient(b.x - 2, b.y - 3, 1, b.x, b.y, b.r);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(1, '#8fb8d8');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}
