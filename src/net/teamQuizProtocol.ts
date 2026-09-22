import type { CardEffect, CardId } from '../core/race';
import type { ShopItemId } from '../core/shop';
import type { TeamMember, TurnResult } from '../core/teamRace';
import type { RaceSnapshot } from './raceProtocol';

/** The team-quiz wire protocol. Same discipline as `raceProtocol.ts`: the
 *  server is a referee, not a simulation. It owns identity and sequencing —
 *  which teams and members exist, the pilot rotation, the match seed, the
 *  round number/phase/deadline, and which jeopardy cards are used — and
 *  nothing about the numbers a round produces. Every client (admin, both
 *  team screens, both pilots, an optional public screen) keeps its own
 *  `TeamRacer[]` from `core/teamRace.ts` and replays the same broadcast
 *  events through it, so track position, lives, credits and score end up
 *  identical everywhere without ever being sent as state.
 *
 *  Four roles connect to the same room: `admin` runs the match and judges the
 *  quiz board, `pilot` plays one team's level, `team` is that team's shared
 *  screen (board + shop, plus a live mirror of their own pilot's field),
 *  `public` is an optional read-only projector view. */
export type TeamQuizRole = 'admin' | 'pilot' | 'team' | 'public';

/** Identity/roster facts only — never the numbers a round produces. Every
 *  client seeds its own `TeamRacer` from this once, at match start. */
export interface TeamQuizRosterTeam {
  id: string;
  name: string;
  color: string;
  members: TeamMember[];
  /** Rotation order, by member id. */
  pilotOrder: string[];
  pilotCursor: number;
}

export type TeamQuizPhase = 'lobby' | 'playing' | 'resolved' | 'over';

export interface TeamQuizRoundView {
  round: number;
  distance: number;
  phase: TeamQuizPhase;
  /** team id -> member id piloting this round. */
  pilots: Record<string, string | null>;
  /** Epoch ms the round's clock runs out, 0 while not running. */
  deadline: number;
}

/** What the projector/TV screen is currently showing — the host switches
 *  this like a director switches cameras. `single`/`dual` reuse the same
 *  live pilot mirrors the team screens already draw from `pilot:snapshot`. */
export type BroadcastView = 'scoreboard' | 'question' | 'single' | 'dual';

export interface BroadcastState {
  view: BroadcastView;
  /** Which team's field `single` shows — irrelevant for the other views. */
  focusTeamId: string | null;
}

/** The "Вопрос" view's content — a jeopardy card by id (the broadcast screen
 *  looks up its title/prompt from the same `/api/jeopardy` content every
 *  screen already fetches) or a question a team wrote and the host chose to
 *  put up, verbatim. */
export type CurrentQuestion = { source: 'jeopardy'; cardId: string } | { source: 'custom'; id: string; teamId: string; text: string };

/** A question a team wrote and sent to the host, waiting in the host's inbox
 *  until picked (or never — teams can submit more than get used). */
export interface SubmittedQuestion {
  id: string;
  teamId: string;
  text: string;
}

