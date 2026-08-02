export type BossId = 'sentinel' | 'weaver' | 'core' | 'doh';

export interface BossDef {
  id: BossId;
  name: string;
  color: string;
  hp: number;
  /** Horizontal speed, px/s. */
  speed: number;
  /** Seconds between shots in phase 2. */
  fireRate: number;
  /** Body size. */
  w: number;
  h: number;
  taunt: string;
}

/** Bosses are their own entity rather than a brick arrangement: they move,
 *  shoot back and change behaviour as their HP drops. */
export const BOSSES: Record<BossId, BossDef> = {
  sentinel: {
    id: 'sentinel',
    name: 'Страж',
    color: '#4de2ff',
    hp: 40,
    speed: 70,
    fireRate: 1.6,
    w: 120,
    h: 44,
    taunt: 'Периметр закрыт',
  },
  weaver: {
    id: 'weaver',
    name: 'Ткач',
    color: '#3ddc84',
    hp: 60,
    speed: 130,
    fireRate: 1.05,
    w: 104,
    h: 40,
    taunt: 'Сеть уже сплетена',
  },
  core: {
    id: 'core',
    name: 'Ядро',
    color: '#b06bff',
    hp: 95,
    speed: 55,
    fireRate: 0.85,
    w: 150,
    h: 52,
    taunt: 'Реактор не остановить',
  },
  doh: {
    id: 'doh',
    name: 'DOH',
    color: '#ff4d6d',
    hp: 150,
    speed: 105,
    fireRate: 0.65,
    w: 168,
    h: 60,
    taunt: 'Ты дошёл слишком далеко',
  },
};

export const BOSS_LIST: BossDef[] = Object.values(BOSSES);

/** Which boss guards a given campaign level, if any. Every tenth level, with
 *  the roster getting nastier and DOH waiting at 100. */
export function bossForLevel(index: number): BossId | null {
  const level = index + 1;
  if (level % 10 !== 0) return null;
  if (level === 100) return 'doh';
  if (level >= 80) return 'core';
  if (level >= 40) return 'weaver';
  return 'sentinel';
}

/** Chaos levels can also spring a boss at random — 81-100 only. */
export function chaosBossChance(index: number): number {
  return index + 1 >= 81 ? 0.25 : 0;
}
