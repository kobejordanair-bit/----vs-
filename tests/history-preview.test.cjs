'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createPreviewServer, readPrivateLibrary, parseOptions } = require('../scripts/serve-history-preview.cjs');

test('standalone preview serves the app with no production API or arbitrary file access', async t => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const page = await fetch(base + '/history-lab.html');
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await page.text(), /lang="zh-Hant"/);
  assert.equal((await fetch(base + '/api/chat')).status, 404);
  assert.equal((await fetch(base + '/private-library.json')).status, 404);
  assert.equal((await fetch(base + '/main.py')).status, 404);
  assert.equal((await fetch(base + '/history-lab.html', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/history-lab.html', { headers: { Origin: 'https://example.org' } })).status, 403);
  const badHost = await new Promise((resolve, reject) => {
    const request = http.get(base + '/history-lab.html', { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject);
  }); assert.equal(badHost, 403);
  const audit = await (await fetch(base + '/preview-audit')).json();
  assert.equal(audit.modelCalls, 0); assert.equal(audit.productionWrites, 0);
});

test('private preview projects only whitelisted library fields, while keeping the source file unchanged', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynasty-history-preview-'));
  const filename = path.join(directory, 'sample.json');
  const text = JSON.stringify([{ id: 'fixture', name: '人物', type: 'general', analysis: '作者原文', unexpectedCredential: 'not-served' }]);
  fs.writeFileSync(filename, text);
  t.after(() => { fs.unlinkSync(filename); fs.rmdirSync(directory); });
  const result = readPrivateLibrary(filename), records = JSON.parse(result.raw);
  assert.equal(records[0].analysis, '作者原文');
  assert.equal(Object.hasOwn(records[0], 'unexpectedCredential'), false);
  assert.equal(fs.readFileSync(filename, 'utf8'), text);
});

test('preview arguments cannot expose a public host or accept an invalid port', () => {
  assert.throws(() => parseOptions(['--host', '0.0.0.0']));
  assert.throws(() => parseOptions(['--port', '0']));
  assert.throws(() => parseOptions(['--port']));
  assert.equal(parseOptions(['--port', '8878']).port, 8878);
});
