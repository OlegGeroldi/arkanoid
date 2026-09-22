import { App, type Scene } from '../app';
import { ARENA_H, ARENA_W } from '../core/constants';
import { JEOPARDY_TYPE_ICON, type JeopardyCard, type JeopardyData } from '../core/jeopardy';
import { finalScore } from '../core/teamRace';
import { fetchJeopardy } from '../net/jeopardyClient';
import { SnapshotMirror, drawSnapshotMirror } from '../render/snapshotMirror';
import { button, cardFlip, el } from '../ui/dom';
import { mainMenu } from '../ui/menu';
import { TeamQuizStore } from './teamQuizStore';

/** The projector/TV screen. Read-only — it never sends a gameplay message of
 *  its own. Drives itself entirely off the same event-replay `TeamQuizStore`
 *  every other screen already builds (scoreboard + a public, non-interactive
 *  cut of the announcement board — current question, who's picking, the
 *  event feed) rather than waiting on a human director's camera picks: once
 *  hosting is always automatic (`teamQuizAdmin.ts`'s `auto` mode), nobody is
 *  left to send `admin:setBroadcastView` at all. The `spotlight` reaction
 *  (a rival-target debuff briefly showing the hit team's own field) is the
 *  one thing that still temporarily takes over the whole screen — everything
 *  else just always renders. */

