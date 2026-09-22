import { pickMatchAwards } from '../core/awards';
import { CARDS, type CardEffect, type CardId } from '../core/race';
import {
  buildSharedBoard,
  finalScore,
  makeTeam,
  RACE_WIN_BONUS,
  teamRoll,
  teamRoundRng,
  walkRoll,
  type Roll,
  type TeamCell,
  type TeamCellOutcome,
  type TeamRacer,
} from '../core/teamRace';
import { SHOP_ITEMS, type ShopItemId } from '../core/shop';
import type { TurnResult } from '../core/teamRace';
import type {
  BroadcastState,
  CurrentQuestion,
  SubmittedQuestion,
  TeamQuizRole,
  TeamQuizRosterTeam,
  TeamQuizRoundView,
} from '../net/teamQuizProtocol';
import type { RaceSnapshot } from '../net/raceProtocol';
import { net } from '../net/client';
import { TeamQuizNet } from './teamQuizNet';

/** Replays the referee's broadcast events into a local `TeamRacer[]`, exactly
 *  like the solo race's scene replays `roll`/`card` into its `players` array
 *  — every screen (admin, both team boards, both pilots, an optional public
 *  view) runs one of these off the same event stream and ends up with
 *  identical track position, lives, credits and score without the server
 *  ever holding or sending those numbers itself. */

export interface TeamQuizLogEntry {
  t: number;
  text: string;
  color: string;
  /** Tags a purchase line so a player-facing feed (the announcement board)
   *  can filter it out while the host's own log (`teamQuizAdmin.ts`) still
   *  shows everything — unset for every other kind of event. */
  kind?: 'purchase';
}

function fallbackResult(): TurnResult {
  return { cleared: false, died: true, timeLeft: 0, timeLimit: 0, livesLost: 0, bestCombo: 0, bricks: 0, boss: false };
}

export class TeamQuizStore {
  readonly net: TeamQuizNet;
  readonly role: TeamQuizRole;
  readonly myTeamId: string | null;

  seed = 0;
  distance = 50;
  roster: TeamQuizRosterTeam[] = [];
  teams = new Map<string, TeamRacer>();
  /** One board for the whole match — every team's token moves on the same
   *  track (`core/teamRace.ts`'s `buildSharedBoard`), so a cell any team
   *  reveals stays revealed for everyone, same array reference for all. */
  board: TeamCell[] = [];
  round: TeamQuizRoundView | null = null;
  usedCards = new Set<string>();
  revealedCards = new Set<string>();
  log: TeamQuizLogEntry[] = [];
  /** Set once the referee freezes the match after a finale clear. */
  matchOverTeamId: string | null = null;
  /** The team whose pilot cleared its level first in the most recently
   *  resolved round (the same team the `+1/−1` score bonus goes to) — `null`
   *  before any round has resolved, or if nobody cleared. Exposed publicly
   *  so a screen without a human host (`teamQuizAdmin.ts`'s auto-admin) can
   *  reward the actual round winner instead of picking a boost target at
   *  random. */
  lastRoundWinnerId: string | null = null;
  /** The first three teams to actually clear their level in the most
   *  recently resolved round, earliest first (`lastRoundWinnerId`, when set,
   *  is always `topFinishers[0]`) — the round-winner picks the next jeopardy
   *  card (`teamQuizDevice.ts`), and all three get the preview-scroller
   *  buff/debuff privilege once it exists. Empty before any round has
   *  resolved, or if nobody cleared. */
  topFinishers: string[] = [];
  /** Every team's roll this round, in the order each one reported — enough
   *  for a shared-map staged reveal (dice, then a cell-by-cell walk for
   *  every team on one track) to be built from, the same way `soloDuel.ts`
   *  captures its own single roll locally. Cleared on every new round. */
  roundReveal: { teamId: string; cellBefore: number; roll: Roll; outcomes: TeamCellOutcome[] }[] = [];

