import { Rng } from './rng';

/** One-off, real-world flavor awards read out once the whole party is over —
 *  not per round (that would repeat constantly and go stale fast), just once
 *  at the very end, based on final standings. Pure content + a deterministic
 *  pick, same discipline as everything else in `core/`: every screen derives
 *  the identical result from the same match seed, no extra wire message
 *  needed. `{target}` in a `RUNNER_UP_AWARDS` entry is replaced with the
 *  second-to-last racer's name by whoever renders it. */

export const CHAMPION_AWARDS: string[] = [
  'Единолично выбирает музыку на следующие 15 минут',
  'Получает право один раз за вечер отменить любой чужой дебафф без объяснений',
  'Первым выбирает себе самое удобное место',
  'Официально объявляется «мозгом вечера» — остальные хотя бы раз обязаны обратиться «ваше мозгейшество»',
  'Может назначить следующую встречу бонусной — сам решает, во сколько',
  'Получает шуточную корону (соорудить из подручных материалов) до конца вечера',
  'Придумывает вопрос-разминку для всех в следующий раз',
  'Разрешается один раз пропустить свой ход без потери очков',
  'Ведёт награждение, если будет следующий вечер',
  'Может дать одному игроку подсказку в следующем раунде',
  'Все чокаются с чемпионом — чем найдётся',
  'Получает почётную грамоту «за вклад в общее веселье» (нарисовать на салфетке)',
  'Может забрать себе лучшее место в комнате',
  'Объявляется хозяином вечера — ему подают чай/кофе первому',
  'Получает право один раз назвать любой спорный ответ правильным просто так',
];

/** `{target}` = the racer ranked second-to-last. */
export const RUNNER_UP_AWARDS: string[] = [
  'Забирает у {target} ручку до конца вечера',
  'Меняется местами с {target}',
  'Даёт {target} шутливое прозвище до конца вечера',
  'Может один раз сказать «мимо» на любой ответ {target}, даже правильный',
  '{target} обязан называть 2-е место «шеф» до конца вечера',
  'Меняется на один раунд аксессуаром с {target} (шапка, очки — что найдётся)',
  'Выбирает следующую песню вместо {target}',
  '{target} приносит 2-му месту чай или воду',
  'Забирает у {target} самую вкусную конфету из тарелки',
  'Даёт {target} одно несерьёзное «домашнее задание» на следующий раунд',
  '{target} обязан один раз искренне похвалить 2-е место вслух',
  'Получает голос {target} в следующем спорном вопросе',
  '{target} должен изобразить чемпиона в шуточном интервью',
  'Занимает место {target} в очереди на следующий раунд',
  'Может забрать у {target} один банкованный бустер просто так',
];

export const LAST_PLACE_AWARDS: string[] = [
  'Покупает всем что-нибудь по мелочи из автомата',
  'Читает вслух следующий вопрос голосом диктора новостей',
  'Один раунд отвечает только жестами',
  'Произносит тост в честь чемпиона',
  'Придумывает вечеринке название на память',
  'Исполняет победный танец, будто это он выиграл',
  'Раздаёт всем шутливые титулы по итогам вечера',
  'Один раз за вечер обязан отвечать только вопросом на вопрос',
  'Экспромтом произносит хвалебную речь чемпиону',
  'Собирает стаканы/мусор после игры',
  'Придумывает себе штраф на следующую игру',
  'Разносит чай или воду всем остальным',
  'Обязан улыбаться на каждой сегодняшней фотографии',
  'Получает шуточное звание «дух вечера»',
  'Ведёт хронику вечера — записывает самые смешные моменты',
];

export interface MatchAwards {
  championId: string;
  championText: string;
  lastId: string;
  lastText: string;
  /** Only set once there are at least 4 racers — with fewer, "2nd place" and
   *  "second-to-last" would be the same person. */
  runnerUp?: { runnerUpId: string; targetId: string; text: string };
}

/** `rankedIds` — every racer's id, best score first. Deterministic: the same
 *  seed and the same final ranking always draws the same set of lines,
 *  everywhere — nobody (host included) picks these by hand, they just fall
 *  out of the match's own seed once it's over. */
export function pickMatchAwards(seed: number, rankedIds: string[]): MatchAwards | null {
  if (rankedIds.length < 2) return null;
  const rng = new Rng((seed ^ 0x41776430) >>> 0);
  const championId = rankedIds[0];
  const lastId = rankedIds[rankedIds.length - 1];
  const championText = rng.pick(CHAMPION_AWARDS);
  const lastText = rng.pick(LAST_PLACE_AWARDS);
  const runnerUp =
    rankedIds.length >= 4
      ? { runnerUpId: rankedIds[1], targetId: rankedIds[rankedIds.length - 2], text: rng.pick(RUNNER_UP_AWARDS) }
      : undefined;
  return { championId, championText, lastId, lastText, runnerUp };
}
