/* PHP Studio — live preview: iframe, inspector bridge, navigator, devices. */
'use strict';

window.Preview = (function () {
  const frame = () => $('#previewFrame');
  let pendingReselect = null;
  let lastSelectedId = null;
  let outlineTimer = 0;

  /* ── update pipeline ────────────────────────────────── */
  let updating = false, queued = false;
  async function update(keepSelection = true) {
    if (!S.active || !S.project) return;
    if (!/\.(php|html?)$/i.test(S.active.path)) return; // only pages preview
    if (updating) { queued = true; return; }
    updating = true;
    try {
      const r = await studio.previewUpdate(S.project, S.active.path, S.active.model.getValue());
      S.map = r.map;
      S.previewUrl = r.url;
      $('#previewUrl').textContent = r.url;
      sbServer(true);
      if (keepSelection && lastSelectedId) pendingReselect = lastSelectedId;
      // cache-buster forces a reload; the iframe is cross-origin so we cannot
      // touch contentWindow.location directly (url already carries ?pstoken)
      frame().src = r.url + '&t=' + Date.now();
    } catch (e) {
      sbServer(false, true);
      toast('err', 'Preview failed', String(e.message || e));
    } finally {
      updating = false;
      if (queued) { queued = false; update(keepSelection); }
    }
  }

  /* Silent update: rewrite the served copy + refresh the source map, but keep
   * the live DOM as-is (it was already patched in place). No flicker. */
  let silentTimer = 0;
  function updateSilent() {
    clearTimeout(silentTimer);
    silentTimer = setTimeout(async () => {
      if (!S.active || !S.project) return;
      try {
        const r = await studio.previewUpdate(S.project, S.active.path, S.active.model.getValue());
        S.map = r.map;
        S.previewUrl = r.url;
        sbServer(true);
      } catch (e) { /* next full update will surface it */ }
    }, 250);
  }

  function patch(msg) { post(msg); }

  function showFile(f) {
    if (/\.(php|html?)$/i.test(f.path)) {
      lastSelectedId = null;
      Props.clear();
      update(false);
    }
  }
  function clear() {
    frame().src = 'about:blank';
    S.map = {};
    Props.clear();
    $('#navTree').innerHTML = '';
  }
  function refresh() { update(true); toastOnce(); }
  let toastShown = false;
  function toastOnce() { if (!toastShown) { toastShown = true; } sbMessage('Preview refreshed'); setTimeout(() => sbMessage(''), 1600); }

  /* ── inspector messaging ────────────────────────────── */
  function post(msg) {
    try { frame().contentWindow.postMessage(msg, '*'); } catch (e) {}
  }

  function toggleInspect(force) {
    S.inspecting = force !== undefined ? force : !S.inspecting;
    post({ psCmd: 'mode', inspect: S.inspecting });
    syncToolbar();
    sbMessage(S.inspecting ? 'Inspect mode — click any element' : '');
  }

  function select(id, smooth) {
    post({ psCmd: 'select', id: String(id), smooth: smooth !== false });
  }

  addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m.ps) return;
    switch (m.ps) {
      case 'ready':
        sbServer(true);
        if (S.inspecting) post({ psCmd: 'mode', inspect: true });
        if (pendingReselect) { post({ psCmd: 'reselect', id: parseInt(pendingReselect, 10) }); pendingReselect = null; }
        requestOutline();
        break;
      case 'select':
        lastSelectedId = m.el.id;
        S.selected = m.el;
        Props.show(m.el);
        highlightNav(m.el.id);
        break;
      case 'edit-text':
        Props.startTextEdit(m.id);
        break;
      case 'drop': {
        const html = Project.componentHtml(m.component);
        if (html && Edits.insertNear(m.targetId, m.position, html)) {
          toast('ok', 'Component added', '', 1600);
          if (S.active) ChangeLog.note(S.active.path, 'add:' + Date.now(), `Added a ${m.component} to the page`);
          update(true);
        }
        break;
      }
      case 'outline':
        renderNav(m.tree || []);
        break;
      case 'php-error':
        sbServer(true, true);
        toast('err', 'PHP error detected', m.message + (m.line ? ` (line ${m.line})` : ''), 6000);
        break;
      case 'js-error':
        sbMessage('Page JS error: ' + m.message);
        break;
    }
  });

  /* ── navigator ──────────────────────────────────────── */
  function requestOutline() {
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => post({ psCmd: 'outline' }), 250);
  }

  function renderNav(tree) {
    const box = $('#navTree');
    box.innerHTML = '';
    const build = (nodes, parent, depth) => {
      for (const n of nodes) {
        const el = document.createElement('div');
        el.className = 'tnode';
        if (n.id) el.dataset.psid = n.id;
        const hasKids = n.children && n.children.length;
        const label = n.tag + (n.elid ? '#' + n.elid : '') + (n.cls ? '.' + n.cls.split('.')[0] : '');
        el.innerHTML = `<span class="twist">${hasKids ? ICONS.chevron : ''}</span><span class="tlabel mono" style="font-size:11.5px"></span><span class="tmeta"></span>`;
        $('.tlabel', el).textContent = label;
        if (n.text) $('.tmeta', el).textContent = n.text;
        parent.appendChild(el);
        let kidsBox = null;
        if (hasKids) {
          kidsBox = document.createElement('div');
          kidsBox.className = 'tchildren' + (depth >= 2 ? ' hide' : '');
          if (depth < 2) el.classList.add('expanded');
          build(n.children, kidsBox, depth + 1);
          parent.appendChild(kidsBox);
        }
        $('.twist', el).addEventListener('click', (e) => {
          e.stopPropagation();
          if (kidsBox) { el.classList.toggle('expanded'); kidsBox.classList.toggle('hide'); }
        });
        el.addEventListener('click', () => {
          if (n.id) { select(n.id); }
        });
        el.addEventListener('mouseenter', () => { if (n.id) post({ psCmd: 'highlight', id: n.id }); });
        el.addEventListener('mouseleave', () => post({ psCmd: 'highlight', id: null }));
      }
    };
    build(tree, box, 0);
  }

  function highlightNav(id) {
    $$('#navTree .tnode').forEach((x) => x.classList.toggle('selected', x.dataset.psid === String(id)));
    const sel = $(`#navTree .tnode[data-psid="${id}"]`);
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  /* ── devices ────────────────────────────────────────── */
  function initDevices() {
    $$('#deviceBar .dev-btn').forEach((b) => {
      b.addEventListener('click', () => {
        $$('#deviceBar .dev-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const w = parseInt(b.dataset.w, 10);
        const wrap = $('#previewFrameWrap');
        if (!w) { wrap.style.maxWidth = '100%'; wrap.classList.remove('device'); }
        else { wrap.style.maxWidth = w + 'px'; wrap.classList.add('device'); }
      });
    });
    $('#btnPreviewRefresh').addEventListener('click', refresh);
    $('#btnPreviewExternal').addEventListener('click', () => {
      if (S.previewUrl) studio.openExternal(S.previewUrl);
    });
    $('#btnNavRefresh').addEventListener('click', requestOutline);
  }

  return {
    update, updateSilent, patch, refresh, showFile, clear, toggleInspect,
    select, initDevices, requestOutline,
    get lastSelectedId() { return lastSelectedId; },
  };
})();
