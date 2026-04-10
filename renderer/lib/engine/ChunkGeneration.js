import { BLOCK_IDS, CHUNK_HEIGHT, chunkArrayLength, voxelIndex, DEFAULT_WORLD_OPTIONS, packVoxel } from './World.js';
import { fbmPerlin2D, fbm2D, generateBiomeAt, perlin2D, perlin3D, ridgedPerlin2D, worley3D, hash2D_export } from './Noise.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sampleClimateFields(col, row, options) {
  const climateSeed = options.biomeSeed ?? options.seed ?? 0;
  const climateScale = options.biomeScale ?? Math.max(220, (options.scale || 150) * 1.8);
  const moisture = fbm2D(col, row, {
    seed: typeof climateSeed === 'number' ? climateSeed + 1337 : `${climateSeed}_1337`,
    scale: climateScale,
    octaves: 3,
    persistence: 0.52,
    lacunarity: 2.0,
  });
  const temperature = fbm2D(col, row, {
    seed: typeof climateSeed === 'number' ? climateSeed + 2674 : `${climateSeed}_2674`,
    scale: climateScale * 1.2,
    octaves: 2,
    persistence: 0.55,
    lacunarity: 2.0,
  });
  return { moisture: clamp01(moisture), temperature: clamp01(temperature) };
}

function terrainPresetFromClimate(climate) {
  const { moisture, temperature } = climate;

  if (temperature > 0.66 && moisture < 0.34) {
    return { name: 'desert', baseHeight: 0.40, roughness: 0.10, mountainPower: 0.10, detail: 0.02 };
  }
  if (temperature < 0.32) {
    return { name: 'cold', baseHeight: 0.50, roughness: 0.17, mountainPower: 0.34, detail: 0.04 };
  }
  if (moisture > 0.66) {
    return { name: 'humid', baseHeight: 0.48, roughness: 0.16, mountainPower: 0.22, detail: 0.04 };
  }
  if (moisture > 0.40 && temperature > 0.36 && temperature < 0.64) {
    return { name: 'plains', baseHeight: 0.44, roughness: 0.12, mountainPower: 0.12, detail: 0.03 };
  }
  return { name: 'mixed', baseHeight: 0.47, roughness: 0.15, mountainPower: 0.28, detail: 0.04 };
}

