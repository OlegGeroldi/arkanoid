import { App, fitBox, type Scene } from '../app';
import { ARENA_H, ARENA_W, BRICK_H, GRID_LEFT, GRID_TOP, PADDLE_H, PADDLE_Y, WALL } from '../core/constants';
import { Arena, type ArenaEvent } from '../core/arena';
import { BRICK_KINDS, isBrickCode } from '../core/bricks';
import type { LevelData } from '../core/level';
import { brickWidthFor } from '../core/constants';
import { DEBUFFS } from '../core/debuffs';
import { SUPERS, type SuperId } from '../core/supers';
import { ArenaFx } from '../render/fx';
import { drawArena, drawHud, FONT } from '../render/renderer';
import { SOLO_KEYS } from './input';
import { edgeOnce, FixedStepper } from './stepper';
import { button, el } from '../ui/dom';
import { mainMenu } from '../ui/menu';
import { sfx } from '../audio/sfx';
import { music } from '../audio/music';
import { net } from '../net/client';
import { SNAPSHOT_INTERVAL, type FieldSnapshot, type MatchMessage } from '../net/protocol';

const HUD_W = 214;
const GAP = 18;
const SCENE_W = HUD_W + ARENA_W * 2 + GAP * 3;
const SCENE_H = ARENA_H;

export interface NetVersusOptions {
  levels: LevelData[];
  superId: SuperId;
  lives: number;
  /** The side that picks the seed, so both machines build the same level. */
  host: boolean;
  opponentName: string;
}

/** Split-screen versus across two machines.
 *
 *  Each side simulates only its own field — no lockstep, no rollback — and the
 *  network carries just two things: attacks, which are rare and order-free, and
 *  a snapshot of the field for the opponent to draw. Latency can delay an
 *  attack or stale the mirror by a frame; it can never desync the match. */
