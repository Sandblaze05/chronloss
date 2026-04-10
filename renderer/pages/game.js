import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { BLOCK_IDS, CHUNK_HEIGHT, CHUNK_SIZE, chunkKey, DEFAULT_WORLD_OPTIONS, getVoxel, setVoxel } from '../lib/engine/World.js';
import { buildChunkMeshes, disposeChunkMeshes } from '../lib/engine/Renderer.js';
import { gridToWorld, worldToGrid as worldToGridLocal, tileSize } from '../lib/engine/GridMath.js';
import { generateChunkData, sampleTerrainDebug } from '../lib/engine/ChunkGeneration.js';
import { generateBiomeAt } from '../lib/engine/Noise.js';
import { collidesAabb, moveAlongAxis, moveWithStepUp, resolvePenetrationUp } from '../lib/engine/PlayerPhysics.js';

const idToBlock = (id) => {
  switch (id) {
    case 0:
      return 'AIR'
    case 1:
      return 'STONE'
    case 2:
      return 'DIRT'
    case 3:
      return 'GRASS'
    case 4:
      return 'SAND'
    case 5:
      return 'WATER'
    case 6:
      return 'SNOW'
    case 7:
      return 'DESERT'
    case 8:
      return 'FOREST'
    default:
      break;
  }
  return -1;
}

function createChunkRequestBuffer(batch, chunkSize) {
  const buffer = new ArrayBuffer(8 + (batch.length * 8));
  const view = new DataView(buffer);
  view.setUint32(0, batch.length, true);
  view.setUint32(4, chunkSize, true);

  let offset = 8;
  for (const item of batch) {
    view.setInt32(offset, Number(item.cx) || 0, true);
    view.setInt32(offset + 4, Number(item.cy) || 0, true);
    offset += 8;
  }

  return new Uint8Array(buffer);
}

function parseChunkResponseBuffer(payload) {
  if (!payload) return [];

  const bytes = payload instanceof Uint8Array
    ? payload
    : (payload instanceof ArrayBuffer ? new Uint8Array(payload) : null);
  if (!bytes) return [];
  if (bytes.byteLength < 8) return [];

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkCount = view.getUint32(4, true);
  const out = [];
  let offset = 8;

  for (let i = 0; i < chunkCount; i += 1) {
    if (offset + 20 > bytes.byteLength) break;
    const cx = view.getInt32(offset, true);
    offset += 4;
    const cy = view.getInt32(offset, true);
    offset += 4;
    const chunkSize = view.getUint32(offset, true);
    offset += 4;
    const chunkHeight = view.getUint32(offset, true);
    offset += 4;
    const blockCount = view.getUint32(offset, true);
    offset += 4;

    const blockBytes = blockCount * 4;
    if (offset + blockBytes > bytes.byteLength) break;

    const sourceBlocks = new Uint32Array(bytes.buffer, bytes.byteOffset + offset, blockCount);
    const blocks = new Uint32Array(blockCount);
    blocks.set(sourceBlocks);
    offset += blockBytes;

    out.push({
      cx,
      cy,
      chunkSize,
      chunkHeight,
      formatVersion: 2,
      blocks,
    });
  }

  return out;
}

function createEcsInitRequestBuffer(position) {
  const buffer = new ArrayBuffer(24);
  const view = new DataView(buffer);
  view.setFloat64(0, Number(position?.x) || 0, true);
  view.setFloat64(8, Number(position?.y) || 1, true);
  view.setFloat64(16, Number(position?.z) || 0, true);
  return new Uint8Array(buffer);
}

function parseEcsInitResponse(payload) {
  if (!payload) return null;

  if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (bytes.byteLength < 28) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      index: view.getInt32(0, true),
      position: {
        x: view.getFloat64(4, true),
        y: view.getFloat64(12, true),
        z: view.getFloat64(20, true),
      },
    };
  }

  return payload;
}

function createEcsVelocityBuffer(vx, vy, vz) {
  const buffer = new ArrayBuffer(12);
  const view = new DataView(buffer);
  view.setFloat32(0, Number(vx) || 0, true);
  view.setFloat32(4, Number(vy) || 0, true);
  view.setFloat32(8, Number(vz) || 0, true);
  return new Uint8Array(buffer);
}

