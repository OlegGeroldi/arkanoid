import type { ArenaEvent } from '../core/arena';
import { PROPS } from '../core/props';
import { POWERUPS } from '../core/powerups';
import { SUPERS } from '../core/supers';
import { Rng } from '../core/rng';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  color: string;
}

/** Visual-only layer driven by arena events. Keeping it out of the simulation
 *  means effects can be skipped or replayed without affecting gameplay. */
export class ArenaFx {
  private parts: Particle[] = [];
  private texts: FloatText[] = [];
  private rings: Ring[] = [];
  private rng = new Rng(0x51ed);

  consume(events: ArenaEvent[]): void {
    for (const e of events) {
      switch (e.t) {
        case 'brick':
          this.burst(e.x, e.y, e.color, e.big ? 22 : 12);
          if (e.big) this.ring(e.x, e.y, 46, e.color);
          break;
        case 'hit':
          this.burst(e.x, e.y, e.color, 4, 90);
          break;
        case 'explosion':
          this.ring(e.x, e.y, e.r, '#ff9a4d');
          this.burst(e.x, e.y, '#ff7a3d', 30, 260);
          break;
        case 'powerup': {
          const def = POWERUPS[e.id];
          this.text(e.x, e.y, def.name, def.color);
          this.burst(e.x, e.y, def.color, 14);
          break;
        }
        case 'levelup':
          this.text(240, 380, `УРОВЕНЬ ${e.level}`, '#ffd24d');
          break;
        case 'super': {
          const def = SUPERS[e.id];
          this.text(240, 300, def.name.toUpperCase(), def.color);
          this.ring(240, 360, 420, def.color);
          break;
        }
        case 'garbage':
          this.text(240, 120, 'АТАКА!', '#ff4d6d');
          break;
        case 'bossHit':
          this.burst(e.x, e.y, e.color, 10, 150);
          break;
        case 'bossPhase':
          this.text(240, 250, e.phase === 3 ? 'БОСС В ЯРОСТИ' : 'ЩИТ ПРОБИТ', '#ff4d6d');
          this.ring(240, 120, 300, '#ff4d6d');
          break;
        case 'prop':
          this.ring(e.x, e.y, e.kind === 'bumper' ? 44 : 34, PROPS[e.kind].color);
          if (e.score >= 40) this.text(e.x, e.y - 18, `+${e.score}`, PROPS[e.kind].color);
          break;
        case 'targetsDown':
          this.text(240, 260, 'МИШЕНИ СБИТЫ', '#3ddc84');
          this.ring(e.x, e.y, 120, '#3ddc84');
          break;
        case 'multiball':
          this.text(240, 280, 'ДЖЕКПОТ · МУЛЬТИБОЛ', '#ffd24d');
          this.ring(e.x, e.y, 150, '#ffd24d');
          break;
        case 'cellarPot':
          this.text(240, 300, e.won ? `БАНК ВЗЯТ +${e.amount}` : `БАНК СГОРЕЛ −${e.amount}`, e.won ? '#ffd24d' : '#ff4d6d');
          this.ring(e.x, e.y, e.won ? 140 : 90, e.won ? '#ffd24d' : '#ff4d6d');
          break;
        case 'bossGrab':
          this.text(240, 300, e.taken ? 'МЯЧ ЗАХВАЧЕН' : 'МЯЧ ОТПУЩЕН', e.taken ? '#ff2d55' : '#ffd24d');
          this.ring(e.x, e.y, e.taken ? 160 : 120, e.taken ? '#ff2d55' : '#ffd24d');
          break;
        case 'bossShotHit':
          this.burst(e.x, e.y, '#ff4d6d', 16, 200);
          this.text(240, 560, 'РАКЕТКА ПОВРЕЖДЕНА', '#ff4d6d');
          break;
        case 'bossDead':
          this.text(240, 300, 'БОСС ПОВЕРЖЕН', '#ffd24d');
          this.ring(240, 120, 420, '#ffd24d');
          this.burst(240, 120, '#ffd24d', 60, 320);
          break;
        case 'lifeLost':
          this.text(240, 520, 'МЯЧ ПОТЕРЯН', '#ff4d6d');
          break;
        default:
          break;
      }
    }
  }

  /** Chain reactions on dense levels can spawn thousands of particles; the cap
   *  keeps a spectacular explosion from turning into a stutter. */
  private static readonly MAX_PARTICLES = 900;

  burst(x: number, y: number, color: string, count: number, speed = 170): void {
    const room = ArenaFx.MAX_PARTICLES - this.parts.length;
    if (room <= 0) return;
    count = Math.min(count, room);
    for (let i = 0; i < count; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(speed * 0.25, speed);
      const life = this.rng.range(0.25, 0.7);
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        size: this.rng.range(1.5, 3.6),
        color,
        gravity: 260,
      });
    }
  }

  ring(x: number, y: number, maxR: number, color: string): void {
    this.rings.push({ x, y, r: 4, maxR, life: 1, color });
  }

  text(x: number, y: number, text: string, color: string): void {
    this.texts.push({ x, y, text, color, life: 1.1, maxLife: 1.1 });
  }

  update(dt: number): void {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt * 2.2;
      r.r += (r.maxR - r.r) * Math.min(1, dt * 7);
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y -= dt * 26;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    for (const r of this.rings) {
      ctx.globalAlpha = Math.max(0, r.life) * 0.6;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const a = Math.min(1, t.life / t.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = t.color;
      ctx.font = '700 20px "Segoe UI", system-ui, sans-serif';
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 12;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
}
