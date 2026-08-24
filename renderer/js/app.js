/* PHP Studio — core: state, theme, menus, toolbar, toasts, dialogs, layout. */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

const S = window.S = {
  project: null,          // folder path
  files: [],              // open files: {path, name, model, dirty, viewState}
  active: null,           // active file entry
  map: {},                // psid -> source node map for the previewed file
  previewUrl: '',
  selected: null,         // current element description from inspector
  inspecting: true,       // click-to-edit is the default experience
  view: 'design',         // design | split | code
  settings: {},
  info: {},
};

/* ── Toasts ───────────────────────────────────────────── */
function toast(kind, title, detail, ms) {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || 'info');
  const icon = { ok: 'check', err: 'error', warn: 'warn', info: 'info' }[kind] || 'info';
  t.innerHTML = `<span class="ticon">${ICONS[icon]}</span>
    <div class="tbody"><div class="tt"></div><div class="td"></div></div>`;
  $('.tt', t).textContent = title;
  if (detail) $('.td', t).textContent = detail; else $('.td', t).remove();
  box.appendChild(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 220); }, ms || 3800);
}
window.toast = toast;

/* ── Status bar ───────────────────────────────────────── */
function sbMessage(msg) { $('#sbMessage').textContent = msg || ''; }
function sbServer(on, err) {
  const dot = $('#sbServer .sb-dot');
  dot.className = 'sb-dot ' + (err ? 'err' : on ? '' : 'off');
}
window.sbMessage = sbMessage; window.sbServer = sbServer;

/* ── Theme ────────────────────────────────────────────── */
function setThemeAttr(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (window.monaco && window.__monacoReady) monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
}
async function chooseTheme(mode) {
  const dark = await studio.setTheme(mode);
  S.settings.theme = mode;
  setThemeAttr(dark);
  buildMenubar();
}

/* ── Context menu system ──────────────────────────────── */
let ctxCloser = null;
function showMenu(items, x, y, alignEl) {
  hideMenu();
  const m = $('#ctxmenu');
  m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { const s = document.createElement('div'); s.className = 'msep'; m.appendChild(s); continue; }
    if (!it) continue;
    const d = document.createElement('div');
    d.className = 'mi' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '');
    d.innerHTML = `<span class="${it.checked !== undefined ? 'check' : 'ico'}">${it.checked ? '✓' : it.checked === false ? '' : (ICONS[it.icon] || '')}</span><span></span>${it.accel ? `<span class="accel">${it.accel}</span>` : ''}`;
    d.children[1].textContent = it.label;
    d.addEventListener('click', () => { hideMenu(); it.action && it.action(); });
    m.appendChild(d);
  }
  m.style.display = 'block';
  m.style.visibility = 'hidden';
  m.style.left = '0px'; m.style.top = '0px';
  requestAnimationFrame(() => {
    const r = m.getBoundingClientRect();
    if (alignEl) { const ar = alignEl.getBoundingClientRect(); x = ar.left; y = ar.bottom + 2; }
    if (x + r.width > innerWidth - 8) x = innerWidth - r.width - 8;
    if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
    m.style.left = x + 'px'; m.style.top = y + 'px';
    m.style.visibility = 'visible';
  });
  ctxCloser = (e) => { if (!m.contains(e.target)) hideMenu(); };
  setTimeout(() => { addEventListener('mousedown', ctxCloser, true); addEventListener('blur', hideMenu); }, 0);
}
function hideMenu() {
  const m = $('#ctxmenu');
  m.style.display = 'none';
  $$('.menu-root').forEach((b) => b.classList.remove('open'));
  if (ctxCloser) { removeEventListener('mousedown', ctxCloser, true); removeEventListener('blur', hideMenu); ctxCloser = null; }
}
window.showMenu = showMenu; window.hideMenu = hideMenu;

