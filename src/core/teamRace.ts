import { Rng } from './rng';
import {
  CELL_TYPES,
  CELL_LINES,
  FINALE_KNOCKBACK,
  type CellKind,
  type TurnResult,
  type Roll,
  type CardId,
  type CardDef,
  rollDice,
  playBonuses,
  makeRoll,
} from './race';

/** The team race: two or more teams, each with its own track. Every round all
 *  teams play a level at once — one "pilot" per team, rotating every round —
 *  while the rest of the team earns credits in a live "Своя игра" board and
 *  spends them from a shop on their own pilot's field. This module is the
 *  rules only, same discipline as `core/race.ts`: no DOM, no canvas, no arena,
 *  no network — so it can be shared verbatim between the server referee and
 *  every connected screen. */

export { FINALE_KNOCKBACK };
export type { TurnResult, Roll };
export { rollDice, playBonuses };

export const TEAM_START_LIVES = 3;
export const TEAM_MIN_LIVES = 1;
export const TEAM_ROUND_SECONDS = 90;
export const TEAM_BOSS_ROUND_SECONDS = 150;
export const TEAM_BOSS_LIVES_BONUS = 1;
export const TEAM_START_CREDITS = 0;
/** Credits a "Тайник" cell hands out, same spot the solo race hands out cards.
 *  Scaled to the shop's real economy (`core/shop.ts` — a correct answer pays
 *  roughly 200-400 credits) rather than being a token amount next to it. */
export const STASH_CREDITS = 50;
/** One-off bonus for the team whose pilot actually beats the *final* boss —
 *  winning the whole race, not just one round of it. Big on purpose: this is
 *  the moment the match ends, so it should visibly matter next to the +1s
 *  every round win hands out along the way. */
export const RACE_WIN_BONUS = 50;

export const TEAM_COLORS = ['#4de2ff', '#ff5fa2', '#3ddc84', '#ffd24d', '#b06bff', '#ff7a3d'];

// ------------------------------------------------------------------ board ---

/** Every base-race cell kind, plus three that only exist in team mode because
 *  they need two teams (or a live host) to mean anything. */
export type TeamCellKind = CellKind | 'duel' | 'auction' | 'suddenDeath';

export interface TeamCellDef {
  kind: TeamCellKind;
  name: string;
  icon: string;
  color: string;
  desc: string;
  weight: number;
}

const TEAM_ONLY_TYPES: Record<'duel' | 'auction' | 'suddenDeath', TeamCellDef> = {
  duel: {
    kind: 'duel',
    name: 'Дуэль',
    icon: '⚔',
    color: '#ff2d55',
    desc: 'Общий блиц-вопрос сразу для всех команд — кто первым ответил, тот получил эффект',
    weight: 2,
  },
  auction: {
    kind: 'auction',
    name: 'Аукцион',
    icon: '🔨',
    color: '#ffd24d',
    desc: 'Слепая ставка кредитами за бонус — рискуешь запасом ради рывка',
    weight: 1,
  },
  suddenDeath: {
    kind: 'suddenDeath',
    name: 'Судные часы',
    icon: '☠',
    color: '#ff2d55',
    desc: 'На кону жизнь либо полный заряд супера — орёл или решка',
    weight: 1,
  },
};

const TEAM_ONLY_LINES: Record<'duel' | 'auction' | 'suddenDeath', string[]> = {
  duel: [
    'Диспетчер сталкивает команды лбами: один вопрос на всех, первый ответ забирает эффект.',
    'Общая тревога. Кто быстрее — тот и прав.',
    'Дуэльный вызов принят автоматически. Отказаться нельзя, обжаловать тоже.',
  ],
  auction: [
    'Аукцион открыт. Ставки — кредитами, обратного хода нет.',
    'Торги начались без предупреждения. Молчание — не ставка.',
    'Лот один, желающих много. Кто щедрее — тот и с бонусом.',
  ],
  suddenDeath: [
    'Судные часы. Всё или ничего, и решение не за вами.',
    'Монета уже в воздухе. Приземлится — узнаете.',
    'Отдел риска предлагает сыграть. Отказ не предусмотрен.',
  ],
};

/** Base-race cell art plus the three team-only kinds — spreading a narrower
 *  `Record<CellKind,_>` into a wider `Record<TeamCellKind,_>` is safe because
 *  every `CellKind` is itself a valid `TeamCellKind`. */
