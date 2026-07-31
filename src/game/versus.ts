import { App, fitBox, type Scene } from '../app';
import { ARENA_H, ARENA_W } from '../core/constants';
import { Arena, type ArenaEvent, type ArenaInput } from '../core/arena';
import type { LevelData } from '../core/level';
import { SUPERS, type SuperId } from '../core/supers';
import { ArenaFx } from '../render/fx';
import { drawArena, drawHud, FONT } from '../render/renderer';
import { P1_KEYS, P2_KEYS } from './input';
import { edgeOnce, FixedStepper } from './stepper';
import { button, el } from '../ui/dom';
import { mainMenu } from '../ui/menu';

const HUD_W = 208;
const GAP = 18;
const SCENE_W = HUD_W * 2 + ARENA_W * 2 + GAP * 3;
const SCENE_H = ARENA_H;

export interface VersusOptions {
  levels: LevelData[];
  supers: [SuperId, SuperId];
  lives: number;
  names: [string, string];
}

interface Side {
  arena: Arena;
  fx: ArenaFx;
  superId: SuperId;
  name: string;
  accent: string;
  levelIndex: number;
  fieldsCleared: number;
}

/** Local split-screen duel: two independent fields, and everything you break
 *  turns into pressure on the other side. */
export function versusScene(app: App, opts: VersusOptions): Scene {
  const levels = opts.levels;
  const seed = Date.now() >>> 0;
  const stepper = new FixedStepper();
  let over = false;
  let t = 0;

  const make = (i: 0 | 1): Side => ({
    arena: new Arena({
      level: levels[0],
      seed,
      superId: opts.supers[i],
      mode: 'versus',
      lives: opts.lives,
    }),
    fx: new ArenaFx(),
    superId: opts.supers[i],
    name: opts.names[i],
    accent: i === 0 ? '#4de2ff' : '#ff5fa2',
    levelIndex: 0,
    fieldsCleared: 0,
  });

  const sides: [Side, Side] = [make(0), make(1)];

  /** A super hits your own field and sabotages the other one. */
  function attack(from: Side, to: Side): void {
    switch (from.superId) {
      case 'barrage':
        to.arena.pushGarbageRow();
        break;
      case 'meteor':
        to.arena.applyHazard('haste', SUPERS.meteor.duration);
        break;
      case 'fracture':
        to.arena.applyHazard('invert', 5);
        break;
      case 'singularity':
        to.arena.applyHazard('fog', SUPERS.singularity.duration);
        break;
    }
    to.fx.text(ARENA_W / 2, 200, `${from.name}: ${SUPERS[from.superId].name}`, '#ff4d6d');
  }

  function handle(side: Side, other: Side, events: ArenaEvent[]): void {
    for (const e of events) {
      if (e.t === 'attack') {
        attack(side, other);
      } else if (e.t === 'cleared') {
        // Wiping your field is the strongest attack in the game.
        side.fieldsCleared++;
        side.levelIndex = (side.levelIndex + 1) % levels.length;
        const a = side.arena;
        a.loadLevel(levels[side.levelIndex]);
        a.score += 500;
        a.lives += 1;
        other.arena.pushGarbageRow();
        other.arena.pushGarbageRow();
        side.fx.text(ARENA_W / 2, 300, 'ПОЛЕ ЗАЧИЩЕНО +500', '#3ddc84');
      } else if (e.t === 'dead') {
        finish(other, side);
      }
    }
  }

  function finish(winner: Side, loser: Side): void {
    if (over) return;
    over = true;
    const wi = winner === sides[0] ? 0 : 1;
    app.saveProfile((p) => {
      p.totalXp += Math.round((sides[0].arena.xpEarned + sides[1].arena.xpEarned) / 2);
      p.versusWins[wi] += 1;
    });
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${winner.accent}` }, `ПОБЕДА: ${winner.name}`),
        el('p', { class: 'hint' }, `${winner.name}: ${winner.arena.score} очков, полей зачищено ${winner.fieldsCleared}.`),
        el('p', { class: 'hint' }, `${loser.name}: ${loser.arena.score} очков, полей зачищено ${loser.fieldsCleared}.`),
        el(
          'div',
          { class: 'row', style: 'margin-top:18px' },
          button('Реванш', () => app.setScene((a) => versusScene(a, opts)), 'btn primary'),
          button('В меню', () => app.setScene(mainMenu)),
        ),
      ),
    );
  }

  return {
    update(dt) {
      t += dt;
      sides[0].fx.update(dt);
      sides[1].fx.update(dt);
      if (over) return;

      if (app.input.wasPressed(['Escape'])) {
        app.setScene(mainMenu);
        return;
      }

      const inputs: [ArenaInput, ArenaInput] = [
        app.input.read(P1_KEYS, null),
        app.input.read(P2_KEYS, null),
      ];

      // A perk draft freezes both fields, so nobody loses tempo while choosing.
      const drafting = sides.some((s) => s.arena.state === 'levelup');

      stepper.step(dt, (sdt, first) => {
        for (let i = 0; i < 2; i++) {
          const a = sides[i].arena;
          if (drafting && a.state !== 'levelup') continue;
          a.update(sdt, edgeOnce(inputs[i], first));
        }
      });

      for (let i = 0; i < 2; i++) {
        const side = sides[i];
        const other = sides[1 - i];
        const events = side.arena.drainEvents();
        side.fx.consume(events);
        handle(side, other, events);
      }
    },

    draw(ctx, w, h) {
      ctx.save();
      fitBox(ctx, w, h, SCENE_W, SCENE_H);

      let x = 0;
      drawHud(ctx, sides[0].arena, x, 0, HUD_W, SCENE_H, {
        title: sides[0].name,
        accent: sides[0].accent,
        subtitle: `Полей: ${sides[0].fieldsCleared}`,
      });
      x += HUD_W + GAP;

      for (let i = 0; i < 2; i++) {
        const side = sides[i];
        ctx.save();
        ctx.translate(x, 0);
        ctx.beginPath();
        ctx.rect(0, 0, ARENA_W, ARENA_H);
        ctx.clip();
        drawArena(ctx, side.arena, side.fx, t);
        ctx.restore();

        // Player tag over the field.
        ctx.save();
        ctx.translate(x, 0);
        ctx.fillStyle = side.accent;
        ctx.font = `800 13px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.75;
        ctx.fillText(side.name.toUpperCase(), ARENA_W / 2, 26);
        ctx.restore();

        x += ARENA_W + GAP;
      }

      drawHud(ctx, sides[1].arena, x, 0, HUD_W, SCENE_H, {
        title: sides[1].name,
        accent: sides[1].accent,
        subtitle: `Полей: ${sides[1].fieldsCleared}`,
      });
      ctx.restore();
    },

    dispose() {
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
