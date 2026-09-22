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

/** A live field for the TV. `cells` only travels when the wall changed. */
export interface ArenaSnapshot extends Omit<FieldSnapshot, 'cells'> {
  cells?: string;
  /** Rises by one per snapshot; older ones are dropped. */
  n: number;
  /** Seconds left on the arena clock. */
  clock: number;
}

/** Ten a second: ten fields on one TV, so half the old race rate. */
export const SNAPSHOT_INTERVAL = 0.1;
/** Safety re-send of the brick wall for a TV that joined mid-arena. */
export const CELLS_INTERVAL = 1.5;
