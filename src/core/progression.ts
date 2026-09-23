import type { Rng } from './rng';
import type { PerkTag } from './specialisation';

/** Every gameplay number a perk is allowed to touch. The arena reads these each
 *  tick, so a perk never has to reach into arena internals. */
export interface RunStats {
  paddleWidthMul: number;
  paddleSpeedMul: number;
  ballSpeedMul: number;
  ballDamage: number;
  dropChanceMul: number;
  xpMul: number;
  energyMul: number;
  critChance: number;
  magnet: number;
  extraBalls: number;
  bonusLives: number;
  laserAlways: boolean;
  bonusShields: number;
  lifePerLevel: boolean;
  comboBonus: number;
  explosiveTouch: number;
  serveGrace: number;
}

export function baseStats(): RunStats {
  return {
    paddleWidthMul: 1,
    paddleSpeedMul: 1,
    ballSpeedMul: 1,
    ballDamage: 1,
    dropChanceMul: 1,
    xpMul: 1,
    energyMul: 1,
    critChance: 0,
    magnet: 0,
    extraBalls: 0,
    bonusLives: 0,
    laserAlways: false,
    bonusShields: 0,
    lifePerLevel: false,
    comboBonus: 0,
    explosiveTouch: 0,
    serveGrace: 0,
  };
}

export interface Perk {
  id: string;
  name: string;
  desc: string;
  icon: string;
  maxStacks: number;
  /** Higher = shows up more often in a draft. */
  weight: number;
  /** Families this perk belongs to; a specialisation favours some of them. */
  tags: PerkTag[];
  apply(s: RunStats): void;
  /** Applied once, immediately, on pick (lives, energy, extra ball in play). */
  instant?: { lives?: number; energy?: number; balls?: number };
}

export const PERKS: Perk[] = [
  {
    id: 'wide',
    name: 'Wide Paddle',
    desc: '+18% paddle width',
    icon: '▬',
    maxStacks: 4,
    weight: 10,
    tags: ['defense', 'control'],
    apply: (s) => (s.paddleWidthMul *= 1.18),
  },
  {
    id: 'swift',
    name: 'Servo Drives',
    desc: '+20% paddle speed',
    icon: '»',
    maxStacks: 4,
    weight: 9,
    tags: ['control'],
    apply: (s) => (s.paddleSpeedMul *= 1.2),
  },
  {
    id: 'heavy',
    name: 'Heavy Ball',
    desc: '+1 ball damage',
    icon: '●',
    maxStacks: 3,
    weight: 8,
    tags: ['weapon'],
    apply: (s) => (s.ballDamage += 1),
  },
  {
    id: 'crit',
    name: 'Critical Hit',
    desc: '+15% chance of double damage',
    icon: '✶',
    maxStacks: 4,
    weight: 8,
    tags: ['weapon'],
    apply: (s) => (s.critChance += 0.15),
  },
  {
    id: 'greed',
    name: 'Greed',
    desc: '+35% power-up drop chance',
    icon: '◈',
    maxStacks: 3,
    weight: 9,
    tags: ['greed'],
    apply: (s) => (s.dropChanceMul *= 1.35),
  },
  {
    id: 'magnet',
    name: 'Magnet',
    desc: 'Power-ups get pulled toward the paddle',
    icon: '∪',
    maxStacks: 2,
    weight: 7,
    tags: ['greed', 'control'],
    apply: (s) => (s.magnet += 0.5),
  },
  {
    id: 'scholar',
    name: 'Analyst',
    desc: '+25% XP earned',
    icon: '✦',
    maxStacks: 4,
    weight: 9,
    tags: ['greed'],
    apply: (s) => (s.xpMul *= 1.25),
  },
  {
    id: 'reactor',
    name: 'Reactor',
    desc: '+30% super energy gain',
    icon: '⚡',
    maxStacks: 3,
    weight: 9,
    tags: ['weapon', 'greed'],
    apply: (s) => (s.energyMul *= 1.3),
  },
  {
    id: 'spare',
    name: 'Spare Life',
    desc: '+1 life immediately',
    icon: '♥',
    maxStacks: 5,
    weight: 7,
    tags: ['defense'],
    apply: (s) => (s.bonusLives += 1),
    instant: { lives: 1 },
  },
  {
    id: 'twin',
    name: 'Twins',
    desc: '+1 ball on every serve',
    icon: '◎',
    maxStacks: 2,
    weight: 6,
    tags: ['element', 'weapon'],
    apply: (s) => (s.extraBalls += 1),
    instant: { balls: 1 },
  },
  {
    id: 'gunner',
    name: 'Standing Laser',
    desc: 'The laser is always available',
    icon: '↑',
    maxStacks: 1,
    weight: 5,
    tags: ['weapon'],
    apply: (s) => (s.laserAlways = true),
  },
  {
    id: 'bulwark',
    name: 'Power Barrier',
    desc: '+2 charges of the bottom barrier',
    icon: '▭',
    maxStacks: 3,
    weight: 7,
    tags: ['defense'],
    apply: (s) => (s.bonusShields += 2),
  },
  {
    id: 'medic',
    name: 'Regeneration',
    desc: 'A life on every new level',
    icon: '✚',
    maxStacks: 1,
    weight: 4,
    tags: ['defense'],
    apply: (s) => (s.lifePerLevel = true),
  },
  {
    id: 'streak',
    name: 'Streak',
    desc: '+4 to the combo multiplier cap',
    icon: '∞',
    maxStacks: 3,
    weight: 7,
    tags: ['greed', 'control'],
    apply: (s) => (s.comboBonus += 4),
  },
  {
    id: 'volatile',
    name: 'Volatility',
    desc: '12% chance a brick explodes',
    icon: '✷',
    maxStacks: 4,
    weight: 7,
    tags: ['weapon', 'element'],
    apply: (s) => (s.explosiveTouch += 0.12),
  },
  {
    id: 'slowball',
    name: 'Control',
    desc: '−8% ball speed',
    icon: '◁',
    maxStacks: 3,
    weight: 6,
    tags: ['control', 'defense'],
    apply: (s) => (s.ballSpeedMul *= 0.92),
  },
  {
    id: 'overcharge',
    name: 'Overcharge',
    desc: '+40 energy immediately',
    icon: '◍',
    maxStacks: 5,
    weight: 6,
    tags: ['weapon', 'greed'],
    apply: () => {},
    instant: { energy: 40 },
  },
];

