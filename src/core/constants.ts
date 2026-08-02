/** Logical arena size. Everything in the simulation uses these units; the
 *  renderer scales them to the canvas, so gameplay is resolution independent. */
export const ARENA_W = 480;
export const ARENA_H = 720;

/** Brick grid. GRID_W === ARENA_W so bricks tile the field edge to edge. */
export const COLS = 12;
export const ROWS = 18;
export const BRICK_H = 18;
export const GRID_TOP = 62;
export const GRID_BOTTOM = GRID_TOP + ROWS * BRICK_H;

export const WALL = 8; // side/top wall thickness

/** The grid lives between the walls, not under them — otherwise the outermost
 *  column is drawn half-hidden behind the frame. */
export const GRID_LEFT = WALL;
export const brickWidthFor = (fieldWidth: number, cols: number): number => (fieldWidth - WALL * 2) / cols;
export const BRICK_W = brickWidthFor(ARENA_W, COLS);

export const PADDLE_Y = ARENA_H - 52;
export const PADDLE_W = 84;
export const PADDLE_H = 13;
export const PADDLE_MIN_W = 44;
export const PADDLE_MAX_W = 220;
export const PADDLE_SPEED = 620; // px/s for keyboard control

export const BALL_R = 6;
export const BALL_SPEED = 330; // px/s base
export const BALL_SPEED_MAX = 700;
/** Max angle off vertical when bouncing from the paddle (radians). */
export const PADDLE_MAX_BOUNCE = 1.13; // ~65 degrees

export const POWERUP_W = 26;
export const POWERUP_H = 13;
export const POWERUP_FALL = 135;
export const POWERUP_BASE_CHANCE = 0.17;

export const LASER_SPEED = 720;
export const LASER_COOLDOWN = 0.22;

/** Fixed simulation step. Deterministic: same inputs -> same outcome, which is
 *  what keeps both halves of a versus match fair (and leaves room for netplay). */
export const TICK = 1 / 120;
export const MAX_FRAME = 0.25; // never simulate more than this per rendered frame

export const START_LIVES = 3;
export const SERVE_DELAY = 0.55;

/** Super strike energy. Filled by damage/combo, spent by the ultimate. */
export const ENERGY_MAX = 100;
export const ENERGY_PER_DAMAGE = 2.6;
export const ENERGY_PER_POWERUP = 6;

export const COMBO_WINDOW = 1.6; // seconds to keep a combo alive
export const COMBO_MAX = 12;
