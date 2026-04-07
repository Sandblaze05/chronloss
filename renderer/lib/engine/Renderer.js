import * as THREE from 'three';
import { BLOCK_IDS, CHUNK_HEIGHT, CHUNK_SIZE, inChunkBounds, voxelIndex } from './World.js';

const voxelMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  flatShading: true,
//   vertexColors: true,
});
const COLOR_STONE = new THREE.Color(0x808792);
const COLOR_DIRT = new THREE.Color(0x7f5c3b);
const COLOR_GRASS = new THREE.Color(0x4f8f3a);
const COLOR_SAND = new THREE.Color(0xd9c27a);
const COLOR_WATER = new THREE.Color(0x2f6fb3);
const COLOR_SNOW = new THREE.Color(0xf2f6ff);
const COLOR_DESERT = new THREE.Color(0xcfa86a);
const COLOR_FOREST = new THREE.Color(0x2f6a34);

function isSolid(blockId) {
  return blockId > BLOCK_IDS.AIR;
}

function hasExposedFace(chunk, x, y, z) {
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  for (const [dx, dy, dz] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (!inChunkBounds(nx, ny, nz, chunk.chunkSize, chunk.chunkHeight)) return true;
    const neighbor = chunk.blocks[voxelIndex(nx, ny, nz, chunk.chunkSize, chunk.chunkHeight)];
    if (!isSolid(neighbor)) return true;
  }

  return false;
}

function colorForBlock(chunk, x, y, z, blockId) {
  if (blockId === BLOCK_IDS.GRASS) return COLOR_GRASS;
  if (blockId === BLOCK_IDS.SAND) return COLOR_SAND;
  if (blockId === BLOCK_IDS.WATER) return COLOR_WATER;
  if (blockId === BLOCK_IDS.SNOW) return COLOR_SNOW;
  if (blockId === BLOCK_IDS.DESERT) return COLOR_DESERT;
  if (blockId === BLOCK_IDS.FOREST) return COLOR_FOREST;
  if (blockId === BLOCK_IDS.DIRT) {
    const aboveSolid = inChunkBounds(x, y + 1, z, chunk.chunkSize, chunk.chunkHeight)
      ? isSolid(chunk.blocks[voxelIndex(x, y + 1, z, chunk.chunkSize, chunk.chunkHeight)])
      : false;
    return aboveSolid ? COLOR_DIRT : COLOR_GRASS;
  }
  if (blockId === BLOCK_IDS.STONE) {
    return COLOR_STONE;
  }
  return COLOR_STONE;
}

export function buildChunkMeshes(scene, chunk, tileGeom, _xOffset, _yOffset) {
  const chunkSize = chunk.chunkSize || CHUNK_SIZE;
  const chunkHeight = chunk.chunkHeight || CHUNK_HEIGHT;

  let visibleCount = 0;
  for (let z = 0; z < chunkSize; z++) {
    for (let y = 0; y < chunkHeight; y++) {
      for (let x = 0; x < chunkSize; x++) {
        const index = voxelIndex(x, y, z, chunkSize, chunkHeight);
        const blockId = chunk.blocks[index];
        if (!isSolid(blockId)) continue;
        if (hasExposedFace(chunk, x, y, z)) visibleCount++;
      }
    }
  }

  const instancedMeshes = [];
  if (visibleCount === 0) {
    chunk.instancedMeshes = instancedMeshes;
    chunk.surfaceBlocks = [];
    return;
  }

  const instanced = new THREE.InstancedMesh(tileGeom, voxelMat, visibleCount);
  instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const matrix = new THREE.Matrix4();
  const blockPositions = new Array(visibleCount);
  let i = 0;

  for (let z = 0; z < chunkSize; z++) {
    for (let y = 0; y < chunkHeight; y++) {
      for (let x = 0; x < chunkSize; x++) {
        const index = voxelIndex(x, y, z, chunkSize, chunkHeight);
        const blockId = chunk.blocks[index];
        if (!isSolid(blockId)) continue;
        if (!hasExposedFace(chunk, x, y, z)) continue;

        const wx = chunk.cx * chunkSize + x;
        const wz = chunk.cy * chunkSize + z;

        matrix.identity();
        matrix.setPosition(wx, y, wz);
        instanced.setMatrixAt(i, matrix);
        instanced.setColorAt(i, colorForBlock(chunk, x, y, z, blockId));

        blockPositions[i] = { x, y, z, wx, wz };
        i++;
      }
    }
  }

  instanced.instanceMatrix.needsUpdate = true;
  if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  instanced.userData.chunk = chunk;
  instanced.userData.blockPositions = blockPositions;

  scene.add(instanced);
  instancedMeshes.push(instanced);

  chunk.instancedMeshes = instancedMeshes;
  chunk.surfaceBlocks = blockPositions;
}

export function disposeChunkMeshes(scene, chunk) {
  if (chunk.instancedMeshes) {
    for (const m of chunk.instancedMeshes) {
      if (!m) continue;
      scene.remove(m);
    }
    chunk.instancedMeshes = undefined;
  }
}
