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
    name: 'Артиллерист',
    icon: '↑',
    color: '#ff7a3d',
    desc: 'Штатный лазер, двойной урон выстрелов и щедрая энергия для суперов',
    apply: (s) => {
      s.laserAlways = true;
      s.energyMul *= 1.35;
    },
    favours: ['weapon', 'greed'],
    laserDamage: 2,
  },
  elementalist: {
    id: 'elementalist',
    name: 'Элементалист',
    icon: '✷',
    color: '#c46bff',
    desc: 'Элементальные шары живут вдвое дольше, бьют больнее и выпадают чаще',
    apply: (s) => {
      s.dropChanceMul *= 1.4;
      s.ballDamage += 1;
    },
    favours: ['element', 'greed'],
    elementDurationMul: 2,
  },
  warden: {
    id: 'warden',
    name: 'Страж',
    icon: '▭',
    color: '#4de2ff',
    desc: '+2 жизни и +2 барьера сразу, ракетка шире, мяч послушнее',
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
