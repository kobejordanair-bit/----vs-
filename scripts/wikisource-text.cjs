'use strict';

// Conservative, offline reading-text extraction, not a MediaWiki renderer or an
// HTML sanitizer. Consumers must display the returned string with textContent.
// Unknown templates and page transclusions remain visible instead of vanishing.
// Observed in 1,400+ local corpus pages (2026-10-02): *, YL, ProperNoun, 專,
// +, quote, colors, ul, WavyBookMark, !, annotate, PUA, 另 and 校.
// A later 2,949-page scan added CBox, A/Linktoauthor and udots.
// Template semantics checked against zh.wikisource.org/wiki/Template:專,
// Template:YL, Template:!, and Template:校. No network or HTML execution occurs.
const extractionVersion = 'wikitext-conservative-v2.1.0';
const MAX_DEPTH = 96;
const INLINE = new Set(['專', '专', 'propernoun', '書', '书', 'wavybookmark', '標', '标',
  'ul', 'u', 'b', 'i', '楷體', '楷体', '+', '-', '--', '~~', 'pua', 'nowrap',
  'blue', 'red', 'green', 'deeppink', 'purple', 'orange', 'black', 'grey', 'gray',
  'udots', 'right', 'left', 'center']);
const NOTES = new Set(['*', '註', '注', '小字', '雙行註文', '双行注', '雙行注',
  '夾注', '夹注', '批', 'annotate', 'small', 'smaller']);
const NAVIGATION = new Set(['footer', 'novel-f', 'wikipedia', 'lzh-wikipedia',
  'zh-classical-wikipedia', 'textquality', 'anchor', 'alsosee', 'see also', 'seealso', 'zth']);
const STYLE_KEYS = new Set(['style', 'class', 'color', 'colour', 'size', 'width',
  'align', 'float', 'font', 'lang', 'id']);

function openerAt(value, index) {
  if (value.startsWith('{{{', index)) return ['{{{', '}}}'];
  if (value.startsWith('{{', index)) return ['{{', '}}'];
  if (value.startsWith('[[', index)) return ['[[', ']]'];
  if (value.startsWith('-{', index)) return ['-{', '}-'];
  if (value[index] === '[') return ['[', ']'];
  return null;
}

// Splitting before rendering is essential: {{!}} may itself produce a pipe.
function splitTopLevel(value, delimiter) {
  const parts = [], stack = [];
  let start = 0;
  for (let i = 0; i < value.length;) {
    const closing = stack[stack.length - 1];
    if (closing && value.startsWith(closing, i)) {
      stack.pop(); i += closing.length; continue;
    }
    const opening = openerAt(value, i);
    if (opening) { stack.push(opening[1]); i += opening[0].length; continue; }
    if (!stack.length && value.startsWith(delimiter, i)) {
      parts.push(value.slice(start, i)); i += delimiter.length; start = i;
    } else i++;
  }
  parts.push(value.slice(start));
  return parts;
}

function findEnd(value, start, opening) {
  const stack = [opening[1]];
  for (let i = start + opening[0].length; i < value.length;) {
    const closing = stack[stack.length - 1];
    if (value.startsWith(closing, i)) {
      stack.pop();
      if (!stack.length) return { bodyEnd: i, end: i + closing.length };
      i += closing.length; continue;
    }
    const next = openerAt(value, i);
    if (next) { stack.push(next[1]); i += next[0].length; }
    else i++;
  }
  return null;
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ensp: ' ', emsp: '　', thinsp: ' ', ndash: '–', mdash: '—', hellip: '…',
    middot: '·', laquo: '«', raquo: '»', shy: '', lrm: '', rlm: '' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] ?? all;
    const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : all;
  });
}

