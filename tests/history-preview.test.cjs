'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createPreviewServer, readPrivateLibrary, parseOptions, acceptsGzip } = require('../scripts/serve-history-preview.cjs');

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

async function isolatedPreview(t, withLibrary = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynasty-archive-http-'));
  const root = path.join(directory, 'backend');
  const release = '/static/data/history/web/releases/0123456789abcdef/people/one.json';
  const contents = new Map([
    ['/history-lab.html', '<!doctype html><title>fixture</title>'],
    ['/source-archive.html', '<!doctype html><title>sources</title>'],
    ['/static/data/legends.js', 'const staticLegendsData = [];'],
    ['/static/js/history-data.js', 'window.fixtureExistingAsset = true;'],
    ['/static/js/source-search-worker.js', 'self.onmessage = function () {};'],
    ['/static/data/history/web/manifest.json', JSON.stringify({ format: 'fixture', title: '歷史來源' })],
    [release, JSON.stringify({ recordId: 'original-id', name: '韓信' })]
  ]);
  for (const [asset, body] of contents) {
    const file = path.join(root, asset);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body);
    if (asset.endsWith('.json') || asset.endsWith('source-search-worker.js') || asset.endsWith('history-data.js')) fs.writeFileSync(file + '.gz', gzipSync(body));
  }
  const libraryPath = path.join(directory, 'private.json');
  fs.writeFileSync(libraryPath, JSON.stringify([{ id: 'private-record', name: '人物', type: 'general', analysis: '私人作者原文', unexpectedCredential: 'not-served' }]));
  fs.writeFileSync(path.join(directory, 'secret.json'), 'outside-fixture-secret');
  const server = createPreviewServer({ root, ...(withLibrary ? { libraryPath, snapshotDate: '2026-10-02' } : {}) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^dynasty-archive-http-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { base: 'http://127.0.0.1:' + server.address().port, root, release, contents };
}

function rawRequest(base, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(base, { path: requestPath, ...options }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('error', reject); request.end();
  });
}

