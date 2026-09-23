import type { RunStats } from './progression';

export type SpecId = 'gunner' | 'elementalist' | 'warden';

/** Perk families a specialisation pulls toward in the draft. */
export type PerkTag = 'weapon' | 'element' | 'defense' | 'greed' | 'control';

export interface SpecDef {
  id: SpecId;
  name: string;
  icon: string;
  color: string;
  desc: string;
  /** Applied once, the moment the specialisation is chosen. */
  apply(s: RunStats): void;
  /** Perks carrying these tags show up far more often afterwards. */
  favours: PerkTag[];
  /** Extra effects the arena reads directly. */
  laserDamage?: number;
  elementDurationMul?: number;
}

/** Chosen once per run, at mastery level 5. It does not replace perks — it
 *  tilts the whole rest of the draft toward one way of playing. */
export const SPECS: Record<SpecId, SpecDef> = {
  gunner: {
    id: 'gunner',
    name: 'Gunner',
    icon: '↑',
    color: '#ff7a3d',
    desc: 'Built-in laser, double shot damage and generous super energy',
    apply: (s) => {
      s.laserAlways = true;
      s.energyMul *= 1.35;
    },
    favours: ['weapon', 'greed'],
    laserDamage: 2,
  },
  elementalist: {
    id: 'elementalist',
    name: 'Elementalist',
    icon: '✷',
    color: '#c46bff',
    desc: 'Elemental balls last twice as long, hit harder and drop more often',
    apply: (s) => {
      s.dropChanceMul *= 1.4;
      s.ballDamage += 1;
    },
    favours: ['element', 'greed'],
    elementDurationMul: 2,
  },
  warden: {
    id: 'warden',
    name: 'Warden',
    icon: '▭',
    color: '#4de2ff',
    desc: '+2 lives and +2 shields right away, wider paddle, gentler ball',
    apply: (s) => {
      s.bonusLives += 2;
      s.bonusShields += 2;
      s.paddleWidthMul *= 1.25;
      s.ballSpeedMul *= 0.94;
    },
    favours: ['defense', 'control'],
  },
};

export const SPEC_LIST: SpecDef[] = Object.values(SPECS);

/** Mastery level at which the specialisation is offered. */
export const SPEC_LEVEL = 5;
