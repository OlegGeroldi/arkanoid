import type { BrickCode } from './bricks';

export type RouteId = 'foundry' | 'garden' | 'wastes';

export interface RouteDef {
  id: RouteId;
  name: string;
  icon: string;
  color: string;
  desc: string;
  /** Bricks this route favours, layered on top of the base palette. */
  palette: BrickCode[];
  /** Multipliers applied to the generator's recipe for this segment. */
  density: number;
  ballSpeed: number;
  /** Run-wide rewards while the segment lasts. */
  xpMul: number;
  dropMul: number;
}

/** The three ways forward. A route is chosen after every tenth level and shapes
 *  the next segment of ten: which bricks show up, how dense and fast it is, and
 *  what the player gets out of it. */
export const ROUTES: Record<RouteId, RouteDef> = {
  foundry: {
    id: 'foundry',
    name: 'Foundry',
    icon: '⛓',
    color: '#ff7a3d',
    desc: 'Steel, unbreakable and explosive bricks. Slow, tough, but points pour in.',
    palette: ['s', 's', 'x', 'e', 't'],
    density: 1.12,
    ballSpeed: 0.94,
    xpMul: 1,
    dropMul: 0.9,
  },
  garden: {
    id: 'garden',
    name: 'Garden',
    icon: '❉',
    color: '#3ddc84',
    desc: 'Regenerators, gold and gifts. Levels are tough, but XP flows generously.',
    palette: ['r', 'g', 'p', 'n'],
    density: 0.95,
    ballSpeed: 1,
    xpMul: 1.4,
    dropMul: 1.15,
  },
  wastes: {
    id: 'wastes',
    name: 'Wastes',
    icon: '☢',
    color: '#b06bff',
    desc: 'Chaotic fields and an overclocked ball. Most dangerous — and bonuses drop most often.',
    palette: ['n', 't', 'e', 'g', 'x'],
    density: 1.05,
    ballSpeed: 1.18,
    xpMul: 1.15,
    dropMul: 1.5,
  },
};

export const ROUTE_LIST: RouteDef[] = Object.values(ROUTES);

/** Levels per segment: a route choice covers this many levels. */
export const SEGMENT = 10;

export const segmentOf = (levelIndex: number): number => Math.floor(levelIndex / SEGMENT);

/** Two routes to pick between, rotating so the same pair never repeats twice
 *  in a row; the third stays visible as the road not taken. */
export function routeChoices(segment: number): RouteDef[] {
  const order: RouteId[][] = [
    ['foundry', 'garden', 'wastes'],
    ['garden', 'wastes', 'foundry'],
    ['wastes', 'foundry', 'garden'],
  ];
  return order[segment % order.length].map((id) => ROUTES[id]);
}
