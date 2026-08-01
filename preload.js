const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  download: (url, format) => ipcRenderer.invoke('download-video', { url, format }),
  selectFile: () => ipcRenderer.invoke('select-file'),
  trimFile: (data) => ipcRenderer.invoke('trim-file', data),
  convertFile: (data) => ipcRenderer.invoke('convert-file', data),
  onProgress: (callback) => {
    ipcRenderer.on('progress', (_, data) => callback(data));
  }
});