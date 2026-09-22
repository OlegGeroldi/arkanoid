import type { Arena } from './arena';
import type { CardEffect } from './race';
import { ENERGY_MAX } from './constants';

/** Applies a `CardEffect` to a live arena — the same vocabulary the solo
 *  race's card throws already use (`CARDS` in `core/race.ts`), pulled out so
 *  the team quiz's shop can hand a purchased item straight to a pilot's
 *  arena without duplicating the switch.
 *
 *  Deliberately silent on `clock`, `dice` and `cell`: those adjust a turn's
 *  countdown, a next roll, or a team's track position — never the arena
 *  itself — so the caller (whichever owns that number) has to apply them. */
export function applyCardEffectToArena(effect: CardEffect, arena: Arena): void {
  switch (effect.t) {
    case 'powerup':
      arena.grantPowerup(effect.id);
      break;
    case 'debuff':
      arena.applyDebuff(effect.id);
      break;
    case 'ball':
      if (arena.balls.length === 0) arena.addBall();
      arena.setBallType(effect.id);
      break;
    case 'super':
      arena.energy = ENERGY_MAX;
      arena.fireSuper();
      break;
    case 'lives':
      arena.lives += effect.delta;
      break;
    case 'breakShield':
      arena.breakShieldNodes();
      break;
    case 'clock':
    case 'dice':
    case 'cell':
      break;
  }
}
