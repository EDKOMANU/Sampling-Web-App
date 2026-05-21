'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// ── Security: disable remote module ──────────────────────────────────────────
app.disableHardwareAcceleration(); // optional: reduce GPU usage on low-end machines

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Mr_Ed' Sampling Suite",
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#09090b', // matches app dark background
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    // Start maximized for a full data-analysis experience
    show: false,
  });

  // Load the Vite-built static site from disk
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  mainWindow.loadFile(indexPath);

  // Show window once it's ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Application Menu ──────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: "Mr_Ed' Sampling Suite",
      submenu: [
        { label: 'About Mr_Ed\' Sampling Suite', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'toggleMaximize' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Methodology Hub',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(
                "document.dispatchEvent(new CustomEvent('open-methodology-hub'))"
              );
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/EDKOMANU/Sampling-Web-App/issues'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // On Windows/Linux, quit when all windows are closed
  if (process.platform !== 'darwin') app.quit();
});
