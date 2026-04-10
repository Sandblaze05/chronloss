import { createTile } from './Tile.js';
import { generateHeightAt } from './Noise.js';

export const CHUNK_SIZE = 32;
export const CHUNK_HEIGHT = 128;

export const BLOCK_IDS = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS: 3,
  SAND: 4,
  WATER: 5,
  SNOW: 6,
  DESERT: 7,
  FOREST: 8,
  LAVA: 9,
};

export const VOXEL_BLOCK_ID_BITS = 8;
export const VOXEL_LIGHT_BITS = 4;
export const VOXEL_FLAGS_BITS = 8;

export const VOXEL_BLOCK_ID_SHIFT = 0;
export const VOXEL_SKY_LIGHT_SHIFT = VOXEL_BLOCK_ID_SHIFT + VOXEL_BLOCK_ID_BITS;
export const VOXEL_BLOCK_LIGHT_SHIFT = VOXEL_SKY_LIGHT_SHIFT + VOXEL_LIGHT_BITS;
export const VOXEL_FLAGS_SHIFT = VOXEL_BLOCK_LIGHT_SHIFT + VOXEL_LIGHT_BITS;

export const VOXEL_BLOCK_ID_MASK = (1 << VOXEL_BLOCK_ID_BITS) - 1;
export const VOXEL_LIGHT_MASK = (1 << VOXEL_LIGHT_BITS) - 1;
export const VOXEL_FLAGS_MASK = (1 << VOXEL_FLAGS_BITS) - 1;

export function packVoxel(blockId, skyLight = 15, blockLight = 0, flags = 0) {
  return (
    ((blockId & VOXEL_BLOCK_ID_MASK) << VOXEL_BLOCK_ID_SHIFT)
    | ((skyLight & VOXEL_LIGHT_MASK) << VOXEL_SKY_LIGHT_SHIFT)
    | ((blockLight & VOXEL_LIGHT_MASK) << VOXEL_BLOCK_LIGHT_SHIFT)
    | ((flags & VOXEL_FLAGS_MASK) << VOXEL_FLAGS_SHIFT)
  ) >>> 0;
}

export function getBlockIdFromVoxel(voxelWord) {
  return (voxelWord >>> VOXEL_BLOCK_ID_SHIFT) & VOXEL_BLOCK_ID_MASK;
}

export function getSkyLightFromVoxel(voxelWord) {
  return (voxelWord >>> VOXEL_SKY_LIGHT_SHIFT) & VOXEL_LIGHT_MASK;
}

export function getBlockLightFromVoxel(voxelWord) {
  return (voxelWord >>> VOXEL_BLOCK_LIGHT_SHIFT) & VOXEL_LIGHT_MASK;
}

export function getVoxelFlags(voxelWord) {
  return (voxelWord >>> VOXEL_FLAGS_SHIFT) & VOXEL_FLAGS_MASK;
}

function hasPackedVoxelStorage(chunk) {
  return !!(chunk?.blocks && chunk.blocks.BYTES_PER_ELEMENT >= 2);
}

function withClampedNibble(value) {
  return Math.max(0, Math.min(VOXEL_LIGHT_MASK, Number(value) || 0));
}

function withClampedByte(value) {
  return Math.max(0, Math.min(VOXEL_FLAGS_MASK, Number(value) || 0));
}

export const DEFAULT_WORLD_OPTIONS = {
  seed: 0,
  chunkHeight: CHUNK_HEIGHT,
  seaLevel: Math.floor(CHUNK_HEIGHT * 0.47),
  scale: 500, // Larger scale works better with domain warping and multi-layer noise
  continentScale: 2400,
  mountainMaskScale: 540,
  continentAmplitude: 0.62,
  hillAmplitude: 0.18,
  mountainAmplitude: 0.85,
  detailAmplitude: 0.04,
  mountainBoost: 0.75,
  terrainHeightBias: -0.12,
  cliffAmplitude: 0.18,
  crackAmplitude: 0.12,
  cliffTerraceSteps: 12,
  cliffTerraceStrength: 0.12,
  mountainArchOpeningChance: 0.012,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2,
  minHeight: 0,
  maxHeight: CHUNK_HEIGHT - 2,
  blockHeight: 1, // dont change
  caveScale: 24,
  caveOctaves: 3,
  cavePersistence: 0.5,
  caveLacunarity: 2,
  caveThreshold: 0.3,
  caveMinSurfaceCover: 1,
  caveMinSurfaceCoverMountain: 4,
  surfaceOpeningChance: 0.06,
  surfaceOpeningMountainCutoff: 0.52,
  surfaceOpeningMinSlope: 0.30,
  surfaceOpeningMaxSlope: 0.55,
  surfaceOpeningMaxHeight01: 0.72,
  topSoilDepth: 1,
  biomeAltitudeCooling: 0.28,
  deepWaterLevel: 0.14,
  waterLevel: 0.21,
  shorelineLevel: 0.27,
  useErosion: true, // Enable erosion approximation
  useReshape: true, // Enable height curve reshaping
  exponent: 1.1, // Slight upward curve for more interesting landforms
};

export function chunkArrayLength(chunkSize = CHUNK_SIZE, chunkHeight = CHUNK_HEIGHT) {
  return chunkSize * chunkSize * chunkHeight;
}

