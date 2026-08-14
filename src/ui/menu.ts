import { App, type Scene } from '../app';
import { CAMPAIGN_SIZE, CHAOS_FROM, levelTier } from '../core/campaignLevels';
import type { LevelData } from '../core/level';
import {
  accountLevel,
  addProfile,
  isSuperUnlocked,
  loadUserLevels,
  isSkillUnlocked,
  removeProfile,
  ngBallSpeedMul,
  ngXpMul,
  LIVES_CHOICES,
  MAX_PROFILES,
  SPEED_CHOICES,
  type Profile,
} from '../core/storage';
import { SUPER_LIST, SUPERS, type SuperId } from '../core/supers';
import { Backdrop } from '../render/backdrop';
import { soloScene } from '../game/campaign';
import { versusScene } from '../game/versus';
import { duelScene } from '../game/duel';
import { coopScene } from '../game/coop';
import { editorScene } from '../editor/editor';
import { button, el } from './dom';
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { BALL_TYPE_LIST } from '../core/balls';
import { SKILL_LIST, SKILL_SLOTS } from '../core/skills';
import { formatTime, summarise } from '../core/stats';
import { hall } from '../core/hall';
import { ALL_ENTRIES, type StoryEntry } from '../core/story';
import { net } from '../net/client';
import { netVersusScene } from '../game/netVersus';
import { raceScene } from '../game/race';
import { pinballScene } from '../game/pinball';
import { RACE_DISTANCES, SEAT_KEY_LABELS, TEAM_COLORS, TEAM_LABELS } from '../core/race';
import { RaceNet } from '../game/raceNet';
import type { RaceSeat } from '../net/raceProtocol';

/** The menu is a canvas backdrop plus a DOM overlay; every screen swaps the
 *  overlay contents and leaves the animation running underneath. */
