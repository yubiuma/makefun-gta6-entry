// A small seeded random number generator (mulberry32) plus the everyday helpers built on
// it. The same seed gives the same city and the same screenshot scenes, every time.

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [min, max). */
export function range(random, min, max) {
  return min + random() * (max - min);
}

/** An integer in [min, max], both ends included. */
export function rangeInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

/** One element of a non-empty array. */
export function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

/** True with probability p. */
export function chance(random, p) {
  return random() < p;
}
