const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 680,
    minWidth: 380,
    minHeight: 500,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  // Media key support
  globalShortcut.register('MediaPlayPause', () => mainWindow?.webContents.send('media-key', 'playpause'));
  globalShortcut.register('MediaNextTrack', () => mainWindow?.webContents.send('media-key', 'next'));
  globalShortcut.register('MediaPreviousTrack', () => mainWindow?.webContents.send('media-key', 'prev'));
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('read-folder', async (event, folderPath) => {
  const exts = ['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.aac'];
  function readRecursive(dir) {
    let results = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = entries
        .filter(e => e.isFile() && exts.includes(path.extname(e.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map(e => ({ name: e.name, path: path.join(dir, e.name) }));
      results = results.concat(files);
      const subdirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const subdir of subdirs) {
        results = results.concat(readRecursive(path.join(dir, subdir.name)));
      }
    } catch (e) {}
    return results;
  }
  return readRecursive(folderPath);
});

ipcMain.handle('read-metadata', async (event, filePath) => {
  try {
    const mm = require('music-metadata');
    const meta = await mm.parseFile(filePath, { duration: true });
    const tags = meta.common;
    let albumArt = null;
    if (tags.picture && tags.picture.length > 0) {
      const pic = tags.picture[0];
      albumArt = `data:${pic.format};base64,${pic.data.toString('base64')}`;
    }
    const rawDuration = meta.format?.duration;
    const duration = rawDuration != null && Number.isFinite(Number(rawDuration))
      ? Number(rawDuration)
      : null;
    return {
      title: tags.title || null,
      artist: tags.artist || null,
      album: tags.album || null,
      duration,
      albumArt
    };
  } catch (e) {
    return { title: null, artist: null, album: null, duration: null, albumArt: null };
  }
});
