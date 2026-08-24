/**
 * PHP Studio — Electron main process.
 * Window management, PHP preview server lifecycle, filesystem, FTP deploy,
 * settings persistence, project-wide search.
 */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');
const net = require('net');
const crypto = require('crypto');
const { Worker } = require('worker_threads');

let win = null;
let phpProc = null;
let phpPort = 0;
let phpDocroot = '';
let ctrlFile = '';

/* Per-run token: the preview server rejects requests without it, so other
 * local processes can't talk to the preview. */
const PREVIEW_TOKEN = crypto.randomBytes(16).toString('hex');

/* Instrumentation runs in a worker thread to keep the main process snappy. */
let instWorker = null;
let instSeq = 0;
const instPending = new Map();
function instrumentAsync(text) {
  if (!instWorker) {
    instWorker = new Worker(path.join(__dirname, 'instrument-worker.js'));
    instWorker.on('message', (m) => {
      const p = instPending.get(m.id);
      if (!p) return;
      instPending.delete(m.id);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
    });
    instWorker.on('error', (e) => {
      for (const p of instPending.values()) p.reject(e);
      instPending.clear();
      instWorker = null;
    });
  }
  return new Promise((resolve, reject) => {
    const id = ++instSeq;
    instPending.set(id, { resolve, reject });
    instWorker.postMessage({ id, text });
  });
}

const isPackaged = app.isPackaged;
const ROOT = path.join(__dirname, '..');

function phpExe() {
  return isPackaged
    ? path.join(process.resourcesPath, 'php', 'php.exe')
    : path.join(ROOT, 'php', 'php.exe');
}
/* The shim is read by php.exe — an external process that cannot see inside
 * the asar archive — so it ships as real files under resources/. */
function shimDir() {
  return isPackaged ? path.join(process.resourcesPath, 'shim') : path.join(ROOT, 'shim');
}
function samplesDir() {
  return isPackaged
    ? path.join(process.resourcesPath, 'samples')
    : path.join(ROOT, 'samples');
}
function previewDir() {
  const d = path.join(app.getPath('userData'), 'preview');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/* ── Settings ─────────────────────────────────────────── */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); }
  catch (e) { settings = {}; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) {}
}

/* ── Theme ────────────────────────────────────────────── */
function overlayColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    color: dark ? '#00000000' : '#00000000',
    symbolColor: dark ? '#ffffff' : '#1b1b1b',
    height: 44,
  };
}
function applyTheme(mode) {
  nativeTheme.themeSource = mode || 'system';
  if (win) {
    try { win.setTitleBarOverlay(overlayColors()); } catch (e) {}
    win.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors);
  }
}
nativeTheme.on('updated', () => {
  if (win) {
    try { win.setTitleBarOverlay(overlayColors()); } catch (e) {}
    win.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors);
  }
});

/* ── PHP preview server ───────────────────────────────── */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function stopPhp() {
  if (phpProc) {
    try { phpProc.kill(); } catch (e) {}
    phpProc = null;
  }
}

async function ensurePhp(docroot) {
  if (phpProc && phpDocroot === docroot) return phpPort;
  stopPhp();
  phpPort = await freePort();
  phpDocroot = docroot;
  ctrlFile = path.join(previewDir(), 'target.txt');
  const proc = spawn(phpExe(), [
    '-S', '127.0.0.1:' + phpPort,
    // preview is display-only: no reason to allow process execution from PHP
    '-d', 'disable_functions=exec,shell_exec,system,passthru,proc_open,popen,pcntl_exec',
    path.join(shimDir(), 'router.php'),
  ], {
    cwd: docroot,
    env: {
      ...process.env,
      PS_DOCROOT: docroot,
      PS_SHIMDIR: shimDir(),
      PS_CTRL: ctrlFile,
      PS_TOKEN: PREVIEW_TOKEN,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => {
    const s = d.toString();
    // php -S logs every request to stderr; only forward real problems
    if (/error|warning|fatal/i.test(s) && win) win.webContents.send('php:log', s);
  });
  proc.on('exit', () => { if (phpProc === proc) phpProc = null; });
  phpProc = proc;
  // wait until it accepts connections
  await new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      const sock = net.connect(phpPort, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => { sock.destroy(); if (++tries > 40) resolve(); else setTimeout(tick, 100); });
    };
    tick();
  });
  return phpPort;
}