/* ── Dialogs ──────────────────────────────────────────── */
function dialog({ title, body, actions, width }) {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    const dlg = document.createElement('div');
    dlg.className = 'dialog';
    if (width) dlg.style.width = width + 'px';
    dlg.innerHTML = `<div class="dialog-title"></div><div class="dialog-body"></div><div class="dialog-actions"></div>`;
    $('.dialog-title', dlg).textContent = title;
    const bodyEl = $('.dialog-body', dlg);
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const close = (val) => { bd.remove(); resolve(val); };
    for (const a of actions || [{ label: 'OK', primary: true, value: true }]) {
      const b = document.createElement('button');
      b.className = 'btn' + (a.primary ? ' primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', async () => {
        if (a.beforeClose) { const ok = await a.beforeClose(bodyEl, b); if (ok === false) return; close(ok); return; }
        close(a.value);
      });
      $('.dialog-actions', dlg).appendChild(b);
    }
    bd.appendChild(dlg);
    root.appendChild(bd);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(null); });
    const esc = (e) => { if (e.key === 'Escape') { close(null); removeEventListener('keydown', esc); } };
    addEventListener('keydown', esc);
    const firstInput = $('input, textarea, select', bodyEl);
    if (firstInput) setTimeout(() => firstInput.focus(), 60);
  });
}
window.dialog = dialog;

async function confirmDialog(title, message, confirmLabel, danger) {
  const r = await dialog({
    title,
    body: `<p style="margin:6px 0">${message}</p>`,
    actions: [
      { label: 'Cancel', value: null },
      { label: confirmLabel || 'Confirm', primary: true, value: true },
    ],
  });
  return r === true;
}
window.confirmDialog = confirmDialog;

/* ── Menubar ──────────────────────────────────────────── */
function buildMenubar() {
  const mb = $('#menubar');
  mb.innerHTML = '';
  const menus = {
    File: () => [
      { label: 'New Project…', icon: 'newFile', accel: 'Ctrl+Shift+N', action: () => Project.newProject() },
      { label: 'New File…', icon: 'newFile', accel: 'Ctrl+N', action: () => Project.newFile() },
      '-',
      { label: 'Open Project…', icon: 'openFolder', accel: 'Ctrl+Shift+O', action: () => Project.openProject() },
      { label: 'Open File…', icon: 'openFolder', accel: 'Ctrl+O', action: () => Project.openLooseFile() },
      { label: 'Open Sample Project', icon: 'folder', action: () => Project.openSamples() },
      '-',
      { label: 'Save', icon: 'save', accel: 'Ctrl+S', disabled: !S.active, action: () => Editor.save() },
      { label: 'Save All', icon: 'saveAll', accel: 'Ctrl+Alt+S', disabled: !S.files.some((f) => f.dirty), action: () => Editor.saveAll() },
      { label: 'Restore Previous Version…', icon: 'undo', disabled: !S.active, action: () => Project.restoreDialog() },
      '-',
      {
        label: 'What Did I Change?', icon: 'info', disabled: !S.project,
        action: async () => {
          const p = await studio.changelogPath(S.project);
          if (await studio.exists(p)) studio.openPath(p);
          else toast('info', 'No changes written down yet', 'The diary starts the first time you save a change.', 4000);
        },
      },
      {
        label: 'Open Backups Folder', icon: 'folder',
        action: async () => {
          if (await studio.exists(S.info.phpEditorDir)) studio.openPath(S.info.phpEditorDir);
          else toast('info', 'No backups yet', 'The Desktop → PHP Editor folder appears after your first backup or save.', 4000);
        },
      },
      '-',
      { label: 'Exit', action: () => window.close() },
    ],
    Edit: () => [
      { label: 'Undo', icon: 'undo', accel: 'Ctrl+Z', action: () => Editor.undo() },
      { label: 'Redo', icon: 'redo', accel: 'Ctrl+Y', action: () => Editor.redo() },
      '-',
      { label: 'Find in File', icon: 'search', accel: 'Ctrl+F', action: () => Editor.find() },
      { label: 'Search in Project', icon: 'search', accel: 'Ctrl+Shift+F', action: () => Project.focusSearch() },
    ],
    View: () => [
      { label: 'Design', checked: S.view === 'design', action: () => setView('design') },
      { label: 'Split', checked: S.view === 'split', action: () => setView('split') },
      { label: 'Code', checked: S.view === 'code', action: () => setView('code') },
      '-',
      { label: 'Explorer Panel', checked: !$('#panelLeft').classList.contains('collapsed'), action: () => togglePanel('panelLeft') },
      { label: 'Navigator Panel', checked: !$('#panelNav').classList.contains('collapsed'), action: () => togglePanel('panelNav') },
      { label: 'Properties Panel', checked: !$('#panelProps').classList.contains('collapsed'), action: () => togglePanel('panelProps') },
      '-',
      { label: 'Theme: Follow Windows', checked: (S.settings.theme || 'system') === 'system', action: () => chooseTheme('system') },
      { label: 'Theme: Light', checked: S.settings.theme === 'light', action: () => chooseTheme('light') },
      { label: 'Theme: Dark', checked: S.settings.theme === 'dark', action: () => chooseTheme('dark') },
      '-',
      { label: 'Refresh Preview', icon: 'refresh', accel: 'F5', action: () => Preview.refresh() },
    ],
    Project: () => [
      { label: 'Refresh File Tree', icon: 'refresh', action: () => Project.refreshTree() },
      { label: 'Reveal Project in Explorer', icon: 'reveal', disabled: !S.project, action: () => studio.reveal(S.project) },
    ],
    Deploy: () => [
      { label: 'Install on WordPress…', icon: 'external', disabled: !S.active, action: () => Home.installDialog() },
      '-',
      { label: 'FTP Connection…', icon: 'settings', action: () => Deploy.settingsDialog() },
      { label: 'Upload Current File', icon: 'upload', disabled: !S.active, action: () => Deploy.uploadCurrent() },
      { label: 'Upload Entire Project', icon: 'upload', disabled: !S.project, action: () => Deploy.uploadProject() },
    ],
    Help: () => [
      { label: 'About PHP Studio', icon: 'info', action: showAbout },
    ],
  };
  for (const [name, build] of Object.entries(menus)) {
    const b = document.createElement('button');
    b.className = 'menu-root';
    b.textContent = name;
    b.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (b.classList.contains('open')) { hideMenu(); return; }
      showMenu(build(), 0, 0, b);
      b.classList.add('open');
    });
    mb.appendChild(b);
  }
}

