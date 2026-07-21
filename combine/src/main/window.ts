import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dirnameHere = fileURLToPath(new URL('.', import.meta.url))

/**
 * Единственное окно приложения (single-window, см. GenerationSession) — но окно может быть
 * закрыто и пересоздано (macOS: клик по доку после закрытия всех окон вызывает 'activate').
 * IPC-хендлеры регистрируются ОДИН раз при старте приложения (см. index.ts, issue #5 второго
 * ревью — ipcMain.handle бросает при повторной регистрации того же канала), но им всё равно нужно
 * форвардить события В ТЕКУЩЕЕ окно, которое может смениться после пересоздания. getCurrentWindow()
 * — единственный источник истины "какое окно сейчас актуально", вместо window-параметра,
 * захваченного в замыкании один раз при первой регистрации (тот параметр становился ссылкой на
 * уничтоженный BrowserWindow после закрытия окна).
 */
let currentWindow: BrowserWindow | null = null

export function getCurrentWindow(): BrowserWindow | null {
  return currentWindow && !currentWindow.isDestroyed() ? currentWindow : null
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Combine — генератор аудио-уроков испанского',
    webPreferences: {
      preload: join(dirnameHere, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  currentWindow = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (currentWindow === win) currentWindow = null
  })

  // Внешние ссылки (напр. preview_url голоса) — в системном браузере, не в самом окне приложения.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(dirnameHere, '../renderer/index.html'))
  }

  return win
}
