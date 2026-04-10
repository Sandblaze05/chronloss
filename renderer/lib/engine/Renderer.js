import * as THREE from 'three';
import {
  BLOCK_IDS,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  getBlockIdFromVoxel,
  getBlockLightFromVoxel,
  getSkyLightFromVoxel,
  inChunkBounds,
  voxelIndex,
} from './World.js';

const voxelMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  flatShading: true,
  vertexColors: true,
});
const FACE_DEFS = [
  {
    normal: [1, 0, 0],
    neighbor: [1, 0, 0],
    corners: [
      [1, 0, 0], [1, 1, 0], [1, 1, 1],
      [1, 0, 0], [1, 1, 1], [1, 0, 1],
    ],
    uvs: [
      [0, 0], [0, 1], [1, 1],
      [0, 0], [1, 1], [1, 0],
    ],
  },
  {
    normal: [-1, 0, 0],
    neighbor: [-1, 0, 0],
    corners: [
      [0, 0, 1], [0, 1, 1], [0, 1, 0],
      [0, 0, 1], [0, 1, 0], [0, 0, 0],
    ],
    uvs: [
      [0, 0], [0, 1], [1, 1],
      [0, 0], [1, 1], [1, 0],
    ],
  },
  {
    normal: [0, 1, 0],
    neighbor: [0, 1, 0],
    corners: [
      [0, 1, 1], [1, 1, 1], [1, 1, 0],
      [0, 1, 1], [1, 1, 0], [0, 1, 0],
    ],
    uvs: [
      [0, 0], [1, 0], [1, 1],
      [0, 0], [1, 1], [0, 1],
    ],
  },
  {
    normal: [0, -1, 0],
    neighbor: [0, -1, 0],
    corners: [
      [0, 0, 0], [1, 0, 0], [1, 0, 1],
      [0, 0, 0], [1, 0, 1], [0, 0, 1],
    ],
    uvs: [
      [0, 0], [1, 0], [1, 1],
      [0, 0], [1, 1], [0, 1],
    ],
  },
  {
    normal: [0, 0, 1],
    neighbor: [0, 0, 1],
    corners: [
      [1, 0, 1], [1, 1, 1], [0, 1, 1],
      [1, 0, 1], [0, 1, 1], [0, 0, 1],
    ],
    uvs: [
      [0, 0], [0, 1], [1, 1],
      [0, 0], [1, 1], [1, 0],
    ],
  },
  {
    normal: [0, 0, -1],
    neighbor: [0, 0, -1],
    corners: [
      [0, 0, 0], [0, 1, 0], [1, 1, 0],
      [0, 0, 0], [1, 1, 0], [1, 0, 0],
    ],
    uvs: [
      [0, 0], [0, 1], [1, 1],
      [0, 0], [1, 1], [1, 0],
    ],
  },
];

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

function blockIdAt(chunk, x, y, z, chunkSize, chunkHeight) {
  if (!inChunkBounds(x, y, z, chunkSize, chunkHeight)) return BLOCK_IDS.AIR;
  return getBlockIdFromVoxel(chunk.blocks[voxelIndex(x, y, z, chunkSize, chunkHeight)] >>> 0);
}

function colorForVoxel(blockId, voxelWord, aboveSolid) {
  let r = 0.50;
  let g = 0.53;
  let b = 0.57;

  if (blockId === BLOCK_IDS.GRASS) {
    r = 0.31; g = 0.56; b = 0.23;
  } else if (blockId === BLOCK_IDS.SAND) {
    r = 0.85; g = 0.76; b = 0.48;
  } else if (blockId === BLOCK_IDS.WATER) {
    r = 0.18; g = 0.44; b = 0.70;
  } else if (blockId === BLOCK_IDS.SNOW) {
    r = 0.95; g = 0.96; b = 1.00;
  } else if (blockId === BLOCK_IDS.DESERT) {
    r = 0.81; g = 0.66; b = 0.42;
  } else if (blockId === BLOCK_IDS.FOREST) {
    r = 0.18; g = 0.42; b = 0.20;
  } else if (blockId === BLOCK_IDS.DIRT) {
    if (aboveSolid) {
      r = 0.50; g = 0.36; b = 0.23;
    } else {
      r = 0.31; g = 0.56; b = 0.23;
    }
  }

  const sky = getSkyLightFromVoxel(voxelWord);
  const block = getBlockLightFromVoxel(voxelWord);
  const light = Math.min(1.0, Math.max(0.18, (sky / 15) * 0.8 + (block / 15) * 0.6));
  return [r * light, g * light, b * light];
}

