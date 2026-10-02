'use strict';
// Run with jsdom available as a dev dependency, or JSDOM_MODULE=/absolute/path/to/jsdom.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || 'jsdom');
const root = path.resolve(__dirname, '../backend'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await tick(); } throw Error('DOM did not settle'); }
function response(text) { return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text), headers: { get: () => '2026-09-30' } }; }
function setup(t, { record = '', local = false, privateResponse, casesResponse } = {}) {
  const query = new URLSearchParams({ record }); if (local) query.set('local', '1');
  const errors = [], requests = [], console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(read('history-lab.html'), { url: 'http://127.0.0.1/history-lab?' + query, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  t.after(() => { assert.deepEqual(errors, []); dom.window.close(); });
  const w = dom.window, d = w.document;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.fetch = async url => {
    requests.push(url);
    if (url === '/private-library.json') return privateResponse;
    if (url.endsWith('chuhan-cases.v1.json') && casesResponse) return casesResponse;
    return response(read(url.replace(/^\//, '')));
  };
  for (const script of ['static/data/legends.js', 'static/js/history-data.js', 'static/js/history-investigation.js', 'static/js/history-lab.js']) vm.runInContext(read(script), dom.getInternalVMContext(), { filename: script });
  function importRecords(records) {
    const input = d.getElementById('labLibraryFile'), data = JSON.stringify(records);
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'fixture.json', size: Buffer.byteLength(data), text: async () => data }] });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  return { w, d, requests, importRecords };
}
test('a missing exact ID shows an actionable import and never opens a same-name substitute', async t => {
  const s = setup(t, { record: 'private-exact-id' });
  await until(() => s.d.querySelector('.lab-library-caption').textContent.includes('人物 ID 尚未載入'));
  assert.equal(s.d.querySelector('.lab-library-bar').open, true);
  assert.equal(s.d.getElementById('labDialog').hidden, true);
  assert.equal(s.d.getElementById('lab-tab-library').getAttribute('aria-selected'), 'true');
  s.importRecords([{ id: 'wrong-id', name: '劉邦', type: 'general', analysis: 'WRONG RECORD' }]);
  await until(() => s.d.getElementById('labLibraryStatus').textContent.includes('fixture.json'));
  assert.equal(s.d.getElementById('labDialog').hidden, true);
  s.importRecords([{ id: 'private-exact-id', name: '劉邦', type: 'general', analysis: 'CORRECT PRIVATE RECORD' }]);
  await until(() => !s.d.getElementById('labDialog').hidden);
  assert.equal(s.d.querySelector('[data-original-id]').dataset.originalId, 'private-exact-id');
  assert.match(s.d.getElementById('labDialog').textContent, /CORRECT PRIVATE RECORD/);
  assert.doesNotMatch(s.d.querySelector('.lab-library-caption').textContent, /尚未載入/);
  s.d.getElementById('labDialogClose').click();
  s.importRecords([{ id: 'private-exact-id', name: '劉邦', type: 'general' }]);
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(s.d.getElementById('labDialog').hidden, true, 'closed deep links do not reopen after later imports');
  assert.ok(s.requests.every(url => !url.includes('private-library')));
});
test('a private link waits for both the casebook and private snapshot before opening', async t => {
  let resolvePrivate, resolveCases;
  const s = setup(t, { record: 'private-wait-id', local: true, privateResponse: new Promise(resolve => { resolvePrivate = resolve; }), casesResponse: new Promise(resolve => { resolveCases = resolve; }) });
  await until(() => s.requests.some(url => url.endsWith('chuhan-cases.v1.json')));
  resolvePrivate(response(JSON.stringify([{ id: 'private-wait-id', name: '兩份同名', type: 'general', analysis: 'EXACT MATCH' }, { id: 'different-id', name: '兩份同名', type: 'general', analysis: 'WRONG' }])));
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(s.d.getElementById('labDialog').hidden, true);
  resolveCases(response(read('static/data/history/chuhan-cases.v1.json')));
  await until(() => !s.d.getElementById('labDialog').hidden);
  assert.equal(s.d.querySelectorAll('[data-original-id]').length, 1);
  assert.equal(s.d.querySelector('[data-original-id]').dataset.originalId, 'private-wait-id');
  assert.match(s.d.getElementById('labDialog').textContent, /EXACT MATCH/);
  assert.doesNotMatch(s.d.getElementById('labDialog').textContent, /WRONG/);
});
test('special characters in a record ID remain literal and do not create HTML', async t => {
  const id = 'id&record=other<script>alert(1)</script>';
  const s = setup(t, { record: id, local: true, privateResponse: response(JSON.stringify([{ id, name: '測試人物', type: 'general' }])) });
  await until(() => !s.d.getElementById('labDialog').hidden);
  assert.equal(s.d.querySelector('[data-original-id]').dataset.originalId, id);
  assert.equal(s.d.querySelector('#labDialog script'), null);
});
