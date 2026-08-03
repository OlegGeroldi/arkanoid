import type { DebuffId } from '../core/debuffs';
import type { SuperId } from '../core/supers';

/** Messages exchanged during a networked match, carried by the room server's
 *  `relay` channel. Everything is small and idempotent-ish: a dropped packet
 *  costs one attack or one frame of the opponent's field, never the match. */
export type MatchMessage =
  | { k: 'ready'; name: string; superId: SuperId }
  | { k: 'start'; seed: number; levelIndex: number; lives: number }
  | { k: 'snapshot'; snap: FieldSnapshot }
  | { k: 'attack'; kind: 'garbage'; rows: number }
  | { k: 'attack'; kind: 'hazard'; hazard: 'invert' | 'fog' | 'haste'; seconds: number }
  | { k: 'attack'; kind: 'debuff'; id: DebuffId }
  | { k: 'over'; loser: string };

/** What the opponent needs to draw your field. Bricks travel as a bitmask
 *  string — one character per cell — which keeps a full field under 300 bytes. */
export interface FieldSnapshot {
  /** '0' empty, otherwise the brick's code letter. */
  cells: string;
  cols: number;
  paddleX: number;
  paddleW: number;
  balls: { x: number; y: number }[];
  score: number;
  lives: number;
  xpLevel: number;
  combo: number;
  energy: number;
}

export const SNAPSHOT_INTERVAL = 0.12;
