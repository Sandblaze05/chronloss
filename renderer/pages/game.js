import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { CHUNK_SIZE, createChunk, chunkKey } from '../lib/engine/World.js';
import { buildChunkMeshes, disposeChunkMeshes, getTileMeshes } from '../lib/engine/Renderer.js';
import { gridToWorld, worldToGrid as worldToGridLocal, tileSize } from '../lib/engine/GridMath.js';

const GamePage = () => {

  const ref = useRef(null);

  useEffect(() => {

    const container = ref.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    console.log(window.innerWidth, window.innerHeight)
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

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
    const tiles = []; // active meshes for raycasting
    const chunkRadius = 2; // load radius in chunks (increase for larger view)

    function loadChunk(cx, cy) {
      const key = chunkKey(cx, cy);
      if (chunks.has(key)) return;
      const chunk = createChunk(cx, cy, CHUNK_SIZE);
      chunks.set(key, chunk);
      buildChunkMeshes(scene, chunk, tileGeom, xOffset, yOffset);

      for (const t of chunk.tiles.values()) {
        // ONLY push the mesh, ignore the meshLine
        if (t.mesh) tiles.push(t.mesh);
      }
      activeChunks.add(key);
    }

    function unloadChunk(cx, cy) {
      const key = chunkKey(cx, cy);
      if (!chunks.has(key)) return;
      const chunk = chunks.get(key);

      for (const t of chunk.tiles.values()) {
        if (t.mesh) {
          const i = tiles.indexOf(t.mesh);
          if (i !== -1) tiles.splice(i, 1);
        }
        // Removed the meshLine cleanup here as well
      }
      disposeChunkMeshes(scene, chunk);
      chunks.delete(key);
      activeChunks.delete(key);
    }

    function ensureChunksAround(cx, cy) {
      const want = new Set();
      for (let oy = -chunkRadius; oy <= chunkRadius; oy++) {
        for (let ox = -chunkRadius; ox <= chunkRadius; ox++) {
          want.add(chunkKey(cx + ox, cy + oy));
        }
      }
      // load new
      for (const k of want) {
        if (!activeChunks.has(k)) {
          const [scx, scy] = k.split(',').map(Number);
          loadChunk(scx, scy);
        }
      }
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
      const intersects = raycaster.intersectObjects(tiles);

      if (intersects.length) {
        const t = intersects[0].object;

        highlightMesh.position.x = t.position.x;
        highlightMesh.position.z = t.position.z;

        // Since t is now a scaled cube starting at y=0, its top face is exactly at its scale.y
        highlightMesh.position.y = t.scale.y + 0.05; 

        highlightMesh.visible = true;
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
    const moveSpeed = 3; // tiles per second

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

    let raf;
    let lastTime = performance.now();
    let prevChunk = null;
    const animate = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp dt
      lastTime = now;

      // derive requested delta in grid space (tiles per second -> delta tiles)
      let dc = 0, dr = 0;
      if (keys.w) { dc -= moveSpeed * dt; dr -= moveSpeed * dt; }
      if (keys.s) { dc += moveSpeed * dt; dr += moveSpeed * dt; }
      if (keys.a) { dc -= moveSpeed * dt; dr += moveSpeed * dt; }
      if (keys.d) { dc += moveSpeed * dt; dr -= moveSpeed * dt; }

      // convert grid delta to world delta (gridToWorld is linear so this works)
      const worldDelta = gridToWorld(dc, dr);
      playerWorld.x += worldDelta.x;
      playerWorld.z += worldDelta.z;

      // derive grid from world (do not move grid directly from input)
      const derivedGrid = worldToGrid(playerWorld);

      // update player grid from derived world position
      playerGrid.c = derivedGrid.c;
      playerGrid.r = derivedGrid.r;

      // check chunk transitions and stream chunks when player moves between chunks
      const currentChunk = gridToChunk(playerGrid.c, playerGrid.r);
      if (!prevChunk || currentChunk.cx !== prevChunk.cx || currentChunk.cy !== prevChunk.cy) {
        ensureChunksAround(currentChunk.cx, currentChunk.cy);
        prevChunk = currentChunk;
      }

      // Get the integer grid coordinate the player is currently over
      const pc = Math.round(playerGrid.c);
      const pr = Math.round(playerGrid.r);
      const pcx = Math.floor(pc / CHUNK_SIZE);
      const pcy = Math.floor(pr / CHUNK_SIZE);
      
      let targetY = 1; // Fallback height
      
      // Look up the actual tile from our loaded chunks
      const chunkData = chunks.get(chunkKey(pcx, pcy));
      if (chunkData) {
        const tile = chunkData.tiles.get(`${pc},${pr}`);
        if (tile) {
          // The terrain is at `tile.height`.
          // The cube is 2 units tall, and its origin is in the middle.
          // To make the bottom of the cube touch the ground, we add 1.
          targetY = tile.height + 1; 
        }
      }

      // smooth move the cube towards target world position
      const lerpFactor = Math.min(1, 10 * dt);
      cube.position.x = THREE.MathUtils.lerp(cube.position.x, playerWorld.x, lerpFactor);
      cube.position.z = THREE.MathUtils.lerp(cube.position.z, playerWorld.z, lerpFactor);

      // SMOOTHLY LERP THE Y POSITION FOR CLIMBING
      cube.position.y = THREE.MathUtils.lerp(cube.position.y, targetY, lerpFactor);

      // make camera follow player smoothly (lerp X/Z towards player + offset)
      const targetCamX = playerWorld.x + cameraOffset.x;
      const targetCamZ = playerWorld.z + cameraOffset.z;
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, Math.min(1, 5 * dt));
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, Math.min(1, 5 * dt));
      // MAKE CAMERA FOLLOW THE VERTICAL MOVEMENT
      camera.position.y = cube.position.y + cameraOffset.y;
      camera.lookAt(playerWorld.x, cube.position.y, playerWorld.z);

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
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
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