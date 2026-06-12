import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('windApi', {
  getWindData: () => ipcRenderer.invoke('wind:get'),
  fetchWind: (forecastHour: number) => ipcRenderer.invoke('wind:fetch', { forecastHour }),
});