export function mainMenu(app: App): Scene {
  const backdrop = new Backdrop();
  /** Which skill slot the next pick fills, and a hook to redraw the setup screen. */
  let editingSlot = 0;
  let renderSolo: (() => void) | null = null;
  /** Live subscription to the shared hall, dropped when leaving that screen. */
  let unsubscribe: (() => void) | null = null;
  /** The race lobby's connection. Kept here so that re-entering the lobby never
   *  leaves an older listener behind, still redrawing over whatever came next. */
  let raceLobby: RaceNet | null = null;

  function closeRaceLobby(): void {
    raceLobby?.dispose();
    raceLobby = null;
    unsubscribe?.();
    unsubscribe = null;
  }

  const show = (...nodes: HTMLElement[]): void => {
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(...nodes);
  };

  // ------------------------------------------------------------ main menu --

  function screenMain(): void {
    const acc = accountLevel(app.profile);
    const userLevels = loadUserLevels();

    show(
      el(
        'div',
        { class: 'screen' },
        el('h1', { class: 'logo' }, 'NEONOID'),
        el('p', { class: 'tagline' }, 'Арканоид · опыт · суперудары · PvP'),

        el(
          'div',
          { class: 'row between', style: 'margin-bottom:16px' },
          el(
            'div',
            { class: 'row', style: 'gap:8px' },
            el('span', { class: 'pill' }, `Игрок: ${app.profile.name}`),
            app.profile.admin ? el('span', { class: 'pill pink' }, 'админ') : null,
          ),
          button('Сменить игрока', screenProfiles, 'btn small ghost'),
        ),

        el(
          'div',
          { class: 'row between', style: 'margin-bottom:22px;gap:20px' },
          el(
            'div',
            { style: 'flex:1;min-width:260px' },
            el(
              'div',
              { class: 'row', style: 'gap:8px;margin-bottom:8px' },
              el('span', { class: 'pill amber' }, `Уровень ${acc.level}`),
              el('span', { class: 'pill' }, `Рекорд ${app.profile.bestScore}`),
              el('span', { class: 'pill pink' }, `Забегов ${app.profile.runs}`),
              app.profile.ngPlus > 0 ? el('span', { class: 'pill pink' }, `Виток ${app.profile.ngPlus}`) : null,
            ),
            el('div', { class: 'xpbar' }, el('div', { style: `width:${(acc.into / acc.need) * 100}%` })),
            el(
              'p',
              { class: 'hint', style: 'margin-top:6px' },
              `${Math.round(acc.into)} / ${acc.need} опыта до следующего уровня профиля`,
            ),
          ),
          el(
            'div',
            { style: 'text-align:right' },
            el('p', { class: 'hint' }, `Счёт PvP: ${app.profile.versusWins[0]} : ${app.profile.versusWins[1]}`),
            el('p', { class: 'hint' }, `Пройдено уровней: ${app.profile.campaignReached} / ${CAMPAIGN_SIZE}`),
            el('p', { class: 'hint' }, `Своих уровней: ${userLevels.length}`),
          ),
        ),

        el(
          'div',
          { class: 'grid c3' },
          app.profile.save
            ? modeCard(
                '▶',
                'Продолжить забег',
                `Уровень ${app.profile.save.levelIndex + 1} · счёт ${app.profile.save.score} · жизней ${app.profile.save.lives}`,
                () => {
                  const save = app.profile.save!;
                  app.setScene((a) =>
                    soloScene(a, {
                      levels: app.campaignLevels(),
                      superId: save.superId,
                      title: 'Кампания',
                      trackProgress: true,
                      resume: save,
                    }),
                  );
                },
              )
            : null,
          modeCard(
            '🎯',
            app.profile.save ? 'Новая кампания' : 'Кампания',
            app.profile.ngPlus > 0
              ? `Виток ${app.profile.ngPlus}: мяч быстрее на ${Math.round((ngBallSpeedMul(app.profile.ngPlus) - 1) * 100)}%, опыта +${Math.round((ngXpMul(app.profile.ngPlus) - 1) * 100)}%`
              : `${CAMPAIGN_SIZE} уровней: с ${CHAOS_FROM}-го — хаос и хардкор`,
            () => screenSolo(app.campaignLevels(), 'Кампания', { campaign: true }),
          ),
          modeCard('🗺', 'Выбор уровня', `Начать с любого из ${CAMPAIGN_SIZE} уровней кампании`, () => screenLevelSelect()),
          modeCard(
            '🧱',
            'Свои уровни',
            userLevels.length ? `${userLevels.length} уровней в вашей библиотеке` : 'Пока пусто — создайте в редакторе',
            () => (userLevels.length ? screenSolo(userLevels, 'Свои уровни') : screenEditor()),
          ),
          modeCard('🤝', 'Кооп на двоих', 'Одно поле вдвое шире, две ракетки, общие мячи и жизни', () =>
            app.setScene((a) =>
              coopScene(a, {
                levels: a.campaignLevels(),
                superId: a.profile.favouriteSuper,
                lives: a.profile.lives,
                speed: a.profile.gameSpeed,
                ngPlus: a.profile.ngPlus,
              }),
            ),
          ),
          modeCard(
            '🎲',
            'Гонка',
            'Настолка на 2–6 игроков: кубик, червоточины, бафы и дебафы в чужой уровень',
            () => screenRace(),
          ),
          modeCard(
            '🕹',
            'Пинбол',
            'Настоящий стол: гравитация, флипперы и плунжер, а кирпичи наверху',
            () =>
              app.setScene((a) =>
                pinballScene(a, {
                  levels: a.campaignLevels(),
                  startIndex: Math.min(12, CAMPAIGN_SIZE - 1),
                }),
              ),
          ),
          modeCard('⚔️', 'Дуэль 1 на 1', 'Общее поле, две ракетки, счёт до 5 голов', () => screenVersus('duel')),
          modeCard('🪟', 'Раздельный экран', 'Два поля рядом, атаки мусорными кирпичами', () => screenVersus('split')),
          modeCard('🛠', 'Редактор уровней', 'Рисуйте поля, тестируйте, экспортируйте', () => screenEditor()),
          modeCard('📖', 'Хроника', `Открыто записей: ${app.profile.storySeen.length} из ${ALL_ENTRIES.length}`, () => screenStory()),
          modeCard('📊', 'Статистика', 'По каждому уровню и по всем игрокам', () => screenStats()),
          modeCard(
            '🌐',
            'Сеть',
            net.status === 'online'
              ? `В комнате: ${net.peers.length} · ${net.shareUrl}`
              : 'Игра по локальной сети и общий доступ по ссылке',
            () => screenNetwork(),
          ),
          modeCard('🏆', 'Доска почёта', 'Общая для всех запущенных копий игры', () => screenHall()),
          modeCard('🔊', 'Звук и музыка', 'Громкость эффектов, свои треки из Suno', () => screenAudio()),
          modeCard('⌨️', 'Управление и правила', 'Клавиши, бонусы, шары, кирпичи', () => screenHelp()),
        ),
      ),
    );
  }

  const modeCard = (icon: string, title: string, desc: string, onClick: () => void): HTMLElement =>
    el(
      'div',
      { class: 'card', onclick: onClick },
      el('div', { class: 'title' }, el('span', { class: 'icon' }, icon), title),
      el('div', { class: 'desc' }, desc),
    );

  // --------------------------------------------------------- super picker --

  function superPicker(current: SuperId, onPick: (id: SuperId) => void, showLocks = true): HTMLElement {
    const grid = el('div', { class: 'grid c2' });
    for (const def of SUPER_LIST) {
      const locked = showLocks && !isSuperUnlocked(app.profile, def.id);
      const card = el(
        'div',
        {
          class: `card${def.id === current ? ' selected' : ''}${locked ? ' locked' : ''}`,
          onclick: () => {
            if (locked) return;
            onPick(def.id);
          },
        },
        el(
          'div',
          { class: 'title', style: `color:${def.color}` },
          el('span', { class: 'icon' }, def.icon),
          def.name,
          locked ? el('span', { class: 'pill' }, `с ур. ${def.unlockLevel}`) : null,
        ),
        el('div', { class: 'desc' }, def.desc),
        el('div', { class: 'desc', style: 'color:rgba(255,95,162,0.8)' }, `PvP: ${def.pvp}`),
      );
      grid.append(card);
    }
    return grid;
  }

  // ---------------------------------------------------------- skill picker --

  /** Two slots; clicking a skill puts it in the slot being edited. */
  function skillPicker(): HTMLElement {
    const equipped = app.profile.skills;
    const grid = el('div', { class: 'grid c3' });

    for (const def of SKILL_LIST) {
      const locked = !isSkillUnlocked(app.profile, def.id);
      const slot = equipped.indexOf(def.id);
      grid.append(
        el(
          'div',
          {
            class: `card${slot >= 0 ? ' selected' : ''}${locked ? ' locked' : ''}`,
            onclick: () => {
              if (locked) return;
              const next = [...app.profile.skills];
              if (slot >= 0) next[slot] = null;
              else {
                const free = next.findIndex((s) => s === null);
                next[free >= 0 ? free : editingSlot] = def.id;
                editingSlot = (editingSlot + 1) % SKILL_SLOTS;
              }
              app.saveProfile((p) => (p.skills = next));
              sfx.play('ui');
              renderSolo?.();
            },
          },
          el(
            'div',
            { class: 'title', style: `color:${def.color}` },
            el('span', { class: 'icon' }, def.icon),
            def.name,
            slot >= 0 ? el('span', { class: 'pill' }, slot === 0 ? 'Q' : 'E') : null,
            locked ? el('span', { class: 'pill' }, `с ур. ${def.unlockLevel}`) : null,
          ),
          el('div', { class: 'desc' }, def.desc),
          el('div', { class: 'desc', style: 'opacity:.75' }, `Перезарядка ${def.cooldown} с`),
        ),
      );
    }
    return grid;
  }

  // --------------------------------------------------------------- profiles --

  function profileCard(p: Profile, isAdminViewer: boolean): HTMLElement {
    const acc = accountLevel(p);
    const active = p.id === app.store.activeId;

    return el(
      'div',
      { class: `card${active ? ' selected' : ''}` },
      el(
        'div',
        { class: 'title', onclick: () => { app.switchProfile(p.id); sfx.play('ui'); screenMain(); } },
        el('span', { class: 'icon' }, p.admin ? '★' : '●'),
        p.name,
        active ? el('span', { class: 'pill' }, 'активен') : null,
      ),
      el(
        'div',
        { class: 'desc' },
        `Уровень ${acc.level} · опыт ${Math.round(p.totalXp)} · кампания ${p.campaignReached}/${CAMPAIGN_SIZE}`,
      ),
      el(
        'div',
        { class: 'desc' },
        p.save ? `Автосохранение: уровень ${p.save.levelIndex + 1}, счёт ${p.save.score}` : 'Сохранённого забега нет',
      ),
      isAdminViewer
        ? el(
            'div',
            { class: 'row', style: 'gap:6px;margin-top:8px' },
            el('input', {
              type: 'text',
              value: p.name,
              style: 'max-width:150px',
              onchange: (e: Event) => {
                const name = (e.target as HTMLInputElement).value.trim().slice(0, 24);
                if (!name) return;
                app.commitStore(() => (p.name = name));
                screenProfiles();
              },
            }),
            button(
              'Сбросить',
              () => {
                app.commitStore(() => {
                  p.totalXp = 0;
                  p.campaignReached = 1;
                  p.campaignCleared = 0;
                  p.bestScore = 0;
                  p.runs = 0;
                  p.save = null;
                });
                screenProfiles();
              },
              'btn small',
            ),
            app.store.players.length > 1
              ? button(
                  'Удалить',
                  () => {
                    removeProfile(app.store, p.id);
                    screenProfiles();
                  },
                  'btn small danger',
                )
              : null,
          )
        : null,
    );
  }

  function screenProfiles(): void {
    const viewerIsAdmin = app.profile.admin;
    const nameInput = el('input', { type: 'text', placeholder: 'Имя игрока', style: 'max-width:220px' });

    const create = (): void => {
      const created = addProfile(app.store, nameInput.value || `Игрок ${app.store.players.length + 1}`);
      if (!created) return;
      sfx.play('powerup');
      screenProfiles();
    };

    show(
      el(
        'div',
        { class: 'screen' },
        el('h2', {}, 'Игроки'),
        el(
          'p',
          { class: 'hint' },
          `До ${MAX_PROFILES} профилей. У каждого свой уровень, суперы, настройки и один автосохраняемый забег — он пишется после каждого пройденного уровня.`,
        ),

        el('div', { class: 'grid c2', style: 'margin-top:14px' }, ...app.store.players.map((p) => profileCard(p, viewerIsAdmin))),

        app.store.players.length < MAX_PROFILES
          ? el(
              'div',
              { class: 'row', style: 'margin-top:16px' },
              nameInput,
              button('Создать игрока', create, 'btn small primary'),
            )
          : el('p', { class: 'hint', style: 'margin-top:16px' }, `Достигнут предел в ${MAX_PROFILES} профилей.`),

        el(
          'div',
          { class: 'row', style: 'margin-top:20px' },
          button('Назад', screenMain, 'btn ghost'),
          !viewerIsAdmin
            ? el('span', { class: 'hint' }, 'Переименование и удаление доступны админскому профилю.')
            : null,
        ),
      ),
    );
  }

  // ----------------------------------------------------------- level select --

  function screenLevelSelect(): void {
    const reached = app.profile.campaignReached;
    const grid = el('div', { class: 'level-grid' });

    app.campaignLevels().forEach((level, i) => {
      const tier = levelTier(i);
      const best = i + 1 <= reached;
      grid.append(
        el(
          'button',
          {
            class: `level-cell ${tier}${best ? ' reached' : ''}`,
            title: `${level.name} · скорость мяча ${(level.ballSpeed ?? 1).toFixed(2)}×`,
            onclick: () => {
              sfx.play('ui');
              screenSolo(app.campaignLevels(), `Кампания · ${i + 1}`, { campaign: true, startIndex: i });
            },
          },
          String(i + 1),
        ),
      );
    });

    show(
      el(
        'div',
        { class: 'screen' },
        el('h2', {}, 'Выбор уровня'),
        el(
          'p',
          { class: 'hint' },
          `Забег продолжается с выбранного уровня и идёт до ${CAMPAIGN_SIZE}-го. Уровни с ${CHAOS_FROM}-го генерируются случайно и не жалеют никого.`,
        ),
        el(
          'div',
          { class: 'row', style: 'gap:8px;margin:12px 0' },
          el('span', { class: 'pill' }, 'Пройдено: ' + reached),
          el('span', { class: 'pill' }, '1–10 · вручную'),
          el('span', { class: 'pill amber' }, `11–${CHAOS_FROM - 1} · генератор`),
          el('span', { class: 'pill pink' }, `${CHAOS_FROM}–${CAMPAIGN_SIZE} · хаос`),
        ),
        grid,
        el('div', { class: 'row', style: 'margin-top:20px' }, button('Назад', screenMain, 'btn ghost')),
      ),
    );
  }

  // ------------------------------------------------------------ solo setup --

  function screenSolo(levels: LevelData[], title: string, opts: { campaign?: boolean; startIndex?: number } = {}): void {
    let chosen: SuperId = app.profile.favouriteSuper;
    if (!isSuperUnlocked(app.profile, chosen)) chosen = 'barrage';

    const render = (): void => {
      renderSolo = render;
      show(
        el(
          'div',
          { class: 'screen' },
          el('h2', {}, title),
          el(
            'p',
            { class: 'hint' },
            `${levels.length} уровней${opts.startIndex ? `, старт с ${opts.startIndex + 1}-го` : ''}. Опыт копится внутри забега — каждый новый уровень мастерства даёт выбор из трёх усилений.`,
          ),
          opts.campaign && app.profile.ngPlus > 0
            ? el(
                'p',
                { class: 'hint', style: 'color:var(--pink)' },
                `Виток ${app.profile.ngPlus}: мяч быстрее на ${Math.round((ngBallSpeedMul(app.profile.ngPlus) - 1) * 100)}%, опыт идёт с прибавкой ${Math.round((ngXpMul(app.profile.ngPlus) - 1) * 100)}%. Уровень профиля, суперы и рекорды сохраняются между витками.`,
              )
            : null,
          opts.campaign && app.profile.save
            ? el(
                'p',
                { class: 'hint', style: 'color:var(--amber)' },
                `Внимание: новый забег перезапишет автосохранение (уровень ${app.profile.save.levelIndex + 1}). Чтобы вернуться к нему, выберите «Продолжить забег» в меню.`,
              )
            : null,
          el(
            'div',
            { class: 'row', style: 'gap:26px;margin-top:18px;align-items:flex-start' },
            el(
              'div',
              {},
              el('h3', {}, 'Жизни'),
              el(
                'div',
                { class: 'row', style: 'gap:6px' },
                ...LIVES_CHOICES.map((n) =>
                  button(
                    n === 1 ? '1 — хардкор' : String(n),
                    () => {
                      app.saveProfile((p) => (p.lives = n));
                      sfx.play('ui');
                      render();
                    },
                    `btn small${app.profile.lives === n ? ' primary' : ''}`,
                  ),
                ),
              ),
            ),
            el(
              'div',
              {},
              el('h3', {}, 'Скорость игры'),
              el(
                'div',
                { class: 'row', style: 'gap:6px' },
                ...SPEED_CHOICES.map((s) =>
                  button(
                    `×${s}`,
                    () => {
                      app.saveProfile((p) => (p.gameSpeed = s));
                      sfx.play('ui');
                      render();
                    },
                    `btn small${app.profile.gameSpeed === s ? ' primary' : ''}`,
                  ),
                ),
              ),
              el('p', { class: 'hint', style: 'margin:6px 0 0' }, 'В игре переключается клавишей F'),
            ),
          ),

          el('h3', { style: 'margin-top:18px' }, 'Активные скиллы'),
          el('p', { class: 'hint', style: 'margin-top:0' }, 'Два слота: Q и E. Внутри забега скиллы можно поднять до III ранга.'),
          skillPicker(),

          el('h3', { style: 'margin-top:18px' }, 'Суперудар'),
          superPicker(chosen, (id) => {
            chosen = id;
            app.saveProfile((p) => (p.favouriteSuper = id));
            render();
          }),
          el(
            'div',
            { class: 'row', style: 'margin-top:22px' },
            button(
              'Начать',
              () =>
                app.setScene((a) =>
                  soloScene(a, {
                    levels,
                    superId: chosen,
                    title,
                    startIndex: opts.startIndex ?? 0,
                    trackProgress: opts.campaign === true,
                    lives: app.profile.lives,
                    speed: app.profile.gameSpeed,
                    ngPlus: opts.campaign ? app.profile.ngPlus : 0,
                  }),
                ),
              'btn primary',
            ),
            button('Назад', opts.campaign ? screenLevelSelect : screenMain, 'btn ghost'),
          ),
        ),
      );
    };
    render();
  }

  // ------------------------------------------------------------ race setup --

  function screenRace(): void {
    let count = 2;
    const names: string[] = ['Игрок 1', 'Игрок 2', 'Игрок 3', 'Игрок 4', 'Игрок 5', 'Игрок 6'];
    names[0] = app.profile.name;
    let distance: number = RACE_DISTANCES[0];
    /** Union per seat, null for a lone racer. Agreed before the match, because
     *  over the network there is no table to lean across afterwards. */
    const teams: (number | null)[] = [null, null, null, null, null, null];

    const render = (): void => {
      show(
        el(
          'div',
          { class: 'screen' },
          el('h2', {}, '🎲 Гонка'),
          el(
            'p',
            { class: 'hint' },
            'Ходят по очереди на одном компьютере. Свой ход — уровень против таймера, который только убывает; чужой — трансляция, в которую вы бросаете карты. После уровня — кубик: d6 плюс то, что вы наиграли.',
          ),
          el(
            'p',
            { class: 'hint' },
            'Примерно каждая третья клетка что-то делает, но все они закрыты: прыжок, провал, рулетка, обмен местами, аптечка, госпиталь, хронометр, тайник, обрыв в самое начало и реверс порядка ходов. Клетка открывается, когда на неё встали, и дальше светится для всех. На последней ждёт DOH — только его смерть заканчивает гонку.',
          ),

          el('h3', { style: 'margin-top:16px' }, 'Игроки'),
          el(
            'div',
            { class: 'row', style: 'gap:6px' },
            ...[2, 3, 4, 5, 6].map((n) =>
              button(
                `${n}`,
                () => {
                  count = n;
                  sfx.play('ui');
                  render();
                },
                `btn small${count === n ? ' primary' : ''}`,
              ),
            ),
          ),
          el(
            'div',
            { class: 'grid c3', style: 'margin-top:10px' },
            ...names.slice(0, count).map((n, i) =>
              el(
                'div',
                {},
                el(
                  'label',
                  { class: 'field' },
                  `Место ${i + 1} · клавиши ${SEAT_KEY_LABELS[i].join(' ')}`,
                  el('input', {
                    type: 'text',
                    value: n,
                    oninput: (e: Event) => {
                      names[i] = (e.target as HTMLInputElement).value || `Игрок ${i + 1}`;
                    },
                  }),
                ),
                el(
                  'div',
                  { class: 'row', style: 'gap:4px;margin-top:6px' },
                  button(
                    'сам за себя',
                    () => {
                      teams[i] = null;
                      sfx.play('ui');
                      render();
                    },
                    `btn small${teams[i] === null ? ' primary' : ' ghost'}`,
                  ),
                  ...TEAM_LABELS.map((label, t) =>
                    button(
                      label,
                      () => {
                        // Three to a union: more than that and the race becomes
                        // two blocks staring at each other.
                        if (teams[i] !== t && teams.filter((x) => x === t).length >= 3) return;
                        teams[i] = t;
                        sfx.play('ui');
                        render();
                      },
                      `btn small${teams[i] === t ? ' primary' : ' ghost'}`,
                    ),
                  ),
                ),
              ),
            ),
          ),

          el(
            'p',
            { class: 'hint', style: 'margin-top:10px' },
            'Союз: до трёх мест под одной буквой. Союзники не бьют друг друга, делятся картами за зачистку и могут передавать собранные жизни, а победа одного засчитывается всем. Союзы можно собрать и по ходу партии, но здесь — заранее.',
          ),
          teams.some((t) => t !== null)
            ? el(
                'div',
                { class: 'row', style: 'gap:8px;margin-top:6px' },
                ...TEAM_LABELS.map((label, t) => {
                  const members = names.slice(0, count).filter((_, i) => teams[i] === t);
                  return members.length
                    ? el(
                        'span',
                        { class: 'pill', style: `border-color:${TEAM_COLORS[t]};color:${TEAM_COLORS[t]}` },
                        `Союз ${label}: ${members.join(' + ')}`,
                      )
                    : null;
                }).filter((x): x is HTMLElement => x !== null),
              )
            : null,

          el('h3', { style: 'margin-top:16px' }, 'Дистанция'),
          el(
            'div',
            { class: 'row', style: 'gap:6px' },
            ...RACE_DISTANCES.map((d) =>
              button(
                d === 20 ? '20 · блиц' : d === 50 ? '50 · стандарт' : '100 · полная',
                () => {
                  distance = d;
                  sfx.play('ui');
                  render();
                },
                `btn small${distance === d ? ' primary' : ''}`,
              ),
            ),
          ),
          el(
            'p',
            { class: 'hint', style: 'margin-top:6px' },
            'Трасса растянута на всю кампанию: даже блиц заканчивается мега-боссом.',
          ),

          el('h3', { style: 'margin-top:16px' }, 'Клавиши во время чужого хода'),
          el(
            'p',
            { class: 'hint', style: 'margin-top:0' },
            'Карты не респаунятся: их ловят на своём уровне (капсула ★) и получают за зачистку, а потом тратят в чужие ходы. Первые три из запаса лежат на ваших клавишах. Самые дорогие — «+10 / +15 секунд» союзнику и «−10 / −15» врагу: таймер идёт вниз, и секунды решают. Тот, кто играет, жмёт R и один раз за ход отбивает входящую карту — карта бросавшего сгорает всё равно.',
          ),

          el(
            'div',
            { class: 'row', style: 'margin-top:20px' },
            net.status === 'online'
              ? button(
                  net.supports('race') ? 'Гонка по сети' : 'Гонка по сети (сервер старый)',
                  () => screenRaceLobby(names.slice(0, count), teams.slice(0, count), distance),
                  `btn${net.supports('race') ? '' : ' ghost'}`,
                )
              : null,
            button(
              'Начать гонку',
              () =>
                app.setScene((a) =>
                  raceScene(a, {
                    names: names.slice(0, count),
                    teams: teams.slice(0, count),
                    distance,
                    levels: a.raceLevels(),
                    superId: a.profile.favouriteSuper,
                    speed: a.profile.gameSpeed,
                  }),
                ),
              'btn primary',
            ),
            button('Назад', screenMain, 'btn ghost'),
          ),
        ),
      );
    };
    render();
  }

  // ----------------------------------------------------------- race lobby --

  /** Seats, not computers: this laptop claims one seat per person sitting at
   *  it, so a team of three round one screen and six people on six screens are
   *  the same thing to the referee. */
  function screenRaceLobby(initialNames: string[], initialTeams: (number | null)[], distance: number): void {
    let seats: RaceSeat[] = [];
    let hostId = '';
    let count = Math.max(1, initialNames.length);
    const names = [...initialNames, 'Игрок 5', 'Игрок 6'];
    const teams = [...initialTeams, null, null];
    let chosenDistance = distance;

    raceLobby?.dispose();
    const lobby = new RaceNet({
      lobby: (list, host) => {
        seats = list;
        hostId = host;
        render();
      },
      started: (seed, dist, list) => {
        // Hand over cleanly: the lobby must stop listening before the race
        // scene appears, or its next redraw paints straight over the game.
        closeRaceLobby();
        const mySeats = list.filter((s) => s.owner === net.selfId).map((s) => s.seat);
        app.setScene((a) =>
          raceScene(a, {
            names: list.map((s) => s.name),
            teams: list.map((s) => s.team),
            distance: dist,
            levels: a.raceLevels(),
            superId: a.profile.favouriteSuper,
            speed: a.profile.gameSpeed,
            net: { seed, mySeats },
          }),
        );
      },
    });

    raceLobby = lobby;

    const claim = (): void => {
      lobby.claim(names.slice(0, count).map((name, i) => ({ name, team: teams[i] ?? null })));
    };
    claim();

    const leave = (): void => {
      lobby.leave();
      closeRaceLobby();
      screenMain();
    };

    const render = (): void => {
      const mine = seats.filter((s) => s.owner === net.selfId);
      // Anyone sitting at the table may set the distance and start it. Tying
      // that to a single "host" only produced rooms where nobody could begin
      // because the host had reconnected and become somebody else.
      const seated = mine.length > 0;
      const hostName = seats.find((s) => s.owner === hostId)?.name ?? '';

      show(
        el(
          'div',
          { class: 'screen' },
          el('h2', {}, '🎲 Гонка по сети'),
          net.supports('race')
            ? null
            : el(
                'p',
                { class: 'hint', style: 'color:var(--pink);font-weight:700' },
                'Сервер комнат старой версии — он не знает про гонку, поэтому стол останется пустым. Перезапустите его: остановите старый запуск (Ctrl+C или `lsof -ti tcp:8080 | xargs kill`) и снова `npm run lan`.',
              ),
          el(
            'p',
            { class: 'hint' },
            `Комната: ${net.shareUrl} · подключено ${net.peers.length}. Место — это человек, а не компьютер: за одним ноутбуком можно занять несколько мест, каждое со своим рядом клавиш.`,
          ),

          el('h3', { style: 'margin-top:14px' }, 'Мест за этим компьютером'),
          el(
            'div',
            { class: 'row', style: 'gap:6px' },
            ...[1, 2, 3].map((n) =>
              button(
                String(n),
                () => {
                  count = n;
                  claim();
                  sfx.play('ui');
                  render();
                },
                `btn small${count === n ? ' primary' : ''}`,
              ),
            ),
          ),
          el(
            'div',
            { class: 'grid c3', style: 'margin-top:10px' },
            ...names.slice(0, count).map((n, i) =>
              el(
                'div',
                {},
                el(
                  'label',
                  { class: 'field' },
                  `Место ${i + 1} · клавиши ${SEAT_KEY_LABELS[i].join(' ')}`,
                  el('input', {
                    type: 'text',
                    value: n,
                    oninput: (e: Event) => {
                      names[i] = (e.target as HTMLInputElement).value || `Игрок ${i + 1}`;
                      claim();
                    },
                  }),
                ),
                el(
                  'div',
                  { class: 'row', style: 'gap:4px;margin-top:6px' },
                  button(
                    'сам за себя',
                    () => {
                      teams[i] = null;
                      claim();
                      render();
                    },
                    `btn small${teams[i] === null ? ' primary' : ' ghost'}`,
                  ),
                  ...TEAM_LABELS.map((label, t) =>
                    button(
                      label,
                      () => {
                        teams[i] = t;
                        claim();
                        render();
                      },
                      `btn small${teams[i] === t ? ' primary' : ' ghost'}`,
                    ),
                  ),
                ),
              ),
            ),
          ),

          el('h3', { style: 'margin-top:16px' }, `За столом: ${seats.length}`),
          el(
            'div',
            { class: 'row', style: 'gap:8px' },
            ...(seats.length
              ? seats.map((s) =>
                  el(
                    'span',
                    {
                      class: 'pill',
                      style: s.team !== null ? `border-color:${TEAM_COLORS[s.team]};color:${TEAM_COLORS[s.team]}` : '',
                    },
                    `${s.seat + 1}. ${s.name}${s.team !== null ? ` · союз ${TEAM_LABELS[s.team]}` : ''}${s.owner === net.selfId ? ' · вы' : ''}`,
                  ),
                )
              : [el('span', { class: 'hint' }, 'Пока никого')]),
          ),

          seated
            ? el(
                'div',
                {},
                el('h3', { style: 'margin-top:16px' }, 'Дистанция'),
                el(
                  'div',
                  { class: 'row', style: 'gap:6px' },
                  ...RACE_DISTANCES.map((d) =>
                    button(
                      d === 20 ? '20 · блиц' : d === 50 ? '50 · стандарт' : '100 · полная',
                      () => {
                        chosenDistance = d;
                        sfx.play('ui');
                        render();
                      },
                      `btn small${chosenDistance === d ? ' primary' : ''}`,
                    ),
                  ),
                ),
              )
            : el('p', { class: 'hint', style: 'margin-top:16px' }, 'Займите место, чтобы участвовать: пока вы зритель.'),

          el(
            'p',
            { class: 'hint', style: 'margin-top:10px' },
            'Состав замирает на старте: кто не успел — смотрит. Пока играет один, остальные видят его поле и бросают в него свои карты.',
          ),

          el(
            'div',
            { class: 'row', style: 'margin-top:18px' },
            seated
              ? button(
                  seats.length >= 2 ? 'Начать гонку' : 'Нужно хотя бы двое',
                  () => {
                    if (seats.length >= 2) lobby.start(chosenDistance);
                  },
                  `btn primary${seats.length >= 2 ? '' : ' ghost'}`,
                )
              : el('span', { class: 'hint' }, hostName ? `За столом уже ${seats.length}. Первым сел ${hostName}` : 'Стол пуст'),
            button('Выйти', leave, 'btn ghost'),
          ),
        ),
      );
    };

    // Peers joining and leaving redraw the room; a reconnect also has to take
    // the seats back, since the server dropped them with the old socket.
    let wasOnline = net.status === 'online';
    unsubscribe?.();
    unsubscribe = net.subscribe(() => {
      const nowOnline = net.status === 'online';
      if (nowOnline && !wasOnline) claim();
      wasOnline = nowOnline;
      render();
    });
    render();
  }

  // ---------------------------------------------------------- versus setup --

  function screenVersus(kind: 'split' | 'duel'): void {
    const userLevels = loadUserLevels();
    const pool = [...app.campaignLevels(), ...userLevels];
    let p1: SuperId = app.profile.favouriteSuper;
    let p2: SuperId = app.profile.p2Super;
    let levelIndex = 2;
    let editing: 0 | 1 = 0;

    const render = (): void => {
      const current = editing === 0 ? p1 : p2;
      show(
        el(
          'div',
          { class: 'screen' },
          el('h2', {}, kind === 'duel' ? 'Дуэль 1 на 1' : 'Раздельный экран 1 на 1'),
          el(
            'p',
            { class: 'hint' },
            kind === 'duel'
              ? 'Одно поле на двоих: ракетки сверху и снизу, кирпичи посередине. Пропустил мяч — соперник получает гол. Матч до 5 голов.'
              : 'Два поля рядом. Опыт и усиления работают как в кампании, а каждый суперудар бьёт ещё и по сопернику: мусорные ряды, инверсия управления, разгон мяча или помехи.',
          ),

          el(
            'div',
            { class: 'row', style: 'margin:16px 0 10px' },
            el('span', { class: 'pill' }, 'Игрок 1: A / D · W — огонь · S — супер'),
            el('span', { class: 'pill pink' }, 'Игрок 2: ← / → · ↑ — огонь · ↓ — супер'),
          ),

          el(
            'div',
            { class: 'row', style: 'margin-bottom:10px' },
            button(`Суперудар игрока 1: ${SUPERS[p1].name}`, () => {
              editing = 0;
              render();
            }, `btn small${editing === 0 ? ' primary' : ''}`),
            button(`Суперудар игрока 2: ${SUPERS[p2].name}`, () => {
              editing = 1;
              render();
            }, `btn small${editing === 1 ? ' primary' : ''}`),
          ),
          superPicker(
            current,
            (id) => {
              if (editing === 0) {
                p1 = id;
                app.saveProfile((p) => (p.favouriteSuper = id));
              } else {
                p2 = id;
                app.saveProfile((p) => (p.p2Super = id));
              }
              render();
            },
            false,
          ),

          el(
            'label',
            { class: 'field', style: 'margin-top:18px;max-width:320px' },
            'Уровень',
            el(
              'select',
              {
                onchange: (e: Event) => {
                  levelIndex = Number((e.target as HTMLSelectElement).value);
                },
              },
              ...pool.map((l, i) =>
                el('option', { value: String(i), selected: i === levelIndex }, `${l.name}${l.author ? ` · ${l.author}` : ''}`),
              ),
            ),
          ),

          el(
            'div',
            { class: 'row', style: 'margin-top:22px' },
            button(
              'В бой',
              () => {
                const level = pool[levelIndex] ?? pool[0];
                if (kind === 'duel') {
                  app.setScene((a) =>
                    duelScene(a, {
                      level,
                      supers: [p1, p2],
                      names: ['ИГРОК 1', 'ИГРОК 2'],
                      target: 5,
                      speed: app.profile.gameSpeed,
                    }),
                  );
                } else {
                  const levels = [level, ...pool.filter((l) => l !== level)];
                  app.setScene((a) =>
                    versusScene(a, {
                      levels,
                      supers: [p1, p2],
                      lives: app.profile.lives,
                      names: ['ИГРОК 1', 'ИГРОК 2'],
                      speed: app.profile.gameSpeed,
                    }),
                  );
                }
              },
              'btn primary',
            ),
            button('Назад', screenMain, 'btn ghost'),
          ),
        ),
      );
    };
    render();
  }

  // ------------------------------------------------------------- network --

  /** Room screen: the address to share, who is connected and what they are
   *  playing right now. Offline it explains how to get online instead. */
  function screenNetwork(): void {
    const render = (): void => {
      const online = net.status === 'online';
      const others = net.peers.filter((p) => p.id !== net.selfId);

      show(
        el(
          'div',
          { class: 'screen' },
          el('h2', {}, 'Сеть'),
          el(
            'div',
            { class: 'row', style: 'gap:8px;margin-bottom:12px' },
            el(
              'span',
              { class: `pill ${online ? '' : 'pink'}` },
              online ? 'Подключено' : net.status === 'connecting' ? 'Подключение…' : 'Не подключено',
            ),
            online ? el('span', { class: 'pill' }, `Игроков в комнате: ${net.peers.length}`) : null,
          ),

          online
            ? el(
                'div',
                {},
                el('p', { class: 'hint' }, 'Дайте эту ссылку любому в вашей сети — игра откроется у него в браузере:'),
                el('pre', { class: 'code' }, net.shareUrl),
              )
            : el(
                'div',
                {},
                el(
                  'p',
                  { class: 'hint' },
                  'Игра открыта не с сервера комнат, поэтому сеть недоступна. Доска почёта и статистика работают локально.',
                ),
                el('p', { class: 'hint' }, 'Чтобы играть по локальной сети, на одном из компьютеров выполните:'),
                el('pre', { class: 'code' }, 'npm run build\nnpm run serve'),
                el('p', { class: 'hint' }, 'Сервер напечатает адрес вида http://192.168.х.х:8080 — его и открывают остальные.'),
              ),

          online && others.length
            ? el(
                'div',
                { style: 'margin-top:14px' },
                el('h3', {}, 'Сетевой матч'),
                el(
                  'p',
                  { class: 'hint', style: 'margin-top:0' },
                  'Раздельный экран на две машины: каждый играет своё поле, суперы и саботажные шары летят по сети. Вызов принимает первый, кто нажмёт «Присоединиться».',
                ),
                el(
                  'div',
                  { class: 'row' },
                  button(
                    'Начать матч (я хост)',
                    () => startNetMatch(true, others[0]?.name ?? 'Соперник'),
                    'btn small primary',
                  ),
                  button(
                    'Присоединиться',
                    () => startNetMatch(false, others[0]?.name ?? 'Соперник'),
                    'btn small',
                  ),
                ),
              )
            : null,

          online && others.length
            ? el(
                'div',
                {},
                el('h3', { style: 'margin-top:16px' }, 'Кто сейчас играет'),
                el(
                  'div',
                  { class: 'table-wrap' },
                  el(
                    'table',
                    { class: 'stats' },
                    el('tr', {}, el('th', {}, 'Игрок'), el('th', {}, 'Режим'), el('th', {}, 'Уровень'), el('th', {}, 'Счёт'), el('th', {}, 'Жизни')),
                    ...others.map((p) =>
                      el(
                        'tr',
                        {},
                        el('td', {}, p.name),
                        el('td', {}, p.progress?.mode ?? '—'),
                        el('td', {}, p.progress ? String(p.progress.level) : '—'),
                        el('td', {}, p.progress ? String(p.progress.score) : '—'),
                        el('td', {}, p.progress ? String(p.progress.lives) : '—'),
                      ),
                    ),
                  ),
                ),
              )
            : online
              ? el('p', { class: 'hint', style: 'margin-top:14px' }, 'Пока вы один в комнате. Поделитесь ссылкой выше.')
              : null,

          el(
            'div',
            { class: 'row', style: 'margin-top:20px' },
            button('Назад', () => {
              unsubscribe?.();
              unsubscribe = null;
              screenMain();
            }, 'btn primary'),
            !online ? button('Повторить подключение', () => net.connect(app.profile.name), 'btn small') : null,
          ),
        ),
      );
    };

    // Live: peers appearing and their progress redraw this screen.
    unsubscribe?.();
    unsubscribe = net.subscribe(render);
    render();
  }

  /** Both machines enter the same scene; the host settles the seed. */
  function startNetMatch(host: boolean, opponentName: string): void {
    unsubscribe?.();
    unsubscribe = null;
    app.setScene((a) =>
      netVersusScene(a, {
        levels: a.campaignLevels(),
        superId: a.profile.favouriteSuper,
        lives: a.profile.lives,
        host,
        opponentName,
      }),
    );
  }

  // --------------------------------------------------------------- story --

  /** The chronicle: every story beat the player has actually reached. Locked
   *  ones are listed but not spoiled. */
  function screenStory(): void {
    const seen = new Set(app.profile.storySeen);
    const groups: [string, StoryEntry['kind']][] = [
      ['Пролог', 'prologue'],
      ['Секторы', 'route'],
      ['Смотрители', 'boss'],
      ['Финал', 'finale'],
    ];

    show(
      el(
        'div',
        { class: 'screen' },
        el('h2', {}, 'Хроника'),
        el(
          'p',
          { class: 'hint' },
          `Записи открываются по ходу кампании: ${seen.size} из ${ALL_ENTRIES.length}.`,
        ),
        ...groups.flatMap(([title, kind]) => {
          const entries = ALL_ENTRIES.filter((e) => e.kind === kind);
          if (!entries.length) return [];
          return [
            el('h3', { style: 'margin-top:16px' }, title),
            el(
              'div',
              { class: 'col', style: 'gap:10px' },
              ...entries.map((entry) =>
                seen.has(entry.id)
                  ? el(
                      'div',
                      { class: 'card', style: 'cursor:default' },
                      el('div', { class: 'title' }, entry.title),
                      ...entry.text.split('\n\n').map((para) => el('p', { class: 'story' }, para)),
                    )
                  : el(
                      'div',
                      { class: 'card locked', style: 'cursor:default' },
                      el('div', { class: 'title' }, '???'),
                      el('div', { class: 'desc' }, 'Ещё не открыто'),
                    ),
              ),
            ),
          ];
        }),
        el('div', { class: 'row', style: 'margin-top:20px' }, button('Назад', screenMain, 'btn primary')),
      ),
    );
  }

  // ------------------------------------------------------------ statistics --

  function screenStats(): void {
    const p = app.profile;
    const sum = summarise(p.levelStats);
    const levels = app.campaignLevels();

    const rows = Object.entries(p.levelStats)
      .map(([key, stat]) => ({ index: Number(key), stat }))
      .filter((r) => r.stat.clears > 0 || r.stat.deaths > 0)
      .sort((a, b) => a.index - b.index);

    show(
      el(
        'div',
        { class: 'screen' },
        el('h2', {}, `Статистика · ${p.name}`),
        el(
          'div',
          { class: 'row', style: 'gap:8px;margin-bottom:14px' },
          el('span', { class: 'pill' }, `Пройдено уровней: ${sum.levelsCleared}`),
          el('span', { class: 'pill' }, `Зачисток: ${sum.totalClears}`),
          el('span', { class: 'pill pink' }, `Поражений: ${sum.totalDeaths}`),
          el('span', { class: 'pill amber' }, `Опыт за уровни: ${sum.totalXp}`),
          sum.fastest
            ? el('span', { class: 'pill' }, `Быстрейший: ур. ${sum.fastest.level} за ${formatTime(sum.fastest.time)}`)
            : null,
        ),

        rows.length
          ? el(
              'div',
              { class: 'table-wrap' },
              el(
                'table',
                { class: 'stats' },
                el(
                  'tr',
                  {},
                  el('th', {}, '#'),
                  el('th', {}, 'Уровень'),
                  el('th', {}, 'Лучшее время'),
                  el('th', {}, 'Лучший счёт'),
                  el('th', {}, 'Опыт'),
                  el('th', {}, 'Пройден'),
                  el('th', {}, 'Смертей'),
                ),
                ...rows.map((r) =>
                  el(
                    'tr',
                    {},
                    el('td', {}, String(r.index + 1)),
                    el('td', {}, levels[r.index]?.name ?? '—'),
                    el('td', {}, formatTime(r.stat.bestTime)),
                    el('td', {}, String(r.stat.bestScore)),
                    el('td', {}, String(r.stat.xp)),
                    el('td', {}, String(r.stat.clears)),
                    el('td', {}, String(r.stat.deaths)),
                  ),
                ),
              ),
            )
          : el('p', { class: 'hint' }, 'Пока нет данных — пройдите уровень кампании.'),

        el('h3', { style: 'margin-top:20px' }, 'Все игроки'),
        el(
          'div',
          { class: 'table-wrap' },
          el(
            'table',
            { class: 'stats' },
            el(
              'tr',
              {},
              el('th', {}, 'Игрок'),
              el('th', {}, 'Уровень'),
              el('th', {}, 'Общий опыт'),
              el('th', {}, 'Опыт за уровни'),
              el('th', {}, 'Рекорд'),
              el('th', {}, 'Кампания'),
              el('th', {}, 'Витки'),
            ),
            ...app.store.players.map((pl) => {
              const s = summarise(pl.levelStats);
              return el(
                'tr',
                { class: pl.id === app.store.activeId ? 'me' : '' },
                el('td', {}, `${pl.admin ? '★ ' : ''}${pl.name}`),
                el('td', {}, String(accountLevel(pl).level)),
                el('td', {}, String(Math.round(pl.totalXp))),
                el('td', {}, String(s.totalXp)),
                el('td', {}, String(pl.bestScore)),
                el('td', {}, `${pl.campaignReached}/${CAMPAIGN_SIZE}`),
                el('td', {}, String(pl.ngPlus)),
              );
            }),
          ),
        ),

        el('div', { class: 'row', style: 'margin-top:20px' }, button('Назад', screenMain, 'btn primary')),
      ),
    );
  }

  // ---------------------------------------------------------- hall of fame --

  function screenHall(): void {
    const render = (entries: ReturnType<typeof hall.list>): void => {
      show(
        el(
          'div',
          { class: 'screen' },
          el('h2', {}, 'Доска почёта'),
          el(
            'p',
            { class: 'hint' },
            'Таблица общая для всех запущенных копий игры на этом компьютере: результат из соседнего окна появляется здесь сразу, без перезагрузки.',
          ),
          entries.length
            ? el(
                'div',
                { class: 'table-wrap' },
                el(
                  'table',
                  { class: 'stats' },
                  el(
                    'tr',
                    {},
                    el('th', {}, '#'),
                    el('th', {}, 'Игрок'),
                    el('th', {}, 'Счёт'),
                    el('th', {}, 'Уровень'),
                    el('th', {}, 'Опыт'),
                    el('th', {}, 'Режим'),
                    el('th', {}, 'Окно'),
                  ),
                  ...entries.map((e, i) =>
                    el(
                      'tr',
                      { class: e.source === hall.sourceId ? 'me' : '' },
                      el('td', {}, String(i + 1)),
                      el('td', {}, e.player),
                      el('td', {}, String(e.score)),
                      el('td', {}, String(e.level)),
                      el('td', {}, String(e.xp)),
                      el('td', {}, e.mode),
                      el('td', {}, e.source === hall.sourceId ? 'это окно' : 'другое'),
                    ),
                  ),
                ),
              )
            : el('p', { class: 'hint' }, 'Пока пусто. Пройдите уровень — результат попадёт сюда.'),
          el(
            'div',
            { class: 'row', style: 'margin-top:20px' },
            button('Назад', () => {
              unsubscribe?.();
              unsubscribe = null;
              screenMain();
            }, 'btn primary'),
            app.profile.admin ? button('Очистить', () => hall.clear(), 'btn small danger') : null,
          ),
        ),
      );
    };

    // Live updates: another window submitting a score redraws this table.
    unsubscribe?.();
    unsubscribe = hall.subscribe(render);
    render(hall.list());
  }

  // ----------------------------------------------------------------- audio --

  function screenAudio(): void {
    const render = (): void => {
      const p = app.profile;
      const track = music.nowPlaying;

      show(
        el(
          'div',
          { class: 'screen narrow' },
          el('h2', {}, 'Звук и музыка'),
          el(
            'p',
            { class: 'hint' },
            'Звуковые эффекты синтезируются на лету — файлов нет, задержки тоже. Музыка подключается своими треками.',
          ),

          el(
            'label',
            { class: 'field', style: 'margin-top:14px' },
            `Эффекты: ${Math.round(p.sfxVolume * 100)}%`,
            el('input', {
              type: 'range',
              min: '0',
              max: '100',
              value: String(Math.round(p.sfxVolume * 100)),
              oninput: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value) / 100;
                app.saveProfile((prof) => (prof.sfxVolume = v));
                sfx.setVolume(v);
              },
              onchange: () => {
                sfx.play('powerup');
                render();
              },
            }),
          ),

          el(
            'label',
            { class: 'field' },
            `Музыка: ${Math.round(p.musicVolume * 100)}%`,
            el('input', {
              type: 'range',
              min: '0',
              max: '100',
              value: String(Math.round(p.musicVolume * 100)),
              oninput: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value) / 100;
                app.saveProfile((prof) => (prof.musicVolume = v));
                music.setVolume(v);
              },
              onchange: render,
            }),
          ),

          el(
            'div',
            { class: 'row', style: 'margin-top:10px' },
            button(
              p.musicOn ? 'Музыка включена' : 'Музыка выключена',
              () => {
                const on = !app.profile.musicOn;
                app.saveProfile((prof) => (prof.musicOn = on));
                music.setEnabled(on);
                render();
              },
              `btn small${p.musicOn ? ' primary' : ''}`,
            ),
            music.available ? button('Следующий трек', () => { music.next(); setTimeout(render, 300); }, 'btn small') : null,
          ),

          el(
            'p',
            { class: 'hint', style: 'margin-top:14px' },
            music.available
              ? `Сейчас играет: ${track?.title ?? track?.file ?? '—'}`
              : 'Треков нет. Положите файлы в public/music и опишите их в public/music/manifest.json — инструкция лежит там же в README.md.',
          ),
          el(
            'pre',
            {
              class: 'code',
            },
            '{\n  "tracks": [\n    { "file": "menu.mp3", "title": "Standby", "scene": "menu" },\n    { "file": "drive.mp3", "title": "Neon Drive", "scene": "game" },\n    { "file": "duel.mp3", "title": "Duel", "scene": "versus" }\n  ]\n}',
          ),

          el('div', { class: 'row', style: 'margin-top:18px' }, button('Назад', screenMain, 'btn primary')),
        ),
      );
    };
    render();
  }

  // ---------------------------------------------------------------- editor --

  function screenEditor(): void {
    app.setScene((a) => editorScene(a));
  }

  // ------------------------------------------------------------------ help --

  function screenHelp(): void {
    show(
      el(
        'div',
        { class: 'screen' },
        el('h2', {}, 'Управление и правила'),
        el(
          'div',
          { class: 'grid c2' },
          el(
            'div',
            {},
            el('h3', {}, 'Одиночная игра'),
            el(
              'table',
              { class: 'keys' },
              row('Мышь / A · D / ← · →', 'движение ракетки'),
              row('Пробел / W', 'запуск мяча, выстрел лазером'),
              row('Shift / E', 'суперудар (когда шкала заполнена)'),
              row('1 · 2 · 3', 'выбор усиления при новом уровне'),
              row('Esc', 'пауза'),
            ),
            el('h3', { style: 'margin-top:16px' }, 'PvP'),
            el(
              'table',
              { class: 'keys' },
              row('Игрок 1', 'A · D — движение, W — огонь, S — супер, 1/2/3 — усиления'),
              row('Игрок 2', '← · → — движение, ↑ — огонь, ↓ — супер, 8/9/0 — усиления'),
            ),
          ),
          el(
            'div',
            {},
            el('h3', {}, 'Как работает опыт'),
            el(
              'p',
              { class: 'hint' },
              'Каждый разбитый кирпич даёт опыт. Серия попаданий без потери мяча повышает множитель — до x12 и выше с усилением «Серия». Новый уровень мастерства внутри забега открывает выбор из трёх усилений: ширина ракетки, критический урон, магнит для бонусов, штатный лазер и так далее. Весь опыт забега после его конца зачисляется в профиль и открывает новые суперудары.',
            ),
            el('h3', { style: 'margin-top:14px' }, 'Суперудары'),
            el(
              'p',
              { class: 'hint' },
              'Шкала супера копится от урона и подобранных бонусов. В PvP каждый суперудар одновременно бьёт по сопернику — это главный инструмент давления.',
            ),
            el('h3', { style: 'margin-top:14px' }, 'Элементальные шары'),
            el(
              'div',
              { class: 'col', style: 'gap:4px' },
              ...BALL_TYPE_LIST.filter((b) => b.id !== 'normal').map((b) =>
                el(
                  'p',
                  { class: 'hint', style: 'margin:0' },
                  el('b', { style: `color:${b.color}` }, `${b.name}: `),
                  b.desc,
                ),
              ),
            ),
          ),
        ),
        el('div', { class: 'row', style: 'margin-top:22px' }, button('Назад', screenMain, 'btn primary')),
      ),
    );
  }

  const row = (k: string, v: string): HTMLElement => el('tr', {}, el('td', {}, k), el('td', {}, v));

  music.setScene('menu');
  screenMain();

  return {
    update(dt) {
      backdrop.update(dt);
    },
    draw(ctx, w, h) {
      backdrop.draw(ctx, w, h);
    },
    dispose() {
      // Whatever screen we were on stops talking to the network with us.
      closeRaceLobby();
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
