import * as THREE from 'three';
import { gridToWorld } from './GridMath.js';

const floorMat = new THREE.MeshStandardMaterial({ color: 0x666666, side: THREE.DoubleSide, flatShading: true, roughness: 1, metalness: 0 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide, flatShading: true, roughness: 1, metalness: 0 });
const lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });

export function buildChunkMeshes(scene, chunk, tileGeom, xOffset, yOffset) {
    const sharedEdges = new THREE.EdgesGeometry(tileGeom);

    for (const tile of chunk.tiles.values()) {
        const mat = tile.type === 'floor' ? floorMat : wallMat;
        const mesh = new THREE.Mesh(tileGeom, mat);
        
        // 1. Calculate world X and Z
        const pos = gridToWorld(tile.col - xOffset, tile.row - yOffset);
        
        // 2. Position the mesh on the floor (Y = 0)
        mesh.position.set(pos.x, 0, pos.z);
        
        // 3. Stretch the cube upward to match the height!
        // We use Math.max to ensure water/flat levels (height 0) still render a tiny sliver so they are visible
        const heightScale = Math.max(0.1, tile.height);
        mesh.scale.set(1, heightScale, 1);
        
        mesh.userData = { col: tile.col, row: tile.row, actualHeight: tile.height };
        tile.mesh = mesh;
        scene.add(mesh);

        // 4. Add the outline edges
        const line = new THREE.LineSegments(sharedEdges, lineMat);
        // Copy the position and scale from the mesh perfectly
        line.position.copy(mesh.position);
        line.scale.copy(mesh.scale);
        tile.meshLine = line;
        scene.add(line);
    }
}

export function disposeChunkMeshes(scene, chunk) {
    for (const tile of chunk.tiles.values()) {
        if (tile.mesh) {
            scene.remove(tile.mesh);
            tile.mesh = undefined;
        }
        if (tile.meshLine) {
            scene.remove(tile.meshLine);
            if (tile.meshLine.geometry) tile.meshLine.geometry.dispose(); 
            tile.meshLine = undefined;
        }
    }
}