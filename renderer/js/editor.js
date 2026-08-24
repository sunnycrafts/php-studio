/* PHP Studio — Monaco editor + file tabs. */
'use strict';

window.Editor = (function () {
  let editor = null;
  let layoutTimer = 0;
  let changeTimer = 0;

  /* Monaco ships as real files under resources/monaco (outside the app
   * archive), so it is loaded by absolute file: URL rather than a relative
   * path. Paths contain spaces ("PHP Studio"), hence encodeURI. */
  function fileUrl(p) {
    return 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  async function initMonaco(base) {
    const vsUrl = fileUrl(base) + '/vs';
    try {
      await loadScript(vsUrl + '/loader.js');
    } catch (e) {
      toast('err', 'Code view unavailable', 'The code editor files are missing from this install.', 8000);
      throw e;
    }
    return new Promise((resolve) => {
      require.config({ paths: { vs: vsUrl } });
      require(['vs/editor/editor.main'], () => {
        window.__monacoReady = true;
        const dark = document.documentElement.dataset.theme === 'dark';
        editor = monaco.editor.create($('#monaco'), {
          theme: dark ? 'vs-dark' : 'vs',
          automaticLayout: false,
          fontSize: S.settings.fontSize || 13,
          fontFamily: '"Cascadia Code", Consolas, monospace',
          minimap: { enabled: true, scale: 1 },
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'on',
          scrollBeyondLastLine: false,
          renderWhitespace: 'none',
          wordWrap: 'off',
          tabSize: 2,
          padding: { top: 10 },
          stickyScroll: { enabled: false },
        });
        editor.onDidChangeCursorPosition((e) => {
          $('#sbCursor').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        });
        addEventListener('resize', layoutSoon);
        new ResizeObserver(layoutSoon).observe($('#codePane'));
        resolve();
      });
    });
  }

  function layoutSoon() {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => editor && editor.layout(), 60);
  }

  function langFor(p) {
    const ext = p.split('.').pop().toLowerCase();
    return { php: 'php', html: 'html', htm: 'html', css: 'css', js: 'javascript', json: 'json', md: 'markdown', xml: 'xml', svg: 'xml', txt: 'plaintext' }[ext] || 'plaintext';
  }

  /* ── file management ────────────────────────────────── */
  async function openFile(path) {
    let f = S.files.find((x) => x.path === path);
    if (!f) {
      let text;
      try { text = await studio.read(path); }
      catch (e) { toast('err', 'Could not open file', String(e.message || e)); return null; }
      // two opens of the same file can race past the check above — re-check
      // after the async read, and never create a model for an existing URI
      f = S.files.find((x) => x.path === path);
      if (f) { activate(f); return f; }
      const uri = monaco.Uri.file(path);
      const model = monaco.editor.getModel(uri) || monaco.editor.createModel(text, langFor(path), uri);
      f = { path, name: path.split(/[\\/]/).pop(), model, dirty: false, viewState: null, savedVersion: model.getAlternativeVersionId() };
      model.onDidChangeContent(() => {
        const nowDirty = model.getAlternativeVersionId() !== f.savedVersion;
        if (nowDirty !== f.dirty) { f.dirty = nowDirty; renderTabs(); updateTitle(); }
        if (f === S.active && !S.suppressAuto) {
          scheduleChange();
          ChangeLog.note(f.path, 'code', 'Edited the code by hand');
        }
        // rolling safety snapshot roughly every 20 changes
        f.changeCount = (f.changeCount || 0) + 1;
        if (f.changeCount >= 20 && f.dirty) {
          f.changeCount = 0;
          studio.autosaveBackup(f.path, model.getValue());
        }
      });
      S.files.push(f);
    }
    activate(f);
    if (window.Home) Home.addRecent({ path });
    return f;
  }

  function activate(f) {
    if (S.active && editor) S.active.viewState = editor.saveViewState();
    S.active = f;
    editor.setModel(f.model);
    if (f.viewState) editor.restoreViewState(f.viewState);
    renderTabs();
    updateTitle();
    $('#sbFile').textContent = f.name;
    Preview.showFile(f);
    if (window.Project) Project.highlightFile(f.path);
  }

  function scheduleChange() {
    if (S.settings.autoRefresh === false) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { Preview.update(); }, 650);
  }

  async function save(f) {
    f = f || S.active;
    if (!f) return;
    const hadChanges = f.dirty;
    try {
      await studio.write(f.path, f.model.getValue());
      if (hadChanges) {
        const lines = ChangeLog.flush(f.path);
        studio.changelogAppend(S.project || '', f.name, lines.length ? lines : ['Saved changes']);
      }
      f.savedVersion = f.model.getAlternativeVersionId();
      f.dirty = false;
      renderTabs(); updateTitle();
      toast('ok', 'File saved', f.name, 2200);
      // visual edits and auto-refreshed typing already kept the preview live;
      // only force a reload when auto-refresh is off (preview may be stale)
      if (S.settings.autoRefresh === false) Preview.update(true);
      else Preview.updateSilent();
      if (window.Deploy) Deploy.maybeAutoPublish(f);
    } catch (e) { toast('err', 'Save failed', String(e.message || e)); }
  }
  async function saveAll() {
    for (const f of S.files.filter((x) => x.dirty)) await save(f);
  }

  async function closeFile(f) {
    if (f.dirty) {
      const r = await dialog({
        title: 'Unsaved changes',
        body: `<p><b>${f.name}</b> has unsaved changes. Save before closing?</p>`,
        actions: [
          { label: 'Cancel', value: null },
          { label: "Don't Save", value: 'discard' },
          { label: 'Save', primary: true, value: 'save' },
        ],
      });
      if (r === null) return;
      if (r === 'save') await save(f);
    }
    const i = S.files.indexOf(f);
    S.files.splice(i, 1);
    f.model.dispose();
    if (S.active === f) {
      S.active = null;
      const next = S.files[Math.min(i, S.files.length - 1)];
      if (next) activate(next);
      else { editor.setModel(null); renderTabs(); updateTitle(); Preview.clear(); }
    } else renderTabs();
  }

  /* ── tabs ───────────────────────────────────────────── */
  function renderTabs() {
    const box = $('#editorTabs');
    box.innerHTML = '';
    for (const f of S.files) {
      const t = document.createElement('div');
      t.className = 'etab' + (f === S.active ? ' active' : '') + (f.dirty ? ' is-dirty' : '');
      t.innerHTML = `<span class="dirty"></span><span class="elabel"></span><span class="close">${ICONS.close}</span>`;
      $('.elabel', t).textContent = f.name;
      t.title = f.path;
      t.addEventListener('mousedown', (e) => {
        if (e.target.closest('.close')) return;
        if (e.button === 1) { closeFile(f); return; }
        if (f !== S.active) activate(f);
      });
      $('.close', t).addEventListener('click', () => closeFile(f));
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu([
          { label: 'Close', accel: 'Ctrl+W', action: () => closeFile(f) },
          { label: 'Close Others', action: async () => { for (const o of [...S.files]) if (o !== f) await closeFile(o); } },
          '-',
          { label: 'Reveal in Explorer', icon: 'reveal', action: () => studio.reveal(f.path) },
          { label: 'Copy Path', icon: 'copy', action: () => { studio.copyToClipboard(f.path); toast('ok', 'Path copied', '', 1600); } },
        ], e.clientX, e.clientY);
      });
      box.appendChild(t);
    }
  }

  /* ── helpers ────────────────────────────────────────── */
  function undo() { editor && editor.trigger('app', 'undo', null); }
  function redo() { editor && editor.trigger('app', 'redo', null); }
  function find() { editor && (editor.focus(), editor.trigger('app', 'actions.find', null)); }
  function gotoLine(line) {
    if (!editor) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  }
  function gotoOffset(off) {
    if (!editor || !S.active) return;
    const pos = S.active.model.getPositionAt(off);
    editor.revealPositionInCenter(pos);
    editor.setPosition(pos);
  }
  function flashRange(startOff, endOff) {
    if (!editor || !S.active) return;
    const m = S.active.model;
    const s = m.getPositionAt(startOff), e = m.getPositionAt(endOff);
    const dec = editor.createDecorationsCollection([{
      range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column),
      options: { className: 'flash-range', isWholeLine: false },
    }]);
    editor.revealRangeInCenterIfOutsideViewport(new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column));
    setTimeout(() => dec.clear(), 1200);
  }
  function applyOptions() {
    if (editor) editor.updateOptions({ fontSize: S.settings.fontSize || 13 });
  }

  const style = document.createElement('style');
  style.textContent = '.flash-range{background:rgba(15,108,189,.22);border-radius:2px}';
  document.head.appendChild(style);

  return {
    initMonaco, openFile, activate, save, saveAll, closeFile, renderTabs,
    undo, redo, find, gotoLine, gotoOffset, flashRange, layoutSoon, applyOptions,
    get editor() { return editor; },
  };
})();
