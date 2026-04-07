import { CHUNK_SIZE, DEFAULT_WORLD_OPTIONS } from '../renderer/lib/engine/World.js';
import { fbm2D, generateBiomeAt } from '../renderer/lib/engine/Noise.js';

async function main() {
  const argv = process.argv.slice(2);
  const cx = Number(argv[0] || 0);
  const cy = Number(argv[1] || 0);
  const chunkSize = Number(argv[2] || CHUNK_SIZE);
  const seedArg = argv[3];

  const opts = { ...DEFAULT_WORLD_OPTIONS };
  if (typeof seedArg !== 'undefined') {
    opts.seed = isNaN(Number(seedArg)) ? seedArg : Number(seedArg);
  }

  console.log(`Generating chunk at cx=${cx}, cy=${cy}, size=${chunkSize}, seed=${opts.seed}`);

  const heights = new Array(chunkSize * chunkSize);
  const biomes = new Array(chunkSize * chunkSize);

  let i = 0;
  for (let r = 0; r < chunkSize; r++) {
    for (let c = 0; c < chunkSize; c++) {
      const col = cx * chunkSize + c;
      const row = cy * chunkSize + r;
      let n = fbm2D(col, row, opts);
      n = Math.pow(n, opts.exponent || 1.0);
      const h = Math.round((opts.minHeight || 0) + n * ((opts.maxHeight || 3) - (opts.minHeight || 0))) * (opts.blockHeight || 1);
      heights[i] = h;
      biomes[i] = generateBiomeAt(col, row, n, opts);
      i++;
    }
  }

  // Print heights grid
  console.log('\nHeights:');
  for (let r = 0; r < chunkSize; r++) {
    const row = [];
    for (let c = 0; c < chunkSize; c++) {
      const v = heights[r * chunkSize + c];
      row.push(String(v).padStart(3, ' '));
    }
    console.log(row.join(' '));
  }

  // Print biomes grid (single-letter legend)
  const legend = { water: 'W', sand: 'S', grass: 'g', forest: 'F', desert: 'D', stone: 'R', snow: '^' };
  console.log('\nBiomes:');
  for (let r = 0; r < chunkSize; r++) {
    const row = [];
    for (let c = 0; c < chunkSize; c++) {
      const b = biomes[r * chunkSize + c] || '?';
      row.push(legend[b] || '?');
    }
    console.log(row.join(''));
  }

  // Count biomes
  const counts = {};
  for (const b of biomes) counts[b] = (counts[b] || 0) + 1;

  console.log('\nBiome counts:');
  for (const [k, v] of Object.entries(counts)) console.log(`${k}: ${v}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
