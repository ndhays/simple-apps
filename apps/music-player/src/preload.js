const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  readFolder: (p) => ipcRenderer.invoke('read-folder', p),
  readMetadata: (p) => ipcRenderer.invoke('read-metadata', p),
  onMediaKey: (cb) => ipcRenderer.on('media-key', (_, key) => cb(key)),
});
