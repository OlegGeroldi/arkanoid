import { App, type Scene } from '../app';
import {
  JeopardyValidationError,
  JEOPARDY_TYPE_ICON,
  validateJeopardyData,
  type JeopardyCard,
  type JeopardyCardType,
  type JeopardyCategory,
  type JeopardyData,
} from '../core/jeopardy';
import { CARD_LIST } from '../core/race';
import { fetchJeopardy, saveJeopardy } from '../net/jeopardyClient';
import { button, downloadJson, el, pickJsonFile } from '../ui/dom';
import { mainMenu } from '../ui/menu';

/** The host's content editor for the trivia board: full CRUD over categories
 *  and cards, including the multiple-choice `choice` card type and the
 *  instant `boost` type (a reveal that hands one of `core/race.ts`'s `CARDS`
 *  to a team, no judging). Talks straight to `/api/jeopardy`
 *  (`net/jeopardyClient.ts`) — content is global config, not match state, so
 *  this scene never joins a room and can be opened any time, independent of
 *  whatever match is or isn't running elsewhere. Edits are local until
 *  "Save all" — the API only knows a full-replace write, so there is no
 *  per-card save, just local edits validated (same `validateJeopardyData` the
 *  server itself re-checks) and pushed together. */

const TYPE_LABELS: Record<JeopardyCardType, string> = {
  judged: `${JEOPARDY_TYPE_ICON.judged} Host judges`,
  ranked: `${JEOPARDY_TYPE_ICON.ranked} Top answers`,
  choice: `${JEOPARDY_TYPE_ICON.choice} Multiple choice`,
  boost: `${JEOPARDY_TYPE_ICON.boost} Boost/debuff`,
};

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function emptyCard(categoryId: string): JeopardyCard {
  return { id: randomId('card'), categoryId, value: 100, title: '', prompt: '', type: 'judged' };
}

