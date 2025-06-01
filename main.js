const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
require('dotenv').config();

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // Allow loading local files
    }
  });

  win.loadFile('index.html');
}

// Register protocol for local files
app.whenReady().then(() => {
  protocol.registerFileProtocol('file', (request, callback) => {
    try {
      const url = request.url.substr(7);
      const decodedUrl = decodeURI(url);
      callback({ path: decodedUrl });
    } catch (error) {
      console.error('Error handling file protocol:', error);
    }
  });
  
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('open-file-dialog', (event) => {
  dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDFs', extensions: ['pdf'] }]
  }).then(result => {
    if (!result.canceled) {
      event.reply('selected-file', result.filePaths[0]);
    }
  }).catch(err => {
    console.log(err);
  });
}); 