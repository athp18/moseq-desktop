import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
const BACKEND_PORT = 8765

function findPython(): string {
  // In production, use bundled env. In dev, use system python.
  const bundledPython = join(process.resourcesPath, 'backend', 'env', 'bin', 'python')
  if (existsSync(bundledPython)) return bundledPython

  // Fall back to conda env or system python
  const condaEnvPython = join(process.env.CONDA_PREFIX || '', 'bin', 'python')
  if (existsSync(condaEnvPython)) return condaEnvPython

  return 'python3'
}

function startBackend(): void {
  const python = findPython()
  const backendDir = app.isPackaged
    ? join(process.resourcesPath, 'backend')
    : join(app.getAppPath(), 'backend')

  const useMock = !app.isPackaged && process.env['MOSEQ_MOCK'] === '1'
  const scriptPath = join(backendDir, useMock ? 'mock_main.py' : 'main.py')

  backendProcess = spawn(python, [scriptPath, '--port', String(BACKEND_PORT)], {
    cwd: backendDir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  })

  backendProcess.stdout?.on('data', (data) => {
    console.log('[backend]', data.toString().trim())
  })

  backendProcess.stderr?.on('data', (data) => {
    console.error('[backend]', data.toString().trim())
  })

  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`)
  })
}

function stopBackend(): void {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
}

async function waitForBackend(maxWaitMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await fetch(`http://localhost:${BACKEND_PORT}/health`)
      if (resp.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('Backend failed to start')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  startBackend()
  try {
    await waitForBackend()
  } catch (err) {
    console.error('Backend did not start:', err)
  }
  createWindow()
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// IPC: open directory dialog
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

// Expose backend port to renderer
ipcMain.handle('backend:port', () => BACKEND_PORT)
