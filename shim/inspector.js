/**
 * PHP Studio — in-preview inspector.
 * Injected by router.php into every previewed page. Talks to the host app
 * (parent frame) via postMessage. Provides hover/select overlays, computed
 * style + matched CSS rule reporting, a DOM outline for the Navigator panel,
 * and drag-and-drop insertion indicators.
 */
(function () {
  'use strict';
  if (window.__psInspector) return;
  window.__psInspector = true;

  var inspecting = false;
  var selectedId = null;
  var host = window.parent;

  /* ── Overlays ─────────────────────────────────────── */
  function mkBox(color, dash) {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483640;display:none;' +
      'border:1.5px ' + (dash ? 'dashed' : 'solid') + ' ' + color + ';border-radius:2px;' +
      'box-shadow:0 0 0 1px rgba(255,255,255,.35);transition:all .06s ease-out;';
    document.documentElement.appendChild(d);
    return d;
  }
  var hoverBox = mkBox('#0F6CBD', true);
  var selBox = mkBox('#0F6CBD', false);
  var tagLabel = document.createElement('div');
  tagLabel.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483641;display:none;' +
    'background:#0F6CBD;color:#fff;font:600 11px "Segoe UI",sans-serif;padding:2px 8px;' +
    'border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:nowrap;';
  document.documentElement.appendChild(tagLabel);
  var dropLine = document.createElement('div');
  dropLine.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483642;display:none;' +
    'height:3px;background:#0F6CBD;border-radius:2px;box-shadow:0 0 6px rgba(15,108,189,.8);';
  document.documentElement.appendChild(dropLine);

  function positionBox(box, el) {
    if (!el) { box.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = (r.left - 2) + 'px';
    box.style.top = (r.top - 2) + 'px';
    box.style.width = (r.width + 2) + 'px';
    box.style.height = (r.height + 2) + 'px';
  }

  function elFor(id) {
    return document.querySelector('[data-psid="' + id + '"]');
  }
  function psTarget(el) {
    while (el && el !== document.documentElement) {
      if (el.getAttribute && el.getAttribute('data-psid')) return el;
      el = el.parentElement;
    }
    return null;
  }

  /* ── Element description for the properties panel ── */
  var STYLE_PROPS = [
    'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height',
    'letter-spacing', 'text-align', 'text-transform', 'display', 'position',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-radius', 'border-width', 'border-style', 'border-color',
    'width', 'height', 'max-width', 'opacity', 'gap', 'flex-direction',
    'justify-content', 'align-items', 'grid-template-columns', 'box-shadow',
  ];

  function matchedRules(el) {
    var out = [];
    try {
      for (var s = 0; s < document.styleSheets.length; s++) {
        var rules;
        try { rules = document.styleSheets[s].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (var r = 0; r < rules.length; r++) {
          collectRule(rules[r], el, out, '');
        }
      }
    } catch (e) { /* ignore */ }
    return out.slice(-12); // later rules win — keep the most specific tail
  }
  function collectRule(rule, el, out, media) {
    if (rule.type === 1) { // style rule
      var sel = rule.selectorText;
      if (!sel) return;
      var parts = sel.split(',');
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim().replace(/::?(hover|focus|active|before|after|focus-visible|focus-within|visited)/g, '');
        if (!p) continue;
        try {
          if (el.matches(p)) {
            var props = {};
            for (var j = 0; j < rule.style.length; j++) {
              var name = rule.style[j];
              props[name] = rule.style.getPropertyValue(name);
            }
            out.push({ selector: sel.trim(), media: media, props: props });
            return;
          }
        } catch (e) { /* bad selector for matches() */ }
      }
    } else if (rule.type === 4 && rule.cssRules) { // @media
      var mediaText = rule.media ? rule.media.mediaText : '';
      var applies = true;
      try { applies = window.matchMedia(mediaText).matches; } catch (e) {}
      if (!applies) return;
      for (var k = 0; k < rule.cssRules.length; k++) collectRule(rule.cssRules[k], el, out, mediaText);
    }
  }

  function describe(el) {
    var id = el.getAttribute('data-psid');
    var cs = getComputedStyle(el);
    var styles = {};
    for (var i = 0; i < STYLE_PROPS.length; i++) styles[STYLE_PROPS[i]] = cs.getPropertyValue(STYLE_PROPS[i]);
    var attrs = {};
    for (var a = 0; a < el.attributes.length; a++) {
      var at = el.attributes[a];
      if (at.name !== 'data-psid') attrs[at.name] = at.value;
    }
    var directText = '';
    var hasElementChild = false;
    for (var c = 0; c < el.childNodes.length; c++) {
      var n = el.childNodes[c];
      if (n.nodeType === 3) directText += n.nodeValue;
      else if (n.nodeType === 1) hasElementChild = true;
    }
    return {
      id: id,
      tag: el.tagName.toLowerCase(),
      attrs: attrs,
      styles: styles,
      inline: el.getAttribute('style') || '',
      text: el.innerText ? el.innerText.slice(0, 800) : '',
      directText: directText.trim(),
      hasElementChild: hasElementChild,
      childCount: el.children.length,
      rules: matchedRules(el),
      rect: (function (r) { return { x: r.x, y: r.y, w: r.width, h: r.height }; })(el.getBoundingClientRect()),
    };
  }

  /* ── DOM outline for Navigator ─────────────────────── */
  function outline(root, depth) {
    var out = [];
    var kids = (root || document.body).children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      var id = el.getAttribute('data-psid');
      var node = {
        id: id || null,
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.'),
        elid: el.id || '',
        text: '',
        children: depth < 24 ? outline(el, (depth || 0) + 1) : [],
      };
      if (!node.children.length && el.innerText) node.text = el.innerText.trim().slice(0, 36);
      out.push(node);
    }
    return out;
  }

  /* ── Events ────────────────────────────────────────── */
  document.addEventListener('mousemove', function (e) {
    if (!inspecting) return;
    var t = psTarget(e.target);
    positionBox(hoverBox, t);
    if (t) {
      var r = t.getBoundingClientRect();
      tagLabel.style.display = 'block';
      var cls = (typeof t.className === 'string' && t.className) ? '.' + t.className.split(/\s+/).filter(Boolean)[0] : '';
      tagLabel.textContent = t.tagName.toLowerCase() + cls + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
      var top = r.top - 26;
      if (top < 4) top = r.top + 4;
      tagLabel.style.left = Math.max(4, r.left - 2) + 'px';
      tagLabel.style.top = top + 'px';
    } else tagLabel.style.display = 'none';
  }, true);

  document.addEventListener('click', function (e) {
    if (!inspecting) return;
    e.preventDefault();
    e.stopPropagation();
    var t = psTarget(e.target);
    if (t) {
      selectedId = t.getAttribute('data-psid');
      positionBox(selBox, t);
      send({ ps: 'select', el: describe(t) });
    }
  }, true);

  document.addEventListener('dblclick', function (e) {
    if (!inspecting) return;
    e.preventDefault();
    var t = psTarget(e.target);
    if (t) send({ ps: 'edit-text', id: t.getAttribute('data-psid') });
  }, true);

  // keep overlays glued on scroll/resize
  var reposition = function () {
    if (selectedId) positionBox(selBox, elFor(selectedId));
    hoverBox.style.display = 'none';
    tagLabel.style.display = 'none';
  };
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });

  // persist scroll position across reloads
  var SKEY = 'ps-scroll';
  try {
    var saved = sessionStorage.getItem(SKEY);
    if (saved) {
      var xy = JSON.parse(saved);
      window.addEventListener('load', function () { window.scrollTo(xy[0], xy[1]); });
      if (document.readyState === 'complete') window.scrollTo(xy[0], xy[1]);
      else setTimeout(function () { window.scrollTo(xy[0], xy[1]); }, 60);
    }
  } catch (e) {}
  window.addEventListener('scroll', function () {
    try { sessionStorage.setItem(SKEY, JSON.stringify([window.scrollX, window.scrollY])); } catch (e) {}
  }, { passive: true });

  /* ── Drag & drop from the Components panel ─────────── */
  var dropTarget = null, dropPos = 'after';
  document.addEventListener('dragover', function (e) {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    var t = psTarget(e.target);
    if (!t) { dropLine.style.display = 'none'; dropTarget = null; return; }
    var r = t.getBoundingClientRect();
    dropPos = (e.clientY - r.top) < r.height / 2 ? 'before' : 'after';
    dropTarget = t;
    dropLine.style.display = 'block';
    dropLine.style.left = r.left + 'px';
    dropLine.style.width = r.width + 'px';
    dropLine.style.top = ((dropPos === 'before' ? r.top : r.bottom) - 1.5) + 'px';
    positionBox(hoverBox, t);
  }, true);
  document.addEventListener('dragleave', function (e) {
    if (e.target === document.documentElement) { dropLine.style.display = 'none'; }
  }, true);
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    dropLine.style.display = 'none';
    hoverBox.style.display = 'none';
    var kind = e.dataTransfer ? e.dataTransfer.getData('text/ps-component') : '';
    if (kind && dropTarget) {
      send({ ps: 'drop', component: kind, targetId: dropTarget.getAttribute('data-psid'), position: dropPos });
    }
    dropTarget = null;
  }, true);

  /* ── Messaging ─────────────────────────────────────── */
  function send(msg) { try { host.postMessage(msg, '*'); } catch (e) {} }

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || !m.psCmd) return;
    switch (m.psCmd) {
      case 'mode':
        inspecting = !!m.inspect;
        document.body.style.cursor = inspecting ? 'crosshair' : '';
        if (!inspecting) { hoverBox.style.display = 'none'; tagLabel.style.display = 'none'; }
        break;
      case 'select': {
        var el = elFor(m.id);
        selectedId = m.id;
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: m.smooth === false ? 'auto' : 'smooth' });
          setTimeout(function () { positionBox(selBox, el); send({ ps: 'select', el: describe(el) }); }, m.smooth === false ? 0 : 350);
        }
        break;
      }
      case 'reselect': { // after reload: nearest existing id
        var id = m.id, tries = 0, el2 = null;
        while (tries < 40 && id - tries > 0 && !(el2 = elFor(id - tries))) tries++;
        if (el2) {
          selectedId = el2.getAttribute('data-psid');
          positionBox(selBox, el2);
          send({ ps: 'select', el: describe(el2) });
        }
        break;
      }
      case 'clear':
        selectedId = null;
        selBox.style.display = 'none';
        break;
      case 'outline':
        send({ ps: 'outline', tree: outline(document.body, 0), title: document.title });
        break;
      case 'highlight': {
        var h = m.id ? elFor(m.id) : null;
        positionBox(hoverBox, h);
        break;
      }
      case 'selcolor': {
        var col = { green: '#2E9B4F', amber: '#B8860B', red: '#C0392B' }[m.level] || '#0F6CBD';
        selBox.style.borderColor = col;
        tagLabel.style.background = col;
        break;
      }
      case 'patch': {
        // live in-place edit — no reload, no flicker
        var pe = elFor(m.id);
        if (!pe) break;
        if (m.kind === 'style') {
          if (m.value == null || m.value === '') pe.style.removeProperty(m.prop);
          else pe.style.setProperty(m.prop, m.value);
        } else if (m.kind === 'attr') {
          if (m.value == null) pe.removeAttribute(m.name);
          else pe.setAttribute(m.name, m.value);
        } else if (m.kind === 'html') {
          pe.innerHTML = m.value;
        }
        if (selectedId) positionBox(selBox, elFor(selectedId));
        break;
      }
    }
  });

  /* Runtime JS errors → host status bar */
  window.addEventListener('error', function (e) {
    send({ ps: 'js-error', message: String(e.message || 'Script error'), line: e.lineno || 0 });
  });

  send({ ps: 'ready', title: document.title, url: location.pathname });
})();
