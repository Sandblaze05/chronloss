export const tileSize = 2;

export function gridToWorld(col, row, tileW = tileSize, tileH = tileSize) {
  const x = (col - row) * (tileW / 2);
  const z = (col + row) * (tileH / 2);
  return { x, z };
}

// worldToGrid returns local (centered) grid coords (floats)
export function worldToGrid(world) {
  const s = tileSize / 2;
  const colLocal = (world.x / s + world.z / s) / 2;
  const rowLocal = (world.z / s - world.x / s) / 2;
  return { c: colLocal, r: rowLocal };
}