export async function buildChunkMeshes(_scene, chunk, _tileGeom, _xOffset, _yOffset) {
  const chunkSize = chunk.chunkSize || CHUNK_SIZE;
  const chunkHeight = chunk.chunkHeight || CHUNK_HEIGHT;

  let faceCount = 0;
  for (let y = 0; y < chunkHeight; y++) {
    for (let z = 0; z < chunkSize; z++) {
      for (let x = 0; x < chunkSize; x++) {
        const voxelWord = chunk.blocks[voxelIndex(x, y, z, chunkSize, chunkHeight)] >>> 0;
        const blockId = getBlockIdFromVoxel(voxelWord);
        if (blockId <= BLOCK_IDS.AIR) continue;

        for (const faceDef of FACE_DEFS) {
          const nx = x + faceDef.neighbor[0];
          const ny = y + faceDef.neighbor[1];
          const nz = z + faceDef.neighbor[2];
          const neighborSolid = inChunkBounds(nx, ny, nz, chunkSize, chunkHeight)
            ? blockIdAt(chunk, nx, ny, nz, chunkSize, chunkHeight) > BLOCK_IDS.AIR
            : false;
          if (!neighborSolid) faceCount += 1;
        }
      }
    }

    if ((y & 3) === 0) await yieldToMain();
  }

  if (faceCount === 0) {
    return { meshes: [], surfaceBlocks: [] };
  }

  const positions = new Float32Array(faceCount * 6 * 3);
  const normals = new Float32Array(faceCount * 6 * 3);
  const uvs = new Float32Array(faceCount * 6 * 2);
  const colors = new Float32Array(faceCount * 6 * 3);

  let p = 0;
  let n = 0;
  let u = 0;
  let c = 0;

  for (let y = 0; y < chunkHeight; y++) {
    for (let z = 0; z < chunkSize; z++) {
      for (let x = 0; x < chunkSize; x++) {
        const voxelWord = chunk.blocks[voxelIndex(x, y, z, chunkSize, chunkHeight)] >>> 0;
        const blockId = getBlockIdFromVoxel(voxelWord);
        if (blockId <= BLOCK_IDS.AIR) continue;

        const aboveSolid = blockIdAt(chunk, x, y + 1, z, chunkSize, chunkHeight) > BLOCK_IDS.AIR;
        const [cr, cg, cb] = colorForVoxel(blockId, voxelWord, aboveSolid);

        const wx = chunk.cx * chunkSize + x;
        const wz = chunk.cy * chunkSize + z;

        for (const faceDef of FACE_DEFS) {
          const nx = x + faceDef.neighbor[0];
          const ny = y + faceDef.neighbor[1];
          const nz = z + faceDef.neighbor[2];
          const neighborSolid = inChunkBounds(nx, ny, nz, chunkSize, chunkHeight)
            ? blockIdAt(chunk, nx, ny, nz, chunkSize, chunkHeight) > BLOCK_IDS.AIR
            : false;
          if (neighborSolid) continue;

          for (let i = 0; i < 6; i++) {
            const corner = faceDef.corners[i];
            positions[p++] = wx + corner[0];
            positions[p++] = y + corner[1];
            positions[p++] = wz + corner[2];

            normals[n++] = faceDef.normal[0];
            normals[n++] = faceDef.normal[1];
            normals[n++] = faceDef.normal[2];

            const uv = faceDef.uvs[i];
            uvs[u++] = uv[0];
            uvs[u++] = uv[1];

            colors[c++] = cr;
            colors[c++] = cg;
            colors[c++] = cb;
          }
        }
      }
    }

    if ((y & 3) === 0) await yieldToMain();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const halfSize = chunkSize * 0.5;
  const halfHeight = chunkHeight * 0.5;
  const radius = Math.sqrt((halfSize * halfSize * 2) + (halfHeight * halfHeight));
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(
      (chunk.cx * chunkSize) + halfSize,
      halfHeight,
      (chunk.cy * chunkSize) + halfSize
    ),
    radius
  );
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(chunk.cx * chunkSize, 0, chunk.cy * chunkSize),
    new THREE.Vector3((chunk.cx + 1) * chunkSize, chunkHeight, (chunk.cy + 1) * chunkSize)
  );

  const mesh = new THREE.Mesh(geometry, voxelMat);
  mesh.userData.chunk = chunk;

  return { meshes: [mesh], surfaceBlocks: [] };
}

export function disposeChunkMeshes(scene, chunk) {
  if (chunk.instancedMeshes) {
    for (const m of chunk.instancedMeshes) {
      if (!m) continue;
      scene.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    chunk.instancedMeshes = undefined;
  }
}
