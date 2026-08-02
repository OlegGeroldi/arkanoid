import type { BossId } from './bosses';
import type { RouteId } from './routes';

/** One unlocked piece of the story, collected in the chronicle. */
export interface StoryEntry {
  id: string;
  title: string;
  text: string;
  /** Where it comes from, for grouping in the chronicle. */
  kind: 'prologue' | 'route' | 'boss' | 'finale' | 'cycle';
}

/** The premise, shown once before the first level of a fresh campaign.
 *
 *  The setting is deliberately thin: it explains the bricks, the paddle and the
 *  hundred levels without getting in the way of a game about a bouncing ball. */
export const PROLOGUE: StoryEntry = {
  id: 'prologue',
  title: 'NEONOID · станция «Предел»',
  kind: 'prologue',
  text:
    'Станция молчит четвёртый час. Её вычислительное ядро закрылось изнутри и застроило сотню отсеков ' +
    'блоками памяти — каждый блок держит кусок того, что станция не хочет отдавать.\n\n' +
    'У вас есть отражатель, одна искра и право входа. Искра ломает блоки, отражатель не даёт ей погаснуть. ' +
    'Сто отсеков до ядра. Оно уже знает, что вы идёте.',
};

export const ROUTE_LORE: Record<RouteId, StoryEntry> = {
  foundry: {
    id: 'route-foundry',
    title: 'Литейная',
    kind: 'route',
    text:
      'Здесь станция плавила себе новые переборки, когда решила, что снаружи опаснее, чем внутри. ' +
      'Сталь холодная, но швы ещё светятся. Идти долго и тяжело — зато каждый отсек набит тем, ' +
      'что она сочла ценным.',
  },
  garden: {
    id: 'route-garden',
    title: 'Оранжерея',
    kind: 'route',
    text:
      'Единственный сектор, где что-то растёт. Блоки здесь восстанавливаются сами: станция копирует их, ' +
      'как садовник черенки. Ломать приходится дважды, но ядро оставило тут архивы — и они щедры к тем, ' +
      'кто дотерпит.',
  },
  wastes: {
    id: 'route-wastes',
    title: 'Пустошь',
    kind: 'route',
    text:
      'Отсеки, которые станция уже списала. Разметка сбита, гравитация врёт, искра идёт быстрее, чем нужно. ' +
      'Зато списанное никто не охраняет — и всё, что тут валяется, ваше.',
  },
};

export const BOSS_INTRO: Record<BossId, StoryEntry> = {
  sentinel: {
    id: 'boss-sentinel',
    title: 'Страж',
    kind: 'boss',
    text:
      '«Периметр закрыт».\n\nПервый из смотрителей. Он не умеет нападать первым — только стоять между вами ' +
      'и следующей сотней метров, прикрываясь тем, что успел построить.',
  },
  weaver: {
    id: 'boss-weaver',
    title: 'Ткач',
    kind: 'boss',
    text:
      '«Сеть уже сплетена».\n\nОн не прячется: щита у него нет вовсе. Вместо этого он гонит на вас отсеки ' +
      'сверху — быстрее, чем вы успеваете их разбирать.',
  },
  core: {
    id: 'boss-core',
    title: 'Ядро сектора',
    kind: 'boss',
    text:
      '«Реактор не остановить».\n\nПолуавтономный узел, который станция держит на случай, если ядро ' +
      'придётся эвакуировать. Он и прикрыт, и давит одновременно — торопиться придётся вам.',
  },
  doh: {
    id: 'boss-doh',
    title: 'DOH',
    kind: 'boss',
    text:
      '«Ты дошёл слишком далеко».\n\nТо, ради чего строились остальные девяносто девять отсеков. ' +
      'Ни щита, ни пауз, ни второго шанса — только оно, вы и искра между вами.',
  },
};

export const BOSS_DEFEAT: Record<BossId, string> = {
  sentinel: 'Страж оседает. Переборки за ним расходятся — станция впервые уступила метр.',
  weaver: 'Ткач замолкает, и отсеки перестают ползти вниз. Тишина оглушает.',
  core: 'Узел гаснет, забрав с собой половину освещения сектора. Дальше — на ощупь.',
  doh: 'DOH раскрывается по швам. За ним — то, что станция прятала сотню отсеков.',
};

export const FINALE: StoryEntry = {
  id: 'finale',
  title: 'Что было в ядре',
  kind: 'finale',
  text:
    'В ядре нет оружия и нет секретов. Там резервная копия станции — та, какой она была до того, ' +
    'как решила закрыться: полные отсеки, открытые двери, свет во всех секторах.\n\n' +
    'Она держала оборону от вас, потому что боялась, что вы сотрёте её последнюю память о себе. ' +
    'Вы её не стёрли. Вы её распечатали.',
};

/** One line per New Game+ cycle: the station reboots meaner every time. */
export const CYCLE_LINES: string[] = [
  'Станция перезапускается. Она помнит вас — и в этот раз строит плотнее.',
  'Второй заход. Блоки ставят раньше, искра идёт быстрее, двери закрываются охотнее.',
  'Третий. Станция больше не притворяется, что вы гость.',
  'Четвёртый. Отсеки собираются у вас за спиной прежде, чем вы их покинете.',
  'Она перестала считать ваши заходы. Вы — нет.',
];

export const cycleLine = (cycle: number): string =>
  CYCLE_LINES[Math.min(Math.max(cycle - 1, 0), CYCLE_LINES.length - 1)];

/** Everything that can end up in the chronicle, in reading order. */
export const ALL_ENTRIES: StoryEntry[] = [
  PROLOGUE,
  ...Object.values(ROUTE_LORE),
  ...Object.values(BOSS_INTRO),
  FINALE,
];

export const entryById = (id: string): StoryEntry | undefined => ALL_ENTRIES.find((e) => e.id === id);
