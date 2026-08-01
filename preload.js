const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  download: (url, format, quality) => ipcRenderer.invoke('download-video', { url, format, quality }),
  selectFile: () => ipcRenderer.invoke('select-file'),
  trimFile: (data) => ipcRenderer.invoke('trim-file', data),
  convertFile: (data) => ipcRenderer.invoke('convert-file', data),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  cancelProcess: () => ipcRenderer.invoke('cancel-process'),
  fetchPreview: (url) => ipcRenderer.invoke('fetch-video-preview', url),
  onProgress: (callback) => {
    ipcRenderer.removeAllListeners('progress');
    ipcRenderer.on('progress', (_, data) => callback(data));
  }
});