/* ── Minimal ZIP writer (store method — WordPress accepts these fine) ── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function makeStoreZip(entries) {
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  const locals = [], centrals = [];
  let offset = 0;
  for (const ent of entries) {
    const nameBuf = Buffer.from(ent.name, 'utf8');
    const crc = crc32(ent.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // utf-8 flag
    local.writeUInt16LE(0, 8);            // store
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(ent.data.length, 18);
    local.writeUInt32LE(ent.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, ent.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(ent.data.length, 20);
    central.writeUInt32LE(ent.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += 30 + nameBuf.length + ent.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/* ── The visible safety net: Desktop\PHP Editor ───────────────────────
 * Project Backups\  — a copy of each project, made when it is opened
 * File Backups\     — file snapshots (before saves + rolling autosaves)
 * Changelogs\       — per-project plain-English change diaries            */
function phpEditorRoot() { return path.join(app.getPath('desktop'), 'PHP Editor'); }
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtStamp(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`;
}
function fmtHuman(d) {
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} · ${h}:${pad2(d.getMinutes())} ${ap}`;
}
function parseStamp(name) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\.(\d{2})/.exec(name);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function backupDirFor(file) {
  const hash = crypto.createHash('sha1').update(path.dirname(file).toLowerCase()).digest('hex').slice(0, 8);
  const projName = path.basename(path.dirname(file)) || 'misc';
  return path.join(phpEditorRoot(), 'File Backups', `${projName} [${hash}]`, path.basename(file));
}
async function pruneDir(dir, keep) {
  const entries = (await fsp.readdir(dir)).sort();  // stamp names sort chronologically
  while (entries.length > keep) {
    const oldest = entries.shift();
    await fsp.rm(path.join(dir, oldest), { recursive: true, force: true }).catch(() => {});
  }
}
async function snapshotText(file, text) {
  try {
    const dir = backupDirFor(file);
    await fsp.mkdir(dir, { recursive: true });
    const ext = path.extname(file) || '.txt';
    await fsp.writeFile(path.join(dir, fmtStamp(new Date()) + ext), text, 'utf8');
    await pruneDir(dir, 40);
  } catch (e) { /* backups must never block anything */ }
}
async function snapshotBackup(file) {
  try {
    if (!fs.existsSync(file)) return;
    await snapshotText(file, await fsp.readFile(file, 'utf8'));
  } catch (e) { /* ignore */ }
}

const IGNORE_COPY = new Set(['node_modules', '.git', '.tmp', 'dist', 'vendor', '.idea', '.vscode']);
async function copyTree(src, dest, depth) {
  if (depth > 8) return;
  await fsp.mkdir(dest, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_COPY.has(e.name) && !e.name.startsWith('.')) await copyTree(s, path.join(dest, e.name), depth + 1);
    } else {
      try {
        if ((await fsp.stat(s)).size <= 50 * 1024 * 1024) await fsp.copyFile(s, path.join(dest, e.name));
      } catch (err) { /* skip unreadable */ }
    }
  }
}

/* ── FS helpers ───────────────────────────────────────── */
const IGNORE_DIRS = new Set(['node_modules', '.git', '.tmp', 'dist', 'vendor', '.idea', '.vscode']);
async function readTree(dir, depth) {
  const out = [];
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return out; }
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.') && e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      out.push({ name: e.name, path: full, dir: true, children: depth < 8 ? await readTree(full, depth + 1) : [] });
    } else {
      let size = 0;
      try { size = (await fsp.stat(full)).size; } catch (err) {}
      out.push({ name: e.name, path: full, dir: false, size });
    }
  }
  return out;
}

