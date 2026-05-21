'use strict';

/**
 * Electron Preload Script — Mr_Ed' Sampling Suite
 *
 * This script runs in a sandboxed context before the renderer process loads.
 * It exposes a minimal, controlled API via contextBridge so the renderer
 * cannot access Node.js internals directly (security best practice).
 *
 * Currently the app is 100% client-side (no Node.js calls needed),
 * so this file is a clean security boundary placeholder.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // App version from package.json — useful for "About" dialogs
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Platform detection — lets the renderer know it's running inside Electron
  platform: process.platform,
  isElectron: true,
});
