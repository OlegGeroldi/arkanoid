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

  // The pot, written large on the back wall — the whole reason to be down here.
  {
    const hot = bs.busy && !bs.cold;
    const amount = bs.busy ? bs.payout : 0;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = focus;
    ctx.fillStyle = bs.cold ? 'rgba(255,95,162,0.5)' : 'rgba(255,210,77,0.85)';
    ctx.shadowColor = hot ? '#ffd24d' : 'transparent';
    ctx.shadowBlur = hot ? 18 : 0;
    ctx.font = '800 52px Inter, system-ui, sans-serif';
    ctx.fillText(String(amount).padStart(5, '0'), w / 2, ARENA_H + BASEMENT_H * 0.5);
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(
      bs.potMul > 1 ? 'БАНК ×2 — ВЫБЕЙ МЯЧ НАВЕРХ' : bs.cold ? 'БАНК ТАЕТ' : 'БАНК',
      w / 2,
      ARENA_H + BASEMENT_H * 0.5 + 22,
    );
    ctx.restore();
  }

  for (const t of bs.targets) {
    ctx.save();
    ctx.translate(t.x, t.y);
    if (t.down) {
      ctx.strokeStyle = 'rgba(120,150,220,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(13, 0);
      ctx.stroke();
    } else {
      ctx.shadowColor = '#b06bff';
      ctx.shadowBlur = 10 + t.flash * 20;
      ctx.fillStyle = `rgba(176,107,255,${0.2 + t.flash * 0.5})`;
      ctx.strokeStyle = `rgba(176,107,255,${0.7 + t.flash * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-13, -9, 26, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '800 13px Inter, system-ui, sans-serif';
      ctx.fillText(t.letter, 0, 5);
    }
    ctx.restore();
  }

  for (const l of bs.locks) {
    ctx.save();
    ctx.translate(l.x, l.y);
    const live = l.ball !== null;
    ctx.shadowColor = '#ffd24d';
    ctx.shadowBlur = live ? 26 : 10 + l.flash * 16;
    ctx.fillStyle = live ? 'rgba(255,210,77,0.55)' : 'rgba(4,7,16,0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = l.armed || live ? 'rgba(255,210,77,0.8)' : 'rgba(255,210,77,0.2)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -t * 14;
    ctx.stroke();
    ctx.restore();
  }

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
    ctx.fillText('Выбей мяч наверх — заберёшь банк', w / 2, ARENA_H + 44);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillText(
      'A и D — флипперы · лунки дают мультибол' + (bs.cold ? ' · бамперы остыли' : ''),
      w / 2,
      ARENA_H + 64,
    );
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
