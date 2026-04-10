import path from 'path'
import { app, ipcMain, session } from 'electron'
// Improve GPU utilization: bypass GPU blocklist and enable GPU features.
// These switches must be set before the app initializes (before `whenReady`).
app.commandLine.appendSwitch('disable-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers')
// Experimental: enable WebGPU if supported by your Electron build
app.commandLine.appendSwitch('enable-unsafe-webgpu')
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window.js'
import { CHUNK_HEIGHT, CHUNK_SIZE, DEFAULT_WORLD_OPTIONS } from '../renderer/lib/engine/World.js'
import { generateChunkData } from '../renderer/lib/engine/ChunkGeneration.js'

const isProd = process.env.NODE_ENV === 'production'
const ecsSessions = new Map()

function toNodeBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

function decodeChunkRequestPayload(payload) {
  const bufferPayload = toNodeBuffer(payload)
  if (!bufferPayload) {
    return {
      jobs: Array.isArray(payload?.jobs) ? payload.jobs : [],
      chunkSize: Number(payload?.chunkSize) || CHUNK_SIZE,
      options: payload?.options || DEFAULT_WORLD_OPTIONS,
    }
  }

  if (bufferPayload.length < 8) {
    return {
      jobs: [],
      chunkSize: CHUNK_SIZE,
      options: DEFAULT_WORLD_OPTIONS,
    }
  }

  const dv = new DataView(bufferPayload.buffer, bufferPayload.byteOffset, bufferPayload.byteLength)
  const jobCount = dv.getUint32(0, true)
  const chunkSize = dv.getUint32(4, true) || CHUNK_SIZE
  const jobs = []
  let offset = 8

  for (let i = 0; i < jobCount; i += 1) {
    if (offset + 8 > dv.byteLength) break
    const cx = dv.getInt32(offset, true)
    const cy = dv.getInt32(offset + 4, true)
    jobs.push({ cx, cy })
    offset += 8
  }

  return {
    jobs,
    chunkSize,
    options: DEFAULT_WORLD_OPTIONS,
  }
}

function encodeChunkResultsBuffer(chunks) {
  const totalBytes = chunks.reduce((sum, chunk) => {
    const blocks = chunk.blocks || new Uint32Array(0)
    return sum + 20 + blocks.byteLength
  }, 8)

  const out = Buffer.allocUnsafe(totalBytes)
  let offset = 0
  out.writeUInt32LE(1, offset)
  offset += 4
  out.writeUInt32LE(chunks.length, offset)
  offset += 4

  for (const chunk of chunks) {
    const blocks = chunk.blocks || new Uint32Array(0)
    out.writeInt32LE(chunk.cx | 0, offset)
    offset += 4
    out.writeInt32LE(chunk.cy | 0, offset)
    offset += 4
    out.writeUInt32LE(chunk.chunkSize >>> 0, offset)
    offset += 4
    out.writeUInt32LE(chunk.chunkHeight >>> 0, offset)
    offset += 4
    out.writeUInt32LE(blocks.length >>> 0, offset)
    offset += 4

    const blocksBuffer = Buffer.from(blocks.buffer, blocks.byteOffset, blocks.byteLength)
    blocksBuffer.copy(out, offset)
    offset += blocksBuffer.length
  }

  return out
}

function decodeEcsInitPayload(payload) {
  const bufferPayload = toNodeBuffer(payload)
  if (!bufferPayload) {
    const position = payload?.position || {}
    return {
      x: Number(position.x) || 0,
      y: Number(position.y) || 1,
      z: Number(position.z) || 0,
    }
  }

  if (bufferPayload.length < 24) {
    return { x: 0, y: 1, z: 0 }
  }

  const dv = new DataView(bufferPayload.buffer, bufferPayload.byteOffset, bufferPayload.byteLength)
  return {
    x: dv.getFloat64(0, true),
    y: dv.getFloat64(8, true),
    z: dv.getFloat64(16, true),
  }
}

function encodeEcsInitResponse(session) {
  const out = Buffer.allocUnsafe(28)
  out.writeInt32LE(session.index | 0, 0)
  out.writeDoubleLE(Number(session.position.x) || 0, 4)
  out.writeDoubleLE(Number(session.position.y) || 1, 12)
  out.writeDoubleLE(Number(session.position.z) || 0, 20)
  return out
}