export const TEAM_CELL_TYPES: Record<TeamCellKind, TeamCellDef> = { ...CELL_TYPES, ...TEAM_ONLY_TYPES };
export const TEAM_CELL_LINES: Record<TeamCellKind, string[]> = { ...CELL_LINES, ...TEAM_ONLY_LINES };
export const TEAM_CELL_LIST: TeamCellDef[] = Object.values(TEAM_CELL_TYPES);

export function teamCellLine(kind: TeamCellKind, rng: Rng): string {
  return rng.pick(TEAM_CELL_LINES[kind]);
}

export interface TeamCell {
  index: number;
  kind: TeamCellKind | null;
  revealed: boolean;
}

/** Cells 0..distance, same shape as the solo race's `makeBoard` — but much
 *  denser: a cell hits every 1 or 2 steps instead of every 2 to 5, because the
 *  whole point of the team board is that almost every square does something. */
export function makeTeamBoard(distance: number, rng: Rng): TeamCell[] {
  const cells: TeamCell[] = [];
  for (let i = 0; i <= distance; i++) cells.push({ index: i, kind: null, revealed: false });

  const pool: TeamCellKind[] = [];
  for (const def of TEAM_CELL_LIST) for (let i = 0; i < def.weight; i++) pool.push(def.kind);

  for (let at = 1; at < distance; at += 1 + rng.int(0, 1)) {
    cells[at].kind = rng.pick(pool);
  }
  return cells;
}

// ----------------------------------------------------------------- teams ---

export interface TeamMember {
  id: string;
  name: string;
  /** An AI teammate — whichever device holds this team auto-races this
   *  member's turns the instant they come up (`teamQuizDevice.ts`'s
   *  `sync()`), the same way an `unattended` device always does, without
   *  needing every device that ever joins this team to know about it
   *  through anything but the roster itself. */
  ai?: boolean;
}

export interface TeamRacer {
  id: string;
  name: string;
  color: string;
  cell: number;
  lives: number;
  skipRounds: number;
  chargedSuper: boolean;
  bonusSeconds: number;
  springDebt: boolean;
  diceMod: number;
  credits: number;
  /** +1 for winning a round's level race, −1 for losing it — separate from
   *  track position, per the birthday-party house rule. */
  score: number;
  rounds: number;
  cleared: number;
  members: TeamMember[];
  /** Rotation order, by member id. */
  pilotOrder: string[];
  /** Index into `pilotOrder` of the pilot who is flying (or just flew) this
   *  round; -1 before the first round. */
  pilotCursor: number;
  /** Which alliance this racer belongs to (0-2, `ALLIANCE_MAX` of them at
   *  once), or `null` for a lone racer — only meaningful in "true solo" mode
   *  (`allied`/`teammates` below). Team mode's fixed two `TeamRacer`s never
   *  set this; a team already *is* its own alliance, with nobody else to
   *  ally with. */
  allianceId: number | null;
  /** Boost-type jeopardy cards this racer has picked and banked rather than
   *  applied on the spot — the catalog id (`core/race.ts`'s `CardId`) is
   *  enough to look up name/icon/kind/effect again at fire time. Unleashed
   *  all at once at the end of the race (buffs to allies/self, debuffs to a
   *  chosen rival) instead of one-at-a-time immediate application. */
  bankedCards: CardId[];
}

export function makeTeam(id: string, name: string, index: number): TeamRacer {
  return {
    id,
    name,
    color: TEAM_COLORS[index % TEAM_COLORS.length],
    cell: 0,
    lives: TEAM_START_LIVES,
    skipRounds: 0,
    chargedSuper: false,
    bonusSeconds: 0,
    springDebt: false,
    diceMod: 0,
    credits: TEAM_START_CREDITS,
    score: 0,
    rounds: 0,
    cleared: 0,
    members: [],
    pilotOrder: [],
    pilotCursor: -1,
    allianceId: null,
    bankedCards: [],
  };
}

// --------------------------------------------------------------- alliances --

/** Up to 3 racers per alliance — same cap the old hot-seat race's union
 *  system used (`TEAM_LABELS` in `core/race.ts`), kept independent here
 *  since "team" already means something else (the `TeamRacer` itself) in
 *  this mode. */
