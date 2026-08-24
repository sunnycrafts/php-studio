/**
 * PHP Studio — source instrumenter.
 * Parses mixed PHP/HTML source, builds an element map with byte offsets into
 * the ORIGINAL text, and produces an instrumented copy where every mappable
 * open tag gains a data-psid attribute. The map is what lets visual edits be
 * written back to the exact source ranges.
 *
 * Tolerant by design: unbalanced tags never throw; unmappable regions are
 * simply not instrumented (they render but aren't visually editable).
 */
'use strict';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const SKIP_TAGS = new Set(['html', 'head', 'title', 'meta', 'link', 'base']);
const RAW_TEXT = new Set(['script', 'style', 'textarea']);

/** Find all PHP regions: [{start, end}] (end exclusive; unterminated → EOF). */
function phpRegions(src) {
  const regions = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('<?', i);
    if (open === -1) break;
    const close = src.indexOf('?>', open + 2);
    if (close === -1) { regions.push({ start: open, end: src.length }); break; }
    regions.push({ start: open, end: close + 2 });
    i = close + 2;
  }
  return regions;
}

function makeRegionIndex(regions) {
  return {
    regions,
    /** PHP region starting at exactly pos, or null. */
    at(pos) {
      for (const r of regions) if (r.start === pos) return r;
      return null;
    },
    /** Does [a,b) intersect any PHP region? */
    intersects(a, b) {
      for (const r of regions) if (r.start < b && r.end > a) return true;
      return false;
    },
  };
}

/**
 * Scan one open tag starting at `pos` (src[pos] === '<', next char letter).
 * Skips embedded PHP blocks and quoted strings. Returns
 * { tag, end, selfClosed, attrs: [{name, valStart, valEnd, quote, nameStart, php}] } or null.
 */
function scanOpenTag(src, pos, rx) {
  let i = pos + 1;
  let tag = '';
  while (i < src.length && /[a-zA-Z0-9:-]/.test(src[i])) { tag += src[i]; i++; }
  if (!tag) return null;
  const tagEnd = i;
  const attrs = [];
  let selfClosed = false;
  let hasPhp = false;

  while (i < src.length) {
    const phpr = rx.at(i);
    if (phpr) { hasPhp = true; i = phpr.end; continue; }
    const c = src[i];
    if (c === '>') { i++; break; }
    if (c === '/' && src[i + 1] === '>') { selfClosed = true; i += 2; break; }
    if (c === '"' || c === "'") {           // stray quoted chunk
      const q = src.indexOf(c, i + 1);
      i = q === -1 ? src.length : q + 1;
      continue;
    }
    if (/[\s]/.test(c)) { i++; continue; }
    // attribute name
    let ns = i, name = '';
    while (i < src.length && /[^\s=>/]/.test(src[i]) && !rx.at(i)) { name += src[i]; i++; }
    if (!name) { i++; continue; }
    // skip ws
    while (i < src.length && /\s/.test(src[i])) i++;
    let valStart = -1, valEnd = -1, quote = '';
    if (src[i] === '=') {
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === '"' || src[i] === "'") {
        quote = src[i];
        valStart = i + 1;
        let j = i + 1;
        while (j < src.length) {
          const pr = rx.at(j);
          if (pr) { hasPhp = true; j = pr.end; continue; }
          if (src[j] === quote) break;
          j++;
        }
        valEnd = j;
        i = j + 1;
      } else {                              // unquoted value
        valStart = i;
        while (i < src.length && /[^\s>]/.test(src[i]) && !rx.at(i)) i++;
        valEnd = i;
      }
    }
    attrs.push({
      name: name.toLowerCase(), nameStart: ns, valStart, valEnd, quote,
      php: valStart !== -1 && rx.intersects(valStart, valEnd),
    });
  }
  return { tag: tag.toLowerCase(), tagEnd, end: i, selfClosed, attrs, hasPhp };
}

/**
 * Parse + instrument.
 * @returns { instrumented, map, count }
 *   map[id] = { id, tag, openStart, openEnd, closeStart, closeEnd,
 *               innerPhp, attrPhp, parent, attrs:{name:value|null} }
 */
function instrument(src) {
  const rx = makeRegionIndex(phpRegions(src));
  const map = {};
  const stack = [];       // { tag, id, node }
  const inserts = [];     // { pos, text } — data-psid insertions
  let nextId = 1;
  let i = 0;

  while (i < src.length) {
    const phpr = rx.at(i);
    if (phpr) { i = phpr.end; continue; }
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    if (lt !== i) { i = lt; continue; }

    // comments / doctype / cdata
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      i = e === -1 ? src.length : e + 3;
      continue;
    }
    if (src[i + 1] === '!') { const e = src.indexOf('>', i); i = e === -1 ? src.length : e + 1; continue; }

    // close tag
    if (src[i + 1] === '/') {
      const m = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>/.exec(src.slice(i, i + 60));
      if (m) {
        const tag = m[1].toLowerCase();
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].tag === tag) {
            const closed = stack.splice(s);           // pop this + anything above
            const node = closed[0].node;
            if (node) {
              node.closeStart = i;
              node.closeEnd = i + m[0].length;
              node.innerPhp = rx.intersects(node.openEnd, node.closeStart);
            }
            break;
          }
        }
        i += m[0].length;
      } else i += 2;
      continue;
    }

    // open tag
    if (/[a-zA-Z]/.test(src[i + 1])) {
      const t = scanOpenTag(src, i, rx);
      if (!t) { i++; continue; }

      // raw-text elements: skip content to matching close, never instrument inside
      if (RAW_TEXT.has(t.tag)) {
        const closeRe = new RegExp('</' + t.tag + '\\s*>', 'i');
        const m = closeRe.exec(src.slice(t.end));
        i = m ? t.end + m.index + m[0].length : src.length;
        continue;
      }

      let node = null;
      if (!SKIP_TAGS.has(t.tag)) {
        const id = nextId++;
        node = {
          id, tag: t.tag,
          openStart: i, openEnd: t.end,
          closeStart: t.selfClosed || VOID_TAGS.has(t.tag) ? t.end : -1,
          closeEnd: t.selfClosed || VOID_TAGS.has(t.tag) ? t.end : -1,
          innerPhp: false,
          attrPhp: t.hasPhp,
          parent: stack.length ? (stack[stack.length - 1].node ? stack[stack.length - 1].node.id : null) : null,
          attrs: {},
        };
        for (const a of t.attrs) {
          node.attrs[a.name] = a.php || a.valStart === -1 ? null : src.slice(a.valStart, a.valEnd);
        }
        map[id] = node;
        inserts.push({ pos: t.tagEnd, text: ` data-psid="${id}"` });
      }
      if (!t.selfClosed && !VOID_TAGS.has(t.tag)) {
        stack.push({ tag: t.tag, node });
      }
      i = t.end;
      continue;
    }
    i++;
  }

  // anything still open: closeStart stays -1 (text edits disabled for those)

  // apply insertions back-to-front
  let out = src;
  inserts.sort((a, b) => b.pos - a.pos);
  for (const ins of inserts) out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);

  return { instrumented: out, map, count: nextId - 1 };
}

module.exports = { instrument, phpRegions };
