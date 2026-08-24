export type SuperId = 'barrage' | 'meteor' | 'fracture' | 'singularity';

export interface SuperDef {
  id: SuperId;
  name: string;
  icon: string;
  color: string;
  /** What it does to your own field. */
  desc: string;
  /** What it does to the opponent in versus modes. */
  pvp: string;
  duration: number;
  /** How fast this one fills, against the standard rate. Everything charges at
   *  the same pace unless a super has a reason not to. */
  chargeMul?: number;
  /** Account level required to unlock. */
  unlockLevel: number;
}

export const SUPERS: Record<SuperId, SuperDef> = {
  barrage: {
    id: 'barrage',
    name: 'Плазменный залп',
    icon: '⁘',
    color: '#ff7a3d',
    desc: 'Ракетка 5 секунд поливает поле плазмой; заряды прошивают неразрушимые кирпичи насквозь',
    pvp: 'Сопернику прилетает ряд мусорных кирпичей',
    duration: 5,
    unlockLevel: 1,
  },
  meteor: {
    id: 'meteor',
    name: 'Метеор',
    icon: '☄',
    color: '#ffd24d',
    desc: 'Все мячи 8 секунд горят: прошивают кирпичи и бьют по площади',
    pvp: 'Мяч соперника разгоняется на 8 секунд',
    duration: 8,
    // A quarter faster than the rest: the meteor is the one that keeps a race
    // moving, and waiting for it took the pace out of a turn.
    chargeMul: 1.25,
    unlockLevel: 1,
  },
  fracture: {
    id: 'fracture',
    name: 'Разлом времени',
    icon: '◷',
    color: '#4de2ff',
    desc: 'Время замедляется, ракетка растёт — 7 секунд полного контроля',
    pvp: 'Управление соперника инвертируется на 5 секунд',
    duration: 7,
    unlockLevel: 3,
  },
  singularity: {
    id: 'singularity',
    name: 'Сингулярность',
    icon: '◉',
    color: '#b06bff',
    desc: 'Чёрная дыра втягивает и перемалывает кирпичи вокруг себя',
    pvp: 'Поле соперника накрывает помехами на 6 секунд',
    duration: 6,
    unlockLevel: 5,
  },
};

export const SUPER_LIST: SuperDef[] = Object.values(SUPERS);