export function teamQuizEditorScene(app: App): Scene {
  let data: JeopardyData | null = null;
  let saveError: string | null = null;
  let saving = false;
  let dirty = false;

  const newCategory = { label: '', emoji: '🎯', color: '#4de2ff' };
  let editingCardId: string | null = null;
  let cardDraft: JeopardyCard | null = null;
  let newCardDraft: JeopardyCard | null = null;

  app.overlay.classList.add('interactive');
  render();

  fetchJeopardy()
    .then((loaded) => {
      data = loaded;
      render();
    })
    .catch(() => {
      // No content saved yet — start from an empty board rather than stalling on "Loading…" forever.
      data = { categories: [], cards: [] };
      render();
    });

  function touch(): void {
    dirty = true;
    saveError = null;
  }

  // ------------------------------------------------------------ categories --

  function addCategory(): void {
    if (!data) return;
    const label = newCategory.label.trim();
    if (!label) return;
    data.categories.push({
      id: randomId('cat'),
      label,
      emoji: newCategory.emoji.trim() || '🎯',
      color: /^#[0-9a-f]{3,8}$/i.test(newCategory.color.trim()) ? newCategory.color.trim() : '#4de2ff',
    });
    newCategory.label = '';
    touch();
    render();
  }

  function removeCategory(id: string): void {
    if (!data || data.cards.some((c) => c.categoryId === id)) return;
    data.categories = data.categories.filter((c) => c.id !== id);
    touch();
    render();
  }

  // ----------------------------------------------------------------- cards --

  function startEditCard(card: JeopardyCard): void {
    editingCardId = card.id;
    cardDraft = JSON.parse(JSON.stringify(card)) as JeopardyCard;
    render();
  }

  function cancelCardEdit(): void {
    editingCardId = null;
    cardDraft = null;
    render();
  }

  function commitCardEdit(): void {
    if (!data || !cardDraft) return;
    const i = data.cards.findIndex((c) => c.id === cardDraft!.id);
    if (i < 0) return;
    data.cards[i] = cleanCard(cardDraft);
    editingCardId = null;
    cardDraft = null;
    touch();
    render();
  }

  /** Archived cards stay in the file — they just stop showing up on the live
   *  board (`jeopardyGrid` filters them out). The reversible way to retire a
   *  card; permanent removal is only offered once a card is already archived. */
  function archiveCard(id: string): void {
    if (!data) return;
    const card = data.cards.find((c) => c.id === id);
    if (!card) return;
    card.archived = true;
    touch();
    render();
  }

  function restoreCard(id: string): void {
    if (!data) return;
    const card = data.cards.find((c) => c.id === id);
    if (!card) return;
    card.archived = false;
    touch();
    render();
  }

  function removeCard(id: string): void {
    if (!data) return;
    data.cards = data.cards.filter((c) => c.id !== id);
    touch();
    render();
  }

  function commitNewCard(): void {
    if (!data || !newCardDraft) return;
    data.cards.push(cleanCard(newCardDraft));
    newCardDraft = null;
    touch();
    render();
  }

  /** Strips fields that don't belong to the chosen type, and drops blank rows
   *  from ranked/choice lists — the editor lets you add a row and fill it in
   *  after, so half-typed rows are expected mid-edit, just not on commit. */
  function cleanCard(card: JeopardyCard): JeopardyCard {
    const clean: JeopardyCard = {
      id: card.id,
      categoryId: card.categoryId,
      value: card.value,
      title: card.title.trim(),
      prompt: card.prompt.trim(),
      type: card.type,
    };
    if (card.type === 'ranked') {
      clean.ranked = (card.ranked ?? []).filter((r) => r.text.trim()).map((r) => ({ text: r.text.trim(), points: r.points }));
    }
    if (card.type === 'choice') {
      const choices = (card.choices ?? []).filter((o) => o.text.trim()).map((o) => ({ id: o.id, text: o.text.trim() }));
      clean.choices = choices;
      const correctIds = (card.correctChoiceIds ?? []).filter((id) => choices.some((o) => o.id === id));
      if (correctIds.length) clean.correctChoiceIds = correctIds;
    }
    if (card.type === 'boost' && card.boostCardId) clean.boostCardId = card.boostCardId;
    if (card.archived) clean.archived = true;
    if (card.note?.trim()) clean.note = card.note.trim();
    return clean;
  }

  // ------------------------------------------------------------------ save --

  async function save(): Promise<void> {
    if (!data) return;
    saving = true;
    saveError = null;
    render();
    try {
      const validated = validateJeopardyData(data);
      await saveJeopardy(validated);
      dirty = false;
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save.';
    }
    saving = false;
    render();
  }

  function exportJson(): void {
    if (data) downloadJson('jeopardy.json', data);
  }

  async function importJson(): Promise<void> {
    const picked = await pickJsonFile();
    if (!picked) return;
    try {
      data = validateJeopardyData(picked);
      editingCardId = null;
      cardDraft = null;
      newCardDraft = null;
      touch();
    } catch (err) {
      saveError = err instanceof JeopardyValidationError ? err.message : "That file doesn't look like a quiz.";
    }
    render();
  }

  // ---------------------------------------------------------------- pieces --

  function categoriesPanel(d: JeopardyData): HTMLElement {
    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'title' }, '🗂 Categories'),
      ...d.categories.map((cat) => {
        const used = d.cards.some((c) => c.categoryId === cat.id);
        return el(
          'div',
          { class: 'row', style: 'gap:6px;align-items:center;margin-top:8px' },
          el('input', {
            type: 'text',
            value: cat.emoji,
            style: 'width:44px;text-align:center',
            oninput: (e) => {
              cat.emoji = (e.target as HTMLInputElement).value;
              touch();
            },
          }),
          el('input', {
            type: 'text',
            value: cat.label,
            style: 'flex:1;min-width:120px',
            oninput: (e) => {
              cat.label = (e.target as HTMLInputElement).value;
              touch();
            },
          }),
          el('input', {
            type: 'text',
            value: cat.color,
            style: 'width:90px',
            oninput: (e) => {
              cat.color = (e.target as HTMLInputElement).value;
              touch();
            },
          }),
          used
            ? el('span', { class: 'hint' }, "can't delete — has cards")
            : button('Delete', () => removeCategory(cat.id), 'btn small ghost'),
        );
      }),
      el(
        'div',
        { class: 'row', style: 'gap:6px;margin-top:10px' },
        el('input', {
          type: 'text',
          placeholder: 'Emoji',
          value: newCategory.emoji,
          style: 'width:44px;text-align:center',
          oninput: (e) => (newCategory.emoji = (e.target as HTMLInputElement).value),
        }),
        el('input', {
          type: 'text',
          placeholder: 'Category name',
          value: newCategory.label,
          style: 'flex:1;min-width:120px',
          oninput: (e) => (newCategory.label = (e.target as HTMLInputElement).value),
          onkeydown: (e) => {
            if ((e as KeyboardEvent).key === 'Enter') addCategory();
          },
        }),
        el('input', {
          type: 'text',
          placeholder: '#4de2ff',
          value: newCategory.color,
          style: 'width:90px',
          oninput: (e) => (newCategory.color = (e.target as HTMLInputElement).value),
        }),
        button('➕ Category', addCategory, 'btn small primary'),
      ),
    );
  }

  function cardSummary(card: JeopardyCard, cat: JeopardyCategory): HTMLElement {
    return el(
      'div',
      { class: 'row', style: 'gap:6px;align-items:center;margin-top:6px' },
      el('span', { class: 'pill', style: `border-color:${cat.color}` }, `${card.value}`),
      el('span', { style: 'flex:1;min-width:120px' }, card.title || '(untitled)'),
      el('span', { class: 'hint' }, TYPE_LABELS[card.type]),
      button('✎', () => startEditCard(card), 'btn small ghost'),
      button('📦', () => archiveCard(card.id), 'btn small ghost'),
    );
  }

  /** An archived card only offers restore and permanent (unrecoverable)
   *  removal — editing an already-retired card isn't useful, so it skips
   *  straight past the edit form. */
  function archivedCardSummary(card: JeopardyCard, cat: JeopardyCategory): HTMLElement {
    return el(
      'div',
      { class: 'row', style: 'gap:6px;align-items:center;margin-top:6px;opacity:.55' },
      el('span', { class: 'pill', style: `border-color:${cat.color}` }, `${card.value}`),
      el('span', { style: 'flex:1;min-width:120px' }, card.title || '(untitled)'),
      el('span', { class: 'hint' }, TYPE_LABELS[card.type]),
      button('♻️ Restore', () => restoreCard(card.id), 'btn small ghost'),
      button('× Delete forever', () => removeCard(card.id), 'btn small ghost'),
    );
  }

  function typePicker(draft: JeopardyCard): HTMLElement {
    return el(
      'div',
      { class: 'row', style: 'gap:6px' },
      ...(Object.keys(TYPE_LABELS) as JeopardyCardType[]).map((t) =>
        button(
          TYPE_LABELS[t],
          () => {
            draft.type = t;
            render();
          },
          `btn small${draft.type === t ? ' primary' : ' ghost'}`,
        ),
      ),
    );
  }

  function categoryPicker(draft: JeopardyCard, categories: JeopardyCategory[]): HTMLElement {
    return el(
      'div',
      { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      ...categories.map((cat) =>
        button(
          `${cat.emoji} ${cat.label}`,
          () => {
            draft.categoryId = cat.id;
            render();
          },
          `btn small${draft.categoryId === cat.id ? ' primary' : ' ghost'}`,
        ),
      ),
    );
  }

  function rankedEditor(draft: JeopardyCard): HTMLElement {
    const list = (draft.ranked ??= []);
    return el(
      'div',
      { style: 'margin-top:8px' },
      el('div', { class: 'hint' }, 'Answers and points (for "Top answers"):'),
      ...list.map((r, i) =>
        el(
          'div',
          { class: 'row', style: 'gap:6px;margin-top:4px' },
          el('input', {
            type: 'text',
            value: r.text,
            style: 'flex:1;min-width:100px',
            oninput: (e) => (r.text = (e.target as HTMLInputElement).value),
          }),
          el('input', {
            type: 'number',
            value: String(r.points),
            style: 'width:70px',
            oninput: (e) => (r.points = Number((e.target as HTMLInputElement).value) || 0),
          }),
          button(
            '×',
            () => {
              list.splice(i, 1);
              render();
            },
            'btn small ghost',
          ),
        ),
      ),
      button(
        '➕ Answer',
        () => {
          list.push({ text: '', points: 10 });
          render();
        },
        'btn small ghost',
      ),
    );
  }

  function boostPicker(draft: JeopardyCard): HTMLElement {
    return el(
      'div',
      { style: 'margin-top:8px' },
      el('div', { class: 'hint' }, 'Which card from the boost/debuff deck fires on reveal:'),
      el(
        'div',
        { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:4px' },
        ...CARD_LIST.map((def) =>
          button(
            `${def.icon} ${def.name}`,
            () => {
              draft.boostCardId = def.id;
              render();
            },
            `btn small${draft.boostCardId === def.id ? ' primary' : ' ghost'}`,
          ),
        ),
      ),
    );
  }

  function choiceEditor(draft: JeopardyCard): HTMLElement {
    const list = (draft.choices ??= []);
    const correct = (draft.correctChoiceIds ??= []);
    return el(
      'div',
      { style: 'margin-top:8px' },
      el('div', { class: 'hint' }, "Answer options — the team picks one or more on its own screen:"),
      ...list.map((o, i) =>
        el(
          'div',
          { class: 'row', style: 'gap:6px;margin-top:4px;align-items:center' },
          el('input', {
            type: 'text',
            value: o.text,
            style: 'flex:1;min-width:100px',
            oninput: (e) => (o.text = (e.target as HTMLInputElement).value),
          }),
          button(
            correct.includes(o.id) ? '✓ correct' : 'mark correct',
            () => {
              const at = correct.indexOf(o.id);
              if (at >= 0) correct.splice(at, 1);
              else correct.push(o.id);
              render();
            },
            `btn small${correct.includes(o.id) ? ' primary' : ' ghost'}`,
          ),
          button(
            '×',
            () => {
              list.splice(i, 1);
              const at = correct.indexOf(o.id);
              if (at >= 0) correct.splice(at, 1);
              render();
            },
            'btn small ghost',
          ),
        ),
      ),
      button(
        '➕ Option',
        () => {
          list.push({ id: randomId('opt'), text: '' });
          render();
        },
        'btn small ghost',
      ),
    );
  }

  function cardForm(draft: JeopardyCard, categories: JeopardyCategory[], onSave: () => void, onCancel: () => void): HTMLElement {
    return el(
      'div',
      { class: 'card', style: 'margin-top:6px;border-color:#4de2ff44' },
      el('div', { class: 'hint' }, 'Category:'),
      categoryPicker(draft, categories),
      el(
        'div',
        { class: 'row', style: 'gap:6px;margin-top:8px' },
        el('input', {
          type: 'text',
          placeholder: 'Title',
          value: draft.title,
          style: 'flex:1;min-width:140px',
          oninput: (e) => (draft.title = (e.target as HTMLInputElement).value),
        }),
        el('input', {
          type: 'number',
          value: String(draft.value),
          style: 'width:90px',
          oninput: (e) => (draft.value = Number((e.target as HTMLInputElement).value) || 0),
        }),
      ),
      el(
        'textarea',
        {
          placeholder: 'Prompt text (what the host reads out)',
          style: 'width:100%;min-height:64px;margin-top:8px',
          oninput: (e) => (draft.prompt = (e.target as HTMLTextAreaElement).value),
        },
        draft.prompt,
      ),
      el('div', { class: 'hint', style: 'margin-top:8px' }, 'Card type:'),
      typePicker(draft),
      draft.type === 'ranked' ? rankedEditor(draft) : null,
      draft.type === 'choice' ? choiceEditor(draft) : null,
      draft.type === 'boost' ? boostPicker(draft) : null,
      el('div', { class: 'hint', style: 'margin-top:8px' }, "Note for the host (optional, teams don't see it):"),
      el(
        'textarea',
        {
          placeholder: 'E.g. why this answer is correct',
          style: 'width:100%;min-height:44px;margin-top:2px',
          oninput: (e) => (draft.note = (e.target as HTMLTextAreaElement).value),
        },
        draft.note ?? '',
      ),
      el(
        'div',
        { class: 'row', style: 'gap:6px;margin-top:10px' },
        button('💾 Save card', onSave, 'btn small primary'),
        button('Cancel', onCancel, 'btn small ghost'),
      ),
    );
  }

  function cardsPanel(d: JeopardyData): HTMLElement {
    if (!d.categories.length) {
      return el(
        'div',
        { class: 'card' },
        el('div', { class: 'title' }, '🎯 Cards'),
        el('p', { class: 'hint' }, 'Add at least one category first.'),
      );
    }
    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'title' }, '🎯 Cards'),
      ...d.categories.map((cat) => {
        const all = d.cards.filter((c) => c.categoryId === cat.id).sort((a, b) => a.value - b.value);
        const active = all.filter((c) => !c.archived);
        const archived = all.filter((c) => c.archived);
        return el(
          'div',
          { style: 'margin-top:12px' },
          el('div', { class: 'hint', style: `color:${cat.color}` }, `${cat.emoji} ${cat.label}`),
          ...active.map((card) =>
            editingCardId === card.id && cardDraft
              ? cardForm(cardDraft, d.categories, commitCardEdit, cancelCardEdit)
              : cardSummary(card, cat),
          ),
          newCardDraft?.categoryId === cat.id
            ? cardForm(newCardDraft, d.categories, commitNewCard, () => {
                newCardDraft = null;
                render();
              })
            : button(
                '➕ Card',
                () => {
                  newCardDraft = emptyCard(cat.id);
                  render();
                },
                'btn small ghost',
              ),
          archived.length
            ? el(
                'div',
                { style: 'margin-top:6px' },
                el('div', { class: 'hint', style: 'opacity:.6' }, `📦 Archive (${archived.length})`),
                ...archived.map((card) => archivedCardSummary(card, cat)),
              )
            : null,
        );
      }),
    );
  }

  function render(): void {
    // Every edit rebuilds the whole tree, and `.screen` (not the window) is
    // the actual scroll container — a fresh node always starts at scrollTop
    // 0, which reads as the page "jumping to the top" on every keystroke's
    // structural change. Carry the old scroll position over explicitly.
    const scrollTop = app.overlay.querySelector('.screen')?.scrollTop ?? 0;

    const body: (HTMLElement | null)[] = [];
    if (!data) {
      body.push(el('p', { class: 'hint' }, 'Loading…'));
    } else {
      body.push(
        el(
          'div',
          { class: 'row', style: 'gap:8px;align-items:center;margin-bottom:12px' },
          button(saving ? 'Saving…' : '💾 Save all', () => void save(), `btn primary${saving ? ' ghost' : ''}`),
          button('⬇️ Export JSON', exportJson, 'btn small ghost'),
          button('⬆️ Import JSON', () => void importJson(), 'btn small ghost'),
          dirty ? el('span', { class: 'hint', style: 'color:#ffd24d' }, 'unsaved changes') : null,
        ),
        saveError ? el('p', { class: 'hint', style: 'color:#ff5f7a' }, saveError) : null,
        el(
          'div',
          { class: 'row', style: 'gap:16px;align-items:flex-start' },
          el('div', { style: 'flex:1;min-width:280px' }, categoriesPanel(data)),
          el('div', { style: 'flex:1;min-width:280px' }, cardsPanel(data)),
        ),
      );
    }

    const screen = el(
      'div',
      { class: 'screen' },
      el('h2', { class: 'race-headline' }, 'Quiz editor'),
      el('p', { class: 'hint' }, 'Trivia categories and cards — what the host sees on the board and what teams open.'),
      ...body,
      el(
        'div',
        { class: 'row', style: 'margin-top:16px' },
        button('Menu', () => app.setScene(mainMenu), 'btn ghost'),
      ),
    );
    app.overlay.replaceChildren(screen);
    screen.scrollTop = scrollTop;
  }

  return {
    update() {},
    draw() {},
    dispose() {
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
