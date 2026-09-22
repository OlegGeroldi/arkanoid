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
    name: 'Plasma Barrage',
    icon: '⁘',
    color: '#ff7a3d',
    desc: "The paddle sprays plasma for 5 seconds; shots pierce straight through unbreakable bricks",
    pvp: 'The rival gets hit with a row of junk bricks',
    duration: 5,
    unlockLevel: 1,
  },
  meteor: {
    id: 'meteor',
    name: 'Meteor',
    icon: '☄',
    color: '#ffd24d',
    desc: 'Every ball burns for 8 seconds: pierces bricks and hits an area',
    pvp: "The rival's ball speeds up for 8 seconds",
    duration: 8,
    // A quarter faster than the rest: the meteor is the one that keeps a race
    // moving, and waiting for it took the pace out of a turn.
    chargeMul: 1.25,
    unlockLevel: 1,
  },
  fracture: {
    id: 'fracture',
    name: 'Time Fracture',
    icon: '◷',
    color: '#4de2ff',
    desc: 'Time slows, the paddle grows — 7 seconds of total control',
    pvp: "The rival's controls invert for 5 seconds",
    duration: 7,
    unlockLevel: 3,
  },
  singularity: {
    id: 'singularity',
    name: 'Singularity',
    icon: '◉',
    color: '#b06bff',
    desc: 'A black hole pulls in and grinds up bricks around itself',
    pvp: "The rival's field is covered in static for 6 seconds",
    duration: 6,
    unlockLevel: 5,
  },
};

export const SUPER_LIST: SuperDef[] = Object.values(SUPERS);
