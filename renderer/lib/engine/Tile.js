export function createTile(col, row, type = 'floor', walkable = true, height = 0) {
  return {
    col,
    row,
    type,
    walkable,
    height,
    mesh: undefined,
  };
}