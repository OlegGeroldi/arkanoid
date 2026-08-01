import {
  ARENA_H,
  ARENA_W,
  BRICK_H,
  BRICK_W,
  ENERGY_MAX,
  GRID_TOP,
  PADDLE_H,
  PADDLE_Y,
  POWERUP_H,
  POWERUP_W,
  WALL,
} from '../core/constants';
import type { Arena } from '../core/arena';
import { BALL_TYPES } from '../core/balls';
import { SUPERS } from '../core/supers';
import type { ArenaFx } from './fx';
import { clamp } from '../core/math';

export const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

export function neonRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  radius = 3,
  glow = 8,
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.restore();
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Draws one playfield. The caller has already translated the context so that
 *  (0,0) is the arena's top-left corner. */
export function drawArena(ctx: CanvasRenderingContext2D, arena: Arena, fx: ArenaFx, t: number): void {
  ctx.save();

  // Screen shake, applied inside the arena only.
  if (arena.shake > 0.01) {
    const s = arena.shake * 6;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  drawBackground(ctx, arena, t);
  drawBricks(ctx, arena);
  drawSuperVisuals(ctx, arena, t);
  drawPowerups(ctx, arena);
  drawLasers(ctx, arena);
  drawPaddle(ctx, arena, t);
  drawBalls(ctx, arena, t);
  drawShield(ctx, arena);
  fx.draw(ctx);
  drawHazards(ctx, arena, t);
  drawStateOverlay(ctx, arena);

  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, arena: Arena, t: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, ARENA_H);
  g.addColorStop(0, '#0b1024');
  g.addColorStop(0.55, '#0a0f1f');
  g.addColorStop(1, '#070a16');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#2b3d6b';
  ctx.lineWidth = 1;
  for (let x = 0; x <= ARENA_W; x += BRICK_W) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ARENA_H);
    ctx.stroke();
  }
  for (let y = GRID_TOP; y <= ARENA_H; y += BRICK_H * 2) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ARENA_W, y);
    ctx.stroke();
  }
  ctx.restore();

  // Scanline sweep, purely decorative.
  const sweep = ((t * 40) % (ARENA_H + 200)) - 100;
  const sg = ctx.createLinearGradient(0, sweep - 60, 0, sweep + 60);
  sg.addColorStop(0, 'rgba(77,226,255,0)');
  sg.addColorStop(0.5, 'rgba(77,226,255,0.045)');
  sg.addColorStop(1, 'rgba(77,226,255,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, sweep - 60, ARENA_W, 120);

  // Walls
  ctx.fillStyle = '#16203c';
  ctx.fillRect(0, 0, WALL, ARENA_H);
  ctx.fillRect(ARENA_W - WALL, 0, WALL, ARENA_H);
  ctx.fillRect(0, 0, ARENA_W, WALL);
  ctx.fillStyle = 'rgba(77,226,255,0.35)';
  ctx.fillRect(WALL - 2, 0, 2, ARENA_H);
  ctx.fillRect(ARENA_W - WALL, 0, 2, ARENA_H);
  ctx.fillRect(0, WALL - 2, ARENA_W, 2);

  if (arena.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${arena.flash * 0.25})`;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }
}

function drawBricks(ctx: CanvasRenderingContext2D, arena: Arena): void {
  for (const b of arena.bricks) {
    if (!b.alive) {
      if (b.regenTimer > 0) {
        // Ghost of a regenerating brick, filling up as it comes back.
        const p = 1 - b.regenTimer / (b.kind.regen ?? 1);
        ctx.save();
        ctx.globalAlpha = 0.15 + p * 0.35;
        ctx.strokeStyle = b.kind.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x + 1.5, b.y + 1.5, BRICK_W - 3, BRICK_H - 3);
        ctx.fillStyle = withAlpha(b.kind.color, 0.25);
        ctx.fillRect(b.x + 2, b.y + BRICK_H - 2 - (BRICK_H - 4) * p, BRICK_W - 4, (BRICK_H - 4) * p);
        ctx.restore();
      }
      continue;
    }

    const damaged = b.kind.hp > 1 ? clamp(b.hp / b.kind.hp, 0.25, 1) : 1;
    const x = b.x + 1.5;
    const y = b.y + 1.5;
    const w = BRICK_W - 3;
    const h = BRICK_H - 3;

    ctx.save();
    ctx.shadowColor = b.kind.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = withAlpha(b.kind.color, 0.18 + 0.35 * damaged);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = withAlpha(b.kind.color, 0.55 + 0.45 * damaged);
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Top highlight gives the tiles some depth.
    ctx.fillStyle = withAlpha('#ffffff', 0.1 * damaged);
    ctx.fillRect(x + 2, y + 2, w - 4, 2);

    if (b.kind.hp > 1) {
      ctx.fillStyle = withAlpha('#ffffff', 0.7);
      for (let i = 0; i < Math.max(0, b.hp); i++) {
        ctx.fillRect(x + w - 5 - i * 4, y + h - 4, 2.5, 2.5);
      }
    }
    if (b.kind.code === 'x') {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y);
      ctx.lineTo(x, y + h);
      ctx.stroke();
    }
    if (b.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${b.flash * 0.6})`;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawPaddle(ctx: CanvasRenderingContext2D, arena: Arena, t: number): void {
  const w = arena.paddleW;
  const x = arena.paddleX - w / 2;
  const hot = arena.timers.laser > 0 || arena.stats.laserAlways;
  const color = arena.timers.invert > 0 ? '#ff4d6d' : hot ? '#ff9a4d' : '#4de2ff';

  neonRect(ctx, x, PADDLE_Y, w, PADDLE_H, withAlpha(color, 0.9), 6, 16);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(x + 6, PADDLE_Y + 2.5, w - 12, 2);
  if (arena.timers.catch > 0) {
    ctx.strokeStyle = 'rgba(61,220,132,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -t * 20;
    ctx.beginPath();
    ctx.moveTo(x, PADDLE_Y - 3);
    ctx.lineTo(x + w, PADDLE_Y - 3);
    ctx.stroke();
  }
  if (hot) {
    ctx.fillStyle = '#ffd24d';
    ctx.fillRect(x + 3, PADDLE_Y - 4, 4, 4);
    ctx.fillRect(x + w - 7, PADDLE_Y - 4, 4, 4);
  }
  ctx.restore();
}

function drawBalls(ctx: CanvasRenderingContext2D, arena: Arena, t: number): void {
  for (const b of arena.balls) {
    const element = BALL_TYPES[b.type];
    const fire = b.fireT > 0;
    const pierce = b.pierceT > 0 || arena.timers.pierce > 0;

    let color = element.color;
    let trail = element.trail;
    let glow = element.glow;
    if (b.type === 'normal' && (fire || pierce)) {
      color = fire ? '#ffb24d' : '#ff7a3d';
      trail = color;
      glow = fire ? 26 : 18;
    }
    // Blink out over the last two seconds of an element.
    const expiring = b.type !== 'normal' && b.typeT > 0 && b.typeT < 2;
    const pulse = expiring && Math.sin(t * 26) < 0;
    if (pulse) {
      color = '#ffffff';
      trail = '#ffffff';
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < b.trail.length; i++) {
      const p = b.trail[i];
      const k = i / b.trail.length;
      ctx.globalAlpha = k * 0.4;
      ctx.fillStyle = trail;
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.r * (0.35 + k * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    // Bright core keeps the ball readable against its own glow.
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.22, b.y - b.r * 0.22, b.r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPowerups(ctx: CanvasRenderingContext2D, arena: Arena): void {
  for (const p of arena.powerups) {
    const c = p.def.color;
    ctx.save();
    ctx.translate(p.x + POWERUP_W / 2, p.y + POWERUP_H / 2);
    ctx.scale(Math.cos(p.spin) * 0.35 + 0.65, 1);
    neonRect(ctx, -POWERUP_W / 2, -POWERUP_H / 2, POWERUP_W, POWERUP_H, withAlpha(c, 0.85), 4, 12);
    ctx.fillStyle = '#04070f';
    ctx.font = `700 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.def.letter, 0, 0.5);
    ctx.restore();
  }
}

function drawLasers(ctx: CanvasRenderingContext2D, arena: Arena): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of arena.lasers) {
    const g = ctx.createLinearGradient(0, l.y, 0, l.y + 16);
    g.addColorStop(0, 'rgba(255,210,77,0.95)');
    g.addColorStop(1, 'rgba(255,122,61,0)');
    ctx.fillStyle = g;
    ctx.fillRect(l.x - 1.5, l.y, 3, 16);
  }
  ctx.restore();
}

function drawShield(ctx: CanvasRenderingContext2D, arena: Arena): void {
  if (arena.shields <= 0) return;
  const y = ARENA_H - 14;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#4de2ff';
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.moveTo(WALL, y);
  ctx.lineTo(ARENA_W - WALL, y);
  ctx.stroke();
  ctx.restore();
}

function drawSuperVisuals(ctx: CanvasRenderingContext2D, arena: Arena, t: number): void {
  const a = arena.active;
  if (!a) return;
  const def = SUPERS[a.id];

  if (a.id === 'singularity') {
    const r = 84;
    ctx.save();
    const g = ctx.createRadialGradient(a.x, a.y, 4, a.x, a.y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(0.55, withAlpha(def.color, 0.35));
    g.addColorStop(1, 'rgba(176,107,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(def.color, 0.8);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const rr = ((t * 60 + i * 28) % r) + 6;
      ctx.globalAlpha = 1 - rr / r;
      ctx.beginPath();
      ctx.arc(a.x, a.y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (a.id === 'fracture') {
    ctx.save();
    ctx.globalAlpha = 0.12 + Math.sin(t * 6) * 0.03;
    ctx.fillStyle = def.color;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    ctx.restore();
  }
}

function drawHazards(ctx: CanvasRenderingContext2D, arena: Arena, t: number): void {
  if (arena.timers.fog > 0) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 26; i++) {
      const y = ((i * 71 + t * 60) % ARENA_H) | 0;
      ctx.fillStyle = i % 2 ? 'rgba(120,140,190,0.35)' : 'rgba(20,26,50,0.55)';
      ctx.fillRect(0, y, ARENA_W, 9);
    }
    ctx.restore();
  }
  if (arena.timers.invert > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,77,109,0.6)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, ARENA_W - 4, ARENA_H - 4);
    ctx.restore();
  }
}

function drawStateOverlay(ctx: CanvasRenderingContext2D, arena: Arena): void {
  if (arena.state === 'serve') {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText('Огонь — запуск мяча', ARENA_W / 2, PADDLE_Y - 46);
    ctx.restore();
  }

  if (arena.state === 'levelup') {
    ctx.save();
    ctx.fillStyle = 'rgba(4,7,15,0.82)';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd24d';
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(`УРОВЕНЬ ${arena.xpLevel}`, ARENA_W / 2, 150);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText('Выберите усиление', ARENA_W / 2, 174);

    arena.draft.forEach((perk, i) => {
      const y = 210 + i * 108;
      const x = 40;
      const w = ARENA_W - 80;
      ctx.fillStyle = 'rgba(20,28,54,0.95)';
      ctx.strokeStyle = 'rgba(77,226,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 92, 10);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#4de2ff';
      ctx.font = `800 26px ${FONT}`;
      ctx.fillText(perk.icon, x + 18, y + 56);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 17px ${FONT}`;
      ctx.fillText(perk.name, x + 58, y + 38);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = `500 13px ${FONT}`;
      ctx.fillText(perk.desc, x + 58, y + 60);
      ctx.fillStyle = 'rgba(255,210,77,0.9)';
      ctx.font = `800 14px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`[${i + 1}]`, x + w - 16, y + 30);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(`Авто-выбор через ${arena.draftTimer.toFixed(1)} с`, ARENA_W / 2, ARENA_H - 60);
    ctx.restore();
  }

  if (arena.state === 'dead') {
    ctx.save();
    ctx.fillStyle = 'rgba(30,4,12,0.72)';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4d6d';
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText('ПОРАЖЕНИЕ', ARENA_W / 2, ARENA_H / 2);
    ctx.restore();
  }
}

// ------------------------------------------------------------------- HUD ----

export interface HudOptions {
  title: string;
  accent: string;
  compact?: boolean;
  /** Optional line under the title (level name, round, score to win). */
  subtitle?: string;
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  x: number,
  y: number,
  w: number,
  h: number,
  opt: HudOptions,
): void {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(10,15,32,0.85)';
  ctx.strokeStyle = withAlpha(opt.accent, 0.35);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 12);
  ctx.fill();
  ctx.stroke();

  const pad = 14;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = opt.accent;
  ctx.font = `800 16px ${FONT}`;
  ctx.fillText(opt.title, pad, 26);
  if (opt.subtitle) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText(opt.subtitle, pad, 44);
  }

  let cy = opt.subtitle ? 64 : 50;

  // Lives
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 11px ${FONT}`;
  ctx.fillText('ЖИЗНИ', pad, cy);
  for (let i = 0; i < Math.min(arena.lives, 8); i++) {
    ctx.fillStyle = '#ff5fa2';
    ctx.beginPath();
    ctx.arc(pad + 58 + i * 13, cy - 4, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (arena.lives > 8) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`+${arena.lives - 8}`, pad + 58 + 8 * 13, cy);
  }
  cy += 24;

  // XP bar
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 11px ${FONT}`;
  ctx.fillText(`ОПЫТ · ур. ${arena.xpLevel}`, pad, cy);
  cy += 8;
  bar(ctx, pad, cy, w - pad * 2, 8, arena.xpInto / arena.xpNeed, '#4de2ff');
  cy += 28;

  // Super energy
  const ready = arena.superReady;
  const def = SUPERS[arena.superId];
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 11px ${FONT}`;
  ctx.fillText(`СУПЕР · ${def.name}`, pad, cy);
  cy += 8;
  bar(ctx, pad, cy, w - pad * 2, 10, arena.energy / ENERGY_MAX, def.color, ready);
  if (ready) {
    ctx.fillStyle = def.color;
    ctx.font = `800 11px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText('ГОТОВ!', w - pad, cy - 2);
    ctx.textAlign = 'left';
  }
  cy += 30;

  // Score + combo
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText(String(arena.score).padStart(6, '0'), pad, cy + 6);
  if (arena.combo > 1) {
    ctx.fillStyle = '#ffd24d';
    ctx.font = `800 15px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`x${arena.combo}`, w - pad, cy + 6);
    ctx.textAlign = 'left';
  }
  cy += 30;

  if (!opt.compact) {
    // Active effects
    const active: [string, number, string][] = [];
    const elemental = arena.balls.find((b) => b.type !== 'normal');
    if (elemental) {
      const el = BALL_TYPES[elemental.type];
      active.push([el.name, elemental.typeT, el.color]);
    }
    const tm = arena.timers;
    if (tm.expand > 0) active.push(['Расширение', tm.expand, '#4de2ff']);
    if (tm.shrink > 0) active.push(['Сжатие', tm.shrink, '#ff4d6d']);
    if (tm.laser > 0) active.push(['Лазер', tm.laser, '#ff7a3d']);
    if (tm.catch > 0) active.push(['Захват', tm.catch, '#3ddc84']);
    if (tm.slow > 0) active.push(['Замедление', tm.slow, '#7c6cff']);
    if (tm.speed > 0) active.push(['Ускорение', tm.speed, '#ff4d6d']);
    if (tm.pierce > 0) active.push(['Пробой', tm.pierce, '#ff7a3d']);
    if (tm.invert > 0) active.push(['ИНВЕРСИЯ', tm.invert, '#ff4d6d']);
    if (tm.fog > 0) active.push(['ПОМЕХИ', tm.fog, '#8892a4']);
    if (tm.haste > 0) active.push(['РАЗГОН', tm.haste, '#ff4d6d']);
    if (arena.shields > 0) active.push([`Барьер x${arena.shields}`, 0, '#4de2ff']);

    if (active.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText('АКТИВНО', pad, cy);
      cy += 14;
      for (const [name, time, color] of active.slice(0, 7)) {
        ctx.fillStyle = color;
        ctx.font = `600 12px ${FONT}`;
        ctx.fillText(time > 0 ? `${name} ${time.toFixed(1)}s` : name, pad, cy);
        cy += 16;
      }
      cy += 6;
    }

    // Perks
    if (arena.perksTaken.size) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText('УСИЛЕНИЯ', pad, cy);
      cy += 16;
      let px = pad;
      for (const [id, n] of arena.perksTaken) {
        const label = `${id}${n > 1 ? ` x${n}` : ''}`;
        ctx.font = `600 11px ${FONT}`;
        const tw = ctx.measureText(label).width + 12;
        if (px + tw > w - pad) {
          px = pad;
          cy += 20;
        }
        ctx.fillStyle = 'rgba(77,226,255,0.14)';
        ctx.beginPath();
        ctx.roundRect(px, cy - 11, tw, 16, 8);
        ctx.fill();
        ctx.fillStyle = 'rgba(180,230,255,0.9)';
        ctx.fillText(label, px + 6, cy + 1);
        px += tw + 5;
      }
    }
  }

  ctx.restore();
}

export function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  color: string,
  pulse = false,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  const f = clamp(fill, 0, 1);
  if (f > 0) {
    ctx.fillStyle = color;
    if (pulse) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(h, w * f), h, h / 2);
    ctx.fill();
  }
  ctx.restore();
}
