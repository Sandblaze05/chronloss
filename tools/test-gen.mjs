#!/usr/bin/env node

import { generateWorld } from '../app/game/World.js';

function printWorld(world, width, height) {
  for (let r = 0; r < height; r++) {
    const row = [];
    for (let c = 0; c < width; c++) {
      const t = world.get(`${c},${r}`);
      row.push((t && typeof t.height === 'number') ? t.height : '?');
    }
    console.log(row.join(' '));
  }
}

const opts = {
  seed: 'demo-seed',
  scale: 12,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2,
  minHeight: 0,
  maxHeight: 6,
};

const world = generateWorld(16, 8, opts);
printWorld(world, 16, 8);
