import { App, fitBox, type Scene } from '../app';
import { ARENA_H, ARENA_W, ENERGY_MAX } from '../core/constants';
import type { BallTypeId } from '../core/balls';
import type { SkillId } from '../core/skills';
import { Arena, noInput } from '../core/arena';
import type { LevelData } from '../core/level';
import type { SuperId } from '../core/supers';
import { ArenaFx } from '../render/fx';
import { drawArena, drawDebug, drawHud } from '../render/renderer';
import { SOLO_KEYS } from './input';
import { edgeOnce, FixedStepper } from './stepper';
import { el, button } from '../ui/dom';
import { mainMenu } from '../ui/menu';
import { sfx } from '../audio/sfx';
import { music } from '../audio/music';
import { ngBallSpeedMul, ngXpMul, SPEED_CHOICES, type RunSave } from '../core/storage';
import { baseStats, XP_RATE } from '../core/progression';
import { formatTime, recordClear, recordDeath, timeBonus } from '../core/stats';
import { hall } from '../core/hall';
import { net } from '../net/client';
import { routeChoices, ROUTES, SEGMENT, segmentOf, type RouteDef, type RouteId } from '../core/routes';
import { BOSS_DEFEAT, BOSS_INTRO, cycleLine, FINALE, PROLOGUE, ROUTE_LORE, type StoryEntry } from '../core/story';
import { generateLevel } from '../core/levelGen';

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
  /** Starting lives. */
  lives?: number;
  /** Simulation speed multiplier: everything in the arena runs this much faster. */
  speed?: number;
  /** Resume a saved run instead of starting fresh. */
  resume?: RunSave;
  /** New Game+ cycle this run belongs to: harder levels, richer XP. */
  ngPlus?: number;
  /** Abilities to equip; defaults to the profile's loadout. */
  skills?: (SkillId | null)[];
}

