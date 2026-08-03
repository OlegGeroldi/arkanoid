import { App, fitBox, type Scene } from '../app';
import { ARENA_H, ARENA_W } from '../core/constants';
import { Arena } from '../core/arena';
import type { LevelData } from '../core/level';
import type { SuperId } from '../core/supers';
import { ArenaFx } from '../render/fx';
import { drawArena, drawHud } from '../render/renderer';
import { P1_KEYS, P2_KEYS } from './input';
import { edgeOnce, FixedStepper } from './stepper';
import { el, button } from '../ui/dom';
import { mainMenu } from '../ui/menu';
import { sfx } from '../audio/sfx';
import { music } from '../audio/music';
import { baseStats } from '../core/progression';
import { ngXpMul } from '../core/storage';

/** Co-op plays on a field twice as wide, with a paddle each. */
export const COOP_WIDTH = ARENA_W * 2;

const HUD_W = 244;
const GAP = 16;
const SCENE_W = COOP_WIDTH + GAP + HUD_W;
const SCENE_H = ARENA_H;

export interface CoopOptions {
  levels: LevelData[];
  superId: SuperId;
  startIndex?: number;
  lives?: number;
  speed?: number;
  ngPlus?: number;
}

/** Two players, one field, everything shared but the paddles: balls, lives, XP,
 *  perks, the super and the skill slots all belong to the team. */
export function coopScene(app: App, opts: CoopOptions): Scene {
  const levels = opts.levels.length ? [...opts.levels] : [];
  let index = Math.min(Math.max(opts.startIndex ?? 0, 0), Math.max(levels.length - 1, 0));
  const speed = opts.speed ?? 1;
  const cycle = opts.ngPlus ?? 0;

  const makeArena = (level: LevelData, carry?: Partial<ConstructorParameters<typeof Arena>[0]>): Arena => {
    const a = new Arena({
      level,
      superId: opts.superId,
      mode: 'solo',
      width: COOP_WIDTH,
      lives: opts.lives,
      stats: { ...baseStats(), xpMul: ngXpMul(cycle) },
      ...carry,
    });
    a.coop = true;
    a.equipSkills(app.profile.skills);
    return a;
  };

  let arena = makeArena(levels[index]);
  let fx = new ArenaFx();
  const stepper = new FixedStepper();
  let paused = false;
  let finished = false;
  let panelOpen = false;
  let t = 0;

  music.setScene('versus');

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

  function bank(): void {
    const earned = Math.round(arena.xpEarned);
    app.saveProfile((p) => {
      p.totalXp += earned;
      p.runs += 1;
      p.bestScore = Math.max(p.bestScore, arena.score);
    });
  }

  function nextLevel(): void {
    index++;
    if (index >= levels.length) return win();
    const spec = arena.spec;
    const ranks = Object.fromEntries(arena.skills.map((s) => [s.id, s.rank]));
    const equipped = arena.skills.map((s) => s.id);
    const xpEarned = arena.xpEarned;
    arena = makeArena(levels[index], {
      lives: arena.lives,
      stats: arena.stats,
      perksTaken: arena.perksTaken,
      xpTotal: arena.xpTotal,
      xpLevel: arena.xpLevel,
      score: arena.score,
    });
    arena.spec = spec;
    arena.xpEarned = xpEarned;
    arena.xpInto = 0;
    arena.equipSkills(equipped, ranks);
    fx = new ArenaFx();
    clearPanel();
  }

  function levelCleared(): void {
    const isLast = index >= levels.length - 1;
    panel(
      isLast ? 'КАМПАНИЯ ПРОЙДЕНА ВДВОЁМ' : `УРОВЕНЬ ${index + 1} ПРОЙДЕН`,
      '#3ddc84',
      [
        `Счёт команды: ${arena.score} · опыт: ${Math.round(arena.xpEarned)}`,
        `Уровень мастерства: ${arena.xpLevel} · жизней: ${arena.lives}`,
      ],
      isLast
        ? [button('Забрать награду', () => win(), 'btn primary')]
        : [
            button('Дальше', () => nextLevel(), 'btn primary'),
            button('В меню', () => {
              bank();
              app.setScene(mainMenu);
            }),
          ],
    );
  }

  function win(): void {
    if (finished) return;
    finished = true;
    bank();
    panel('ПОБЕДА', '#ffd24d', [
      `Вы прошли ${levels.length} уровней вдвоём. Счёт: ${arena.score}.`,
      `Опыт забега: ${Math.round(arena.xpEarned)} — зачислен в профиль ${app.profile.name}.`,
    ], [button('В меню', () => app.setScene(mainMenu), 'btn primary')]);
  }

  function dead(): void {
    if (finished) return;
    finished = true;
    bank();
    panel('ЗАБЕГ ОКОНЧЕН', '#ff4d6d', [
      `Уровень ${index + 1} из ${levels.length}. Счёт: ${arena.score}.`,
      'Жизни общие: мяч упустил один — потеряли оба.',
    ], [
      button('Ещё раз', () => app.setScene((a) => coopScene(a, opts)), 'btn primary'),
      button('В меню', () => app.setScene(mainMenu)),
    ]);
  }

  function togglePause(): void {
    paused = !paused;
    if (!paused) return clearPanel();
    panel(
      'ПАУЗА',
      '#4de2ff',
      [
        'Игрок 1: A/D — движение, W — подача, S — супер, Q/E — скиллы.',
        'Игрок 2: ← → — движение, ↑ — подача, ↓ — супер, «,» и «.» — скиллы.',
        'Мячи, жизни, опыт и усиления общие. Усиление выбирает любой: 1, 2, 3.',
      ],
      [
        button('Продолжить', () => {
          paused = false;
          clearPanel();
        }, 'btn primary'),
        button('В меню', () => {
          bank();
          app.setScene(mainMenu);
        }),
      ],
    );
  }

  return {
    update(dt) {
      t += dt;
      if (app.input.wasPressed(['Escape']) && !finished && arena.state !== 'cleared') togglePause();
      fx.update(dt);
      // Any open panel — pause, results, story beat — freezes the simulation.
      // Story panels appear while the ball is still live, so without this the
      // game plays on underneath the text.
      if (paused || finished || panelOpen) return;

      const i1 = app.input.read(P1_KEYS, null);
      const i2 = app.input.read(P2_KEYS, null);

      stepper.step(dt * speed, (sdt, first) => {
        arena.update(sdt, edgeOnce(i1, first), edgeOnce(i2, first));
      });

      const events = arena.drainEvents();
      fx.consume(events);
      sfx.consume(events, arena.combo);

      if (arena.state === 'cleared') levelCleared();
      else if (arena.state === 'dead') dead();
    },

    draw(ctx, w, h) {
      ctx.save();
      fitBox(ctx, w, h, SCENE_W, SCENE_H);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, COOP_WIDTH, ARENA_H);
      ctx.clip();
      drawArena(ctx, arena, fx, t);
      ctx.restore();

      drawHud(ctx, arena, COOP_WIDTH + GAP, 0, HUD_W, SCENE_H, {
        title: 'Кооп',
        accent: '#3ddc84',
        subtitle: `${arena.level.name} · ${index + 1}/${levels.length}${speed > 1 ? ` · ×${speed}` : ''}`,
        fps: app.fps,
      });
      ctx.restore();
    },

    dispose() {
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
