export type PowerupId =
  | 'expand'
  | 'shrink'
  | 'multiball'
  | 'laser'
  | 'catch'
  | 'slow'
  | 'speed'
  | 'life'
  | 'shield'
  | 'pierce'
  | 'xp'
  | 'energy';

export interface PowerupDef {
  id: PowerupId;
  letter: string;
  name: string;
  desc: string;
  color: string;
  /** Relative drop weight. */
  weight: number;
  /** Negative pickups exist so the field stays risky — they are rarer. */
  bad?: boolean;
  /** Seconds, for timed effects. */
  duration?: number;
}

export const POWERUPS: Record<PowerupId, PowerupDef> = {
  expand: { id: 'expand', letter: 'E', name: 'Расширение', desc: 'Ракетка шире', color: '#4de2ff', weight: 12, duration: 18 },
  shrink: { id: 'shrink', letter: 'S', name: 'Сжатие', desc: 'Ракетка уже', color: '#ff4d6d', weight: 5, bad: true, duration: 12 },
  multiball: { id: 'multiball', letter: 'D', name: 'Мультимяч', desc: '+2 мяча', color: '#ffd24d', weight: 10 },
  laser: { id: 'laser', letter: 'L', name: 'Лазер', desc: 'Стрельба по кирпичам', color: '#ff7a3d', weight: 9, duration: 16 },
  catch: { id: 'catch', letter: 'C', name: 'Захват', desc: 'Ракетка ловит мяч', color: '#3ddc84', weight: 7, duration: 20 },
  slow: { id: 'slow', letter: 'W', name: 'Замедление', desc: 'Мячи медленнее', color: '#7c6cff', weight: 7, duration: 12 },
  speed: { id: 'speed', letter: 'F', name: 'Ускорение', desc: 'Мячи быстрее', color: '#ff4d6d', weight: 4, bad: true, duration: 10 },
  life: { id: 'life', letter: 'P', name: 'Жизнь', desc: '+1 жизнь', color: '#ff5fa2', weight: 4 },
  shield: { id: 'shield', letter: 'B', name: 'Барьер', desc: 'Ловит мяч внизу 1 раз', color: '#4de2ff', weight: 6 },
  pierce: { id: 'pierce', letter: 'X', name: 'Пробой', desc: 'Мяч прошивает кирпичи', color: '#ff7a3d', weight: 5, duration: 9 },
  xp: { id: 'xp', letter: 'O', name: 'Опыт', desc: 'Сразу порция опыта', color: '#ffd24d', weight: 9 },
  energy: { id: 'energy', letter: 'U', name: 'Энергия', desc: '+35 к заряду супера', color: '#b06bff', weight: 8 },
};

export const POWERUP_LIST: PowerupDef[] = Object.values(POWERUPS);

export interface FallingPowerup {
  id: PowerupId;
  def: PowerupDef;
  x: number;
  y: number;
  vy: number;
  spin: number;
}
