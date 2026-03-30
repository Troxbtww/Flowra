import { app, BrowserWindow, ipcMain, dialog, globalShortcut, desktopCapturer, session, Tray, Menu, nativeImage, screen, type NativeImage } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { config } from 'dotenv'
import {
  handleAnalyze,
  handleLiveAnalyze,
  handleParseTranscript,
  handlePractice,
  handleTranscribeAudio,
  handleGenerateStyles,
  handleAbortSession
} from './api'

const envPaths = [
  join(__dirname, '../../.env'),
  join(process.cwd(), '.env'),
  join(app.getAppPath(), '.env')
]

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath })
    console.log('[Flowra] Loaded .env from:', envPath)
    break
  }
}

let mainWindow: BrowserWindow | null = null
let isOverlayMode = false
let liveHotkeysRegistered = false
let tray: Tray | null = null
let isQuitting = false

const OVERLAY_WIDTH = 640
const OVERLAY_HEIGHT = 300

function trayIcon(): NativeImage {
  const candidates = [
    join(__dirname, '../../resources/tray.png'),
    join(process.cwd(), 'resources/tray.png')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZUlEQVQ4T2NkoBAwUqifwYAA/wEYA7oIgx4YI7oMwxgYA7oIwwgYg7oIIwgYg7oIIxAYg7oIIwAYg7oIEwgYg7oIExgYg7oIEwgYw7oICxgYw7oIixgYQ7sIDDAwhnYRWGBgDI0iADAeI/X7fLhCAAAAAElFTkSuQmCC'
  )
}

function applyOverlayLayout(win: BrowserWindow): void {
  isOverlayMode = true
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setSize(OVERLAY_WIDTH, OVERLAY_HEIGHT)
  const { workAreaSize } = screen.getPrimaryDisplay()
  win.setPosition(
    Math.round((workAreaSize.width - OVERLAY_WIDTH) / 2),
    20
  )
}

function applyNormalLayout(win: BrowserWindow): void {
  isOverlayMode = false
  win.setAlwaysOnTop(false)
  win.setIgnoreMouseEvents(false)
  win.setSize(1200, 800)
  win.center()
}

function rebuildTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(buildTrayMenu())
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open Flowra',
      click: () => {
        if (!mainWindow) return
        mainWindow.show()
        mainWindow.focus()
        applyNormalLayout(mainWindow)
        mainWindow.webContents.send('navigate-view', { view: 'home' })
        mainWindow.webContents.send('sync-overlay', { overlay: false })
      }
    },
    {
      label: 'Show live transcript (Ctrl+Alt+F)',
      click: () => showLiveTranscriptWindow()
    },
    {
      label: 'Return to Live Assist',
      click: () => {
        if (!mainWindow) return
        mainWindow.show()
        mainWindow.focus()
        applyOverlayLayout(mainWindow)
        mainWindow.webContents.send('navigate-view', { view: 'live' })
        mainWindow.webContents.send('sync-overlay', { overlay: true })
      }
    },
    { type: 'separator' },
    {
      label: 'Pause / Resume (Ctrl+Y)',
      click: () => {
        mainWindow?.webContents.send('hotkey-pause-resume')
      }
    },
    {
      label: 'Quick Read (Ctrl+U)',
      click: () => handleCtrlUToggle()
    },
    {
      label: 'End meeting & review (Shift+Ctrl+Y)',
      click: () => handleEndSessionShortcut()
    },
    { type: 'separator' },
    {
      label: 'Quit Flowra',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
}

