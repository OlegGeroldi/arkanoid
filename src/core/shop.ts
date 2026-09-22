import type { CardEffect } from './race';
import { DEBUFFS } from './debuffs';

/** The team-round shop: credits earned from the trivia board buy a boost for your
 *  own pilot (or an ally's — see `target: 'self'` in `teamQuizDevice.ts`'s
 *  `buy()`), or a diversion aimed at a non-ally's. Deliberately not an
 *  autobroadcast-on-correct-answer system (the party host tried that and it
 *  didn't work: most quiz content here has no objectively correct answer) —
 *  credits are a resource the team spends on purpose, mid-round, while
 *  watching their pilot's field live.
 *
 *  Every item just wraps the same `CardEffect` the solo race already knows how
 *  to apply (`core/race.ts`), so the pilot scene needs no new effect-handling
 *  code at all — only a new source for the effect.
 *
 *  Credits *are* final score now (`TeamQuizStore.championId`/`matchAwardLines`
 *  rank by `core/teamRace.ts`'s `finalScore` — round bonuses plus whatever
 *  credits are left unspent) — spending is a real sacrifice against the
 *  match's own ending, not free money on top of it, so self-buffs don't need
 *  a steep price to feel costly: flat 20 each (2026-09-06). Rival-target
 *  debuffs stay tiered: cheap tactical ones ~100-130, stronger ones ~190-220.
 *  No `timeBoost` any more — a fixed per-level clock replaced the old
 *  open-ended round timer it used to extend. */

export type ShopItemId =
  | 'extraLife'
  | 'shield'
  | 'superCharge'
  | 'diceBoost'
  | 'sabotage'
  | 'mirror'
  | 'brittle'
  | 'repel'
  | 'steel'
  | 'blind'
  | 'haste'
  | 'jam'
  | 'drain'
  | 'quake'
  | 'teleportBack';

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
  diceBoost: {
    id: 'diceBoost',
    name: 'Tailwind',
    icon: '⇢',
    color: '#3ddc84',
    cost: 20,
    target: 'self',
    desc: '+1 to the next track dice roll',
    effect: { t: 'dice', delta: 1 },
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
  /** Not a `DEBUFFS`/`Arena.applyDebuff` effect like the others — a `cell`
   *  effect moves the target's track position directly, same vocabulary
   *  `core/race.ts`'s own `setback` boost card already uses (there, -3, free
   *  once drawn); a purchased, expensive-tier version goes further to
   *  justify the price. `teamQuizStore.ts`'s `applyPurchase` applies it to
   *  the target's `cell`, same special-case `applyBoost` already has. */
  teleportBack: {
    id: 'teleportBack',
    name: 'Teleport back',
    icon: '⏪',
    color: '#ff2d55',
    cost: 220,
    target: 'rival',
    desc: 'Yanks the rival 5 cells back on the shared track',
    effect: { t: 'cell', delta: -5 },
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
