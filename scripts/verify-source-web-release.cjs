'use strict';
// Public, read-only deployment verification. No credentials, model calls or writes.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const http = require('node:http'), https = require('node:https'), zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { createEngine } = require('../backend/static/js/source-search-engine.js');
const root = path.resolve(__dirname, '..'), backend = path.join(root, 'backend');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function request(base, route, headers = {}, method = 'GET') {
  const url = new URL(route, base);
  if (url.origin !== new URL(base).origin) throw Error('Cross-origin release path');
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, headers, timeout: 55000 }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => {
        try { const wire = Buffer.concat(chunks), body = wire.length && res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(wire) : wire; resolve({ status: res.statusCode, headers: res.headers, wire, body }); }
        catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(Error('HTTP verification timed out'))); req.on('error', reject); req.end();
  });
}
async function verify(base) {
  const expected = JSON.parse(fs.readFileSync(path.join(backend, 'static/data/history/web/manifest.json'))), checks = [];
  function check(name, fn) { fn(); checks.push(name); }
  for (const [route, file] of [['/', 'index.html'], ['/source-archive', 'source-archive.html'], ['/history-lab', 'history-lab.html']]) {
    const response = await request(base, route);
    check(route + ' matches shipped HTML', () => { assert.equal(response.status, 200); assert.equal(response.body.toString().replace(/\r\n/g, '\n'), fs.readFileSync(path.join(backend, file), 'utf8').replace(/\r\n/g, '\n')); });
    if (route !== '/') check(route + ' permits same-origin workers only', () => assert.match(response.headers['content-security-policy'], /worker-src 'self'/));
  }
  const openapi = await request(base, '/openapi.json');
  check('API release version', () => { assert.equal(openapi.status, 200); assert.equal(JSON.parse(openapi.body).info.version, '15.14'); });
  const manifestPath = '/static/data/history/web/manifest.json';
  const response = await request(base, manifestPath, { 'Accept-Encoding': 'gzip' });
  let manifest;
  check('compressed manifest matches committed bytes', () => {
    assert.equal(response.status, 200); assert.equal(response.headers['content-encoding'], 'gzip');
    assert.match(response.headers['cache-control'], /no-cache/); assert.match(response.headers.vary, /Accept-Encoding/i);
    assert.equal(sha(response.body), sha(fs.readFileSync(path.join(backend, manifestPath))));
    manifest = JSON.parse(response.body); assert.equal(manifest.version, expected.version); assert.equal(manifest.dossiers.length, 962); assert.equal(manifest.search.documentCount, 4254);
  });
  const unchanged = await request(base, manifestPath, { 'Accept-Encoding': 'gzip', 'If-None-Match': response.headers.etag });
  check('manifest ETag revalidation', () => assert.equal(unchanged.status, 304));
  const routes = ['/static/js/source-archive.js', '/static/js/source-search-engine.js', '/static/js/source-search-worker.js', '/static/js/source-links.js', '/static/css/source-archive.css', '/static/js/history-lab.js'];
  for (const route of routes) {
    const asset = await request(base, route, { 'Accept-Encoding': 'gzip' });
    check(route + ' matches release', () => { assert.equal(asset.status, 200); assert.equal(asset.body.toString().replace(/\r\n/g, '\n'), fs.readFileSync(path.join(backend, route), 'utf8').replace(/\r\n/g, '\n')); });
  }
  const person = await request(base, manifest.dossiers[0].detailPath, { 'Accept-Encoding': 'gzip' });
  check('exact-ID dossier and immutable policy', () => { assert.equal(person.status, 200); assert.equal(JSON.parse(person.body).recordId, manifest.dossiers[0].recordId); assert.match(person.headers['cache-control'], /max-age=31536000, immutable/); });
  const catalog = await request(base, manifest.books[0].documentsPath, { 'Accept-Encoding': 'gzip' });
  assert.equal(catalog.status, 200); const document = JSON.parse(catalog.body).documents.find(item => item.textLength > 0) || JSON.parse(catalog.body).documents[0];
  for (const route of [document.textPath, document.wikitextPath]) {
    const reading = await request(base, route, { 'Accept-Encoding': 'gzip' });
    check('individual reading bytes ' + route, () => { assert.equal(reading.status, 200); assert.equal(sha(reading.body), sha(fs.readFileSync(path.join(backend, route)))); assert.match(reading.headers['cache-control'], /immutable/); });
  }
  const requests = [];
  const engine = createEngine({ search: manifest.search, fetchJSON: async route => {
    const result = await request(base, route, { 'Accept-Encoding': 'gzip' }); assert.equal(result.status, 200);
    assert.equal(sha(result.body), sha(fs.readFileSync(path.join(backend, route)))); requests.push({ route, wireBytes: result.wire.length }); return JSON.parse(result.body);
  } });
  const search = await engine.search('韓信');
  check('live indexed literal search', () => { assert.ok(search.results.length > 0); assert.equal(search.documentsSearched, 4254); assert.ok(requests.every(item => item.route.includes('/search/'))); });
  const privateRoute = await request(base, '/private-library.json');
  check('private local snapshot unavailable publicly', () => assert.equal(privateRoute.status, 404));
  const userdata = await request(base, '/api/userdata');
  check('cloud data remains authenticated', () => assert.equal(userdata.status, 403));
  return { verifiedAt: new Date().toISOString(), base, appVersion: '15.14', release: manifest.version, passed: checks.length, checks, manifestWireBytes: response.wire.length, search: { query: '韓信', documentHits: search.results.length, totalMatches: search.totalMatches, requests, wireBytes: requests.reduce((sum, item) => sum + item.wireBytes, 0) }, limitation: 'Read-only HTTP and search-engine validation; not a rendered browser visual check.' };
}
if (require.main === module) {
  const base = process.argv[2] || 'https://dynasty-ydov.onrender.com', output = process.argv[3];
  verify(base).then(report => { if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verify, request };
