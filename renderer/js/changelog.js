/* PHP Studio — plain-English change diary.
 * Edits register human-readable notes keyed so repeats collapse (dragging a
 * color slider logs once, with the final value). Notes flush to the project
 * changelog on save. */
'use strict';

window.ChangeLog = (function () {
  const notes = new Map(); // filePath -> Map(key -> text)

  function note(filePath, key, text) {
    if (!filePath) return;
    let m = notes.get(filePath);
    if (!m) { m = new Map(); notes.set(filePath, m); }
    m.delete(key);          // re-insert so the latest wording lands last
    m.set(key, text);
  }
  function flush(filePath) {
    const m = notes.get(filePath);
    notes.delete(filePath);
    return m ? [...m.values()] : [];
  }
  function pending(filePath) {
    const m = notes.get(filePath);
    return m ? m.size : 0;
  }

  /* short human description of an element, e.g. `the heading ("Drashti Par…")` */
  const FRIENDLY = {
    h1: 'the big heading', h2: 'a heading', h3: 'a heading', h4: 'a heading',
    p: 'a paragraph', a: 'a link', img: 'a picture', button: 'a button',
    li: 'a list item', ul: 'a list', ol: 'a list', section: 'a section',
    div: 'a block', span: 'some text', table: 'a table', footer: 'the footer',
    header: 'the header', nav: 'the menu',
  };
  function describe(el) {
    const base = FRIENDLY[el.tag] || 'the <' + el.tag + '> element';
    const t = (el.directText || el.text || '').trim().replace(/\s+/g, ' ');
    return t ? `${base} ("${t.slice(0, 32)}${t.length > 32 ? '…' : ''}")` : base;
  }

  const PROP_LABELS = {
    'font-size': 'text size', 'font-weight': 'text thickness', color: 'text color',
    'text-align': 'alignment', 'text-transform': 'capitalisation', 'line-height': 'line spacing',
    'background-color': 'background color', 'border-radius': 'corner roundness',
    border: 'border', opacity: 'transparency', display: 'layout type',
    width: 'width', height: 'height', 'max-width': 'maximum width', gap: 'spacing between items',
    'justify-content': 'horizontal arrangement', 'align-items': 'vertical arrangement',
  };
  function propLabel(p) {
    if (PROP_LABELS[p]) return PROP_LABELS[p];
    if (p.startsWith('margin')) return 'outside spacing';
    if (p.startsWith('padding')) return 'inside spacing';
    return p;
  }

  return { note, flush, pending, describe, propLabel };
})();
