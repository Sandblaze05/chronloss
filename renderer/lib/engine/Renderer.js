import * as THREE from 'three';
import { gridToWorld } from './GridMath.js';

// Base materials (tintable)
// floorMat.vertexColors = true;
const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, flatShading: true });
const wallMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide, flatShading: true });
const lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });

// Biome palette (THREE.Color instances)
const BIOME_COLORS = {
    water: new THREE.Color(0x1a75ff),
    sand: new THREE.Color(0xe6d690),
    grass: new THREE.Color(0x5ca832),
    forest: new THREE.Color(0x2d6614),
    desert: new THREE.Color(0xd2b48c),
    stone: new THREE.Color(0x737373),
    snow: new THREE.Color(0xffffff),
};
const FALLBACK_COLOR = new THREE.Color(0xff00ff);

export function buildChunkMeshes(scene, chunk, tileGeom, xOffset, yOffset) {
    // Count terrain vs walls
    let terrainCount = 0;
    let wallCount = 0;
    for (const tile of chunk.tiles.values()) {
        if (tile.type === 'wall') wallCount++;
        else terrainCount++;
    }

    const instancedMeshes = [];
    const matrix = new THREE.Matrix4();

    // Terrain instanced mesh (single draw call, per-instance colors)
    if (terrainCount > 0) {
        const terrainInst = new THREE.InstancedMesh(tileGeom, floorMat, terrainCount);
        terrainInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        let i = 0;
        for (const tile of chunk.tiles.values()) {
            if (tile.type === 'wall') continue;
            const pos = gridToWorld(tile.col - xOffset, tile.row - yOffset);
            const heightScale = Math.max(0.1, tile.height);
            matrix.identity();
            matrix.makeTranslation(pos.x, 0, pos.z);
            matrix.scale(new THREE.Vector3(1, heightScale, 1));
            terrainInst.setMatrixAt(i, matrix);

            // Set color by biome
            const color = BIOME_COLORS[tile.type] || FALLBACK_COLOR;
            terrainInst.setColorAt(i, color);
            i++;
        }
        terrainInst.instanceMatrix.needsUpdate = true;
        if (terrainInst.instanceColor) terrainInst.instanceColor.needsUpdate = true;
        scene.add(terrainInst);
        instancedMeshes.push(terrainInst);
    }

    // Walls (kept separate for now)
    if (wallCount > 0) {
        const wallInst = new THREE.InstancedMesh(tileGeom, wallMat, wallCount);
        wallInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        let wi = 0;
        for (const tile of chunk.tiles.values()) {
            if (tile.type !== 'wall') continue;
            const pos = gridToWorld(tile.col - xOffset, tile.row - yOffset);
            const heightScale = Math.max(0.1, tile.height);
            matrix.identity();
            matrix.makeTranslation(pos.x, 0, pos.z);
            matrix.scale(new THREE.Vector3(1, heightScale, 1));
            wallInst.setMatrixAt(wi++, matrix);
        }
        wallInst.instanceMatrix.needsUpdate = true;
        scene.add(wallInst);
        instancedMeshes.push(wallInst);
    }

    // Attach the instanced meshes to the chunk for later reference / disposal
    chunk.instancedMeshes = instancedMeshes;
}

export function disposeChunkMeshes(scene, chunk) {
    if (chunk.instancedMeshes) {
        for (const m of chunk.instancedMeshes) {
            if (!m) continue;
            scene.remove(m);
            // Do not dispose shared geometry/material here - they are owned by the renderer/scene creator
        }
        chunk.instancedMeshes = undefined;
    }
}