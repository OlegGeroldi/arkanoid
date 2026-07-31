import { App, fitBox, type Scene } from '../app';
import {
  ARENA_H,
  ARENA_W,
  BALL_R,
  BALL_SPEED,
  BALL_SPEED_MAX,
  BRICK_H,
  BRICK_W,
  COLS,
  ENERGY_MAX,
  ENERGY_PER_DAMAGE,
  LASER_SPEED,
  PADDLE_H,
  PADDLE_MAX_BOUNCE,
  PADDLE_SPEED,
  PADDLE_W,
  ROWS,
  WALL,
} from '../core/constants';
import { BRICK_KINDS, isBrickCode, type Brick } from '../core/bricks';
import type { LevelData } from '../core/level';
import { avoidShallow, clamp, setSpeed } from '../core/math';
import { Rng } from '../core/rng';
import { SUPERS, type SuperId } from '../core/supers';
import { ArenaFx } from '../render/fx';
import { bar, FONT, neonRect } from '../render/renderer';
import { P1_KEYS, P2_KEYS, type Bindings } from './input';
import { FixedStepper } from './stepper';
import { button, el } from '../ui/dom';
import { mainMenu } from '../ui/menu';

const SCENE_W = ARENA_W;
const SCENE_H = ARENA_H;
/** Bricks sit in the middle band; both players share them. */
const DUEL_ROWS = 8;
const DUEL_TOP = (ARENA_H - DUEL_ROWS * BRICK_H) / 2;
const GOAL_MARGIN = 46;

export interface DuelOptions {
  level: LevelData;
  supers: [SuperId, SuperId];
  names: [string, string];
  target: number;
}

interface Fighter {
  /** 0 = bottom player, 1 = top player. */
  index: 0 | 1;
  name: string;
  accent: string;
  keys: Bindings;
  superId: SuperId;
  x: number;
  w: number;
  y: number;
  score: number;
  energy: number;
  stunT: number;
  wideT: number;
  activeT: number;
  fx: ArenaFx;
}

interface DuelBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  fireT: number;
  /** Who touched it last — that player scores the bricks it breaks. */
  owner: 0 | 1;
  trail: { x: number; y: number }[];
}

interface DuelLaser {
  x: number;
  y: number;
  vy: number;
  owner: 0 | 1;
}

/** Head-to-head arkanoid: one shared field, one ball, a paddle at each end.
 *  Miss the ball and the other player scores. */