function decodeEcsVelocityPayload(payload) {
  const bufferPayload = toNodeBuffer(payload)
  if (!bufferPayload) {
    return {
      vx: Number(payload?.vx) || 0,
      vy: Number(payload?.vy) || 0,
      vz: Number(payload?.vz) || 0,
    }
  }

  if (bufferPayload.length < 12) {
    return { vx: 0, vy: 0, vz: 0 }
  }

  const dv = new DataView(bufferPayload.buffer, bufferPayload.byteOffset, bufferPayload.byteLength)
  return {
    vx: dv.getFloat32(0, true),
    vy: dv.getFloat32(4, true),
    vz: dv.getFloat32(8, true),
  }
}

function stopEcsSession(webContentsId) {
  const existing = ecsSessions.get(webContentsId)
  if (!existing) return
  clearInterval(existing.timer)
  ecsSessions.delete(webContentsId)
}

function ensureEcsSession(event, initialPosition = {}) {
  const webContentsId = event.sender.id
  const existing = ecsSessions.get(webContentsId)
  if (existing) return existing

  const state = {
    index: 0,
    position: {
      x: Number(initialPosition.x) || 0,
      y: Number(initialPosition.y) || 1,
      z: Number(initialPosition.z) || 0,
    },
    velocity: { x: 0, y: 0, z: 0 },
    lastBroadcastMs: 0,
    broadcastEveryMs: 16,
  }

  const dt = 1 / 60
  state.timer = setInterval(() => {
    state.position.x += state.velocity.x * dt
    state.position.y += state.velocity.y * dt
    state.position.z += state.velocity.z * dt

    const nowMs = Date.now()
    if (nowMs - state.lastBroadcastMs >= state.broadcastEveryMs) {
      state.lastBroadcastMs = nowMs
      if (!event.sender.isDestroyed()) {
        event.sender.send('ecs:state', {
          index: state.index,
          position: state.position,
          velocity: state.velocity,
          t: nowMs,
        })
      }
    }
  }, 1000 / 60)

  const onSenderDestroyed = () => {
    stopEcsSession(webContentsId)
  }
  event.sender.once('destroyed', onSenderDestroyed)

  ecsSessions.set(webContentsId, state)
  return state
}

if (process.env.CHRONLOSS_DISABLE_HIGH_PERF_GPU !== '1') {
  app.commandLine.appendSwitch('force_high_performance_gpu');
}

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

;(async () => {
  await app.whenReady()
  // Enable cross-origin isolation headers so SharedArrayBuffer is available
  // in the renderer. This adds COOP/COEP to all responses. On dev servers
  // (Next.js) this ensures the renderer becomes cross-origin isolated.
  try {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = Object.assign({}, details.responseHeaders || {});
      responseHeaders['Cross-Origin-Opener-Policy'] = ['same-origin'];
      responseHeaders['Cross-Origin-Embedder-Policy'] = ['require-corp'];
      callback({ responseHeaders });
    });
  } catch (e) {
    console.warn('Failed to attach COOP/COEP headers:', e);
  }

  const mainWindow = createWindow('main', {
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
    },
  })

  mainWindow.setMenuBarVisibility(false);

  if (isProd) {
    await mainWindow.loadURL('app://./')
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/`)
    mainWindow.webContents.openDevTools()
  }
})()

app.on('window-all-closed', () => {
  app.quit()
})

ipcMain.handle('world:generateChunks', async (_event, payload = {}) => {
  const decodedPayload = decodeChunkRequestPayload(payload)
  const jobs = decodedPayload.jobs
  const chunkSize = decodedPayload.chunkSize
  const options = decodedPayload.options
  const MAX_JOBS_PER_CALL = 4
  const cappedJobs = jobs.slice(0, MAX_JOBS_PER_CALL)

  const chunks = cappedJobs.map((job) => {
    const cx = Number(job?.cx) || 0
    const cy = Number(job?.cy) || 0
    const data = generateChunkData(cx, cy, chunkSize, CHUNK_HEIGHT, options)
    return {
      cx,
      cy,
      chunkSize,
      chunkHeight: data.chunkHeight,
      formatVersion: 2,
      blocks: data.blocks,
    }
  })

  return encodeChunkResultsBuffer(chunks)
})

ipcMain.handle('ecs:init', async (event, payload = {}) => {
  const initialPosition = decodeEcsInitPayload(payload)
  const session = ensureEcsSession(event, initialPosition)
  return encodeEcsInitResponse(session)
})

ipcMain.on('ecs:setVelocity', (event, payload = {}) => {
  const session = ensureEcsSession(event)
  const velocity = decodeEcsVelocityPayload(payload)
  session.velocity.x = velocity.vx
  session.velocity.y = velocity.vy
  session.velocity.z = velocity.vz
})

ipcMain.on('ecs:stop', (event) => {
  stopEcsSession(event.sender.id)
})

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