function sampleTerrainHeight(col, row, options) {
  const terrainSeed = options.terrainSeed ?? options.seed ?? 0;
  const terrainScale = options.terrainScale ?? Math.max(70, (options.scale || 150) * 0.95);
  const terrainOctaves = options.terrainOctaves ?? 5;
  const terrainPersistence = options.terrainPersistence ?? 0.52;
  const terrainLacunarity = options.terrainLacunarity ?? 2.0;
  const continentScale = options.continentScale ?? Math.max(700, terrainScale * 8.0);
  const mountainMaskScale = options.mountainMaskScale ?? Math.max(360, terrainScale * 4.0);
  const terrainRidgeScale = options.terrainRidgeScale ?? Math.max(60, terrainScale * 0.58);
  const terrainPeakScale = options.terrainPeakScale ?? Math.max(28, terrainScale * 0.24);
  const terrainExponent = options.terrainExponent ?? 1.0;
  const terrainMinHeight = options.terrainMinHeight ?? options.minHeight ?? 0;
  const chunkHeight = options.chunkHeight ?? 64;
  const terrainMaxDefault = Math.max(22, Math.floor(chunkHeight * 0.92));
  const terrainMaxHeight = Math.min(
    options.terrainMaxHeight ?? options.maxHeight ?? terrainMaxDefault,
    Math.max(terrainMinHeight + 4, chunkHeight - 1)
  );

  const climate = sampleClimateFields(col, row, options);
  const preset = terrainPresetFromClimate(climate);

  const continent = fbmPerlin2D(col, row, {
    seed: terrainSeed,
    scale: continentScale,
    octaves: 3,
    persistence: 0.56,
    lacunarity: 2.0,
  });

  const hills = fbmPerlin2D(col, row, {
    seed: typeof terrainSeed === 'number' ? terrainSeed + 17 : `${terrainSeed}_hills`,
    scale: terrainScale,
    octaves: terrainOctaves,
    persistence: terrainPersistence,
    lacunarity: terrainLacunarity,
  }) * 2 - 1;

  const mountainMaskRaw = fbmPerlin2D(col, row, {
    seed: typeof terrainSeed === 'number' ? terrainSeed + 71 : `${terrainSeed}_mountain_mask`,
    scale: mountainMaskScale,
    octaves: 3,
    persistence: 0.55,
    lacunarity: 2.0,
  });
  const mountainMask = clamp01((mountainMaskRaw - 0.26) / 0.74);

  const ridge = ridgedPerlin2D(col, row, {
    seed: typeof terrainSeed === 'number' ? terrainSeed + 101 : `${terrainSeed}_ridge`,
    scale: terrainRidgeScale,
    octaves: Math.max(3, terrainOctaves - 1),
    persistence: terrainPersistence,
    lacunarity: terrainLacunarity,
    exponent: options.terrainRidgeExponent ?? 2.2,
  });

  const detail = (perlin2D(
    col / terrainPeakScale,
    row / terrainPeakScale,
    typeof terrainSeed === 'number' ? terrainSeed + 31337 : `${terrainSeed}_peak`
  ) * 2 - 1);

  const continentLift = (continent - 0.5) * (options.continentAmplitude ?? 0.46);
  const hillsContribution = hills * (options.hillAmplitude ?? preset.roughness);
  const ridgeContribution = ridge * mountainMask * (options.mountainAmplitude ?? preset.mountainPower);
  const detailContribution = detail * (options.detailAmplitude ?? preset.detail);

  const cliffNoise = ridgedPerlin2D(col, row, {
    seed: typeof terrainSeed === 'number' ? terrainSeed + 909 : `${terrainSeed}_cliff`,
    scale: Math.max(28, terrainRidgeScale * 0.34),
    octaves: 4,
    persistence: 0.56,
    lacunarity: 2.2,
    exponent: options.cliffRidgeExponent ?? 2.8,
  });
  const cliffMask = clamp01(mountainMask * 0.7 + Math.max(0, ridge - 0.52) * 1.05);
  const cliffContribution = Math.pow(cliffNoise, 2.0) * cliffMask * (options.cliffAmplitude ?? 0.18);

  const crackNoise = perlin2D(
    col / Math.max(20, terrainRidgeScale * 0.24),
    row / Math.max(20, terrainRidgeScale * 0.24),
    typeof terrainSeed === 'number' ? terrainSeed + 12345 : `${terrainSeed}_crack`
  ) * 2 - 1;
  const crackSignal = clamp01((Math.abs(crackNoise) - 0.58) / 0.42);
  const crackContribution = crackSignal * cliffMask * (options.crackAmplitude ?? 0.12);

  let height01 =
    preset.baseHeight +
    continentLift +
    hillsContribution +
    ridgeContribution +
    detailContribution +
    cliffContribution -
    crackContribution;

  const mountainBoost = options.mountainBoost ?? 0.4;
  const terrainHeightBias = options.terrainHeightBias ?? -0.12;
  height01 += Math.max(0, ridge - 0.55) * mountainMask * mountainBoost;

  const terraceSteps = options.cliffTerraceSteps ?? 12;
  const terraceStrength = options.cliffTerraceStrength ?? 0.12;
  const terraced = Math.floor(height01 * terraceSteps) / terraceSteps;
  height01 = lerp(height01, terraced, terraceStrength * cliffMask);

  height01 += terrainHeightBias;
  height01 = clamp01(Math.pow(height01, terrainExponent));

  const slope = clamp01((Math.abs(hills) * 0.35) + (ridge * 0.65));
  const mountainness = clamp01(
    (Math.max(0, height01 - 0.58) / 0.42) * 0.4 +
    (Math.max(0, ridge - 0.42) / 0.58) * 0.35 +
    mountainMask * 0.25
  );

  return {
    continental: continent,
    ridged: ridge,
    peak: detail,
    mountainMask,
    preset: preset.name,
    climate,
    slope,
    mountainness,
    normalizedHeight: height01,
    surfaceY: Math.round(terrainMinHeight + height01 * (terrainMaxHeight - terrainMinHeight)),
  };
}

