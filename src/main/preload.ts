import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('windApi', {
  getWindData: () => ipcRenderer.invoke('wind:get'),
  fetchWind: (forecastHour: number) => ipcRenderer.invoke('wind:fetch', { forecastHour }),
  fetchArchiveWind: (time: string) => ipcRenderer.invoke('wind:fetch-archive', { time }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
});
