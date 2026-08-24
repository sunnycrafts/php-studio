'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('studio', {
  appInfo: invoke('app:info'),
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  setTheme: invoke('theme:set'),

  openProjectDialog: invoke('dialog:openProject'),
  openFileDialog: invoke('dialog:openFile'),
  saveAsDialog: invoke('dialog:saveAs'),
  newProjectDialog: invoke('dialog:newProject'),

  tree: invoke('fs:tree'),
  read: invoke('fs:read'),
  write: invoke('fs:write'),
  exists: invoke('fs:exists'),
  mkdir: invoke('fs:mkdir'),
  rename: invoke('fs:rename'),
  trash: invoke('fs:trash'),
  copy: invoke('fs:copy'),
  writeNew: invoke('fs:writeNew'),
  flatList: invoke('fs:flatList'),

  reveal: invoke('app:reveal'),
  openExternal: invoke('app:openExternal'),
  copyToClipboard: invoke('app:clipboard'),

  backupList: invoke('backup:list'),
  backupRead: invoke('backup:read'),
  autosaveBackup: invoke('backup:autosave'),
  projectBackup: invoke('backup:projectOpen'),
  changelogAppend: invoke('changelog:append'),
  changelogPath: invoke('changelog:path'),
  openPath: invoke('app:openPath'),
  pickImage: invoke('image:pick'),
  pickImagePath: invoke('image:pickPath'),
  pluginZip: invoke('plugin:zip'),
  wpActivate: invoke('wp:activate'),

  searchProject: invoke('search:project'),
  previewUpdate: invoke('preview:update'),
  previewStop: invoke('preview:stop'),

  ftpTest: invoke('ftp:test'),
  ftpUpload: invoke('ftp:upload'),

  onThemeChanged: (cb) => ipcRenderer.on('theme:changed', (e, dark) => cb(dark)),
  onPhpLog: (cb) => ipcRenderer.on('php:log', (e, s) => cb(s)),
  onFtpProgress: (cb) => ipcRenderer.on('ftp:progress', (e, p) => cb(p)),
  onFtpFileDone: (cb) => ipcRenderer.on('ftp:file-done', (e, p) => cb(p)),
  onMaximized: (cb) => ipcRenderer.on('window:maximized', (e, m) => cb(m)),
});