export function duelScene(app: App, opts: DuelOptions): Scene {
  const rng = new Rng(Date.now() >>> 0);
  const stepper = new FixedStepper();
  const bricks: Brick[] = [];
  const lasers: DuelLaser[] = [];
  // Assigned by serve() below, before the first update.
  let ball!: DuelBall;
  let over = false;
  let serveTimer = 1;
  let magnetT = 0;
  let magnetOwner: 0 | 1 = 0;
  let slowT = 0;

  const fighters: [Fighter, Fighter] = [
    {
      index: 0,
      name: opts.names[0],
      accent: '#4de2ff',
      keys: P1_KEYS,
      superId: opts.supers[0],
      x: ARENA_W / 2,
      w: PADDLE_W,
      y: ARENA_H - GOAL_MARGIN,
      score: 0,
      energy: 0,
      stunT: 0,
      wideT: 0,
      activeT: 0,
      fx: new ArenaFx(),
    },
    {
      index: 1,
      name: opts.names[1],
      accent: '#ff5fa2',
      keys: P2_KEYS,
      superId: opts.supers[1],
      x: ARENA_W / 2,
      w: PADDLE_W,
      y: GOAL_MARGIN - PADDLE_H,
      score: 0,
      energy: 0,
      stunT: 0,
      wideT: 0,
      activeT: 0,
      fx: new ArenaFx(),
    },
  ];

  function buildField(): void {
    bricks.length = 0;
    const rows = opts.level.rows;
    for (let r = 0; r < DUEL_ROWS; r++) {
      // Sample the source level from its densest middle rows.
      const src = rows[Math.min(ROWS - 1, r + 1)] ?? '';
      for (let c = 0; c < COLS; c++) {
        const ch = src[c];
        if (!ch || !isBrickCode(ch)) continue;
        const kind = BRICK_KINDS[ch];
        bricks.push({
          col: c,
          row: r,
          x: c * BRICK_W,
          y: DUEL_TOP + r * BRICK_H,
          kind,
          hp: kind.hp,
          alive: true,
          regenTimer: 0,
          flash: 0,
        });
      }
    }
    if (!bricks.some((b) => b.alive && b.kind.hp > 0)) {
      // Fall back to a symmetric block so a sparse level still plays.
      for (let r = 2; r < 6; r++) {
        for (let c = 2; c < COLS - 2; c++) {
          bricks.push({
            col: c,
            row: r,
            x: c * BRICK_W,
            y: DUEL_TOP + r * BRICK_H,
            kind: BRICK_KINDS.n,
            hp: 1,
            alive: true,
            regenTimer: 0,
            flash: 0,
          });
        }
      }
    }
  }

  function serve(toward: 0 | 1): void {
    const dir = toward === 0 ? 1 : -1;
    ball = {
      x: ARENA_W / 2,
      y: ARENA_H / 2,
      vx: rng.range(-0.5, 0.5),
      vy: dir,
      speed: BALL_SPEED * 0.95,
      fireT: 0,
      owner: toward === 0 ? 1 : 0,
      trail: [],
    };
    setSpeed(ball, ball.speed);
    serveTimer = 1.1;
  }

  buildField();
  serve(rng.chance(0.5) ? 0 : 1);

  function damage(brick: Brick, dmg: number, by: 0 | 1): void {
    if (!brick.alive) return;
    brick.flash = 1;
    if (brick.kind.hp < 0) return;
    brick.hp -= dmg;
    const f = fighters[by];
    f.energy = Math.min(ENERGY_MAX, f.energy + ENERGY_PER_DAMAGE);
    if (brick.hp > 0) {
      f.fx.burst(brick.x + BRICK_W / 2, brick.y + BRICK_H / 2, brick.kind.color, 4, 90);
      return;
    }
    // Bricks feed super energy; only goals move the score.
    brick.alive = false;
    f.fx.burst(brick.x + BRICK_W / 2, brick.y + BRICK_H / 2, brick.kind.color, 14);
    if (brick.kind.explodes) {
      f.fx.ring(brick.x + BRICK_W / 2, brick.y + BRICK_H / 2, 60, '#ff9a4d');
      for (const o of bricks) {
        if (!o.alive || o === brick) continue;
        const dc = o.col - brick.col;
        const dr = o.row - brick.row;
        if (dc * dc + dr * dr <= 2.6) damage(o, 2, by);
      }
    }
    if (bricks.every((b) => !b.alive || b.kind.hp < 0)) buildField();
  }

  function fireSuper(f: Fighter): void {
    if (f.energy < ENERGY_MAX || over) return;
    f.energy = 0;
    f.activeT = SUPERS[f.superId].duration;
    f.fx.text(ARENA_W / 2, ARENA_H / 2, SUPERS[f.superId].name.toUpperCase(), SUPERS[f.superId].color);
    const foe = fighters[1 - f.index];

    switch (f.superId) {
      case 'barrage':
        for (let i = 0; i < 9; i++) {
          const x = WALL + 12 + ((ARENA_W - WALL * 2 - 24) / 8) * i;
          lasers.push({ x, y: f.y, vy: f.index === 0 ? -LASER_SPEED : LASER_SPEED, owner: f.index });
        }
        break;
      case 'meteor':
        ball.fireT = SUPERS.meteor.duration;
        ball.owner = f.index;
        ball.speed = Math.min(BALL_SPEED_MAX, ball.speed * 1.35);
        // Aim it at the opponent's goal.
        ball.vy = f.index === 0 ? -Math.abs(ball.vy) : Math.abs(ball.vy);
        break;
      case 'fracture':
        f.wideT = SUPERS.fracture.duration;
        slowT = SUPERS.fracture.duration;
        break;
      case 'singularity':
        magnetT = SUPERS.singularity.duration;
        magnetOwner = f.index;
        foe.stunT = 1.2;
        break;
    }
  }

  function movePaddle(f: Fighter, dt: number, left: boolean, right: boolean): void {
    const targetW = PADDLE_W * (f.wideT > 0 ? 1.6 : 1);
    f.w += (targetW - f.w) * Math.min(1, dt * 8);
    const speed = PADDLE_SPEED * (f.stunT > 0 ? 0.35 : 1);
    let dir = 0;
    if (left) dir -= 1;
    if (right) dir += 1;
    f.x = clamp(f.x + dir * speed * dt, WALL + f.w / 2, ARENA_W - WALL - f.w / 2);
  }

  function bounceOffPaddle(f: Fighter): void {
    const half = f.w / 2;
    const top = f.y;
    const bottom = f.y + PADDLE_H;
    const goingToward = f.index === 0 ? ball.vy > 0 : ball.vy < 0;
    if (!goingToward) return;
    if (ball.y + BALL_R < top || ball.y - BALL_R > bottom) return;
    if (ball.x + BALL_R < f.x - half || ball.x - BALL_R > f.x + half) return;

    const off = clamp((ball.x - f.x) / half, -1, 1);
    const angle = off * PADDLE_MAX_BOUNCE;
    const dir = f.index === 0 ? -1 : 1;
    ball.vx = Math.sin(angle);
    ball.vy = dir * Math.cos(angle);
    ball.y = f.index === 0 ? top - BALL_R : bottom + BALL_R;
    ball.owner = f.index;
    ball.speed = Math.min(BALL_SPEED_MAX, ball.speed + 6);
    f.energy = Math.min(ENERGY_MAX, f.energy + 2);
    f.fx.burst(ball.x, ball.y, f.accent, 6, 110);
  }

  function goal(scorer: 0 | 1): void {
    if (over) return;
    const f = fighters[scorer];
    f.score++;
    f.fx.text(ARENA_W / 2, ARENA_H / 2, 'ГОЛ!', f.accent);
    fighters[0].energy = Math.min(ENERGY_MAX, fighters[0].energy + 12);
    fighters[1].energy = Math.min(ENERGY_MAX, fighters[1].energy + 12);
    if (f.score >= opts.target) return finish(f);
    serve(scorer === 0 ? 1 : 0);
  }

  function finish(winner: Fighter): void {
    if (over) return;
    over = true;
    app.saveProfile((p) => {
      p.versusWins[winner.index] += 1;
    });
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${winner.accent}` }, `ПОБЕДА: ${winner.name}`),
        el('p', { class: 'hint' }, `Счёт ${fighters[0].score} : ${fighters[1].score}`),
        el(
          'div',
          { class: 'row', style: 'margin-top:18px' },
          button('Реванш', () => app.setScene((a) => duelScene(a, opts)), 'btn primary'),
          button('В меню', () => app.setScene(mainMenu)),
        ),
      ),
    );
  }

  function updateBall(dt: number): void {
    if (serveTimer > 0) {
      serveTimer -= dt;
      ball.x = ARENA_W / 2;
      ball.y = ARENA_H / 2;
      return;
    }
    if (ball.fireT > 0) ball.fireT -= dt;

    const speed = clamp(ball.speed * (slowT > 0 ? 0.6 : 1), 80, BALL_SPEED_MAX);
    setSpeed(ball, speed);
    avoidShallow(ball, 0.18);

    if (magnetT > 0) {
      // Curve the ball toward the opponent's goal line.
      const pull = magnetOwner === 0 ? -1 : 1;
      ball.vy += pull * 240 * dt;
      setSpeed(ball, speed);
    }

    const steps = Math.max(1, Math.ceil((speed * dt) / (BALL_R * 0.75)));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      if (ball.x - BALL_R < WALL) {
        ball.x = WALL + BALL_R;
        ball.vx = Math.abs(ball.vx);
      } else if (ball.x + BALL_R > ARENA_W - WALL) {
        ball.x = ARENA_W - WALL - BALL_R;
        ball.vx = -Math.abs(ball.vx);
      }

      collideBricks();
      bounceOffPaddle(fighters[0]);
      bounceOffPaddle(fighters[1]);
    }

    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 10) ball.trail.shift();

    if (ball.y > ARENA_H + 20) goal(1);
    else if (ball.y < -20) goal(0);
  }

  function collideBricks(): void {
    for (const b of bricks) {
      if (!b.alive) continue;
      const cx = clamp(ball.x, b.x, b.x + BRICK_W);
      const cy = clamp(ball.y, b.y, b.y + BRICK_H);
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;

      const piercing = ball.fireT > 0 && b.kind.hp > 0;
      if (!piercing) {
        const ox = BALL_R + BRICK_W / 2 - Math.abs(ball.x - (b.x + BRICK_W / 2));
        const oy = BALL_R + BRICK_H / 2 - Math.abs(ball.y - (b.y + BRICK_H / 2));
        if (ox < oy) {
          ball.vx = ball.x < b.x + BRICK_W / 2 ? -Math.abs(ball.vx) : Math.abs(ball.vx);
          ball.x += ball.vx > 0 ? ox : -ox;
        } else {
          ball.vy = ball.y < b.y + BRICK_H / 2 ? -Math.abs(ball.vy) : Math.abs(ball.vy);
          ball.y += ball.vy > 0 ? oy : -oy;
        }
      }
      damage(b, ball.fireT > 0 ? 3 : 1, ball.owner);
      if (!piercing) return;
    }
  }

  function updateLasers(dt: number): void {
    for (let i = lasers.length - 1; i >= 0; i--) {
      const l = lasers[i];
      l.y += l.vy * dt;
      if (l.y < -20 || l.y > ARENA_H + 20) {
        lasers.splice(i, 1);
        continue;
      }
      let consumed = false;
      for (const b of bricks) {
        if (!b.alive) continue;
        if (l.x >= b.x && l.x <= b.x + BRICK_W && l.y >= b.y && l.y <= b.y + BRICK_H) {
          damage(b, 1, l.owner);
          consumed = true;
          break;
        }
      }
      const foe = fighters[1 - l.owner];
      if (!consumed && Math.abs(l.y - foe.y) < PADDLE_H && Math.abs(l.x - foe.x) < foe.w / 2) {
        foe.stunT = Math.max(foe.stunT, 2);
        foe.fx.burst(l.x, foe.y, '#ff4d6d', 10);
        consumed = true;
      }
      if (consumed) lasers.splice(i, 1);
    }
  }

  return {
    update(dt) {
      for (const f of fighters) f.fx.update(dt);
      if (over) return;
      if (app.input.wasPressed(['Escape'])) {
        app.setScene(mainMenu);
        return;
      }

      const wants = fighters.map((f) => ({
        left: app.input.isDown(f.keys.left),
        right: app.input.isDown(f.keys.right),
        superPressed: app.input.wasPressed(f.keys.super),
      }));

      stepper.step(dt, (sdt, first) => {
        if (sdt > 0) {
          slowT = Math.max(0, slowT - sdt);
          magnetT = Math.max(0, magnetT - sdt);
          for (const f of fighters) {
            f.stunT = Math.max(0, f.stunT - sdt);
            f.wideT = Math.max(0, f.wideT - sdt);
            f.activeT = Math.max(0, f.activeT - sdt);
            movePaddle(f, sdt, wants[f.index].left, wants[f.index].right);
          }
          for (const b of bricks) if (b.flash > 0) b.flash = Math.max(0, b.flash - sdt * 4);
          updateBall(sdt);
          updateLasers(sdt);
        }
        if (first) {
          for (const f of fighters) if (wants[f.index].superPressed) fireSuper(f);
        }
      });
    },

    draw(ctx, w, h) {
      ctx.save();
      fitBox(ctx, w, h, SCENE_W, SCENE_H);
      ctx.beginPath();
      ctx.rect(0, 0, ARENA_W, ARENA_H);
      ctx.clip();

      // Field
      const g = ctx.createLinearGradient(0, 0, 0, ARENA_H);
      g.addColorStop(0, '#1a0f22');
      g.addColorStop(0.5, '#0a0f1f');
      g.addColorStop(1, '#0b1024');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.moveTo(0, ARENA_H / 2);
      ctx.lineTo(ARENA_W, ARENA_H / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#16203c';
      ctx.fillRect(0, 0, WALL, ARENA_H);
      ctx.fillRect(ARENA_W - WALL, 0, WALL, ARENA_H);

      // Goal lines
      for (const f of fighters) {
        const y = f.index === 0 ? ARENA_H - 6 : 2;
        ctx.fillStyle = f.accent;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(WALL, y, ARENA_W - WALL * 2, 4);
        ctx.globalAlpha = 1;
      }

      for (const b of bricks) {
        if (!b.alive) continue;
        const dmg = b.kind.hp > 1 ? clamp(b.hp / b.kind.hp, 0.3, 1) : 1;
        ctx.save();
        ctx.shadowColor = b.kind.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = b.kind.color;
        ctx.globalAlpha = 0.25 + 0.4 * dmg;
        ctx.beginPath();
        ctx.roundRect(b.x + 1.5, b.y + 1.5, BRICK_W - 3, BRICK_H - 3, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = b.kind.color;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        if (b.flash > 0) {
          ctx.fillStyle = `rgba(255,255,255,${b.flash * 0.6})`;
          ctx.fill();
        }
        ctx.restore();
      }

      for (const l of lasers) {
        ctx.fillStyle = l.owner === 0 ? '#4de2ff' : '#ff5fa2';
        ctx.fillRect(l.x - 1.5, l.y - 8, 3, 16);
      }

      // Ball
      const color = ball.fireT > 0 ? '#ffb24d' : '#ffffff';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ball.trail.forEach((p, i) => {
        ctx.globalAlpha = (i / ball.trail.length) * 0.3;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, BALL_R * 0.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      for (const f of fighters) {
        const c = f.stunT > 0 ? '#ff4d6d' : f.accent;
        neonRect(ctx, f.x - f.w / 2, f.y, f.w, PADDLE_H, c, 6, 16);
        f.fx.draw(ctx);
      }

      // Scores and energy live in the strip behind each goal line, clear of the paddles.
      for (const f of fighters) {
        const y = f.index === 0 ? ARENA_H - 16 : 26;
        ctx.fillStyle = f.accent;
        ctx.textAlign = 'left';
        ctx.font = `800 20px ${FONT}`;
        ctx.fillText(`${f.score}`, WALL + 8, y + 6);
        ctx.font = `600 11px ${FONT}`;
        ctx.globalAlpha = 0.75;
        ctx.fillText(f.name, WALL + 34, y + 5);
        ctx.globalAlpha = 1;
        bar(ctx, ARENA_W - 160, y, 130, 8, f.energy / ENERGY_MAX, SUPERS[f.superId].color, f.energy >= ENERGY_MAX);
      }
      ctx.textAlign = 'center';

      if (serveTimer > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = `800 30px ${FONT}`;
        ctx.fillText(serveTimer.toFixed(1), ARENA_W / 2, ARENA_H / 2 - 26);
      }

      ctx.restore();
    },

    dispose() {
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
