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
    name: 'Широкая платформа',
    desc: '+18% к ширине ракетки',
    icon: '▬',
    maxStacks: 4,
    weight: 10,
    tags: ['defense', 'control'],
    apply: (s) => (s.paddleWidthMul *= 1.18),
  },
  {
    id: 'swift',
    name: 'Сервоприводы',
    desc: '+20% к скорости ракетки',
    icon: '»',
    maxStacks: 4,
    weight: 9,
    tags: ['control'],
    apply: (s) => (s.paddleSpeedMul *= 1.2),
  },
  {
    id: 'heavy',
    name: 'Тяжёлый мяч',
    desc: '+1 к урону мяча',
    icon: '●',
    maxStacks: 3,
    weight: 8,
    tags: ['weapon'],
    apply: (s) => (s.ballDamage += 1),
  },
  {
    id: 'crit',
    name: 'Критический удар',
    desc: '+15% шанс двойного урона',
    icon: '✶',
    maxStacks: 4,
    weight: 8,
    tags: ['weapon'],
    apply: (s) => (s.critChance += 0.15),
  },
  {
    id: 'greed',
    name: 'Жадность',
    desc: '+35% к шансу выпадения бонусов',
    icon: '◈',
    maxStacks: 3,
    weight: 9,
    tags: ['greed'],
    apply: (s) => (s.dropChanceMul *= 1.35),
  },
  {
    id: 'magnet',
    name: 'Магнит',
    desc: 'Бонусы притягиваются к ракетке',
    icon: '∪',
    maxStacks: 2,
    weight: 7,
    tags: ['greed', 'control'],
    apply: (s) => (s.magnet += 0.5),
  },
  {
    id: 'scholar',
    name: 'Аналитик',
    desc: '+25% к получаемому опыту',
    icon: '✦',
    maxStacks: 4,
    weight: 9,
    tags: ['greed'],
    apply: (s) => (s.xpMul *= 1.25),
  },
  {
    id: 'reactor',
    name: 'Реактор',
    desc: '+30% к набору энергии супера',
    icon: '⚡',
    maxStacks: 3,
    weight: 9,
    tags: ['weapon', 'greed'],
    apply: (s) => (s.energyMul *= 1.3),
  },
  {
    id: 'spare',
    name: 'Запасная жизнь',
    desc: '+1 жизнь немедленно',
    icon: '♥',
    maxStacks: 5,
    weight: 7,
    tags: ['defense'],
    apply: (s) => (s.bonusLives += 1),
    instant: { lives: 1 },
  },
  {
    id: 'twin',
    name: 'Близнецы',
    desc: '+1 мяч при каждой подаче',
    icon: '◎',
    maxStacks: 2,
    weight: 6,
    tags: ['element', 'weapon'],
    apply: (s) => (s.extraBalls += 1),
    instant: { balls: 1 },
  },
  {
    id: 'gunner',
    name: 'Штатный лазер',
    desc: 'Лазер всегда доступен',
    icon: '↑',
    maxStacks: 1,
    weight: 5,
    tags: ['weapon'],
    apply: (s) => (s.laserAlways = true),
  },
  {
    id: 'bulwark',
    name: 'Силовой барьер',
    desc: '+2 заряда нижнего барьера',
    icon: '▭',
    maxStacks: 3,
    weight: 7,
    tags: ['defense'],
    apply: (s) => (s.bonusShields += 2),
  },
  {
    id: 'medic',
    name: 'Регенерация',
    desc: 'Жизнь за каждый новый уровень',
    icon: '✚',
    maxStacks: 1,
    weight: 4,
    tags: ['defense'],
    apply: (s) => (s.lifePerLevel = true),
  },
  {
    id: 'streak',
    name: 'Серия',
    desc: '+4 к пределу комбо-множителя',
    icon: '∞',
    maxStacks: 3,
    weight: 7,
    tags: ['greed', 'control'],
    apply: (s) => (s.comboBonus += 4),
  },
  {
    id: 'volatile',
    name: 'Нестабильность',
    desc: '12% шанс, что кирпич взорвётся',
    icon: '✷',
    maxStacks: 4,
    weight: 7,
    tags: ['weapon', 'element'],
    apply: (s) => (s.explosiveTouch += 0.12),
  },
  {
    id: 'slowball',
    name: 'Контроль',
    desc: '−8% к скорости мяча',
    icon: '◁',
    maxStacks: 3,
    weight: 6,
    tags: ['control', 'defense'],
    apply: (s) => (s.ballSpeedMul *= 0.92),
  },
  {
    id: 'overcharge',
    name: 'Перезарядка',
    desc: '+40 энергии немедленно',
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
