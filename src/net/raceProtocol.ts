import type { CardId, TurnResult } from '../core/race';
import type { FieldSnapshot } from './protocol';

/** The networked race. The server is a referee, not a simulation: it owns the
 *  roster, the seed, whose turn it is, the die and the turn clock, and nothing
 *  else. Every rule runs on the clients, which agree because they share the
 *  seed and because each turn draws from its own numbered random stream.
 *
 *  What that buys: the board is never sent (it is derived from the seed), a
 *  turn costs a handful of small messages, and the only per-frame traffic is
 *  the active player's field for the watchers. */

/** A seat at the table. One connection may own several — three people round one
 *  laptop are three seats on one socket. */
export interface RaceSeat {
  /** Index in turn order, assigned by the server when the race starts. */
  seat: number;
  name: string;
  /** Union letter index, or null for a lone racer. */
  team: number | null;
  /** Connection that plays this seat. */
  owner: string;
}

/** Client -> server. */
export type RaceUp =
  /** Take (or re-take) this connection's seats in the lobby. */
  | { k: 'claim'; seats: { name: string; team: number | null }[] }
  | { k: 'leave' }
  /** Host only: freeze the roster and deal the seed. */
  | { k: 'start'; distance: number }
  /** The active client, having finished its level. */
  | { k: 'result'; result: TurnResult }
  /** The active client, having played the roll and the walk. Turn order is the
   *  server's business, so these two facts about it travel: `reversed` flips it
   *  for good, `rewind` hands this one turn back to the previous player. */
  | { k: 'turnEnd'; reversed: boolean; rewind?: boolean }
  /** A watcher throws a card at the active seat. */
  | { k: 'card'; from: number; card: CardId }
  /** A watcher leafs a recharging slot to the next card in their reserve. */
  | { k: 'cycle'; from: number; slot: number }
  /** The active client's field, for the watchers. */
  | { k: 'snapshot'; snap: RaceSnapshot };

/** Server -> clients. */
export type RaceDown =
  | { k: 'lobby'; seats: RaceSeat[]; hostId: string; distance: number }
  | { k: 'started'; seed: number; distance: number; seats: RaceSeat[] }
  /** Whose turn, and which random stream it draws from. */
  | { k: 'turn'; seat: number; index: number }
  /** The die for the turn just played, with the result everyone scores it by. */
  | { k: 'roll'; seat: number; index: number; die: number; result: TurnResult }
  | { k: 'card'; from: number; card: CardId }
  | { k: 'cycle'; from: number; slot: number }
  | { k: 'snapshot'; seat: number; snap: RaceSnapshot }
  /** The active client went quiet: its turn is burnt and play moves on. */
  | { k: 'timeout'; seat: number }
  | { k: 'over'; seat: number };

/** A field snapshot for spectators. Bricks are the bulk of it and they change
 *  rarely, so `cells` is only filled when the wall actually changed; otherwise
 *  the watcher keeps the last one it saw. That takes the steady-state packet
 *  from ~300 bytes down to ~60, which is what keeps five watchers smooth. */
export interface RaceSnapshot extends Omit<FieldSnapshot, 'cells'> {
  cells?: string;
  /** Rises by one per snapshot; a watcher drops anything older than it has. */
  n: number;
  /** Seconds left on the turn clock, so watchers see the same countdown. */
  clock: number;
}

/** Snapshots per second for the race feed. Denser than the 1-on-1 mode's 0.12:
 *  a card is aimed at what the watcher sees, so a stale field is a missed throw
 *  rather than a cosmetic hiccup. Only the small packet travels this often. */
export const RACE_SNAPSHOT_INTERVAL = 0.07;
/** How often the brick wall is re-sent even when nothing appears to have
 *  changed, as a safety net for a watcher that joined mid-turn. */
export const RACE_CELLS_INTERVAL = 1.5;

/** Silence from the active client for this long and the server burns its turn.
 *  Comfortably longer than a boss turn's clock plus the roll and the walk. */
export const RACE_TURN_TIMEOUT = 180;
