import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { CHUNK_SIZE, chunkKey, DEFAULT_WORLD_OPTIONS } from '../lib/engine/World.js';
import { buildChunkMeshes, disposeChunkMeshes } from '../lib/engine/Renderer.js';
import { gridToWorld, worldToGrid as worldToGridLocal, tileSize } from '../lib/engine/GridMath.js';
import { generateHeightAt, generateBiomeAt, fbm2D } from '../lib/engine/Noise.js';

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

    function buildChunkFromHeights(cx, cy, chunkSize, heights, biomes) {
      const tiles = new Map();
      const startC = cx * chunkSize;
      const startR = cy * chunkSize;
      let i = 0;
      for (let r = 0; r < chunkSize; r++) {
        for (let c = 0; c < chunkSize; c++) {
          const gc = startC + c;
          const gr = startR + r;
          tiles.set(`${gc},${gr}`, {
            col: gc,
            row: gr,
            type: biomes ? biomes[i] : 'floor',
            traversable: true,
            height: heights[i++],
          });
        }
      }
      return { cx, cy, tiles };
    }

    function generateChunkDataSync(cx, cy, chunkSize, options) {
      const opts = { ...DEFAULT_WORLD_OPTIONS, ...(options || {}) };
      const heights = new Float32Array(chunkSize * chunkSize);
      const biomes = new Array(chunkSize * chunkSize);
      const startC = cx * chunkSize;
      const startR = cy * chunkSize;
      let i = 0;
      for (let r = 0; r < chunkSize; r++) {
        for (let c = 0; c < chunkSize; c++) {
          const col = startC + c;
          const row = startR + r;
          // get normalized noise first
          let n = fbm2D(col, row, opts);
          n = Math.pow(n, opts.exponent || 1.0);
          const h = Math.round((opts.minHeight || 0) + n * ((opts.maxHeight || 3) - (opts.minHeight || 0))) * (opts.blockHeight || 1);
          heights[i] = h;
          biomes[i] = generateBiomeAt(col, row, n, opts);
          i++;
        }
      }
      return { heights, biomes };
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
                heights: new Float32Array(item.heights),
                biomes: item.biomes || null,
            });
          }
        })
        .catch((error) => {
          console.warn('Chunk IPC failed, falling back to sync generation for batch:', error);
          for (const item of batch) {
            const key = chunkKey(item.cx, item.cy);
            pendingChunkKeys.delete(key);
            if (!loadQueueSet.has(key) && !activeChunks.has(key)) continue;
            const data = generateChunkDataSync(item.cx, item.cy, CHUNK_SIZE, DEFAULT_WORLD_OPTIONS);
            generatedChunkQueue.push({
              cx: item.cx,
              cy: item.cy,
              chunkSize: CHUNK_SIZE,
              heights: data.heights,
              biomes: data.biomes,
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
          const data = generateChunkDataSync(cx, cy, CHUNK_SIZE, DEFAULT_WORLD_OPTIONS);
          pendingChunkKeys.delete(key);

          if (!loadQueueSet.has(key) && !activeChunks.has(key)) {
            continue;
          }

          generatedChunkQueue.push({
            cx,
            cy,
            chunkSize: CHUNK_SIZE,
            heights: data.heights,
            biomes: data.biomes,
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

      const chunk = buildChunkFromHeights(generated.cx, generated.cy, generated.chunkSize, generated.heights, generated.biomes);
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
    cube.position.y = 1;
    scene.add(cube);

    // raycaster for hover / selection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(chunkMeshes);

      if (intersects.length) {
        const p = intersects[0].point;
        const local = worldToGrid({ x: p.x, z: p.z });
        const tc = Math.round(local.c);
        const tr = Math.round(local.r);

        const pcx = Math.floor(tc / CHUNK_SIZE);
        const pcy = Math.floor(tr / CHUNK_SIZE);
        const chunkData = chunks.get(chunkKey(pcx, pcy));
        if (chunkData) {
          const tile = chunkData.tiles.get(`${tc},${tr}`);
          if (tile) {
            const pos = gridToWorld(tile.col - xOffset, tile.row - yOffset);
            highlightMesh.position.x = pos.x;
            highlightMesh.position.z = pos.z;
            const heightScale = Math.max(0.1, tile.height);
            highlightMesh.position.y = heightScale + 0.05;
            highlightMesh.visible = true;
            hoveredInfo = { c: tc, r: tr, biome: tile.type, world: pos };
          } else {
            highlightMesh.visible = false;
            hoveredInfo = null;
          }
        } else {
          highlightMesh.visible = false;
          hoveredInfo = null;
        }
      } else {
        highlightMesh.visible = false;
      }
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);

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
    const ecsState = { x: playerWorld.x, y: 1, z: playerWorld.z };
    const localVelocity = { x: 0, y: 0, z: 0 };
    let unsubscribeEcs = null;
    let lastSentVelocity = { x: 0, y: 0, z: 0 };
    let lastVelocitySendTime = 0;
    const ECS_POSITION_SMOOTHING = 0.35;

    if (useIpcEcs) {
      ipc.invoke('ecs:init', {
        position: { x: playerWorld.x, y: 1, z: playerWorld.z },
      }).then((result) => {
        if (!result) return;
        playerIndex = Number(result.index) || 0;
        if (result.position) {
          ecsState.x = Number(result.position.x) || 0;
          ecsState.y = Number(result.position.y) || 1;
          ecsState.z = Number(result.position.z) || 0;
          playerWorld.x = ecsState.x;
          playerWorld.y = ecsState.y;
          playerWorld.z = ecsState.z;
        }
      }).catch((error) => {
        console.warn('ecs:init failed, falling back to local integration:', error);
        useIpcEcs = false;
        playerIndex = 0;
      });

      unsubscribeEcs = ipc.on('ecs:state', (packet) => {
        if (!packet || (typeof packet.index === 'number' && packet.index !== playerIndex)) return;
        const pos = packet.position || {};
        ecsState.x = Number(pos.x) || 0;
        ecsState.y = Number(pos.y) || 1;
        ecsState.z = Number(pos.z) || 0;
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

    // load initial chunks around player
    const startChunk = gridToChunk(playerGrid.c, playerGrid.r);
    ensureChunksAround(startChunk.cx, startChunk.cy);


    // Fixed-timestep physics -------------------------------------------------
    let raf;
    let prevChunk = null;
    const PHYSICS_HZ = 60;
    const PHYSICS_DT = 1 / PHYSICS_HZ;
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

      if (useIpcEcs) {
        playerWorld.x = THREE.MathUtils.lerp(playerWorld.x, ecsState.x, ECS_POSITION_SMOOTHING);
        playerWorld.y = THREE.MathUtils.lerp(playerWorld.y, ecsState.y, ECS_POSITION_SMOOTHING);
        playerWorld.z = THREE.MathUtils.lerp(playerWorld.z, ecsState.z, ECS_POSITION_SMOOTHING);
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

      // climb check using projected candidate position
      const cand = {
        x: playerWorld.x + vWorld.x * dt,
        z: playerWorld.z + vWorld.z * dt,
      };
      const derived = worldToGrid(cand);
      const tc = Math.round(derived.c);
      const tr = Math.round(derived.r);
      const currentGrid = worldToGrid(playerWorld);
      const currentC = Math.round(currentGrid.c);
      const currentR = Math.round(currentGrid.r);

      function getTileHeight(c, r) {
        const pcx = Math.floor(c / CHUNK_SIZE);
        const pcy = Math.floor(r / CHUNK_SIZE);
        const chunkData = chunks.get(chunkKey(pcx, pcy));
        if (!chunkData) return 0;
        const tile = chunkData.tiles.get(`${c},${r}`);
        return tile ? tile.height : 0;
      }

      const candidateHeight = getTileHeight(tc, tr);
      const currentHeight = getTileHeight(currentC, currentR);
      const maxClimb = DEFAULT_WORLD_OPTIONS.blockHeight || 1;

      if (useIpcEcs) {
        let vx = 0;
        let vz = 0;
        if (candidateHeight - currentHeight <= maxClimb) {
          vx = vWorld.x;
          vz = vWorld.z;
        }

        const now = performance.now();
        const changed =
          Math.abs(vx - lastSentVelocity.x) > 0.0001 ||
          Math.abs(vz - lastSentVelocity.z) > 0.0001;
        if (changed || now - lastVelocitySendTime > 120) {
          ipc.send('ecs:setVelocity', { index: playerIndex, vx, vy: 0, vz });
          lastSentVelocity = { x: vx, y: 0, z: vz };
          lastVelocitySendTime = now;
        }
      } else if (candidateHeight - currentHeight <= maxClimb) {
        localVelocity.x = vWorld.x;
        localVelocity.y = 0;
        localVelocity.z = vWorld.z;
      } else {
        localVelocity.x = 0;
        localVelocity.y = 0;
        localVelocity.z = 0;
      }

      if (!useIpcEcs) {
        playerWorld.x += localVelocity.x * dt;
        playerWorld.y += localVelocity.y * dt;
        playerWorld.z += localVelocity.z * dt;
      }

      const derivedGrid = worldToGrid(playerWorld);
      playerGrid.c = derivedGrid.c;
      playerGrid.r = derivedGrid.r;
      

      // Update player vertical position to tile top
      const pc = Math.round(playerGrid.c);
      const pr = Math.round(playerGrid.r);
      const pcx = Math.floor(pc / CHUNK_SIZE);
      const pcy = Math.floor(pr / CHUNK_SIZE);
      const chunkData = chunks.get(chunkKey(pcx, pcy));
      let targetY = 1;
      if (chunkData) {
        const tile = chunkData.tiles.get(`${pc},${pr}`);
        if (tile) targetY = tile.height + 1;
      }
      playerWorld.y = targetY;

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
          hoveredInfo ? `hover: grid ${hoveredInfo.c},${hoveredInfo.r}  biome: ${hoveredInfo.biome}` : `hover: -`,
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