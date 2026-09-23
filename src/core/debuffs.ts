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
    name: 'Frost',
    icon: '❄',
    letter: '1',
    color: '#8ef0ff',
    desc: "The rival's paddle turns heavy and crawls",
    duration: 6,
    ballDuration: 14,
    perCharge: 3,
  },
  mirror: {
    id: 'mirror',
    name: 'Mirror',
    icon: '↔',
    letter: '2',
    color: '#ff5fa2',
    desc: "The rival's controls flip",
    duration: 5,
    ballDuration: 14,
    perCharge: 4,
  },
  brittle: {
    id: 'brittle',
    name: 'Brittle',
    icon: '⋯',
    letter: '3',
    color: '#ff7a3d',
    desc: "The rival's paddle chips away with every bounce",
    duration: 9,
    ballDuration: 14,
    perCharge: 4,
  },
  repel: {
    id: 'repel',
    name: 'Anti-Magnet',
    icon: '⊗',
    letter: '4',
    color: '#b06bff',
    desc: "Power-ups flee from the rival's paddle",
    duration: 8,
    ballDuration: 14,
    perCharge: 3,
  },
  steel: {
    id: 'steel',
    name: 'Steel',
    icon: '▦',
    letter: '5',
    color: '#9fb3c8',
    desc: 'A row of steel bricks drops onto the rival',
    duration: 0,
    ballDuration: 12,
    perCharge: 6,
  },
  blind: {
    id: 'blind',
    name: 'Static',
    icon: '▓',
    letter: '6',
    color: '#5a6472',
    desc: "The rival's field fills with noise",
    duration: 6,
    ballDuration: 14,
    perCharge: 4,
  },
  haste: {
    id: 'haste',
    name: 'Haste',
    icon: '≫',
    letter: '7',
    color: '#ff4d6d',
    desc: "The rival's ball speeds up",
    duration: 8,
    ballDuration: 14,
    perCharge: 4,
  },
  jam: {
    id: 'jam',
    name: 'Jammer',
    icon: '⌁',
    letter: '8',
    color: '#ffd24d',
    desc: "The rival's skills go on cooldown",
    duration: 10,
    ballDuration: 12,
    perCharge: 5,
  },
  drain: {
    id: 'drain',
    name: 'Vampire',
    icon: '◍',
    letter: '9',
    color: '#c46bff',
    desc: "Steals the rival's super energy for yourself",
    duration: 0,
    ballDuration: 12,
    perCharge: 5,
  },
  quake: {
    id: 'quake',
    name: 'Quake',
    icon: '⇊',
    letter: '0',
    color: '#3ddc84',
    desc: "The rival's field shakes and drops a row down",
    duration: 0,
    ballDuration: 12,
    perCharge: 6,
  },
};

export const DEBUFF_LIST: DebuffDef[] = Object.values(DEBUFFS);
