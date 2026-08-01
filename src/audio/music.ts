export type MusicScene = 'menu' | 'game' | 'versus';

export interface TrackInfo {
  /** File name inside public/music, e.g. "neon-drive.mp3". */
  file: string;
  title?: string;
  artist?: string;
  /** Where the track fits. Omit or use "any" to allow it everywhere. */
  scene?: MusicScene | 'any';
}

interface Manifest {
  tracks: TrackInfo[];
}

const MUSIC_DIR = 'music/';
const MANIFEST = `${MUSIC_DIR}manifest.json`;

/** Streams user-supplied tracks from public/music. The game is fully playable
 *  with no music installed: a missing manifest simply disables this layer. */
export class Music {
  private tracks: TrackInfo[] = [];
  private el: HTMLAudioElement | null = null;
  private current: TrackInfo | null = null;
  private scene: MusicScene = 'menu';
  private volume = 0.45;
  private enabled = true;
  private loaded = false;
  private fade = 0;
  private fadeTimer: number | null = null;

  get available(): boolean {
    return this.tracks.length > 0;
  }

  get nowPlaying(): TrackInfo | null {
    return this.current;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const res = await fetch(MANIFEST, { cache: 'no-cache' });
      if (!res.ok) return;
      const data = (await res.json()) as Manifest;
      if (Array.isArray(data?.tracks)) {
        this.tracks = data.tracks.filter((t) => typeof t?.file === 'string');
      }
    } catch {
      /* no manifest, no music — that is a valid setup */
    }
    if (this.available && this.enabled) this.play(this.scene, true);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.el) this.el.volume = this.volume * this.fade;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
    else if (this.available) this.play(this.scene, true);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Switches the playlist when the game changes context. */
  setScene(scene: MusicScene): void {
    if (this.scene === scene && this.el && !this.el.paused) return;
    this.scene = scene;
    if (this.enabled && this.available) this.play(scene, false);
  }

  next(): void {
    if (this.available) this.play(this.scene, false);
  }

  stop(): void {
    if (this.fadeTimer !== null) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.el?.pause();
    this.el = null;
    this.current = null;
  }

  private pick(scene: MusicScene): TrackInfo | null {
    const fits = this.tracks.filter((t) => !t.scene || t.scene === 'any' || t.scene === scene);
    const pool = fits.length ? fits : this.tracks;
    if (!pool.length) return null;
    // Avoid repeating the same track back to back when there is a choice.
    const others = pool.filter((t) => t.file !== this.current?.file);
    const from = others.length ? others : pool;
    return from[Math.floor(Math.random() * from.length)];
  }

  private play(scene: MusicScene, resumeSame: boolean): void {
    const track = resumeSame && this.current ? this.current : this.pick(scene);
    if (!track) return;

    this.stop();
    const el = new Audio(MUSIC_DIR + encodeURIComponent(track.file));
    el.loop = false;
    el.volume = 0;
    el.addEventListener('ended', () => this.play(this.scene, false));
    // A track that fails to load must not take the audio layer down with it.
    el.addEventListener('error', () => {
      this.tracks = this.tracks.filter((t) => t.file !== track.file);
      if (this.available) this.play(this.scene, false);
    });

    this.el = el;
    this.current = track;
    this.fade = 0;
    void el.play().catch(() => {
      /* autoplay blocked until the first gesture; unlock() retries */
    });

    this.fadeTimer = window.setInterval(() => {
      this.fade = Math.min(1, this.fade + 0.05);
      if (this.el) this.el.volume = this.volume * this.fade;
      if (this.fade >= 1 && this.fadeTimer !== null) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = null;
      }
    }, 60);
  }

  /** Called after the first user gesture, when autoplay becomes allowed. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.el) {
      if (this.available) this.play(this.scene, true);
      return;
    }
    if (this.el.paused) void this.el.play().catch(() => {});
  }
}

export const music = new Music();