async function searchProject(dir, query, regex) {
  const results = [];
  let matcher;
  try { matcher = regex ? new RegExp(query, 'gi') : null; } catch (e) { matcher = null; }
  async function walk(d, depth) {
    if (depth > 8 || results.length > 500) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (results.length > 500) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full, depth + 1);
        continue;
      }
      if (!/\.(php|html?|css|js|json|txt|md|xml|svg)$/i.test(e.name)) continue;
      let text;
      try { text = await fsp.readFile(full, 'utf8'); } catch (err) { continue; }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let hit = false;
        if (matcher) { matcher.lastIndex = 0; hit = matcher.test(line); }
        else hit = line.toLowerCase().includes(query.toLowerCase());
        if (hit) {
          results.push({ file: full, line: i + 1, text: line.trim().slice(0, 200) });
          if (results.length > 500) return;
        }
      }
    }
  }
  await walk(dir, 0);
  return results;
}

/* ── Window ───────────────────────────────────────────── */
function createWindow() {
  const bounds = settings.windowBounds || { width: 1480, height: 920 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 980,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    backgroundMaterial: 'mica',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    if (!win.isMaximized() && !win.isMinimized()) settings.windowBounds = win.getBounds();
    saveSettings();
  });
  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ── IPC ──────────────────────────────────────────────── */