const GamePage = () => {

  const ref = useRef(null);

  useEffect(() => {

    const container = ref.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    console.log(window.innerWidth, window.innerHeight)
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const debugPanel = document.createElement('div');
    debugPanel.style.position = 'absolute';
    debugPanel.style.left = '12px';
    debugPanel.style.top = '12px';
    debugPanel.style.padding = '10px 12px';
    debugPanel.style.borderRadius = '8px';
    debugPanel.style.background = 'rgba(10, 16, 24, 0.82)';
    debugPanel.style.color = '#d7e3f4';
    debugPanel.style.font = '12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    debugPanel.style.whiteSpace = 'pre';
    debugPanel.style.zIndex = '20';
    debugPanel.style.pointerEvents = 'none';
    debugPanel.textContent = 'debug hud: initializing...';
    container.appendChild(debugPanel);

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1200);
    camera.position.set(12, 10, 12);
    camera.lookAt(0, 0, 0);
    const orbitState = {
      yaw: Math.PI * 0.25,
      pitch: 0.42,
      distance: 14,
      targetDistance: 14,
      dragging: false,
      lastPointerX: 0,
      lastPointerY: 0,
    };
    let mouseAccumX = 0;
    let mouseAccumY = 0;
    const MOUSE_SENS = 0.0025;
    const ZOOM_SENS = 0.012;
    const MIN_DISTANCE = 6;
    const MAX_DISTANCE = 34;
    const cameraTarget = new THREE.Vector3(0, 0, 0);

    // lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(10, 30, 20);
    scene.add(dir);

    // floor (backdrop)
    const floorGeom = new THREE.PlaneGeometry(80, 80);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    scene.add(floor);

    const highlightGeom = new THREE.BoxGeometry(tileSize + 0.02, 1.02, tileSize + 0.02);
    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0xddffff,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
    });
    const highlightMesh = new THREE.Mesh(highlightGeom, highlightMat);
    highlightMesh.visible = false;
    scene.add(highlightMesh);

    // --- Chunked tile grid ---
    const tileGeom = new THREE.BoxGeometry(tileSize, 1, tileSize);
    tileGeom.translate(0, 0.5, 0);
    // no global offset for streaming/infinite world
    const xOffset = 0;
    const yOffset = 0;

    // chunk storage and active set
    const chunks = new Map(); // key -> chunk
    const activeChunks = new Set();
    const chunkMeshes = []; // active chunk-level meshes for raycasting
    let hoveredInfo = null;
    let hoveredBiomeInfo = null;
    const chunkRadius = 3; // load radius in chunks (increase for larger view)
    const loadQueue = [];
    const loadQueueSet = new Set();
    const generatedChunkQueue = [];
    const unloadQueueSet = new Set();
    const pendingChunkKeys = new Set();
    const desiredChunkCenter = { cx: 0, cy: 0 };
    const ipc = typeof window !== 'undefined' ? window.ipc : null;

    const chunkIpcEnabled = !!(ipc && typeof ipc.invoke === 'function');
    const CHUNK_IPC_BATCH_SIZE = 2;
    const CHUNK_IPC_MAX_IN_FLIGHT = 1;
    let chunkIpcInFlight = 0;
    const CHUNK_APPLY_BUDGET_MS = 2.5;
    let lastChunkApplyCount = 0;
    let lastChunkApplyTimeMs = 0;
    let smoothedFps = 0;
    let lastDebugRefresh = 0;
    let isMeshing = false;
    const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

    function buildChunkFromBlocks(cx, cy, chunkSize, chunkHeight, blocks, formatVersion = 1) {
      return {
        cx,
        cy,
        chunkSize,
        chunkHeight,
        formatVersion,
        blocks,
      };
    }

    function requestIpcChunkBatch(batch) {
      if (!batch.length) return;

      chunkIpcInFlight += 1;
      const payload = createChunkRequestBuffer(batch, CHUNK_SIZE);

      ipc.invoke('world:generateChunks', payload)
        .then((results) => {
          const list = Array.isArray(results)
            ? results
            : parseChunkResponseBuffer(results);
          for (const item of list) {
            const key = chunkKey(item.cx, item.cy);
            pendingChunkKeys.delete(key);
            if (!loadQueueSet.has(key) && !activeChunks.has(key)) continue;
            generatedChunkQueue.push({
              cx: item.cx,
              cy: item.cy,
              chunkSize: item.chunkSize || CHUNK_SIZE,
              chunkHeight: item.chunkHeight || CHUNK_HEIGHT,
              formatVersion: item.formatVersion || 1,
              blocks: item.blocks instanceof Uint32Array
                ? item.blocks
                : new Uint32Array(item.blocks),
            });
          }
        })
        .catch((error) => {
          console.warn('Chunk IPC failed, falling back to sync generation for batch:', error);
          for (const item of batch) {
            const key = chunkKey(item.cx, item.cy);
            pendingChunkKeys.delete(key);
            if (!loadQueueSet.has(key) && !activeChunks.has(key)) continue;
            const data = generateChunkData(item.cx, item.cy, CHUNK_SIZE, CHUNK_HEIGHT, DEFAULT_WORLD_OPTIONS);
            generatedChunkQueue.push({
              cx: item.cx,
              cy: item.cy,
              chunkSize: CHUNK_SIZE,
              chunkHeight: data.chunkHeight,
              formatVersion: 2,
              blocks: data.blocks,
            });
          }
        })
        .finally(() => {
          chunkIpcInFlight = Math.max(0, chunkIpcInFlight - 1);
          pumpChunkIpcJobs();
        });
    }

    function chunkDistanceSq(cx, cy, targetCx, targetCy) {
      const dx = cx - targetCx;
      const dy = cy - targetCy;
      return dx * dx + dy * dy;
    }

    function sortLoadQueueByPriority() {
      loadQueue.sort((a, b) => {
        const da = chunkDistanceSq(a[0], a[1], desiredChunkCenter.cx, desiredChunkCenter.cy);
        const db = chunkDistanceSq(b[0], b[1], desiredChunkCenter.cx, desiredChunkCenter.cy);
        return da - db;
      });
    }

    function pumpChunkIpcJobs() {
      if (!chunkIpcEnabled) {
        if (loadQueue.length > 1) sortLoadQueueByPriority();
        let generatedNow = 0;
        const MAX_SYNC_CHUNKS_PER_PUMP = 2;

        while (loadQueue.length && generatedNow < MAX_SYNC_CHUNKS_PER_PUMP) {
          const [cx, cy] = loadQueue.shift();
          const key = chunkKey(cx, cy);

          if (activeChunks.has(key) || pendingChunkKeys.has(key)) {
            continue;
          }

          pendingChunkKeys.add(key);
          const data = generateChunkData(cx, cy, CHUNK_SIZE, CHUNK_HEIGHT, DEFAULT_WORLD_OPTIONS);
          pendingChunkKeys.delete(key);

          if (!loadQueueSet.has(key) && !activeChunks.has(key)) {
            continue;
          }

          generatedChunkQueue.push({
            cx,
            cy,
            chunkSize: CHUNK_SIZE,
            chunkHeight: data.chunkHeight,
            formatVersion: 2,
            blocks: data.blocks,
          });
          generatedNow += 1;
        }
        return;
      }

      if (loadQueue.length > 1) sortLoadQueueByPriority();
      while (chunkIpcInFlight < CHUNK_IPC_MAX_IN_FLIGHT && loadQueue.length) {
        const batch = [];
        while (loadQueue.length && batch.length < CHUNK_IPC_BATCH_SIZE) {
          const next = loadQueue.shift();
          const cx = next[0];
          const cy = next[1];
          const key = chunkKey(cx, cy);
          if (activeChunks.has(key) || pendingChunkKeys.has(key)) continue;
          pendingChunkKeys.add(key);
          batch.push({ cx, cy });
        }
        if (!batch.length) break;
        requestIpcChunkBatch(batch);
      }
    }

    async function applyGeneratedChunk(generated) {
      const key = chunkKey(generated.cx, generated.cy);
      if (chunks.has(key)) return;

      const chunk = buildChunkFromBlocks(
        generated.cx,
        generated.cy,
        generated.chunkSize,
        generated.chunkHeight,
        generated.blocks,
        generated.formatVersion || 1
      );
      chunks.set(key, chunk);
      isMeshing = true;

      try {
        const result = await buildChunkMeshes(scene, chunk, tileGeom, xOffset, yOffset);

        if (!chunks.has(key)) {
          if (result?.meshes) {
            for (const m of result.meshes) {
              if (!m) continue;
              if (m.geometry) m.geometry.dispose();
            }
          }
          return;
        }

        const meshes = result?.meshes || [];
        chunk.instancedMeshes = meshes;
        chunk.surfaceBlocks = result?.surfaceBlocks || [];

        // Give input/paint one tick before triggering GPU buffer uploads via scene.add.
        await yieldToMain();

        if (!chunks.has(key)) {
          for (const m of meshes) {
            if (!m) continue;
            if (m.geometry) m.geometry.dispose();
          }
          return;
        }

        for (const m of meshes) {
          if (!m) continue;
          scene.add(m);
          chunkMeshes.push(m);
        }

        activeChunks.add(key);
        loadQueueSet.delete(key);
      } finally {
        isMeshing = false;
      }
    }

    function applyGeneratedChunksWithBudget() {
      const started = performance.now();
      if (isMeshing || generatedChunkQueue.length === 0) {
        lastChunkApplyCount = 0;
        lastChunkApplyTimeMs = performance.now() - started;
        return;
      }

      if (generatedChunkQueue.length > 1) {
        generatedChunkQueue.sort((a, b) => {
          const da = chunkDistanceSq(a.cx, a.cy, desiredChunkCenter.cx, desiredChunkCenter.cy);
          const db = chunkDistanceSq(b.cx, b.cy, desiredChunkCenter.cx, desiredChunkCenter.cy);
          return da - db;
        });
      }

      const generated = generatedChunkQueue.shift();
      const key = chunkKey(generated.cx, generated.cy);
      if (!loadQueueSet.has(key) && !activeChunks.has(key)) {
        lastChunkApplyCount = 0;
        lastChunkApplyTimeMs = performance.now() - started;
        return;
      }

      applyGeneratedChunk(generated);

      lastChunkApplyCount = 1;
      lastChunkApplyTimeMs = performance.now() - started;
    }

    function unloadChunk(cx, cy) {
      const key = chunkKey(cx, cy);
      if (!chunks.has(key)) return;
      const chunk = chunks.get(key);

      if (chunk.instancedMeshes) {
        for (const m of chunk.instancedMeshes) {
          const idx = chunkMeshes.indexOf(m);
          if (idx !== -1) chunkMeshes.splice(idx, 1);
        }
      }
      disposeChunkMeshes(scene, chunk);
      chunks.delete(key);
      activeChunks.delete(key);
      loadQueueSet.delete(key);
      unloadQueueSet.delete(key);
    }

    function ensureChunksAround(cx, cy) {
      const want = new Set();
      desiredChunkCenter.cx = cx;
      desiredChunkCenter.cy = cy;
      for (let oy = -chunkRadius; oy <= chunkRadius; oy++) {
        for (let ox = -chunkRadius; ox <= chunkRadius; ox++) {
          want.add(chunkKey(cx + ox, cy + oy));
        }
      }

      for (let i = loadQueue.length - 1; i >= 0; i--) {
        const [qx, qy] = loadQueue[i];
        const key = chunkKey(qx, qy);
        if (!want.has(key)) {
          loadQueue.splice(i, 1);
          if (!pendingChunkKeys.has(key)) loadQueueSet.delete(key);
        }
      }

      for (let i = generatedChunkQueue.length - 1; i >= 0; i--) {
        const generated = generatedChunkQueue[i];
        const key = chunkKey(generated.cx, generated.cy);
        if (!want.has(key) && !activeChunks.has(key)) {
          generatedChunkQueue.splice(i, 1);
          if (!pendingChunkKeys.has(key)) loadQueueSet.delete(key);
        }
      }

      // queue new chunks to avoid frame spikes
      for (const k of want) {
        if (!activeChunks.has(k) && !loadQueueSet.has(k)) {
          const [scx, scy] = k.split(',').map(Number);
          loadQueue.push([scx, scy]);
          loadQueueSet.add(k);
        }
      }

      pumpChunkIpcJobs();
      // unload distant
      for (const k of Array.from(activeChunks)) {
        if (!want.has(k) && !unloadQueueSet.has(k)) {
          unloadQueueSet.add(k);
        }
      }
    }

    // initial player start at 0,0

    // player placeholder
    const PLAYER_WIDTH = 0.78;
    const PLAYER_HEIGHT = 1.78;
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH),
      new THREE.MeshStandardMaterial({ color: 0x00ffcc })
    );
    const PLAYER_HALF_WIDTH = PLAYER_WIDTH * 0.5;
    const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT * 0.5;
    const FOOT_CLEARANCE = 0.04;
    cube.position.y = PLAYER_HALF_HEIGHT + FOOT_CLEARANCE;
    scene.add(cube);

    // raycaster for hover / selection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(-2, -2);
    let pointerMoved = false;
    let lastHoverRaycastTime = 0;
    const HOVER_RAYCAST_INTERVAL_MS = 45;
    const HOVER_RAYCAST_MAX_DISTANCE = 96;
    raycaster.far = HOVER_RAYCAST_MAX_DISTANCE;
    const INF = Number.POSITIVE_INFINITY;
    let lastHoverPickTimeMs = 0;
    let avgHoverPickTimeMs = 0;

    async function rebuildChunkMesh(chunk) {
      if (!chunk) return;

      const rebuildToken = (chunk.rebuildToken || 0) + 1;
      chunk.rebuildToken = rebuildToken;
      const oldMeshes = Array.isArray(chunk.instancedMeshes) ? chunk.instancedMeshes.filter(Boolean) : [];

      const result = await buildChunkMeshes(scene, chunk, tileGeom, xOffset, yOffset);

      // If a newer rebuild started, discard this stale result.
      if (!chunk || chunk.rebuildToken !== rebuildToken) {
        const staleMeshes = result?.meshes || [];
        for (const m of staleMeshes) {
          if (!m) continue;
          if (m.geometry) m.geometry.dispose();
        }
        return;
      }

      const nextMeshes = result?.meshes || [];
      chunk.instancedMeshes = nextMeshes;
      chunk.surfaceBlocks = result?.surfaceBlocks || [];

      // Add new mesh first, then remove old mesh to avoid a visible hole.
      for (const m of nextMeshes) {
        if (!m) continue;
        scene.add(m);
        chunkMeshes.push(m);
      }

      for (const m of oldMeshes) {
        const idx = chunkMeshes.indexOf(m);
        if (idx !== -1) chunkMeshes.splice(idx, 1);
        scene.remove(m);
        if (m.geometry) m.geometry.dispose();
      }
    }

    function getRaycastHit() {
      raycaster.setFromCamera(pointer, camera);
      const origin = raycaster.ray.origin;
      const dir = raycaster.ray.direction;

      const originX = origin.x + (dir.x * 1e-4);
      const originY = origin.y + (dir.y * 1e-4);
      const originZ = origin.z + (dir.z * 1e-4);

      let x = Math.floor(originX);
      let y = Math.floor(originY);
      let z = Math.floor(originZ);

      const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
      const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
      const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

      const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : INF;
      const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : INF;
      const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : INF;

      const nextBoundaryX = stepX > 0 ? x + 1 : x;
      const nextBoundaryY = stepY > 0 ? y + 1 : y;
      const nextBoundaryZ = stepZ > 0 ? z + 1 : z;

      let tMaxX = stepX !== 0 ? (nextBoundaryX - originX) / dir.x : INF;
      let tMaxY = stepY !== 0 ? (nextBoundaryY - originY) / dir.y : INF;
      let tMaxZ = stepZ !== 0 ? (nextBoundaryZ - originZ) / dir.z : INF;

      if (tMaxX < 0) tMaxX = 0;
      if (tMaxY < 0) tMaxY = 0;
      if (tMaxZ < 0) tMaxZ = 0;

      let t = 0;
      const hitNormal = new THREE.Vector3(0, 1, 0);
      const maxSteps = 384;

      for (let step = 0; step < maxSteps && t <= HOVER_RAYCAST_MAX_DISTANCE; step++) {
        if (y < 0) break;

        const blockId = getVoxelAtWorld(x, y, z);
        if (blockId > BLOCK_IDS.AIR) {
          const chunk = getChunkByWorldVoxel(x, z);
          if (!chunk || y >= chunk.chunkHeight) return null;
          const local = worldToLocalVoxel(x, z);
          return {
            chunk,
            block: { x: local.lx, y, z: local.lz, wx: x, wz: z },
            normal: hitNormal.clone(),
          };
        }

        if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
          x += stepX;
          t = tMaxX;
          tMaxX += tDeltaX;
          hitNormal.set(-stepX, 0, 0);
          continue;
        }

        if (tMaxY <= tMaxX && tMaxY <= tMaxZ) {
          y += stepY;
          t = tMaxY;
          tMaxY += tDeltaY;
          hitNormal.set(0, -stepY, 0);
          continue;
        }

        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        hitNormal.set(0, 0, -stepZ);
      }

      return null;
    }

    function updatePointerFromEvent(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    const onPointerMove = (event) => {
      if (orbitState.dragging) {
        const dx = event.clientX - orbitState.lastPointerX;
        const dy = event.clientY - orbitState.lastPointerY;
        orbitState.lastPointerX = event.clientX;
        orbitState.lastPointerY = event.clientY;
        mouseAccumX += dx;
        mouseAccumY += dy;
      }

      updatePointerFromEvent(event);
      pointerMoved = !orbitState.dragging;
    };

    const onPointerDown = (event) => {
      if (event.button === 1) {
        orbitState.dragging = true;
        orbitState.lastPointerX = event.clientX;
        orbitState.lastPointerY = event.clientY;
        event.preventDefault();
        return;
      }

      updatePointerFromEvent(event);
      const hit = getRaycastHit();
      if (!hit) return;

      if (event.button === 0) {
        setVoxel(hit.chunk, hit.block.x, hit.block.y, hit.block.z, BLOCK_IDS.AIR);
        rebuildChunksNearWorldVoxel(hit.block.wx, hit.block.wz);
      } else if (event.button === 2) {
        const pwx = hit.block.wx + hit.normal.x;
        const py = hit.block.y + hit.normal.y;
        const pwz = hit.block.wz + hit.normal.z;
        const targetChunk = getChunkByWorldVoxel(pwx, pwz);
        if (!targetChunk) return;
        const local = worldToLocalVoxel(pwx, pwz);
        if (setVoxel(targetChunk, local.lx, py, local.lz, BLOCK_IDS.STONE)) {
          rebuildChunksNearWorldVoxel(pwx, pwz);
        }
      }
    };

    const onPointerUp = (event) => {
      if (event.button === 1) {
        orbitState.dragging = false;
      }
    };

    const onWheel = (event) => {
      orbitState.targetDistance = THREE.MathUtils.clamp(
        orbitState.targetDistance + event.deltaY * ZOOM_SENS,
        MIN_DISTANCE,
        MAX_DISTANCE
      );
      event.preventDefault();
    };

    const onContextMenu = (event) => event.preventDefault();

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    // keyboard handlers for WASD movement
    const onKeyDown = (e) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') keys.w = true;
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') keys.s = true;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') keys.a = true;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') keys.d = true;
    };
    const onKeyUp = (e) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') keys.w = false;
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') keys.s = false;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') keys.a = false;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') keys.d = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // movement state
    // keep authoritative position in world-space and derive grid from it
    const playerGrid = { c: 0, r: 0 };
    const playerWorld = gridToWorld(playerGrid.c, playerGrid.r);
    const keys = { w: false, a: false, s: false, d: false };
    const moveSpeed = 8; // tiles per second

    let playerIndex = -1;
    let useIpcEcs = !!(ipc && typeof ipc.invoke === 'function' && typeof ipc.send === 'function');
    const localVelocity = { x: 0, y: 0, z: 0 };
    let localVerticalVelocity = 0;
    let unsubscribeEcs = null;
    let lastSentVelocity = { x: 0, y: 0, z: 0 };
    let lastVelocitySendTime = 0;

    if (useIpcEcs) {
      ipc.invoke('ecs:init', createEcsInitRequestBuffer({ x: playerWorld.x, y: 1, z: playerWorld.z })).then((result) => {
        const parsedResult = parseEcsInitResponse(result);
        if (!parsedResult) return;
        playerIndex = Number(parsedResult.index) || 0;
      }).catch((error) => {
        console.warn('ecs:init failed, falling back to local integration:', error);
        useIpcEcs = false;
        playerIndex = 0;
      });
    } else {
      playerIndex = 0;
    }

    // inverse of gridToWorld: convert world x,z back to grid c,r (float)
    function worldToGrid(world) {
      const local = worldToGridLocal(world);
      return { c: local.c + xOffset, r: local.r + yOffset };
    }

    function gridToChunk(c, r) {
      return { cx: Math.floor(c / CHUNK_SIZE), cy: Math.floor(r / CHUNK_SIZE) };
    }

    function getVoxelAtWorld(wx, wy, wz) {
      if (wy < 0) return BLOCK_IDS.STONE;
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wz / CHUNK_SIZE);
      const chunkData = chunks.get(chunkKey(cx, cy));
      if (!chunkData) return BLOCK_IDS.AIR;
      if (wy >= chunkData.chunkHeight) return BLOCK_IDS.AIR;

      const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      return getVoxel(chunkData, lx, wy, lz);
    }

    function getSurfaceCenterYAtWorld(x, z) {
      const vx = Math.floor(x);
      const vz = Math.floor(z);
      const cx = Math.floor(vx / CHUNK_SIZE);
      const cy = Math.floor(vz / CHUNK_SIZE);
      const chunkData = chunks.get(chunkKey(cx, cy));
      if (!chunkData) return null;

      const lx = ((vx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const lz = ((vz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      for (let y = chunkData.chunkHeight - 1; y >= 0; y--) {
        if (getVoxel(chunkData, lx, y, lz) > BLOCK_IDS.AIR) {
          return (y + 1) + PLAYER_HALF_HEIGHT + FOOT_CLEARANCE;
        }
      }
      return PLAYER_HALF_HEIGHT + FOOT_CLEARANCE;
    }

    function getChunkByWorldVoxel(wx, wz) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wz / CHUNK_SIZE);
      return chunks.get(chunkKey(cx, cy)) || null;
    }

    function worldToLocalVoxel(wx, wz) {
      const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      return { lx, lz };
    }

    function rebuildChunksNearWorldVoxel(wx, wz) {
      const candidates = [
        [wx, wz],
        [wx + 1, wz],
        [wx - 1, wz],
        [wx, wz + 1],
        [wx, wz - 1],
      ];
      const touched = new Set();
      for (const [cxw, czw] of candidates) {
        const ccx = Math.floor(cxw / CHUNK_SIZE);
        const ccy = Math.floor(czw / CHUNK_SIZE);
        const key = chunkKey(ccx, ccy);
        if (touched.has(key)) continue;
        touched.add(key);
        const chunk = chunks.get(key);
        if (chunk) rebuildChunkMesh(chunk);
      }
    }

    // load initial chunks around player
    const startChunk = gridToChunk(playerGrid.c, playerGrid.r);
    ensureChunksAround(startChunk.cx, startChunk.cy);


    // Fixed-timestep physics -------------------------------------------------
    let raf;
    let prevChunk = null;
    const PHYSICS_HZ = 60;
    const PHYSICS_DT = 1 / PHYSICS_HZ;
    const GRAVITY = 28;
    const TERMINAL_FALL_SPEED = 40;
    let spawnHeightInitialized = false;
    let previousTime = performance.now() / 1000;
    let accumulator = 0;

    // Keep previous and current authoritative player world state for interpolation
    const playerPrevWorld = { x: playerWorld.x, z: playerWorld.z, y: 1 };
    // Ensure playerWorld has y as well
    playerWorld.y = 1;

    // decoupled look-at tracking vector (smoothed separately from camera position)
    const currentLookAt = new THREE.Vector3(playerWorld.x, playerWorld.y, playerWorld.z);
    const currentCameraPos = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z);
    const cameraOffsetDir = new THREE.Vector3();

    function updateCurrentBiome() {
      const terrain = sampleTerrainDebug(Math.floor(playerWorld.x), Math.floor(playerWorld.z), DEFAULT_WORLD_OPTIONS);
      const biome = generateBiomeAt(
        Math.floor(playerWorld.x),
        Math.floor(playerWorld.z),
        terrain.normalizedHeight,
        { ...DEFAULT_WORLD_OPTIONS, terrain }
      );
      hoveredBiomeInfo = { biome, terrain };
    }

    function physicsStep(dt) {
      playerPrevWorld.x = playerWorld.x;
      playerPrevWorld.z = playerWorld.z;
      playerPrevWorld.y = playerWorld.y;

      if (!spawnHeightInitialized) {
        const spawnY = getSurfaceCenterYAtWorld(playerWorld.x, playerWorld.z);
        if (spawnY !== null) {
          playerWorld.y = spawnY;
          playerPrevWorld.y = spawnY;
          localVerticalVelocity = 0;
          spawnHeightInitialized = true;
        }
      }

      updateCurrentBiome();

      // Get raw WASD input (-1 to 1)
      let inputX = 0, inputZ = 0;
      if (keys.w) inputZ += 1; // Forward
      if (keys.s) inputZ -= 1; // Backward
      if (keys.a) inputX -= 1; // Left
      if (keys.d) inputX += 1; // Right

      const inLen = Math.hypot(inputX, inputZ);
      const moveDt = Math.max(dt, 1e-5);

      let desiredDx = 0;
      let desiredDz = 0;

      if (inLen > 0) {
        // Normalize input so diagonal movement isn't faster
        inputX /= inLen;
        inputZ /= inLen;

        // Extract the camera's Forward and Right vectors
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        forward.y = 0; // Flatten to XZ plane so looking up doesn't slow you down
        forward.normalize();

        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        right.y = 0; // Flatten to XZ plane
        right.normalize();

        // Multiply input by camera directions
        const moveDir = new THREE.Vector3()
          .addScaledVector(right, inputX)
          .addScaledVector(forward, inputZ);

        // Apply speed and delta time
        desiredDx = moveDir.x * moveSpeed * dt;
        desiredDz = moveDir.z * moveSpeed * dt;
      }

      const movePos = { x: playerWorld.x, y: playerWorld.y, z: playerWorld.z };
      moveWithStepUp(getVoxelAtWorld, movePos, 'x', desiredDx, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT);
      moveWithStepUp(getVoxelAtWorld, movePos, 'z', desiredDz, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT);

      const resolvedVx = (movePos.x - playerWorld.x) / moveDt;
      const resolvedVz = (movePos.z - playerWorld.z) / moveDt;

      if (useIpcEcs) {
        const now = performance.now();
        const changed =
          Math.abs(resolvedVx - lastSentVelocity.x) > 0.0001 ||
          Math.abs(resolvedVz - lastSentVelocity.z) > 0.0001;
        if (changed || now - lastVelocitySendTime > 120) {
          ipc.send('ecs:setVelocity', createEcsVelocityBuffer(resolvedVx, 0, resolvedVz));
          lastSentVelocity = { x: resolvedVx, y: 0, z: resolvedVz };
          lastVelocitySendTime = now;
        }
      }

      localVelocity.x = resolvedVx;
      localVelocity.z = resolvedVz;

      playerWorld.x = movePos.x;
      playerWorld.y = movePos.y;
      playerWorld.z = movePos.z;

      const verticalPos = { x: playerWorld.x, y: playerWorld.y, z: playerWorld.z };
      if (resolvePenetrationUp(getVoxelAtWorld, verticalPos, CHUNK_HEIGHT + 2, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)) {
        playerWorld.y = verticalPos.y;
      }

      const grounded = collidesAabb(getVoxelAtWorld, playerWorld.x, playerWorld.y - 0.06, playerWorld.z, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT);
      if (!grounded) {
        localVerticalVelocity = Math.max(localVerticalVelocity - GRAVITY * dt, -TERMINAL_FALL_SPEED);
      } else if (localVerticalVelocity < 0) {
        localVerticalVelocity = 0;
      }

      localVelocity.y = localVerticalVelocity;
      const yMovePos = { x: playerWorld.x, y: playerWorld.y, z: playerWorld.z };
      const blockedY = moveAlongAxis(getVoxelAtWorld, yMovePos, 'y', localVelocity.y * dt, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT);
      if (blockedY && localVelocity.y < 0) {
        localVerticalVelocity = 0;
      }
      playerWorld.y = yMovePos.y;

      const derivedGrid = worldToGrid(playerWorld);
      playerGrid.c = derivedGrid.c;
      playerGrid.r = derivedGrid.r;

      // check chunk transitions and stream chunks when player moves between chunks
      const currentChunk = gridToChunk(playerGrid.c, playerGrid.r);
      if (!prevChunk || currentChunk.cx !== prevChunk.cx || currentChunk.cy !== prevChunk.cy) {
        ensureChunksAround(currentChunk.cx, currentChunk.cy);
        prevChunk = currentChunk;
      }
    }

    const animate = () => {
      const now = performance.now() / 1000;
      let frameTime = now - previousTime;
      if (frameTime > 0.25) frameTime = 0.25; // avoid spiral of death
      previousTime = now;

      const instantFps = 1 / Math.max(frameTime, 0.0001);
      smoothedFps = smoothedFps === 0 ? instantFps : THREE.MathUtils.lerp(smoothedFps, instantFps, 0.12);

      accumulator += frameTime;

      while (accumulator >= PHYSICS_DT) {
        physicsStep(PHYSICS_DT);
        accumulator -= PHYSICS_DT;
      }

      pumpChunkIpcJobs();
      applyGeneratedChunksWithBudget();

      // Process one unload per frame to avoid disposal spikes.
      if (unloadQueueSet.size > 0) {
        const keyToUnload = unloadQueueSet.values().next().value;
        unloadQueueSet.delete(keyToUnload);

        if (activeChunks.has(keyToUnload)) {
          const currentChunkForUnload = gridToChunk(playerGrid.c, playerGrid.r);
          const [ucx, ucy] = keyToUnload.split(',').map(Number);
          if (chunkDistanceSq(ucx, ucy, currentChunkForUnload.cx, currentChunkForUnload.cy) > chunkRadius * chunkRadius) {
            unloadChunk(ucx, ucy);
          }
        }
      }

      const alpha = accumulator / PHYSICS_DT;
      // Interpolate visual position between previous and current physics states
      const visX = THREE.MathUtils.lerp(playerPrevWorld.x, playerWorld.x, alpha);
      const visZ = THREE.MathUtils.lerp(playerPrevWorld.z, playerWorld.z, alpha);
      const visY = THREE.MathUtils.lerp(playerPrevWorld.y, playerWorld.y, alpha);

      cube.position.x = visX;
      cube.position.z = visZ;
      cube.position.y = visY;

      // third-person orbit camera driven by middle-mouse drag
      orbitState.yaw += mouseAccumX * MOUSE_SENS;
      orbitState.pitch = THREE.MathUtils.clamp(
        orbitState.pitch + mouseAccumY * MOUSE_SENS,
        0.16,
        1.05
      );
      mouseAccumX = 0;
      mouseAccumY = 0;

      const visualFrameTime = Math.min(frameTime, 0.033);
      const lookLerpAlpha = 1 - Math.exp(-10 * visualFrameTime);
      const camLerpAlpha = 1 - Math.exp(-8 * visualFrameTime);
      const distanceLerpAlpha = 1 - Math.exp(-6 * visualFrameTime);
      currentLookAt.x = THREE.MathUtils.lerp(currentLookAt.x, visX, lookLerpAlpha);
      currentLookAt.y = THREE.MathUtils.lerp(currentLookAt.y, visY + 0.75, lookLerpAlpha);
      currentLookAt.z = THREE.MathUtils.lerp(currentLookAt.z, visZ, lookLerpAlpha);

      orbitState.targetDistance = orbitState.targetDistance;
      orbitState.distance = THREE.MathUtils.lerp(orbitState.distance, orbitState.targetDistance, distanceLerpAlpha);
      cameraOffsetDir.set(
        Math.cos(orbitState.yaw) * Math.cos(orbitState.pitch),
        Math.sin(orbitState.pitch),
        Math.sin(orbitState.yaw) * Math.cos(orbitState.pitch)
      );
      currentCameraPos.copy(currentLookAt).addScaledVector(cameraOffsetDir, orbitState.distance);
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, currentCameraPos.x, camLerpAlpha);
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, currentCameraPos.y, camLerpAlpha);
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, currentCameraPos.z, camLerpAlpha);
      camera.lookAt(currentLookAt);

      if (pointerMoved) {
        const nowMs = performance.now();
        if (!orbitState.dragging && (nowMs - lastHoverRaycastTime) >= HOVER_RAYCAST_INTERVAL_MS) {
          lastHoverRaycastTime = nowMs;
          const pickStarted = performance.now();
          const hit = getRaycastHit();
          const pickElapsed = performance.now() - pickStarted;
          lastHoverPickTimeMs = pickElapsed;
          avgHoverPickTimeMs = avgHoverPickTimeMs === 0
            ? pickElapsed
            : THREE.MathUtils.lerp(avgHoverPickTimeMs, pickElapsed, 0.2);
          if (hit) {
            const wx = hit.block.wx;
            const wz = hit.block.wz;
            highlightMesh.position.x = wx + 0.5;
            highlightMesh.position.z = wz + 0.5;
            highlightMesh.position.y = hit.block.y + 0.5;
            highlightMesh.visible = true;
            hoveredInfo = { x: wx, y: hit.block.y, z: wz, id: getVoxel(hit.chunk, hit.block.x, hit.block.y, hit.block.z) };
          } else {
            highlightMesh.visible = false;
            hoveredInfo = null;
          }
        }
        pointerMoved = false;
      }

      if (now - lastDebugRefresh > 0.15) {
        const expectedInRange = (chunkRadius * 2 + 1) * (chunkRadius * 2 + 1);
        const currentChunk = gridToChunk(playerGrid.c, playerGrid.r);
        debugPanel.textContent = [
          `fps: ${smoothedFps.toFixed(1)}`,
          hoveredBiomeInfo ? `biome: ${hoveredBiomeInfo.biome}` : `biome: -`,
          hoveredBiomeInfo ? `terrain: h=${hoveredBiomeInfo.terrain.normalizedHeight.toFixed(3)} slope=${hoveredBiomeInfo.terrain.slope.toFixed(3)} mountain=${hoveredBiomeInfo.terrain.mountainness.toFixed(3)} preset=${hoveredBiomeInfo.terrain.preset}` : `terrain: -`,
          `player chunk: ${currentChunk.cx},${currentChunk.cy}`,
          // show player world-space and grid coordinates for debugging
          `player world: ${playerWorld.x.toFixed(2)},${playerWorld.y.toFixed(2)},${playerWorld.z.toFixed(2)}`,
          `player grid: ${playerGrid.c.toFixed(2)},${playerGrid.r.toFixed(2)}`,
          hoveredInfo ? `hover: ${hoveredInfo.x},${hoveredInfo.y},${hoveredInfo.z}  id: ${idToBlock(hoveredInfo.id)}` : `hover: -`,
          `chunks in range: ${activeChunks.size}/${expectedInRange}`,
          `chunk radius: ${chunkRadius}`,
          `queued: ${loadQueue.length}  pending: ${pendingChunkKeys.size}  generated: ${generatedChunkQueue.length}`,
          `unload queued: ${unloadQueueSet.size}`,
          `chunk ipc in-flight: ${chunkIpcInFlight}/${CHUNK_IPC_MAX_IN_FLIGHT}`,
          `meshing in flight: ${isMeshing ? 'yes' : 'no'}`,
          `chunk apply: ${lastChunkApplyCount} chunks, ${lastChunkApplyTimeMs.toFixed(2)}ms (budget ${CHUNK_APPLY_BUDGET_MS}ms)`,
          `hover pick: last ${lastHoverPickTimeMs.toFixed(2)}ms  avg ${avgHoverPickTimeMs.toFixed(2)}ms`,
          `chunk source: ${chunkIpcEnabled ? 'electron-ipc' : 'local-sync'}`,
          `ecs source: ${useIpcEcs ? 'electron-ipc' : 'local'}`,
          `ecs player index: ${playerIndex}`,
        ].join('\n');
        lastDebugRefresh = now;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      container.removeChild(debugPanel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (unsubscribeEcs) {
        unsubscribeEcs();
      }
      if (useIpcEcs) {
        ipc.send('ecs:stop', { index: playerIndex });
      }
    };

  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        margin: 0,
        overflow: 'hidden'
      }}
    />
  );

}

export default GamePage;