function shouldCarveCave(col, row, y, surfaceY, chunkHeight, options, terrain) {
  const depthBelowSurface = Math.max(0, surfaceY - y);

  const mountainness = terrain?.mountainness ?? 0;
  const minCoverLowland = options.caveMinSurfaceCover ?? 1;
  const minCoverMountain = options.caveMinSurfaceCoverMountain ?? 4;
  const minCover = Math.round(lerp(minCoverLowland, minCoverMountain, mountainness));

  // Keep top soil mostly intact
  if (depthBelowSurface < minCover) return false;

  const caveSeed = options.caveSeed ?? (typeof options.seed === 'number' ? options.seed + 999 : `${options.seed}_999`);
  const caveScale = options.caveScale ?? 18;

  const cave = worley3D(col / caveScale, y / caveScale, row / caveScale, caveSeed);

  const tunnelScale = caveScale * 0.6;
  const tunnel = perlin3D(
    col / tunnelScale,
    y / (tunnelScale * 3),
    row / tunnelScale,
    typeof caveSeed === 'number' ? caveSeed + 7777 : `${caveSeed}_7777`
  );

  const depth01 = clamp01(depthBelowSurface / Math.max(1, chunkHeight - 1));
  const widen = Math.pow(depth01, 1.35);
  const depthShield = clamp01((depthBelowSurface - minCover) / 7);

  // Adjusted Worley threshold so chambers aren't too massive
  const chamberThreshold = lerp(0.02, 0.12, widen) * lerp(0.72, 1.0, depthShield);

  // THE FIX: Define a narrow 'thickness' for tunnels instead of a massive blob cutoff
  const tunnelThickness = lerp(0.035, 0.075, widen) + mountainness * 0.01;

  // Carve if we hit a chamber, OR if the noise is right in the middle 0.5 band (a tube)
  const isChamber = cave.ridge < chamberThreshold;
  const isTunnel = Math.abs(tunnel - 0.5) < tunnelThickness;

  return isChamber || isTunnel;
}

function shouldOpenSurfaceAtColumn(col, row, surfaceY, terrain, biome, chunkHeight, options) {
  if (biome === 'deep_water' || biome === 'water') return false;

  const mountainness = terrain?.mountainness ?? 0;
  const slope = terrain?.slope ?? 0;
  const normalizedHeight = terrain?.normalizedHeight ?? 0;
  const maxMountainness = options.surfaceOpeningMountainCutoff ?? 0.52;
  const minSlope = options.surfaceOpeningMinSlope ?? 0.22;
  const maxSlope = options.surfaceOpeningMaxSlope ?? 0.62;
  const maxOpeningHeight01 = options.surfaceOpeningMaxHeight01 ?? 0.72;
  const isStonyMountain = (biome === 'stone' || biome === 'snow') && mountainness > 0.72 && slope > 0.46;
  if (!isStonyMountain && (slope < minSlope || slope > maxSlope)) return false;
  if (mountainness > maxMountainness || normalizedHeight > maxOpeningHeight01) return false;

  const caveSeed = options.caveSeed ?? (typeof options.seed === 'number' ? options.seed + 999 : `${options.seed}_999`);
  const caveScale = options.caveScale ?? 18;
  const sampleY = Math.max(1, surfaceY - 1);
  const chamber = worley3D(col / caveScale, sampleY / caveScale, row / caveScale, caveSeed);
  const tunnel = perlin3D(
    col / (caveScale * 0.6),
    sampleY / (caveScale * 1.5),
    row / (caveScale * 0.6),
    typeof caveSeed === 'number' ? caveSeed + 7777 : `${caveSeed}_7777`
  );

  const depthFactor = clamp01(1 - (normalizedHeight / Math.max(0.01, maxOpeningHeight01)));
  const baseChance = options.surfaceOpeningChance ?? 0.09;
  const chance = isStonyMountain
    ? (options.mountainArchOpeningChance ?? 0.012)
    : baseChance * (1 - mountainness * 0.9) * depthFactor;
  const roll = hash2D_export(Math.floor(col), Math.floor(row), (typeof caveSeed === 'number' ? caveSeed + 424242 : `${caveSeed}_424242`));
  // Match the new 'tube' logic so surface holes properly connect to the tunnels below
  const signalHit = isStonyMountain
    ? (chamber.ridge < 0.06 || Math.abs(tunnel - 0.5) < 0.05)
    : (chamber.ridge < 0.08 || Math.abs(tunnel - 0.5) < 0.04);

  // Keep openings where cave fields already want voids, not arbitrary surface holes.
  return signalHit && roll < chance;
}

export function sampleTerrainDebug(col, row, options = {}) {
  return sampleTerrainHeight(col, row, options);
}

// Check if current position is within a stalactite/stalagmite spike
function isStalactite(col, row, y, surfaceY, options) {
  const n = perlin2D(col / 4.0, row / 4.0, options.seed + 5555);
  const spike = Math.floor(n * 5); // 0–4 blocks tall
  // True if within spike range of cave ceiling/floor
  return y >= surfaceY - spike && y <= surfaceY;
}

