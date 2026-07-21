import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc-handlers'

// Один экземпляр приложения — вторая попытка запуска просто активирует существующее окно.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    // «Combine 1.1.0» в нативном macOS-диалоге «About Combine» (меню приложения) — версия читается
    // из package.json через app.getVersion(), а не хардкожена здесь (см. docs/DECISIONS.md — v1.1).
    app.setAboutPanelOptions({
      applicationName: 'Combine',
      applicationVersion: app.getVersion(),
      version: app.getVersion()
    })

    createMainWindow()
    // Регистрируем ОДИН раз за жизнь процесса — ipcMain.handle бросает "Attempted to register
    // a second handler for ..." при повторном вызове. Раньше registerIpcHandlers() дублировался
    // здесь и в 'activate', и стандартный macOS-флоу «закрыл окно → кликнул по доку» ронял
    // приложение (issue #5 второго ревью). Хендлеры сами берут АКТУАЛЬНОЕ окно через
    // window.ts#getCurrentWindow() — не нуждаются в window-параметре, привязанном к конкретному
    // (возможно, уже уничтоженному) экземпляру BrowserWindow.
    registerIpcHandlers()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