export const ALLIANCE_MAX = 3;

/** Two racers are allied when they share a non-null `allianceId` — never
 *  with yourself, same as `core/race.ts`'s original `allied`. */
export function allied(a: TeamRacer, b: TeamRacer): boolean {
  return a !== b && a.allianceId !== null && a.allianceId === b.allianceId;
}

export function teammates(racers: TeamRacer[], p: TeamRacer): TeamRacer[] {
  return racers.filter((q) => allied(p, q));
}

/** The smallest alliance id nobody's using yet, or `null` once all
 *  `ALLIANCE_MAX` are taken. */
export function freeAlliance(racers: TeamRacer[]): number | null {
  for (let i = 0; i < ALLIANCE_MAX; i++) {
    if (!racers.some((r) => r.allianceId === i)) return i;
  }
  return null;
}

/** Same rule as `core/race.ts`'s original `cardAllowed`: a buff only ever
 *  travels to an ally, a debuff only ever to a non-ally — what makes an
 *  alliance worth forming in the first place. */
export function cardAllowed(def: CardDef, from: TeamRacer, to: TeamRacer): boolean {
  return allied(from, to) ? def.kind === 'buff' : def.kind === 'debuff';
}

/** Who flies next, by member id — the seat after `pilotCursor`, wrapping.
 *  Null when nobody is registered yet. */
export function nextPilot(team: TeamRacer): string | null {
  if (!team.pilotOrder.length) return null;
  const next = (team.pilotCursor + 1) % team.pilotOrder.length;
  return team.pilotOrder[next];
}

/** Moves the rotation on. Called once the round's pilot is decided, so the
 *  round after next hands the seat to the next member in line. */
export function advancePilot(team: TeamRacer): void {
  if (!team.pilotOrder.length) return;
  team.pilotCursor = (team.pilotCursor + 1) % team.pilotOrder.length;
}

/** What a round opens with: the stock, never below the floor, plus a loan for
 *  a boss round — same shape as the solo race's `livesFor`. */
export function livesForRound(team: TeamRacer, boss: boolean): number {
  return Math.max(TEAM_MIN_LIVES, team.lives) + (boss ? TEAM_BOSS_LIVES_BONUS : 0);
}

export function roundSecondsFor(boss: boolean): number {
  return boss ? TEAM_BOSS_ROUND_SECONDS : TEAM_ROUND_SECONDS;
}

export function isFinale(team: TeamRacer, distance: number): boolean {
  return team.cell >= distance;
}

/** Moves a team's token, clamped to the track. Returns the actual delta, which
 *  may be smaller than requested near either end. */
export function advanceTeam(team: TeamRacer, steps: number, distance: number): number {
  const before = team.cell;
  team.cell = Math.min(distance, Math.max(0, team.cell + steps));
  return team.cell - before;
}

/** +1 to whoever cleared their level first this round, −1 to whoever didn't —
 *  independent of how far the dice then move either team. */
export function applyRoundBonus(winner: TeamRacer | null, loser: TeamRacer | null): void {
  if (winner) winner.score += 1;
  if (loser) loser.score -= 1;
}

/** What actually decides the party's champion: round wins/losses and the
 *  finish bonus (`score`) plus whatever credits never got spent in the shop
 *  (`credits`) — a correct answer only ever pays credits now, it doesn't
 *  also pad `score` for free, so spending is a real trade against this
 *  number, not a bonus on top of it. */
export function finalScore(team: TeamRacer): number {
  return team.score + team.credits;
}

// ------------------------------------------------------------------ cells ---

export interface TeamCellOutcome {
  kind: TeamCellKind;
  delta: number;
  swappedWith: string | null;
  text: string;
  line: string;
}

/** Resolves the cell a team just landed on. Mirrors `resolveCell` from the
 *  solo race almost field-for-field — the difference is everything here is
 *  team-scoped instead of seat-scoped, "Тайник" pays credits instead of cards,
 *  and the three team-only kinds get a shot at a proper live event (a shared
 *  blitz question, a blind bid, a coin flip on stage) — what's implemented
 *  here is a self-contained fallback so a round still resolves even without a
 *  host driving it live. */
