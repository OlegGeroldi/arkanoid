import { fitBox, type App, type Scene } from '../../app';
import { ARENA_H, ARENA_W } from '../../core/constants';
import { noInput } from '../../core/arena';
import { ArenaFx } from '../../render/fx';
import { drawArena, drawHud } from '../../render/renderer';
import { sfx } from '../../audio/sfx';
import { music } from '../../audio/music';
import { SOLO_KEYS } from '../input';
import { ArenaRun } from '../show/arenaRunner';
import type { ShowStore } from '../show/store';
import { ACT_TITLES } from '../../net/showProtocol';

const HUD_W = 260;
const GAP = 16;
const SCENE_W = ARENA_W + GAP + HUD_W;
const SCENE_H = ARENA_H;

/** The human's own arena for the current round. Reports once, then waits. */
export function playerArenaScene(app: App, store: ShowStore): Scene {
  const round = store.state!.round!;
  const run = new ArenaRun(round.levelIndex, round.seconds, app.profile.favouriteSuper);
  run.arena.equipSkills(app.profile.skills);
  const fx = new ArenaFx();
  let t = 0;
  let layout = { scale: 1, ox: 0, oy: 0 };
  let reported = false;

  app.overlay.replaceChildren();
  app.overlay.classList.remove('interactive');
  app.capturePointer();
  music.setScene('versus');

  return {
    update(dt) {
      t += dt;
      fx.update(dt);
      if (run.done) {
        if (!reported) { reported = true; store.send({ k: 'result', result: run.done }); }
        return;
      }
      const p = app.pointer;
      const x = p && layout.scale > 0 ? (p.x - layout.ox) / layout.scale : null;
      const input = run.arena.state === 'cleared' ? noInput() : app.input.read(SOLO_KEYS, x === null ? null : Math.max(0, Math.min(ARENA_W, x)));
      run.step(dt, input);
      const events = run.arena.drainEvents();
      fx.consume(events);
      sfx.consume(events, run.arena.combo);
      const snap = run.snapshot();
      if (snap) store.send({ k: 'snapshot', snap });
    },
    draw(ctx, w, h) {
      ctx.save();
      layout = fitBox(ctx, w, h, SCENE_W, SCENE_H);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, ARENA_W, ARENA_H); ctx.clip();
      drawArena(ctx, run.arena, fx, t, !app.input.locked);
      ctx.restore();
      const me = store.me;
      drawHud(ctx, run.arena, ARENA_W + GAP, 0, HUD_W, SCENE_H, {
        title: me ? `${me.avatar} ${me.name}` : 'PLAYER',
        accent: me?.color ?? '#4de2ff',
        subtitle: `${ACT_TITLES[round.act]} · round ${round.index + 1}/${store.state?.rounds ?? 10}${round.boss ? ' · BOSS' : ''}`,
        fps: app.fps,
        countdown: { label: 'time left', seconds: Math.ceil(run.clock) },
      });
      ctx.restore();
    },
    dispose() {
      if (!reported && run.done) store.send({ k: 'result', result: run.done });
      music.setScene('menu');
    },
  };
}
