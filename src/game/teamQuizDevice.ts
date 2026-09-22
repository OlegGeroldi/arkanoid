import { App, fitBox, type Scene } from '../app';
import { ARENA_H, ARENA_W, ENERGY_MAX } from '../core/constants';
import { Arena, noInput, type ArenaInput } from '../core/arena';
import { Bot } from '../core/bot';
import type { LevelData } from '../core/level';
import type { SuperId } from '../core/supers';
import { levelForCell, type Roll, type TurnResult } from '../core/race';
import {
  allied,
  ALLIANCE_MAX,
  finalScore,
  isFinale,
  livesForRound,
  roundSecondsFor,
  TEAM_BOSS_LIVES_BONUS,
  TEAM_CELL_TYPES,
  type TeamCell,
  type TeamCellOutcome,
  type TeamRacer,
} from '../core/teamRace';
import { applyCardEffectToArena } from '../core/cardEffects';
import { DEBUFF_LIST } from '../core/debuffs';
import { choiceAnswerText, isJudgeFreeCard, JEOPARDY_TYPE_ICON, jeopardyGrid, type JeopardyData } from '../core/jeopardy';
import { SHOP_LIST, canAfford, type ShopItem } from '../core/shop';
import { fetchJeopardy } from '../net/jeopardyClient';
import { SnapshotMirror, drawSnapshotMirror } from '../render/snapshotMirror';
import { ArenaFx } from '../render/fx';
import { drawArena, drawHud } from '../render/renderer';
import { SOLO_KEYS } from './input';
import { edgeOnce, FixedStepper } from './stepper';
import { animateDieRoll, button, el } from '../ui/dom';
import { mainMenu } from '../ui/menu';
import { sfx } from '../audio/sfx';
import { music } from '../audio/music';
import { TeamQuizStore } from './teamQuizStore';
import { RACE_CELLS_INTERVAL, RACE_SNAPSHOT_INTERVAL, type RaceSnapshot } from '../net/raceProtocol';

/** The team's one device: shop + trivia board + a live mirror of its own
 *  pilot's field most of the time, and — when the rotation says it's this
 *  team's turn — the same screen turns into the pilot's own arena until the
 *  level ends, then returns. One device is enough per team; a second (this
 *  same scene, opened again elsewhere) just gives everyone their own view of
 *  the shop and board while the same rotation logic runs on the server. */

const HUD_W = 236;
const GAP = 16;
const SCENE_W = ARENA_W + GAP + HUD_W;
const SCENE_H = ARENA_H;

export interface TeamQuizDeviceOptions {
  teamId: string;
  levels: LevelData[];
  superId: SuperId;
  /** Never waits for a human to press "Play"/"Autopilot" — the instant a
   *  fresh pilot turn opens for this team, it races itself. For a device
   *  nobody is actually sitting at (the "demo run" menu screen's spare
   *  teams), so the match keeps moving without anyone there to click. */
  unattended?: boolean;
}

/** `auto` is `pilot` with the arena driven by `core/bot.ts`'s `Bot` instead
 *  of this device's own input, and — the whole point of it — the board's DOM
 *  (shop, trivia panel, answer box) stays up and clickable the entire time
 *  instead of being torn down for a fullscreen arena. Lets one person run
 *  both halves of a team (pilot the level *and* work the shop/board) without
 *  a second device, at the cost of the level playing itself. */
type Mode = 'board' | 'pilot' | 'auto' | 'over';

interface RevealEntry {
  teamId: string;
  name: string;
  color: string;
  roll: Roll;
  outcomes: TeamCellOutcome[];
  /** Absolute cell targets to visit in order: index 0 is right after the
   *  raw dice steps, index i>=1 is right after `outcomes[i-1]` fires. */
  checkpoints: number[];
  pos: number;
  cp: number;
  revealed: string[];
}

interface RevealState {
  /** One board for the whole match (`store.board`) — every entry below
   *  walks the same array, so a cell one team reveals shows up for
   *  everyone else's token too. */
  board: TeamCell[];
  entries: RevealEntry[];
}

