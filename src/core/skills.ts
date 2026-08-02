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
}

export const SKILLS: Record<SkillId, SkillDef> = {
  magnet: {
    id: 'magnet',
    name: 'Магнетизм',
    icon: '∪',
    color: '#4de2ff',
    desc: 'Ракетка притягивает мяч и все бонусы',
    cooldown: 60,
    duration: 5,
    unlockLevel: 1,
    ranks: ['+3 секунды действия', 'притяжение вдвое сильнее'],
    school: 'warden',
  },
  fireball: {
    id: 'fireball',
    name: 'Файрбол',
    icon: '☄',
    color: '#ff6a2b',
    desc: 'Выстрел, прошивающий колонну кирпичей насквозь',
    cooldown: 60,
    unlockLevel: 1,
    ranks: ['тройной урон и шире след', 'ломает даже неразрушимые блоки'],
    school: 'gunner',
  },
  teleport: {
    id: 'teleport',
    name: 'Телепорт',
    icon: '⇄',
    color: '#b06bff',
    desc: 'Ракетка мгновенно оказывается под мячом',
    cooldown: 25,
    unlockLevel: 2,
    ranks: ['мяч слегка замедляется после переноса', 'переносит и отбивает вверх по центру'],
  },
  barrier: {
    id: 'barrier',
    name: 'Барьер',
    icon: '▭',
    color: '#3ddc84',
    desc: 'Пол ловит мяч и возвращает его в игру',
    cooldown: 45,
    duration: 8,
    unlockLevel: 2,
    ranks: ['+4 секунды', 'барьер ещё и ускоряет мяч вверх'],
    school: 'warden',
  },
  stasis: {
    id: 'stasis',
    name: 'Стазис',
    icon: '◷',
    color: '#8ef0ff',
    desc: 'Мячи замедляются вдвое — время подумать',
    cooldown: 40,
    duration: 4,
    unlockLevel: 3,
    ranks: ['+2 секунды', 'ракетка при этом шире на 30%'],
    school: 'warden',
  },
  ghost: {
    id: 'ghost',
    name: 'Двойник',
    icon: '◫',
    color: '#7c6cff',
    desc: 'Зеркальная ракетка-призрак отбивает мяч наравне с вами',
    cooldown: 70,
    duration: 10,
    unlockLevel: 4,
    ranks: ['+5 секунд', 'призрак тоже стреляет лазером'],
  },
  drone: {
    id: 'drone',
    name: 'Дрон',
    icon: '⌁',
    color: '#ffd24d',
    desc: 'Турель над ракеткой сама расстреливает кирпичи',
    cooldown: 60,
    duration: 10,
    unlockLevel: 4,
    ranks: ['стреляет вдвое чаще', 'второй дрон'],
    school: 'gunner',
  },
  hammer: {
    id: 'hammer',
    name: 'Молот',
    icon: '⬢',
    color: '#ff7a3d',
    desc: 'Следующий удар мяча наносит пятикратный урон',
    cooldown: 30,
    unlockLevel: 3,
    ranks: ['держится на три удара', 'удар ещё и взрывается'],
    school: 'gunner',
  },
  chain: {
    id: 'chain',
    name: 'Разряд',
    icon: '⚡',
    color: '#c46bff',
    desc: 'Молния бьёт по пяти случайным кирпичам',
    cooldown: 35,
    unlockLevel: 5,
    ranks: ['девять кирпичей', 'каждый разряд оставляет взрыв'],
    school: 'elementalist',
  },
  repair: {
    id: 'repair',
    name: 'Ремонт',
    icon: '✚',
    color: '#ff5fa2',
    desc: 'Возвращает одну жизнь',
    cooldown: 180,
    unlockLevel: 6,
    ranks: ['перезарядка вдвое короче', '+2 жизни за раз'],
    school: 'warden',
  },
  rain: {
    id: 'rain',
    name: 'Дождь бонусов',
    icon: '❋',
    color: '#3ddc84',
    desc: 'С неба сыплются шесть капсул',
    cooldown: 90,
    unlockLevel: 5,
    ranks: ['десять капсул', 'среди них всегда элементальный шар'],
    school: 'elementalist',
  },
  multiball: {
    id: 'multiball',
    name: 'Мультибол',
    icon: '◎',
    color: '#ffd24d',
    desc: 'Выпускает два дополнительных мяча',
    cooldown: 50,
    unlockLevel: 2,
    ranks: ['четыре мяча вместо двух', 'новые мячи приходят элементальными'],
    school: 'elementalist',
  },
  glue: {
    id: 'glue',
    name: 'Клей',
    icon: '≈',
    color: '#9fb3c8',
    desc: 'Ракетка ловит мяч на несколько секунд',
    cooldown: 20,
    duration: 4,
    unlockLevel: 2,
    ranks: ['+3 секунды', 'пойманный мяч заряжается уроном'],
  },
};

export const SKILL_LIST: SkillDef[] = Object.values(SKILLS);

/** Cooldown at a given rank: each rank past the first trims 15%. */
export const skillCooldown = (def: SkillDef, rank: number): number =>
  def.cooldown * Math.pow(0.85, Math.max(0, rank - 1));

/** Duration at a given rank: rank II adds a flat bonus, rank III keeps it. */
export function skillDuration(def: SkillDef, rank: number): number {
  const base = def.duration ?? 0;
  if (rank <= 1) return base;
  const bonus = def.id === 'barrier' ? 4 : def.id === 'ghost' ? 5 : def.id === 'stasis' ? 2 : 3;
  return base + bonus;
}

export const MAX_RANK = 3;
export const SKILL_SLOTS = 2;
