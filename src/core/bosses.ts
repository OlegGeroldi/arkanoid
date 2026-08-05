export type BossId = 'sentinel' | 'weaver' | 'core' | 'doh';

export interface BossDef {
  id: BossId;
  name: string;
  color: string;
  hp: number;
  /** Horizontal speed, px/s. */
  speed: number;
  /** Seconds between shots in phase 2. Doubled across the roster on Oleg's
   *  call: the bosses were laying down more fire than a two-life turn can
   *  survive, and the fight is meant to be about the shield, not dodging. */
  fireRate: number;
  /** Body size. */
  w: number;
  h: number;
  taunt: string;
  /** Some bosses hide behind the level's bricks; others are exposed from the
   *  first second and have to be fought head-on. */
  shielded: boolean;
  /** Pushes rows down from the very start rather than only when desperate. */
  pushesFromStart: boolean;
  /** Seconds between row pushes once pushing has begun. */
  pushEvery: number;
  /** How this one behaves, for the intro line. */
  gimmick: string;
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
    fireRate: 3.2,
    w: 120,
    h: 44,
    taunt: 'Периметр закрыт',
    shielded: true,
    pushesFromStart: false,
    pushEvery: 9,
    gimmick: 'Прячется за кирпичами, пока щит цел',
  },
  weaver: {
    id: 'weaver',
    name: 'Ткач',
    color: '#3ddc84',
    hp: 60,
    speed: 130,
    fireRate: 2.1,
    w: 104,
    h: 40,
    taunt: 'Сеть уже сплетена',
    // No shield: fast, exposed, and it starts weaving rows down immediately.
    shielded: false,
    pushesFromStart: true,
    pushEvery: 11,
    gimmick: 'Без щита, но с первой секунды гонит ряды вниз',
  },
  core: {
    id: 'core',
    name: 'Ядро',
    color: '#b06bff',
    hp: 95,
    speed: 55,
    fireRate: 1.7,
    w: 150,
    h: 52,
    taunt: 'Реактор не остановить',
    shielded: true,
    pushesFromStart: true,
    pushEvery: 7,
    gimmick: 'Щит и постоянное давление рядами',
  },
  doh: {
    id: 'doh',
    name: 'DOH',
    color: '#ff4d6d',
    hp: 150,
    speed: 105,
    fireRate: 1.3,
    w: 168,
    h: 60,
    taunt: 'Ты дошёл слишком далеко',
    shielded: false,
    pushesFromStart: true,
    pushEvery: 6,
    gimmick: 'Ни щита, ни пощады: залпы и ряды без перерыва',
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