interface MirrorSlot {
  mirror: SnapshotMirror;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export function teamQuizBroadcastScene(app: App): Scene {
  const store = new TeamQuizStore('public');
  let jeopardy: JeopardyData | null = null;
  const mirrors = new Map<string, MirrorSlot>();
  /** Which question the flip animation has already played for (see
   *  `cardFlip()` in `ui/dom.ts`) — `store.subscribe(render)` rebuilds this
   *  whole tree on every event, not just a new question, so without this the
   *  reveal would replay each time instead of once per genuinely new one. */
  let flippedQuestionKey: string | null = null;
  /** A local-only, temporary override of whatever view the host picked —
   *  fired by any rival-targeted debuff (a purchase or a boost card, either
   *  way `onEffect` sees an effect of type `'debuff'`) so the room gets to
   *  see the sabotage land, then hands control back to the host's own choice
   *  once the window closes. Never touches `store.broadcastView` itself —
   *  that's shared, host-controlled state, and a spotlight is purely this
   *  screen's own reaction. */
  let spotlight: { teamId: string; until: number } | null = null;
  let clock = 0;
  const SPOTLIGHT_SECONDS = 4;

  function mirrorFor(teamId: string): MirrorSlot {
    let slot = mirrors.get(teamId);
    if (!slot) {
      const canvas = document.createElement('canvas');
      canvas.width = ARENA_W;
      canvas.height = ARENA_H;
      canvas.style.borderRadius = '14px';
      slot = { mirror: new SnapshotMirror(), canvas, ctx: canvas.getContext('2d')! };
      mirrors.set(teamId, slot);
    }
    return slot;
  }

  app.overlay.classList.add('interactive');
  render();

  fetchJeopardy()
    .then((data) => {
      jeopardy = data;
      render();
    })
    .catch(() => {
      /* Question view falls back to "no data" until content exists. */
    });

  const unsubscribe = store.subscribe(render);
  const unsubscribeSnapshot = store.onSnapshot((teamId, snap) => {
    mirrorFor(teamId).mirror.push(snap);
  });
  const unsubscribeEffect = store.onEffect((teamId, effect) => {
    if (effect.t !== 'debuff') return;
    spotlight = { teamId, until: clock + SPOTLIGHT_SECONDS };
    render();
  });

  function leaveToMenu(): void {
    unsubscribe();
    unsubscribeSnapshot();
    unsubscribeEffect();
    store.dispose();
    app.setScene(mainMenu);
  }

  // ------------------------------------------------------------ scoreboard --

  function scoreboardView(): HTMLElement {
    return el(
      'div',
      { class: 'grid c2', style: 'margin-top:24px' },
      ...store.roster.map((r) => {
        const team = store.team(r.id);
        return el(
          'div',
          { class: 'card', style: `border-color:${r.color};text-align:center;padding:28px` },
          el('div', { style: `font-size:32px;font-weight:800;color:${r.color}` }, r.name),
          el('div', { style: 'font-size:64px;font-weight:800;margin:10px 0' }, `${team?.score ?? 0}`),
          el('div', { class: 'hint', style: 'font-size:16px' }, 'round points'),
          el(
            'div',
            { class: 'race-facts', style: 'justify-content:center;margin-top:16px' },
            fact(`${team?.cell ?? 0}`, `of ${store.distance} cells`, r.color),
            fact(`♥ ${team?.lives ?? 0}`, 'lives', '#ff5fa2'),
            fact(`${team?.credits ?? 0}`, 'credits', '#ffd24d'),
          ),
        );
      }),
    );
  }

  function fact(value: string, caption: string, color?: string): HTMLElement {
    return el(
      'div',
      {},
      el('b', { style: `font-size:22px;${color ? `color:${color}` : ''}` }, value),
      el('span', { style: 'font-size:13px' }, caption),
    );
  }

  // -------------------------------------------------------------- question --

  function questionView(): HTMLElement {
    const q = store.currentQuestion;
    if (!q) {
      flippedQuestionKey = null;
      // No live host to open a card by hand any more — the round winner
      // picks it themselves (`teamQuizDevice.ts`'s `pickerPanel()`), so this
      // is either "nobody's won a round yet" or "the winner is choosing".
      const winnerId = store.lastRoundWinnerId;
      if (!winnerId) {
        return el('p', { class: 'hint', style: 'font-size:18px;margin-top:20px' }, 'Waiting for the first level clear to unlock picking a question…');
      }
      const winner = store.roster.find((r) => r.id === winnerId);
      return el(
        'p',
        { class: 'hint', style: `font-size:18px;margin-top:20px;color:${winner?.color ?? '#ffd24d'}` },
        `🏆 ${winner?.name ?? 'A team'} is picking the next question…`,
      );
    }
    let key = '';
    let category = '';
    let title = '';
    let prompt = '';
    let color = '#ffd24d';
    let emoji = '🎯';
    let card: JeopardyCard | null = null;
    if (q.source === 'jeopardy') {
      key = `card:${q.cardId}`;
      const found = jeopardy?.cards.find((c) => c.id === q.cardId) ?? null;
      card = found;
      const cat = found ? jeopardy?.categories.find((c) => c.id === found.categoryId) : null;
      category = `${cat?.emoji ?? ''} ${cat?.label ?? ''}`.trim();
      title = found ? `${found.title} · ${found.value}` : 'Card';
      prompt = found?.prompt ?? '';
      color = cat?.color ?? color;
    } else {
      key = `custom:${q.id}`;
      const team = store.roster.find((r) => r.id === q.teamId);
      emoji = '✍️';
      category = 'Question from a team';
      title = team?.name ?? '';
      prompt = q.text;
      color = team?.color ?? color;
    }
    const settled = flippedQuestionKey === key;
    flippedQuestionKey = key;
    // `cardFlip()` returns the `.card-stage` wrapper — the broadcast screen
    // gets a bigger stage than the admin panel's inline card, so its size is
    // overridden directly rather than adding a size param nothing else needs.
    const stage = cardFlip(
      true,
      settled,
      el('span', { class: 'card-back-emoji', style: 'font-size:64px' }, emoji),
      el(
        'div',
        {},
        card ? el('span', { class: 'card-type-badge', style: 'font-size:24px' }, JEOPARDY_TYPE_ICON[card.type]) : null,
        el('span', { class: 'card-category', style: `--category-color:${color};font-size:16px;padding:4px 16px` }, category),
        el('h4', { style: 'font-size:26px;margin-top:10px' }, title),
        el('p', { style: 'font-size:21px' }, prompt),
      ),
    );
    stage.style.height = 'min(52vh, 420px)';
    stage.style.width = 'min(92vw, 900px)';
    return el(
      'div',
      { style: 'margin-top:20px' },
      stage,
      // No correctness highlight here on purpose — this screen faces the room,
      // including the team still picking, so it must not spoil the answer.
      card?.type === 'choice' && card.choices
        ? el(
            'div',
            { class: 'answer-chips', style: 'margin-top:14px;font-size:16px' },
            ...card.choices.map((o) => el('span', { class: 'answer-chip', style: 'font-size:15px;padding:6px 16px' }, o.text)),
          )
        : null,
      el(
        'div',
        { class: 'row', style: 'gap:10px;margin-top:20px;justify-content:center' },
        ...store.roster.map((r) =>
          el(
            'span',
            { class: 'pill', style: store.submittedAnswers.has(r.id) ? `border-color:${r.color};color:${r.color}` : 'opacity:.4' },
            `${r.name}${store.submittedAnswers.has(r.id) ? ' ✓ answered' : ' — thinking…'}`,
          ),
        ),
      ),
      store.revealedAnswers
        ? el(
            'div',
            { style: 'margin-top:18px' },
            ...Object.entries(store.revealedAnswers).map(([teamId, text]) => {
              const team = store.roster.find((r) => r.id === teamId);
              return el(
                'p',
                { style: 'font-size:20px' },
                el('b', { style: `color:${team?.color ?? '#fff'}` }, `${team?.name ?? teamId}: `),
                text,
              );
            }),
          )
        : null,
    );
  }

  // -------------------------------------------------------- announcement --

  function roundStatusLine(): HTMLElement | null {
    const round = store.round;
    if (!round) return null;
    return el(
      'p',
      { class: 'hint', style: 'font-size:16px' },
      round.phase === 'resolved' ? `Round ${round.round} resolved — next round starting…` : `Round ${round.round} — racing…`,
    );
  }

  /** A public, read-only cut of `teamQuizDevice.ts`'s `announcementBoard()`
   *  — no buy buttons, no answer inputs, no "your turn" framing, since this
   *  screen isn't any one team. Everything it shows (`currentQuestion`,
   *  `lastRoundWinnerId`, `log`) is already replayed onto this same
   *  `TeamQuizStore('public')`, so no new wire messages are needed. */
  function announcementView(): HTMLElement {
    const feed = store.log.filter((line) => line.kind !== 'purchase').slice(0, 6);
    return el(
      'div',
      { class: 'card', style: 'margin-top:20px' },
      el('div', { class: 'title', style: 'justify-content:center;font-size:20px' }, '📢 Announcement board'),
      roundStatusLine(),
      questionView(),
      feed.length
        ? el(
            'div',
            { class: 'commentary', style: 'margin-top:14px;text-align:left' },
            ...feed.map((line) => el('p', { style: `color:${line.color};font-size:15px` }, line.text)),
          )
        : null,
    );
  }

  // ------------------------------------------------------------- arena(s) --

  function singleViewFor(teamId: string | null, label?: string): HTMLElement {
    const team = teamId ? store.roster.find((r) => r.id === teamId) : null;
    if (!teamId || !team) return el('p', { class: 'hint', style: 'margin-top:40px' }, 'No team selected.');
    const slot = mirrorFor(teamId);
    slot.canvas.style.width = '480px';
    slot.canvas.style.height = '720px';
    return el(
      'div',
      { style: 'margin-top:16px;text-align:center' },
      label ? el('div', { style: 'font-size:18px;font-weight:800;color:#ff4d6d;margin-bottom:4px' }, label) : null,
      el('div', { style: `font-size:26px;font-weight:800;color:${team.color};margin-bottom:10px` }, team.name),
      slot.canvas,
    );
  }

  /** The finish ends the race, but the champion the room sees named is
   *  whoever's final `score` is highest (`TeamQuizStore.championId`) —
   *  round wins/losses and every correct trivia answer already count toward
   *  it, not just who happened to cross the line first. */
  function matchOverBanner(): HTMLElement {
    const champ = store.championId ? store.team(store.championId) : undefined;
    const finisher = store.matchOverTeamId ? store.team(store.matchOverTeamId) : undefined;
    return el(
      'div',
      { style: 'margin-top:24px' },
      el(
        'h2',
        { style: `color:${champ?.color ?? '#ffd24d'}` },
        `🏆 CHAMPION: ${champ?.name ?? ''} — ${champ ? finalScore(champ) : 0} pts`,
      ),
      champ && finisher && champ.id !== finisher.id
        ? el('p', { class: 'hint', style: 'font-size:16px' }, `🏁 First to finish: ${finisher.name}`)
        : null,
      store.matchAwardLines.length
        ? el(
            'div',
            { class: 'col', style: 'gap:8px;margin-top:20px' },
            ...store.matchAwardLines.map((a) =>
              el('p', { style: 'font-size:18px' }, el('b', { style: `color:${a.color}` }, `${a.name}: `), a.text),
            ),
          )
        : null,
    );
  }

  // ------------------------------------------------------------------ root --

  function render(): void {
    const activeSpotlight = spotlight && clock < spotlight.until ? spotlight : null;
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen', style: 'text-align:center;max-width:none' },
        el('h1', { class: 'logo', style: 'font-size:28px' }, 'TEAM QUIZ'),
        !store.round ? el('p', { class: 'hint', style: 'font-size:18px' }, 'Waiting for the match to start…') : null,
        activeSpotlight
          ? singleViewFor(activeSpotlight.teamId, '⚡ Sabotage incoming!')
          : store.round
            ? el('div', {}, scoreboardView(), announcementView())
            : null,
        store.matchOverTeamId ? matchOverBanner() : null,
        el('div', { class: 'row', style: 'margin-top:24px;justify-content:center' }, button('Menu', leaveToMenu, 'btn ghost small')),
      ),
    );
  }

  return {
    update(dt) {
      clock += dt;
      if (spotlight && clock >= spotlight.until) {
        spotlight = null;
        render();
      }
      for (const slot of mirrors.values()) {
        slot.mirror.tick(dt);
        drawSnapshotMirror(slot.ctx, slot.mirror, '#4de2ff', "Waiting for the pilot's field…");
      }
    },
    draw() {
      // Everything here is DOM; mirrors draw into their own canvases above.
    },
    dispose() {
      unsubscribe();
      unsubscribeSnapshot();
      unsubscribeEffect();
      store.dispose();
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
