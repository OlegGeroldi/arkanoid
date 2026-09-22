/** mulberry32: the same generator as src/core/rng.ts. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pickInt = (rand, n) => Math.floor(rand() * n);

export function shuffle(rand, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickInt(rand, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
