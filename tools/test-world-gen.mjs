import { BLOCK_IDS, CHUNK_SIZE, DEFAULT_WORLD_OPTIONS, voxelIndex } from '../renderer/lib/engine/World.js';
import { generateChunkData } from '../renderer/lib/engine/ChunkGeneration.js';

function charForBlock(blockId) {
  switch (blockId) {
    case BLOCK_IDS.AIR: return ' ';
    case BLOCK_IDS.STONE: return '#';
    case BLOCK_IDS.DIRT: return 'd';
    case BLOCK_IDS.GRASS: return 'g';
    case BLOCK_IDS.SAND: return 's';
    case BLOCK_IDS.WATER: return '~';
    case BLOCK_IDS.SNOW: return '^';
    case BLOCK_IDS.DESERT: return 'D';
    case BLOCK_IDS.FOREST: return 'F';
    case BLOCK_IDS.LAVA: return 'L';
    default: return '?';
  }
}

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

  const localChunkHeight = Number(opts.chunkHeight || DEFAULT_WORLD_OPTIONS.chunkHeight);
  const { blocks } = generateChunkData(cx, cy, chunkSize, localChunkHeight, opts);

  const topHeights = new Array(chunkSize * chunkSize).fill(-1);
  const topBlocks = new Array(chunkSize * chunkSize).fill(BLOCK_IDS.AIR);
  let waterVoxels = 0;

  for (let z = 0; z < chunkSize; z++) {
    for (let x = 0; x < chunkSize; x++) {
      const colIdx = z * chunkSize + x;
      let topY = -1;
      let topBlock = BLOCK_IDS.AIR;
      for (let y = localChunkHeight - 1; y >= 0; y--) {
        const idx = voxelIndex(x, y, z, chunkSize, localChunkHeight);
        const block = blocks[idx];
        if (block === BLOCK_IDS.WATER) waterVoxels++;
        if (topY === -1 && block !== BLOCK_IDS.AIR) {
          topY = y;
          topBlock = block;
        }
      }

      topHeights[colIdx] = topY;
      topBlocks[colIdx] = topBlock;
    }
  }

  console.log('\nTop Surface Height Map:');
  for (let z = 0; z < chunkSize; z++) {
    const row = [];
    for (let x = 0; x < chunkSize; x++) {
      const y = topHeights[z * chunkSize + x];
      row.push(String(y).padStart(3, ' '));
    }
    console.log(row.join(' '));
  }

  console.log('\nTop Surface Material Map:');
  for (let z = 0; z < chunkSize; z++) {
    const row = [];
    for (let x = 0; x < chunkSize; x++) {
      row.push(charForBlock(topBlocks[z * chunkSize + x]));
    }
    console.log(row.join(''));
  }

  const totalVoxels = chunkSize * chunkSize * localChunkHeight;
  const waterRatio = totalVoxels > 0 ? (waterVoxels / totalVoxels) : 0;
  console.log('\nMetrics:');
  console.log(`Sea level: ${opts.seaLevel ?? Math.floor(localChunkHeight * 0.28)}`);
  console.log(`Water voxels: ${waterVoxels} (${(waterRatio * 100).toFixed(2)}%)`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
