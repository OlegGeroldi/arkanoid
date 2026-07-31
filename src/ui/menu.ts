import { App, type Scene } from '../app';
import { BUILTIN_LEVELS } from '../core/builtinLevels';
import type { LevelData } from '../core/level';
import { accountLevel, isSuperUnlocked, loadUserLevels } from '../core/storage';
import { SUPER_LIST, SUPERS, type SuperId } from '../core/supers';
import { Backdrop } from '../render/backdrop';
import { soloScene } from '../game/campaign';
import { versusScene } from '../game/versus';
import { duelScene } from '../game/duel';
import { editorScene } from '../editor/editor';
import { button, el } from './dom';

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
            el('p', { class: 'hint' }, `Своих уровней: ${userLevels.length}`),
          ),
        ),

        el(
          'div',
          { class: 'grid c3' },
          modeCard('🎯', 'Кампания', '10 уровней, опыт, усиления и суперудары', () => screenSolo(BUILTIN_LEVELS, 'Кампания')),
          modeCard(
            '🧱',
            'Свои уровни',
            userLevels.length ? `${userLevels.length} уровней в вашей библиотеке` : 'Пока пусто — создайте в редакторе',
            () => (userLevels.length ? screenSolo(userLevels, 'Свои уровни') : screenEditor()),
          ),
          modeCard('⚔️', 'Дуэль 1 на 1', 'Общее поле, две ракетки, счёт до 5 голов', () => screenVersus('duel')),
          modeCard('🪟', 'Раздельный экран', 'Два поля рядом, атаки мусорными кирпичами', () => screenVersus('split')),
          modeCard('🛠', 'Редактор уровней', 'Рисуйте поля, тестируйте, экспортируйте', () => screenEditor()),
          modeCard('⌨️', 'Управление и правила', 'Клавиши, бонусы, типы кирпичей', () => screenHelp()),
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

  // ------------------------------------------------------------ solo setup --

  function screenSolo(levels: LevelData[], title: string): void {
    let chosen: SuperId = app.profile.favouriteSuper;
    if (!isSuperUnlocked(app.profile, chosen)) chosen = 'barrage';

    const render = (): void => {
      show(
        el(
          'div',
          { class: 'screen' },
          el('h2', {}, title),
          el('p', { class: 'hint' }, `${levels.length} уровней. Опыт копится внутри забега — каждый новый уровень мастерства даёт выбор из трёх усилений.`),
          el('h3', { style: 'margin-top:18px' }, 'Суперудар'),
          superPicker(chosen, (id) => {
            chosen = id;
            app.saveProfile((p) => (p.favouriteSuper = id));
            render();
          }),
          el(
            'div',
            { class: 'row', style: 'margin-top:22px' },
            button('Начать', () => app.setScene((a) => soloScene(a, { levels, superId: chosen, title })), 'btn primary'),
            button('Назад', screenMain, 'btn ghost'),
          ),
        ),
      );
    };
    render();
  }

  // ---------------------------------------------------------- versus setup --

  function screenVersus(kind: 'split' | 'duel'): void {
    const userLevels = loadUserLevels();
    const pool = [...BUILTIN_LEVELS, ...userLevels];
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
          ),
        ),
        el('div', { class: 'row', style: 'margin-top:22px' }, button('Назад', screenMain, 'btn primary')),
      ),
    );
  }

  const row = (k: string, v: string): HTMLElement => el('tr', {}, el('td', {}, k), el('td', {}, v));

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