/** Client -> server. */
export type TeamQuizUp =
  | { k: 'hello'; role: TeamQuizRole; teamId?: string }
  // Admin: roster.
  /** The only roster message the redesigned single-step wizard sends —
   *  creates a team-of-one in one round trip (a team id and a member id,
   *  ready to race immediately) instead of the two-step `admin:addTeam` then
   *  `admin:addMember` dance, which needs the client to wait for the
   *  `roster` echo to learn the new team's id before it can add a member to
   *  it. `admin:addTeam`/`admin:addMember`/`admin:setPilotOrder` stay for
   *  now (harmless, just unused by the new UI) rather than being ripped out
   *  for a UI-only change. */
  | { k: 'admin:addPlayer'; name: string }
  | { k: 'admin:addTeam'; name: string }
  | { k: 'admin:removeTeam'; teamId: string }
  | { k: 'admin:addMember'; teamId: string; name: string; ai?: boolean }
  | { k: 'admin:removeMember'; teamId: string; memberId: string }
  | { k: 'admin:setPilotOrder'; teamId: string; order: string[] }
  // Admin: match flow.
  | { k: 'admin:startMatch'; distance: number }
  | { k: 'admin:nextRound' }
  /** Un-starts the match without touching the roster — the way back to
   *  editable teams after a test start, or to run the party again. */
  | { k: 'admin:resetMatch' }
  // Admin: jeopardy board. The host judges every card by hand — `judged` and
  // `ranked` cards both resolve to the same "award N points" call, the only
  // difference is how the host arrived at N.
  | { k: 'admin:revealCard'; cardId: string }
  | { k: 'admin:awardCard'; cardId: string; teamId: string; points: number }
  /** `boost` cards resolve instantly, no judging: the host sends the card's
   *  own effect (looked up from `core/race.ts`'s `CARDS` locally, so the
   *  server never needs to know what a card means) straight to a team. Only
   *  reachable today via a human host manually revealing a card by hand
   *  (`teamQuizAdmin.ts`'s `boostBox`) — a team's own picker never calls
   *  this, it banks instead (`team:bankCard` below). */
  | { k: 'admin:applyBoost'; cardId: string; teamId: string; effect: CardEffect }
  // Admin: directing the broadcast/projector screen.
  | { k: 'admin:setBroadcastView'; view: BroadcastView; focusTeamId?: string }
  /** Shows all of this round's submitted free-text answers at once — before
   *  this, the host only knows *who* has answered, not what they wrote. */
  | { k: 'admin:revealAnswers' }
  /** Puts a team-submitted question up on the "Вопрос" view in place of the
   *  current jeopardy card. */
  | { k: 'admin:pickCustomQuestion'; id: string }
  // Team screen: a free-text answer to whatever's current — only meaningful,
  // and only accepted, while this team's own round is still open.
  | { k: 'team:submitAnswer'; text: string }
  /** A question this team wrote for the host to use on someone else — not
   *  tied to a round; can be sent any time. */
  | { k: 'team:submitQuestion'; text: string }
  // Pilot: the level just played.
  | { k: 'pilot:result'; result: TurnResult }
  | { k: 'pilot:snapshot'; snap: RaceSnapshot }
  /** Sent right after a `pilot:result` that cleared the finale level — every
   *  client can tell a finale round apart on its own (`core/teamRace.ts`'s
   *  `isFinale`), so this only has to say "freeze the match", not "and here
   *  is why". */
  | { k: 'pilot:over' }
  // Team screen: spend credits on your own pilot, on an ally's, or a
  // diversion on a non-ally's — `targetTeamId` names an explicit racer for
  // either case (a self-type item gifted to an ally, or a rival-type item
  // aimed past whichever racer is merely being spectated); omitted, a
  // self-type item defaults to the buyer.
  | { k: 'team:purchase'; itemId: ShopItemId; targetTeamId?: string }
  // Player: real-time alliances (up to `ALLIANCE_MAX` in `core/teamRace.ts`)
  // — a buff can only ever reach an ally, a debuff only a non-ally
  // (`allied`/`cardAllowed` in `core/teamRace.ts`). Joining a loner forms a
  // brand-new alliance with them; joining someone already allied joins their
  // alliance, if it has room. Leaving empties your slot; a union left at
  // exactly one member is dissolved automatically (mirrors the original
  // hot-seat race mode's "union" rule, `core/race.ts`).
  | { k: 'player:joinAlliance'; targetId: string }
  | { k: 'player:leaveAlliance' }
  /** Picking a `boost` card through a team's own round-winner picker
   *  (`teamQuizDevice.ts`) banks it into that team's stash instead of
   *  resolving it on the spot — `boostCardId` is `core/race.ts`'s catalog
   *  id (`JeopardyCard.boostCardId`), looked up again client-side at fire
   *  time (name/icon/kind/effect), same as `admin:applyBoost` never sends
   *  more than an already-resolved `effect` because the server doesn't need
   *  to understand what a card means. */
  | { k: 'team:bankCard'; cardId: string; boostCardId: CardId };

/** Server -> clients. */
export type TeamQuizDown =
  | { k: 'roster'; teams: TeamQuizRosterTeam[] }
  /** Once, when the admin freezes the roster and starts the match — the seed
   *  every client builds its team boards from (`core/teamRace.ts`'s
   *  `buildTeamBoards`). Never sent again; a reconnecting client re-fetches it
   *  via `hello`, same as `round`. */
  | { k: 'started'; seed: number; distance: number }
  | { k: 'round'; view: TeamQuizRoundView }
  | { k: 'cardRevealed'; cardId: string }
  | { k: 'jeopardyAwarded'; cardId: string; teamId: string; points: number }
  | { k: 'boostApplied'; cardId: string; teamId: string; effect: CardEffect }
  /** A team banked a `boost` card into its own stash instead of applying it
   *  — see `team:bankCard` above. */
  | { k: 'cardBanked'; cardId: string; teamId: string; boostCardId: CardId }
  /** Catch-up for a late join/reconnect after the match has started — which
   *  cards are already revealed/used, so the grid doesn't lie. Credits
   *  already paid for a used card are *not* replayed by this (that would
   *  need a full turn log, which this mode doesn't keep) — a known gap. */
  | { k: 'jeopardyState'; revealed: string[]; used: string[] }
  | { k: 'broadcastView'; state: BroadcastState }
  | { k: 'currentQuestion'; question: CurrentQuestion | null }
  /** A team submitted its free-text answer — everyone learns *who*, nobody
   *  learns *what* until `answersRevealed`. Cleared every new round. */
  | { k: 'answerSubmitted'; teamId: string }
  | { k: 'answersRevealed'; answers: Record<string, string> }
  /** A submitted question, sent to admin connections only — the point is the
   *  host picks what to show, not that it leaks to whoever it's aimed at. */
  | { k: 'questionSubmitted'; question: SubmittedQuestion }
  /** A team-written question just went up on the broadcast screen — sent to
   *  everyone, this one is meant to be seen. */
  | { k: 'customQuestionShown'; question: SubmittedQuestion }
  /** The die for the round just played, with the result every screen scores
   *  it by — every client applies `core/teamRace.ts`'s `walkRoll` to its own
   *  copy of the team from this and arrives at the same outcome. */
  | { k: 'roll'; teamId: string; round: number; die: number; result: TurnResult }
  | { k: 'snapshot'; teamId: string; snap: RaceSnapshot }
  | { k: 'purchase'; teamId: string; itemId: ShopItemId; targetTeamId?: string }
  /** A racer's alliance slot changed — `null` means they just left (or were
   *  auto-dissolved out of a union down to one member). */
  | { k: 'alliance'; racerId: string; allianceId: number | null }
  | { k: 'error'; message: string }
  | { k: 'over'; teamId: string }
  /** The match was un-started — every client drops its replayed run state
   *  and waits for a fresh `roster`/`started`. */
  | { k: 'reset' };
