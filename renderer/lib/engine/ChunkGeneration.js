import { BLOCK_IDS, CHUNK_HEIGHT, chunkArrayLength, voxelIndex, DEFAULT_WORLD_OPTIONS } from './World.js';
import { fbmPerlin2D, generateBiomeAt, perlin2D, ridgedPerlin2D, worley3D } from './Noise.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sampleTerrainHeight(col, row, options) {
  const terrainSeed = options.terrainSeed ?? options.seed ?? 0;
  const terrainScale = options.terrainScale ?? Math.max(64, (options.scale || 40) * 2.4);
  const terrainOctaves = options.terrainOctaves ?? 5;
  const terrainPersistence = options.terrainPersistence ?? 0.52;
  const terrainLacunarity = options.terrainLacunarity ?? 2.0;
  const terrainRidgeScale = options.terrainRidgeScale ?? terrainScale * 0.5;
  const terrainPeakScale = options.terrainPeakScale ?? terrainScale * 0.22;
  const terrainExponent = options.terrainExponent ?? 1.08;
  const terrainMinHeight = options.terrainMinHeight ?? options.minHeight ?? 0;
  const terrainMaxHeight = options.terrainMaxHeight ?? Math.max(options.maxHeight ?? 20, 42);

  const continental = fbmPerlin2D(col, row, {
    seed: terrainSeed,
    scale: terrainScale,
    octaves: terrainOctaves,
    persistence: terrainPersistence,
    lacunarity: terrainLacunarity,
  });

  const ridged = ridgedPerlin2D(col, row, {
    seed: typeof terrainSeed === 'number' ? terrainSeed + 101 : `${terrainSeed}_ridge`,
    scale: terrainRidgeScale,
    octaves: Math.max(3, terrainOctaves - 1),
    persistence: terrainPersistence,
    lacunarity: terrainLacunarity,
    exponent: options.terrainRidgeExponent ?? 2.2,
  });

  const peak = Math.pow(
    perlin2D(
      col / terrainPeakScale,
      row / terrainPeakScale,
      typeof terrainSeed === 'number' ? terrainSeed + 31337 : `${terrainSeed}_peak`
    ),
    options.terrainPeakPower ?? 4.0
  );

  let height01 = (continental * 0.34) + (ridged * 0.46) + (peak * 0.20);
  height01 = clamp01(Math.pow(height01, terrainExponent));

  return {
    normalizedHeight: height01,
    surfaceY: Math.round(terrainMinHeight + height01 * (terrainMaxHeight - terrainMinHeight)),
  };
}

function shouldCarveCave(col, row, y, surfaceY, chunkHeight, options) {
  const caveSeed = options.caveSeed ?? (typeof options.seed === 'number' ? options.seed + 999 : `${options.seed}_999`);
  const caveScale = options.caveScale ?? 18;
  const cave = worley3D(col / caveScale, y / caveScale, row / caveScale, caveSeed);

  const depthBelowSurface = Math.max(0, surfaceY - y);
  const depth01 = clamp01(depthBelowSurface / Math.max(1, chunkHeight - 1));
  const widen = Math.pow(depth01, options.caveDepthCurve ?? 1.35);
  const threshold = lerp(options.caveSurfaceThreshold ?? 0.03, options.caveDeepThreshold ?? 0.18, widen);

  return cave.ridge < threshold;
}

export function generateChunkData(cx, cy, chunkSize, chunkHeight, options = {}) {
  const opts = { ...DEFAULT_WORLD_OPTIONS, ...(options || {}) };
  const localChunkHeight = Number(chunkHeight || opts.chunkHeight) || CHUNK_HEIGHT;
  const blocks = new Uint8Array(chunkArrayLength(chunkSize, localChunkHeight));
  const startC = cx * chunkSize;
  const startR = cy * chunkSize;

  for (let z = 0; z < chunkSize; z++) {
    for (let x = 0; x < chunkSize; x++) {
      const col = startC + x;
      const row = startR + z;
      const terrain = sampleTerrainHeight(col, row, opts);
      const biomeStr = generateBiomeAt(col, row, terrain.normalizedHeight, opts);
      let surfaceBlockId = BLOCK_IDS.GRASS;
      if (biomeStr === 'water') surfaceBlockId = BLOCK_IDS.WATER;
      if (biomeStr === 'sand') surfaceBlockId = BLOCK_IDS.SAND;
      if (biomeStr === 'snow') surfaceBlockId = BLOCK_IDS.SNOW;
      if (biomeStr === 'desert') surfaceBlockId = BLOCK_IDS.DESERT;
      if (biomeStr === 'forest') surfaceBlockId = BLOCK_IDS.FOREST;

      for (let y = 0; y < localChunkHeight; y++) {
        const index = voxelIndex(x, y, z, chunkSize, localChunkHeight);
        const surfaceY = terrain.surfaceY;

        if (y > surfaceY) {
          blocks[index] = BLOCK_IDS.AIR;
        } else if (y === surfaceY) {
          blocks[index] = surfaceBlockId;
        } else if (y >= surfaceY - 3) {
          if (surfaceBlockId === BLOCK_IDS.SAND || surfaceBlockId === BLOCK_IDS.DESERT) {
            blocks[index] = BLOCK_IDS.SAND;
          } else {
            blocks[index] = BLOCK_IDS.DIRT;
          }
        } else {
            if (shouldCarveCave(col, row, y, surfaceY, localChunkHeight, opts)) {
            blocks[index] = BLOCK_IDS.AIR;
          } else {
            blocks[index] = BLOCK_IDS.STONE;
          }
        }
      }
    }
  }

  return { chunkHeight: localChunkHeight, blocks };
}
