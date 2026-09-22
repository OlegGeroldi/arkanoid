import { ARENA_H, ARENA_W } from '../../core/constants';
import type { PlayerPublic } from '../../net/showProtocol';
import { drawSnapshotMirror, type SnapshotMirror } from '../../render/snapshotMirror';

/** Up to ten live fields tiled into the given box, each captioned. */
export function drawArenaGrid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, players: PlayerPublic[], mirrors: Map<string, SnapshotMirror>): void {
  const n = players.length;
  if (!n) return;
  const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  const rows = Math.ceil(n / cols);
  const cw = w / cols;
  const ch = h / rows;
  const caption = 28;
  players.forEach((p, i) => {
    const cx = x + (i % cols) * cw;
    const cy = y + Math.floor(i / cols) * ch;
    const scale = Math.min((cw - 12) / ARENA_W, (ch - caption - 12) / ARENA_H);
    const fw = ARENA_W * scale;
    ctx.save();
    ctx.translate(cx + (cw - fw) / 2, cy + caption);
    ctx.scale(scale, scale);
    const m = mirrors.get(p.id);
    if (m) drawSnapshotMirror(ctx, m, p.color, 'Waiting for field…');
    ctx.restore();
    if (p.result) {
      ctx.save();
      ctx.translate(cx + (cw - fw) / 2, cy + caption);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, fw, ARENA_H * scale);
      ctx.fillStyle = p.result.cleared ? '#3ddc84' : '#ff4d6d';
      ctx.font = `bold ${Math.round(40 * scale + 14)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.result.cleared ? `CLEARED +${p.lastPoints}` : `+${p.lastPoints}`, fw / 2, (ARENA_H * scale) / 2);
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = p.color;
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const status = p.result ? (p.result.cleared ? ' ✓' : ' ✗') : '';
    ctx.fillText(`${p.avatar} ${p.name} · ${p.score}${status}`, cx + cw / 2, cy + 20);
    ctx.restore();
  });
}
