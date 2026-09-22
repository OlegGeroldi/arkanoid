import { App, type Scene } from '../app';
import { choiceAnswerText, JEOPARDY_TYPE_ICON, jeopardyGrid, type JeopardyCard, type JeopardyData } from '../core/jeopardy';
import { CARDS } from '../core/race';
import { finalScore } from '../core/teamRace';
import type { BroadcastView } from '../net/teamQuizProtocol';
import { fetchJeopardy } from '../net/jeopardyClient';
import { button, cardFlip, el } from '../ui/dom';
import { mainMenu } from '../ui/menu';
import { TeamQuizStore } from './teamQuizStore';

const BROADCAST_LABELS: Record<BroadcastView, string> = {
  scoreboard: '🏆 Scoreboard',
  question: '❓ Question',
  single: '🎮 One pilot',
  dual: '🎮🎮 Both pilots',
};

/** The host's control panel, as a short wizard: who's here → which teams →
 *  start and run the match. Entirely DOM, same convention as the solo
 *  race's board screens.
 *
 *  `opts.auto` swaps the human-run match step for an unattended referee loop
 *  (`autoTick`, driven from `update(dt)`) — for exactly the case a live host
 *  can't judge anyway: it only ever opens `choice`/usable-`boost` cards (the
 *  same restriction `soloDuel.ts` uses, for the same reason — no host to
 *  judge a subjective `judged`/`ranked` answer), so a small group can just
 *  play each other without anyone sitting out to run the show. Setup
 *  (players/teams) still needs a human to type in names — only the *running*
 *  of the match is automatic. */

type Step = 'players' | 'match';

/** `core/teamRace.ts`'s `TEAM_COLORS` has exactly 6 distinct colors,
 *  assigned `index % TEAM_COLORS.length` — a 7th player would silently reuse
 *  color #1 and become indistinguishable from it everywhere color is the
 *  only thing telling racers apart. Capped in the UI, not the server — no
 *  protocol change needed. */
const MAX_PLAYERS = 6;

