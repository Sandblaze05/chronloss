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
const chunkMeshPool = [];

function acquireChunkMesh() {
  const mesh = chunkMeshPool.pop();
  if (mesh) {
    mesh.visible = true;
    return mesh;
  }

  return new THREE.Mesh(new THREE.BufferGeometry(), voxelMat);
}

function recycleChunkMesh(scene, mesh) {
  if (!mesh) return;
  if (scene) scene.remove(mesh);
  if (mesh.geometry) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
  }
  mesh.userData.chunk = undefined;
  mesh.visible = false;
  chunkMeshPool.push(mesh);
}

export function recycleChunkMeshes(scene, meshes) {
  if (!Array.isArray(meshes)) return;
  for (const mesh of meshes) recycleChunkMesh(scene, mesh);
}

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));
const AXIS_UV = [
  [1, 2],
  [0, 2],
  [0, 1],
];
const AXIS_PERMUTATION_SIGN = [1, -1, 1];

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
  const originX = chunk.cx * chunkSize;
  const originZ = chunk.cy * chunkSize;
  const dims = [chunkSize, chunkHeight, chunkSize];

  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];

  const emitVertex = (x, y, z, nx, ny, nz, uvx, uvy, cr, cg, cb) => {
    positions.push(originX + x, y, originZ + z);
    normals.push(nx, ny, nz);
    uvs.push(uvx, uvy);
    colors.push(cr, cg, cb);
  };

  const emitQuad = (axisD, axisU, axisV, sign, plane, uStart, vStart, width, height, cr, cg, cb) => {
    const nx = axisD === 0 ? sign : 0;
    const ny = axisD === 1 ? sign : 0;
    const nz = axisD === 2 ? sign : 0;

    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const c = [0, 0, 0];
    const d = [0, 0, 0];

    a[axisD] = plane;
    b[axisD] = plane;
    c[axisD] = plane;
    d[axisD] = plane;

    a[axisU] = uStart;
    a[axisV] = vStart;

    b[axisU] = uStart + width;
    b[axisV] = vStart;

    c[axisU] = uStart + width;
    c[axisV] = vStart + height;

    d[axisU] = uStart;
    d[axisV] = vStart + height;

    const forwardWinding = (sign * AXIS_PERMUTATION_SIGN[axisD]) > 0;
    if (forwardWinding) {
      emitVertex(a[0], a[1], a[2], nx, ny, nz, 0, 0, cr, cg, cb);
      emitVertex(b[0], b[1], b[2], nx, ny, nz, width, 0, cr, cg, cb);
      emitVertex(c[0], c[1], c[2], nx, ny, nz, width, height, cr, cg, cb);

      emitVertex(a[0], a[1], a[2], nx, ny, nz, 0, 0, cr, cg, cb);
      emitVertex(c[0], c[1], c[2], nx, ny, nz, width, height, cr, cg, cb);
      emitVertex(d[0], d[1], d[2], nx, ny, nz, 0, height, cr, cg, cb);
      return;
    }

    emitVertex(a[0], a[1], a[2], nx, ny, nz, 0, 0, cr, cg, cb);
    emitVertex(c[0], c[1], c[2], nx, ny, nz, width, height, cr, cg, cb);
    emitVertex(b[0], b[1], b[2], nx, ny, nz, width, 0, cr, cg, cb);

    emitVertex(a[0], a[1], a[2], nx, ny, nz, 0, 0, cr, cg, cb);
    emitVertex(d[0], d[1], d[2], nx, ny, nz, 0, height, cr, cg, cb);
    emitVertex(c[0], c[1], c[2], nx, ny, nz, width, height, cr, cg, cb);
  };

  const mask = [];

  for (let axisD = 0; axisD < 3; axisD++) {
    const axisU = AXIS_UV[axisD][0];
    const axisV = AXIS_UV[axisD][1];
    const maxD = dims[axisD];
    const maxU = dims[axisU];
    const maxV = dims[axisV];
    const maskSize = maxU * maxV;

    for (const sign of [-1, 1]) {
      for (let plane = 0; plane <= maxD; plane++) {
        mask.length = maskSize;

        for (let v = 0; v < maxV; v++) {
          for (let u = 0; u < maxU; u++) {
            const xCell = axisD === 0 ? (sign > 0 ? plane - 1 : plane) : (axisU === 0 ? u : v);
            const yCell = axisD === 1 ? (sign > 0 ? plane - 1 : plane) : (axisU === 1 ? u : v);
            const zCell = axisD === 2 ? (sign > 0 ? plane - 1 : plane) : (axisU === 2 ? u : v);

            if (!inChunkBounds(xCell, yCell, zCell, chunkSize, chunkHeight)) {
              mask[(v * maxU) + u] = null;
              continue;
            }

            const voxelWord = chunk.blocks[voxelIndex(xCell, yCell, zCell, chunkSize, chunkHeight)] >>> 0;
            const blockId = getBlockIdFromVoxel(voxelWord);
            if (blockId <= BLOCK_IDS.AIR) {
              mask[(v * maxU) + u] = null;
              continue;
            }

            const xNeighbor = xCell + (axisD === 0 ? sign : 0);
            const yNeighbor = yCell + (axisD === 1 ? sign : 0);
            const zNeighbor = zCell + (axisD === 2 ? sign : 0);
            const neighborSolid = inChunkBounds(xNeighbor, yNeighbor, zNeighbor, chunkSize, chunkHeight)
              ? (blockIdAt(chunk, xNeighbor, yNeighbor, zNeighbor, chunkSize, chunkHeight) > BLOCK_IDS.AIR)
              : false;

            if (neighborSolid) {
              mask[(v * maxU) + u] = null;
              continue;
            }

            const aboveSolid = blockIdAt(chunk, xCell, yCell + 1, zCell, chunkSize, chunkHeight) > BLOCK_IDS.AIR;
            const [cr, cg, cb] = colorForVoxel(blockId, voxelWord, aboveSolid);
            mask[(v * maxU) + u] = {
              key: `${voxelWord}|${aboveSolid ? 1 : 0}`,
              cr,
              cg,
              cb,
            };
          }
        }

        for (let v = 0; v < maxV; v++) {
          for (let u = 0; u < maxU; ) {
            const idx = (v * maxU) + u;
            const cell = mask[idx];
            if (!cell) {
              u += 1;
              continue;
            }

            let width = 1;
            while (u + width < maxU) {
              const next = mask[(v * maxU) + u + width];
              if (!next || next.key !== cell.key) break;
              width += 1;
            }

            let height = 1;
            let canGrow = true;
            while (v + height < maxV && canGrow) {
              for (let k = 0; k < width; k++) {
                const next = mask[((v + height) * maxU) + u + k];
                if (!next || next.key !== cell.key) {
                  canGrow = false;
                  break;
                }
              }
              if (canGrow) height += 1;
            }

            emitQuad(axisD, axisU, axisV, sign, plane, u, v, width, height, cell.cr, cell.cg, cell.cb);

            for (let dv = 0; dv < height; dv++) {
              for (let du = 0; du < width; du++) {
                mask[((v + dv) * maxU) + u + du] = null;
              }
            }

            u += width;
          }
        }

        if ((plane & 3) === 0) await yieldToMain();
      }
    }
  }

  if (positions.length === 0) {
    return { meshes: [], surfaceBlocks: [] };
  }

  const positionsArray = new Float32Array(positions);
  const normalsArray = new Float32Array(normals);
  const uvsArray = new Float32Array(uvs);
  const colorsArray = new Float32Array(colors);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positionsArray, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normalsArray, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvsArray, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3));

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

  const mesh = acquireChunkMesh();
  if (mesh.geometry) mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.material = voxelMat;
  mesh.userData.chunk = chunk;

  return { meshes: [mesh], surfaceBlocks: [] };
}

export function disposeChunkMeshes(scene, chunk) {
  if (chunk.instancedMeshes) {
    recycleChunkMeshes(scene, chunk.instancedMeshes);
    chunk.instancedMeshes = undefined;
  }
}
