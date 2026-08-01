export type BallTypeId = 'normal' | 'lava' | 'aqua' | 'laser' | 'plasma' | 'void';

export interface BallType {
  id: BallTypeId;
  name: string;
  desc: string;
  /** Core colour — the ball literally changes colour with its element. */
  color: string;
  trail: string;
  glow: number;
  /** Extra damage per brick hit. */
  damage: number;
  /** Ploughs through bricks instead of bouncing off them. */
  pierce: boolean;
  /** Speed multiplier while this element is active. */
  speed: number;
  /** Seconds the element lasts; the ball reverts to plain white afterwards. */
  duration: number;
}

export const BALL_TYPES: Record<BallTypeId, BallType> = {
  normal: {
    id: 'normal',
    name: 'Обычный',
    desc: 'Простой мяч',
    color: '#ffffff',
    trail: '#9fd8ff',
    glow: 14,
    damage: 0,
    pierce: false,
    speed: 1,
    duration: 0,
  },
  lava: {
    id: 'lava',
    name: 'Лава-болл',
    desc: 'Прошивает кирпичи и поджигает всё вокруг точки удара',
    color: '#ff6a2b',
    trail: '#ffb24d',
    glow: 30,
    damage: 2,
    pierce: true,
    speed: 1.08,
    duration: 14,
  },
  aqua: {
    id: 'aqua',
    name: 'Аква-болл',
    desc: 'Медленный и послушный, бьёт волной по соседям в ряду',
    color: '#3ad9ff',
    trail: '#8ef0ff',
    glow: 22,
    damage: 0,
    pierce: false,
    speed: 0.82,
    duration: 18,
  },
  laser: {
    id: 'laser',
    name: 'Лазер-болл',
    desc: 'Каждое попадание выпускает вверх два луча',
    color: '#7dff6a',
    trail: '#c9ff9f',
    glow: 26,
    damage: 1,
    pierce: false,
    speed: 1.05,
    duration: 15,
  },
  plasma: {
    id: 'plasma',
    name: 'Плазма-болл',
    desc: 'Цепная молния перекидывается на соседние кирпичи',
    color: '#c46bff',
    trail: '#e3b6ff',
    glow: 28,
    damage: 1,
    pierce: false,
    speed: 1.12,
    duration: 14,
  },
  void: {
    id: 'void',
    name: 'Войд-болл',
    desc: 'Тяжёлый мяч: притягивает бонусы и доворачивает к кирпичам',
    color: '#8a7bff',
    trail: '#3b2f7a',
    glow: 24,
    damage: 2,
    pierce: false,
    speed: 0.95,
    duration: 16,
  },
};

export const BALL_TYPE_LIST: BallType[] = Object.values(BALL_TYPES);
