import { App, fitBox, type Scene } from '../app';
import { ARENA_H, ARENA_W } from '../core/constants';
import { Arena, noInput } from '../core/arena';
import type { LevelData } from '../core/level';
import type { SuperId } from '../core/supers';
import { ArenaFx } from '../render/fx';
import { drawArena, drawHud } from '../render/renderer';
import { SOLO_KEYS } from './input';
import { edgeOnce, FixedStepper } from './stepper';
import { el, button } from '../ui/dom';
import { mainMenu } from '../ui/menu';
import { sfx } from '../audio/sfx';
import { music } from '../audio/music';

const HUD_W = 244;
const GAP = 16;
const SCENE_W = ARENA_W + GAP + HUD_W;
const SCENE_H = ARENA_H;

export interface SoloOptions {
  levels: LevelData[];
  superId: SuperId;
  title: string;
  /** Endless mode reshuffles the level list instead of ending the run. */
  endless?: boolean;
  /** Where "back" goes — the editor uses this to return to what you were building. */
  onExit?: (app: App) => Scene;
  /** Start the run partway in (level select). */
  startIndex?: number;
  /** Record the furthest level reached in the profile. */
  trackProgress?: boolean;
}

export function soloScene(app: App, opts: SoloOptions): Scene {
  const levels = opts.levels.length ? opts.levels : [];
  let index = Math.min(Math.max(opts.startIndex ?? 0, 0), Math.max(levels.length - 1, 0));
  let arena = new Arena({ level: levels[index], superId: opts.superId, mode: 'solo' });
  let fx = new ArenaFx();
  const stepper = new FixedStepper();
  let layout = { scale: 1, ox: 0, oy: 0 };
  let paused = false;
  let finished = false;
  /** True while the between-levels panel is on screen: it must be built once,
   *  or rebuilding it every frame would swallow the click on its buttons. */
  let panelOpen = false;
  let t = 0;
  const exit = opts.onExit ?? mainMenu;
  music.setScene('game');
  markReached();

  function bank(): void {
    const earned = Math.round(arena.xpEarned);
    app.saveProfile((p) => {
      p.totalXp += earned;
      p.runs += 1;
      p.bestScore = Math.max(p.bestScore, arena.score);
      p.favouriteSuper = opts.superId;
      if (opts.trackProgress) p.campaignReached = Math.max(p.campaignReached, index + 1);
    });
  }

  function markReached(): void {
    if (!opts.trackProgress) return;
    app.saveProfile((p) => {
      p.campaignReached = Math.max(p.campaignReached, index + 1);
    });
  }

  function panel(title: string, tone: string, lines: string[], actions: HTMLElement[]): void {
    panelOpen = true;
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${tone}` }, title),
        ...lines.map((l) => el('p', { class: 'hint' }, l)),
        el('div', { class: 'row', style: 'margin-top:18px' }, ...actions),
      ),
    );
  }

  function clearPanel(): void {
    panelOpen = false;
    app.overlay.replaceChildren();
    app.overlay.classList.remove('interactive');
  }

  function nextLevel(): void {
    index++;
    if (index >= levels.length) {
      if (opts.endless) index = 0;
      else return win();
    }
    const carry = {
      level: levels[index],
      superId: opts.superId,
      mode: 'solo' as const,
      lives: arena.lives,
      stats: arena.stats,
      perksTaken: arena.perksTaken,
      xpTotal: arena.xpTotal,
      xpLevel: arena.xpLevel,
      score: arena.score,
    };
    const xpEarned = arena.xpEarned;
    arena = new Arena(carry);
    arena.xpEarned = xpEarned;
    arena.xpInto = 0;
    arena.energy = Math.min(100, arena.energy);
    fx = new ArenaFx();
    markReached();
    clearPanel();
  }

  function levelCleared(): void {
    const isLast = index >= levels.length - 1 && !opts.endless;
    panel(
      isLast ? 'ПОСЛЕДНИЙ РУБЕЖ ПРОЙДЕН' : `УРОВЕНЬ ${index + 1} ПРОЙДЕН`,
      '#3ddc84',
      [
        `Счёт: ${arena.score} · опыт за забег: ${Math.round(arena.xpEarned)}`,
        `Уровень мастерства: ${arena.xpLevel} · жизней: ${arena.lives}`,
      ],
      isLast
        ? [button('Забрать награду', () => win(), 'btn primary')]
        : [
            button('Дальше', () => nextLevel(), 'btn primary'),
            button('В меню', () => {
              bank();
              app.setScene(exit);
            }),
          ],
    );
  }

  function win(): void {
    if (finished) return;
    finished = true;
    bank();
    app.saveProfile((p) => {
      p.campaignCleared = Math.max(p.campaignCleared, levels.length);
    });
    panel('ПОБЕДА', '#ffd24d', [
      `Все уровни пройдены. Счёт: ${arena.score}.`,
      `Опыт забега: ${Math.round(arena.xpEarned)} — зачислен в профиль.`,
    ], [button('В меню', () => app.setScene(exit), 'btn primary')]);
  }

  function dead(): void {
    if (finished) return;
    finished = true;
    bank();
    panel('ЗАБЕГ ОКОНЧЕН', '#ff4d6d', [
      `Уровень ${index + 1} из ${levels.length}. Счёт: ${arena.score}.`,
      `Опыт забега: ${Math.round(arena.xpEarned)} — зачислен в профиль.`,
    ], [
      button('Ещё раз', () => app.setScene((a) => soloScene(a, opts)), 'btn primary'),
      button('В меню', () => app.setScene(exit)),
    ]);
  }

  function togglePause(): void {
    paused = !paused;
    if (!paused) return clearPanel();
    panel('ПАУЗА', '#4de2ff', ['Мышь или A/D — движение. Пробел — запуск и лазер. Shift — супер.'], [
      button('Продолжить', () => {
        paused = false;
        clearPanel();
      }, 'btn primary'),
      button('Начать заново', () => app.setScene((a) => soloScene(a, opts))),
      button('В меню', () => {
        bank();
        app.setScene(exit);
      }),
    ]);
  }

  return {
    update(dt) {
      t += dt;
      if (app.input.wasPressed(['Escape']) && !finished && arena.state !== 'cleared') togglePause();
      fx.update(dt);
      if (paused || finished) return;

      const pointer = app.pointer;
      const arenaX = pointer && layout.scale > 0 ? (pointer.x - layout.ox) / layout.scale : null;
      const input =
        arena.state === 'cleared' ? noInput() : app.input.read(SOLO_KEYS, clampPointer(arenaX));

      stepper.step(dt, (sdt, first) => arena.update(sdt, edgeOnce(input, first)));
      const events = arena.drainEvents();
      fx.consume(events);
      sfx.consume(events, arena.combo);

      if (panelOpen) return;
      if (arena.state === 'cleared') levelCleared();
      else if (arena.state === 'dead') dead();
    },

    draw(ctx, w, h) {
      ctx.save();
      layout = fitBox(ctx, w, h, SCENE_W, SCENE_H);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, ARENA_W, ARENA_H);
      ctx.clip();
      drawArena(ctx, arena, fx, t);
      ctx.restore();

      drawHud(ctx, arena, ARENA_W + GAP, 0, HUD_W, SCENE_H, {
        title: opts.title,
        accent: '#4de2ff',
        subtitle: `${arena.level.name} · ${index + 1}/${levels.length}`,
        fps: app.fps,
      });
      ctx.restore();
    },

    dispose() {
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };

  function clampPointer(x: number | null): number | null {
    if (x === null) return null;
    return x < -60 || x > ARENA_W + 60 ? null : x;
  }
}
