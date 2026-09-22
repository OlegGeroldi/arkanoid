import { CARDS, type CardId } from './race';

/** The team quiz board: a grid of categories × point values, "Своя игра"
 *  style. There is deliberately no automatic right/wrong scoring — the seed
 *  content (ported from the 42-themed party quiz) is mostly personal/
 *  subjective ("read your harshest feedback out loud", "whoever has the
 *  higher Intra level wins this one"), so the host judges every card by hand,
 *  same philosophy as the original quiz's manual `adjustScore`. Points a card
 *  pays out become the winning team's shop credits.
 *
 *  Two card types are different. `ranked` ("сто к одному") holds a pre-agreed
 *  list of accepted answers with per-rank points; the host still decides which
 *  answers were said, but the points for a match are read off the card rather
 *  than picked freehand. `choice` gives the team a fixed set of options to
 *  pick from on their own screen instead of typing a free-text answer — one or
 *  several; the pick travels through the same free-text answer pipe
 *  (`team:submitAnswer`, as the chosen options' text, joined by
 *  `choiceAnswerText`), so the host still reveals and awards points for it by
 *  hand exactly like every other card; `correctChoiceIds` is only a hint shown
 *  to the host, never auto-scored.
 *
 *  `boost` is different again, and not a question at all: it wraps one of
 *  `core/race.ts`'s `CARDS` (the solo race's buff/debuff deck, otherwise
 *  unused now) — reveal it and the host sends it straight to a team, no
 *  judging, no answer. Mixed into a board it's the "иногда открывается что-то
 *  жирное" surprise: extra lives, a timer top-up, or a shove back down the
 *  track. */

export type JeopardyCardType = 'judged' | 'ranked' | 'choice' | 'boost';

/** A small icon standing in for the type name wherever a card shows up live
 *  (the reveal card, the board) — the editor still spells the type out, but a
 *  card a host or team is actually looking at mid-game shouldn't have to. */
export const JEOPARDY_TYPE_ICON: Record<JeopardyCardType, string> = {
  judged: '⚖️',
  ranked: '💯',
  choice: '☑️',
  boost: '🎁',
};

export interface JeopardyCategory {
  id: string;
  label: string;
  emoji: string;
  color: string;
}

export interface RankedAnswer {
  text: string;
  points: number;
}

export interface ChoiceOption {
  id: string;
  text: string;
}

export interface JeopardyCard {
  id: string;
  categoryId: string;
  /** The grid cell's face value — also the default number of credits a
   *  `judged` card is worth when the host awards it in full. */
  value: number;
  title: string;
  /** What the host reads aloud. */
  prompt: string;
  type: JeopardyCardType;
  /** Only for `type === 'ranked'`: the pre-agreed answer list, highest points
   *  first by convention (not enforced — the host reads off whatever a row
   *  says). */
  ranked?: RankedAnswer[];
  /** Only for `type === 'choice'`: the options a team picks between. */
  choices?: ChoiceOption[];
  /** Only for `type === 'choice'`, optional: which option id(s) are correct —
   *  a question can have more than one right answer — shown to the host as a
   *  hint, never scored automatically. */
  correctChoiceIds?: string[];
  /** Archived cards stay in the file (so nothing already written is lost) but
   *  are invisible to the live board — `jeopardyGrid` filters them out. Only
   *  the editor lists them, with a restore action. */
  archived?: boolean;
  /** Optional host-only context — why the marked answer is correct, or
   *  anything else worth knowing before judging. Never shown to a team. */
  note?: string;
  /** Only for `type === 'boost'`: which of `core/race.ts`'s `CARDS` this is —
   *  reused wholesale (icon/name/desc/effect) rather than redefined here. */
  boostCardId?: CardId;
}

export interface JeopardyData {
  categories: JeopardyCategory[];
  cards: JeopardyCard[];
}

export class JeopardyValidationError extends Error {}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Same discipline as the party quiz's `validateCardsData`: throw on the first
 *  problem, with a message the editor can show verbatim. Used both by the
 *  server before it accepts a save and by the editor UI before it sends one. */
