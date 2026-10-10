// Read-only locator for quotations in the repository's fixed-revision public
// history archive (backend/static/data/history/archive-books). Used by the
// Claude author mode to verify primary-text claims against full text instead
// of search snippets. No network, no writes.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const books = new Map();

export async function loadDocument(book, title) {
  if (!/^[a-z]+$/.test(book)) throw Error('invalid_book');
  if (!books.has(book)) books.set(book, JSON.parse(await readFile(resolve(repo, 'backend/static/data/history/archive-books', `${book}.json`), 'utf8')));
  const doc = books.get(book).documents.find(item => item.title === title || item.requestedTitle === title);
  if (!doc || typeof doc.text !== 'string') throw Error('document_not_found');
  if (sha256(doc.text) !== doc.textSha256) throw Error('archive_text_hash_mismatch');
  return doc;
}

// Quotes are matched after removing whitespace and the archive's inline
// commentary brackets 〔…〕, so a quotation of the base text still matches
// when Yan Shigu notes interrupt it. Offsets refer to the stored text.
export function locate(text, quote) {
  const keep = [], map = [];
  let depth = 0;
  for (let at = 0; at < text.length; at++) {
    const ch = text[at];
    if (ch === '〔') { depth++; continue; }
    if (ch === '〕') { depth = Math.max(0, depth - 1); continue; }
    if (depth || /\s/.test(ch)) continue;
    keep.push(ch); map.push(at);
  }
  const needle = quote.replace(/\s/g, '');
  const flat = keep.join(''), hits = [];
  for (let at = flat.indexOf(needle); at >= 0; at = flat.indexOf(needle, at + 1)) hits.push(at);
  return hits.map(at => ({ charStart: map[at], charEnd: map[at + needle.length - 1] + 1 }));
}

export async function quote(book, title, needle) {
  const doc = await loadDocument(book, title);
  const hits = locate(doc.text, needle);
  return { book, title, sourceUrl: doc.sourceUrl, revisionUrl: doc.revisionUrl, textSha256: doc.textSha256, quote: needle, found: hits.length > 0,
    hits: hits.map(hit => ({ ...hit, excerptSha256: sha256(doc.text.slice(hit.charStart, hit.charEnd)), context: doc.text.slice(Math.max(0, hit.charStart - 60), hit.charEnd + 60).replace(/\s+/g, ' ') })) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [book, title, ...needles] = process.argv.slice(2);
  let missing = 0;
  for (const needle of needles) {
    const result = await quote(book, title, needle);
    if (!result.found) missing++;
    console.log(JSON.stringify(result));
  }
  process.exitCode = missing ? 1 : 0;
}
