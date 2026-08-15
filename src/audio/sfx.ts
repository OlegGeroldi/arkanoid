import type { ArenaEvent } from '../core/arena';
import { BALL_TYPES } from '../core/balls';

/** Every sound is synthesised at runtime — no audio files, no loading, and the
 *  whole bank is a few hundred bytes of code. */
export type SfxName =
  | 'paddle'
  | 'wall'
  | 'brick'
  | 'brickHard'
  | 'explosion'
  | 'powerup'
  | 'ballType'
  | 'laser'
  | 'super'
  | 'levelup'
  | 'lifeLost'
  | 'garbage'
  | 'cleared'
  | 'dead'
  | 'goal'
  | 'ui';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.7;
  private muted = false;
  /** Rate limit: a multiball frenzy must not turn into a wall of clicks. */
  private lastAt = new Map<SfxName, number>();
  /** Live voice count. Nodes are disconnected when they finish, but a burst of
   *  simultaneous hits could still pile up faster than they retire. */
  private voices = 0;
  private static readonly MAX_VOICES = 24;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Browsers only allow audio after a user gesture, so this is called from the
   *  first click or keypress. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** One short tone with an exponential decay. */
  private tone(
    freq: number,
    duration: number,
    opts: { type?: OscillatorType; gain?: number; sweepTo?: number; delay?: number } = {},
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.voices >= Sfx.MAX_VOICES) return;

    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t0 + duration);

    const peak = (opts.gain ?? 0.25) * 0.6;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain).connect(master);
    this.voices++;
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      this.voices--;
    };
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Filtered noise burst — impacts, explosions, whooshes. */
  private hit(duration: number, opts: { freq?: number; q?: number; gain?: number; type?: BiquadFilterType } = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise || this.voices >= Sfx.MAX_VOICES) return;

    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.freq ?? 900, t0);
    filter.Q.value = opts.q ?? 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime((opts.gain ?? 0.3) * 0.6, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter).connect(gain).connect(master);
    this.voices++;
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
      this.voices--;
    };
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  play(name: SfxName, param?: number): void {
    if (!this.ctx || this.muted) return;

    const now = this.ctx.currentTime;
    const minGap: Partial<Record<SfxName, number>> = { brick: 0.02, paddle: 0.03, wall: 0.04, laser: 0.05 };
    const gap = minGap[name];
    if (gap !== undefined) {
      const last = this.lastAt.get(name) ?? -1;
      if (now - last < gap) return;
      this.lastAt.set(name, now);
    }

    switch (name) {
      case 'paddle':
        this.tone(320, 0.09, { type: 'triangle', gain: 0.32, sweepTo: 220 });
        break;
      case 'wall':
        this.tone(200, 0.06, { type: 'triangle', gain: 0.18, sweepTo: 160 });
        break;
      case 'brick': {
        // Pitch rises with the combo so a streak sounds like one.
        const step = Math.min(param ?? 0, 12);
        this.tone(520 * Math.pow(1.06, step), 0.07, { type: 'square', gain: 0.22 });
        this.hit(0.05, { freq: 1800, gain: 0.14 });
        break;
      }
      case 'brickHard':
        this.tone(180, 0.1, { type: 'sawtooth', gain: 0.2, sweepTo: 120 });
        this.hit(0.07, { freq: 700, gain: 0.2 });
        break;
      case 'explosion':
        this.hit(0.45, { freq: 260, q: 0.6, gain: 0.5, type: 'lowpass' });
        this.tone(90, 0.35, { type: 'sawtooth', gain: 0.3, sweepTo: 40 });
        break;
      case 'powerup':
        this.tone(660, 0.09, { type: 'square', gain: 0.22 });
        this.tone(880, 0.12, { type: 'square', gain: 0.2, delay: 0.07 });
        break;
      case 'ballType':
        this.tone(300, 0.18, { type: 'sawtooth', gain: 0.22, sweepTo: 900 });
        this.tone(900, 0.22, { type: 'triangle', gain: 0.18, delay: 0.1, sweepTo: 1400 });
        break;
      case 'laser':
        this.tone(1200, 0.07, { type: 'sawtooth', gain: 0.14, sweepTo: 420 });
        break;
      case 'super':
        this.tone(140, 0.5, { type: 'sawtooth', gain: 0.35, sweepTo: 900 });
        this.hit(0.5, { freq: 500, q: 0.8, gain: 0.35 });
        this.tone(880, 0.4, { type: 'square', gain: 0.2, delay: 0.15 });
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone(f, 0.16, { type: 'triangle', gain: 0.26, delay: i * 0.075 }),
        );
        break;
      case 'lifeLost':
        this.tone(320, 0.5, { type: 'sawtooth', gain: 0.3, sweepTo: 70 });
        break;
      case 'garbage':
        this.hit(0.3, { freq: 380, q: 0.7, gain: 0.4, type: 'lowpass' });
        this.tone(120, 0.25, { type: 'square', gain: 0.22, sweepTo: 80 });
        break;
      case 'cleared':
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
          this.tone(f, 0.22, { type: 'square', gain: 0.24, delay: i * 0.09 }),
        );
        break;
      case 'dead':
        [400, 300, 220, 150].forEach((f, i) =>
          this.tone(f, 0.35, { type: 'sawtooth', gain: 0.3, delay: i * 0.16 }),
        );
        break;
      case 'goal':
        this.tone(440, 0.14, { type: 'square', gain: 0.28 });
        this.tone(660, 0.2, { type: 'square', gain: 0.24, delay: 0.1 });
        break;
      case 'ui':
        this.tone(720, 0.05, { type: 'triangle', gain: 0.14 });
        break;
    }
  }

  /** Turns a frame's worth of arena events into sound. */
  consume(events: ArenaEvent[], combo = 0): void {
    for (const e of events) {
      switch (e.t) {
        case 'brick':
          this.play(e.big ? 'brickHard' : 'brick', combo);
          break;
        case 'hit':
          this.play('wall');
          break;
        case 'explosion':
          this.play('explosion');
          break;
        case 'powerup':
          this.play('powerup');
          break;
        case 'ballType':
          void BALL_TYPES[e.id];
          this.play('ballType');
          break;
        case 'levelup':
          this.play('levelup');
          break;
        case 'super':
          this.play('super');
          break;
        case 'skill':
          this.play('ballType');
          break;
        case 'bossHit':
          this.play('brickHard');
          break;
        case 'bossPhase':
          this.play('garbage');
          break;
        case 'prop':
          this.play(e.kind === 'bumper' ? 'wall' : e.kind === 'target' ? 'brickHard' : 'paddle', 4);
          break;
        case 'targetsDown':
          this.play('levelup');
          break;
        case 'multiball':
          this.play('super');
          break;
        case 'cellarPot':
          this.play(e.won ? 'levelup' : 'lifeLost');
          break;
        case 'bossGrab':
          this.play(e.taken ? 'super' : 'explosion');
          break;
        case 'bossShotHit':
          this.play('lifeLost');
          break;
        case 'bossDead':
          this.play('cleared');
          break;
        case 'lifeLost':
          this.play('lifeLost');
          break;
        case 'garbage':
          this.play('garbage');
          break;
        case 'cleared':
          this.play('cleared');
          break;
        case 'dead':
          this.play('dead');
          break;
        default:
          break;
      }
    }
  }
}

export const sfx = new Sfx();