export function validateJeopardyData(data: unknown): JeopardyData {
  if (!data || typeof data !== 'object') throw new JeopardyValidationError('Пустые данные.');
  const d = data as Partial<JeopardyData>;

  if (!Array.isArray(d.categories)) throw new JeopardyValidationError('"categories" должен быть массивом.');
  if (!Array.isArray(d.cards)) throw new JeopardyValidationError('"cards" должен быть массивом.');

  const catIds = new Set<string>();
  for (const c of d.categories) {
    if (!c || !isNonEmptyString((c as JeopardyCategory).id)) {
      throw new JeopardyValidationError('У категории нет id.');
    }
    const cat = c as JeopardyCategory;
    if (catIds.has(cat.id)) throw new JeopardyValidationError(`Повторяющийся id категории: ${cat.id}`);
    catIds.add(cat.id);
    if (!isNonEmptyString(cat.label)) throw new JeopardyValidationError(`Категория ${cat.id}: нет названия.`);
  }

  const cardIds = new Set<string>();
  for (const card of d.cards) {
    if (!card || !isNonEmptyString((card as JeopardyCard).id)) {
      throw new JeopardyValidationError('У карточки нет id.');
    }
    const c = card as JeopardyCard;
    if (cardIds.has(c.id)) throw new JeopardyValidationError(`Повторяющийся id карточки: ${c.id}`);
    cardIds.add(c.id);
    if (!catIds.has(c.categoryId)) {
      throw new JeopardyValidationError(`Карточка ${c.id}: неизвестная категория "${c.categoryId}".`);
    }
    if (!isNonEmptyString(c.title)) throw new JeopardyValidationError(`Карточка ${c.id}: нет заголовка.`);
    if (!isNonEmptyString(c.prompt)) throw new JeopardyValidationError(`Карточка ${c.id}: нет текста задания.`);
    if (typeof c.value !== 'number' || !(c.value > 0)) {
      throw new JeopardyValidationError(`Карточка ${c.id}: номинал должен быть положительным числом.`);
    }
    if (c.type !== 'judged' && c.type !== 'ranked' && c.type !== 'choice' && c.type !== 'boost') {
      throw new JeopardyValidationError(`Карточка ${c.id}: неизвестный тип "${String(c.type)}".`);
    }
    if (c.type === 'ranked') {
      if (!Array.isArray(c.ranked) || c.ranked.length === 0) {
        throw new JeopardyValidationError(`Карточка ${c.id}: для типа «сто к одному» нужен список ответов.`);
      }
      for (const r of c.ranked) {
        if (!r || !isNonEmptyString(r.text)) {
          throw new JeopardyValidationError(`Карточка ${c.id}: у варианта ответа нет текста.`);
        }
        if (typeof r.points !== 'number' || !(r.points > 0)) {
          throw new JeopardyValidationError(`Карточка ${c.id}: у варианта ответа должны быть положительные очки.`);
        }
      }
    }
    if (c.type === 'choice') {
      if (!Array.isArray(c.choices) || c.choices.length < 2) {
        throw new JeopardyValidationError(`Карточка ${c.id}: для карточки с вариантами нужно минимум 2 варианта ответа.`);
      }
      const optionIds = new Set<string>();
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
      if (!isNonEmptyString(c.boostCardId) || !(c.boostCardId in CARDS)) {
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

  return { categories: d.categories as JeopardyCategory[], cards: d.cards as JeopardyCard[] };
}

/** Canonical text for a `choice` card's answer pipe: the picked option(s), in
 *  the card's own option order regardless of click order, joined the same way
 *  everywhere — so a team's submission and the host's computed "correct"
 *  string are plain-string comparable. Used both when a team submits its pick
 *  and when the host highlights a matching answer on reveal. */
export function choiceAnswerText(card: JeopardyCard, ids: Iterable<string>): string {
  const picked = new Set(ids);
  return (card.choices ?? [])
    .filter((o) => picked.has(o.id))
    .map((o) => o.text)
    .join(' · ');
}

/** A card whose answer can be scored without a human judge: a `choice` card
 *  (graded by comparing picked option ids to `correctChoiceIds`), or a
 *  `boost` card whose effect just lands on a team with nothing to grade —
 *  except a `cell`/`dice` effect, which needs a caller (the round clock or
 *  next roll) that neither the auto-host nor a picking team's own device is.
 *  A `judged`/`ranked` free-text card needs a human to read the answer, so
 *  it's excluded here — used both by the auto-host (`teamQuizAdmin.ts`,
 *  nothing to judge a subjective answer with) and by a team's own
 *  round-winner picker (`teamQuizDevice.ts`), so a picked card is never one
 *  a running auto-host would get stuck on. A human-run match can still open
 *  a `judged`/`ranked` card by hand — this only restricts the fast "you
 *  cleared first, pick a question" path. */
export function isJudgeFreeCard(card: JeopardyCard): boolean {
  if (card.type === 'choice') return true;
  if (card.type !== 'boost') return false;
  const def = card.boostCardId ? CARDS[card.boostCardId] : undefined;
  return !!def && def.effect.t !== 'cell' && def.effect.t !== 'dice';
}

/** The grid a board screen actually renders: cards grouped by category, sorted
 *  by value within each, archived cards and now-empty categories left out —
 *  the live board should never show a card the editor put away, or a category
 *  with nothing left in it. Cards already drawn this match are left in place —
 *  the caller marks them, this just lays out the geometry. */
export function jeopardyGrid(data: JeopardyData): { category: JeopardyCategory; cards: JeopardyCard[] }[] {
  return data.categories
    .map((category) => ({
      category,
      cards: data.cards.filter((c) => c.categoryId === category.id && !c.archived).sort((a, b) => a.value - b.value),
    }))
    .filter((section) => section.cards.length > 0);
}