export function resolveTeamCell(
  kind: TeamCellKind,
  team: TeamRacer,
  teams: TeamRacer[],
  distance: number,
  rng: Rng,
): TeamCellOutcome {
  const def = TEAM_CELL_TYPES[kind];
  const base: TeamCellOutcome = { kind, delta: 0, swappedWith: null, text: def.name, line: teamCellLine(kind, rng) };
  const clampCell = (c: number): number => Math.min(distance, Math.max(0, c));
  const rivals = teams.filter((t) => t !== team);

  switch (kind) {
    case 'swap': {
      let best: TeamRacer | null = null;
      for (const t of rivals) {
        if (!best || Math.abs(t.cell - team.cell) < Math.abs(best.cell - team.cell)) best = t;
      }
      if (!best) return { ...base, text: 'Обмен: меняться не с кем' };
      const from = team.cell;
      team.cell = best.cell;
      best.cell = from;
      return { ...base, delta: team.cell - from, swappedWith: best.id, text: `Обмен местами с командой ${best.name}` };
    }
    case 'medkit':
      team.lives += 1;
      return { ...base, text: `Аптечка: +1 жизнь (теперь ${team.lives})` };
    case 'hospital':
      team.lives += 3;
      return { ...base, text: `Госпиталь: +3 жизни (теперь ${team.lives})` };
    case 'skip':
      team.skipRounds += 1;
      return { ...base, text: 'Карантин: следующий раунд команда пропускает' };
    case 'rewind':
      // No turn order to rewind in team mode — a bonus round of shop credits
      // instead, so the cell still means something.
      team.credits += STASH_CREDITS;
      return { ...base, text: `Откат смены: некому передавать ход, +${STASH_CREDITS} кредита взамен` };
    case 'charge':
      team.chargedSuper = true;
      return { ...base, text: 'Перегрузка: следующий уровень начнётся с полным супером' };
    case 'steal': {
      let victim: TeamRacer | null = null;
      for (const t of rivals) {
        if (t.lives <= 1) continue;
        if (!victim || t.lives > victim.lives) victim = t;
      }
      if (!victim) return { ...base, text: 'Изъятие: брать не у кого — все и так бедны' };
      victim.lives -= 1;
      team.lives += 1;
      return { ...base, text: `Изъятие: жизнь снята с команды ${victim.name} (теперь ${team.lives})` };
    }
    case 'clock':
      team.bonusSeconds += 30;
      return { ...base, text: 'Хронометр: +30 секунд к следующему раунду' };
    case 'toll':
      team.bonusSeconds -= 20;
      return { ...base, text: 'Мытарь: −20 секунд на следующем раунде' };
    case 'stash':
      team.credits += STASH_CREDITS;
      return { ...base, text: `Тайник: +${STASH_CREDITS} кредита` };
    case 'reverse':
      // Turn order has no meaning across parallel teams; treat it as a shared
      // jolt instead of a no-op.
      team.bonusSeconds += 15;
      return { ...base, text: 'Реверс: очерёдности здесь нет, +15 секунд взамен' };
    case 'start': {
      const before = team.cell;
      team.cell = 0;
      return { ...base, delta: -before, text: 'Обрыв: обратно на старт' };
    }
    case 'duel': {
      // Live version: a shared blitz question, first correct answer wins the
      // swing. Fallback: a modest guaranteed push forward.
      const swing = rng.int(2, 6);
      const before = team.cell;
      team.cell = clampCell(team.cell + swing);
      return { ...base, delta: team.cell - before, text: `Дуэль: рывок на ${team.cell - before}` };
    }
    case 'auction': {
      // Live version: a blind credit bid against the other teams. Fallback: a
      // small guaranteed spend-for-time trade.
      const bid = Math.min(team.credits, rng.int(1, 4));
      team.credits -= bid;
      team.bonusSeconds += bid * 5;
      return { ...base, text: `Аукцион: ставка ${bid} кредита(ов) окупилась временем` };
    }
    case 'suddenDeath': {
      if (rng.chance(0.5)) {
        team.chargedSuper = true;
        return { ...base, text: 'Судные часы: повезло — супер заряжен' };
      }
      team.lives = Math.max(TEAM_MIN_LIVES, team.lives - 1);
      return { ...base, text: 'Судные часы: не повезло — потеряна жизнь' };
    }
    default: {
      let delta: number;
      if (kind === 'leap') delta = rng.int(3, 9);
      else if (kind === 'pit') delta = -rng.int(2, 6);
      else if (kind === 'spring') delta = rng.int(6, 13);
      else delta = rng.chance(0.5) ? rng.int(4, 11) : -rng.int(4, 11);

      const before = team.cell;
      team.cell = clampCell(team.cell + delta);
      const moved = team.cell - before;
      if (kind === 'spring') team.springDebt = true;

      return {
        ...base,
        delta: moved,
        text:
          moved === 0
            ? `${def.name}: дальше некуда`
            : moved > 0
              ? `${def.name}: вперёд на ${moved}`
              : `${def.name}: назад на ${-moved}`,
      };
    }
  }
}

