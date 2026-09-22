import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Loads, validates and atomically saves the team-quiz's "Своя игра" content
 *  — same discipline as `quizz/lib/cards.js`: one JSON file, one full-replace
 *  write, validated before anything touches disk. The rules here mirror
 *  `src/core/jeopardy.ts`'s `validateJeopardyData` — duplicated because this
 *  server runs plain Node with no TypeScript build; keep the two in step. */

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// Mirrors `core/race.ts`'s `CardId` union — only the ids, so a `boost` card's
// reference can be checked without pulling the whole TS buff/debuff catalog
// (icons, effects, weights) into this plain-Node file.
const CARD_IDS = new Set([
  'time10', 'time15', 'multiball', 'life', 'lavaball', 'anchor', 'tailwind',
  'burn10', 'burn15', 'frost', 'mirror', 'blind', 'steel', 'jam', 'weight',
  'megaLife', 'timeFreeze', 'setback',
  'giftPlasma', 'giftLives', 'giftShield', 'giftTime', 'giftPierce', 'giftBreaker',
]);

export class JeopardyValidationError extends Error {}

export function validateJeopardyData(data) {
  if (!data || typeof data !== 'object') throw new JeopardyValidationError('Пустые данные.');
  if (!Array.isArray(data.categories)) throw new JeopardyValidationError('"categories" должен быть массивом.');
  if (!Array.isArray(data.cards)) throw new JeopardyValidationError('"cards" должен быть массивом.');

  const catIds = new Set();
  for (const c of data.categories) {
    if (!c || !isNonEmptyString(c.id)) throw new JeopardyValidationError('У категории нет id.');
    if (catIds.has(c.id)) throw new JeopardyValidationError(`Повторяющийся id категории: ${c.id}`);
    catIds.add(c.id);
    if (!isNonEmptyString(c.label)) throw new JeopardyValidationError(`Категория ${c.id}: нет названия.`);
  }

  const cardIds = new Set();
  for (const c of data.cards) {
    if (!c || !isNonEmptyString(c.id)) throw new JeopardyValidationError('У карточки нет id.');
    if (cardIds.has(c.id)) throw new JeopardyValidationError(`Повторяющийся id карточки: ${c.id}`);
    cardIds.add(c.id);
    if (!catIds.has(c.categoryId)) throw new JeopardyValidationError(`Карточка ${c.id}: неизвестная категория "${c.categoryId}".`);
    if (!isNonEmptyString(c.title)) throw new JeopardyValidationError(`Карточка ${c.id}: нет заголовка.`);
    if (!isNonEmptyString(c.prompt)) throw new JeopardyValidationError(`Карточка ${c.id}: нет текста задания.`);
    if (typeof c.value !== 'number' || !(c.value > 0)) {
      throw new JeopardyValidationError(`Карточка ${c.id}: номинал должен быть положительным числом.`);
    }
    if (c.type !== 'judged' && c.type !== 'ranked' && c.type !== 'choice' && c.type !== 'boost') {
      throw new JeopardyValidationError(`Карточка ${c.id}: неизвестный тип "${c.type}".`);
    }
    if (c.type === 'ranked') {
      if (!Array.isArray(c.ranked) || c.ranked.length === 0) {
        throw new JeopardyValidationError(`Карточка ${c.id}: для типа «сто к одному» нужен список ответов.`);
      }
      for (const r of c.ranked) {
        if (!r || !isNonEmptyString(r.text)) throw new JeopardyValidationError(`Карточка ${c.id}: у варианта ответа нет текста.`);
        if (typeof r.points !== 'number' || !(r.points > 0)) {
          throw new JeopardyValidationError(`Карточка ${c.id}: у варианта ответа должны быть положительные очки.`);
        }
      }
    }
    if (c.type === 'choice') {
      if (!Array.isArray(c.choices) || c.choices.length < 2) {
        throw new JeopardyValidationError(`Карточка ${c.id}: для карточки с вариантами нужно минимум 2 варианта ответа.`);
      }
      const optionIds = new Set();
      for (const o of c.choices) {
        if (!o || !isNonEmptyString(o.id) || !isNonEmptyString(o.text)) {
          throw new JeopardyValidationError(`Карточка ${c.id}: у варианта ответа нет текста.`);
        }
        if (optionIds.has(o.id)) throw new JeopardyValidationError(`Карточка ${c.id}: повторяющийся id варианта ответа.`);
        optionIds.add(o.id);
      }
      if (c.correctChoiceIds !== undefined) {
        if (!Array.isArray(c.correctChoiceIds) || c.correctChoiceIds.length === 0) {
          throw new JeopardyValidationError(`Карточка ${c.id}: "correctChoiceIds" не может быть пустым списком.`);
        }
        for (const id of c.correctChoiceIds) {
          if (!optionIds.has(id)) {
            throw new JeopardyValidationError(`Карточка ${c.id}: правильный вариант ссылается на несуществующий id.`);
          }
        }
      }
    }
    if (c.type === 'boost') {
      if (!isNonEmptyString(c.boostCardId) || !CARD_IDS.has(c.boostCardId)) {
        throw new JeopardyValidationError(`Карточка ${c.id}: "boostCardId" не ссылается на известную карточку колоды.`);
      }
    }
    if (c.archived !== undefined && typeof c.archived !== 'boolean') {
      throw new JeopardyValidationError(`Карточка ${c.id}: "archived" должен быть true/false.`);
    }
    if (c.note !== undefined && typeof c.note !== 'string') {
      throw new JeopardyValidationError(`Карточка ${c.id}: "note" должен быть строкой.`);
    }
  }
  return data;
}

export function createJeopardyStore(dataDir) {
  const file = join(dataDir, 'jeopardy.json');

  async function load() {
    try {
      const raw = await readFile(file, 'utf8');
      return validateJeopardyData(JSON.parse(raw));
    } catch (err) {
      if (err.code === 'ENOENT') return { categories: [], cards: [] };
      throw err;
    }
  }

  async function save(data) {
    validateJeopardyData(data);
    await mkdir(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, file);
  }

  return { load, save, exists: () => existsSync(file) };
}
