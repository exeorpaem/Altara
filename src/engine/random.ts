// Générateur pseudo-aléatoire déterministe (reproductible à partir d'une seed).

/** Transforme une seed texte en entier 32 bits (hachage FNV-1a). */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 : petit PRNG rapide, suffisant pour un jeu. Renvoie des nombres dans [0, 1). */
export function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed courte et lisible (6 caractères base 36), à partir d'une source d'aléa quelconque. */
export function randomSeed(rand: () => number = Math.random): string {
  return Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')
    .toUpperCase();
}
