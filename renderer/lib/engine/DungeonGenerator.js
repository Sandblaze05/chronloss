// simple dungeon generator placeholder
// marks border tiles as walls

export function generateDungeon(world, width, height, seed = 0) {
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const key = `${c},${r}`;
      const tile = world.get(key);
      if (!tile) continue;
      if (r === 0 || c === 0 || r === height - 1 || c === width - 1) {
        tile.type = 'wall';
        tile.walkable = false;
      }
    }
  }
  return world;
}