import type { CardEffect } from './effects';
import { DEBUFFS } from './debuffs';

/** The show's shop: coins buy a buff for yourself or an ally, or a debuff for a non-ally. Bought items land at the start of the next arena. */

export type ShopItemId =
  | 'extraLife'
  | 'shield'
  | 'superCharge'
  | 'sabotage'
  | 'mirror'
  | 'brittle'
  | 'repel'
  | 'steel'
  | 'blind'
  | 'haste'
  | 'jam'
  | 'drain'
  | 'quake';

export interface ShopItem {
  id: ShopItemId;
  name: string;
  icon: string;
  color: string;
  cost: number;
  desc: string;
  /** Every item but the diversion lands on your own pilot's field; `sabotage`
   *  is the one that reaches across to the rival instead. */
  target: 'self' | 'rival';
  effect: CardEffect;
}

export const SHOP_ITEMS: Record<ShopItemId, ShopItem> = {
  extraLife: {
    id: 'extraLife',
    name: 'Extra life',
    icon: '♥',
    color: '#ff5fa2',
    cost: 20,
    target: 'self',
    desc: '+1 life for the pilot right now',
    effect: { t: 'powerup', id: 'life' },
  },
  shield: {
    id: 'shield',
    name: 'Shield',
    icon: '▭',
    color: '#4de2ff',
    cost: 20,
    target: 'self',
    desc: 'A barrier at the bottom catches a falling ball',
    effect: { t: 'powerup', id: 'shield' },
  },
  superCharge: {
    id: 'superCharge',
    name: 'Super strike',
    icon: '⁂',
    color: '#ff7a3d',
    cost: 20,
    target: 'self',
    desc: 'Super charges up and fires immediately',
    effect: { t: 'super' },
  },
  sabotage: {
    id: 'sabotage',
    name: 'Sabotage',
    icon: '❄',
    color: '#ff4d6d',
    cost: 110,
    target: 'rival',
    desc: 'Frost the rival: their paddle crawls',
    effect: { t: 'debuff', id: 'frost' },
  },
  // The other nine sabotage capsules (`core/debuffs.ts`) already have full
  // gameplay behind them via `Arena.applyDebuff` — PvP-only balls before
  // this, sitting unused since nothing ever purchased one by that route.
  // Wired in verbatim, reusing each entry's own icon/color/desc rather than
  // re-describing them, so this list and `DEBUFF_LIST` can't drift apart.
  mirror: {
    id: 'mirror',
    name: DEBUFFS.mirror.name,
    icon: DEBUFFS.mirror.icon,
    color: DEBUFFS.mirror.color,
    cost: 190,
    target: 'rival',
    desc: DEBUFFS.mirror.desc,
    effect: { t: 'debuff', id: 'mirror' },
  },
  brittle: {
    id: 'brittle',
    name: DEBUFFS.brittle.name,
    icon: DEBUFFS.brittle.icon,
    color: DEBUFFS.brittle.color,
    cost: 190,
    target: 'rival',
    desc: DEBUFFS.brittle.desc,
    effect: { t: 'debuff', id: 'brittle' },
  },
  repel: {
    id: 'repel',
    name: DEBUFFS.repel.name,
    icon: DEBUFFS.repel.icon,
    color: DEBUFFS.repel.color,
    cost: 100,
    target: 'rival',
    desc: DEBUFFS.repel.desc,
    effect: { t: 'debuff', id: 'repel' },
  },
  steel: {
    id: 'steel',
    name: DEBUFFS.steel.name,
    icon: DEBUFFS.steel.icon,
    color: DEBUFFS.steel.color,
    cost: 200,
    target: 'rival',
    desc: DEBUFFS.steel.desc,
    effect: { t: 'debuff', id: 'steel' },
  },
  blind: {
    id: 'blind',
    name: DEBUFFS.blind.name,
    icon: DEBUFFS.blind.icon,
    color: DEBUFFS.blind.color,
    cost: 115,
    target: 'rival',
    desc: DEBUFFS.blind.desc,
    effect: { t: 'debuff', id: 'blind' },
  },
  haste: {
    id: 'haste',
    name: DEBUFFS.haste.name,
    icon: DEBUFFS.haste.icon,
    color: DEBUFFS.haste.color,
    cost: 120,
    target: 'rival',
    desc: DEBUFFS.haste.desc,
    effect: { t: 'debuff', id: 'haste' },
  },
  jam: {
    id: 'jam',
    name: DEBUFFS.jam.name,
    icon: DEBUFFS.jam.icon,
    color: DEBUFFS.jam.color,
    cost: 200,
    target: 'rival',
    desc: DEBUFFS.jam.desc,
    effect: { t: 'debuff', id: 'jam' },
  },
  drain: {
    id: 'drain',
    name: DEBUFFS.drain.name,
    icon: DEBUFFS.drain.icon,
    color: DEBUFFS.drain.color,
    cost: 125,
    target: 'rival',
    desc: DEBUFFS.drain.desc,
    effect: { t: 'debuff', id: 'drain' },
  },
  quake: {
    id: 'quake',
    name: DEBUFFS.quake.name,
    icon: DEBUFFS.quake.icon,
    color: DEBUFFS.quake.color,
    cost: 210,
    target: 'rival',
    desc: DEBUFFS.quake.desc,
    effect: { t: 'debuff', id: 'quake' },
  },
};

export const SHOP_LIST: ShopItem[] = Object.values(SHOP_ITEMS);

export function canAfford(credits: number, item: ShopItem): boolean {
  return credits >= item.cost;
}

/** Returns the credits left after the purchase, or null if it couldn't be
 *  afforded — the caller applies `item.effect` only once this returns
 *  non-null, so a purchase either fully happens or not at all. */
export function purchase(credits: number, item: ShopItem): number | null {
  if (!canAfford(credits, item)) return null;
  return credits - item.cost;
}