export function teamQuizAdminScene(app: App, opts: { auto?: boolean } = {}): Scene {
  const auto = opts.auto === true;
  const store = new TeamQuizStore('admin');
  let jeopardy: JeopardyData | null = null;
  let distance = 50;
  let step: Step = 'players';
  const newPlayerName = { value: '' };
  const awardPoints = new Map<string, number>();
  /** Which card the flip animation has already played for — a re-render from
   *  an unrelated event (a purchase, another team's roll) tears down and
   *  rebuilds this whole tree, so without tracking this the reveal would
   *  replay every time instead of just once per genuinely new card. */
  let flippedCardId: string | null = null;

  // ---------------------------------------------------------- auto-admin --

  /** Seconds until the next autonomous action is allowed — every action that
   *  triggers a network round-trip sets this, so `autoTick` (called every
   *  frame) doesn't resend the same `admin:*` message every tick while
   *  waiting for the store to catch up. */
  let autoCooldown = 0;
  let autoAnswerState: { cardId: string; stage: 'answering' | 'revealed'; since: number } | null = null;
  const AUTO_ANSWER_WAIT = 18;

  /** Reverses `choiceAnswerText`'s join back into the set of picked option
   *  ids — the wire format only carries the joined display text, not the
   *  ids themselves. */
  function parseChoiceAnswer(card: JeopardyCard, text: string): Set<string> {
    if (!text) return new Set();
    const parts = new Set(text.split(' · '));
    const ids = new Set<string>();
    for (const o of card.choices ?? []) if (parts.has(o.text)) ids.add(o.id);
    return ids;
  }

  /** `admin:awardCard` can only ever crown one team per card (the server
   *  locks the card on the first award), so — same partial-credit rule
   *  `soloDuel.ts` uses — whichever team got the most correct options right
   *  is the one judged, scored proportionally against `card.value`. If
   *  nobody answered at all the card still has to be closed out somehow, or
   *  it would sit revealed forever and block the next pick — that team gets
   *  awarded zero. */
  function resolveAutoChoice(card: JeopardyCard, answers: Record<string, string>): void {
    const correctIds = card.correctChoiceIds ?? [];
    let bestTeam: string | null = null;
    let bestHits = 0;
    for (const [teamId, text] of Object.entries(answers)) {
      const hits = correctIds.filter((id) => parseChoiceAnswer(card, text).has(id)).length;
      if (bestTeam === null || hits > bestHits) {
        bestTeam = teamId;
        bestHits = hits;
      }
    }
    const winner = bestTeam ?? store.roster[0]?.id;
    if (!winner) return;
    const points = correctIds.length ? Math.round((bestHits / correctIds.length) * card.value) : 0;
    store.net.awardCard(card.id, winner, points);
  }

  function autoTick(dt: number): void {
    if (!auto) return;
    if (autoCooldown > 0) {
      autoCooldown -= dt;
      return;
    }
    if (!store.round) {
      if (canStart()) {
        store.net.startMatch(distance);
        autoCooldown = 1;
      }
      return;
    }
    if (store.round.phase === 'resolved') {
      store.net.nextRound();
      autoCooldown = 1;
      return;
    }
    if (store.round.phase !== 'playing' || !jeopardy) return;

    // Picking is the round-winner's job now (`teamQuizDevice.ts` calls
    // `store.net.revealCard` straight from a team device once someone
    // clears) — the auto-host only judges whatever gets revealed, it never
    // picks a card itself. Round 1 (nobody's cleared yet) simply has no
    // question until the first clear happens anywhere. A `boost` card never
    // shows up here at all any more — a team's picker banks it straight into
    // its own stash (`store.net.bankCard`) instead of revealing it, so this
    // branch only ever sees `choice` cards now.
    const active = activeCardId();
    if (!active) {
      autoAnswerState = null;
      return;
    }

    const card = jeopardy.cards.find((c) => c.id === active);
    if (!card) return;
    if (card.type !== 'choice') return; // shouldn't happen — a team's picker only reveals `choice` cards

    if (!autoAnswerState || autoAnswerState.cardId !== active) autoAnswerState = { cardId: active, stage: 'answering', since: 0 };
    autoAnswerState.since += dt;

    if (autoAnswerState.stage === 'answering') {
      const everyoneAnswered = store.submittedAnswers.size >= store.roster.length;
      if (everyoneAnswered || autoAnswerState.since >= AUTO_ANSWER_WAIT) {
        store.net.revealAnswers();
        autoAnswerState.stage = 'revealed';
      }
      return;
    }

    if (store.revealedAnswers) {
      resolveAutoChoice(card, store.revealedAnswers);
      autoAnswerState = null;
      autoCooldown = 2.5;
    }
  }

  /** A read-only mirror of `awardBox`/`boostBox` for the auto-host screen —
   *  same card content, no judging buttons, since nothing here is the
   *  viewer's decision to make. Without this the auto-host's own screen
   *  never shows *what* the computer is currently doing (only after-the-fact
   *  log lines once something resolves), which reads as "nothing is
   *  happening" even while cards are actively cycling underneath. */
  function autoActiveCardView(): HTMLElement | null {
    if (!jeopardy) return null;
    const active = activeCardId();
    if (!active) return null;
    const card = jeopardy.cards.find((c) => c.id === active);
    if (!card) return null;
    const category = jeopardy.categories.find((c) => c.id === card.categoryId);

    if (card.type === 'boost') {
      const def = card.boostCardId ? CARDS[card.boostCardId] : undefined;
      return el(
        'div',
        { class: 'card', style: 'margin-top:8px' },
        el('div', { class: 'title' }, `${def?.icon ?? '🎁'} ${def?.name ?? card.title}`),
        el('p', { class: 'hint' }, def?.desc ?? card.prompt),
        el('p', { class: 'hint' }, 'Resolving automatically…'),
      );
    }

    const correctIds = card.correctChoiceIds ?? [];
    return el(
      'div',
      { class: 'card', style: 'margin-top:8px' },
      el('div', { class: 'title' }, `${category?.emoji ?? ''} ${card.title} · ${card.value}`.trim()),
      el('p', {}, card.prompt),
      card.choices
        ? el(
            'div',
            { class: 'answer-chips' },
            ...card.choices.map((o) => el('span', { class: `answer-chip${correctIds.includes(o.id) ? ' correct' : ''}` }, o.text)),
          )
        : null,
      el(
        'div',
        { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:6px' },
        ...store.roster.map((r) =>
          el(
            'span',
            { class: 'pill', style: store.submittedAnswers.has(r.id) ? `border-color:${r.color};color:${r.color}` : 'opacity:.4' },
            `${r.name}${store.submittedAnswers.has(r.id) ? ' ✓' : ' …'}`,
          ),
        ),
      ),
    );
  }

  function autoStatusView(): HTMLElement {
    const round = store.round;
    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'title' }, '🤖 Auto-host'),
      el(
        'p',
        { class: 'hint' },
        'The computer opens trivia cards on its own — only ones with a ready-made correct answer — judges them and applies boosts. Cards with no fixed answer are skipped: there is nobody to judge them.',
      ),
      round
        ? el(
            'div',
            { class: 'grid c3', style: 'margin-top:8px' },
            ...store.roster.map((r) => {
              const team = store.team(r.id);
              return el(
                'div',
                { class: 'desc' },
                el('b', { style: `color:${r.color}` }, r.name),
                el('div', {}, `cell ${team?.cell ?? 0}/${store.distance} · ♥${team?.lives ?? 0}`),
                el('div', {}, `credits ${team?.credits ?? 0} · points ${team?.score ?? 0}`),
              );
            }),
          )
        : el('p', { class: 'hint' }, canStart() ? 'Match will start automatically…' : 'Need at least 2 players.'),
      round ? (autoActiveCardView() ?? el('p', { class: 'hint', style: 'margin-top:8px' }, 'Picking the next card…')) : null,
    );
  }

  app.overlay.classList.add('interactive');
  render();

  /** `update(dt)`'s own `autoTick` call is driven by `requestAnimationFrame`
   *  via the app's main loop — which Chrome (and other browsers) fully
   *  *pauses*, not just throttles, for a tab that isn't the visible one.
   *  An auto-hosted match is exactly the case where nobody may be looking
   *  at this tab for minutes at a time (everyone's on their own pilot/team
   *  device instead), so relying on rAF alone would silently freeze the
   *  whole match — no card ever gets revealed, no round ever advances —
   *  the instant this tab is backgrounded. `setInterval` keeps firing
   *  (throttled to roughly once a second in a hidden tab, but *not*
   *  stopped) regardless of tab visibility, so it's used here as a
   *  fallback clock for `autoTick` specifically. Safe to run alongside the
   *  rAF-driven call: `autoTick` is gated by its own `autoCooldown`/state
   *  checks, so being ticked twice as often when the tab *is* visible just
   *  means it's checked more often, never that it double-acts. */
  let autoIntervalAt = performance.now();
  const autoInterval = auto
    ? window.setInterval(() => {
        const now = performance.now();
        const dt = (now - autoIntervalAt) / 1000;
        autoIntervalAt = now;
        autoTick(dt);
      }, 1000)
    : null;

  fetchJeopardy()
    .then((data) => {
      jeopardy = data;
      render();
    })
    .catch(() => {
      /* No content saved yet — the board panel just says so. */
    });

  const unsubscribe = store.subscribe(render);

  function activeCardId(): string | null {
    for (const id of store.revealedCards) {
      if (!store.usedCards.has(id)) return id;
    }
    return null;
  }

  function canStart(): boolean {
    return store.roster.length >= 2;
  }

  /** Once the match is running, a refreshed/reconnected admin lands straight
   *  on the round screen no matter where the local wizard state was. */
  function currentStep(): Step {
    return store.round ? 'match' : step;
  }

  function goTo(next: Step): void {
    step = next;
    render();
  }

  // -------------------------------------------------------------- step 1 --

  function addPlayer(): void {
    const name = newPlayerName.value.trim().slice(0, 24);
    if (!name || store.roster.length >= MAX_PLAYERS) return;
    store.net.addPlayer(name);
    newPlayerName.value = '';
    render();
  }

  /** Every player races themselves — no more "list everyone, then sort them
   *  into teams" second step. Alliances (who a buff/debuff can reach) are
   *  formed live, mid-match, from the board screen — not decided here. */
  function playersStep(): HTMLElement {
    const atMax = store.roster.length >= MAX_PLAYERS;
    const nameInput = el('input', {
      placeholder: 'Player name',
      value: newPlayerName.value,
      oninput: (e) => (newPlayerName.value = (e.target as HTMLInputElement).value),
      onkeydown: (e) => {
        if ((e as KeyboardEvent).key === 'Enter') addPlayer();
      },
    });
    // Re-focus after every rebuild (each add/remove replaces the whole tree)
    // so typing a name, hitting Enter, typing the next keeps working without
    // clicking back into the field each time.
    queueMicrotask(() => nameInput.focus());

    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'title' }, "👤 Who's playing?"),
      el('p', { class: 'hint' }, 'Each name races on its own — form alliances live once the match starts.'),
      store.roster.length
        ? el(
            'div',
            { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin:10px 0' },
            ...store.roster.map((r) =>
              el(
                'span',
                { class: 'pill', style: `border-color:${r.color};color:${r.color};display:inline-flex;align-items:center;gap:6px` },
                r.name,
                button('×', () => store.net.removeTeam(r.id), 'btn small ghost'),
              ),
            ),
          )
        : el('p', { class: 'hint' }, 'Nobody yet — add the first player below.'),
      atMax
        ? el('p', { class: 'hint' }, '6 players max — colors start repeating past this.')
        : el(
            'div',
            { class: 'row', style: 'gap:6px;margin-top:8px' },
            nameInput,
            button('➕ Add', addPlayer, 'btn small primary'),
          ),
      el(
        'div',
        { class: 'row', style: 'margin-top:16px' },
        button('Next: start →', () => goTo('match'), `btn primary${canStart() ? '' : ' ghost'}`),
        !canStart() ? el('span', { class: 'hint' }, 'Need at least 2 players.') : null,
      ),
    );
  }

  // -------------------------------------------------------------- step 3 --

  function matchStep(): HTMLElement {
    if (!store.round) {
      return el(
        'div',
        {},
        el(
          'div',
          { class: 'card' },
          el('div', { class: 'title' }, '▶️ Start the match'),
          el(
            'div',
            { class: 'row', style: 'gap:8px;align-items:center' },
            el('span', { class: 'hint' }, 'Distance:'),
            el('input', {
              type: 'number',
              value: String(distance),
              oninput: (e) => (distance = Number((e.target as HTMLInputElement).value) || 50),
              style: 'width:70px',
            }),
          ),
          !canStart() ? el('p', { class: 'hint' }, 'Need at least 2 players.') : null,
          button('▶️ Start match', () => store.net.startMatch(distance), `btn primary${canStart() ? '' : ' ghost'}`),
        ),
        el('div', { class: 'row', style: 'margin-top:16px' }, button('← Players', () => goTo('players'), 'btn ghost')),
      );
    }

    const round = store.round;
    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'title' }, `Round ${round.round} · ${phaseLabel(round.phase)}`),
      el(
        'div',
        { class: 'grid c3', style: 'margin-top:8px' },
        ...store.roster.map((r) => {
          const team = store.team(r.id);
          return el(
            'div',
            { class: 'desc' },
            el('b', { style: `color:${r.color}` }, r.name),
            el('div', {}, `cell ${team?.cell ?? 0}/${store.distance} · ♥${team?.lives ?? 0}`),
            el('div', {}, `credits ${team?.credits ?? 0} · points ${team?.score ?? 0}`),
          );
        }),
      ),
      round.phase === 'resolved'
        ? button('➡️ Next round', () => store.net.nextRound(), 'btn primary')
        : el('p', { class: 'hint', style: 'margin-top:8px' }, 'Round in progress…'),
      el(
        'div',
        { class: 'row', style: 'margin-top:14px' },
        button(
          '🔄 Reset match',
          () => {
            store.net.resetMatch();
            goTo('players');
          },
          'btn small ghost',
        ),
      ),
    );
  }

  function phaseLabel(phase: string): string {
    if (phase === 'playing') return 'in progress';
    if (phase === 'resolved') return 'resolved';
    if (phase === 'over') return 'match over';
    return phase;
  }

  /** The finish ends the race, but the champion is whoever's final `score`
   *  is highest — round wins/losses and every correct trivia answer already
   *  count toward it (`TeamQuizStore.championId`), not just who happened to
   *  cross the line first. Shows both when they differ. */
  function championBanner(): HTMLElement | null {
    if (!store.matchOverTeamId) return null;
    const champ = store.championId ? store.team(store.championId) : undefined;
    const finisher = store.team(store.matchOverTeamId);
    return el(
      'div',
      { style: 'margin-bottom:6px' },
      el(
        'p',
        { class: 'hint', style: 'color:#ffd24d' },
        `🏆 Champion: ${champ?.name ?? ''} — ${champ ? finalScore(champ) : 0} pts`,
      ),
      champ && champ.id !== store.matchOverTeamId
        ? el('p', { class: 'hint' }, `🏁 First to finish: ${finisher?.name ?? ''}`)
        : null,
      store.matchAwardLines.length
        ? el(
            'div',
            { class: 'col', style: 'gap:4px;margin-top:6px' },
            ...store.matchAwardLines.map((a) => el('p', { class: 'hint' }, el('b', { style: `color:${a.color}` }, `${a.name}: `), a.text)),
          )
        : null,
    );
  }

  // ------------------------------------------------------------ jeopardy --

  function jeopardyPanel(): HTMLElement {
    if (!jeopardy) {
      return el('div', { class: 'card' }, el('div', { class: 'title' }, '🎯 Trivia board'), el('p', { class: 'hint' }, 'No content loaded.'));
    }
    const active = activeCardId();
    const activeCard = active ? jeopardy.cards.find((c) => c.id === active) : null;
    if (!activeCard) flippedCardId = null;
    const grid = jeopardyGrid(jeopardy);

    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'title' }, '🎯 Trivia board'),
      activeCard ? (activeCard.type === 'boost' ? boostBox(activeCard) : awardBox(activeCard)) : null,
      ...grid.map((section) =>
        el(
          'div',
          { style: 'margin-top:8px' },
          el('div', { class: 'hint', style: `color:${section.category.color}` }, `${section.category.emoji} ${section.category.label}`),
          el(
            'div',
            { class: 'row', style: 'gap:4px;flex-wrap:wrap' },
            ...section.cards.map((card) => {
              const used = store.usedCards.has(card.id);
              const revealed = store.revealedCards.has(card.id);
              return button(
                `${card.value}${used ? ' ✓' : ''}`,
                () => {
                  if (!used && !revealed) store.net.revealCard(card.id);
                },
                `btn small${used ? ' used' : revealed ? ' primary' : ' ghost'}`,
              );
            }),
          ),
        ),
      ),
    );
  }

  function awardBox(card: NonNullable<JeopardyData['cards'][number]>): HTMLElement {
    const points = awardPoints.get(card.id) ?? card.value;
    const category = jeopardy?.categories.find((c) => c.id === card.categoryId);
    const settled = flippedCardId === card.id;
    flippedCardId = card.id;
    return el(
      'div',
      { style: 'margin:10px 0' },
      cardFlip(
        true,
        settled,
        el('span', { class: 'card-back-emoji' }, '🎯'),
        el(
          'div',
          {},
          el('span', { class: 'card-type-badge' }, JEOPARDY_TYPE_ICON[card.type]),
          el(
            'span',
            { class: 'card-category', style: `--category-color:${category?.color ?? '#ffd24d'}` },
            `${category?.emoji ?? ''} ${category?.label ?? ''}`.trim(),
          ),
          el('h4', {}, `${card.title} · ${card.value}`),
          el('p', {}, card.prompt),
        ),
      ),
      card.type === 'ranked' && card.ranked
        ? el(
            'div',
            { class: 'answer-chips' },
            ...card.ranked.map((r) => el('span', { class: 'answer-chip' }, r.text, ' · ', String(r.points))),
          )
        : null,
      card.type === 'choice' && card.choices
        ? el(
            'div',
            { class: 'answer-chips' },
            ...card.choices.map((o) =>
              el('span', { class: `answer-chip${card.correctChoiceIds?.includes(o.id) ? ' correct' : ''}` }, o.text),
            ),
          )
        : null,
      card.note ? el('p', { class: 'hint', style: 'font-style:italic;margin-top:6px' }, card.note) : null,
      el(
        'div',
        { class: 'row', style: 'gap:6px;align-items:center;margin-top:10px;justify-content:center' },
        el('span', {}, 'Points:'),
        el('input', {
          type: 'number',
          value: String(points),
          style: 'width:70px',
          oninput: (e) => awardPoints.set(card.id, Number((e.target as HTMLInputElement).value) || 0),
        }),
        ...store.roster.map((r) =>
          button(
            `→ ${r.name}`,
            () => {
              store.net.awardCard(card.id, r.id, awardPoints.get(card.id) ?? card.value);
              awardPoints.delete(card.id);
            },
            'btn small primary',
          ),
        ),
      ),
    );
  }

  /** `boost` cards resolve instantly — no points, no judging. The card just
   *  wraps one of `core/race.ts`'s `CARDS`, so this is mostly just showing
   *  that entry's own icon/name/desc and sending its effect straight to
   *  whichever team the host picks. */
  function boostBox(card: NonNullable<JeopardyData['cards'][number]>): HTMLElement {
    const def = card.boostCardId ? CARDS[card.boostCardId] : undefined;
    const category = jeopardy?.categories.find((c) => c.id === card.categoryId);
    const settled = flippedCardId === card.id;
    flippedCardId = card.id;
    return el(
      'div',
      { style: 'margin:10px 0' },
      cardFlip(
        true,
        settled,
        el('span', { class: 'card-back-emoji' }, def?.icon ?? '🎁'),
        el(
          'div',
          {},
          el('span', { class: 'card-type-badge' }, JEOPARDY_TYPE_ICON.boost),
          el(
            'span',
            { class: 'card-category', style: `--category-color:${category?.color ?? '#ffd24d'}` },
            `${category?.emoji ?? ''} ${category?.label ?? ''}`.trim(),
          ),
          el('h4', {}, def ? `${def.icon} ${def.name}` : card.title),
          el('p', {}, def?.desc ?? card.prompt),
        ),
      ),
      el(
        'div',
        { class: 'row', style: 'gap:6px;align-items:center;margin-top:10px;justify-content:center' },
        el('span', {}, 'To:'),
        ...store.roster.map((r) =>
          button(
            `→ ${r.name}`,
            () => {
              if (def) store.net.applyBoost(card.id, r.id, def.effect);
            },
            'btn small primary',
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ broadcast --

  /** The director's switcher for the projector/TV screen — what's on it is
   *  entirely the host's call, never automatic. */
  function broadcastPanel(): HTMLElement {
    const current = store.broadcastView;
    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'title' }, '📺 Broadcast'),
      el(
        'div',
        { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        ...(Object.keys(BROADCAST_LABELS) as BroadcastView[]).map((view) =>
          button(
            BROADCAST_LABELS[view],
            () => store.net.setBroadcastView(view, current.focusTeamId ?? undefined),
            `btn small${current.view === view ? ' primary' : ' ghost'}`,
          ),
        ),
      ),
      current.view === 'single'
        ? el(
            'div',
            { class: 'row', style: 'gap:6px;margin-top:6px' },
            el('span', { class: 'hint' }, 'Show which team:'),
            ...store.roster.map((r) =>
              button(
                r.name,
                () => store.net.setBroadcastView('single', r.id),
                `btn small${current.focusTeamId === r.id ? ' primary' : ' ghost'}`,
              ),
            ),
          )
        : null,
    );
  }

  // -------------------------------------------------------------- answers --

  function answersPanel(): HTMLElement | null {
    if (!store.round) return null;
    const active = activeCardId();
    const activeCard = active ? jeopardy?.cards.find((c) => c.id === active) : null;
    const correctText =
      activeCard?.type === 'choice' && activeCard.correctChoiceIds
        ? choiceAnswerText(activeCard, activeCard.correctChoiceIds)
        : undefined;
    return el(
      'div',
      { class: 'card', style: 'margin-top:10px' },
      el('div', { class: 'title' }, "✏️ Teams' answers"),
      el(
        'div',
        { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        ...store.roster.map((r) =>
          el(
            'span',
            { class: 'pill', style: store.submittedAnswers.has(r.id) ? `border-color:${r.color};color:${r.color}` : 'opacity:.4' },
            `${r.name}${store.submittedAnswers.has(r.id) ? ' ✓' : ' …'}`,
          ),
        ),
      ),
      button('👁 Show answers', () => store.net.revealAnswers(), 'btn small primary'),
      store.revealedAnswers
        ? el(
            'div',
            { style: 'margin-top:8px' },
            ...Object.entries(store.revealedAnswers).map(([teamId, text]) => {
              const team = store.roster.find((r) => r.id === teamId);
              const correct = correctText !== undefined && text === correctText;
              return el(
                'p',
                { class: 'hint', style: correct ? 'color:#3ddc84' : undefined },
                el('b', { style: `color:${team?.color ?? '#fff'}` }, `${team?.name ?? teamId}: `),
                text,
                correct ? ' ✓' : '',
              );
            }),
          )
        : null,
    );
  }

  // -------------------------------------------------------------- inbox ----

  function questionInboxPanel(): HTMLElement | null {
    if (!store.questionInbox.length) return null;
    return el(
      'div',
      { class: 'card', style: 'margin-top:10px' },
      el('div', { class: 'title' }, `✍️ Questions from teams (${store.questionInbox.length})`),
      ...store.questionInbox.map((q) => {
        const team = store.roster.find((r) => r.id === q.teamId);
        return el(
          'div',
          { class: 'row', style: 'gap:6px;align-items:center;margin-top:6px' },
          el('span', { class: 'desc' }, el('b', { style: `color:${team?.color ?? '#fff'}` }, `${team?.name ?? q.teamId}: `), q.text),
          button('Show on screen', () => store.net.pickCustomQuestion(q.id), 'btn small primary'),
        );
      }),
    );
  }

  // ------------------------------------------------------------------ log --

  function logPanel(): HTMLElement {
    return el('div', { class: 'commentary' }, ...store.log.slice(0, 8).map((line) => el('p', { style: `color:${line.color}` }, line.text)));
  }

  function stepBadge(): HTMLElement {
    const cur = currentStep();
    // Free navigation between steps only makes sense while there's no live
    // round to jump away from — mid-match, an admin reconnect should always
    // land back on the round screen, not wherever this pill was last set.
    const navigable = !store.round;
    const items: { id: Step; label: string }[] = [
      { id: 'players', label: '1 · Players' },
      { id: 'match', label: '2 · Match' },
    ];
    return el(
      'div',
      { class: 'row', style: 'gap:8px;margin-bottom:16px' },
      ...items.map((it) =>
        el(
          'span',
          {
            class: 'pill',
            style: `${it.id === cur ? 'border-color:#4de2ff;color:#4de2ff' : 'opacity:.45'}${navigable ? ';cursor:pointer' : ''}`,
            onclick: navigable ? () => goTo(it.id) : undefined,
          },
          it.label,
        ),
      ),
    );
  }

  function render(): void {
    const cur = currentStep();
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen' },
        el('h2', { class: 'race-headline' }, auto ? '🤖 Auto-host' : 'Host'),
        stepBadge(),
        championBanner(),
        cur === 'players'
          ? playersStep()
          : auto
            ? autoStatusView()
            : el(
                'div',
                { class: 'row', style: 'gap:16px;align-items:flex-start' },
                el(
                  'div',
                  { style: 'flex:1;min-width:280px' },
                  matchStep(),
                  store.round ? el('div', { style: 'margin-top:10px' }, broadcastPanel()) : null,
                  answersPanel(),
                  questionInboxPanel(),
                ),
                el('div', { style: 'flex:1;min-width:280px' }, jeopardyPanel()),
              ),
        store.log.length ? logPanel() : null,
        el(
          'div',
          { class: 'row', style: 'margin-top:16px' },
          button('Menu', () => {
            unsubscribe();
            store.dispose();
            app.setScene(mainMenu);
          }, 'btn ghost'),
        ),
      ),
    );
  }

  return {
    update(dt) {
      autoTick(dt);
    },
    draw() {},
    dispose() {
      if (autoInterval !== null) clearInterval(autoInterval);
      unsubscribe();
      store.dispose();
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