  /** What the projector screen is showing, as the host set it. */
  broadcastView: BroadcastState = { view: 'scoreboard', focusTeamId: null };
  /** The "Вопрос" view's content — a jeopardy card or a team-written one. */
  currentQuestion: CurrentQuestion | null = null;
  /** Teams that have submitted this round's free-text answer — text unknown
   *  until `revealedAnswers` is set. Cleared every new round. */
  submittedAnswers = new Set<string>();
  /** Set once the host reveals this round's answers; cleared on the next
   *  round or on `reset`. */
  revealedAnswers: Record<string, string> | null = null;
  /** Questions teams sent in, oldest first — only ever populated on an
   *  `admin`-role store (the server only routes these to admins). */
  questionInbox: SubmittedQuestion[] = [];

  private roundResults = new Map<string, { order: number; result: TurnResult | null }>();
  private currentRoundNumber = 0;
  private listeners = new Set<() => void>();
  private effectListeners = new Set<(teamId: string, effect: CardEffect) => void>();
  private snapshotListeners = new Set<(teamId: string, snap: RaceSnapshot) => void>();
  private unsubscribeNet: () => void = () => {};

  constructor(role: TeamQuizRole, teamId?: string) {
    this.role = role;
    this.myTeamId = teamId ?? null;
    this.net = new TeamQuizNet({
      roster: (teams) => this.applyRoster(teams),
      started: (seed, distance) => this.applyStarted(seed, distance),
      round: (view) => this.applyRound(view),
      cardRevealed: (cardId) => {
        this.revealedCards.add(cardId);
        // A round can cycle through several cards before every pilot
        // finishes — each new card is its own fresh question, so a team's
        // lock/reveal state from the *previous* card must not leak forward
        // and wrongly keep this one's answer panel locked out.
        this.submittedAnswers = new Set();
        this.revealedAnswers = null;
        this.notify();
      },
      jeopardyAwarded: (cardId, teamId2, points) => this.applyJeopardy(cardId, teamId2, points),
      boostApplied: (cardId, teamId2, effect) => this.applyBoost(cardId, teamId2, effect),
      cardBanked: (cardId, teamId2, boostCardId) => this.applyBankCard(cardId, teamId2, boostCardId),
      roll: (teamId2, round, order, die, result) => this.applyRoll(teamId2, round, order, die, result),
      purchase: (teamId2, itemId, targetTeamId) => this.applyPurchase(teamId2, itemId, targetTeamId),
      alliance: (racerId, allianceId) => this.applyAlliance(racerId, allianceId),
      snapshot: (teamId2, snap) => {
        for (const fn of this.snapshotListeners) fn(teamId2, snap);
      },
      error: (message) => this.note(message, '#ff4d6d'),
      over: (teamId2) => {
        this.matchOverTeamId = teamId2;
        const finisher = this.teams.get(teamId2);
        if (finisher) finisher.score += RACE_WIN_BONUS;
        this.note(`${finisher?.name ?? teamId2} первым добрался до финиша (+${RACE_WIN_BONUS} очков)`, '#ffd24d');
        // The finish ends the race, but the actual champion is decided by
        // `finalScore` — round wins/losses, this bonus, and whatever credits
        // never got spent — compared across everyone, not just whoever
        // happened to finish first.
        const champ = this.championId ? this.teams.get(this.championId) : undefined;
        if (champ && champ.id !== teamId2) this.note(`🏆 Чемпион матча: ${champ.name} — ${finalScore(champ)} очков`, '#ffd24d');
        this.notify();
      },
      reset: () => {
        this.round = null;
        this.matchOverTeamId = null;
        this.seed = 0;
        this.distance = 50;
        this.usedCards = new Set();
        this.revealedCards = new Set();
        this.teams = new Map();
        this.roundResults = new Map();
        this.currentRoundNumber = 0;
        this.broadcastView = { view: 'scoreboard', focusTeamId: null };
        this.currentQuestion = null;
        this.submittedAnswers = new Set();
        this.revealedAnswers = null;
        this.note('Ведущий сбросил матч', '#ffd24d');
        this.notify();
      },
      broadcastView: (state) => {
        this.broadcastView = state;
        this.notify();
      },
      currentQuestion: (question) => {
        this.currentQuestion = question;
        this.notify();
      },
      answerSubmitted: (teamId2) => {
        this.submittedAnswers.add(teamId2);
        this.notify();
      },
      answersRevealed: (answers) => {
        this.revealedAnswers = answers;
        this.notify();
      },
      questionSubmitted: (question) => {
        this.questionInbox.push(question);
        this.notify();
      },
      jeopardyState: (revealed, used) => {
        this.revealedCards = new Set(revealed);
        this.usedCards = new Set(used);
        this.notify();
      },
      customQuestionShown: (question) => {
        this.questionInbox = this.questionInbox.filter((q) => q.id !== question.id);
        this.note(`${this.teams.get(question.teamId)?.name ?? 'Команда'} придумала вопрос — на экране`, '#b06bff');
        this.notify();
      },
    });

    // Sent once now, and again every time the connection (re)opens — a
    // `hello` that races the socket's own handshake, or one lost to a dropped
    // Wi-Fi connection mid-party, would otherwise leave this screen
    // permanently unsynced: the server only replies with a roster/round
    // snapshot in direct response to `hello`, and a fresh reconnect is a
    // brand new server-side connection with no memory of the old one.
    let wasOnline = net.status === 'online';
    if (wasOnline) this.net.hello(role, teamId);
    this.unsubscribeNet = net.subscribe(() => {
      const isOnline = net.status === 'online';
      if (isOnline && !wasOnline) this.net.hello(role, teamId);
      wasOnline = isOnline;
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fires whenever an effect lands on a team — a shop purchase (`teamId` is
   *  whose arena it targets: the buyer's own for every item but `sabotage`,
   *  the rival's for that one) or a revealed `boost` jeopardy card. A pilot
   *  scene hooks this to apply the effect to its own live arena when the
   *  target is itself; other screens can ignore it. */
  onEffect(fn: (teamId: string, effect: CardEffect) => void): () => void {
    this.effectListeners.add(fn);
    return () => this.effectListeners.delete(fn);
  }

  /** High-frequency (~20/s), deliberately outside `subscribe`/`notify` so a
   *  heavy DOM redraw isn't triggered on every packet — a pilot's live field,
   *  for a team screen's mirror. */
  onSnapshot(fn: (teamId: string, snap: RaceSnapshot) => void): () => void {
    this.snapshotListeners.add(fn);
    return () => this.snapshotListeners.delete(fn);
  }

  dispose(): void {
    this.unsubscribeNet();
    this.net.dispose();
    this.listeners.clear();
    this.effectListeners.clear();
    this.snapshotListeners.clear();
  }

  team(id: string): TeamRacer | undefined {
    return this.teams.get(id);
  }

  get myTeam(): TeamRacer | undefined {
    return this.myTeamId ? this.teams.get(this.myTeamId) : undefined;
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private note(text: string, color = '#8ef0ff', kind?: 'purchase'): void {
    this.log.unshift({ t: Date.now(), text, color, kind });
    if (this.log.length > 20) this.log.pop();
  }

  private teamIndex(teamId: string): number {
    return this.roster.findIndex((t) => t.id === teamId);
  }

  private applyRoster(roster: TeamQuizRosterTeam[]): void {
    this.roster = roster;
    roster.forEach((r, i) => {
      let team = this.teams.get(r.id);
      if (!team) {
        team = makeTeam(r.id, r.name, i);
        this.teams.set(r.id, team);
      }
      team.name = r.name;
      team.color = r.color;
      team.members = r.members;
      team.pilotOrder = r.pilotOrder;
      team.pilotCursor = r.pilotCursor;
    });
    for (const id of [...this.teams.keys()]) {
      if (!roster.some((r) => r.id === id)) this.teams.delete(id);
    }
    this.notify();
  }

  private applyStarted(seed: number, distance: number): void {
    this.seed = seed;
    this.distance = distance;
    this.board = buildSharedBoard(distance, seed);
    this.notify();
  }

  private applyRound(view: TeamQuizRoundView): void {
    if (view.round !== this.currentRoundNumber) {
      this.currentRoundNumber = view.round;
      this.roundResults = new Map();
      this.roundReveal = [];
      this.submittedAnswers = new Set();
      this.revealedAnswers = null;
    }
    this.round = view;
    this.notify();
  }

  private applyJeopardy(cardId: string, teamId: string, points: number): void {
    this.usedCards.add(cardId);
    const team = this.teams.get(teamId);
    if (team) {
      // Credits only — `finalScore` already counts whatever of these are
      // still unspent at the end, so a correct answer doesn't *also* pad
      // `score` on top of that: spending is a real trade against the final
      // tally, not free money layered over it.
      team.credits += points;
      this.note(`${team.name}: +${points} кредитов за карточку`, '#ffd24d');
    }
    this.notify();
  }

  private applyRoll(teamId: string, round: number, order: number, die: number, result: TurnResult | null): void {
    const team = this.teams.get(teamId);
    if (!team || !this.board.length) return;
    this.roundResults.set(teamId, { order, result });

    const idx = this.teamIndex(teamId);
    const rng = teamRoundRng(this.seed, round, idx);
    const roll = teamRoll(die, rng, result ?? fallbackResult(), team.diceMod);
    team.diceMod = 0;
    const cellBefore = team.cell;
    const outcomes = walkRoll(team, [...this.teams.values()], this.distance, this.board, roll.total, rng);
    this.roundReveal.push({ teamId, cellBefore, roll, outcomes });
    team.rounds += 1;
    if (result?.cleared) team.cleared += 1;

    this.note(`${team.name}: ${roll.line} — итого ${roll.total}`, team.color);
    for (const outcome of outcomes) this.note(`${team.name}: ${outcome.text}`, '#8ef0ff');

    // `order` is assigned server-side in strict arrival sequence and never
    // backdated, so "top 3 by order among those who've cleared and reported
    // so far" is stable the instant it's computed — a team already in it can
    // never be bumped out by someone reporting later, only teams still to
    // come could join in behind. Safe to recompute on every single roll
    // rather than waiting for the whole round to resolve, so a team that
    // clears fast gets picking/spectator rights immediately, while its
    // rivals are still racing — not just once everyone's finished.
    const cleared = [...this.roundResults.entries()]
      .filter(([, entry]) => entry.result?.cleared)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id);
    this.topFinishers = cleared.slice(0, 3);
    this.lastRoundWinnerId = cleared[0] ?? null;

    // The +1 round-clear bonus itself still only ever fires once, exactly
    // when every team has reported — awarding it earlier would be correct
    // too (the winner is already stable), but this keeps the score-changing
    // side effect a single, easy-to-reason-about event same as before.
    if (this.roundResults.size >= this.roster.length && this.lastRoundWinnerId) {
      const winner = this.teams.get(this.lastRoundWinnerId);
      if (winner) {
        winner.score += 1;
        this.note(`${winner.name} первой зачистила уровень: +1 очко`, '#3ddc84');
      }
    }
    this.notify();
  }

  /** `targetTeamId` names an explicit racer for either a rival-type item
   *  aimed past whoever's merely being spectated, or a self-type item
   *  gifted to an ally — omitted, a self-type item defaults to the buyer. */
  private applyPurchase(teamId: string, itemId: ShopItemId, targetTeamId: string | null): void {
    const item = SHOP_ITEMS[itemId];
    const team = this.teams.get(teamId);
    if (!team || !item) return;
    team.credits = Math.max(0, team.credits - item.cost);
    const targetId = targetTeamId ?? teamId;
    this.note(`${team.name} покупает: ${item.icon} ${item.name}`, item.color, 'purchase');
    // `cell` moves track position directly — same special case `applyBoost`
    // has for a host-revealed boost card, since `applyCardEffectToArena` is
    // deliberately silent on it (it's not an arena number).
    if (item.effect.t === 'cell') {
      const target = this.teams.get(targetId);
      if (target) target.cell = Math.max(0, Math.min(this.distance, target.cell + item.effect.delta));
    }
    this.notify();
    for (const fn of this.effectListeners) fn(targetId, item.effect);
  }

  /** The racer with the highest `finalScore` (`core/teamRace.ts` — round
   *  wins/losses and the finish bonus, plus whatever credits are still
   *  unspent) once the race itself has ended (`matchOverTeamId` set). `null`
   *  before then. */
  get championId(): string | null {
    if (!this.matchOverTeamId) return null;
    let best: TeamRacer | null = null;
    for (const team of this.teams.values()) {
      if (!best || finalScore(team) > finalScore(best)) best = team;
    }
    return best?.id ?? this.matchOverTeamId;
  }

  /** The one-off, real-world flavor awards read out once the whole party is
   *  over (`core/awards.ts`) — resolved to display-ready lines (names in,
   *  `{target}` substituted) so every screen just maps over this instead of
   *  re-deriving the ranking and doing its own string templating. Empty
   *  before the match ends, or with fewer than 2 racers. */
  get matchAwardLines(): { id: string; name: string; color: string; text: string }[] {
    if (!this.matchOverTeamId) return [];
    const ranked = [...this.teams.values()].sort((a, b) => finalScore(b) - finalScore(a) || a.id.localeCompare(b.id)).map((t) => t.id);
    const awards = pickMatchAwards(this.seed, ranked);
    if (!awards) return [];
    const lines: { id: string; name: string; color: string; text: string }[] = [];
    const champ = this.teams.get(awards.championId);
    if (champ) lines.push({ id: champ.id, name: champ.name, color: champ.color, text: awards.championText });
    if (awards.runnerUp) {
      const runner = this.teams.get(awards.runnerUp.runnerUpId);
      const target = this.teams.get(awards.runnerUp.targetId);
      if (runner && target) {
        lines.push({ id: runner.id, name: runner.name, color: runner.color, text: awards.runnerUp.text.replace('{target}', target.name) });
      }
    }
    const last = this.teams.get(awards.lastId);
    if (last) lines.push({ id: last.id, name: last.name, color: last.color, text: awards.lastText });
    return lines;
  }

  private applyAlliance(racerId: string, allianceId: number | null): void {
    const team = this.teams.get(racerId);
    if (!team) return;
    team.allianceId = allianceId;
    const letter = allianceId !== null ? ['A', 'B', 'C'][allianceId] : null;
    this.note(letter ? `${team.name} вступает в союз ${letter}` : `${team.name} покидает союз`, '#b06bff');
    this.notify();
  }

  /** `boost` jeopardy cards resolve instantly: no judging, the effect just
   *  lands. `cell` effects move a team's track position directly (shared
   *  state every screen already mirrors, not something a live arena owns),
   *  everything else goes through the same effect-listener pipe a purchase
   *  uses so the target's own pilot scene can apply it to a live arena. */
  private applyBoost(cardId: string, teamId: string, effect: CardEffect): void {
    this.usedCards.add(cardId);
    const team = this.teams.get(teamId);
    if (team) {
      if (effect.t === 'cell') {
        team.cell = Math.max(0, Math.min(this.distance, team.cell + effect.delta));
      }
      this.note(`${team.name}: карточка-бонус применена`, '#ffd24d');
    }
    this.notify();
    for (const fn of this.effectListeners) fn(teamId, effect);
  }

  /** A team picked a `boost` card through its own round-winner picker
   *  (`teamQuizDevice.ts`) — banked into `team.bankedCards` for the
   *  end-of-race salvo instead of resolved on the spot the way
   *  `applyBoost` above does for a host-revealed one. */
  private applyBankCard(cardId: string, teamId: string, boostCardId: CardId): void {
    this.usedCards.add(cardId);
    const team = this.teams.get(teamId);
    const def = CARDS[boostCardId];
    if (team && def) {
      team.bankedCards.push(boostCardId);
      this.note(`${team.name} копит карточку: ${def.icon} ${def.name}`, '#ffd24d');
    }
    this.notify();
  }
}