// Get a biome-specific block palette with terrain-aware shoreline/slope variants.
function getBiomeBlockPalette(biome, terrain, options) {
  const slope = terrain?.slope ?? 0;
  const mountainness = terrain?.mountainness ?? 0;
  const normalizedHeight = terrain?.normalizedHeight ?? 0;
  const nearWater = normalizedHeight <= (options.waterLevel ?? 0.21) + (options.shorelineBand ?? 0.04);
  const steep = slope >= (options.rockySlopeThreshold ?? 0.48) || mountainness >= 0.68;

  const palettes = {
    deep_water: { surface: BLOCK_IDS.WATER, sub: BLOCK_IDS.WATER, deep: BLOCK_IDS.WATER },
    water: { surface: BLOCK_IDS.WATER, sub: BLOCK_IDS.WATER, deep: BLOCK_IDS.WATER },
    wetland: { surface: BLOCK_IDS.DIRT, sub: BLOCK_IDS.DIRT, deep: BLOCK_IDS.STONE },
    sand: { surface: BLOCK_IDS.SAND, sub: BLOCK_IDS.SAND, deep: BLOCK_IDS.STONE },
    tundra: { surface: BLOCK_IDS.SNOW, sub: BLOCK_IDS.DIRT, deep: BLOCK_IDS.STONE },
    snow: { surface: BLOCK_IDS.SNOW, sub: BLOCK_IDS.STONE, deep: BLOCK_IDS.STONE },
    stone: { surface: BLOCK_IDS.STONE, sub: BLOCK_IDS.STONE, deep: BLOCK_IDS.STONE },
    taiga: { surface: BLOCK_IDS.FOREST, sub: BLOCK_IDS.DIRT, deep: BLOCK_IDS.STONE },
    forest: { surface: BLOCK_IDS.FOREST, sub: BLOCK_IDS.DIRT, deep: BLOCK_IDS.STONE },
    temperate_rainforest: { surface: BLOCK_IDS.FOREST, sub: BLOCK_IDS.DIRT, deep: BLOCK_IDS.STONE },
    grass: { surface: BLOCK_IDS.GRASS, sub: BLOCK_IDS.DIRT, deep: BLOCK_IDS.STONE },
    desert: { surface: BLOCK_IDS.DESERT, sub: BLOCK_IDS.SAND, deep: BLOCK_IDS.STONE },
    jungle: { surface: BLOCK_IDS.FOREST, sub: BLOCK_IDS.DIRT, deep: BLOCK_IDS.STONE },
    savanna: { surface: BLOCK_IDS.GRASS, sub: BLOCK_IDS.SAND, deep: BLOCK_IDS.STONE },
  };

  const palette = palettes[biome] ?? { surface: BLOCK_IDS.GRASS, sub: BLOCK_IDS.DIRT, deep: BLOCK_IDS.STONE };

  if (biome === 'grass' || biome === 'savanna') {
    if (nearWater) return { surface: BLOCK_IDS.SAND, sub: BLOCK_IDS.SAND, deep: BLOCK_IDS.STONE };
    return palette;
  }

  if (biome === 'forest' || biome === 'taiga' || biome === 'temperate_rainforest' || biome === 'jungle') {
    if (steep) return { surface: BLOCK_IDS.STONE, sub: BLOCK_IDS.STONE, deep: BLOCK_IDS.STONE };
    return palette;
  }

  if (biome === 'desert') {
    if (steep || nearWater) return { surface: BLOCK_IDS.SAND, sub: BLOCK_IDS.SAND, deep: BLOCK_IDS.STONE };
    return palette;
  }

  if (biome === 'wetland' && nearWater) {
    return { surface: BLOCK_IDS.SAND, sub: BLOCK_IDS.DIRT, deep: BLOCK_IDS.STONE };
  }

  return palette;
}

// Blend between adjacent biomes to avoid hard edges
function blendedBiomeAt(col, row, terrain, options) {
  const primary = generateBiomeAt(col, row, terrain.normalizedHeight, { ...options, terrain });

  // Sample 3 nearby points in a triangle
  const r = 2.5; // blend radius in world units
  const t1 = sampleTerrainHeight(col + r, row, options);
  const t2 = sampleTerrainHeight(col, row + r, options);
  const t3 = sampleTerrainHeight(col - r, row - r, options);
  const b1 = generateBiomeAt(col + r, row, t1.normalizedHeight, { ...options, terrain: t1 });
  const b2 = generateBiomeAt(col, row + r, t2.normalizedHeight, { ...options, terrain: t2 });
  const b3 = generateBiomeAt(col - r, row - r, t3.normalizedHeight, { ...options, terrain: t3 });

  // If any neighbor matches, it's a stable region → use primary
  if (b1 === primary || b2 === primary || b3 === primary) return primary;

  // All four disagree → transition zone, use a noise tiebreaker
  const baseSeed = options.seed ?? 0;
  const tiebreaker = hash2D_export(Math.floor(col), Math.floor(row), baseSeed + 9999);
  return [primary, b1, b2, b3][Math.floor(tiebreaker * 4)];
}

