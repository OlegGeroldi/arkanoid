import type { PowerupId } from './powerups';
import type { DebuffId } from './debuffs';
import type { BallTypeId } from './balls';

/** What a shop item does to a live arena. Applied by `applyCardEffectToArena`. */
export type CardEffect =
  | { t: 'powerup'; id: PowerupId }
  | { t: 'debuff'; id: DebuffId }
  | { t: 'ball'; id: BallTypeId }
  /** Charges the super and fires it there and then. */
  | { t: 'super' }
  | { t: 'lives'; delta: number }
  /** Blows the energy nodes holding a boss's shield. */
  | { t: 'breakShield' };
