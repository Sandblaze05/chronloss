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

// Export hash2D for use in biome blending
export function hash2D_export(x, y, seed) {
  return hash2D(x, y, seed);
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function decorrelatedSeed(seed, salt) {
  if (typeof seed === 'number') {
    let n = (seed >>> 0) ^ (salt >>> 0);
    n = Math.imul(n ^ (n >>> 16), 2246822519) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 3266489917) >>> 0;
    return n >>> 0;
  }
  return `${seed}_${salt}`;
}

function grad2D(ix, iy, seed) {
  const s = seedToNumber(seed);
  let n = (ix * 374761393 + iy * 668265263) >>> 0;
  n = (n ^ s) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  const angle = (n / 4294967295) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function grad3D(ix, iy, iz, seed) {
  const s = seedToNumber(seed);
  let n = (ix * 374761393 + iy * 668265263 + iz * 2147483647) >>> 0;
  n = (n ^ s) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;

  const u = (n / 4294967295) * 2 - 1;
  const vSeed = Math.imul(n ^ 0x9e3779b9, 2246822519) >>> 0;
  const v = (vSeed / 4294967295) * 2 * Math.PI;
  const r = Math.sqrt(Math.max(0, 1 - u * u));
  return {
    x: r * Math.cos(v),
    y: r * Math.sin(v),
    z: u,
  };
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

export function perlin2D(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const sx = fade(x - x0);
  const sy = fade(y - y0);

  const g00 = grad2D(x0, y0, seed);
  const g10 = grad2D(x1, y0, seed);
  const g01 = grad2D(x0, y1, seed);
  const g11 = grad2D(x1, y1, seed);

  const dx0 = x - x0;
  const dy0 = y - y0;
  const dx1 = x - x1;
  const dy1 = y - y1;

  const n00 = g00.x * dx0 + g00.y * dy0;
  const n10 = g10.x * dx1 + g10.y * dy0;
  const n01 = g01.x * dx0 + g01.y * dy1;
  const n11 = g11.x * dx1 + g11.y * dy1;

  const nx0 = lerp(n00, n10, sx);
  const nx1 = lerp(n01, n11, sx);
  const nxy = lerp(nx0, nx1, sy);

  return clamp01((nxy + 1) * 0.5);
}

export function fbmPerlin2D(x, y, options = {}) {
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
    const octaveSeed = (base + i * 1000) >>> 0;
    value += perlin2D((x * frequency) / scale, (y * frequency) / scale, octaveSeed) * amplitude;
    max += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / max;
}

export function ridgedPerlin2D(x, y, options = {}) {
  const {
    seed = 0,
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2.0,
    scale = 8.0,
    exponent = 2.0,
  } = options;

  let amplitude = 1;
  let frequency = 1;
  let value = 0;
  let max = 0;
  const base = seedToNumber(seed);
  for (let i = 0; i < octaves; i++) {
    const octaveSeed = (base + i * 1000) >>> 0;
    const n = perlin2D((x * frequency) / scale, (y * frequency) / scale, octaveSeed);
    const ridge = 1 - Math.abs(n * 2 - 1);
    value += Math.pow(Math.max(0, ridge), exponent) * amplitude;
    max += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / max;
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

// Helper: Apply domain warping to coordinates before sampling
export function warpedSample(col, row, options = {}) {
  const {
    seed = 0,
    scale = 150,
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2.0,
  } = options;

  const warpScale = scale * 0.6;
  const warpStrength = scale * 0.35;
  const warpSeed = typeof seed === 'number' ? seed : seedToNumber(seed);

  // Sample two offset noise fields to use as warp offsets
  const wx = fbmPerlin2D(col + 1.7, row + 9.2, {
    seed: warpSeed + 41,
    scale: warpScale,
    octaves: Math.max(2, octaves - 1),
    persistence,
    lacunarity,
  }) * 2 - 1;

  const wy = fbmPerlin2D(col + 8.3, row + 2.8, {
    seed: warpSeed + 73,
    scale: warpScale,
    octaves: Math.max(2, octaves - 1),
    persistence,
    lacunarity,
  }) * 2 - 1;

  // Apply warp, then sample the real heightmap
  return fbmPerlin2D(
    col + wx * warpStrength,
    row + wy * warpStrength,
    { seed: warpSeed, scale, octaves, persistence, lacunarity }
  );
}

// Reshape height curve: flatten oceans, sharpen mountains
function reshapeHeight(n) {
  if (n < 0.35) {
    // Flatten ocean floor
    return n * 0.3;
  } else if (n < 0.5) {
    // Coastal shelf — gradual
    return lerp(0.105, 0.35, (n - 0.35) / 0.15);
  } else {
    // Land — push mountains upward
    return lerp(0.35, 1.0, Math.pow((n - 0.5) / 0.5, 0.75));
  }
}

// Sample terrain with layered noise: continental + ridged + peak
export function sampleTerrainHeight(col, row, options = {}) {
  const {
    seed = 0,
    scale = 150,
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2.0,
  } = options;

  const baseSeed = typeof seed === 'number' ? seed : seedToNumber(seed);

  // Continental layer: warped FBM for landmass shape
  const continental = warpedSample(col, row, { seed: baseSeed, scale, octaves, persistence, lacunarity });

  // Ridged layer: mountain spines
  const ridged = ridgedPerlin2D(col, row, {
    seed: baseSeed + 101,
    scale: scale * 0.5,
    octaves: Math.max(3, octaves - 1),
    persistence: 0.52,
    lacunarity: 2.0,
    exponent: 2.2,
  });

  // Peak layer: sharp summits
  const peak = Math.pow(
    perlin2D(
      col / (scale * 0.22),
      row / (scale * 0.22),
      baseSeed + 31337
    ),
    4.0
  );

  // Blend layers: continental drives shape, ridges add structure, peaks add drama
  let h = continental * 0.38 + ridged * 0.44 + peak * 0.18;
  return clamp01(Math.pow(Math.max(0, h), 1.1));
}

// Apply erosion approximation: steep slopes lose material
export function sampleWithErosion(col, row, options = {}) {
  const h = sampleTerrainHeight(col, row, options);
  const hR = sampleTerrainHeight(col + 1, row, options);
  const hD = sampleTerrainHeight(col, row + 1, options);

  const slopeX = Math.abs(h - hR);
  const slopeY = Math.abs(h - hD);
  const slope = Math.sqrt(slopeX * slopeX + slopeY * slopeY);

  // Steep slopes lose material → cuts ravines and sharpens cliffs
  return clamp01(Math.max(0, h - slope * 0.6));
}

export function generateHeightAt(col, row, options = {}) {
  const {
    seed = 0, scale = 150, octaves = 4, persistence = 0.5,
    lacunarity = 2, minHeight = 0, maxHeight = 3, blockHeight = 1,
    exponent = 1.1,
    useErosion = true,
    useReshape = true,
  } = options;

  // Sample with domain warping and layered noise
  let n = sampleTerrainHeight(col, row, { seed, scale, octaves, persistence, lacunarity });

  // Apply erosion approximation if enabled
  if (useErosion) {
    n = sampleWithErosion(col, row, { seed, scale, octaves, persistence, lacunarity });
  }

  // Reshape height curve for distinct zones
  if (useReshape) {
    n = reshapeHeight(n);
  }

  n = Math.pow(n, exponent);

  // Map normalized noise [0,1] to discrete integer block count
  const blocks = Math.round(minHeight + n * (maxHeight - minHeight));
  return blocks * blockHeight;
}

// Determine a biome type at a given world column/row using Whittaker diagram
// (temperature vs precipitation/moisture) with altitude modulation
export function generateBiomeAt(col, row, normalizedHeight, options = {}) {
  const baseSeed = options.seed ?? 0;
  const scale = options.scale ?? 150;
  const terrain = options.terrain ?? {};
  const ridge = clamp01(terrain.ridged ?? 0);
  const slope = clamp01(terrain.slope ?? ridge * 0.8);
  const mountainness = clamp01(terrain.mountainness ?? ((ridge * 0.6) + (Math.max(0, normalizedHeight - 0.65) / 0.35) * 0.4));
  const altitudeCooling = options.biomeAltitudeCooling ?? 0.28;

  // Three independent large-scale noise fields, all decorrelated
  const moisture = fbm2D(col, row, {
    ...options,
    seed: decorrelatedSeed(baseSeed, 1337),
    scale: scale * 2.5,
    octaves: 3,
  });

  const temperature = fbm2D(col, row, {
    ...options,
    seed: decorrelatedSeed(baseSeed, 2674),
    scale: scale * 3.0,
    octaves: 2,
  }) - normalizedHeight * altitudeCooling; // altitude lapse rate — mountains are cold

  const deepWaterLevel = options.deepWaterLevel ?? 0.14;
  const waterLevel = options.waterLevel ?? 0.21;
  const shorelineLevel = options.shorelineLevel ?? 0.27;

  const isFlat = slope < 0.22 && ridge < 0.42;
  const isPeak = normalizedHeight > 0.83 || mountainness > 0.72;

  // Water / elevation gates first
  if (normalizedHeight < deepWaterLevel) return 'deep_water';
  if (normalizedHeight < waterLevel) return 'water';
  if (normalizedHeight < shorelineLevel) return moisture > 0.5 ? 'wetland' : 'sand';

  // Polar / high-altitude
  if (isPeak || temperature < 0.12) {
    return moisture > 0.4 ? 'snow' : 'stone';
  }

  // Broad plains in temperate low-slope terrain.
  if (isFlat && normalizedHeight > 0.30 && normalizedHeight < 0.62) {
    if (temperature > 0.62) return moisture > 0.36 ? 'savanna' : 'desert';
    if (temperature > 0.35) return moisture > 0.24 ? 'grass' : 'sand';
    return moisture > 0.55 ? 'taiga' : 'tundra';
  }

  // Whittaker diagram: temperature vs moisture
  if (temperature < 0.30) {
    // Cold band: polar/arctic
    if (mountainness > 0.52) return moisture > 0.4 ? 'snow' : 'stone';
    return moisture > 0.55 ? 'taiga' : 'tundra';
  }
  if (temperature < 0.55) {
    // Temperate band
    if (moisture > 0.70) return 'temperate_rainforest';
    if (moisture > 0.45) return 'forest';
    if (moisture > 0.18) return 'grass';
    return 'desert';
  }
  // Hot band: tropical
  if (moisture > 0.65) return 'jungle';
  if (moisture > 0.32) return 'savanna';
  return 'desert';
}

function hash3D(x, y, z, seed) {
  const s = seedToNumber(seed);
  let n = (x * 374761393 + y * 668265263 + z * 2147483647) >>> 0;
  n = (n ^ s) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return (n >>> 0) / 4294967295;
}

export function valueNoise3D(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;

  const sx = fade(x - x0);
  const sy = fade(y - y0);
  const sz = fade(z - z0);

  const n000 = hash3D(x0, y0, z0, seed);
  const n100 = hash3D(x1, y0, z0, seed);
  const n010 = hash3D(x0, y1, z0, seed);
  const n110 = hash3D(x1, y1, z0, seed);
  const n001 = hash3D(x0, y0, z1, seed);
  const n101 = hash3D(x1, y0, z1, seed);
  const n011 = hash3D(x0, y1, z1, seed);
  const n111 = hash3D(x1, y1, z1, seed);

  const nx00 = lerp(n000, n100, sx);
  const nx10 = lerp(n010, n110, sx);
  const nx01 = lerp(n001, n101, sx);
  const nx11 = lerp(n011, n111, sx);

  const nxy0 = lerp(nx00, nx10, sy);
  const nxy1 = lerp(nx01, nx11, sy);

  return lerp(nxy0, nxy1, sz);
}

export function fbm3D(x, y, z, options = {}) {
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
    const octaveSeed = (base + i * 1000) >>> 0;
    value += valueNoise3D((x * frequency) / scale, (y * frequency) / scale, (z * frequency) / scale, octaveSeed) * amplitude;
    max += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / max;
}

export function perlin3D(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;

  const sx = fade(x - x0);
  const sy = fade(y - y0);
  const sz = fade(z - z0);

  const g000 = grad3D(x0, y0, z0, seed);
  const g100 = grad3D(x1, y0, z0, seed);
  const g010 = grad3D(x0, y1, z0, seed);
  const g110 = grad3D(x1, y1, z0, seed);
  const g001 = grad3D(x0, y0, z1, seed);
  const g101 = grad3D(x1, y0, z1, seed);
  const g011 = grad3D(x0, y1, z1, seed);
  const g111 = grad3D(x1, y1, z1, seed);

  const dx0 = x - x0;
  const dy0 = y - y0;
  const dz0 = z - z0;
  const dx1 = x - x1;
  const dy1 = y - y1;
  const dz1 = z - z1;

  const n000 = g000.x * dx0 + g000.y * dy0 + g000.z * dz0;
  const n100 = g100.x * dx1 + g100.y * dy0 + g100.z * dz0;
  const n010 = g010.x * dx0 + g010.y * dy1 + g010.z * dz0;
  const n110 = g110.x * dx1 + g110.y * dy1 + g110.z * dz0;
  const n001 = g001.x * dx0 + g001.y * dy0 + g001.z * dz1;
  const n101 = g101.x * dx1 + g101.y * dy0 + g101.z * dz1;
  const n011 = g011.x * dx0 + g011.y * dy1 + g011.z * dz1;
  const n111 = g111.x * dx1 + g111.y * dy1 + g111.z * dz1;

  const nx00 = lerp(n000, n100, sx);
  const nx10 = lerp(n010, n110, sx);
  const nx01 = lerp(n001, n101, sx);
  const nx11 = lerp(n011, n111, sx);

  const nxy0 = lerp(nx00, nx10, sy);
  const nxy1 = lerp(nx01, nx11, sy);

  const nxyz = lerp(nxy0, nxy1, sz);
  return clamp01((nxyz + 1) * 0.5);
}

export function worley3D(x, y, z, seed) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const cellZ = Math.floor(z);

  let nearest = Infinity;
  let secondNearest = Infinity;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = cellX + dx;
        const cy = cellY + dy;
        const cz = cellZ + dz;

        const fx = cx + hash3D(cx, cy, cz, seed);
        const fy = cy + hash3D(cx + 11, cy + 17, cz + 23, seed);
        const fz = cz + hash3D(cx + 31, cy + 37, cz + 41, seed);

        const ddx = fx - x;
        const ddy = fy - y;
        const ddz = fz - z;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);

        if (dist < nearest) {
          secondNearest = nearest;
          nearest = dist;
        } else if (dist < secondNearest) {
          secondNearest = dist;
        }
      }
    }
  }

  const maxDistance = Math.sqrt(3);
  const f1 = nearest / maxDistance;
  const f2 = secondNearest / maxDistance;
  return {
    f1,
    f2,
    ridge: clamp01(f2 - f1),
  };
}