export function generateChunkData(cx, cy, chunkSize, chunkHeight, options = {}) {
  const opts = { ...DEFAULT_WORLD_OPTIONS, ...(options || {}) };
  const localChunkHeight = Number(chunkHeight || opts.chunkHeight) || CHUNK_HEIGHT;
  const terrainMaxHeight = Math.min(opts.terrainMaxHeight ?? opts.maxHeight ?? Math.floor(localChunkHeight * 0.92), localChunkHeight - 1);
  const generationOpts = {
    ...opts,
    chunkHeight: localChunkHeight,
    terrainMaxHeight,
  };
  const blocks = new Uint32Array(chunkArrayLength(chunkSize, localChunkHeight));
  const startC = cx * chunkSize;
  const startR = cy * chunkSize;

  // Lava appears in the bottom 8% of the chunk
  const lavaLevel = Math.floor(localChunkHeight * 0.08);
  const seaLevel = Number.isFinite(generationOpts.seaLevel)
    ? Math.max(1, Math.min(localChunkHeight - 1, Math.floor(generationOpts.seaLevel)))
    : Math.floor((terrainMaxHeight - (generationOpts.terrainMinHeight ?? generationOpts.minHeight ?? 0)) * 0.36);

  for (let z = 0; z < chunkSize; z++) {
    for (let x = 0; x < chunkSize; x++) {
      const col = startC + x;
      const row = startR + z;
      const terrain = sampleTerrainHeight(col, row, generationOpts);
      const surfaceY = terrain.surfaceY;

      // Use blended biome for smooth transitions
      const biomeStr = blendedBiomeAt(col, row, terrain, generationOpts);
      const palette = getBiomeBlockPalette(biomeStr, terrain, generationOpts);
      const hasSurfaceOpening = shouldOpenSurfaceAtColumn(col, row, surfaceY, terrain, biomeStr, localChunkHeight, generationOpts);
      const topSoilDepth = generationOpts.topSoilDepth ?? 2;

      for (let y = 0; y < localChunkHeight; y++) {
        const index = voxelIndex(x, y, z, chunkSize, localChunkHeight);

        let blockId = BLOCK_IDS.AIR;

        if (y > surfaceY) {
          // Volumetric water fill up to sea level, otherwise open air.
          blockId = y <= seaLevel ? BLOCK_IDS.WATER : BLOCK_IDS.AIR;
        } else if (y === surfaceY) {
          // Openings remove the cap block only when cave signals and lowland checks agree.
          blockId = hasSurfaceOpening ? BLOCK_IDS.AIR : palette.surface;
        } else if (y >= surfaceY - topSoilDepth) {
          // Near-surface layer: allow connected opening shaft for selected columns.
          if (hasSurfaceOpening) {
            blockId = y <= seaLevel ? BLOCK_IDS.WATER : BLOCK_IDS.AIR;
          } else {
            blockId = palette.sub;
          }
        } else {
          // Deep layer: caves or stone
          const isCave = shouldCarveCave(col, row, y, surfaceY, localChunkHeight, generationOpts, terrain);
          if (isCave) {
            // Check if this is a cave floor (solid block below)
            const isFloor = y > 0 && !shouldCarveCave(col, row, y - 1, surfaceY, localChunkHeight, generationOpts, terrain);

            if (y <= lavaLevel && isFloor) {
              // Deep cave floors become lava
              blockId = BLOCK_IDS.LAVA;
            } else if (isStalactite(col, row, y, surfaceY, generationOpts)) {
              // Stalactites hang from ceiling
              blockId = palette.deep;
            } else {
              // Regular cave air
              blockId = BLOCK_IDS.AIR;
            }
          } else {
            // Solid rock
            blockId = palette.deep;
          }
        }

        const skyLight = y > surfaceY ? 15 : 0;
        const blockLight = blockId === BLOCK_IDS.LAVA ? 12 : 0;
        blocks[index] = packVoxel(blockId, skyLight, blockLight, 0);
      }
    }
  }

  return { chunkHeight: localChunkHeight, blocks };
}
