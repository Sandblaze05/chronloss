// Simple seeded value-noise / FBM helper for deterministic heightmaps
// Exports:
// - generateHeightAt(col, row, options)
// Options: seed, scale, octaves, persistence, lacunarity, minHeight, maxHeight

export function seedToNumber(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

function hash2D(x, y, seed) {
  // Combine coordinates and seed into a 32-bit hash and normalize to [0,1]
  const s = seedToNumber(seed);
  let n = (x * 374761393 + y * 668265263) >>> 0;
  n = (n ^ s) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return (n >>> 0) / 4294967295;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function valueNoise2D(x, y, seed) {
  // Bilinear-interpolated value noise based on integer lattice hashes
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const sx = fade(x - x0);
  const sy = fade(y - y0);

  const n00 = hash2D(x0, y0, seed);
  const n10 = hash2D(x1, y0, seed);
  const n01 = hash2D(x0, y1, seed);
  const n11 = hash2D(x1, y1, seed);

  const nx0 = lerp(n00, n10, sx);
  const nx1 = lerp(n01, n11, sx);
  const nxy = lerp(nx0, nx1, sy);
  return nxy;
}

export function fbm2D(x, y, options = {}) {
  const {
    seed = 0,
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2.0,
    scale = 8.0,
  } = options;

  let amplitude = 1;
  let frequency = 1;
  let value = 0;
  let max = 0;
  const base = seedToNumber(seed);
  for (let i = 0; i < octaves; i++) {
    // Use different offsets per octave to decorrelate
    const octaveSeed = (base + i * 1000) >>> 0;
    value += valueNoise2D((x * frequency) / scale, (y * frequency) / scale, octaveSeed) * amplitude;
    max += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / max;
}

export function generateHeightAt(col, row, options = {}) {
  const {
    seed = 0, scale = 16, octaves = 4, persistence = 0.5,
    lacunarity = 2, minHeight = 0, maxHeight = 3, blockHeight = 1,
    exponent = 1.0
  } = options;

  let n = fbm2D(col, row, { seed, scale, octaves, persistence, lacunarity });
  n = Math.pow(n, exponent); 

  // Map normalized noise [0,1] to discrete integer block count
  const blocks = Math.round(minHeight + n * (maxHeight - minHeight));
  return blocks * blockHeight;
}

// Determine a biome type at a given world column/row using height + moisture
// normalizedHeight should be in [0,1] (the raw FBM value before remapping to blocks)
export function generateBiomeAt(col, row, normalizedHeight, options = {}) {
  const opts = { ...(options || {}) };
  const baseSeed = opts.seed || 0;

  // Use a different seed so moisture patterns are decorrelated from height
  const moistureSeed = (typeof baseSeed === 'number') ? (baseSeed + 1337) : `${baseSeed}_1337`;

  // Moisture usually looks better with a larger scale (wider weather patterns)
  const moisture = fbm2D(col, row, {
    ...opts,
    seed: moistureSeed,
    scale: (opts.scale || 8) * 2,
  });

  // Biome lookup using normalized height in [0,1]
  if (normalizedHeight < 0.2) {
    return 'water';
  }
  if (normalizedHeight < 0.25) {
    return 'sand';
  }
  if (normalizedHeight > 0.8) {
    return moisture > 0.5 ? 'snow' : 'stone';
  }

  if (moisture < 0.3) return 'desert';
  if (moisture < 0.6) return 'grass';
  return 'forest';
}