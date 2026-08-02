export type DebuffId =
  | 'frost'
  | 'mirror'
  | 'brittle'
  | 'repel'
  | 'steel'
  | 'blind'
  | 'haste'
  | 'jam'
  | 'drain'
  | 'quake';

export interface DebuffDef {
  id: DebuffId;
  name: string;
  icon: string;
  /** Capsule letter, kept distinct from the elemental balls. */
  letter: string;
  color: string;
  /** What it does to the opponent. */
  desc: string;
  /** Seconds the sabotage lasts on the receiving side (0 = instant effect). */
  duration: number;
  /** How long your ball stays charged with it. */
  ballDuration: number;
  /** Bricks you must break to fire one charge at the opponent. */
  perCharge: number;
}

/** Ten sabotage balls, PvP only. You pick up a capsule, your ball takes on its
 *  colour, and every few bricks you break sends the effect to the other side —
 *  so pressure comes from playing well, not from a lucky drop. */
export const DEBUFFS: Record<DebuffId, DebuffDef> = {
  frost: {
    id: 'frost',
    name: 'Мороз',
    icon: '❄',
    letter: '1',
    color: '#8ef0ff',
    desc: 'Ракетка соперника тяжелеет и еле ползёт',
    duration: 6,
    ballDuration: 14,
    perCharge: 3,
  },
  mirror: {
    id: 'mirror',
    name: 'Зеркало',
    icon: '↔',
    letter: '2',
    color: '#ff5fa2',
    desc: 'Управление соперника переворачивается',
    duration: 5,
    ballDuration: 14,
    perCharge: 4,
  },
  brittle: {
    id: 'brittle',
    name: 'Хрупкость',
    icon: '⋯',
    letter: '3',
    color: '#ff7a3d',
    desc: 'Ракетка соперника крошится с каждым отбитым мячом',
    duration: 9,
    ballDuration: 14,
    perCharge: 4,
  },
  repel: {
    id: 'repel',
    name: 'Антимагнит',
    icon: '⊗',
    letter: '4',
    color: '#b06bff',
    desc: 'Бонусы шарахаются от ракетки соперника',
    duration: 8,
    ballDuration: 14,
    perCharge: 3,
  },
  steel: {
    id: 'steel',
    name: 'Сталь',
    icon: '▦',
    letter: '5',
    color: '#9fb3c8',
    desc: 'Сопернику падает ряд стальных кирпичей',
    duration: 0,
    ballDuration: 12,
    perCharge: 6,
  },
  blind: {
    id: 'blind',
    name: 'Помехи',
    icon: '▓',
    letter: '6',
    color: '#5a6472',
    desc: 'Поле соперника заливает рябью',
    duration: 6,
    ballDuration: 14,
    perCharge: 4,
  },
  haste: {
    id: 'haste',
    name: 'Разгон',
    icon: '≫',
    letter: '7',
    color: '#ff4d6d',
    desc: 'Мяч соперника разгоняется',
    duration: 8,
    ballDuration: 14,
    perCharge: 4,
  },
  jam: {
    id: 'jam',
    name: 'Глушилка',
    icon: '⌁',
    letter: '8',
    color: '#ffd24d',
    desc: 'Скиллы соперника уходят на перезарядку',
    duration: 10,
    ballDuration: 12,
    perCharge: 5,
  },
  drain: {
    id: 'drain',
    name: 'Вампир',
    icon: '◍',
    letter: '9',
    color: '#c46bff',
    desc: 'Забирает энергию супера соперника себе',
    duration: 0,
    ballDuration: 12,
    perCharge: 5,
  },
  quake: {
    id: 'quake',
    name: 'Толчок',
    icon: '⇊',
    letter: '0',
    color: '#3ddc84',
    desc: 'Поле соперника вздрагивает и оседает на ряд вниз',
    duration: 0,
    ballDuration: 12,
    perCharge: 6,
  },
};

export const DEBUFF_LIST: DebuffDef[] = Object.values(DEBUFFS);
