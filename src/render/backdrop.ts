import { Rng } from '../core/rng';

interface Star {
  x: number;
  y: number;
  z: number;
  c: string;
}

/** Animated menu background: drifting neon bricks and a stray ball. */
export class Backdrop {
  private stars: Star[] = [];
  private t = 0;
  private ball = { x: 0.3, y: 0.4, vx: 0.11, vy: 0.09 };
  private rng = new Rng(7);

  constructor() {
    const colors = ['#4de2ff', '#b06bff', '#ff5fa2', '#ffd24d'];
    for (let i = 0; i < 90; i++) {
      this.stars.push({
        x: this.rng.next(),
        y: this.rng.next(),
        z: this.rng.range(0.25, 1),
        c: this.rng.pick(colors),
      });
    }
  }

  update(dt: number): void {
    this.t += dt;
    const b = this.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 0.05 || b.x > 0.95) b.vx *= -1;
    if (b.y < 0.05 || b.y > 0.95) b.vy *= -1;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = ctx.createRadialGradient(w * 0.5, h * 0.35, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
    g.addColorStop(0, '#101a3a');
    g.addColorStop(1, '#05070f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    for (const s of this.stars) {
      const y = (s.y + this.t * 0.012 * s.z) % 1;
      const size = 3 + s.z * 9;
      ctx.globalAlpha = 0.1 + s.z * 0.25;
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x * w, y * h, size * 2.2, size);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.shadowColor = '#4de2ff';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.ball.x * w, this.ball.y * h, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Vignette keeps the menu text readable over the animation.
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
}
