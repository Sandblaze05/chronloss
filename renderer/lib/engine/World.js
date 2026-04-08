import { createTile } from './Tile.js';
import { generateHeightAt } from './Noise.js';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 64;

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
};

export const DEFAULT_WORLD_OPTIONS = {
  seed: 0,
  chunkHeight: CHUNK_HEIGHT,
  scale: 150,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2,
  minHeight: 0,
  maxHeight: 100,
  blockHeight: 1, // dont change
  caveScale: 24,
  caveOctaves: 3,
  cavePersistence: 0.5,
  caveLacunarity: 2,
  caveThreshold: 0.3,
};

export function chunkArrayLength(chunkSize = CHUNK_SIZE, chunkHeight = CHUNK_HEIGHT) {
  return chunkSize * chunkSize * chunkHeight;
}

export function voxelIndex(x, y, z, chunkSize = CHUNK_SIZE, chunkHeight = CHUNK_HEIGHT) {
  return x + (y * chunkSize) + (z * chunkSize * chunkHeight);
}

export function inChunkBounds(x, y, z, chunkSize = CHUNK_SIZE, chunkHeight = CHUNK_HEIGHT) {
  return x >= 0 && x < chunkSize && y >= 0 && y < chunkHeight && z >= 0 && z < chunkSize;
}

export function getVoxel(chunk, x, y, z) {
  if (!inChunkBounds(x, y, z, chunk.chunkSize, chunk.chunkHeight)) return BLOCK_IDS.AIR;
  return chunk.blocks[voxelIndex(x, y, z, chunk.chunkSize, chunk.chunkHeight)];
}

export function setVoxel(chunk, x, y, z, blockId) {
  if (!inChunkBounds(x, y, z, chunk.chunkSize, chunk.chunkHeight)) return false;
  chunk.blocks[voxelIndex(x, y, z, chunk.chunkSize, chunk.chunkHeight)] = blockId;
  return true;
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