export function netVersusScene(app: App, opts: NetVersusOptions): Scene {
  const levels = opts.levels;
  const stepper = new FixedStepper();
  const fx = new ArenaFx();

  let levelIndex = 0;
  let seed = Date.now() >>> 0;
  let arena = new Arena({ level: levels[0], seed, superId: opts.superId, mode: 'versus', lives: opts.lives });
  let mirror: FieldSnapshot | null = null;
  let started = false;
  let over = false;
  let panelOpen = false;
  let snapshotTimer = 0;
  let t = 0;
  let fieldsCleared = 0;
  let lastLayout = { scale: 1, ox: 0, oy: 0 };

  music.setScene('versus');
  app.capturePointer();

  const send = (msg: MatchMessage): void => net.relay(msg);

  // The host defines the match so both sides get identical levels.
  if (opts.host) {
    send({ k: 'start', seed, levelIndex, lives: opts.lives });
    started = true;
  } else {
    send({ k: 'ready', name: app.profile.name, superId: opts.superId });
  }

  let opponentName = opts.opponentName;

  const unsubscribe = net.onRelay((payload, from) => {
    const msg = payload as MatchMessage;
    if (!msg || typeof msg.k !== 'string') return;

    // Identify the opponent by who is actually talking to us: picking a peer by
    // index mislabels the mirror when the peer list is momentarily stale.
    const peer = net.peers.find((p) => p.id === from);
    if (peer && peer.id !== net.selfId) opponentName = peer.name;

    switch (msg.k) {
      case 'start':
        // Guest adopts the host's seed and rebuilds its field to match.
        seed = msg.seed;
        levelIndex = msg.levelIndex;
        arena = new Arena({
          level: levels[levelIndex],
          seed,
          superId: opts.superId,
          mode: 'versus',
          lives: msg.lives,
        });
        arena.equipSkills(app.profile.skills);
        started = true;
        break;

      case 'ready':
        // A guest joined after we started: resend the match parameters.
        if (opts.host) send({ k: 'start', seed, levelIndex, lives: opts.lives });
        break;

      case 'snapshot':
        mirror = msg.snap;
        break;

      case 'attack':
        if (msg.kind === 'garbage') {
          for (let i = 0; i < msg.rows; i++) arena.pushGarbageRow();
        } else if (msg.kind === 'hazard') {
          arena.applyHazard(msg.hazard, msg.seconds);
        } else {
          arena.applyDebuff(msg.id);
        }
        sfx.play('garbage');
        break;

      case 'over':
        finish(true);
        break;
    }
  });

  arena.equipSkills(app.profile.skills);

  /** Our own events become attacks on the other machine. */
  function handle(events: ArenaEvent[]): void {
    for (const e of events) {
      if (e.t === 'attack') {
        switch (opts.superId) {
          case 'barrage':
            send({ k: 'attack', kind: 'garbage', rows: 1 });
            break;
          case 'meteor':
            send({ k: 'attack', kind: 'hazard', hazard: 'haste', seconds: SUPERS.meteor.duration });
            break;
          case 'fracture':
            send({ k: 'attack', kind: 'hazard', hazard: 'invert', seconds: 5 });
            break;
          case 'singularity':
            send({ k: 'attack', kind: 'hazard', hazard: 'fog', seconds: SUPERS.singularity.duration });
            break;
        }
        fx.text(ARENA_W / 2, 260, 'АТАКА ОТПРАВЛЕНА', '#ffd24d');
      } else if (e.t === 'debuffSent') {
        send({ k: 'attack', kind: 'debuff', id: e.id });
        fx.text(ARENA_W / 2, 300, `${DEBUFFS[e.id].icon} отправлено`, DEBUFFS[e.id].color);
      } else if (e.t === 'cleared') {
        fieldsCleared++;
        levelIndex = (levelIndex + 1) % levels.length;
        arena.loadLevel(levels[levelIndex]);
        arena.score += 500;
        arena.lives += 1;
        send({ k: 'attack', kind: 'garbage', rows: 2 });
        fx.text(ARENA_W / 2, 300, 'ПОЛЕ ЗАЧИЩЕНО +500', '#3ddc84');
      } else if (e.t === 'dead') {
        send({ k: 'over', loser: app.profile.name });
        finish(false);
      }
    }
  }

  function snapshot(): FieldSnapshot {
    // One character per cell keeps a full field small enough to send often.
    let cells = '';
    for (let r = 0; r < 18; r++) {
      for (let c = 0; c < arena.cols; c++) {
        const b = arena.bricks.find((x) => x.alive && x.row === r && x.col === c);
        cells += b ? b.kind.code : '0';
      }
    }
    return {
      cells,
      cols: arena.cols,
      paddleX: Math.round(arena.paddleX),
      paddleW: Math.round(arena.paddleW),
      balls: arena.balls.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })),
      score: arena.score,
      lives: arena.lives,
      xpLevel: arena.xpLevel,
      combo: arena.combo,
      energy: Math.round(arena.energy),
    };
  }

  function finish(won: boolean): void {
    if (over) return;
    over = true;
    panelOpen = true;
    app.saveProfile((p) => {
      p.totalXp += Math.round(arena.xpEarned);
      p.versusWins[won ? 0 : 1] += 1;
    });
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${won ? '#3ddc84' : '#ff4d6d'}` }, won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'),
        el('p', { class: 'hint' }, `Соперник: ${opponentName}`),
        el('p', { class: 'hint' }, `Ваш счёт: ${arena.score} · полей зачищено: ${fieldsCleared}`),
        el(
          'div',
          { class: 'row', style: 'margin-top:18px' },
          button('В меню', () => app.setScene(mainMenu), 'btn primary'),
        ),
      ),
    );
  }

  /** Draws the opponent's field from the last snapshot that arrived. */
  function drawMirror(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#0a0f1f';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    ctx.fillStyle = '#16203c';
    ctx.fillRect(0, 0, WALL, ARENA_H);
    ctx.fillRect(ARENA_W - WALL, 0, WALL, ARENA_H);
    ctx.fillRect(0, 0, ARENA_W, WALL);

    if (!mirror) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `600 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Ожидание соперника…', ARENA_W / 2, ARENA_H / 2);
      ctx.restore();
      return;
    }

    const bw = brickWidthFor(ARENA_W, mirror.cols);
    for (let r = 0; r < 18; r++) {
      for (let c = 0; c < mirror.cols; c++) {
        const ch = mirror.cells[r * mirror.cols + c];
        if (!ch || !isBrickCode(ch)) continue;
        const kind = BRICK_KINDS[ch];
        ctx.fillStyle = kind.color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.roundRect(GRID_LEFT + c * bw + 1.5, GRID_TOP + r * BRICK_H + 1.5, bw - 3, BRICK_H - 3, 3);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#ff5fa2';
    ctx.fillRect(mirror.paddleX - mirror.paddleW / 2, PADDLE_Y, mirror.paddleW, PADDLE_H);
    ctx.fillStyle = '#ffffff';
    for (const b of mirror.balls) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    update(dt) {
      t += dt;
      fx.update(dt);
      if (app.input.wasPressed(['Escape'])) {
        app.setScene(mainMenu);
        return;
      }
      if (over || panelOpen || !started) return;

      const pointerX = app.pointer ? (app.pointer.x - lastLayout.ox) / lastLayout.scale - mirrorOffset() : null;
      const input = app.input.read(SOLO_KEYS, pointerX !== null && pointerX > -60 && pointerX < ARENA_W + 60 ? pointerX : null);

      stepper.step(dt, (sdt, first) => arena.update(sdt, edgeOnce(input, first)));

      const events = arena.drainEvents();
      fx.consume(events);
      sfx.consume(events, arena.combo);
      handle(events);

      // Snapshots ride the frame loop, so a backgrounded tab stops publishing —
      // which is correct: its simulation is frozen too, and stale mirrors would
      // be worse than an honest "waiting" message. Two real machines both have
      // focus, so this only shows up when testing two tabs on one screen.
      snapshotTimer -= dt;
      if (snapshotTimer <= 0) {
        snapshotTimer = SNAPSHOT_INTERVAL;
        send({ k: 'snapshot', snap: snapshot() });
      }
    },

    draw(ctx, w, h) {
      ctx.save();
      lastLayout = fitBox(ctx, w, h, SCENE_W, SCENE_H);

      // Own field on the left, the opponent's mirror on the right.
      ctx.save();
      ctx.translate(mirrorOffset(), 0);
      ctx.beginPath();
      ctx.rect(0, 0, ARENA_W, ARENA_H);
      ctx.clip();
      drawArena(ctx, arena, fx, t, !app.input.locked);
      ctx.restore();

      ctx.save();
      ctx.translate(mirrorOffset() + ARENA_W + GAP, 0);
      ctx.beginPath();
      ctx.rect(0, 0, ARENA_W, ARENA_H);
      ctx.clip();
      drawMirror(ctx);
      ctx.fillStyle = '#ff5fa2';
      ctx.font = `800 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.8;
      ctx.fillText(opponentName.toUpperCase(), ARENA_W / 2, 26);
      ctx.globalAlpha = 1;
      if (mirror) {
        ctx.font = `600 11px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(`счёт ${mirror.score} · жизней ${mirror.lives}`, ARENA_W / 2, 44);
      }
      ctx.restore();

      drawHud(ctx, arena, mirrorOffset() + ARENA_W * 2 + GAP * 2, 0, HUD_W, SCENE_H, {
        title: app.profile.name,
        accent: '#4de2ff',
        subtitle: `Сеть · полей: ${fieldsCleared}`,
        fps: app.fps,
      });
      ctx.restore();
    },

    dispose() {
      unsubscribe();
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };

  function mirrorOffset(): number {
    return GAP;
  }
}