export function soloScene(app: App, opts: SoloOptions): Scene {
  // Copied: route forks rewrite segments of this list, and the shared campaign
  // list must not be mutated underneath the menu.
  const levels = opts.levels.length ? [...opts.levels] : [];
  const resume = opts.resume;
  /** Route taken per segment, so the map of the run can be restored and shown. */
  const routes = new Map<number, RouteId>(resume?.routes ?? []);
  let index = Math.min(
    Math.max(resume?.levelIndex ?? opts.startIndex ?? 0, 0),
    Math.max(levels.length - 1, 0),
  );
  let speed = resume?.speed ?? opts.speed ?? 1;
  const cycle = opts.ngPlus ?? 0;
  // A New Game+ cycle pays more XP; the levels themselves are sped up upstream.
  const startStats = resume?.stats ?? { ...baseStats(), xpMul: ngXpMul(cycle) };
  let arena = new Arena({
    level: levels[index],
    superId: resume?.superId ?? opts.superId,
    mode: 'solo',
    lives: resume?.lives ?? opts.lives,
    stats: startStats,
    perksTaken: resume ? new Map(resume.perks) : undefined,
    xpTotal: resume?.xpTotal,
    xpLevel: resume?.xpLevel,
    score: resume?.score,
  });
  if (resume) {
    arena.xpEarned = resume.xpEarned;
    arena.spec = resume.spec ?? null;
  }
  const skillRanks: Partial<Record<SkillId, number>> = Object.fromEntries(resume?.skillRanks ?? []);
  arena.equipSkills(opts.skills ?? app.profile.skills, skillRanks);
  applyRoute();
  let fx = new ArenaFx();
  const stepper = new FixedStepper();
  let layout = { scale: 1, ox: 0, oy: 0 };
  let paused = false;
  let finished = false;
  /** True while the between-levels panel is on screen: it must be built once,
   *  or rebuilding it every frame would swallow the click on its buttons. */
  let panelOpen = false;
  let debugOverlay = false;
  let cheatBall: BallTypeId = 'void';
  /** Marks where the current level started, so per-level stats are isolated. */
  let xpAtLevelStart = 0;
  let scoreAtLevelStart = 0;
  const runId = Math.random().toString(36).slice(2, 8);
  let t = 0;
  const exit = opts.onExit ?? mainMenu;
  music.setScene('game');
  markReached();

  // Prologue on a fresh campaign; a resumed run picks up mid-sentence.
  if (opts.trackProgress && !resume && index === 0) {
    storyPanel(PROLOGUE, '#4de2ff', clearPanel, cycle > 0 ? cycleLine(cycle) : undefined);
  } else if (opts.trackProgress && bossOf(index)) {
    announceBoss(index, clearPanel);
  }

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

  /** Hands the current segment's route rewards to the arena. */
  function applyRoute(): void {
    const route = routes.get(segmentOf(index));
    arena.routeXpMul = route ? ROUTES[route].xpMul : 1;
    arena.routeDropMul = route ? ROUTES[route].dropMul : 1;
  }

  /** Autosave. Only ever called between levels, where no ball is in flight and
   *  the run state is unambiguous. */
  function writeSave(): void {
    if (!opts.trackProgress) return;
    app.saveProfile((p) => {
      p.save = {
        levelIndex: index,
        lives: arena.lives,
        score: arena.score,
        xpTotal: arena.xpTotal,
        xpLevel: arena.xpLevel,
        xpEarned: arena.xpEarned,
        superId: arena.superId,
        stats: arena.stats,
        perks: [...arena.perksTaken],
        speed,
        spec: arena.spec,
        routes: [...routes],
        skillRanks: arena.skills.map((s) => [s.id, s.rank] as [SkillId, number]),
        savedAt: Date.now(),
      };
    });
  }

  function clearSave(): void {
    if (!opts.trackProgress) return;
    app.saveProfile((p) => {
      p.save = null;
    });
  }

  /** Shows a story beat and files it in the chronicle. Narrative never blocks
   *  play: the panel appears where the game already pauses. */
  function storyPanel(entry: StoryEntry, tone: string, onClose: () => void, extra?: string): void {
    app.saveProfile((p) => {
      if (!p.storySeen.includes(entry.id)) p.storySeen.push(entry.id);
    });
    panelOpen = true;
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${tone}` }, entry.title),
        ...entry.text.split('\n\n').map((para) => el('p', { class: 'story' }, para)),
        extra ? el('p', { class: 'hint', style: `color:${tone}` }, extra) : null,
        el('div', { class: 'row', style: 'margin-top:18px' }, button('Дальше', onClose, 'btn primary')),
      ),
    );
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
    const spec = arena.spec;
    const ranks = Object.fromEntries(arena.skills.map((s) => [s.id, s.rank])) as Partial<Record<SkillId, number>>;
    const equipped = arena.skills.map((s) => s.id);
    arena = new Arena(carry);
    arena.xpEarned = xpEarned;
    arena.spec = spec;
    arena.equipSkills(equipped, ranks);
    arena.xpInto = 0;
    applyRoute();
    arena.energy = Math.min(100, arena.energy);
    fx = new ArenaFx();
    markReached();
    writeSave();
    if (opts.trackProgress && bossOf(index)) announceBoss(index, clearPanel);
    else clearPanel();
  }

  /** After every segment the campaign forks: the next ten levels are rebuilt
   *  around whichever route the player picks. */
  function offerRoute(): void {
    const nextSegment = segmentOf(index + 1);
    const choices = routeChoices(nextSegment);

    panel(
      'РАЗВИЛКА',
      '#ffd24d',
      [`Куда идти дальше? Выбор определит следующие ${SEGMENT} уровней.`],
      choices.map((route) =>
        button(
          `${route.icon} ${route.name}`,
          () => {
            takeRoute(route, nextSegment);
          },
          'btn primary small',
        ),
      ),
    );

    // Descriptions go under the buttons so the choice is informed.
    const screen = app.overlay.querySelector('.screen');
    if (screen) {
      for (const route of choices) {
        screen.append(
          el(
            'p',
            { class: 'hint', style: `color:${route.color};margin:8px 0 0` },
            `${route.icon} ${route.name}: ${route.desc}`,
          ),
        );
      }
    }
  }

  function takeRoute(route: RouteDef, segment: number): void {
    routes.set(segment, route.id);
    // Rebuild this segment's levels with the route's recipe.
    const from = segment * SEGMENT;
    const to = Math.min(from + SEGMENT, levels.length);
    for (let i = from; i < to; i++) {
      levels[i] = generateLevel(i, levels.length, 0x9e37 + cycle * 101, route);
    }
    fx.text(240, 300, route.name.toUpperCase(), route.color);
    sfx.play('levelup');
    storyPanel(ROUTE_LORE[route.id], route.color, () => nextLevel());
  }

  /** Books the level into the profile's stats and pays the time bonus. */
  function settleLevel(): number {
    const seconds = arena.levelTime;
    const bonus = timeBonus(seconds, index);
    arena.score += bonus;
    if (opts.trackProgress) {
      const xpHere = Math.round(arena.xpEarned - xpAtLevelStart);
      app.saveProfile((p) => {
        recordClear(p.levelStats, index, { time: seconds, score: arena.score - scoreAtLevelStart, xp: xpHere });
      });
      submitToHall();
    }
    reportProgress();
    xpAtLevelStart = arena.xpEarned;
    scoreAtLevelStart = arena.score;
    return bonus;
  }

  /** Tells the room what this player is up to, for the spectator list. */
  function reportProgress(): void {
    net.reportProgress({
      level: index + 1,
      score: arena.score,
      lives: arena.lives,
      xpLevel: arena.xpLevel,
      mode: opts.title,
      cleared: 0,
    });
  }

  function submitToHall(): void {
    hall.submit({
      id: `${app.profile.id}-${runId}`,
      player: app.profile.name,
      score: arena.score,
      level: index + 1,
      xp: Math.round(arena.xpEarned),
      time: arena.levelTime,
      mode: opts.title,
    });
  }

  /** Which boss guards a level, if any — the level carries the id. */
  function bossOf(i: number): keyof typeof BOSS_INTRO | null {
    return (levels[i]?.boss as keyof typeof BOSS_INTRO | undefined) ?? null;
  }

  function announceBoss(i: number, onClose: () => void): void {
    const id = bossOf(i);
    if (!id) return onClose();
    storyPanel(BOSS_INTRO[id], '#ff4d6d', onClose);
  }

  function levelCleared(): void {
    const bonus = settleLevel();
    const isLast = index >= levels.length - 1 && !opts.endless;
    // A route choice replaces the plain "next level" panel at segment borders.
    const atFork = !isLast && opts.trackProgress && (index + 1) % SEGMENT === 0;
    if (atFork) {
      offerRoute();
      return;
    }
    panel(
      isLast ? 'ПОСЛЕДНИЙ РУБЕЖ ПРОЙДЕН' : `УРОВЕНЬ ${index + 1} ПРОЙДЕН`,
      '#3ddc84',
      [
        bossOf(index) ? BOSS_DEFEAT[bossOf(index)!] : '',
        `Время: ${formatTime(arena.levelTime)} · бонус за скорость: +${bonus}`,
        `Счёт: ${arena.score} · опыт за забег: ${Math.round(arena.xpEarned)}`,
        `Уровень мастерства: ${arena.xpLevel} · жизней: ${arena.lives}`,
      ].filter(Boolean),
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
    // Finishing the campaign opens the next cycle: the account keeps its level
    // and skills, the campaign starts over faster and richer.
    const nextCycle = opts.trackProgress ? cycle + 1 : cycle;
    app.saveProfile((p) => {
      p.campaignCleared = Math.max(p.campaignCleared, levels.length);
      if (opts.trackProgress) {
        p.ngPlus = Math.max(p.ngPlus, nextCycle);
        p.campaignReached = 1;
      }
    });
    clearSave();

    if (opts.trackProgress) {
      storyPanel(FINALE, '#ffd24d', () => showVictory(nextCycle), cycleLine(nextCycle));
      return;
    }
    showVictory(nextCycle);
  }

  function showVictory(nextCycle: number): void {
    panel(
      'ПОБЕДА',
      '#ffd24d',
      [
        `Все уровни пройдены. Счёт: ${arena.score}.`,
        `Опыт забега: ${Math.round(arena.xpEarned)} — зачислен в профиль.`,
        opts.trackProgress
          ? `Открыт виток ${nextCycle}: мяч быстрее на ${Math.round((ngBallSpeedMul(nextCycle) - 1) * 100)}%, опыта больше на ${Math.round((ngXpMul(nextCycle) - 1) * 100)}%. Уровень профиля и суперы остаются с вами.`
          : '',
      ].filter(Boolean),
      [
        opts.trackProgress
          ? button(
              `Кампания+ (виток ${nextCycle})`,
              () =>
                app.setScene((a) =>
                  soloScene(a, {
                    ...opts,
                    levels: a.campaignLevels(),
                    resume: undefined,
                    startIndex: 0,
                    ngPlus: nextCycle,
                  }),
                ),
              'btn primary',
            )
          : null,
        button('В меню', () => app.setScene(exit)),
      ].filter((b): b is HTMLButtonElement => b !== null),
    );
  }

  function dead(): void {
    if (finished) return;
    finished = true;
    if (opts.trackProgress) {
      app.saveProfile((p) => recordDeath(p.levelStats, index));
      submitToHall();
    }
    bank();
    const saved = opts.trackProgress ? app.profile.save : null;
    panel('ЗАБЕГ ОКОНЧЕН', '#ff4d6d', [
      `Уровень ${index + 1} из ${levels.length}. Счёт: ${arena.score}.`,
      `Опыт забега: ${Math.round(arena.xpEarned)} — зачислен в профиль.`,
      saved ? `Автосохранение цело: уровень ${saved.levelIndex + 1}.` : '',
    ].filter(Boolean), [
      saved
        ? button(
            `С уровня ${saved.levelIndex + 1}`,
            () => app.setScene((a) => soloScene(a, { ...opts, resume: saved })),
            'btn primary',
          )
        : null,
      button('Заново', () => app.setScene((a) => soloScene(a, { ...opts, resume: undefined, startIndex: 0 }))),
      button('В меню', () => app.setScene(exit)),
    ].filter((b): b is HTMLButtonElement => b !== null));
  }

  /** Admin-only cheats and the debug overlay. Ignored for normal profiles. */
  function adminKeys(): void {
    const input = app.input;
    if (input.wasPressed(['KeyG'])) {
      arena.god = !arena.god;
      fx.text(240, 330, arena.god ? 'БЕССМЕРТИЕ ВКЛ' : 'БЕССМЕРТИЕ ВЫКЛ', '#3ddc84');
    }
    if (input.wasPressed(['KeyH'])) {
      arena.lives++;
      fx.text(240, 356, '+1 ЖИЗНЬ', '#ff5fa2');
    }
    if (input.wasPressed(['KeyJ'])) {
      arena.energy = ENERGY_MAX;
      fx.text(240, 382, 'СУПЕР ЗАРЯЖЕН', '#b06bff');
    }
    if (input.wasPressed(['KeyK'])) {
      arena.clearField();
      fx.text(240, 408, 'УРОВЕНЬ ПРОПУЩЕН', '#ffd24d');
    }
    if (input.wasPressed(['KeyL'])) {
      const ids: BallTypeId[] = ['lava', 'aqua', 'laser', 'plasma', 'void'];
      const next = ids[(ids.indexOf(cheatBall) + 1) % ids.length];
      cheatBall = next;
      if (arena.balls.length === 0) arena.addBall();
      arena.setBallType(next);
    }
    if (input.wasPressed(['KeyU'])) {
      // Straight to the next mastery level, for testing perks and the fork.
      arena.addXp((arena.xpNeed - arena.xpInto) / (arena.stats.xpMul * arena.routeXpMul * XP_RATE) + 1);
    }
    if (input.wasPressed(['KeyO'])) debugOverlay = !debugOverlay;
  }

  /** In-run speed toggle, so a slow level can be sped up without restarting. */
  function cycleSpeed(): void {
    const i = SPEED_CHOICES.indexOf(speed as (typeof SPEED_CHOICES)[number]);
    speed = SPEED_CHOICES[(i + 1) % SPEED_CHOICES.length];
    app.saveProfile((p) => (p.gameSpeed = speed));
    fx.text(240, 300, `СКОРОСТЬ ×${speed}`, '#ffd24d');
    sfx.play('ui');
  }

  function togglePause(): void {
    paused = !paused;
    if (!paused) return clearPanel();
    showPausePanel();
  }

  function showPausePanel(): void {
    panel(
      'ПАУЗА',
      '#4de2ff',
      [
        'Мышь или A/D — движение. Пробел — запуск и лазер. Shift — супер.',
        `Скорость игры: ×${speed} — клавиша F переключает её и на ходу.`,
      ],
      [
      button('Продолжить', () => {
        paused = false;
        clearPanel();
      }, 'btn primary'),
      ...SPEED_CHOICES.map((s) =>
        button(
          `×${s}`,
          () => {
            speed = s;
            app.saveProfile((p) => (p.gameSpeed = s));
            showPausePanel();
          },
          `btn small${speed === s ? ' primary' : ''}`,
        ),
      ),
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
      if (app.input.wasPressed(['KeyF'])) cycleSpeed();
      if (app.profile.admin) adminKeys();
      fx.update(dt);
      if (paused || finished) return;

      const pointer = app.pointer;
      const arenaX = pointer && layout.scale > 0 ? (pointer.x - layout.ox) / layout.scale : null;
      const input =
        arena.state === 'cleared' ? noInput() : app.input.read(SOLO_KEYS, clampPointer(arenaX));

      // Speed multiplier feeds the clock, not the physics: every timer, drop and
      // bounce scales together, so the game stays exactly itself, just faster.
      stepper.step(dt * speed, (sdt, first) => arena.update(sdt, edgeOnce(input, first)));
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
        subtitle: `${arena.level.name} · ${index + 1}/${levels.length}${speed > 1 ? ` · ×${speed}` : ''}`,
        fps: app.fps,
      });

      if (debugOverlay && app.profile.admin) {
        drawDebug(ctx, arena, ARENA_W + GAP + 8, 300, {
          fps: app.fps.toFixed(0),
          speed: `x${speed}`,
          level: `${index + 1}/${levels.length}`,
          save: app.profile.save ? `lvl ${app.profile.save.levelIndex + 1}` : 'none',
        });
      }
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