// -------------------------------------------------------- shared streams ---

/** Deterministic stream for one team's own board layout. Every screen with
 *  the same match seed builds the identical track for the identical team —
 *  the board itself is never sent, same principle as the solo race. */
export function teamBoardRng(seed: number, teamIndex: number): Rng {
  return new Rng((seed ^ ((teamIndex + 1) * 0x9e3779b9)) >>> 0);
}

/** Deterministic stream for one team's one round. Cell effects and flavor
 *  text draw from this, so every screen narrates the same round the same
 *  way. */
export function teamRoundRng(seed: number, round: number, teamIndex: number): Rng {
  return new Rng((seed ^ ((round + 1) * 2654435761) ^ ((teamIndex + 1) * 0x9e3779b9)) >>> 0);
}

/** Party-mode-specific scoring on top of `race.ts`'s own `makeRoll`: a
 *  cleared level still moves by the full scored die+bonus total, but
 *  failing one — timed out *or* died, doesn't matter which — only ever
 *  crawls forward exactly one cell. Solo-duel keeps `race.ts`'s plain
 *  scored-die-minus-penalty movement on failure unchanged; this wrapper is
 *  what `teamQuizStore.ts`'s `applyRoll` calls instead. */
export function teamRoll(die: number, rng: Rng, result: TurnResult, diceMod: number): Roll {
  const roll = makeRoll(die, rng, result, diceMod);
  return result.cleared ? roll : { ...roll, total: 1 };
}

/** One board for the whole match — every team's token moves on the same
 *  track, the way the old hot-seat race mode worked (`cells = makeBoard(...)`
 *  shared by every player). Whoever lands on a cell first reveals it for
 *  everyone else too, same as `TeamCell.revealed` already does for a single
 *  team — since it's the same array reference for the whole match, that just
 *  falls out for free. Used by the party mode (`teamQuizStore.ts`); the solo
 *  1v1-vs-bot mode keeps its own per-side `buildTeamBoards` below unchanged. */
export function buildSharedBoard(distance: number, seed: number): TeamCell[] {
  return makeTeamBoard(distance, new Rng(seed));
}

export function buildTeamBoards(teamIds: string[], distance: number, seed: number): Map<string, TeamCell[]> {
  const boards = new Map<string, TeamCell[]>();
  teamIds.forEach((id, i) => boards.set(id, makeTeamBoard(distance, teamBoardRng(seed, i))));
  return boards;
}

/** Walks a team's token from its current cell by `steps`, firing every
 *  special cell it lands on along the way — including a chain when a cell
 *  itself throws the token further (a leap landing on a pit, say). Mirrors
 *  the solo race's `startMove` + `startMoveContinuation` pair as one pure
 *  call instead of an animated sequence; a scene can still animate it by
 *  replaying the returned outcomes with a delay between each. */
export function walkRoll(
  team: TeamRacer,
  teams: TeamRacer[],
  distance: number,
  board: TeamCell[],
  steps: number,
  rng: Rng,
): TeamCellOutcome[] {
  const outcomes: TeamCellOutcome[] = [];
  team.cell = Math.min(distance, Math.max(0, team.cell + steps));
  for (let guard = 0; guard < 16; guard++) {
    const cell = board[team.cell];
    if (!cell || !cell.kind || team.cell >= distance) break;
    cell.revealed = true;
    const outcome = resolveTeamCell(cell.kind, team, teams, distance, rng);
    outcomes.push(outcome);
    if (outcome.delta === 0 && outcome.swappedWith === null) break;
  }
  return outcomes;
}
