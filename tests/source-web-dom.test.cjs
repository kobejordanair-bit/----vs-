'use strict';
// Public DOM integration checks. Supply JSDOM_MODULE when jsdom is not on NODE_PATH.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || 'jsdom')); } catch (_) {}
const app = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(app, 'backend/source-archive.html'), 'utf8');
const script = fs.readFileSync(path.join(app, 'backend/static/js/source-archive.js'), 'utf8');
const base = '/static/data/history/web/releases/qa-v1';
const manifestPath = '/static/data/history/web/manifest.json';
const run = (title, fn) => test(title, { skip: !JSDOM && 'Install jsdom or set JSDOM_MODULE for DOM integration checks.' }, fn);
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(fn) { const end = Date.now() + 10000; while (Date.now() < end) { if (fn()) return; await tick(); } throw new Error('DOM condition timed out'); }
function button(document, text, root = document) { const result = [...root.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(result, `Button missing: ${text}`); return result; }

function fixture(size = 30) {
  const bodies = new Map(), texts = new Map(), documents = [];
  for (let index = 0; index < size; index += 1) {
    const id = `document:qa-${index}`, text = index === 0 ? '韓信受拜為大將軍。項羽。韓信受拜為大將軍。' : '韓信與諸將議事。';
    const meta = { id, bookId: 'book:qa', title: `測試卷${index}`, requestedTitle: `測試書/卷${index}`, status: index === 1 ? 'incomplete' : 'downloaded', acquisitionStatus: 'downloaded', characters: text.length, revisionId: 100 + index, revisionUrl: `https://zh.wikisource.org/w/index.php?oldid=${100 + index}`, sourceUrl: `https://zh.wikisource.org/wiki/QA${index}`, historyUrl: `https://zh.wikisource.org/wiki/QA${index}?action=history`, textSha256: 'qa-text-hash', sha256: 'qa-original-hash', retrievedAt: '2026-10-02', textPath: `${base}/documents/qa-${index}.json`, wikitextPath: `${base}/wikitext/qa-${index}.json`, editionNote: index === 0 ? '此篇另有異版，需對照。' : null, transclusions: index === 0 ? [{ title: '轉引甲', revisionUrl: 'https://zh.wikisource.org/w/index.php?oldid=900', sha256: 'qa-transclusion' }] : [] };
    if (index === 1) meta.supplementsDocumentId = 'document:qa-0';
    documents.push(meta); texts.set(id, text);
    bodies.set(meta.textPath, { id, version: 'qa-v1', text, metadata: { ...meta, relatedDocuments: [] } });
    bodies.set(meta.wikitextPath, { id, version: 'qa-v1', wikitext: `{{專名|韓信}}\n${text}`, transclusions: [] });
  }
  if (size > 1) { bodies.get(documents[0].textPath).metadata.relatedDocuments = [documents[1]]; bodies.get(documents[1].textPath).metadata.relatedDocuments = [documents[0]]; }
  const person = { recordId: 'general_hanxin_1', name: '韓信', type: 'general', dynasty: '楚漢', title: '大將軍', canonicalName: '韓信', aliases: ['淮陰侯'], identityStatus: 'reviewed', sourceIds: ['source:qa'], reviewIds: ['review:qa'], claimIds: [], candidatePages: [{ title: '韓信', url: 'https://zh.wikipedia.org/wiki/韓信', revisionId: 123, bibliography: [{ citationTitle: '研究書目', url: 'http://example.org/book', author: '著者', publisher: '出版社' }], wikisourceLinks: [] }], matches: [{ documentId: documents[0].id, query: '韓信', count: 2, offset: 0, excerpt: '韓信受拜為大將軍。' }], matchCount: 1, notes: [], gaps: [], matchedDocuments: [documents[0]], version: 'qa-v1' };
  const stub = { ...person, detailPath: `${base}/people/hanxin.json`, candidatePageCount: 1, candidateCount: 1, claimCount: 0, reviewCount: 1, searchNames: ['韓信', '淮陰侯'] }; for (const key of ['candidatePages', 'matches', 'matchedDocuments', 'gaps', 'notes', 'claimIds', 'version']) delete stub[key];
  const second = { ...person, recordId: 'minister_zhangliang_2', name: '張良', title: '留侯', canonicalName: '張良', aliases: [], matches: [], matchCount: 0, matchedDocuments: [], reviewIds: [] };
  const secondStub = { ...stub, recordId: second.recordId, name: second.name, canonicalName: second.name, aliases: [], searchNames: ['張良'], title: '留侯', detailPath: `${base}/people/zhangliang.json`, matchCount: 0, reviewIds: [], reviewCount: 0 };
  bodies.set(stub.detailPath, person); bodies.set(secondStub.detailPath, second);
  const book = { id: 'book:qa', title: '測試古籍', documentsPath: `${base}/books/qa.json`, chapterCount: size, downloadedCount: size - 1, status: 'partial', license: '古代原著；適用社群貢獻依 CC BY-SA 4.0。', sourceUrl: 'https://zh.wikisource.org/wiki/QA' };
  const manifest = { format: 'dynasty-source-web', schemaVersion: 1, version: 'qa-v1', archiveVersion: '1.0.0', createdAt: '2026-10-02', summary: { records: 2, uniqueNames: 2, downloadedDocuments: size - 1, documents: size, incompleteDocuments: 1, corpusCharacters: 2000, uniqueClaimCount: 0 }, dossiers: [stub, secondStub], sources: [{ id: 'source:qa', title: '測試古籍', type: 'primary-text', url: 'http://example.org/source', provider: '測試典藏', access: { mode: 'open', notes: '入口可讀' }, reuse: { status: 'source-specific', notes: '保留版本及署名' }, retrievalStatus: 'opened' }], reviews: [{ id: 'review:qa', status: 'limited-claim-reviewed', issue: '限定命題', decision: '僅核讀所列段落。', evidence: [{ sourceId: 'source:qa', locator: '卷一', url: 'https://zh.wikisource.org/wiki/QA', supportedFact: '原典記述', reviewScope: '未審定人物全文。' }] }], limitations: ['整理文字未逐字校勘。'], books: [book], documentCatalogPath: `${base}/documents.json`, exportPath: '/static/data/history/source-archive.v1.json', corpusQuality: { entries: [{ requestedTitle: documents[0].requestedTitle, revisionId: documents[0].revisionId, links: [{ title: '版本核對入口', url: 'https://example.org/edition', coverage: '可對照缺文' }] }] }, search: { format: 'dynasty-literal-search', schemaVersion: 1, version: 'qa-v1', unit: 'utf16-code-unit', encoding: 'delta-varint-base64-v1', documentsPath: `${base}/search/documents.json`, documentCount: size, characters: 2000, bigrams: { shardCount: 256, pathTemplate: `${base}/search/bigrams/{shard}.json` }, unigrams: { shardCount: 64, pathTemplate: `${base}/search/unigrams/{shard}.json` } } };
  bodies.set(manifestPath, manifest); bodies.set(book.documentsPath, { bookId: book.id, version: 'qa-v1', documents }); bodies.set(manifest.documentCatalogPath, { format: 'dynasty-source-document-catalog', schemaVersion: 1, version: 'qa-v1', documents }); bodies.set(manifest.exportPath, { format: 'dynasty-source-archive', schemaVersion: 1, marker: 'full-export' });
  return { manifest, documents, bodies, texts, person, second };
}
async function boot(data = fixture(), hooks = {}) {
  const requests = [], workerRequests = [], downloads = [], errors = [], workers = []; const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, { url: `http://127.0.0.1:8877/source-archive.html?local=1${hooks.hash || ''}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console }); const window = dom.window, document = window.document;
  window.HTMLElement.prototype.scrollIntoView = function () {}; window.HTMLAnchorElement.prototype.click = function () {}; window.print = function () {};
  window.Blob = class { constructor(parts, options) { this.parts = parts; this.type = options?.type; } }; window.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:qa'; }; window.URL.revokeObjectURL = function () {};
  window.fetch = async (url, options = {}) => { requests.push(url); if (hooks.fetch) { const response = await hooks.fetch(url, options, window); if (response) return response; } if (options.signal?.aborted) throw new window.DOMException('aborted', 'AbortError'); if (!data.bodies.has(url)) throw new Error('Unexpected fetch: ' + url); return { ok: true, json: async () => structuredClone(data.bodies.get(url)), blob: async () => new window.Blob([JSON.stringify(data.bodies.get(url))], { type: 'application/json' }) }; };
  window.Worker = class {
    constructor(url) { assert.equal(url, '/static/js/source-search-worker.js'); workers.push(this); }
    emit(message) { this.onmessage?.({ data: message }); }
    postMessage(message) { workerRequests.push(message); if (hooks.worker && hooks.worker(message, this, data) === true) return; queueMicrotask(() => { if (this.terminated) return; if (message.type === 'init') this.emit({ type: 'ready', requestId: message.requestId }); if (message.type === 'cancel') this.emit({ type: 'cancelled', requestId: message.requestId, partialResults: [] }); if (message.type === 'search') { const results = []; for (const doc of data.documents) { if (message.bookIds.length && !message.bookIds.includes(doc.bookId)) continue; const text = data.texts.get(doc.id); let at = text.indexOf(message.query), first = at, count = 0; while (at >= 0) { count += 1; at = text.indexOf(message.query, at + message.query.length); } if (count) results.push({ docId: doc.id, count, offset: first, firstOffset: first }); } this.emit({ type: 'result', requestId: message.requestId, query: message.query, results, totalMatches: results.reduce((sum, item) => sum + item.count, 0), documentsSearched: data.documents.length, exact: true }); } }); }
    terminate() { this.terminated = true; }
  };
  vm.runInContext(script, dom.getInternalVMContext()); await until(() => document.querySelector('#archivePanel').getAttribute('aria-busy') === 'false');
  return { data, dom, window, document, requests, workerRequests, downloads, errors, workers, close() { dom.window.close(); } };
}
function changeInput(ui, selector, value) { const node = ui.document.querySelector(selector); node.value = value; node.dispatchEvent(new ui.window.Event('input', { bubbles: true })); }
function startSearch(ui, query) { ui.document.querySelector('#archive-tab-texts').click(); changeInput(ui, 'input[type=search]', query); ui.document.querySelector('form').dispatchEvent(new ui.window.Event('submit', { bubbles: true, cancelable: true })); }
async function doneSearch(ui) { await until(() => ui.document.querySelector('#archiveTextResults')?.textContent.includes('搜尋完成')); }

run('first screen fetches only a sub-MiB manifest; person reads its own detail and exact record link', async () => {
  const ui = await boot(); try { assert.ok(Buffer.byteLength(JSON.stringify(ui.data.manifest)) < 1024 * 1024); assert.deepEqual(ui.requests, [manifestPath]); assert.equal(ui.workers.length, 0); button(ui.document, '打開人物檔案').click(); await until(() => ui.document.querySelector('#archiveDialog').textContent.includes('原庫紀錄 ID')); assert.deepEqual(ui.requests, [manifestPath, ui.data.manifest.dossiers[0].detailPath]); assert.match(ui.document.querySelector('#archiveDialog').textContent, /限定命題/); const original = [...ui.document.querySelectorAll('a')].find(node => node.textContent.includes('原人物分析')); assert.equal(new URL(original.href).searchParams.get('record'), ui.data.person.recordId); assert.equal(new URL(original.href).searchParams.get('local'), '1'); } finally { ui.close(); }
});
run('reading one document loads only one text; raw text waits for explicit action and preserves version tools', async () => {
  const ui = await boot(); try { button(ui.document, '打開人物檔案').click(); await until(() => ui.document.querySelector('#archiveDialog').textContent.includes('原庫紀錄 ID')); button(ui.document, '在收存原文中查看').click(); await until(() => ui.document.querySelector('.ar-reader-text')); assert.deepEqual(ui.requests.slice(2), [ui.data.documents[0].textPath]); assert.match(ui.document.querySelector('#archiveDialog').textContent, /版本核對入口/); assert.match(ui.document.querySelector('#archiveDialog').textContent, /對讀相關版本/); assert.match(ui.document.querySelector('#archiveDialog').textContent, /轉引篇章/); button(ui.document, '檢視原始維基文字').click(); await until(() => ui.document.querySelector('.ar-reader-text').dataset.raw === 'true'); assert.equal(ui.requests.at(-1), ui.data.documents[0].wikitextPath); button(ui.document, '下載此篇 TXT').click(); assert.match(ui.downloads.at(-1).parts.join(''), /中文維基文庫及其貢獻者/); assert.match(ui.downloads.at(-1).parts.join(''), /creativecommons.org/); assert.ok(ui.requests.every(url => !url.includes('archive-books'))); } finally { ui.close(); }
});
run('book navigation loads only that book metadata before opening a text', async () => {
  const ui = await boot(); try { ui.document.querySelector('#archive-tab-texts').click(); assert.equal(ui.requests.length, 1); button(ui.document, '查看篇章目錄').click(); await until(() => [...ui.document.querySelectorAll('button')].some(node => node.textContent === '閱讀收存原文')); assert.equal(ui.requests.at(-1), ui.data.manifest.books[0].documentsPath); assert.ok(!ui.requests.includes(ui.data.manifest.documentCatalogPath)); } finally { ui.close(); }
});
run('worker receives the complete long literal; results preserve count, version and only visible snippets load', async () => {
  const ui = await boot(fixture(60)); try { startSearch(ui, '韓信受拜為大將軍'); await doneSearch(ui); await until(() => ui.requests.includes(ui.data.documents[0].textPath)); assert.equal(ui.workerRequests.find(item => item.type === 'search').query, '韓信受拜為大將軍'); assert.match(ui.document.querySelector('#archiveTextResults').textContent, /找到 2 次/); assert.deepEqual(ui.requests.filter(url => /\/documents\/qa-/.test(url)), [ui.data.documents[0].textPath]); button(ui.document, '匯出查詢結果 JSON').click(); const result = JSON.parse(ui.downloads.at(-1).parts.join('')); assert.equal(result.results.length, 1); assert.equal(result.results[0].revisionId, 100); assert.equal(result.results[0].verificationStatus, 'unreviewed'); assert.equal(result.query, '韓信受拜為大將軍'); assert.equal(ui.errors.length, 0); } finally { ui.close(); }
});
run('all 206 worker matches export; only current page fetches excerpts and pagination resets for a new query', async () => {
  const ui = await boot(fixture(206)); try { startSearch(ui, '韓信'); await doneSearch(ui); await until(() => ui.requests.filter(url => /\/documents\/qa-/.test(url)).length === 24); assert.equal(ui.document.querySelectorAll('#archiveTextResults .ar-citation').length, 24); button(ui.document, '匯出查詢結果 JSON').click(); const exported = JSON.parse(ui.downloads.at(-1).parts.join('')); assert.equal(exported.results.length, 206); assert.equal(exported.results[205].excerptStatus, 'not-requested'); button(ui.document, '下一頁', ui.document.querySelector('#archiveTextResults')).click(); await until(() => ui.requests.includes(ui.data.documents[24].textPath)); assert.match(ui.document.querySelector('#archiveTextResults').textContent, /2 \/ 9 頁/); startSearch(ui, '項羽'); await doneSearch(ui); assert.match(ui.document.querySelector('#archiveTextResults').textContent, /1 \/ 1 頁/); } finally { ui.close(); }
});
run('cancel retains verified partial locations; cancelled query export never claims completion', async () => {
  let held;
  const ui = await boot(fixture(), { worker(message, worker) { if (message.type === 'search') { held = { message, worker }; queueMicrotask(() => worker.emit({ type: 'partial', requestId: message.requestId, query: message.query, exact: true, results: [{ docId: 'document:qa-0', count: 2, firstOffset: 0 }], totalMatches: 2, documentsSearched: 1 })); return true; } } });
  try { startSearch(ui, '韓信'); await until(() => held && ui.document.querySelector('#archiveTextResults').textContent.includes('結果 1 篇')); assert.ok(!ui.requests.some(url => /\/documents\/qa-/.test(url))); button(ui.document, '停止搜尋').click(); await until(() => ui.document.querySelector('#archiveTextResults').textContent.includes('已停止')); button(ui.document, '匯出查詢結果 JSON').click(); const result = JSON.parse(ui.downloads.at(-1).parts.join('')); assert.equal(result.results.length, 1); assert.equal(result.search.status, 'cancelled'); assert.equal(result.search.scanComplete, false); } finally { ui.close(); }
});
run('late worker responses cannot replace a newer query', async () => {
  let old;
  const ui = await boot(fixture(), { worker(message, worker) { if (message.type === 'search' && message.query === '舊查詢') { old = { message, worker }; return true; } } });
  try { startSearch(ui, '舊查詢'); await until(() => old); button(ui.document, '停止搜尋').click(); startSearch(ui, '項羽'); await doneSearch(ui); old.worker.emit({ type: 'result', requestId: old.message.requestId, query: '舊查詢', exact: true, results: [{ docId: 'document:qa-1', count: 999, offset: 0 }], totalMatches: 999, documentsSearched: 1 }); await tick(); assert.match(ui.document.querySelector('#archiveTextResults').textContent, /查詢「項羽」/); assert.doesNotMatch(ui.document.querySelector('#archiveTextResults').textContent, /999/); } finally { ui.close(); }
});
run('worker error preserves status and retry succeeds', async () => {
  let fail = true;
  const ui = await boot(fixture(), { worker(message, worker) { if (message.type === 'search' && fail) { fail = false; queueMicrotask(() => worker.emit({ type: 'error', requestId: message.requestId, message: '索引 HTTP 503', retryable: true })); return true; } } });
  try { startSearch(ui, '項羽'); await until(() => ui.document.querySelector('#archiveTextResults').textContent.includes('索引 HTTP 503')); button(ui.document, '重試這次查詢').click(); await doneSearch(ui); assert.match(ui.document.querySelector('#archiveTextResults').textContent, /找到 1 次/); } finally { ui.close(); }
});
run('stale person fetch cannot overwrite the currently opened record', async () => {
  let resolveFirst;
  const data = fixture();
  const ui = await boot(data, { fetch(url) { if (url === data.manifest.dossiers[0].detailPath) return new Promise(resolve => { resolveFirst = resolve; }); } });
  try { button(ui.document, '打開人物檔案').click(); await until(() => resolveFirst); button(ui.document, '關閉').click(); [...ui.document.querySelectorAll('button')].filter(node => node.textContent === '打開人物檔案')[1].click(); await until(() => ui.document.querySelector('#archiveDialog').textContent.includes('原庫紀錄 ID')); resolveFirst({ ok: true, json: async () => structuredClone(data.person) }); await tick(); assert.equal(ui.document.querySelector('#archiveDialogTitle').textContent, '張良'); assert.match(ui.document.querySelector('#archiveDialog').textContent, /minister_zhangliang_2/); } finally { ui.close(); }
});
run('keyboard focus, literal source strings and URL protocol checks remain safe', async () => {
  const data = fixture(); data.manifest.dossiers[0].name = '<img src=x onerror=alert(1)>'; data.manifest.sources[0].url = 'javascript:alert(1)';
  const ui = await boot(data); try { assert.equal(ui.document.querySelector('img'), null); assert.match(ui.document.body.textContent, /<img src=x onerror=alert\(1\)>/); const tab = ui.document.querySelector('#archive-tab-people'); tab.focus(); tab.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); assert.equal(ui.document.querySelector('#archive-tab-sources').getAttribute('aria-selected'), 'true'); button(ui.document, '查看版本與使用方式').click(); assert.equal(ui.document.querySelector('[href^="javascript:"]'), null); const close = button(ui.document, '關閉'); close.focus(); ui.document.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); ui.document.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); assert.equal(ui.document.activeElement, close); ui.document.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(ui.document.querySelector('#archiveDialog').hidden, true); assert.equal(ui.errors.length, 0); } finally { ui.close(); }
});
run('complete offline index is fetched only for explicit export and is never replaced by manifest', async () => {
  const ui = await boot(); try { assert.ok(!ui.requests.includes(ui.data.manifest.exportPath)); ui.document.querySelector('#archiveExport').click(); await until(() => ui.downloads.length > 0); const result = JSON.parse(ui.downloads.at(-1).parts.join('')); assert.equal(result.format, 'dynasty-source-archive'); assert.equal(result.marker, 'full-export'); assert.equal(ui.requests.at(-1), ui.data.manifest.exportPath); } finally { ui.close(); }
});
run('failed person fetch offers a narrow retry without downloading corpus or offline index', async () => {
  let failed = false; const data = fixture();
  const ui = await boot(data, { fetch(url) { if (url === data.manifest.dossiers[0].detailPath && !failed) { failed = true; return { ok: false, status: 503 }; } } });
  try { button(ui.document, '打開人物檔案').click(); await until(() => ui.document.querySelector('#archiveDialog').textContent.includes('HTTP 503')); button(ui.document, '重新讀取此人物').click(); await until(() => ui.document.querySelector('#archiveDialog').textContent.includes('原庫紀錄 ID')); assert.ok(ui.requests.every(url => url === manifestPath || url === data.manifest.dossiers[0].detailPath)); } finally { ui.close(); }
});
run('reader keeps source UTF-16 offsets through CRLF, blank lines and leading spaces', async () => {
  const data = fixture(2), source = ' '.repeat(80) + '\r\n\r\n首段。\n\n  韓信甲。\r\n韓信乙。';
  data.bodies.get(data.documents[0].textPath).text = source; data.person.matches[0].offset = source.indexOf('韓信');
  const ui = await boot(data); try { button(ui.document, '打開人物檔案').click(); await until(() => ui.document.querySelector('#archiveDialog').textContent.includes('原庫紀錄 ID')); button(ui.document, '在收存原文中查看').click(); await until(() => ui.document.querySelector('.ar-reader-text')); assert.equal(ui.document.activeElement.dataset.sourceOffset, String(source.indexOf('韓信'))); assert.equal(ui.document.querySelectorAll('.ar-reader-paragraph').length, 3); button(ui.document, '下一處').click(); assert.equal(ui.document.activeElement.dataset.sourceOffset, String(source.lastIndexOf('韓信'))); } finally { ui.close(); }
});
for (const [id, query] of [['document:shiji-e0b796d857f9dd81', '帝辛'], ['document:shiji-87250a76cfc96c04', '晉文公']]) {
  const available = fs.existsSync(path.join(app, 'backend/static/data/history/web/manifest.json'));
  test(`real corpus first match remains exact for ${id} ${query}`, { skip: (!JSDOM || !available) && 'Requires jsdom and a generated web release.' }, async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(app, 'backend', manifestPath), 'utf8'));
    const catalog = JSON.parse(fs.readFileSync(path.join(app, 'backend', manifest.documentCatalogPath), 'utf8'));
    const meta = catalog.documents.find(doc => doc.id === id); assert.ok(meta);
    const text = JSON.parse(fs.readFileSync(path.join(app, 'backend', meta.textPath), 'utf8')).text, expected = text.indexOf(query); assert.ok(expected >= 0);
    const data = fixture(1); data.manifest = manifest; data.documents = catalog.documents; data.bodies = new Map([[manifestPath, manifest]]);
    const person = JSON.parse(fs.readFileSync(path.join(app, 'backend', manifest.dossiers[0].detailPath), 'utf8'));
    person.matches = [{ documentId: id, query, count: 2, offset: expected, excerpt: query }]; person.matchCount = 1; person.matchedDocuments = [meta]; data.bodies.set(manifest.dossiers[0].detailPath, person);
    const ui = await boot(data, { fetch(url) { if (data.bodies.has(url)) return; assert.ok(url.startsWith('/static/data/history/web/')); const file = path.join(app, 'backend', url); return { ok: fs.existsSync(file), json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) }; } });
    try { assert.ok(Buffer.byteLength(JSON.stringify(manifest)) < 1024 * 1024); button(ui.document, '打開人物檔案').click(); await until(() => ui.document.querySelector('#archiveDialog').textContent.includes('原庫紀錄 ID')); button(ui.document, '在收存原文中查看').click(); await until(() => ui.document.querySelector('.ar-reader-text')); assert.equal(ui.document.activeElement.dataset.sourceOffset, String(expected)); assert.equal(ui.requests.length, 3); assert.equal(ui.errors.length, 0); } finally { ui.close(); }
  });
}