test('preview redirects preserve an exact original record ID and only enable a configured private snapshot', async t => {
  const id = '人物 /?&record=other#';
  const query = new URLSearchParams({ record: id, local: '1' });
  for (const privateEnabled of [false, true]) {
    const { base } = await isolatedPreview(t, privateEnabled);
    for (const route of ['/', '/history-lab']) {
      const response = await rawRequest(base, route + '?' + query);
      assert.equal(response.status, 302);
      const redirected = new URL(response.headers.location, base);
      assert.equal(redirected.pathname, '/history-lab.html');
      assert.equal(redirected.searchParams.get('record'), id);
      assert.equal(redirected.searchParams.get('local'), privateEnabled ? '1' : null);
    }
    const archive = await rawRequest(base, '/source-archive?' + query);
    assert.equal(archive.status, 302);
    const archiveURL = new URL(archive.headers.location, base);
    assert.equal(archiveURL.pathname, '/source-archive.html');
    assert.equal(archiveURL.searchParams.get('record'), id);
    assert.equal(archiveURL.searchParams.get('local'), '1');
    const privateResponse = await rawRequest(base, '/private-library.json');
    assert.equal(privateResponse.status, privateEnabled ? 200 : 404);
    if (privateEnabled) {
      assert.equal(privateResponse.headers['x-library-snapshot-date'], '2026-10-02');
      assert.equal(privateResponse.headers['cache-control'], 'no-store');
      const records = JSON.parse(privateResponse.body);
      assert.equal(records[0].analysis, '私人作者原文');
      assert.equal(Object.hasOwn(records[0], 'unexpectedCredential'), false);
      assert.equal((await rawRequest(base, '/private-library.json', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    }
  }
});

test('preview CSP permits same-origin search workers and keeps loopback restrictions', async t => {
  const { base } = await isolatedPreview(t);
  for (const route of ['/source-archive.html', '/static/js/source-search-worker.js']) {
    const response = await rawRequest(base, route);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-security-policy'], /(?:^|; )worker-src 'self'(?:;|$)/);
    assert.match(response.headers['content-security-policy'], /connect-src 'self'/);
    assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal((await rawRequest(base, route, { headers: { Origin: 'https://example.org' } })).status, 403);
  }
});

test('preview gzip negotiation honors explicit exclusions before wildcard preferences', () => {
  for (const [header, expected] of [
    [undefined, false], ['', false], ['br', false], ['gzip', true], ['GZIP; Q=0.5', true],
    ['gzip;q=0', false], ['*', true], ['gzip;q=0, *;q=1', false], ['*;q=1, gzip;q=0', false],
    ['*;q=0, gzip;q=0.2', true], ['gzip;q=invalid, *;q=1', false], ['gzip;q=2', false], ['gzip;q=-1', false]
  ]) assert.equal(acceptsGzip(header), expected, String(header));
});

test('manifest responses negotiate actual gzip bytes, validate ETags, and keep HEAD metadata', async t => {
  const { base, contents } = await isolatedPreview(t);
  const route = '/static/data/history/web/manifest.json';
  const representations = new Map();
  for (const [encoding, compressed] of [['gzip', true], ['identity', false], ['gzip;q=0, *;q=1', false], ['*;q=1', true]]) {
    const response = await rawRequest(base, route, { headers: { 'Accept-Encoding': encoding } });
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-cache');
    assert.equal(response.headers.vary, 'Accept-Encoding');
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['content-encoding'], compressed ? 'gzip' : undefined);
    assert.equal(Number(response.headers['content-length']), response.body.length);
    assert.equal((compressed ? gunzipSync(response.body) : response.body).toString(), contents.get(route));
    const head = await rawRequest(base, route, { method: 'HEAD', headers: { 'Accept-Encoding': encoding } });
    assert.equal(head.status, 200); assert.equal(head.body.length, 0);
    for (const header of ['etag', 'content-type', 'content-length', 'content-encoding', 'cache-control', 'vary']) assert.equal(head.headers[header], response.headers[header]);
    for (const validator of [response.headers.etag, 'W/' + response.headers.etag, '"other", ' + response.headers.etag, '*']) {
      const cached = await rawRequest(base, route, { headers: { 'Accept-Encoding': encoding, 'If-None-Match': validator } });
      assert.equal(cached.status, 304); assert.equal(cached.body.length, 0);
      for (const header of ['etag', 'content-encoding', 'cache-control', 'vary']) assert.equal(cached.headers[header], response.headers[header]);
    }
    representations.set(compressed, response.headers.etag);
  }
  assert.notEqual(representations.get(true), representations.get(false));
  const changedEncoding = await rawRequest(base, route, { headers: { 'Accept-Encoding': 'identity', 'If-None-Match': representations.get(true) } });
  assert.equal(changedEncoding.status, 200);
});

test('only valid existing release files are immutable, with no traversal or private file exposure', async t => {
  const { base, release } = await isolatedPreview(t);
  const response = await rawRequest(base, release, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
  for (const route of [
    release.replace('0123456789abcdef', '0123456789abcdef0'),
    release.replace('0123456789abcdef', '0123456789ABCDEF'),
    release.replace('one.json', 'missing.json'),
    '/static/data/history/web/../../../../../../secret.json',
    '/static/data/history/web/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret.json',
    '/static/data/history/web/%2e%2e%5c%2e%2e%5c%2e%2e%5c%2e%2e%5csecret.json',
    '/static/data/history/web/releases/0123456789abcdef/../secret.json',
    '/static/data/history/web/releases/0123456789abcdef/..%2f..%2fsecret.json',
    '/private.json', '/main.py'
  ]) {
    const blocked = await rawRequest(base, route);
    assert.ok([403, 404].includes(blocked.status), route + ': ' + blocked.status);
    assert.doesNotMatch(blocked.body.toString(), /outside-fixture-secret|私人作者原文/);
    assert.doesNotMatch(blocked.headers['cache-control'] || '', /immutable/, route);
  }
  assert.equal((await rawRequest(base, '/static/data/history/web/%zz')).status, 400);
});

test('ordinary preview assets retain no-store behavior even when a gzip sidecar exists', async t => {
  const { base, contents } = await isolatedPreview(t);
  const route = '/static/js/history-data.js';
  const response = await rawRequest(base, route, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['content-encoding'], undefined);
  assert.equal(response.headers.vary, undefined);
  assert.equal(response.body.toString(), contents.get(route));
});

test('a missing or non-file gzip sidecar falls back to JSON without poisoning error responses', async t => {
  const { base, root, release, contents } = await isolatedPreview(t);
  const gzipPath = path.join(root, release) + '.gz';
  fs.unlinkSync(gzipPath);
  for (const directorySidecar of [false, true]) {
    if (directorySidecar) fs.mkdirSync(gzipPath);
    const response = await rawRequest(base, release, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], undefined);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.body.toString(), contents.get(release));
  }
  fs.unlinkSync(path.join(root, release));
  const failed = await rawRequest(base, release, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(failed.status, 404);
  assert.equal(failed.headers['cache-control'], 'no-store');
  assert.equal(failed.headers['content-encoding'], undefined);
  assert.equal(failed.headers.etag, undefined);
  assert.equal(failed.body.toString(), 'Preview asset unavailable');
});
