import { MAX_FRAME } from './core/constants';
import { InputHub } from './game/input';
import {
  activeProfile,
  loadStore,
  saveStore,
  type Profile,
  type Store,
} from './core/storage';
import { sfx } from './audio/sfx';
import { music } from './audio/music';
import { CAMPAIGN_LEVELS } from './core/campaignLevels';
import type { LevelData } from './core/level';

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
  store: Store;

  /** Canvas size in CSS pixels. */
  width = 0;
  height = 0;
  time = 0;
  /** Smoothed frame rate, shown in the HUD so slowdowns are visible. */
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;

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
    this.store = loadStore();

    this.resize();
    window.addEventListener('resize', this.resize);
    this.initAudio();
  }

  /** Browsers block audio until the user interacts, so the whole audio layer
   *  comes up on the first click or keypress. */
  private initAudio(): void {
    sfx.setVolume(this.profile.sfxVolume);
    music.setVolume(this.profile.musicVolume);
    music.setEnabled(this.profile.musicOn);

    const start = (): void => {
      sfx.unlock();
      void music.load().then(() => music.unlock());
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  setScene(factory: SceneFactory): void {
    this.scene?.dispose();
    this.overlay.replaceChildren();
    this.overlay.classList.remove('interactive');
    this.scene = factory(this);
  }

  /** The profile currently playing. */
  get profile(): Profile {
    return activeProfile(this.store);
  }

  saveProfile(mutate: (p: Profile) => void): void {
    mutate(this.profile);
    saveStore(this.store);
  }

  /** Persists the whole store — profile list, active player, campaign edits. */
  commitStore(mutate?: (s: Store) => void): void {
    mutate?.(this.store);
    saveStore(this.store);
    this.campaignCache = null;
  }

  private campaignCache: LevelData[] | null = null;

  /** The campaign as it should be played: generated levels with any admin edits
   *  laid over the top. */
  campaignLevels(): LevelData[] {
    if (!this.campaignCache) {
      this.campaignCache = CAMPAIGN_LEVELS.map((level, i) => this.store.campaignOverrides[String(i)] ?? level);
    }
    return this.campaignCache;
  }

  switchProfile(id: string): void {
    if (!this.store.players.some((p) => p.id === id)) return;
    this.store.activeId = id;
    saveStore(this.store);
    // Audio settings belong to the player, so they follow the switch.
    sfx.setVolume(this.profile.sfxVolume);
    music.setVolume(this.profile.musicVolume);
    music.setEnabled(this.profile.musicOn);
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

      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAcc;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }

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

  /** Above this many device pixels the glow-heavy renderer starts to cost real
   *  milliseconds, so back the density off instead of dropping frames. */
  private static readonly MAX_PIXELS = 3_200_000;

  private resize = (): void => {
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const area = this.width * this.height;
    if (area * dpr * dpr > App.MAX_PIXELS) {
      dpr = Math.max(1, Math.sqrt(App.MAX_PIXELS / area));
    }
    this.dpr = dpr;

    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
  };
}
