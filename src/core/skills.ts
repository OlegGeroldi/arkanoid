import type { SpecId } from './specialisation';

export type SkillId =
  | 'magnet'
  | 'fireball'
  | 'teleport'
  | 'barrier'
  | 'stasis'
  | 'ghost'
  | 'drone'
  | 'hammer'
  | 'chain'
  | 'repair'
  | 'rain'
  | 'glue'
  | 'multiball';

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  color: string;
  desc: string;
  /** Seconds between uses at rank I. Each rank shaves 15% off. */
  cooldown: number;
  /** Seconds the effect lasts at rank I, where that applies. */
  duration?: number;
  /** Account level needed to equip it. */
  unlockLevel: number;
  /** What ranks II and III change, for the tooltip. */
  ranks: [string, string];
  /** Specialisation this skill belongs to; its school offers it more readily. */
  school?: SpecId;
  /** Starts each level on cooldown instead of ready. The strongest openers
   *  should be earned inside the level rather than fired in its first second. */
  warmup?: boolean;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  magnet: {
    id: 'magnet',
    name: 'Magnetism',
    icon: '∪',
    color: '#4de2ff',
    desc: 'The paddle attracts the ball and every power-up',
    cooldown: 60,
    duration: 5,
    unlockLevel: 1,
    warmup: true,
    ranks: ['+3 seconds of effect', 'twice the pull strength'],
    school: 'warden',
  },
  fireball: {
    id: 'fireball',
    name: 'Fireball',
    icon: '☄',
    color: '#ff6a2b',
    desc: 'A shot that pierces straight through a column of bricks',
    cooldown: 60,
    unlockLevel: 1,
    warmup: true,
    ranks: ['triple damage and a wider trail', 'breaks even unbreakable blocks'],
    school: 'gunner',
  },
  teleport: {
    id: 'teleport',
    name: 'Teleport',
    icon: '⇄',
    color: '#b06bff',
    desc: 'The paddle instantly appears under the ball',
    cooldown: 25,
    unlockLevel: 2,
    ranks: ['the ball slows slightly after the jump', 'jumps and bounces straight up from center'],
  },
  barrier: {
    id: 'barrier',
    name: 'Barrier',
    icon: '▭',
    color: '#3ddc84',
    desc: 'The floor catches the ball and returns it to play',
    cooldown: 45,
    duration: 8,
    unlockLevel: 2,
    ranks: ['+4 seconds', 'the barrier also speeds the ball back up'],
    school: 'warden',
  },
  stasis: {
    id: 'stasis',
    name: 'Stasis',
    icon: '◷',
    color: '#8ef0ff',
    desc: 'Balls slow to half speed — time to think',
    cooldown: 40,
    duration: 4,
    unlockLevel: 3,
    ranks: ['+2 seconds', 'the paddle is also 30% wider'],
    school: 'warden',
  },
  ghost: {
    id: 'ghost',
    name: 'Double',
    icon: '◫',
    color: '#7c6cff',
    desc: 'A mirrored ghost paddle bounces the ball alongside you',
    cooldown: 70,
    duration: 10,
    unlockLevel: 4,
    ranks: ['+5 seconds', 'the ghost also fires a laser'],
  },
  drone: {
    id: 'drone',
    name: 'Drone',
    icon: '⌁',
    color: '#ffd24d',
    desc: 'A turret above the paddle shoots bricks on its own',
    cooldown: 60,
    duration: 10,
    unlockLevel: 4,
    ranks: ['fires twice as often', 'a second drone'],
    school: 'gunner',
  },
  hammer: {
    id: 'hammer',
    name: 'Hammer',
    icon: '⬢',
    color: '#ff7a3d',
    desc: "The ball's next hit deals five times the damage",
    cooldown: 30,
    unlockLevel: 3,
    ranks: ['lasts for three hits', 'the hit also explodes'],
    school: 'gunner',
  },
  chain: {
    id: 'chain',
    name: 'Discharge',
    icon: '⚡',
    color: '#c46bff',
    desc: 'Lightning strikes five random bricks',
    cooldown: 35,
    unlockLevel: 5,
    ranks: ['nine bricks', 'each strike leaves an explosion'],
    school: 'elementalist',
  },
  repair: {
    id: 'repair',
    name: 'Repair',
    icon: '✚',
    color: '#ff5fa2',
    desc: 'Returns one life',
    cooldown: 180,
    unlockLevel: 6,
    ranks: ['half the cooldown', '+2 lives at once'],
    school: 'warden',
  },
  rain: {
    id: 'rain',
    name: 'Bonus Rain',
    icon: '❋',
    color: '#3ddc84',
    desc: 'Six capsules rain down from the sky',
    cooldown: 90,
    unlockLevel: 5,
    ranks: ['ten capsules', 'always includes an elemental ball'],
    school: 'elementalist',
  },
  multiball: {
    id: 'multiball',
    name: 'Multiball',
    icon: '◎',
    color: '#ffd24d',
    desc: 'Releases two extra balls',
    cooldown: 50,
    unlockLevel: 2,
    ranks: ['four balls instead of two', 'new balls arrive elemental'],
    school: 'elementalist',
  },
  glue: {
    id: 'glue',
    name: 'Glue',
    icon: '≈',
    color: '#9fb3c8',
    desc: 'The paddle catches the ball for a few seconds',
    cooldown: 20,
    duration: 4,
    unlockLevel: 2,
    ranks: ['+3 seconds', 'the caught ball charges up with damage'],
  },
};

export const SKILL_LIST: SkillDef[] = Object.values(SKILLS);

/** Cooldown at a given rank: each rank past the first trims 15%. */
/** Global cooldown scale. Halved on Oleg's call: abilities that come round once
 *  a minute were being carried unused into the next level, and in a race turn of
 *  75 seconds a 60-second skill fired at most once. */
export const COOLDOWN_SCALE = 0.5;

export const skillCooldown = (def: SkillDef, rank: number): number =>
  def.cooldown * COOLDOWN_SCALE * Math.pow(0.85, Math.max(0, rank - 1));

/** Duration at a given rank: rank II adds a flat bonus, rank III keeps it. */
export function skillDuration(def: SkillDef, rank: number): number {
  const base = def.duration ?? 0;
  if (rank <= 1) return base;
  const bonus = def.id === 'barrier' ? 4 : def.id === 'ghost' ? 5 : def.id === 'stasis' ? 2 : 3;
  return base + bonus;
}

export const MAX_RANK = 3;
export const SKILL_SLOTS = 2;
