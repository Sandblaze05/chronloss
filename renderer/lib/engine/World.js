import { createTile } from './Tile.js';
import { generateHeightAt } from './Noise.js';

export const CHUNK_SIZE = 16;

export const DEFAULT_WORLD_OPTIONS = {
  seed: 0,
  scale: 40,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2,
  minHeight: 0,
  maxHeight: 20,
  blockHeight: 1, // dont change
};

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