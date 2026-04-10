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
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : []
  const chunkSize = Number(payload.chunkSize) || CHUNK_SIZE
  const options = payload.options || DEFAULT_WORLD_OPTIONS
  const MAX_JOBS_PER_CALL = 4
  const cappedJobs = jobs.slice(0, MAX_JOBS_PER_CALL)

  return cappedJobs.map((job) => {
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
})

ipcMain.handle('ecs:init', async (event, payload = {}) => {
  const session = ensureEcsSession(event, payload.position || {})
  return {
    index: session.index,
    position: session.position,
  }
})

ipcMain.on('ecs:setVelocity', (event, payload = {}) => {
  const session = ensureEcsSession(event)
  session.velocity.x = Number(payload.vx) || 0
  session.velocity.y = Number(payload.vy) || 0
  session.velocity.z = Number(payload.vz) || 0
})

ipcMain.on('ecs:stop', (event) => {
  stopEcsSession(event.sender.id)
})

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
