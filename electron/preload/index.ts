import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('moseq', {
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),
  getBackendPort: (): Promise<number> =>
    ipcRenderer.invoke('backend:port')
})