function plainText(raw) {
  if (typeof raw !== 'string') throw new TypeError('plainText expects a wikitext string');
  // Opaque extension bodies cannot split a surrounding template on their pipes.
  const slots = [];
  let tokenPrefix = '\uE000WS';
  while (raw.includes(tokenPrefix)) tokenPrefix += 'X';
  const hold = (kind, body) => tokenPrefix + (slots.push({ kind, body }) - 1) + '\uE001';
  let value = raw.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(nowiki|pre|syntaxhighlight|source)\b(?![^>]*\/\s*>)[^>]*>([\s\S]*?)<\/\1\s*>/gi,
      (_, tag, body) => hold('literal', body))
    .replace(/<ref\b(?![^>]*\/\s*>)[^>]*>([\s\S]*?)<\/ref\s*>/gi, (_, body) => hold('note', body))
    .replace(/<ref\b([^>]*?)\/\s*>/gi, (_, attrs) => {
      const name = attrs.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/]+))/i);
      return name ? '〔註參照：' + (name[1] ?? name[2] ?? name[3]) + '〕' : '〔註參照〕';
    })
    .replace(/<pages\b([^>]*?)(?:\/\s*>|>[\s\S]*?<\/pages\s*>)/gi,
      (_, attrs) => '〔未展開跨頁轉錄：' + attrs.trim() + '〕');

  function render(source, depth = 0) {
    if (depth > MAX_DEPTH) return source; // Keep the source if nesting is excessive.
    let out = '', cursor = 0;
    while (cursor < source.length) {
      const opening = openerAt(source, cursor);
      if (!opening) { out += source[cursor++]; continue; }
      const end = findEnd(source, cursor, opening);
      if (!end) { out += source.slice(cursor); break; }
      const original = source.slice(cursor, end.end);
      const body = source.slice(cursor + opening[0].length, end.bodyEnd);
      const nested = text => render(text, depth + 1);
      if (opening[0] === '{{') out += template(body, nested);
      else if (opening[0] === '{{{') out += original; // Never evaluate parameters/parser functions.
      else if (opening[0] === '[[') {
        const bits = splitTopLevel(body, '|'), target = bits[0].trim();
        if (/^(?:file|image|檔案|档案|文件):/i.test(target)) {
          const captions = bits.slice(1).filter(bit => !/^(?:(?:thumb(?:nail)?|frame(?:less)?|border|left|right|center|none|baseline|middle|sub|super|text-top|text-bottom|top|bottom|\d+(?:x\d+)?px)$|(?:link|class|lang|page)\s*=)/i.test(bit.trim()));
          out += '〔圖像未轉錄：' + nested(target.replace(/^[^:]+:/, ''))
            + (captions.length ? '；圖說：' + captions.map(nested).join('；') : '') + '〕';
        } else if (!/^(?:category|分類|分类):/i.test(target))
          out += nested(bits.length > 1 ? bits.slice(1).join('|') : target.replace(/^:/, ''));
      } else if (opening[0] === '-{') out += variant(body, nested, original);
      else {
        const external = body.match(/^(?:https?:\/\/|\/\/|mailto:)[^\s]+(?:\s+([\s\S]*))?$/i);
        out += external ? (external[1] ? nested(external[1]) : '[' + body + ']') : '[' + nested(body) + ']';
      }
      cursor = end.end;
    }
    return out;
  }

  function template(body, nested) {
    const fields = splitTopLevel(body, '|'), originalName = fields.shift().trim();
    const name = originalName.replace(/^(?:template|模板):\s*/i, '').toLowerCase();
    const positional = new Map(), named = new Map(), renderedFields = []; let position = 1;
    for (const field of fields) {
      const pair = splitTopLevel(field, '=');
      if (pair.length > 1) {
        const key = pair.shift().trim(), content = nested(pair.join('=').trim());
        renderedFields.push(key + '=' + content);
        if (/^[1-9]\d*$/.test(key)) positional.set(Number(key), content);
        else named.set(key.toLowerCase(), content);
      } else {
        const content = nested(field.trim());
        renderedFields.push(content); positional.set(position++, content);
      }
    }
    const args = [...positional].sort((a, b) => a[0] - b[0]).map(entry => entry[1]);
    const text = () => args.join('') + (named.get('text') || named.get('內容') || named.get('内容') || '');
    const extra = excluded => [...named].filter(([key]) => !STYLE_KEYS.has(key) && !excluded.includes(key))
      .map(([key, content]) => content ? `〔${key}：${content}〕` : '').join('');
    const preserve = () => '〔未展開模板：{{' + originalName + (fields.length ? '|' + renderedFields.join('|') : '') + '}}〕';
    if (originalName.startsWith(':') || originalName.startsWith('/'))
      return '〔未展開轉引：{{' + originalName + (fields.length ? '|' + renderedFields.join('|') : '') + '}}〕';
    if (name === 'header' || name === 'header2') {
      const section = named.get('section'), notes = named.get('notes');
      return [section && '〔篇題：' + section + '〕', notes && '〔編者說明：' + notes + '〕'].filter(Boolean).join('\n') + '\n';
    }
    if (NAVIGATION.has(name) || /^(?:pd-old(?:-\d+)?|(?:唐朝|東漢|东汉|五代|南北朝|北宋|西晉|西晋|元朝|明朝|清朝)作品)$/.test(name)) return '';
    if (name === 'gap') return '　';
    if (name === '*s') return '〔';
    if (name === '*e') return '〕';
    if (name === '原文沒有標點' || name === '原文没有标点') return '〔編者說明：原文沒有標點〕';
    if (name === 'reflist' || name === 'smallrefs') return named.get('refs') || '';
    if (name === '注意') return '〔編者說明：' + text() + extra(['text', '內容', '内容']) + '〕';
    if (INLINE.has(name)) return text() + extra(['text', '內容', '内容']);
    if (NOTES.has(name)) return '〔' + text() + extra(['text', '內容', '内容']) + '〕';
    if (name === 'quote') return '\n' + text() + extra(['text', '內容', '内容']) + '\n';
    // Linktoauthor's first parameter is the visible text, second is the target.
    if (name === 'a' || name === 'linktoauthor' || name === 'w') return positional.get(1) || preserve();
    if (name === 'cbox') return (positional.get(1) || '')
      + (positional.get(7) ? '〔提示：' + positional.get(7) + '〕' : '') + extra([]);
    if (name === 'align') return positional.has(2) ? positional.get(2) + extra([]) : preserve();
    if (name === 'color' || name === 'colour') return positional.has(2) || named.has('text')
      ? (positional.get(2) || named.get('text') || '') + extra(['text']) : preserve();
    if (name === 'yl' || name === 'year link' || name === 'tl')
      return (positional.get(1) || '') + (positional.has(2) ? '〔紀年對照：' + positional.get(2) + '〕' : '') + extra([]);
    if (name === 'unihan') {
      const code = (positional.get(1) || '').replace(/^U\+/i, '');
      const point = /^[0-9a-f]{1,6}$/i.test(code) ? parseInt(code, 16) : -1;
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : preserve();
    }
    if (name === '!' && !fields.length) return '|';
    if (name === '!' || name === '！' || name === '僻字')
      return (positional.get(1) || '〔缺字〕') + (positional.get(2) ? '〔字形：' + positional.get(2) + '〕' : '') + extra([]);
    if (name === '?') return '〔缺字：' + text() + '〕';
    if (['校', '另', '別', '别', '參', '参', '按'].includes(name)) {
      const label = name === '校' ? '校字' : ['另', '別', '别'].includes(name) ? '異文' : '註';
      return (positional.get(1) || '') + (positional.has(2) ? `〔${label}：${args.slice(1).join('；')}〕` : '') + extra([]);
    }
    return preserve();
  }

  function variant(body, nested, original) {
    if (!body.includes(':')) return nested(body);
    // Render a traditional-Chinese variant; the complete variant table remains
    // in the original wikitext. Unsupported conversion rules stay visible.
    const languages = new Map();
    for (const rule of splitTopLevel(body, ';')) {
      const match = rule.trim().match(/^(zh(?:-[a-z]+)?):([\s\S]*)$/i);
      if (match) languages.set(match[1].toLowerCase(), match[2]);
      else if (rule.trim()) return original;
    }
    for (const language of ['zh-hant', 'zh-tw', 'zh-hk', 'zh', 'zh-hans', 'zh-cn'])
      if (languages.has(language)) return nested(languages.get(language));
    return original;
  }

  value = render(value);
  // A restored ref may contain a protected literal, so process a bounded number
  // of passes. The unique prefix cannot collide with user-supplied wikitext.
  const slotPattern = new RegExp(tokenPrefix + '(\\d+)\uE001', 'g');
  for (let pass = 0; pass < 4 && value.includes(tokenPrefix); pass++) {
    value = value.replace(slotPattern, (_, index) => {
      const slot = slots[Number(index)];
      return slot.kind === 'note' ? '〔' + render(slot.body) + '〕' : slot.body;
    });
  }
  value = value.replace(/<br\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|poem|table|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/?[a-z][\w:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, '')
    .replace(/__(?:TOC|NOTOC|FORCETOC|NOEDITSECTION|NOTITLECONVERT|NOCONTENTCONVERT)__/g, '')
    .replace(/^\s*={1,6}\s*(.*?)\s*={1,6}\s*$/gm, '\n$1\n')
    .replace(/'{2,}/g, '');
  value = value.split('\n').map(line => {
    if (/^\s*(?:\{\||\|\}|\|-)/.test(line)) return '';
    if (!/^\s*[|!]/.test(line)) return line;
    return line.replace(/^\s*[|!]\+?/, '').split(/\|\||!!/).map(cell => {
      // Only remove recognized table attributes before the cell's first pipe.
      const split = cell.indexOf('|');
      if (split >= 0 && /^\s*(?:(?:class|style|rowspan|colspan|width|height|align|valign|scope|bgcolor)\s*=)/i.test(cell)) return cell.slice(split + 1).trim();
      return cell.trim();
    }).join('　');
  }).join('\n');
  return decodeEntities(value).replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { plainText, extractionVersion };