function showAbout() {
  dialog({
    title: 'PHP Studio',
    body: `<div style="display:flex;gap:16px;align-items:center;margin:8px 0 4px">
      <div style="width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,var(--accent),#7a44c9);display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:700">P</div>
      <div><div style="font-size:15px;font-weight:600;color:var(--text)">PHP Studio ${S.info.version || ''}</div>
      <div style="margin-top:3px">Visual PHP website editor with live WordPress-aware preview,<br>click-to-edit properties, and FTP deploy.</div></div></div>`,
    actions: [{ label: 'Close', primary: true, value: true }],
  });
}

/* ── Toolbar ──────────────────────────────────────────── */
function buildToolbar() {
  const tb = $('#toolbar');
  tb.innerHTML = '';
  const mk = (id, icon, label, title, action) => {
    const b = document.createElement('button');
    b.className = 'tbtn'; b.id = id; b.title = title || label || '';
    b.innerHTML = ICONS[icon] + (label ? `<span>${label}</span>` : '');
    b.addEventListener('click', action);
    tb.appendChild(b);
    return b;
  };
  const sep = () => { const s = document.createElement('div'); s.className = 'tsep'; tb.appendChild(s); };

  mk('tbHome', 'home', '', 'Home', () => Home.show());
  mk('tbOpen', 'openFolder', 'Open', 'Open a website folder (Ctrl+Shift+O)', () => Project.openProject());
  mk('tbSave', 'save', 'Save', 'Save (Ctrl+S)', () => Editor.save());
  sep();
  mk('tbUndo', 'undo', '', 'Undo (Ctrl+Z)', () => Editor.undo());
  mk('tbRedo', 'redo', '', 'Redo (Ctrl+Y)', () => Editor.redo());
  sep();
  mk('tbInspect', 'inspect', 'Edit Page', 'Click anything on the page to change it (Ctrl+Shift+C)', () => Preview.toggleInspect());
  mk('tbAdd', 'duplicate', 'Add', 'Add things to the page — drag them where you want', () => Project.switchLeftTab('components'));
  sep();
  mk('tbRefresh', 'refresh', 'Refresh', 'Reload the page preview (F5)', () => Preview.refresh());
  mk('tbFtp', 'upload', 'Publish', 'Upload to your website (FTP)', () => Deploy.uploadCurrent());
  const spacer = document.createElement('div'); spacer.className = 'flex1'; tb.appendChild(spacer);
  mk('tbDesign', 'design', '', 'Visual view', () => setView('design'));
  mk('tbSplit', 'split', '', 'Visual + code side by side', () => setView('split'));
  mk('tbCode', 'code', '', 'Code view (advanced)', () => setView('code'));
  sep();
  mk('tbAdvanced', 'code', S.uiMode === 'simple' ? 'Advanced' : 'Simple', 'Switch between the simple and full editor', () => Home.toggleUIMode());
  mk('tbSettings', 'settings', '', 'Settings', showSettingsDialog);
  syncToolbar();
}
function syncToolbar() {
  $('#tbInspect') && $('#tbInspect').classList.toggle('active', S.inspecting);
  $('#tbDesign') && $('#tbDesign').classList.toggle('active', S.view === 'design');
  $('#tbSplit') && $('#tbSplit').classList.toggle('active', S.view === 'split');
  $('#tbCode') && $('#tbCode').classList.toggle('active', S.view === 'code');
}
window.syncToolbar = syncToolbar;

