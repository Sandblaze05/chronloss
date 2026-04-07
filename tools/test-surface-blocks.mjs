import { BLOCK_IDS, CHUNK_SIZE, DEFAULT_WORLD_OPTIONS } from '../renderer/lib/engine/World.js';
import { fbm2D, generateBiomeAt } from '../renderer/lib/engine/Noise.js';

const BLOCK_LABELS = {
  [BLOCK_IDS.AIR]: 'air',
  [BLOCK_IDS.STONE]: 'stone',
  [BLOCK_IDS.DIRT]: 'dirt',
  [BLOCK_IDS.GRASS]: 'grass',
  [BLOCK_IDS.SAND]: 'sand',
  [BLOCK_IDS.WATER]: 'water',
  [BLOCK_IDS.SNOW]: 'snow',
  [BLOCK_IDS.DESERT]: 'desert',
  [BLOCK_IDS.FOREST]: 'forest',
};

const BLOCK_GLYPHS = {
  [BLOCK_IDS.GRASS]: 'G',
  [BLOCK_IDS.SAND]: 'S',
  [BLOCK_IDS.WATER]: 'W',
  [BLOCK_IDS.SNOW]: '^',
  [BLOCK_IDS.DESERT]: 'D',
  [BLOCK_IDS.FOREST]: 'F',
};

function toSurfaceBlockId(biomeStr) {
  if (biomeStr === 'water') return BLOCK_IDS.WATER;
  if (biomeStr === 'sand') return BLOCK_IDS.SAND;
  if (biomeStr === 'snow') return BLOCK_IDS.SNOW;
  if (biomeStr === 'desert') return BLOCK_IDS.DESERT;
  if (biomeStr === 'forest') return BLOCK_IDS.FOREST;
  return BLOCK_IDS.GRASS;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    cx: Number(argv[0] || 0),
    cy: Number(argv[1] || 0),
    size: Number(argv[2] || CHUNK_SIZE),
    seedArg: argv[3],
  };
}

async function main() {
  const { cx, cy, size, seedArg } = parseArgs();
  const opts = { ...DEFAULT_WORLD_OPTIONS };

  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(size) || size <= 0) {
    throw new Error('Usage: node tools/test-surface-blocks.mjs [cx=0] [cy=0] [size=16] [seed]');
  }

  if (typeof seedArg !== 'undefined') {
    opts.seed = Number.isNaN(Number(seedArg)) ? seedArg : Number(seedArg);
  }

  const counts = {};
  const rows = [];

  console.log(`Surface block test: cx=${cx}, cy=${cy}, size=${size}, seed=${opts.seed}`);

  for (let z = 0; z < size; z++) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const col = cx * size + x;
      const row = cy * size + z;

      let n = fbm2D(col, row, opts);
      n = Math.pow(n, opts.exponent || 1.0);

      const biomeStr = generateBiomeAt(col, row, n, opts);
      const blockId = toSurfaceBlockId(biomeStr);
      const label = BLOCK_LABELS[blockId] || `unknown(${blockId})`;

      counts[label] = (counts[label] || 0) + 1;
      line += BLOCK_GLYPHS[blockId] || '?';
    }
    rows.push(line);
  }

  console.log('\nLegend: G=grass S=sand W=water ^=snow D=desert F=forest');
  console.log('Surface map:');
  for (const line of rows) {
    console.log(line);
  }

  console.log('\nSurface block counts:');
  for (const [name, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`${name}: ${count}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
