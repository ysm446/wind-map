import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('windApi', {
  getWindData: () => ipcRenderer.invoke('wind:get'),
});
