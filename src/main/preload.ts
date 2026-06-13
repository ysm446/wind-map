import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('windApi', {
  getWindData: () => ipcRenderer.invoke('wind:get'),
  fetchWind: (forecastHour: number) => ipcRenderer.invoke('wind:fetch', { forecastHour }),
  fetchArchiveWind: (time: string) => ipcRenderer.invoke('wind:fetch-archive', { time }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
  // 風データDB
  dbList: () => ipcRenderer.invoke('db:list'),
  dbGet: (id: string) => ipcRenderer.invoke('db:get', id),
  dbGetFrame: (id: string, index: number) =>
    ipcRenderer.invoke('db:get-frame', { id, index }),
  dbDelete: (id: string) => ipcRenderer.invoke('db:delete', id),
  dbRename: (id: string, name: string) => ipcRenderer.invoke('db:rename', { id, name }),
  dbBuild: (opts: unknown) => ipcRenderer.invoke('db:build', opts),
  onBuildProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('db:build-progress', listener);
    return () => ipcRenderer.removeListener('db:build-progress', listener);
  },
});
