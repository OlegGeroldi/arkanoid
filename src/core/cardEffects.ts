import type { Arena } from './arena';
import type { CardEffect } from './effects';
import { ENERGY_MAX } from './constants';

/** Applies a `CardEffect` to a live arena — the shared vocabulary the shop's
 *  purchased items use, pulled out so a caller can hand one straight to a
 *  pilot's arena without duplicating the switch. */
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
  }
}
