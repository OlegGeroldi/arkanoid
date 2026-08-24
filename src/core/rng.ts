/** Seeded PRNG (mulberry32). Each arena owns one, so a versus match can hand both
 *  players the same seed and get identical power-up rolls. */
export class Rng {
  private s: number;
  /** The seed this generator started from. Handy for deriving sibling streams
   *  that have to line up on another machine. */
  readonly seedValue: number;

  constructor(seed = Date.now() >>> 0) {
    this.s = seed >>> 0;
    this.seedValue = this.s;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  int(loInclusive: number, hiExclusive: number): number {
    return loInclusive + Math.floor(this.next() * (hiExclusive - loInclusive));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length)];
  }

  /** Fisher-Yates on a copy. */
  shuffled<T>(items: readonly T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