const PERK_BY_ID = new Map(PERKS.map((p) => [p.id, p]));
export const getPerk = (id: string): Perk | undefined => PERK_BY_ID.get(id);

/** Global XP throttle. Levelling inside a run is deliberately slow: perks are a
 *  reward for a long clean streak, not something you collect every screen. */
export const XP_RATE = 0.05;

/** XP needed to go from `level` to `level + 1` inside a run. The curve is steep
 *  on purpose — later perks should cost several levels of the campaign. */
export const xpForLevel = (level: number): number => Math.round(110 * Math.pow(level, 1.5));

/** Draft of three perks, respecting stack limits. Uses the arena's seeded RNG so
 *  a replayed run offers the same choices. */
export function rollPerks(
  rng: Rng,
  taken: Map<string, number>,
  count = 3,
  favours: PerkTag[] = [],
): Perk[] {
  const pool: Perk[] = [];
  for (const perk of PERKS) {
    if ((taken.get(perk.id) ?? 0) >= perk.maxStacks) continue;
    // A specialisation triples the weight of the families it favours, so the
    // draft starts leaning the way the player committed to.
    const bias = favours.length && perk.tags.some((t) => favours.includes(t)) ? 3 : 1;
    for (let i = 0; i < perk.weight * bias; i++) pool.push(perk);
  }
  const picked: Perk[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (picked.length < count && pool.length > 0 && guard++ < 400) {
    const p = rng.pick(pool);
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    picked.push(p);
  }
  return picked;
}

/** Persistent account progression across runs. */
export const accountXpForLevel = (level: number): number => Math.round(1200 * Math.pow(level, 1.15));

export function accountLevelFromXp(totalXp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  for (;;) {
    const need = accountXpForLevel(level);
    if (rest < need || level > 200) return { level, into: rest, need };
    rest -= need;
    level++;
  }
}
