import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { BLOCK_IDS, CHUNK_HEIGHT, CHUNK_SIZE, chunkArrayLength, chunkKey, DEFAULT_WORLD_OPTIONS, getVoxel, setVoxel, voxelIndex } from '../lib/engine/World.js';
import { buildChunkMeshes, disposeChunkMeshes } from '../lib/engine/Renderer.js';
import { gridToWorld, worldToGrid as worldToGridLocal, tileSize } from '../lib/engine/GridMath.js';
import { fbm2D, fbm3D, generateBiomeAt } from '../lib/engine/Noise.js';

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

    const aspect = container.clientWidth / container.clientHeight;
    const d = 20;
    const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 1000);
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);
    // camera offset relative to player world position
    const cameraOffset = { x: 20, y: 20, z: 20 };

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

    const highlightGeom = new THREE.PlaneGeometry(tileSize, tileSize);
    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0xddffff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    });
    const highlightMesh = new THREE.Mesh(highlightGeom, highlightMat);
    highlightMesh.rotation.x = -Math.PI / 2;
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
    const chunkMeshes = []; // active chunk-level meshes (InstancedMesh) for raycasting
    let hoveredInfo = null;
    const chunkRadius = 3; // load radius in chunks (increase for larger view)
    const loadQueue = [];
    const loadQueueSet = new Set();
    const generatedChunkQueue = [];
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

    function buildChunkFromBlocks(cx, cy, chunkSize, chunkHeight, blocks) {
      return {
        cx,
        cy,
        chunkSize,
        chunkHeight,
        blocks,
      };
    }

    function generateChunkDataSync(cx, cy, chunkSize, chunkHeight, options) {
      const opts = { ...DEFAULT_WORLD_OPTIONS, ...(options || {}) };
      const localChunkHeight = Number(chunkHeight || opts.chunkHeight) || CHUNK_HEIGHT;
      const blocks = new Uint8Array(chunkArrayLength(chunkSize, localChunkHeight));
      const startC = cx * chunkSize;
      const startR = cy * chunkSize;
      for (let z = 0; z < chunkSize; z++) {
        for (let x = 0; x < chunkSize; x++) {
          const col = startC + x;
          const row = startR + z;
          let n = fbm2D(col, row, opts);
          n = Math.pow(n, opts.exponent || 1.0);
          const surfaceY = Math.round((opts.minHeight || 0) + n * ((opts.maxHeight || 3) - (opts.minHeight || 0)));

          const biomeStr = generateBiomeAt(col, row, n, opts);
          let surfaceBlockId = BLOCK_IDS.GRASS;
          if (biomeStr === 'water') surfaceBlockId = BLOCK_IDS.WATER;
          if (biomeStr === 'sand') surfaceBlockId = BLOCK_IDS.SAND;
          if (biomeStr === 'snow') surfaceBlockId = BLOCK_IDS.SNOW;
          if (biomeStr === 'desert') surfaceBlockId = BLOCK_IDS.DESERT;
          if (biomeStr === 'forest') surfaceBlockId = BLOCK_IDS.FOREST;

          const caveSeed = typeof opts.seed === 'number' ? opts.seed + 999 : `${opts.seed}_999`;
          for (let y = 0; y < localChunkHeight; y++) {
            const index = voxelIndex(x, y, z, chunkSize, localChunkHeight);

            if (y > surfaceY) {
              blocks[index] = BLOCK_IDS.AIR;
            } else if (y === surfaceY) {
              blocks[index] = surfaceBlockId;
            } else if (y >= surfaceY - 3) {
              if (surfaceBlockId === BLOCK_IDS.SAND || surfaceBlockId === BLOCK_IDS.DESERT) {
                blocks[index] = BLOCK_IDS.SAND;
              } else {
                blocks[index] = BLOCK_IDS.DIRT;
              }
            } else {
              const caveDensity = fbm3D(col, y, row, {
                seed: caveSeed,
                scale: opts.caveScale,
                octaves: opts.caveOctaves,
              });
              if (caveDensity < (opts.caveThreshold || 0.3)) {
                blocks[index] = BLOCK_IDS.AIR;
              } else {
                blocks[index] = BLOCK_IDS.STONE;
              }
            }
          }
        }
      }
      return { chunkHeight: localChunkHeight, blocks };
    }

    function requestIpcChunkBatch(batch) {
      if (!batch.length) return;

      chunkIpcInFlight += 1;
      const payload = {
        jobs: batch.map((it) => ({ cx: it.cx, cy: it.cy })),
        chunkSize: CHUNK_SIZE,
        options: DEFAULT_WORLD_OPTIONS,
      };

      ipc.invoke('world:generateChunks', payload)
        .then((results) => {
          const list = Array.isArray(results) ? results : [];
          for (const item of list) {
            const key = chunkKey(item.cx, item.cy);
            pendingChunkKeys.delete(key);
            if (!loadQueueSet.has(key) && !activeChunks.has(key)) continue;
            generatedChunkQueue.push({
              cx: item.cx,
              cy: item.cy,
              chunkSize: item.chunkSize || CHUNK_SIZE,
              chunkHeight: item.chunkHeight || CHUNK_HEIGHT,
              blocks: new Uint8Array(item.blocks),
            });
          }
        })
        .catch((error) => {
          console.warn('Chunk IPC failed, falling back to sync generation for batch:', error);
          for (const item of batch) {
            const key = chunkKey(item.cx, item.cy);
            pendingChunkKeys.delete(key);
            if (!loadQueueSet.has(key) && !activeChunks.has(key)) continue;
            const data = generateChunkDataSync(item.cx, item.cy, CHUNK_SIZE, CHUNK_HEIGHT, DEFAULT_WORLD_OPTIONS);
            generatedChunkQueue.push({
              cx: item.cx,
              cy: item.cy,
              chunkSize: CHUNK_SIZE,
              chunkHeight: data.chunkHeight,
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
          const data = generateChunkDataSync(cx, cy, CHUNK_SIZE, CHUNK_HEIGHT, DEFAULT_WORLD_OPTIONS);
          pendingChunkKeys.delete(key);

          if (!loadQueueSet.has(key) && !activeChunks.has(key)) {
            continue;
          }

          generatedChunkQueue.push({
            cx,
            cy,
            chunkSize: CHUNK_SIZE,
            chunkHeight: data.chunkHeight,
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

    function applyGeneratedChunk(generated) {
      const key = chunkKey(generated.cx, generated.cy);
      if (chunks.has(key)) return;

      const chunk = buildChunkFromBlocks(generated.cx, generated.cy, generated.chunkSize, generated.chunkHeight, generated.blocks);
      chunks.set(key, chunk);
      buildChunkMeshes(scene, chunk, tileGeom, xOffset, yOffset);

      if (chunk.instancedMeshes) {
        for (const m of chunk.instancedMeshes) {
          if (!m) continue;
          chunkMeshes.push(m);
        }
      }
      activeChunks.add(key);
      loadQueueSet.delete(key);
    }

    function applyGeneratedChunksWithBudget() {
      const started = performance.now();
      let applied = 0;

      if (generatedChunkQueue.length > 1) {
        generatedChunkQueue.sort((a, b) => {
          const da = chunkDistanceSq(a.cx, a.cy, desiredChunkCenter.cx, desiredChunkCenter.cy);
          const db = chunkDistanceSq(b.cx, b.cy, desiredChunkCenter.cx, desiredChunkCenter.cy);
          return da - db;
        });
      }

      while (generatedChunkQueue.length) {
        const elapsed = performance.now() - started;
        if (elapsed >= CHUNK_APPLY_BUDGET_MS) break;

        const generated = generatedChunkQueue.shift();
        const key = chunkKey(generated.cx, generated.cy);

        if (!loadQueueSet.has(key) && !activeChunks.has(key)) continue;
        applyGeneratedChunk(generated);
        applied += 1;
      }

      lastChunkApplyCount = applied;
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
        if (!want.has(k)) {
          const [ucx, ucy] = k.split(',').map(Number);
          unloadChunk(ucx, ucy);
        }
      }
    }

    // initial player start at 0,0

    // player placeholder
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshStandardMaterial({ color: 0x00ffcc })
    );
    const PLAYER_HALF_WIDTH = 0.42;
    const PLAYER_HALF_HEIGHT = 1;
    const FOOT_CLEARANCE = 0.04;
    cube.position.y = PLAYER_HALF_HEIGHT + FOOT_CLEARANCE;
    scene.add(cube);

    // raycaster for hover / selection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function rebuildChunkMesh(chunk) {
      if (!chunk) return;
      if (chunk.instancedMeshes) {
        for (const m of chunk.instancedMeshes) {
          const idx = chunkMeshes.indexOf(m);
          if (idx !== -1) chunkMeshes.splice(idx, 1);
        }
      }
      disposeChunkMeshes(scene, chunk);
      buildChunkMeshes(scene, chunk, tileGeom, xOffset, yOffset);
      if (chunk.instancedMeshes) {
        for (const m of chunk.instancedMeshes) {
          if (!m) continue;
          chunkMeshes.push(m);
        }
      }
    }

    function getRaycastHit(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(chunkMeshes);
      if (!intersects.length) return null;

      const hit = intersects[0];
      const mesh = hit.object;
      const instanceId = hit.instanceId;
      const blockPositions = mesh?.userData?.blockPositions;
      const chunk = mesh?.userData?.chunk;
      if (!chunk || typeof instanceId !== 'number' || !blockPositions || !blockPositions[instanceId]) return null;

      const block = blockPositions[instanceId];
      const normal = hit.face?.normal ? hit.face.normal.clone().round() : new THREE.Vector3(0, 1, 0);
      return { chunk, block, normal };
    }

    const onPointerMove = (event) => {
      const hit = getRaycastHit(event);
      if (hit) {
        const wx = hit.block.wx;
        const wz = hit.block.wz;
        highlightMesh.position.x = wx;
        highlightMesh.position.z = wz;
        highlightMesh.position.y = hit.block.y + 1.02;
        highlightMesh.visible = true;
        hoveredInfo = { x: wx, y: hit.block.y, z: wz, id: getVoxel(hit.chunk, hit.block.x, hit.block.y, hit.block.z) };
      } else {
        highlightMesh.visible = false;
        hoveredInfo = null;
      }
    };

    const onPointerDown = (event) => {
      const hit = getRaycastHit(event);
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

    const onContextMenu = (event) => event.preventDefault();

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
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
      ipc.invoke('ecs:init', {
        position: { x: playerWorld.x, y: 1, z: playerWorld.z },
      }).then((result) => {
        if (!result) return;
        playerIndex = Number(result.index) || 0;
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

    function collidesAabb(centerX, centerY, centerZ) {
      const epsilon = 1e-4;
      const minX = Math.floor((centerX - PLAYER_HALF_WIDTH) + epsilon);
      const maxX = Math.floor((centerX + PLAYER_HALF_WIDTH) - epsilon);
      const minY = Math.floor((centerY - PLAYER_HALF_HEIGHT) + epsilon);
      const maxY = Math.floor((centerY + PLAYER_HALF_HEIGHT) - epsilon);
      const minZ = Math.floor((centerZ - PLAYER_HALF_WIDTH) + epsilon);
      const maxZ = Math.floor((centerZ + PLAYER_HALF_WIDTH) - epsilon);

      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          for (let x = minX; x <= maxX; x++) {
            if (getVoxelAtWorld(x, y, z) > BLOCK_IDS.AIR) return true;
          }
        }
      }
      return false;
    }

    function moveAlongAxis(position, axis, delta) {
      if (Math.abs(delta) < 1e-7) return false;

      const maxStep = 0.2;
      const steps = Math.max(1, Math.ceil(Math.abs(delta) / maxStep));
      const stepDelta = delta / steps;

      for (let i = 0; i < steps; i++) {
        const nextX = axis === 'x' ? position.x + stepDelta : position.x;
        const nextY = axis === 'y' ? position.y + stepDelta : position.y;
        const nextZ = axis === 'z' ? position.z + stepDelta : position.z;
        if (collidesAabb(nextX, nextY, nextZ)) return true;
        position.x = nextX;
        position.y = nextY;
        position.z = nextZ;
      }

      return false;
    }

    function tryMoveWithStepUp(position, axis, delta) {
      if (Math.abs(delta) < 1e-7) return false;

      const steppedPosition = { x: position.x, y: position.y + 1, z: position.z };
      if (collidesAabb(steppedPosition.x, steppedPosition.y, steppedPosition.z)) {
        return false;
      }

      const blocked = moveAlongAxis(steppedPosition, axis, delta);
      if (blocked) return false;

      position.x = steppedPosition.x;
      position.y = steppedPosition.y;
      position.z = steppedPosition.z;
      return true;
    }

    function resolvePenetrationUp(position, maxLift = CHUNK_HEIGHT + 2) {
      if (!collidesAabb(position.x, position.y, position.z)) return true;
      for (let i = 0; i < maxLift; i++) {
        position.y += 1;
        if (!collidesAabb(position.x, position.y, position.z)) return true;
      }
      return false;
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

    // ECS runs in the main process via IPC. Smooth snapshots before rendering.

    function physicsStep(dt) {
      // copy current to prev for interpolation
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

      // Compute desired velocity from input and write into shared buffer
      let inC = 0, inR = 0;
      if (keys.w) { inC -= 1; inR -= 1; }
      if (keys.s) { inC += 1; inR += 1; }
      if (keys.a) { inC -= 1; inR += 1; }
      if (keys.d) { inC += 1; inR -= 1; }
      const inLen = Math.hypot(inC, inR);

      let vTilesC = 0, vTilesR = 0;
      if (inLen > 0) {
        vTilesC = (inC / inLen) * moveSpeed;
        vTilesR = (inR / inLen) * moveSpeed;
      }

      const vWorld = gridToWorld(vTilesC, vTilesR);

      const moveDt = Math.max(dt, 1e-5);
      const desiredDx = vWorld.x * dt;
      const desiredDz = vWorld.z * dt;

      const movePos = { x: playerWorld.x, y: playerWorld.y, z: playerWorld.z };
      if (moveAlongAxis(movePos, 'x', desiredDx)) {
        tryMoveWithStepUp(movePos, 'x', desiredDx);
      }
      if (moveAlongAxis(movePos, 'z', desiredDz)) {
        tryMoveWithStepUp(movePos, 'z', desiredDz);
      }

      const resolvedVx = (movePos.x - playerWorld.x) / moveDt;
      const resolvedVz = (movePos.z - playerWorld.z) / moveDt;

      if (useIpcEcs) {
        const now = performance.now();
        const changed =
          Math.abs(resolvedVx - lastSentVelocity.x) > 0.0001 ||
          Math.abs(resolvedVz - lastSentVelocity.z) > 0.0001;
        if (changed || now - lastVelocitySendTime > 120) {
          ipc.send('ecs:setVelocity', { index: playerIndex, vx: resolvedVx, vy: 0, vz: resolvedVz });
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
      if (resolvePenetrationUp(verticalPos)) {
        playerWorld.y = verticalPos.y;
      }

      const grounded = collidesAabb(playerWorld.x, playerWorld.y - 0.06, playerWorld.z);
      if (!grounded) {
        localVerticalVelocity = Math.max(localVerticalVelocity - GRAVITY * dt, -TERMINAL_FALL_SPEED);
      } else if (localVerticalVelocity < 0) {
        localVerticalVelocity = 0;
      }

      localVelocity.y = localVerticalVelocity;
      const yMovePos = { x: playerWorld.x, y: playerWorld.y, z: playerWorld.z };
      const blockedY = moveAlongAxis(yMovePos, 'y', localVelocity.y * dt);
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

      const alpha = accumulator / PHYSICS_DT;
      // Interpolate visual position between previous and current physics states
      const visX = THREE.MathUtils.lerp(playerPrevWorld.x, playerWorld.x, alpha);
      const visZ = THREE.MathUtils.lerp(playerPrevWorld.z, playerWorld.z, alpha);
      const visY = THREE.MathUtils.lerp(playerPrevWorld.y, playerWorld.y, alpha);

      cube.position.x = visX;
      cube.position.z = visZ;
      cube.position.y = visY;

      // decoupled camera smoothing: slow position trail, faster look-at smoothing
      const posLerpSpeed = Math.min(1, 4 * frameTime);
      const lookLerpSpeed = Math.min(1, 10 * frameTime);

      // Smoothly trail the camera's position (creates the tilt/lag effect)
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, visX + cameraOffset.x, posLerpSpeed);
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, visY + cameraOffset.y, posLerpSpeed);
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, visZ + cameraOffset.z, posLerpSpeed);

      // Smoothly track the player's visual position with a faster lerp
      currentLookAt.x = THREE.MathUtils.lerp(currentLookAt.x, visX, lookLerpSpeed);
      currentLookAt.y = THREE.MathUtils.lerp(currentLookAt.y, visY, lookLerpSpeed);
      currentLookAt.z = THREE.MathUtils.lerp(currentLookAt.z, visZ, lookLerpSpeed);

      // Apply the smoothed target
      camera.lookAt(currentLookAt);

      if (now - lastDebugRefresh > 0.15) {
        const expectedInRange = (chunkRadius * 2 + 1) * (chunkRadius * 2 + 1);
        const currentChunk = gridToChunk(playerGrid.c, playerGrid.r);
        debugPanel.textContent = [
          `fps: ${smoothedFps.toFixed(1)}`,
          `player chunk: ${currentChunk.cx},${currentChunk.cy}`,
          // show player world-space and grid coordinates for debugging
          `player world: ${playerWorld.x.toFixed(2)},${playerWorld.y.toFixed(2)},${playerWorld.z.toFixed(2)}`,
          `player grid: ${playerGrid.c.toFixed(2)},${playerGrid.r.toFixed(2)}`,
          hoveredInfo ? `hover: ${hoveredInfo.x},${hoveredInfo.y},${hoveredInfo.z}  id: ${idToBlock(hoveredInfo.id)}` : `hover: -`,
          `chunks in range: ${activeChunks.size}/${expectedInRange}`,
          `chunk radius: ${chunkRadius}`,
          `queued: ${loadQueue.length}  pending: ${pendingChunkKeys.size}  generated: ${generatedChunkQueue.length}`,
          `chunk ipc in-flight: ${chunkIpcInFlight}/${CHUNK_IPC_MAX_IN_FLIGHT}`,
          `chunk apply: ${lastChunkApplyCount} chunks, ${lastChunkApplyTimeMs.toFixed(2)}ms (budget ${CHUNK_APPLY_BUDGET_MS}ms)`,
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
      const a = w / h;
      camera.left = -d * a;
      camera.right = d * a;
      camera.top = d;
      camera.bottom = -d;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
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