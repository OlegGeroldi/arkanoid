import { App, type Scene } from '../app';
import { CAMPAIGN_LEVELS, CAMPAIGN_SIZE, CHAOS_FROM, levelTier } from '../core/campaignLevels';
import type { LevelData } from '../core/level';
import { accountLevel, isSuperUnlocked, loadUserLevels } from '../core/storage';
import { SUPER_LIST, SUPERS, type SuperId } from '../core/supers';
import { Backdrop } from '../render/backdrop';
import { soloScene } from '../game/campaign';
import { versusScene } from '../game/versus';
import { duelScene } from '../game/duel';
import { editorScene } from '../editor/editor';
import { button, el } from './dom';
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { BALL_TYPE_LIST } from '../core/balls';

/** The menu is a canvas backdrop plus a DOM overlay; every screen swaps the
 *  overlay contents and leaves the animation running underneath. */
export function mainMenu(app: App): Scene {
  const backdrop = new Backdrop();

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
          modeCard('🎯', 'Кампания', `${CAMPAIGN_SIZE} уровней: с ${CHAOS_FROM}-го — хаос и хардкор`, () =>
            screenSolo(CAMPAIGN_LEVELS, 'Кампания', { campaign: true }),
          ),
          modeCard('🗺', 'Выбор уровня', `Начать с любого из ${CAMPAIGN_SIZE} уровней кампании`, () => screenLevelSelect()),
          modeCard(
            '🧱',
            'Свои уровни',
            userLevels.length ? `${userLevels.length} уровней в вашей библиотеке` : 'Пока пусто — создайте в редакторе',
            () => (userLevels.length ? screenSolo(userLevels, 'Свои уровни') : screenEditor()),
          ),
          modeCard('⚔️', 'Дуэль 1 на 1', 'Общее поле, две ракетки, счёт до 5 голов', () => screenVersus('duel')),
          modeCard('🪟', 'Раздельный экран', 'Два поля рядом, атаки мусорными кирпичами', () => screenVersus('split')),
          modeCard('🛠', 'Редактор уровней', 'Рисуйте поля, тестируйте, экспортируйте', () => screenEditor()),
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

  // ----------------------------------------------------------- level select --

  function screenLevelSelect(): void {
    const reached = app.profile.campaignReached;
    const grid = el('div', { class: 'level-grid' });

    CAMPAIGN_LEVELS.forEach((level, i) => {
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
              screenSolo(CAMPAIGN_LEVELS, `Кампания · ${i + 1}`, { campaign: true, startIndex: i });
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

  // ---------------------------------------------------------- versus setup --

  function screenVersus(kind: 'split' | 'duel'): void {
    const userLevels = loadUserLevels();
    const pool = [...CAMPAIGN_LEVELS, ...userLevels];
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
                    duelScene(a, { level, supers: [p1, p2], names: ['ИГРОК 1', 'ИГРОК 2'], target: 5 }),
                  );
                } else {
                  const levels = [level, ...pool.filter((l) => l !== level)];
                  app.setScene((a) =>
                    versusScene(a, { levels, supers: [p1, p2], lives: 3, names: ['ИГРОК 1', 'ИГРОК 2'] }),
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
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
