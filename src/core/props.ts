import { BRICK_H, GRID_LEFT, GRID_TOP } from './constants';

/** The pinball attic.
 *
 *  The top of the field stops being bricks and becomes pinball furniture. The
 *  physics do not change — no gravity, no flippers, the paddle stays where it
 *  is — because a ball that obeyed one law upstairs and another downstairs
 *  would be unreadable. What changes is what the ball meets up there: things
 *  that kick it back at an angle nobody planned, and pay for the privilege.
 *
 *  That is the part of pinball arkanoid actually lacks. A level with three
 *  bricks left is a chore; a level with three bricks and a bumper cluster is a
 *  scramble. */

export type PropKind = 'bumper' | 'sling' | 'spinner' | 'target' | 'lock';

export interface PropDef {
  kind: PropKind;
  name: string;
  color: string;
  /** Collision radius in pixels. */
  radius: number;
  /** Score for one hit, before combo. */
  score: number;
  desc: string;
}

export const PROPS: Record<PropKind, PropDef> = {
  bumper: {
    kind: 'bumper',
    name: 'Бампер',
    color: '#ff5fa2',
    radius: 15,
    score: 25,
    desc: 'Отшвыривает мяч с добавкой скорости и сыплет очки',
  },
  sling: {
    kind: 'sling',
    name: 'Праща',
    color: '#ffd24d',
    radius: 14,
    score: 15,
    desc: 'Пинает мяч вбок — угол становится непредсказуемым',
  },
  spinner: {
    kind: 'spinner',
    name: 'Спиннер',
    color: '#4de2ff',
    radius: 13,
    score: 10,
    desc: 'Мяч проходит насквозь и раскручивает его, платит за оборот',
  },
  target: {
    kind: 'target',
    name: 'Мишень',
    color: '#3ddc84',
    radius: 11,
    score: 50,
    desc: 'Падает от удара; собьёте все — с неба придёт награда',
  },
  lock: {
    kind: 'lock',
    name: 'Замок',
    color: '#b06bff',
    radius: 13,
    score: 30,
    desc: 'Глотает мяч и держит; два замка — и мяч вернётся не один',
  },
};

export const PROP_LIST: PropDef[] = Object.values(PROPS);

export function isPropKind(s: string): s is PropKind {
  return s in PROPS;
}

/** A prop as stored in a level: a kind and a cell of the brick grid. Keeping
 *  them on the grid means they land where bricks would and scale with the
 *  field, including the double-width co-op one. */
export interface LevelProp {
  kind: PropKind;
  col: number;
  row: number;
}

/** A prop in a running arena. */
export interface Prop {
  kind: PropKind;
  def: PropDef;
  x: number;
  y: number;
  /** Hit feedback, seconds. */
  flash: number;
  /** Spinner rotation, and how fast it is turning. */
  spin: number;
  spinRate: number;
  /** A dropped target is out for the rest of the level; a filled lock is
   *  holding a ball. */
  down: boolean;
  /** Seconds a lock keeps the ball before spitting it back. */
  holdT: number;
}

export function makeProp(p: LevelProp, brickW: number): Prop {
  return {
    kind: p.kind,
    def: PROPS[p.kind],
    x: GRID_LEFT + (p.col + 0.5) * brickW,
    y: GRID_TOP + (p.row + 0.5) * BRICK_H,
    flash: 0,
    spin: 0,
    spinRate: 0,
    down: false,
    holdT: 0,
  };
}

/** How long a lock holds the ball, and how many locks it takes to send it back
 *  with company. */
export const LOCK_HOLD = 1.4;
export const LOCKS_FOR_MULTIBALL = 2;
