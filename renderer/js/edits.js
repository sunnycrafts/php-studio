/* PHP Studio — source edit operations.
 * Every visual edit is translated into a precise text replacement on the
 * Monaco model (so undo/redo works), using the instrumenter's offset map. */
'use strict';

window.Edits = (function () {

  function model() { return S.active ? S.active.model : null; }
  function node(id) { return S.map[id] || null; }

  function replaceRange(startOff, endOff, text) {
    const m = model();
    if (!m) return false;
    const start = m.getPositionAt(startOff);
    const end = m.getPositionAt(endOff);
    // panel edits keep the preview in sync themselves — don't let the
    // "user is typing" auto-refresh path force a full reload on top
    S.suppressAuto = true;
    try {
      m.pushEditOperations([], [{
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        text,
      }], () => null);
    } finally { S.suppressAuto = false; }
    return true;
  }

  function insertAt(off, text) { return replaceRange(off, off, text); }

  /* ── open-tag attribute surgery ─────────────────────── */
  function openTag(n) {
    const m = model();
    return m.getValue().slice(n.openStart, n.openEnd);
  }

  /** Set (or remove, when value===null) an attribute on the element's open tag. */
  function setAttr(id, name, value) {
    const n = node(id);
    if (!n) return false;
    const tag = openTag(n);
    // find existing attribute in the open tag text (skip if inside <?php ?>)
    const re = new RegExp('([\\s])(' + name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&') + ')\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i');
    const mres = re.exec(tag);
    if (mres) {
      const phpStart = tag.indexOf('<?');
      if (phpStart !== -1 && mres.index > phpStart) return false; // attr may be inside PHP — refuse
      const attrStart = n.openStart + mres.index + mres[1].length;
      const attrEnd = attrStart + mres[0].length - mres[1].length;
      if (value === null) return replaceRange(n.openStart + mres.index, attrEnd, '');
      return replaceRange(attrStart, attrEnd, `${mres[2]}="${escapeAttr(value)}"`);
    }
    if (value === null) return true;
    // insert new attribute right after the tag name (and past our own data-psid if present in source — it isn't)
    const nameEnd = n.openStart + 1 + n.tag.length;
    return insertAt(nameEnd, ` ${name}="${escapeAttr(value)}"`);
  }

  function escapeAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

  /* ── inline style ───────────────────────────────────── */
  function parseStyle(s) {
    const out = {};
    for (const part of (s || '').split(';')) {
      const i = part.indexOf(':');
      if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
    return out;
  }
  function serializeStyle(obj) {
    return Object.entries(obj).filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => `${k}:${v}`).join(';');
  }
  function setStyle(id, prop, value) {
    const n = node(id);
    if (!n) return false;
    const current = S.selected && String(S.selected.id) === String(id) ? S.selected.inline : (n.attrs.style || '');
    const styles = parseStyle(current);
    if (value === '' || value == null) delete styles[prop];
    else styles[prop] = value;
    const txt = serializeStyle(styles);
    return setAttr(id, 'style', txt === '' ? null : txt);
  }

  /* ── text content ───────────────────────────────────── */
  function canEditText(id) {
    const n = node(id);
    return !!(n && n.closeStart >= 0 && n.closeStart >= n.openEnd && !n.innerPhp);
  }
  function setText(id, text) {
    const n = node(id);
    if (!n || !canEditText(id)) return false;
    // the Text box edits inner *source* (may legitimately contain tags like <em>)
    return replaceRange(n.openEnd, n.closeStart, text);
  }
  function getInnerSource(id) {
    const n = node(id);
    if (!n || n.closeStart < 0) return null;
    return model().getValue().slice(n.openEnd, n.closeStart);
  }

  /* ── structure ──────────────────────────────────────── */
  function indentOf(n) {
    const m = model();
    const pos = m.getPositionAt(n.openStart);
    const line = m.getLineContent(pos.lineNumber);
    const ws = /^[\t ]*/.exec(line)[0];
    return ws;
  }
  function insertNear(id, position, html) {
    const n = node(id);
    if (!n) return false;
    const ind = indentOf(n);
    const block = html.split('\n').map((l, i) => (i === 0 ? l : ind + l)).join('\n');
    if (position === 'before') return insertAt(n.openStart, block + '\n' + ind);
    const end = n.closeEnd >= 0 ? n.closeEnd : n.openEnd;
    return insertAt(end, '\n' + ind + block);
  }
  function removeElement(id) {
    const n = node(id);
    if (!n) return false;
    const m = model();
    const end = n.closeEnd >= 0 ? n.closeEnd : n.openEnd;
    // eat leading whitespace-only line remainder
    let start = n.openStart;
    const text = m.getValue();
    let ls = start;
    while (ls > 0 && text[ls - 1] !== '\n' && /\s/.test(text[ls - 1])) ls--;
    if (ls === 0 || text[ls - 1] === '\n') start = ls > 0 ? ls - 1 : 0;
    return replaceRange(start, end, '');
  }
  function duplicateElement(id) {
    const n = node(id);
    if (!n) return false;
    const m = model();
    const end = n.closeEnd >= 0 ? n.closeEnd : n.openEnd;
    const src = m.getValue().slice(n.openStart, end);
    const ind = indentOf(n);
    return insertAt(end, '\n' + ind + src);
  }
  function copyElementSource(id) {
    const n = node(id);
    if (!n) return '';
    const end = n.closeEnd >= 0 ? n.closeEnd : n.openEnd;
    return model().getValue().slice(n.openStart, end);
  }

  /* ── CSS rule editing (style blocks in the same file) ── */
  function findRule(selector) {
    const m = model();
    const text = m.getValue();
    const esc = selector.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp('(^|[}{;\\n])\\s*(' + esc + ')\\s*\\{', 'm');
    const mres = re.exec(text);
    if (!mres) return null;
    const braceOpen = text.indexOf('{', mres.index + mres[1].length);
    const braceClose = text.indexOf('}', braceOpen);
    if (braceOpen === -1 || braceClose === -1) return null;
    return { bodyStart: braceOpen + 1, bodyEnd: braceClose };
  }
  function setRuleProp(selector, prop, value) {
    const loc = findRule(selector);
    if (!loc) return false;
    const m = model();
    const body = m.getValue().slice(loc.bodyStart, loc.bodyEnd);
    const re = new RegExp('([\\s;]|^)(' + prop.replace(/[-]/g, '\\-') + ')\\s*:\\s*([^;}]+)', 'i');
    const mres = re.exec(body);
    if (mres) {
      const valStart = loc.bodyStart + mres.index + mres[1].length + mres[2].length;
      const rest = body.slice(mres.index + mres[1].length + mres[2].length);
      const colon = rest.indexOf(':');
      const valAbs = loc.bodyStart + mres.index + mres[1].length + mres[2].length + colon + 1;
      const valEnd = loc.bodyStart + mres.index + mres[0].length;
      return replaceRange(valAbs, valEnd, ' ' + value);
    }
    return insertAt(loc.bodyEnd, `  ${prop}: ${value};\n`);
  }

  return {
    setAttr, setStyle, setText, canEditText, getInnerSource,
    insertNear, removeElement, duplicateElement, copyElementSource,
    setRuleProp, parseStyle,
  };
})();