function ensureTray(): void {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('Flowra')
  rebuildTrayMenu()
  tray.on('double-click', () => {
    if (!mainWindow) return
    if (!mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 300,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    },
    title: 'Flowra',
    transparent: true,
    frame: false
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (e) => {
    if (isQuitting || !tray) return
    e.preventDefault()
    mainWindow?.hide()
  })
}

ipcMain.handle('analyze-conversation', async (_event, text: string) => {
  return handleAnalyze(text)
})

ipcMain.handle('evaluate-practice', async (_event, originalTurn: string, context: string, rewrite: string) => {
  return handlePractice(originalTurn, context, rewrite)
})

ipcMain.handle('generate-styles', async (_event, originalTurn: string, context: string) => {
  return handleGenerateStyles(originalTurn, context)
})

ipcMain.handle('live-analyze', async (_event, conversationSoFar: string, latestMessage: string) => {
  return handleLiveAnalyze(conversationSoFar, latestMessage)
})

ipcMain.handle('parse-transcript', async (_event, rawText: string) => {
  return handleParseTranscript(rawText)
})

ipcMain.handle('transcribe-audio', async (_event, base64Audio: string, mimeType: string, meta?: any) => {
  return handleTranscribeAudio(base64Audio, mimeType, meta)
})

ipcMain.handle('abort-session', async (_event, sessionId: string) => {
  return handleAbortSession(sessionId)
})

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Transcripts', extensions: ['txt', 'vtt', 'srt', 'csv', 'json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'No file selected' }
  }

  try {
    const content = readFileSync(result.filePaths[0], 'utf-8')
    const filename = result.filePaths[0].split(/[/\\]/).pop() || 'transcript'
    return { success: true, data: { content, filename } }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 }
    })
    return { success: true, data: sources.map(s => ({ id: s.id, name: s.name })) }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('register-live-hotkeys', async () => {
  if (liveHotkeysRegistered) return { success: true }

  try {
    globalShortcut.register('CommandOrControl+Y', () => {
      mainWindow?.webContents.send('hotkey-pause-resume')
    })
    globalShortcut.register('CommandOrControl+U', () => {
      handleCtrlUToggle()
    })
    liveHotkeysRegistered = true
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('unregister-live-hotkeys', async () => {
  try {
    globalShortcut.unregister('CommandOrControl+Y')
    globalShortcut.unregister('CommandOrControl+U')
    liveHotkeysRegistered = false
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('meeting-bootstrap', async () => {
  if (!mainWindow) return { success: false }
  ensureTray()
  applyOverlayLayout(mainWindow)
  mainWindow.webContents.send('sync-overlay', { overlay: true })
  mainWindow.hide()
  return { success: true, data: { overlay: true } }
})

ipcMain.handle('show-main-window', async () => {
  if (!mainWindow) return { success: false }
  ensureTray()
  mainWindow.show()
  mainWindow.focus()
  applyNormalLayout(mainWindow)
  mainWindow.webContents.send('sync-overlay', { overlay: false })
  return { success: true }
})

ipcMain.handle('quit-app', async () => {
  isQuitting = true
  app.quit()
  return { success: true }
})

ipcMain.handle('toggle-overlay', async () => {
  if (!mainWindow) return { success: false }

  if (isOverlayMode) {
    applyNormalLayout(mainWindow)
  } else {
    applyOverlayLayout(mainWindow)
  }

  mainWindow.webContents.send('sync-overlay', { overlay: isOverlayMode })
  return { success: true, data: isOverlayMode }
})

ipcMain.handle('set-always-on-top', async (_event, onTop: boolean) => {
  if (!mainWindow) return { success: false }
  mainWindow.setAlwaysOnTop(onTop, 'floating')
  return { success: true }
})

ipcMain.handle('backup-transcript', async (_event, text: string) => {
  try {
    const dir = join(app.getPath('userData'), 'transcript-backups')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = join(dir, `session-${stamp}.txt`)
    writeFileSync(filePath, text, 'utf-8')
    return { success: true, data: { path: filePath } }
  } catch (err: any) {
    console.error('[Flowra] backup-transcript', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('backup-live-session', async (_event, payload: unknown) => {
  try {
    const dir = join(app.getPath('userData'), 'live-session-backups')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = join(dir, `live-session-${stamp}.json`)
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return { success: true, data: { path: filePath } }
  } catch (err: any) {
    console.error('[Flowra] backup-live-session', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('window-minimize', async () => {
  if (!mainWindow) return { success: false }
  mainWindow.minimize()
  return { success: true }
})

ipcMain.handle('window-maximize', async () => {
  if (!mainWindow) return { success: false }
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
  return { success: true }
})

ipcMain.handle('window-close', async () => {
  if (!mainWindow) return { success: false }
  mainWindow.hide() // hiding instead of closing since it's a tray app
  return { success: true }
})

/** Full Live Assist window with transcript (not overlay). */
function showLiveTranscriptWindow(): void {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
  applyNormalLayout(mainWindow)
  mainWindow.webContents.send('navigate-view', { view: 'live' })
  mainWindow.webContents.send('sync-overlay', { overlay: false })
  mainWindow.webContents.send('show-live-transcript')
}

/** Ctrl+U: toggle overlay visibility and quick analysis. */
function handleCtrlUToggle(): void {
  if (!mainWindow) return

  if (!mainWindow.isVisible() || !isOverlayMode) {
    // Show overlay and trigger quick analysis
    applyOverlayLayout(mainWindow)
    mainWindow.show()
    mainWindow.webContents.send('sync-overlay', { overlay: true })
    mainWindow.webContents.send('hotkey-quick-analysis')
  } else {
    // Hide overlay and dismiss quick panel
    mainWindow.hide()
    mainWindow.webContents.send('hotkey-overlay-toggle')
  }
}

/** Shift+Ctrl+Y: end session, restore window, trigger analysis. */
function handleEndSessionShortcut(): void {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
  applyNormalLayout(mainWindow)
  mainWindow.webContents.send('sync-overlay', { overlay: false })
  mainWindow.webContents.send('hotkey-end-session')
}

function registerMeetingEndShortcut(): void {
  globalShortcut.register('Shift+CommandOrControl+Y', () => {
    handleEndSessionShortcut()
  })

  globalShortcut.register('CommandOrControl+Alt+F', () => {
    showLiveTranscriptWindow()
  })
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(true)
  })

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' })
      }
    })
  })

  createWindow()
  ensureTray()

  mainWindow?.once('ready-to-show', () => {
    // Start hidden — the renderer will auto-bootstrap into live mode
    // and call meetingBootstrap() which applies overlay layout and hides the window.
    // Do NOT show the window here to avoid a flash.
  })

  registerMeetingEndShortcut()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit()
  }
})

