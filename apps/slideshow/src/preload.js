const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  readFolder: (folderPath) => ipcRenderer.invoke('read-folder', folderPath),
});
