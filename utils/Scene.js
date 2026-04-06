
const TILE_SIZE = 2;

export function gridToWorld(col, row, tileSize=TILE_SIZE) {
    return {
        x: col * tileSize,
        z: row * tileSize,
    }
}