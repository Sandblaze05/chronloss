export const tileSize = 1;

// Orthogonal grid: each tile is a 1x1 block in world-space.
export function gridToWorld(col, row, tileW = tileSize, tileH = tileSize) {
  const x = col * tileW;
  const z = row * tileH;
  return { x, z };
}

// worldToGrid returns local grid coords (floats)
export function worldToGrid(world) {
  const s = tileSize;
  const colLocal = world.x / s;
  const rowLocal = world.z / s;
  return { c: colLocal, r: rowLocal };
}