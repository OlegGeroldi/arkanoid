import { MAX_FRAME } from './core/constants';
import { InputHub } from './game/input';
import { loadProfile, saveProfile, type Profile } from './core/storage';

export interface Scene {
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  dispose(): void;
}

export type SceneFactory = (app: App) => Scene;

/** Fits a logical WxH box into the canvas and returns the applied scale.
 *  The context is left translated so (0,0) is the box's top-left corner. */
export function fitBox(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  logicalW: number,
  logicalH: number,
): { scale: number; ox: number; oy: number } {
  const scale = Math.min(cw / logicalW, ch / logicalH);
  const ox = (cw - logicalW * scale) / 2;
  const oy = (ch - logicalH * scale) / 2;
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  return { scale, ox, oy };
}

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly overlay: HTMLElement;
  readonly input: InputHub;
  profile: Profile;

  /** Canvas size in CSS pixels. */
  width = 0;
  height = 0;
  time = 0;

  private scene: Scene | null = null;
  private raf = 0;
  private last = 0;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.overlay = overlay;
    this.input = new InputHub(canvas);
    this.profile = loadProfile();

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  setScene(factory: SceneFactory): void {
    this.scene?.dispose();
    this.overlay.replaceChildren();
    this.overlay.classList.remove('interactive');
    this.scene = factory(this);
  }

  saveProfile(mutate: (p: Profile) => void): void {
    mutate(this.profile);
    saveProfile(this.profile);
  }

  /** Mouse position in canvas CSS pixels, or null. */
  get pointer(): { x: number; y: number } | null {
    return this.input.pointer;
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((now - this.last) / 1000, MAX_FRAME);
      this.last = now;
      this.time += dt;

      this.scene?.update(dt);
      this.input.endFrame();

      const { ctx } = this;
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, this.width, this.height);
      this.scene?.draw(ctx, this.width, this.height);
      ctx.restore();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private dpr = 1;

  private resize = (): void => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  };
}