function reg() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dark: nativeTheme.shouldUseDarkColors,
    samples: samplesDir(),
    documents: app.getPath('documents'),
    phpEditorDir: phpEditorRoot(),
    monacoBase: isPackaged
      ? path.join(process.resourcesPath, 'monaco')
      : path.join(ROOT, 'node_modules', 'monaco-editor', 'min'),
  }));

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (e, patch) => { Object.assign(settings, patch); saveSettings(); });

  ipcMain.handle('theme:set', (e, mode) => { settings.theme = mode; saveSettings(); applyTheme(mode); return nativeTheme.shouldUseDarkColors; });

  ipcMain.handle('dialog:openProject', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open Project Folder' });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:openFile', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Web files', extensions: ['php', 'html', 'htm', 'css', 'js'] }, { name: 'All files', extensions: ['*'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:saveAs', async (e, defPath) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: defPath });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('dialog:newProject', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose folder for the new project' });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('fs:tree', (e, dir) => readTree(dir, 0));
  ipcMain.handle('fs:read', async (e, file) => {
    const buf = await fsp.readFile(file);
    return buf.toString('utf8');
  });
  ipcMain.handle('fs:write', async (e, file, text) => {
    await snapshotBackup(file);
    await fsp.writeFile(file, text, 'utf8');
    return true;
  });
  ipcMain.handle('backup:list', async (e, file) => {
    const dir = backupDirFor(file);
    let entries;
    try { entries = await fsp.readdir(dir); } catch (err) { return []; }
    const out = [];
    for (const name of entries) {
      const ts = parseStamp(name);
      if (!ts) continue;
      let size = 0;
      try { size = (await fsp.stat(path.join(dir, name))).size; } catch (err) {}
      out.push({ name, ts, size });
    }
    return out.sort((a, b) => b.ts - a.ts);
  });
  ipcMain.handle('backup:read', async (e, file, name) => {
    if (/[\\/]/.test(name)) throw new Error('bad name');
    return fsp.readFile(path.join(backupDirFor(file), name), 'utf8');
  });
  ipcMain.handle('backup:autosave', (e, file, text) => snapshotText(file, text));

  /* Safety copy of a whole project — at most one per project per day */
  ipcMain.handle('backup:projectOpen', async (e, dir) => {
    try {
      if (!dir || dir === samplesDir() || dir.startsWith(process.resourcesPath || ' ')) return null;
      const name = path.basename(dir);
      const root = path.join(phpEditorRoot(), 'Project Backups');
      await fsp.mkdir(root, { recursive: true });
      const day = fmtStamp(new Date()).slice(0, 10);
      const existing = (await fsp.readdir(root)).filter((n) => n.startsWith(name + ' — '));
      if (existing.some((n) => n.includes(day))) return null;
      const dest = path.join(root, `${name} — ${day}`);
      await copyTree(dir, dest, 0);
      // keep the last 10 backups of this project
      const mine = existing.concat([`${name} — ${day}`]).sort();
      while (mine.length > 10) {
        await fsp.rm(path.join(root, mine.shift()), { recursive: true, force: true }).catch(() => {});
      }
      return dest;
    } catch (err) { return null; }
  });

  /* Plain-English change diary, one file per project */
  ipcMain.handle('changelog:append', async (e, projectDir, fileName, lines) => {
    try {
      const proj = path.basename(projectDir || '') || 'misc';
      const dir = path.join(phpEditorRoot(), 'Changelogs');
      await fsp.mkdir(dir, { recursive: true });
      const fp = path.join(dir, proj + '.md');
      let head = '';
      if (!fs.existsSync(fp)) head = `# Change history — ${proj}\n\nNewest changes are at the bottom. Written automatically by PHP Studio every time you save.\n`;
      const entry = `\n## ${fmtHuman(new Date())} — ${fileName}\n` + lines.map((l) => `- ${String(l)}\n`).join('');
      await fsp.appendFile(fp, head + entry, 'utf8');
      return fp;
    } catch (err) { return null; }
  });

  ipcMain.handle('changelog:path', (e, projectDir) => {
    const proj = path.basename(projectDir || '') || 'misc';
    return path.join(phpEditorRoot(), 'Changelogs', proj + '.md');
  });
  ipcMain.handle('app:openPath', (e, p) => shell.openPath(p));
  ipcMain.handle('fs:exists', (e, p) => fs.existsSync(p));
  ipcMain.handle('fs:mkdir', async (e, p) => { await fsp.mkdir(p, { recursive: true }); return true; });
  ipcMain.handle('fs:rename', async (e, from, to) => { await fsp.rename(from, to); return true; });
  ipcMain.handle('fs:trash', async (e, p) => { await shell.trashItem(p); return true; });
  ipcMain.handle('fs:copy', async (e, from, to) => { await fsp.copyFile(from, to); return true; });
  ipcMain.handle('fs:writeNew', async (e, file, text) => {
    if (fs.existsSync(file)) throw new Error('File already exists');
    await fsp.writeFile(file, text, 'utf8');
    return true;
  });

  ipcMain.handle('app:reveal', (e, p) => { shell.showItemInFolder(p); });
  ipcMain.handle('app:openExternal', (e, url) => { if (/^https?:/i.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:clipboard', (e, text) => { clipboard.writeText(text); });

  ipcMain.handle('search:project', (e, dir, q, regex) => searchProject(dir, q, regex));

  /* Preview: instrument text, write temp copy, point server at it */
  ipcMain.handle('preview:update', async (e, projectDir, filePath, text) => {
    const r = await instrumentAsync(text);
    const ext = path.extname(filePath).toLowerCase();
    const tmp = path.join(previewDir(), 'current' + (ext === '.php' ? '.php' : '.html'));
    await fsp.writeFile(tmp, r.instrumented, 'utf8');
    const port = await ensurePhp(projectDir);
    await fsp.writeFile(path.join(previewDir(), 'target.txt'), tmp, 'utf8');
    return { url: 'http://127.0.0.1:' + port + '/?pstoken=' + PREVIEW_TOKEN, map: r.map, count: r.count };
  });

  ipcMain.handle('preview:stop', () => { stopPhp(); });

  /* FTP */
  ipcMain.handle('ftp:test', async (e, cfg) => {
    const ftp = require('basic-ftp');
    const client = new ftp.Client(12000);
    try {
      await client.access({
        host: cfg.host, port: cfg.port || 21, user: cfg.user, password: cfg.password,
        secure: !!cfg.secure, secureOptions: { rejectUnauthorized: false },
      });
      const list = await client.list(cfg.remoteDir || '/');
      return { ok: true, entries: list.slice(0, 50).map((x) => x.name) };
    } finally { client.close(); }
  });

  ipcMain.handle('ftp:upload', async (e, cfg, jobs) => {
    // jobs: [{local, remote}]
    const ftp = require('basic-ftp');
    const client = new ftp.Client(30000);
    const results = [];
    try {
      await client.access({
        host: cfg.host, port: cfg.port || 21, user: cfg.user, password: cfg.password,
        secure: !!cfg.secure, secureOptions: { rejectUnauthorized: false },
      });
      client.trackProgress((info) => {
        win && win.webContents.send('ftp:progress', { name: info.name, bytes: info.bytesOverall });
      });
      for (const job of jobs) {
        const remoteDir = path.posix.dirname(job.remote);
        if (remoteDir && remoteDir !== '.' && remoteDir !== '/') await client.ensureDir(remoteDir);
        await client.uploadFrom(job.local, job.remote);
        results.push(job.remote);
        win && win.webContents.send('ftp:file-done', { remote: job.remote, done: results.length, total: jobs.length });
      }
      return { ok: true, uploaded: results };
    } finally { client.close(); }
  });

  /* Pick a picture and copy it into the project's images folder */
  ipcMain.handle('image:pick', async (e, projectDir) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a picture',
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }],
    });
    if (r.canceled) return null;
    const src = r.filePaths[0];
    const imgDir = path.join(projectDir, 'images');
    await fsp.mkdir(imgDir, { recursive: true });
    const ext = path.extname(src);
    let name = path.basename(src);
    let dest = path.join(imgDir, name);
    let i = 1;
    while (fs.existsSync(dest)) {
      name = path.basename(src, ext) + '-' + (i++) + ext;
      dest = path.join(imgDir, name);
    }
    await fsp.copyFile(src, dest);
    return 'images/' + name;
  });

  /* Pick a picture path only (no copy — used by the wizard before the
     project folder exists) */
  ipcMain.handle('image:pickPath', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a picture',
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  /* Activate an installed plugin through the WordPress REST API
     (Application Passwords auth). Never logs or stores the password. */
  ipcMain.handle('wp:activate', async (e, siteUrl, user, appPass, pluginId) => {
    const base = siteUrl.replace(/\/+$/, '');
    const auth = 'Basic ' + Buffer.from(user + ':' + appPass).toString('base64');
    const url = base + '/wp-json/wp/v2/plugins/' + pluginId;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { msg = JSON.parse(text).message || msg; } catch (err) {}
      throw new Error(msg);
    }
    return JSON.parse(text);
  });

  /* Package a single-file plugin (plus its images/) as a wp-admin ZIP */
  ipcMain.handle('plugin:zip', async (e, filePath) => {
    const base = path.basename(filePath).replace(/\.php$/i, '');
    const entries = [{ name: base + '/' + path.basename(filePath), data: await fsp.readFile(filePath) }];
    const imgDir = path.join(path.dirname(filePath), 'images');
    if (fs.existsSync(imgDir)) {
      for (const img of await fsp.readdir(imgDir)) {
        const full = path.join(imgDir, img);
        if ((await fsp.stat(full)).isFile()) {
          entries.push({ name: base + '/images/' + img, data: await fsp.readFile(full) });
        }
      }
    }
    const zipPath = path.join(path.dirname(filePath), base + '.zip');
    await fsp.writeFile(zipPath, makeStoreZip(entries));
    return zipPath;
  });

  /* project file listing for "upload project" */
  ipcMain.handle('fs:flatList', async (e, dir) => {
    const files = [];
    async function walk(d, rel, depth) {
      if (depth > 8) return;
      let entries;
      try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch (err) { return; }
      for (const en of entries) {
        if (en.name.startsWith('.')) continue;
        const full = path.join(d, en.name);
        const r = rel ? rel + '/' + en.name : en.name;
        if (en.isDirectory()) {
          if (!IGNORE_DIRS.has(en.name)) await walk(full, r, depth + 1);
        } else files.push({ local: full, rel: r });
      }
    }
    await walk(dir, '', 0);
    return files;
  });
}

/* ── Lifecycle ────────────────────────────────────────── */
app.whenReady().then(() => {
  loadSettings();
  if (settings.theme) nativeTheme.themeSource = settings.theme;
  // Every request the app itself makes to the preview server carries the
  // session token as a header (cookies don't survive the file:// → http
  // third-party iframe context). External browsers use ?pstoken + cookie.
  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1/*'] },
    (details, cb) => {
      if (phpPort && details.url.startsWith('http://127.0.0.1:' + phpPort + '/')) {
        details.requestHeaders['X-PS-Token'] = PREVIEW_TOKEN;
      }
      cb({ requestHeaders: details.requestHeaders });
    },
  );
  reg();
  createWindow();
});
function shutdown() {
  stopPhp();
  if (instWorker) { instWorker.terminate().catch(() => {}); instWorker = null; }
}
app.on('window-all-closed', () => { shutdown(); app.quit(); });
app.on('before-quit', shutdown);