export function createChunkVoxelArray(chunkSize = CHUNK_SIZE, chunkHeight = CHUNK_HEIGHT, defaultBlockId = BLOCK_IDS.AIR) {
  const count = chunkArrayLength(chunkSize, chunkHeight);
  const blocks = new Uint32Array(count);
  if (defaultBlockId === BLOCK_IDS.AIR) return blocks;

  const packed = packVoxel(defaultBlockId, 0, 0, 0);
  blocks.fill(packed);
  return blocks;
}

export function voxelIndex(x, y, z, chunkSize = CHUNK_SIZE, chunkHeight = CHUNK_HEIGHT) {
  return x + (y * chunkSize) + (z * chunkSize * chunkHeight);
}

export function inChunkBounds(x, y, z, chunkSize = CHUNK_SIZE, chunkHeight = CHUNK_HEIGHT) {
  return x >= 0 && x < chunkSize && y >= 0 && y < chunkHeight && z >= 0 && z < chunkSize;
}

export function getVoxel(chunk, x, y, z) {
  if (!inChunkBounds(x, y, z, chunk.chunkSize, chunk.chunkHeight)) return BLOCK_IDS.AIR;
  const raw = chunk.blocks[voxelIndex(x, y, z, chunk.chunkSize, chunk.chunkHeight)];
  return hasPackedVoxelStorage(chunk) ? getBlockIdFromVoxel(raw) : raw;
}

export function setVoxel(chunk, x, y, z, blockId) {
  if (!inChunkBounds(x, y, z, chunk.chunkSize, chunk.chunkHeight)) return false;
  const index = voxelIndex(x, y, z, chunk.chunkSize, chunk.chunkHeight);
  if (!hasPackedVoxelStorage(chunk)) {
    chunk.blocks[index] = blockId;
    return true;
  }

  const oldWord = chunk.blocks[index] >>> 0;
  const sky = getSkyLightFromVoxel(oldWord);
  const block = getBlockLightFromVoxel(oldWord);
  const flags = getVoxelFlags(oldWord);
  chunk.blocks[index] = packVoxel(blockId, sky, block, flags);
  return true;
}

export function getPackedVoxel(chunk, x, y, z) {
  if (!inChunkBounds(x, y, z, chunk.chunkSize, chunk.chunkHeight)) return 0;
  const raw = chunk.blocks[voxelIndex(x, y, z, chunk.chunkSize, chunk.chunkHeight)] >>> 0;
  if (hasPackedVoxelStorage(chunk)) return raw;
  return packVoxel(raw, 0, 0, 0);
}

export function setPackedVoxel(chunk, x, y, z, voxelWord) {
  if (!inChunkBounds(x, y, z, chunk.chunkSize, chunk.chunkHeight)) return false;
  chunk.blocks[voxelIndex(x, y, z, chunk.chunkSize, chunk.chunkHeight)] = voxelWord >>> 0;
  return true;
}

export function getSkyLight(chunk, x, y, z) {
  return getSkyLightFromVoxel(getPackedVoxel(chunk, x, y, z));
}

export function setSkyLight(chunk, x, y, z, value) {
  const word = getPackedVoxel(chunk, x, y, z);
  const next = packVoxel(
    getBlockIdFromVoxel(word),
    withClampedNibble(value),
    getBlockLightFromVoxel(word),
    getVoxelFlags(word)
  );
  return setPackedVoxel(chunk, x, y, z, next);
}

export function getBlockLight(chunk, x, y, z) {
  return getBlockLightFromVoxel(getPackedVoxel(chunk, x, y, z));
}

export function setBlockLight(chunk, x, y, z, value) {
  const word = getPackedVoxel(chunk, x, y, z);
  const next = packVoxel(
    getBlockIdFromVoxel(word),
    getSkyLightFromVoxel(word),
    withClampedNibble(value),
    getVoxelFlags(word)
  );
  return setPackedVoxel(chunk, x, y, z, next);
}

export function setVoxelFlags(chunk, x, y, z, value) {
  const word = getPackedVoxel(chunk, x, y, z);
  const next = packVoxel(
    getBlockIdFromVoxel(word),
    getSkyLightFromVoxel(word),
    getBlockLightFromVoxel(word),
    withClampedByte(value)
  );
  return setPackedVoxel(chunk, x, y, z, next);
}

export function generateWorld(width, height, options = {}) {
  const opts = { ...DEFAULT_WORLD_OPTIONS, ...options };
  const world = new Map();
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const h = generateHeightAt(c, r, opts);
      world.set(`${c},${r}`, createTile(c, r, 'floor', true, h));
    }
  }
  return world;
}

export function keyFor(c, r) {
  return `${c},${r}`;
}

export function getTile(world, c, r) {
  return world.get(keyFor(c, r));
}

// --- Chunk utilities ---
export function chunkKey(cx, cy) {
  return `${cx},${cy}`;
}

export function createChunk(cx, cy, chunkSize = CHUNK_SIZE, options = {}) {
  const tiles = new Map();
  const startC = cx * chunkSize;
  const startR = cy * chunkSize;
  const opts = { ...DEFAULT_WORLD_OPTIONS, ...options };
  for (let r = 0; r < chunkSize; r++) {
    for (let c = 0; c < chunkSize; c++) {
      const gc = startC + c;
      const gr = startR + r;
      const h = generateHeightAt(gc, gr, opts);
      tiles.set(`${gc},${gr}`, createTile(gc, gr, 'floor', true, h));
    }
  }
  return { cx, cy, tiles };
}

export function getTileFromChunk(chunk, c, r) {
  return chunk.tiles.get(`${c},${r}`);
}