function setView(v) {
  S.view = v;
  document.body.dataset.view = v;
  syncToolbar();
  studio.setSettings({ view: v });
  if (window.Editor && Editor.layoutSoon) Editor.layoutSoon();
}
window.setView = setView;

/* ── Settings dialog ──────────────────────────────────── */
async function showSettingsDialog() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="prow"><label>Theme</label>
      <select id="setTheme">
        <option value="system">Follow Windows</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select></div>
    <div class="prow"><label>Editor font size</label><input type="number" id="setFont" min="9" max="28" step="1"></div>
    <div class="prow"><label>Auto-refresh preview</label>
      <div class="switch"><input type="checkbox" id="setAuto"><span class="track"></span><span class="thumb"></span></div>
      <span class="muted" style="font-size:11.5px">while typing</span></div>
    <div class="prow"><label>Publish on save</label>
      <div class="switch"><input type="checkbox" id="setAutoPub"><span class="track"></span><span class="thumb"></span></div>
      <span class="muted" style="font-size:11.5px">upload saved files via FTP</span></div>
    <div class="prow"><label>UI scale</label>
      <select id="setZoom">
        <option value="-1">90%</option><option value="0">100%</option>
        <option value="0.5">110%</option><option value="1">120%</option>
      </select></div>`;
  $('#setTheme', body).value = S.settings.theme || 'system';
  $('#setFont', body).value = S.settings.fontSize || 13;
  $('#setAuto', body).checked = S.settings.autoRefresh !== false;
  $('#setAutoPub', body).checked = !!S.settings.autoPublish;
  $('#setZoom', body).value = String(S.settings.zoom || 0);
  const r = await dialog({
    title: 'Settings', body,
    actions: [
      { label: 'Cancel', value: null },
      {
        label: 'Save', primary: true,
        beforeClose: async (b) => {
          const patch = {
            theme: $('#setTheme', b).value,
            fontSize: parseInt($('#setFont', b).value, 10) || 13,
            autoRefresh: $('#setAuto', b).checked,
            autoPublish: $('#setAutoPub', b).checked,
            zoom: parseFloat($('#setZoom', b).value) || 0,
          };
          Object.assign(S.settings, patch);
          await studio.setSettings(patch);
          await chooseTheme(patch.theme);
          Editor.applyOptions();
          return true;
        },
      },
    ],
  });
  if (r) toast('ok', 'Settings saved');
}

/* ── Splitters + panel collapse ───────────────────────── */
function initSplitters() {
  $$('.splitter[data-panel]').forEach((sp) => {
    const panel = $('#' + sp.dataset.panel);
    const before = sp.dataset.before === 'true'; // panel sits after the splitter (right side)
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      sp.classList.add('dragging');
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      const move = (ev) => {
        const dx = ev.clientX - startX;
        const w = Math.max(140, Math.min(560, before ? startW - dx : startW + dx));
        panel.style.width = w + 'px';
        if (window.Editor && Editor.layoutSoon) Editor.layoutSoon();
      };
      const up = () => {
        sp.classList.remove('dragging');
        removeEventListener('mousemove', move);
        removeEventListener('mouseup', up);
        persistLayout();
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
  });
  // code/preview splitter
  const sc = $('#splitCode');
  sc.addEventListener('mousedown', (e) => {
    e.preventDefault();
    sc.classList.add('dragging');
    const code = $('#codePane');
    const startX = e.clientX;
    const startW = code.getBoundingClientRect().width;
    const total = $('#centerBody').getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.max(140, Math.min(total - 160, startW + ev.clientX - startX));
      code.style.width = (w / total * 100) + '%';
      if (window.Editor && Editor.layoutSoon) Editor.layoutSoon();
    };
    const up = () => {
      sc.classList.remove('dragging');
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      persistLayout();
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });

  $$('.collapse-btn').forEach((b) => {
    b.innerHTML = ICONS.collapse;
    b.addEventListener('click', () => togglePanel(b.dataset.panel));
  });
  $('#btnCollapseTree').innerHTML = ICONS.collapseAll;
  $('#btnRefreshTree').innerHTML = ICONS.refresh;
  $('#btnNavRefresh').innerHTML = ICONS.refresh;
  $('#btnPreviewRefresh').innerHTML = ICONS.refresh;
  $('#btnPreviewExternal').innerHTML = ICONS.external;
}
function togglePanel(id) {
  const p = $('#' + id);
  p.classList.toggle('collapsed');
  const spl = $(`.splitter[data-panel="${id}"]`);
  if (spl) spl.classList.toggle('hidden', p.classList.contains('collapsed'));
  persistLayout();
  if (window.Editor && Editor.layoutSoon) Editor.layoutSoon();
}
window.togglePanel = togglePanel;

function persistLayout() {
  studio.setSettings({
    layout: {
      left: $('#panelLeft').style.width || '',
      nav: $('#panelNav').style.width || '',
      props: $('#panelProps').style.width || '',
      code: $('#codePane').style.width || '',
      collapsed: ['panelLeft', 'panelNav', 'panelProps'].filter((id) => $('#' + id).classList.contains('collapsed')),
    },
  });
}
function restoreLayout(layout) {
  if (!layout) return;
  if (layout.left) $('#panelLeft').style.width = layout.left;
  if (layout.nav) $('#panelNav').style.width = layout.nav;
  if (layout.props) $('#panelProps').style.width = layout.props;
  if (layout.code) $('#codePane').style.width = layout.code;
  for (const id of layout.collapsed || []) {
    $('#' + id).classList.add('collapsed');
    const spl = $(`.splitter[data-panel="${id}"]`);
    if (spl) spl.classList.add('hidden');
  }
}
window.restoreLayout = restoreLayout;

/* ── Keyboard shortcuts ───────────────────────────────── */
function initShortcuts() {
  addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && e.shiftKey && k === 'n') { e.preventDefault(); Project.newProject(); }
    else if (mod && !e.shiftKey && k === 'n') { e.preventDefault(); Project.newFile(); }
    else if (mod && e.shiftKey && k === 'o') { e.preventDefault(); Project.openProject(); }
    else if (mod && !e.shiftKey && k === 'o') { e.preventDefault(); Project.openLooseFile(); }
    else if (mod && e.altKey && k === 's') { e.preventDefault(); Editor.saveAll(); }
    else if (mod && !e.shiftKey && k === 's') { e.preventDefault(); Editor.save(); }
    else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); Project.focusSearch(); }
    else if (mod && e.shiftKey && k === 'c') { e.preventDefault(); Preview.toggleInspect(); }
    else if (k === 'f5') { e.preventDefault(); Preview.refresh(); }
    else if (mod && k === 'w') { e.preventDefault(); if (S.active) Editor.closeFile(S.active); }
  });
}

/* ── Window title ─────────────────────────────────────── */
function updateTitle() {
  const parts = [];
  if (S.active) parts.push((S.active.dirty ? '● ' : '') + S.active.name);
  if (S.project) parts.push(S.project.split(/[\\/]/).pop());
  parts.push('PHP Studio');
  $('#tbTitle').textContent = parts.join(' — ');
  document.title = parts.join(' — ');
}
window.updateTitle = updateTitle;

window.AppInit = { buildMenubar, buildToolbar, initSplitters, initShortcuts, setThemeAttr };
