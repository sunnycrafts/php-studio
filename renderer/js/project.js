/* PHP Studio — project tree, components palette, project search. */
'use strict';

window.Project = (function () {

  /* ── project open/new ───────────────────────────────── */
  async function openProject(dir) {
    if (!dir) dir = await studio.openProjectDialog();
    if (!dir) return;
    S.project = dir;
    $('#projectName').textContent = dir.split(/[\\/]/).pop();
    $('#sbProject').textContent = dir.split(/[\\/]/).pop();
    await refreshTree();
    studio.setSettings({ lastProject: dir });
    updateTitle();
    // safety copy of the whole project (main makes at most one per day)
    studio.projectBackup(dir).then((p) => {
      if (p) {
        sbMessage('Safety copy of this project saved to Desktop → PHP Editor');
        setTimeout(() => sbMessage(''), 5000);
      }
    });
    // auto-open first php/html file at top level
    const first = findFirstPage(treeData);
    if (first) await Editor.openFile(first.path);
  }

  async function openSamples() {
    await openProject(S.info.samples);
  }

  async function newProject() {
    const dir = await studio.newProjectDialog();
    if (!dir) return;
    const index = dir + '\\index.php';
    if (!(await studio.exists(index))) {
      await studio.write(index, `<?php /* ${dir.split(/[\\/]/).pop()} */ ?>\n<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>New Project</title>\n<style>\n  body { font-family: "Segoe UI", sans-serif; margin: 0; }\n  .hero { min-height: 60vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }\n</style>\n</head>\n<body>\n<section class="hero">\n  <h1>Hello from PHP Studio</h1>\n  <p>Edit this page visually, or switch to Code view.</p>\n</section>\n</body>\n</html>\n`);
    }
    await openProject(dir);
    toast('ok', 'Project created', dir);
  }

  async function openLooseFile() {
    const p = await studio.openFileDialog();
    if (!p) return;
    const dir = p.replace(/[\\/][^\\/]+$/, '');
    if (S.project !== dir) await openProject(dir);
    Editor.openFile(p);
  }

  async function newFile() {
    if (!S.project) { toast('warn', 'Open a project first'); return; }
    const body = document.createElement('div');
    body.innerHTML = `<div class="prow"><label>File name</label><input type="text" id="nfName" placeholder="page.php" spellcheck="false"></div>`;
    const r = await dialog({
      title: 'New File', body,
      actions: [
        { label: 'Cancel', value: null },
        {
          label: 'Create', primary: true,
          beforeClose: async (b) => {
            const name = $('#nfName', b).value.trim();
            if (!name) return false;
            const path = S.project + '\\' + name;
            try { await studio.writeNew(path, name.endsWith('.php') || name.endsWith('.html') ? '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>' + name + '</title>\n</head>\n<body>\n\n</body>\n</html>\n' : ''); }
            catch (e) { toast('err', 'Could not create file', String(e.message || e)); return false; }
            await refreshTree();
            Editor.openFile(path);
            return true;
          },
        },
      ],
    });
    if (r) toast('ok', 'File created');
  }

  /* ── tree ───────────────────────────────────────────── */
  let treeData = [];
  function findFirstPage(nodes) {
    for (const n of nodes) {
      if (!n.dir && /\.(php|html?)$/i.test(n.name)) return n;
    }
    for (const n of nodes) {
      if (n.dir) { const r = findFirstPage(n.children); if (r) return r; }
    }
    return null;
  }

  async function refreshTree() {
    if (!S.project) return;
    treeData = await studio.tree(S.project);
    renderTree();
  }

  function fileIcon(name) {
    if (/\.php$/i.test(name)) return ICONS.filePhp;
    if (/\.(html?|css|js|json)$/i.test(name)) return ICONS.fileCode;
    if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(name)) return ICONS.fileImg;
    return ICONS.fileGeneric;
  }

  function renderTree() {
    const box = $('#fileTree');
    box.innerHTML = '';
    const build = (nodes, parent) => {
      for (const n of nodes) {
        const el = document.createElement('div');
        el.className = 'tnode';
        el.dataset.path = n.path;
        if (n.dir) {
          el.innerHTML = `<span class="twist">${ICONS.chevron}</span><span class="ficon" style="color:var(--warning)">${ICONS.folder}</span><span class="tlabel"></span>`;
          $('.tlabel', el).textContent = n.name;
          const kids = document.createElement('div');
          kids.className = 'tchildren hide';
          el.addEventListener('click', () => {
            el.classList.toggle('expanded');
            kids.classList.toggle('hide');
          });
          parent.appendChild(el);
          build(n.children, kids);
          parent.appendChild(kids);
        } else {
          el.innerHTML = `<span class="twist"></span><span class="ficon" style="color:var(--accent-text)">${fileIcon(n.name)}</span><span class="tlabel"></span>`;
          $('.tlabel', el).textContent = n.name;
          el.addEventListener('click', () => { selectNode(el); });
          el.addEventListener('dblclick', () => Editor.openFile(n.path));
          // single click opens too (VS Code preview behavior)
          el.addEventListener('click', () => Editor.openFile(n.path));
          parent.appendChild(el);
        }
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault(); e.stopPropagation();
          selectNode(el);
          showMenu(nodeMenu(n), e.clientX, e.clientY);
        });
      }
    };
    build(treeData, box);
  }

  function selectNode(el) {
    $$('#fileTree .tnode.selected').forEach((x) => x.classList.remove('selected'));
    el.classList.add('selected');
  }
  function highlightFile(path) {
    $$('#fileTree .tnode').forEach((x) => x.classList.toggle('selected', x.dataset.path === path));
  }

  function nodeMenu(n) {
    const items = [];
    if (!n.dir) {
      items.push({ label: 'Open', icon: 'openFolder', action: () => Editor.openFile(n.path) });
      items.push({ label: 'Open in Code View', icon: 'code', action: async () => { await Editor.openFile(n.path); setView('code'); } });
      items.push('-');
    }
    items.push(
      { label: 'Rename…', icon: 'rename', action: () => renameNode(n) },
      { label: 'Duplicate', icon: 'duplicate', action: () => duplicateNode(n) },
      { label: 'Copy Path', icon: 'copy', action: () => { studio.copyToClipboard(n.path); toast('ok', 'Path copied', '', 1500); } },
      '-',
      { label: 'Reveal in Explorer', icon: 'reveal', action: () => studio.reveal(n.path) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, action: () => deleteNode(n) },
    );
    return items;
  }

  async function renameNode(n) {
    const body = document.createElement('div');
    body.innerHTML = `<div class="prow"><label>New name</label><input type="text" id="rnName" spellcheck="false"></div>`;
    const inp = $('#rnName', body); inp.value = n.name;
    await dialog({
      title: 'Rename', body,
      actions: [
        { label: 'Cancel', value: null },
        {
          label: 'Rename', primary: true,
          beforeClose: async (b) => {
            const name = $('#rnName', b).value.trim();
            if (!name || name === n.name) return false;
            const to = n.path.replace(/[^\\/]+$/, name);
            try { await studio.rename(n.path, to); } catch (e) { toast('err', 'Rename failed', String(e.message || e)); return false; }
            const open = S.files.find((f) => f.path === n.path);
            if (open) { open.path = to; open.name = name; Editor.renderTabs(); }
            await refreshTree();
            toast('ok', 'Renamed', name, 1800);
            return true;
          },
        },
      ],
    });
  }

  async function duplicateNode(n) {
    if (n.dir) { toast('warn', 'Folder duplication not supported'); return; }
    const copy = n.path.replace(/(\.[^.\\/]+)?$/, (m) => ' copy' + m);
    try { await studio.copy(n.path, copy); await refreshTree(); toast('ok', 'Duplicated', copy.split(/[\\/]/).pop(), 1800); }
    catch (e) { toast('err', 'Duplicate failed', String(e.message || e)); }
  }

  async function deleteNode(n) {
    const ok = await confirmDialog('Delete ' + (n.dir ? 'folder' : 'file'),
      `Move <b>${n.name}</b> to the Recycle Bin?`, 'Delete');
    if (!ok) return;
    try {
      await studio.trash(n.path);
      const open = S.files.find((f) => f.path === n.path);
      if (open) await Editor.closeFile(open);
      await refreshTree();
      toast('ok', 'Moved to Recycle Bin', n.name, 2200);
    } catch (e) { toast('err', 'Delete failed', String(e.message || e)); }
  }

  /* ── components palette ─────────────────────────────── */
  const COMPONENTS = [
    { id: 'section', label: 'Section', icon: 'section', html: '<section style="padding:60px 24px">\n  <h2>Section title</h2>\n  <p>Section content goes here.</p>\n</section>' },
    { id: 'heading', label: 'Heading', icon: 'heading', html: '<h2>New heading</h2>' },
    { id: 'paragraph', label: 'Paragraph', icon: 'paragraph', html: '<p>New paragraph text. Double-click in the preview to edit it, or use the Properties panel.</p>' },
    { id: 'image', label: 'Image', icon: 'image', html: '<img src="https://placehold.co/600x400" alt="Placeholder" style="max-width:100%">' },
    { id: 'button', label: 'Button', icon: 'button', html: '<a href="#" style="display:inline-block;padding:10px 24px;background:#0F6CBD;color:#fff;text-decoration:none;border-radius:6px">Button</a>' },
    { id: 'link', label: 'Link', icon: 'link', html: '<a href="#">New link</a>' },
    { id: 'divider', label: 'Divider', icon: 'divider', html: '<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">' },
    { id: 'spacer', label: 'Spacer', icon: 'spacer', html: '<div style="height:48px"></div>' },
    { id: 'columns', label: '2 Columns', icon: 'columns', html: '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">\n  <div>\n    <h3>Column one</h3>\n    <p>Content.</p>\n  </div>\n  <div>\n    <h3>Column two</h3>\n    <p>Content.</p>\n  </div>\n</div>' },
    { id: 'list', label: 'List', icon: 'list', html: '<ul>\n  <li>First item</li>\n  <li>Second item</li>\n  <li>Third item</li>\n</ul>' },
  ];

  function buildComponents() {
    const box = $('#componentList');
    box.innerHTML = '';
    for (const c of COMPONENTS) {
      const el = document.createElement('div');
      el.className = 'comp';
      el.draggable = true;
      el.innerHTML = `${ICONS[c.icon]}<span></span>`;
      $('span', el).textContent = c.label;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/ps-component', c.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      box.appendChild(el);
    }
  }
  function componentHtml(id) {
    const c = COMPONENTS.find((x) => x.id === id);
    return c ? c.html : null;
  }

  /* ── search ─────────────────────────────────────────── */
  let searchTimer = 0;
  function initSearch() {
    const inp = $('#searchInput');
    inp.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 350);
    });
    $('#searchRegex').addEventListener('change', runSearch);
  }
  async function runSearch() {
    const q = $('#searchInput').value.trim();
    const box = $('#searchResults');
    if (!q || !S.project) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="sr-file">Searching…</div>';
    const results = await studio.searchProject(S.project, q, $('#searchRegex').checked);
    box.innerHTML = '';
    if (!results.length) { box.innerHTML = '<div class="sr-file muted">No results</div>'; return; }
    let lastFile = '';
    for (const r of results) {
      if (r.file !== lastFile) {
        lastFile = r.file;
        const fh = document.createElement('div');
        fh.className = 'sr-file';
        fh.textContent = r.file.replace(S.project, '').replace(/^[\\/]/, '');
        box.appendChild(fh);
      }
      const hit = document.createElement('div');
      hit.className = 'sr-hit';
      hit.innerHTML = `<span class="ln"></span><span class="tx"></span>`;
      $('.ln', hit).textContent = r.line;
      $('.tx', hit).textContent = r.text;
      hit.addEventListener('click', async () => {
        await Editor.openFile(r.file);
        Editor.gotoLine(r.line);
        if (S.view === 'design') setView('split');
      });
      box.appendChild(hit);
    }
  }
  function focusSearch() {
    switchLeftTab('search');
    $('#searchInput').focus();
  }

  /* ── left panel tabs ────────────────────────────────── */
  function switchLeftTab(view) {
    if ($('#panelLeft').classList.contains('collapsed')) togglePanel('panelLeft');
    $$('#leftTabs .ptab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $$('#leftBody .pview').forEach((v) => v.classList.toggle('active', v.id === 'view' + view[0].toUpperCase() + view.slice(1)));
  }
  function initTabs() {
    $$('#leftTabs .ptab').forEach((t) => t.addEventListener('click', () => switchLeftTab(t.dataset.view)));
    $('#btnRefreshTree').addEventListener('click', refreshTree);
    $('#btnCollapseTree').addEventListener('click', () => {
      $$('#fileTree .tnode.expanded').forEach((x) => x.classList.remove('expanded'));
      $$('#fileTree .tchildren').forEach((x) => x.classList.add('hide'));
    });
  }

  /* ── restore a pre-save snapshot ────────────────────── */
  async function restoreDialog() {
    if (!S.active) return;
    const f = S.active;
    const list = await studio.backupList(f.path);
    const body = document.createElement('div');
    if (!list.length) {
      body.innerHTML = `<p>No earlier versions of <b>${f.name}</b> yet. A snapshot is kept automatically every time you save.</p>`;
      await dialog({ title: 'Restore Previous Version', body, actions: [{ label: 'Close', primary: true, value: true }] });
      return;
    }
    const intro = document.createElement('p');
    intro.style.margin = '4px 0 10px';
    intro.textContent = `Every save keeps a snapshot of ${f.name} from just before. Pick one to bring back:`;
    body.appendChild(intro);
    const sel = document.createElement('select');
    sel.style.width = '100%';
    for (const b of list) {
      const op = document.createElement('option');
      op.value = b.name;
      const d = new Date(b.ts);
      op.textContent = d.toLocaleDateString() + '  ' + d.toLocaleTimeString() + '   ·   ' + (b.size / 1024).toFixed(1) + ' KB';
      sel.appendChild(op);
    }
    body.appendChild(sel);
    const note = document.createElement('p');
    note.className = 'muted';
    note.style.cssText = 'font-size:11.5px;margin-top:10px';
    note.textContent = 'The version is loaded into the editor — nothing is overwritten until you press Save. Ctrl+Z undoes the restore.';
    body.appendChild(note);
    await dialog({
      title: 'Restore Previous Version', body,
      actions: [
        { label: 'Cancel', value: null },
        {
          label: 'Restore', primary: true,
          beforeClose: async (b) => {
            const name = $('select', b).value;
            let text;
            try { text = await studio.backupRead(f.path, name); }
            catch (e) { toast('err', 'Could not read that snapshot', String(e.message || e)); return false; }
            const m = f.model;
            S.suppressAuto = true;
            try {
              m.pushEditOperations([], [{ range: m.getFullModelRange(), text }], () => null);
            } finally { S.suppressAuto = false; }
            ChangeLog.note(f.path, 'restore:' + Date.now(), 'Brought back an older version from ' + name.replace(/\.[a-z]+$/i, ''));
            Preview.update(false);
            toast('ok', 'Version restored', 'Press Save to keep it, or Ctrl+Z to go back.', 4500);
            return true;
          },
        },
      ],
    });
  }

  return {
    openProject, openSamples, newProject, newFile, openLooseFile,
    refreshTree, highlightFile, buildComponents, componentHtml,
    initSearch, initTabs, focusSearch, switchLeftTab, restoreDialog,
  };
})();