export function teamQuizDeviceScene(app: App, opts: TeamQuizDeviceOptions): Scene {
  const store = new TeamQuizStore('team', opts.teamId);
  const mirror = new SnapshotMirror();
  const mirrorCanvas = document.createElement('canvas');
  mirrorCanvas.width = ARENA_W;
  mirrorCanvas.height = ARENA_H;
  mirrorCanvas.className = 'team-mirror';
  mirrorCanvas.style.width = '210px';
  mirrorCanvas.style.height = '315px';
  mirrorCanvas.style.borderRadius = '10px';
  mirrorCanvas.style.border = '1px solid rgba(255,255,255,0.18)';
  const mirrorCtx = mirrorCanvas.getContext('2d')!;

  /** One live mirror per *other* team, fed from every `snapshot` broadcast
   *  (not just this device's own team's) — lets the spectator panel show
   *  whoever `focusRacerId` currently points at, once this team is allowed to
   *  watch at all (`canSpectate()`). Drawn into the *same* `mirrorCanvas`
   *  box the "waiting for the pilot's field" view already uses (swapping
   *  what it shows, not adding a second small box) — the user was explicit
   *  that the feed belongs wherever the autopilot window already lives, not
   *  buried in the announcement board's scroll area. Built lazily so a
   *  match with many teams doesn't allocate mirrors nobody ever looks at. */
  const previewMirrors = new Map<string, SnapshotMirror>();

  let mode: Mode = 'board';
  let jeopardy: JeopardyData | null = null;
  /** Both the shop's non-self purchases *and* the spectator panel's live
   *  preview point at the same racer — cycling the preview with the ◀/▶
   *  buttons is how you aim a debuff (or, once allied, a gifted buff),
   *  there's no separate targeting step. */
  let focusRacerId: string | null = null;
  /** Only meaningful while `focusRacerId` is currently an ally: toggles a
   *  self-type shop item between helping the buyer (default) and gifting it
   *  to that ally instead — see `buy()`/`shopPanel()`. */
  let giftToAlly = false;
  /** The announcement board's own scroll offset, preserved across the full
   *  DOM rebuild every `renderBoard()` call does — see `announcementBoard()`. */
  let boardScrollTop = 0;
  /** Same idea, one level up — the whole `.screen` box's own scroll offset,
   *  since `renderBoard()` also rebuilds *that* from scratch every call. */
  let pageScrollTop = 0;
  /** Which card's `.race-effect` entrance "pop" (`cellreveal`, `ui/styles.css`)
   *  has already played — `announcementBoard()` rebuilds a brand-new
   *  `.race-effect` div on *every* re-render (a click, but also now the
   *  countdown watchdogs firing every ~500ms while racing/spectating), and
   *  a CSS `animation` on a freshly-created element always replays from
   *  scratch — without this, the question card visibly popped/flashed on a
   *  loop the whole time it was on screen, not just once when it opened. */
  let activeCardAnimKey: string | null = null;
  let answerDraft = '';
  /** What was actually sent, kept around after `answerDraft` clears back to
   *  '' — the locked-in view still needs something to display. */
  let submittedAnswerText = '';
  let questionDraft = '';
  /** Which card's choice buttons a selection belongs to — reset whenever the
   *  active card changes, so an old highlight doesn't survive onto the next
   *  question. A card can have more than one correct option, so picking is
   *  toggle-then-submit rather than a single tap. */
  let choiceCardId: string | null = null;
  let selectedChoiceIds = new Set<string>();
  /** A shared-map staged reveal (dice, then a cell-by-cell walk, for every
   *  team on its own track at once) shown on this device once a round
   *  resolves — every device replays the same `roll` events into an
   *  identical `TeamRacer[]`/`store.roundReveal`, so this is never
   *  team-scoped the way `startPiloting` is. `null` while not showing one.
   *  While non-null, `sync()` steps aside entirely — the animation's own
   *  timers drive re-renders, not the store's `notify()`. */
  let revealState: RevealState | null = null;
  /** Which round's reveal has already played, so a `notify()` that fires
   *  again for the same still-`resolved` round (an unrelated purchase, say)
   *  doesn't restart it from scratch. */
  let revealShownForRound = -1;
  /** Guards the reveal's `setTimeout` chain from touching `app.overlay`
   *  after this scene is gone — e.g. the user hit "Menu" mid-animation and
   *  some other scene now owns the overlay. */
  let disposed = false;
  /** The last round this device's team actually piloted — once it matches
   *  the live round, the play prompt hides and the shop closes until the
   *  next round opens. */
  let playedRound = 0;
  /** This team's own pilot result for `playedRound`, and how long the round
   *  has sat `resolved` since — feed `answerWindowOpen()`'s per-team timing
   *  rule (bigger games only, see there for why). */
  let lastResult: TurnResult | null = null;
  let resolvedGrace = 0;
  /** How long a team that cleared its level keeps its answer window open
   *  past the round resolving — a reward for actually winning the level,
   *  not just for being on a team that eventually finishes. */
  const WINNER_GRACE_SECONDS = 60;

  // Pilot-mode state (live only while mode === 'pilot').
  let arena: Arena | null = null;
  let fx = new ArenaFx();
  const stepper = new FixedStepper();
  const bot = new Bot();
  /** `update(dt)` is `requestAnimationFrame`-driven, which Chrome fully
   *  *pauses* (not just throttles) for a tab that isn't the visible one —
   *  fine for `'pilot'` (a human watching this exact tab obviously has it
   *  focused) but not for `'auto'`, which is exactly the mode meant to keep
   *  racing while nobody's looking at this tab at all (an AI teammate, or a
   *  spare team on a demo/test run). `autoWatchdog` is a `setInterval` that
   *  only ever acts as a catch-up: while rAF is healthy it sees `staleFor`
   *  stay near zero and does nothing, so it never double-steps the arena
   *  alongside `update(dt)` — it only steps once rAF has visibly gone
   *  silent for a while, which only happens once this tab is backgrounded. */
  let autoWatchdog: number | null = null;
  let lastAutoTickAt = 0;
  /** While autopiloting, `renderBoard()` is only ever called once, right
   *  when racing starts ("Board DOM stays exactly as it is" — only the
   *  mirror canvas repaints every frame) — so the "Xs left"/lives line in
   *  `turnStatus()` froze at whatever it said the instant autopilot began,
   *  never counting down, which read as "unclear when the round will end".
   *  This accumulator forces a plain re-render about once a second while
   *  racing, same cost as any other event already triggers, just on a timer. */
  let layout = { scale: 1, ox: 0, oy: 0 };
  let t = 0;
  let clock = 0;
  let clockLimit = 0;
  let livesAtStart = 0;
  let bestCombo = 0;
  let snapTimer = 0;
  let cellsTimer = 0;
  let lastCells = '';
  let snapSeq = -1;

  app.overlay.classList.add('interactive');
  renderBoard();

  fetchJeopardy()
    .then((data) => {
      jeopardy = data;
      if (mode === 'board') renderBoard();
    })
    .catch(() => {
      /* No content saved yet — the board just shows the shop until an admin saves some. */
    });

  const unsubscribe = store.subscribe(sync);
  const unsubscribeSnapshot = store.onSnapshot((teamId, snap) => {
    if (teamId === opts.teamId) {
      if (mode === 'board') mirror.push(snap);
      return;
    }
    let pm = previewMirrors.get(teamId);
    if (!pm) {
      pm = new SnapshotMirror();
      previewMirrors.set(teamId, pm);
    }
    pm.push(snap);
  });
  const unsubscribeEffect = store.onEffect((teamId, effect) => {
    if (teamId !== opts.teamId) return;
    if (effect.t === 'clock') {
      clock = Math.max(1, clock + effect.delta);
      clockLimit = Math.max(clockLimit, clock);
      return;
    }
    if (effect.t === 'dice') {
      const team = myTeam();
      if (team) team.diceMod += effect.delta;
      return;
    }
    if (effect.t === 'cell') return; // already applied to the store's own team.cell
    if (arena) applyCardEffectToArena(effect, arena);
  });

  /** `spectatorPanel()`'s "♥N · Xs left" readout on a watched rival is only
   *  ever generated inside `renderBoard()`, which `mode === 'board'`
   *  otherwise calls just from store events (a purchase, a new round) — so
   *  without a timer it freezes at whatever the rival's stats were the
   *  moment spectating began. `setInterval`, same as `autoWatchdog` above,
   *  since a tab genuinely in the background never runs `update(dt)` at all.
   *  (`autoWatchdog` already re-renders every tick while `mode === 'auto'`
   *  for the same reason, so this only ever does real work in `'board'`.) */
  const spectateWatchdog = window.setInterval(() => {
    if (mode === 'board' && canWatch() && focusRacerId) renderBoard();
  }, 500);

  function myTeam() {
    return store.team(opts.teamId);
  }

  function rivals() {
    return store.roster.filter((r) => r.id !== opts.teamId);
  }

  function activeCardId(): string | null {
    for (const id of store.revealedCards) {
      if (!store.usedCards.has(id)) return id;
    }
    return null;
  }

  function roundIsOpen(): boolean {
    return store.round?.phase === 'playing' && store.round.round !== playedRound;
  }

  /** "Только тот кто первее заканчивает гонку может вредить или баффить
   *  других игроков" — the spectator panel (and the shop's rival-target
   *  purchases, which share its `focusRacerId`) only work for one of this
   *  round's first three finishers, and only in the window between this
   *  team's own pilot finishing and the round fully resolving — once
   *  everyone's done there's nothing live left to watch. */
  function canSpectate(): boolean {
    const round = store.round;
    return !!round && round.phase === 'playing' && round.round === playedRound && store.topFinishers.includes(opts.teamId);
  }

  /** Broader than `canSpectate()`: anyone who's already submitted this
   *  round (or is having their bot race it) has nothing else to do but
   *  watch, so everyone gets the live preview — only the round's first
   *  three finishers (`canSpectate()`) also get to spend credits on it. */
  function canWatch(): boolean {
    const round = store.round;
    return !!round && round.phase === 'playing' && (round.round === playedRound || mode === 'auto');
  }

  function pendingPilot(): { id: string; name: string; ai?: boolean } | null {
    const round = store.round;
    if (!round || !roundIsOpen()) return null;
    const pilotId = round.pilots[opts.teamId];
    const member = pilotId ? myTeam()?.members.find((m) => m.id === pilotId) : null;
    return pilotId && member ? { id: pilotId, name: member.name, ai: member.ai } : null;
  }

  function sync(): void {
    if (store.matchOverTeamId && mode !== 'over') {
      mode = 'over';
      renderOver();
      return;
    }
    if (mode === 'over' || mode === 'pilot') return;
    // Mid-reveal, the animation's own `setTimeout` chain drives every
    // re-render — a `notify()` firing here (a purchase, another team still
    // trickling in results) must not interrupt it or race it into starting
    // twice.
    if (revealState) return;
    autoSubmitIfNeeded();
    if (
      store.round?.phase === 'resolved' &&
      store.roundReveal.length &&
      revealShownForRound !== store.round.round &&
      mode === 'board'
    ) {
      startRoundReveal();
      return;
    }
    // A round opening is never something to wait on a button press for —
    // the level races itself the instant it's this team's turn, no "Play"/
    // "Autopilot" choice screen. `startPiloting(true)` still leaves a live
    // "🕹️ Take over" button up for anyone who wants to actually fly it by
    // hand mid-race (`takeOver()`), so nothing about manual play is lost —
    // it's just never required to get the round moving.
    if (mode === 'board' && roundIsOpen() && pendingPilot()) {
      startPiloting(true);
      return;
    }
    renderBoard();
  }

  // ---------------------------------------------------------- round reveal --

  /** Turns one team's roll + outcomes into the absolute cell targets its
   *  token visits in order — mirrors `soloDuel.ts`'s own `walkCheckpoints`,
   *  duplicated rather than shared since that one is fixed to exactly two
   *  racers and this one to an arbitrary roster. */
  function revealCheckpoints(startCell: number, roll: Roll, outcomes: TeamCellOutcome[]): number[] {
    let pos = Math.min(store.distance, Math.max(0, startCell + roll.total));
    const points = [pos];
    for (const o of outcomes) {
      pos = Math.min(store.distance, Math.max(0, pos + o.delta));
      points.push(pos);
    }
    return points;
  }

  /** One shared track, every team's token on it — a cell any team has
   *  already revealed shows its icon for everyone, since `board` is the
   *  same array reference every entry walks. */
  function sharedTrackGrid(board: TeamCell[], entries: RevealEntry[]): HTMLElement {
    return el(
      'div',
      { class: 'racetrack' },
      ...board.map((cell) => {
        const def = cell.revealed && cell.kind ? TEAM_CELL_TYPES[cell.kind] : null;
        const here = entries.filter((e) => e.pos === cell.index);
        return el(
          'div',
          {
            class: `racecell${cell.revealed ? ' known' : ''}${cell.index === store.distance ? ' finish' : ''}`,
            style: def ? `--hole:${def.color}` : undefined,
          },
          String(cell.index),
          def ? el('span', { class: 'icon' }, def.icon) : null,
          here.length
            ? el('div', { class: 'tokens' }, ...here.map((e) => el('i', { style: `background:${e.color}` })))
            : null,
        );
      }),
    );
  }

  /** Every device replays the same `roll` broadcasts into an identical
   *  `store.roundReveal`, so this reveal is never scoped to just this
   *  team — every team's dice and walk plays out together, on the one
   *  shared track (`store.board`) the whole match races on. Snapshotted
   *  into `revealState` up front rather than re-read from the store as it
   *  plays, so a fast admin starting the next round underneath doesn't cut
   *  the animation short. */
  function startRoundReveal(): void {
    revealShownForRound = store.round!.round;
    const entries: RevealEntry[] = store.roundReveal.map((r) => {
      const team = store.roster.find((t) => t.id === r.teamId);
      return {
        teamId: r.teamId,
        name: team?.name ?? r.teamId,
        color: team?.color ?? '#4de2ff',
        roll: r.roll,
        outcomes: r.outcomes,
        checkpoints: revealCheckpoints(r.cellBefore, r.roll, r.outcomes),
        pos: r.cellBefore,
        cp: 0,
        revealed: [],
      };
    });
    revealState = { board: store.board, entries };
    renderRevealDice();
  }

  function renderRevealDice(): void {
    if (!revealState) return;
    const dice = new Map<string, HTMLElement>();
    const rows = revealState.entries.map((e) => {
      const die = el('span', { style: 'font-size:28px;display:inline-block;min-width:1.2em' }, '');
      dice.set(e.teamId, die);
      return el(
        'div',
        { class: 'row', style: 'gap:12px;align-items:center;justify-content:center' },
        el('span', { style: `color:${e.color};font-weight:800;min-width:120px;text-align:right` }, e.name),
        die,
        el('span', { class: 'hint' }, `+${e.roll.total}`),
      );
    });
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen', style: 'text-align:center' },
        el('h2', { class: 'race-headline' }, '🎲 Round result'),
        el('div', { class: 'col', style: 'gap:10px;margin-top:12px' }, ...rows),
        el('p', { class: 'hint', style: 'margin-top:10px' }, 'Rolling…'),
      ),
    );
    let done = 0;
    for (const e of revealState.entries) {
      const dieEl = dice.get(e.teamId)!;
      animateDieRoll(dieEl, e.roll.die, {
        onTick: () => sfx.play('diceTick'),
        onDone: () => {
          if (disposed) return;
          sfx.play('diceLand');
          done++;
          if (done >= revealState!.entries.length) stepRevealWalk();
        },
      });
    }
  }

  function renderRevealWalk(): void {
    if (!revealState) return;
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen', style: 'text-align:center' },
        el('h2', { class: 'race-headline' }, '🎲 Round result'),
        el(
          'div',
          { class: 'row', style: 'justify-content:center;gap:16px;flex-wrap:wrap;margin-bottom:6px' },
          ...revealState.entries.map((e) =>
            el('span', { class: 'hint', style: `color:${e.color}` }, `${e.name} · ${e.pos}/${store.distance}`),
          ),
        ),
        sharedTrackGrid(revealState.board, revealState.entries),
        ...revealState.entries.flatMap((e) => e.revealed.map((text) => el('p', { class: 'hint' }, `${e.name}: ${text}`))),
      ),
    );
  }

  function stepRevealWalk(): void {
    if (disposed || !revealState) return;
    for (const e of revealState.entries) {
      if (e.cp >= e.checkpoints.length) continue;
      const target = e.checkpoints[e.cp];
      if (e.pos !== target) {
        e.pos += e.pos < target ? 1 : -1;
        sfx.play('trackStep');
      } else {
        if (e.cp > 0) {
          e.revealed.push(e.outcomes[e.cp - 1].text);
          sfx.play('trackReveal');
        }
        e.cp++;
      }
    }
    renderRevealWalk();
    const allDone = revealState.entries.every((e) => e.cp >= e.checkpoints.length);
    if (!allDone) setTimeout(stepRevealWalk, 180);
    else setTimeout(finishReveal, 800);
  }

  function finishReveal(): void {
    revealState = null;
    renderBoard();
  }

  // --------------------------------------------------------- board screen --

  /** The turn-state banner (whose turn it is, autopilot racing, or "round
   *  submitted") — bare content, no wrapper of its own, so it sits as the
   *  first thing inside `announcementBoard()`'s single card instead of
   *  floating above it as its own separate box. `null` while there's
   *  nothing to announce (no round yet, or round already resolved). */
  function turnStatus(): HTMLElement | null {
    const round = store.round;
    if (!round || round.phase !== 'playing') return null;
    if (mode === 'auto' && arena) {
      return el(
        'div',
        { style: 'text-align:center' },
        el('div', { class: 'title', style: 'color:#4de2ff;justify-content:center' }, '🤖 Autopilot racing…'),
        el('p', { class: 'hint' }, `♥${arena.lives} · ${Math.ceil(clock)}s left`),
        button('🕹️ Take over', takeOver, 'btn small primary'),
        el('hr', { style: 'border-color:#2a3a4a;margin:10px 0' }),
        spectatorPanel(),
      );
    }
    if (round.round === playedRound) {
      if (canWatch()) return spectatorPanel();
      return el('p', { class: 'hint', style: 'color:#ffd24d;text-align:center' }, 'Round submitted — waiting on the other teams…');
    }
    const pilot = pendingPilot();
    if (!pilot) return null;
    return el(
      'div',
      { style: 'text-align:center' },
      el('div', { class: 'title', style: 'color:#3ddc84;justify-content:center' }, 'Your turn!'),
      el('p', { class: 'hint' }, 'Play it yourself, or let it play itself.'),
      el(
        'div',
        { class: 'row', style: 'gap:8px;justify-content:center;margin-top:8px' },
        button('▶️ Play', () => startPiloting(false), 'btn primary'),
        button('🤖 Autopilot', () => startPiloting(true), 'btn ghost'),
      ),
    );
  }

  /** Moves `focusRacerId` to the next/previous rival, wrapping around — the
   *  only way to aim a rival-target shop purchase, since `spectatorPanel()`
   *  doesn't offer a separate targeting step. */
  function cyclePreview(delta: number): void {
    const list = rivals();
    if (!list.length) return;
    const idx = focusRacerId ? list.findIndex((r) => r.id === focusRacerId) : -1;
    focusRacerId = list[(idx < 0 ? 0 : idx + delta + list.length) % list.length].id;
    renderBoard();
  }

  /** Shown instead of a plain "waiting"/"autopilot racing" text whenever
   *  there's nothing else to do but watch (`canWatch()`) — a live mirror of
   *  whoever `focusRacerId` points at, cycled with the ◀/▶ buttons or the
   *  `↑`/`↓` keys (`update()`). Only the round's first three finishers
   *  (`canSpectate()`) can also spend shop credits on whoever's on screen
   *  here — everyone else just watches, same panel either way. */
  function spectatorPanel(): HTMLElement {
    const list = rivals();
    if (!list.length) return el('p', { class: 'hint' }, 'No other teams to watch yet.');
    if (!focusRacerId || !list.some((r) => r.id === focusRacerId)) focusRacerId = list[0].id;
    const watched = store.roster.find((r) => r.id === focusRacerId);
    const canStrike = canSpectate();
    // The mirror box on the left only ever shows the *picture* — same as
    // "🤖 Autopilot racing…" needs its own "♥N · Xs left" line since the
    // canvas alone doesn't say it, watching a rival needs the same readout,
    // sourced from their own snapshot instead of a local `clock`/`arena`.
    const snap = focusRacerId ? previewMirrors.get(focusRacerId)?.current : undefined;
    return el(
      'div',
      { style: 'text-align:center' },
      el(
        'div',
        { class: 'title', style: `color:${canStrike ? '#ff5fa2' : '#8ef0ff'};justify-content:center` },
        canStrike ? '🏆 You cleared — watch & strike' : '👀 Watching',
      ),
      el(
        'p',
        { class: 'hint' },
        canStrike ? "Their field is on the left — rival-target items in the shop below hit them." : 'Their field is on the left.',
      ),
      el(
        'div',
        { class: 'row', style: 'justify-content:center;align-items:center;gap:10px;margin-top:8px' },
        list.length > 1 ? button('◀', () => cyclePreview(-1), 'btn small ghost') : null,
        watched ? el('span', { style: `color:${watched.color};font-weight:800` }, watched.name) : null,
        list.length > 1 ? button('▶', () => cyclePreview(1), 'btn small ghost') : null,
      ),
      list.length > 1 ? el('p', { class: 'hint', style: 'margin-top:2px' }, '↑/↓ also cycles') : null,
      el(
        'p',
        { class: 'hint', style: 'margin-top:6px' },
        snap ? `♥${snap.lives} · ${Math.ceil(snap.clock)}s left` : 'Waiting for their field…',
      ),
    );
  }

  /** Real-time alliances (`core/teamRace.ts`'s `allied`/`ALLIANCE_MAX`,
   *  ported from the original hot-seat race mode's "union") — always shown,
   *  not gated to a setup phase, since players form and break these mid-
   *  match. A loner sees every other loner as a fresh union to start, and
   *  every alliance under `ALLIANCE_MAX` as a union to join; an allied
   *  player just sees who they're with and a way out. */
  function alliancePanel(): HTMLElement {
    const team = myTeam();
    if (!team) return el('div');
    const others = rivals()
      .map((r) => store.team(r.id))
      .filter((t): t is TeamRacer => !!t);

    if (team.allianceId !== null) {
      const mates = others.filter((t) => allied(team, t));
      return el(
        'div',
        { class: 'card', style: 'margin-top:10px' },
        el('div', { class: 'title' }, `🤝 Alliance ${['A', 'B', 'C'][team.allianceId]}`),
        el('p', { class: 'hint' }, mates.length ? `With: ${mates.map((m) => m.name).join(', ')}` : 'Alone in it for now.'),
        button('✂️ Leave alliance', () => store.net.leaveAlliance(), 'btn small ghost'),
      );
    }

    const alliances = new Map<number, TeamRacer[]>();
    const loners: TeamRacer[] = [];
    for (const t of others) {
      if (t.allianceId === null) loners.push(t);
      else {
        if (!alliances.has(t.allianceId)) alliances.set(t.allianceId, []);
        alliances.get(t.allianceId)!.push(t);
      }
    }
    const joinButtons = [
      ...loners.map((t) => button(`🤝 Union with ${t.name}`, () => store.net.joinAlliance(t.id), 'btn small ghost')),
      ...[...alliances.entries()]
        .filter(([, members]) => members.length < ALLIANCE_MAX)
        .map(([id, members]) =>
          button(
            `🤝 Join ${['A', 'B', 'C'][id]} (${members.map((m) => m.name).join('+')})`,
            () => store.net.joinAlliance(members[0].id),
            'btn small ghost',
          ),
        ),
    ];
    return el(
      'div',
      { class: 'card', style: 'margin-top:10px' },
      el('div', { class: 'title' }, '🤝 Alliances'),
      joinButtons.length
        ? el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ...joinButtons)
        : el('p', { class: 'hint' }, 'Nobody to ally with yet.'),
    );
  }

  /** A rival-type item always needs an explicit, non-ally live target (the
   *  spectate window, `canSpectate()`); a self-type item defaults to the
   *  buyer, but while `giftToAlly` is toggled on and the current spectate
   *  target is an ally, it's sent to them instead — same live-target window,
   *  just the opposite alliance check. */
  function buy(item: ShopItem): void {
    const team = myTeam();
    if (!team || !canAfford(team.credits, item)) return;
    if (item.target === 'self' && !giftToAlly) {
      if (!roundIsOpen()) return;
      store.net.purchase(item.id);
      return;
    }
    if (!canSpectate()) return;
    const targetId = focusRacerId ?? rivals()[0]?.id;
    const target = targetId ? store.team(targetId) : undefined;
    if (!targetId || !target) return;
    const isAlly = allied(team, target);
    if (item.target === 'rival' && isAlly) return; // can't sabotage an ally
    if (item.target === 'self' && !isAlly) return; // gifting only reaches an ally
    store.net.purchase(item.id, targetId);
  }

  function shopPanel(): HTMLElement {
    const team = myTeam();
    const focusTeam = focusRacerId ? store.team(focusRacerId) : undefined;
    const isAllyFocused = !!(team && focusTeam && allied(team, focusTeam));
    // Cycling away from the ally you toggled gifting on for shouldn't strand
    // self-items permanently blocked with no visible way back to "for me".
    if (giftToAlly && !isAllyFocused) giftToAlly = false;
    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'title' }, `🛒 Shop · ${team?.credits ?? 0} credits`),
      isAllyFocused
        ? el(
            'div',
            { class: 'row', style: 'gap:6px;align-items:center;margin:4px 0' },
            el('span', { class: 'hint' }, 'Self-boosts:'),
            button(
              giftToAlly ? `🎁 → ${focusTeam!.name}` : '🙋 For me',
              () => {
                giftToAlly = !giftToAlly;
                renderBoard();
              },
              'btn small ghost',
            ),
          )
        : null,
      el(
        'div',
        { class: 'grid c3', style: 'margin-top:8px' },
        ...SHOP_LIST.map((item) => {
          const affordable = !!team && canAfford(team.credits, item);
          const open =
            item.target === 'self' && !giftToAlly
              ? roundIsOpen()
              : canSpectate() && isAllyFocused === (item.target === 'self');
          return button(`${item.icon} ${item.name} · ${item.cost}`, () => buy(item), `btn small${affordable && open ? '' : ' ghost'}`);
        }),
      ),
    );
  }

  /** Which category the round-winner has drilled into while picking the next
   *  card — `null` shows the 3 category buttons instead. Reset once a pick
   *  actually lands (that closes this whole branch until the next round has
   *  a winner again). */
  let pickCategoryId: string | null = null;

  /** Whoever's pilot cleared first last round gets to pick the next jeopardy
   *  card — three category buttons, then that category's still-open
   *  numbers — replacing the old always-visible reference grid every team
   *  could "use" even though only the host could actually reveal anything.
   *  Everyone else just watches for the announcement of who's picking; round
   *  1 (nobody's won yet) has no question at all until the first clear
   *  happens anywhere. Only `isJudgeFreeCard` cards are offered — the same
   *  restriction the auto-host used to apply to its own random pick, now
   *  enforced here instead so an auto-hosted match can never get stuck on a
   *  card nobody can judge. Picking a `boost` card banks it into this
   *  team's own stash (`store.net.bankCard`) instead of putting it up as a
   *  question — see the end-of-race salvo. */
  function pickerPanel(): HTMLElement[] {
    const winnerId = store.lastRoundWinnerId;
    if (!winnerId) {
      return [el('p', { class: 'hint' }, "Finish a level first — whoever clears it wins the right to pick the next question.")];
    }
    if (winnerId !== opts.teamId) {
      const winner = store.roster.find((r) => r.id === winnerId);
      return [el('p', { class: 'hint', style: `color:${winner?.color ?? '#ffd24d'}` }, `🏆 ${winner?.name ?? 'A team'} is picking a question…`)];
    }
    if (!jeopardy) return [el('p', { class: 'hint' }, 'No content loaded yet.')];
    const grid = jeopardyGrid(jeopardy)
      .map((section) => ({ ...section, cards: section.cards.filter((c) => !store.usedCards.has(c.id) && isJudgeFreeCard(c)) }))
      .filter((section) => section.cards.length > 0);

    const section = pickCategoryId ? grid.find((s) => s.category.id === pickCategoryId) : undefined;
    if (!section) {
      pickCategoryId = null;
      return [
        el('p', { class: 'hint', style: 'color:#3ddc84' }, '🏆 You cleared first — pick a category:'),
        el(
          'div',
          { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:6px' },
          ...grid.map((s) =>
            button(
              `${s.category.emoji} ${s.category.label}`,
              () => {
                pickCategoryId = s.category.id;
                renderBoard();
              },
              'btn small primary',
            ),
          ),
        ),
      ];
    }
    return [
      el(
        'div',
        { class: 'row', style: 'justify-content:space-between;align-items:center' },
        el('p', { class: 'hint', style: `color:${section.category.color}` }, `${section.category.emoji} ${section.category.label} — pick a question:`),
        button(
          '← Back',
          () => {
            pickCategoryId = null;
            renderBoard();
          },
          'btn small ghost',
        ),
      ),
      el(
        'div',
        { class: 'row', style: 'gap:4px;flex-wrap:wrap;margin-top:6px' },
        ...section.cards.map((card) =>
          button(
            String(card.value),
            () => {
              pickCategoryId = null;
              // A `boost` card banks straight into this team's own stash for
              // the end-of-race salvo, instead of going up as a question for
              // everyone to answer — it's not one.
              if (card.type === 'boost' && card.boostCardId) store.net.bankCard(card.id, card.boostCardId);
              else store.net.revealCard(card.id);
            },
            'btn small',
          ),
        ),
      ),
    ];
  }

  /** The announcement board — the one place every round-level event lives:
   *  whose turn it is / autopilot racing / round submitted (`turnStatus()`,
   *  used to be its own floating box above everything else), the open
   *  question with its answer choices merged into the same box
   *  (`answerSection()`), the category reference grid between cards, and a
   *  short feed of what just happened (used to be a separate `logPanel()`
   *  card at the bottom of the whole screen). Purchases are filtered out of
   *  the feed here — noisy and not really an "announcement" — while the
   *  host's own log (`teamQuizAdmin.ts`) still shows them via the same
   *  underlying `store.log`. */
  function announcementBoard(): HTMLElement {
    const active = jeopardy ? activeCardId() : null;
    const activeCard = active ? jeopardy!.cards.find((c) => c.id === active) : null;
    const activeCategory = activeCard ? jeopardy!.categories.find((c) => c.id === activeCard.categoryId) : null;
    // Read *before* this render's card decides whether to play the "pop" —
    // then updated, so the very next render (even a few hundred ms later,
    // from a watchdog) recognizes this same card and skips the animation.
    const cardAlreadyShown = !!activeCard && activeCardAnimKey === activeCard.id;
    activeCardAnimKey = activeCard?.id ?? null;
    const feed = store.log.filter((line) => line.kind !== 'purchase').slice(0, 6);
    // `renderBoard()` rebuilds this whole tree from scratch on every single
    // interaction (toggling an answer choice, cycling the preview, a new
    // log line arriving) — a fresh `.board-scroll` div defaults to
    // `scrollTop: 0`, so without this every one of those clicks snapped the
    // board back to the top if you'd scrolled down to see the choices or
    // the "Send" button. Restored once the new node is actually in the
    // document (`queueMicrotask`, same pattern the free-text answer input
    // uses to focus itself) rather than immediately, since `scrollTop` on a
    // detached node has nothing to scroll yet.
    const scroll = el(
      'div',
      { class: 'board-scroll', onscroll: (e) => (boardScrollTop = (e.target as HTMLElement).scrollTop) },
      turnStatus(),
        !jeopardy
          ? el('p', { class: 'hint' }, 'No content loaded yet.')
          : activeCard
            ? el(
                'div',
                { style: 'margin-top:8px' },
                el(
                  'div',
                  {
                    class: `race-effect${cardAlreadyShown ? ' no-anim' : ''}`,
                    style: `--cell:${activeCategory?.color ?? '#ffd24d'}`,
                  },
                  el('div', { class: 'glyph' }, activeCategory?.emoji ?? '❓'),
                  el(
                    'div',
                    {},
                    el('h4', {}, `${JEOPARDY_TYPE_ICON[activeCard.type]} ${activeCard.title} · ${activeCard.value}`),
                    el('div', { class: 'what' }, activeCard.prompt),
                  ),
                ),
                ...(answerSection(activeCard) ?? []),
              )
            : el('div', { style: 'margin-top:8px' }, ...pickerPanel()),
        feed.length
          ? el(
              'div',
              { class: 'commentary', style: 'margin-top:10px' },
              ...feed.map((line) => el('p', { style: `color:${line.color}` }, line.text)),
            )
          : null,
    );
    queueMicrotask(() => (scroll.scrollTop = boardScrollTop));
    return el('div', { class: 'card announce' }, el('div', { class: 'title' }, '📢 Announcement board'), scroll);
  }

  function submitAnswer(): void {
    const text = answerDraft.trim();
    if (!text) return;
    store.net.submitAnswer(text);
    submittedAnswerText = text;
    answerDraft = '';
    renderBoard();
  }

  function toggleChoice(cardId: string, optionId: string): void {
    choiceCardId = cardId;
    if (selectedChoiceIds.has(optionId)) selectedChoiceIds.delete(optionId);
    else selectedChoiceIds.add(optionId);
    renderBoard();
  }

  function submitChoice(card: NonNullable<JeopardyData['cards'][number]>): void {
    if (selectedChoiceIds.size === 0) return;
    store.net.submitAnswer(choiceAnswerText(card, selectedChoiceIds));
    renderBoard();
  }

  /** "Не надо аплаить вопрос — вопросы всех игроков аплаятся автоматом по
   *  истечению времени": no "Send" click required any more. Whatever's
   *  selected/typed the instant the answer window actually closes
   *  (`answerWindowOpen()` moves off `'open'`) gets submitted as-is — never
   *  having picked or typed anything just stays unanswered, same as before,
   *  only the *confirm* step is gone. Called from `sync()`, which re-checks
   *  on every store event, so it catches the window closing the moment the
   *  round resolves (or this team's own loss closes it early). */
  function autoSubmitIfNeeded(): void {
    if (!jeopardy || store.submittedAnswers.has(opts.teamId)) return;
    if (answerWindowOpen() === 'open') return;
    const activeId = activeCardId();
    const activeCard = activeId ? jeopardy.cards.find((c) => c.id === activeId) : null;
    if (!activeCard || activeCard.type === 'boost') return;
    if (activeCard.type === 'choice') {
      if (selectedChoiceIds.size > 0) submitChoice(activeCard);
    } else if (answerDraft.trim()) {
      submitAnswer();
    }
  }

  /** How well *this* team's own pilot did this round decides whether it can
   *  answer at all, always — not just in bigger rooms: a team whose pilot
   *  didn't clear loses the ability to answer right away, instead of
   *  getting to keep trying until every other team finishes ("если уровень
   *  не успел доиграть, то не успел ответить на вопрос"), while a team that
   *  actually cleared keeps answering for `WINNER_GRACE_SECONDS` past the
   *  round resolving, as a reward for winning rather than just for being on
   *  a team that finishes. */
  function answerWindowOpen(): 'open' | 'closed-lost' | 'closed-round' {
    const round = store.round;
    if (!round) return 'closed-round';
    const myLastResult = lastResult && playedRound === round.round ? lastResult : null;

    if (round.phase === 'playing') {
      return myLastResult && !myLastResult.cleared ? 'closed-lost' : 'open';
    }
    if (round.phase === 'resolved' && myLastResult?.cleared) {
      return resolvedGrace <= WINNER_GRACE_SECONDS ? 'open' : 'closed-round';
    }
    return 'closed-round';
  }

  /** Only meaningful while a round is actually in progress — the answer is
   *  to whatever's up on the broadcast screen while the pilots race. A
   *  `choice` card swaps the free-text input for its own option buttons —
   *  one or several can be right, so picking toggles buttons and a separate
   *  submit sends the joined pick as free text (`choiceAnswerText`), so the
   *  host's reveal needs no special case.
   *
   *  Millionaire-style lock-and-reveal: once sent, the pick is final — no
   *  more toggling — and stays exactly as-is on screen (never swapped for a
   *  text summary) until the host reveals, at which point the same buttons
   *  recolor green/red in place. `selectedChoiceIds` is kept around locally
   *  (not re-derived from the wire text) purely so this same tab can still
   *  tell which options *this* team picked once the reveal arrives. */
  /** The answer half of `announcementBoard()`'s single card — bare content
   *  (a divider plus whatever's relevant), no `.card` wrapper of its own,
   *  so it renders directly under the question inside the same box instead
   *  of as a second, separate card underneath it. `null` when there's
   *  nothing to add (a `boost` card, or the round window flatly closed). */
  function answerSection(activeCard: NonNullable<JeopardyData['cards'][number]> | null): HTMLElement[] | null {
    const windowState = answerWindowOpen();
    if (windowState === 'closed-lost') {
      return [
        el('hr', { style: 'border-color:#ff4d6d44;margin:10px 0' }),
        el('div', { class: 'title', style: 'color:#ff4d6d' }, '✏️ Answering closed'),
        el('p', { class: 'hint' }, "Your pilot didn't clear the level — no more answers this round."),
      ];
    }
    if (windowState === 'closed-round') return null;
    if (activeCard?.type === 'boost') return null; // the host sends it straight to a team, nothing to answer
    if (!activeCard) return null;
    const already = store.submittedAnswers.has(opts.teamId);
    const revealed = store.revealedAnswers;

    if (activeCard.id !== choiceCardId) {
      choiceCardId = activeCard.id;
      selectedChoiceIds = new Set();
    }

    if (activeCard.type === 'choice' && activeCard.choices) {
      const correctIds = activeCard.correctChoiceIds ?? [];
      const nodes: (HTMLElement | null)[] = [
        el('hr', { style: 'border-color:#2a3a4a;margin:10px 0' }),
        el('div', { class: 'title' }, '✏️ Pick an answer'),
        !already ? el('p', { class: 'hint', style: 'margin:2px 0 6px' }, 'You can pick more than one.') : null,
        already && !revealed ? el('p', { class: 'hint', style: 'color:#3ddc84' }, 'Locked in ✓ — waiting for the reveal.') : null,
        el(
          'div',
          { class: 'col', style: 'gap:6px;margin-top:6px' },
          ...activeCard.choices.map((o) => {
            const isPicked = selectedChoiceIds.has(o.id);
            const isCorrect = revealed ? correctIds.includes(o.id) : false;
            const cls = revealed
              ? `answer-chip${isCorrect ? ' correct' : isPicked ? ' wrong' : ''}${isPicked ? ' picked' : ''}`
              : `btn small${isPicked ? ' primary' : ' ghost'}`;
            if (revealed) return el('span', { class: cls }, o.text);
            return button(o.text, already ? () => {} : () => toggleChoice(activeCard.id, o.id), cls);
          }),
        ),
        !already ? button('Send', () => submitChoice(activeCard), `btn small${selectedChoiceIds.size ? ' primary' : ' ghost'}`) : null,
      ];
      return nodes.filter((n): n is HTMLElement => n !== null);
    }

    if (already) {
      return [
        el('hr', { style: 'border-color:#2a3a4a;margin:10px 0' }),
        el('div', { class: 'title' }, '✏️ Your answer'),
        el('p', { class: 'hint', style: 'color:#3ddc84' }, 'Locked in ✓ — waiting for the reveal.'),
        el('p', {}, submittedAnswerText),
      ];
    }

    const input = el('input', {
      placeholder: 'Your answer...',
      value: answerDraft,
      oninput: (e) => (answerDraft = (e.target as HTMLInputElement).value),
      onkeydown: (e) => {
        if ((e as KeyboardEvent).key === 'Enter') submitAnswer();
      },
    });
    queueMicrotask(() => input.focus());
    return [
      el('hr', { style: 'border-color:#2a3a4a;margin:10px 0' }),
      el('div', { class: 'title' }, '✏️ Your answer'),
      el('div', { class: 'row', style: 'gap:6px;margin-top:6px' }, input, button('Send', submitAnswer, 'btn small primary')),
    ];
  }

  function submitQuestion(): void {
    const text = questionDraft.trim();
    if (!text) return;
    store.net.submitQuestion(text);
    questionDraft = '';
    renderBoard();
  }

  function questionPanel(): HTMLElement {
    const input = el('input', {
      placeholder: 'Write a question for a rival...',
      value: questionDraft,
      oninput: (e) => (questionDraft = (e.target as HTMLInputElement).value),
      onkeydown: (e) => {
        if ((e as KeyboardEvent).key === 'Enter') submitQuestion();
      },
    });
    return el(
      'div',
      { class: 'card', style: 'margin-top:10px' },
      el('div', { class: 'title' }, '✍️ Send the host a question'),
      el('p', { class: 'hint', style: 'margin:2px 0 6px' }, 'The host decides when and to whom to show it.'),
      el('div', { class: 'row', style: 'gap:6px' }, input, button('Send', submitQuestion, 'btn small ghost')),
    );
  }

  function statsRow(): HTMLElement {
    const team = myTeam();
    return el(
      'div',
      { class: 'race-facts' },
      fact(`${team?.cell ?? 0}`, `of ${store.distance} cells`, team?.color),
      fact(`♥ ${team?.lives ?? 0}`, 'lives', '#ff5fa2'),
      fact(`${team?.credits ?? 0}`, 'credits', '#ffd24d'),
      fact(`${team?.score ?? 0}`, 'round points', '#3ddc84'),
    );
  }

  function fact(value: string, caption: string, color?: string): HTMLElement {
    return el('div', {}, el('b', color ? { style: `color:${color}` } : {}, value), el('span', {}, caption));
  }

  function renderBoard(): void {
    const team = myTeam();
    app.overlay.classList.add('interactive');
    // `.screen` (`ui/styles.css`) is itself a scrollable box (`max-height:
    // 94vh; overflow: auto`) whenever the page is taller than the viewport
    // — and this whole function replaces it with a brand new node on every
    // single click, board-wide, not just inside the announcement board.
    // Without restoring its own scroll the same way `announcementBoard()`
    // restores `.board-scroll`'s, *any* button anywhere on this screen
    // (shop, category pick, menu) snapped the whole page back to the top.
    const screen = el(
      'div',
      { class: 'screen', onscroll: (e) => (pageScrollTop = (e.target as HTMLElement).scrollTop) },
      el('h2', { class: 'race-headline', style: `color:${team?.color ?? '#4de2ff'}` }, team ? team.name : 'Team Quiz'),
      !store.round ? el('p', { class: 'hint' }, 'Waiting for the host to start the match…') : null,
      statsRow(),
      el(
        'div',
        { class: 'row', style: 'gap:16px;align-items:flex-start;margin-top:12px' },
        mirrorCanvas,
        el(
          'div',
          { style: 'flex:1;min-width:260px' },
          shopPanel(),
          alliancePanel(),
          el('div', { style: 'margin-top:10px' }, announcementBoard()),
          questionPanel(),
        ),
      ),
      el('div', { class: 'row', style: 'margin-top:16px' }, button('Menu', leaveToMenu, 'btn ghost')),
    );
    app.overlay.replaceChildren(screen);
    queueMicrotask(() => (screen.scrollTop = pageScrollTop));
  }

  function renderOver(): void {
    const champ = store.championId ? store.team(store.championId) : undefined;
    const finisher = store.matchOverTeamId ? store.team(store.matchOverTeamId) : undefined;
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(
      el(
        'div',
        { class: 'screen narrow' },
        el('h2', { style: `color:${champ?.color ?? '#ffd24d'}` }, champ ? `🏆 CHAMPION: ${champ.name} — ${finalScore(champ)} pts` : 'Match over'),
        champ && finisher && champ.id !== finisher.id
          ? el('p', { class: 'hint' }, `🏁 First to finish: ${finisher.name}`)
          : null,
        store.matchAwardLines.length
          ? el(
              'div',
              { class: 'col', style: 'gap:6px;margin-top:14px;text-align:left' },
              ...store.matchAwardLines.map((a) => el('p', {}, el('b', { style: `color:${a.color}` }, `${a.name}: `), a.text)),
            )
          : null,
        el('div', { class: 'row', style: 'margin-top:18px' }, button('Menu', leaveToMenu, 'btn primary')),
      ),
    );
  }

  function leaveToMenu(): void {
    unsubscribe();
    unsubscribeSnapshot();
    unsubscribeEffect();
    store.dispose();
    app.setScene(mainMenu);
  }

  // --------------------------------------------------------- pilot mode ----

  function clampPointer(x: number | null): number | null {
    if (x === null) return null;
    return x < -60 || x > ARENA_W + 60 ? null : x;
  }

  function startPiloting(auto: boolean): void {
    const team = myTeam();
    const round = store.round;
    if (!team || !round) return;
    playedRound = round.round;
    mode = auto ? 'auto' : 'pilot';

    const boss = isFinale(team, store.distance);
    const total = opts.levels.length || 1;
    const levelIdx = levelForCell(team.cell, store.distance, total, store.seed);
    const level = opts.levels[levelIdx] ?? opts.levels[0];

    clockLimit = Math.max(20, roundSecondsFor(boss) + team.bonusSeconds);
    clock = clockLimit;
    livesAtStart = livesForRound(team, boss);
    team.bonusSeconds = 0;
    bestCombo = 0;

    arena = new Arena({ level, superId: opts.superId, mode: 'race', lives: livesAtStart });
    arena.equipSkills(app.profile.skills);
    if (team.chargedSuper) {
      team.chargedSuper = false;
      arena.energy = ENERGY_MAX;
    }
    if (team.springDebt) {
      team.springDebt = false;
      const def = DEBUFF_LIST[Math.floor(Math.random() * DEBUFF_LIST.length)];
      arena.applyDebuff(def.id);
    }
    fx = new ArenaFx();
    snapTimer = 0;
    cellsTimer = 0;
    lastCells = '';
    snapSeq = -1;

    if (auto) {
      // Board DOM stays exactly as it is — shop/trivia/answer panels keep
      // working, the level just races itself in the mirror canvas below.
      renderBoard();
      startAutoWatchdog();
    } else {
      stopAutoWatchdog();
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
      app.capturePointer();
    }
    music.setScene('versus');
    sfx.play('ui');
  }

  /** Hands the paddle from the bot to whoever's holding the device, mid-race
   *  — same arena, same lives, same clock, just a different input source
   *  from the next tick on (`update()` already re-reads `mode` every frame).
   *  Exactly the DOM/pointer teardown `startPiloting(false)` does, without
   *  touching any of the race state a fresh `startPiloting` call would
   *  otherwise reset. */
  function takeOver(): void {
    if (mode !== 'auto' || !arena) return;
    mode = 'pilot';
    stopAutoWatchdog();
    app.overlay.replaceChildren();
    app.overlay.classList.remove('interactive');
    app.capturePointer();
    sfx.play('ui');
  }

  /** The reverse of `takeOver()` — hands the paddle back to the bot mid-race
   *  (`KeyB` while piloting, see `update()`), same arena/lives/clock, just
   *  switching the input source. `renderBoard()` both redraws the board's
   *  DOM (shop, announcement board) and — via `app.ts`'s `initCursor()`
   *  `MutationObserver` watching `overlay`'s `interactive` class — releases
   *  the pointer lock automatically, exactly the way `endLevel()`'s own
   *  `renderBoard()` call already does when a level ends. */
  function handBackToAuto(): void {
    if (mode !== 'pilot' || !arena) return;
    mode = 'auto';
    startAutoWatchdog();
    renderBoard();
    sfx.play('ui');
  }

  function endLevel(cleared: boolean, died: boolean): void {
    if (!arena) return;
    const team = myTeam();
    const result: TurnResult = {
      cleared,
      died,
      timeLeft: Math.max(0, clock),
      timeLimit: clockLimit,
      livesLost: Math.max(0, livesAtStart - arena.lives),
      bestCombo,
      bricks: arena.bricksBroken,
      boss: arena.level.boss !== undefined && arena.level.boss !== null,
    };
    if (team) team.lives = Math.max(0, arena.lives - (result.boss ? TEAM_BOSS_LIVES_BONUS : 0));
    app.saveProfile((prof) => (prof.totalXp += Math.round(arena!.xpEarned)));
    const finale = team ? isFinale(team, store.distance) : false;
    lastResult = result;
    resolvedGrace = 0;

    arena = null;
    mode = 'board';
    stopAutoWatchdog();
    music.setScene('menu');
    store.net.reportResult(result);
    if (finale && cleared) store.net.reportOver();
    // A loss closes this team's own answer window right away
    // (`answerWindowOpen()`'s `'closed-lost'`) — don't wait for the next
    // unrelated store event to notice and lock in whatever was picked.
    autoSubmitIfNeeded();
    renderBoard();
  }

  function makeSnapshot(a: Arena, withCells: boolean): RaceSnapshot {
    let cells = '';
    if (withCells) {
      for (let r = 0; r < a.grid.length / a.cols; r++) {
        for (let c = 0; c < a.cols; c++) {
          const b = a.grid[r * a.cols + c];
          cells += b && b.alive ? b.kind.code : '0';
        }
      }
    }
    const changed = withCells && cells !== lastCells;
    if (changed) lastCells = cells;
    return {
      cells: changed ? cells : undefined,
      cols: a.cols,
      paddleX: Math.round(a.paddleX),
      paddleW: Math.round(a.paddleW),
      balls: a.balls.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })),
      score: a.score,
      lives: a.lives,
      xpLevel: a.xpLevel,
      combo: a.combo,
      energy: Math.round(a.energy),
      n: ++snapSeq,
      clock: Math.max(0, Math.round(clock)),
    };
  }

  /** Draws whichever picture belongs in the one shared `mirrorCanvas` this
   *  tick: a chosen rival's live feed takes priority whenever watching is
   *  actually allowed (`canWatch()` — this device has nothing else to do
   *  but watch) and a target is picked, otherwise this device's own bot
   *  while it's racing, otherwise the idle "waiting for the pilot" view.
   *  Called both from `stepArena()` (while `mode === 'auto'`, so choosing
   *  someone to watch replaces the self-view instead of racing alongside
   *  it) and from `update()`'s `'board'` branch. */
  function drawMirror(dt: number): void {
    const watching = canWatch() && focusRacerId ? previewMirrors.get(focusRacerId) : undefined;
    if (watching) {
      watching.tick(dt);
      const watched = store.roster.find((r) => r.id === focusRacerId);
      drawSnapshotMirror(mirrorCtx, watching, watched?.color ?? '#ff5fa2', "Waiting for their field…");
    } else if (mode === 'auto' && arena) {
      drawArena(mirrorCtx, arena, fx, t, true);
    } else {
      mirror.tick(dt);
      const team = myTeam();
      drawSnapshotMirror(mirrorCtx, mirror, team?.color ?? '#4de2ff', "Waiting for the pilot's field…");
    }
  }

  /** One tick of live piloting, for whichever clock is currently driving it
   *  (`update(dt)`'s own rAF while `mode` might be `'pilot'` or `'auto'`, or
   *  `autoWatchdog`'s `setInterval` catching a backgrounded `'auto'` tab
   *  back up) — shared so both paths step the exact same way instead of two
   *  copies drifting apart. */
  function stepArena(dt: number): void {
    t += dt;
    fx.update(dt);
    if (!arena) return;

    let input: ArenaInput;
    if (mode === 'auto') {
      input = arena.state === 'cleared' ? noInput() : bot.think(arena, dt);
    } else {
      const pointer = app.pointer;
      const arenaX = pointer && layout.scale > 0 ? (pointer.x - layout.ox) / layout.scale : null;
      input = arena.state === 'cleared' ? noInput() : app.input.read(SOLO_KEYS, clampPointer(arenaX));
    }

    stepper.step(dt, (sdt, first) => arena!.update(sdt, edgeOnce(input, first)));
    clock = Math.max(0, clock - dt);
    bestCombo = Math.max(bestCombo, arena.combo);

    const events = arena.drainEvents();
    fx.consume(events);
    sfx.consume(events, arena.combo);

    if (mode === 'auto') drawMirror(dt);
    // Always broadcast a snapshot, in *both* modes — a top-3 spectator on
    // another device (`teamQuizDevice.ts`'s `spectatorPanel()`) needs to see
    // an autopiloting rival's live field too, not just a manually-piloted
    // one. This used to be `pilot`-only on the assumption that nobody else
    // would ever want to watch an auto-racing team; the spectate feature
    // means that assumption no longer holds.
    snapTimer += dt;
    cellsTimer += dt;
    if (snapTimer >= RACE_SNAPSHOT_INTERVAL) {
      snapTimer = 0;
      const withCells = cellsTimer >= RACE_CELLS_INTERVAL || lastCells === '';
      if (withCells) cellsTimer = 0;
      store.net.sendSnapshot(makeSnapshot(arena, withCells));
    }

    if (arena.state === 'cleared') endLevel(true, false);
    else if (arena.state === 'dead') endLevel(false, true);
    else if (clock <= 0) endLevel(false, false);
  }

  function startAutoWatchdog(): void {
    stopAutoWatchdog();
    lastAutoTickAt = performance.now();
    autoWatchdog = window.setInterval(() => {
      if (mode !== 'auto' || !arena) return;
      // `setInterval` (unlike `requestAnimationFrame`, which fully pauses
      // on a backgrounded tab) keeps firing regardless of focus — the only
      // reason the "♥N · Xs left" line in `turnStatus()` ever refreshes at
      // all while racing, since `renderBoard()` is otherwise only called
      // once, right when autopilot starts.
      renderBoard();
      const now = performance.now();
      const staleFor = (now - lastAutoTickAt) / 1000;
      if (staleFor < 0.5) return;
      lastAutoTickAt = now;
      stepArena(staleFor);
    }, 500);
  }

  function stopAutoWatchdog(): void {
    if (autoWatchdog !== null) {
      clearInterval(autoWatchdog);
      autoWatchdog = null;
    }
  }

  return {
    update(dt) {
      if (canWatch() && (app.input.wasPressed(['ArrowUp']) || app.input.wasPressed(['ArrowDown']))) {
        cyclePreview(app.input.wasPressed(['ArrowUp']) ? -1 : 1);
      }
      if (mode === 'pilot' || mode === 'auto') {
        if (mode === 'auto') lastAutoTickAt = performance.now();
        if (mode === 'pilot' && app.input.wasPressed(['KeyB'])) handBackToAuto();
        stepArena(dt);
      } else if (mode === 'board') {
        drawMirror(dt);

        if (store.round?.phase === 'resolved' && lastResult?.cleared) {
          const wasOpen = resolvedGrace <= WINNER_GRACE_SECONDS;
          resolvedGrace += dt;
          if (wasOpen && resolvedGrace > WINNER_GRACE_SECONDS) renderBoard();
        }
      }
    },

    draw(ctx, w, h) {
      if (mode !== 'pilot' || !arena) return;
      const team = myTeam();
      ctx.save();
      layout = fitBox(ctx, w, h, SCENE_W, SCENE_H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, ARENA_W, ARENA_H);
      ctx.clip();
      drawArena(ctx, arena, fx, t, !app.input.locked);
      ctx.restore();
      drawHud(ctx, arena, ARENA_W + GAP, 0, HUD_W, SCENE_H, {
        title: team?.name ?? 'PILOT',
        accent: team?.color ?? '#4de2ff',
        subtitle: `cell ${team?.cell ?? 0}/${store.distance} · credits ${team?.credits ?? 0}`,
        fps: app.fps,
        countdown: { label: 'time left', seconds: Math.max(0, Math.round(clock)) },
      });
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('[B] hand back to autopilot', ARENA_W + GAP + HUD_W / 2, SCENE_H - 12);
      ctx.restore();
      ctx.restore();
    },

    dispose() {
      disposed = true;
      stopAutoWatchdog();
      clearInterval(spectateWatchdog);
      unsubscribe();
      unsubscribeSnapshot();
      unsubscribeEffect();
      store.dispose();
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
