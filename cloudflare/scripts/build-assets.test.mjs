import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildAssets } from './build-assets.mjs';

function fixture(t) {
  const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'test-fixtures');
  fs.mkdirSync(fixtures, { recursive: true });
  const root = fs.mkdtempSync(path.join(fixtures, 'dynasty-assets-test-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    if (path.dirname(resolved) !== fs.realpathSync(fixtures) || !path.basename(resolved).startsWith('dynasty-assets-test-')) throw new Error('Unexpected fixture cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const backend = path.join(root, 'backend');
  function write(name, body) {
    const target = path.join(backend, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    return target;
  }
  write('main.py', 'APP_VERSION = "16.0"\n');
  write('index.html', '<script src="/static/js/game.js?v=16.0"></script>');
  write('history-lab.html', '<link href="/static/css/history.css" rel="stylesheet">');
  write('source-archive.html', '<script src="/static/js/game.js"></script>');
  write('manifest.json', JSON.stringify({ icons: [{ src: '/static/icon-192.png' }, { src: '/static/icon-512.png?v=custom' }] }));
  write('sw.js', "self.addEventListener('fetch', () => {});\n");
  write('static/js/game.js', 'window.game = true;\n');
  write('static/css/history.css', 'body { color: black; }');
  write('static/icon-192.png', 'image-fixture');
  write('static/icon-512.png', 'image-fixture');
  write('static/data/history/web/releases/0123456789abcdef/people.json', '{"person":"韓信"}');
  write('static/data/history/web/releases/0123456789abcdef/people.json.gz', zlib.gzipSync(Buffer.from('{"person":"韓信"}')));
  write('.env', 'APP_SECRET=never-publish');
  write('private-library.json', '{"private":"never-publish"}');
  return { root, write, output: path.join(root, 'cloudflare', 'build', 'assets') };
}

test('preserves public files, PWA paths, archive gzip pairs, and excludes backend secrets', t => {
  const site = fixture(t);
  const report = buildAssets(site.root);
  assert.equal(report.gzipPairsVerified, 1);
  assert.equal(report.appVersion, '16.0');
  assert.equal(report.sourceFiles, 11);
  assert.equal(report.assetCount, 11);
  assert.equal(report.outputFiles, 13);
  assert.equal(fs.existsSync(path.join(site.output, '.env')), false);
  assert.equal(fs.existsSync(path.join(site.output, 'private-library.json')), false);
  assert.equal(fs.existsSync(path.join(site.output, 'main.py')), false);
  assert.equal(fs.readFileSync(path.join(site.output, 'static/js/game.js'), 'utf8'), 'window.game = true;\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(site.output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.icons[0].src, '/static/icon-192.png?v=16.0');
  assert.equal(manifest.icons[1].src, '/static/icon-512.png?v=custom');
  assert.match(fs.readFileSync(path.join(site.output, '_redirects'), 'utf8'), /^\/play \/index.html 200/m);
  assert.match(fs.readFileSync(path.join(site.output, '_redirects'), 'utf8'), /^\/ \/index.html 200/m);
  assert.match(fs.readFileSync(path.join(site.output, '_headers'), 'utf8'), /\/static\/data\/history\/web\/releases\/0123456789abcdef\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
});

test('retains oversized JSON content through a verified gzip canonical URL and download', t => {
  const site = fixture(t);
  const original = Buffer.from(JSON.stringify({ text: '史記韓信'.repeat(4000) }));
  site.write('static/data/history/archive-books/qingshigao.json', original);
  const report = buildAssets(site.root, { maxAssetBytes: 8192 });
  const canonical = 'static/data/history/archive-books/qingshigao.json';
  assert.deepEqual(report.gzipCanonicalPaths, ['/' + canonical]);
  assert.deepEqual(zlib.gunzipSync(fs.readFileSync(path.join(site.output, canonical))), original);
  assert.deepEqual(fs.readFileSync(path.join(site.output, canonical + '.gz')), fs.readFileSync(path.join(site.output, canonical)));
  const headers = fs.readFileSync(path.join(site.output, '_headers'), 'utf8');
  assert.match(headers, /Content-Encoding: gzip/);
  assert.match(headers, /Content-Type: application\/json; charset=utf-8/);
  assert.match(headers, /Vary: Accept-Encoding/);
  assert.ok(report.files.every(file => file.bytes <= 8192));
});

test('fails on mismatched archive gzip rather than deploying damaged source content', t => {
  const site = fixture(t);
  buildAssets(site.root);
  const oldHtml = fs.readFileSync(path.join(site.output, 'index.html'));
  site.write('static/data/history/web/releases/0123456789abcdef/people.json.gz', zlib.gzipSync(Buffer.from('wrong-content')));
  assert.throws(() => buildAssets(site.root), /Gzip contents do not match source/);
  assert.deepEqual(fs.readFileSync(path.join(site.output, 'index.html')), oldHtml);
});

test('rejects a private file accidentally placed in the public static directory', t => {
  const site = fixture(t);
  site.write('static/private-library.json', '{"private":"must-not-publish"}');
  assert.throws(() => buildAssets(site.root), /Unexpected or private file/);
  assert.equal(fs.existsSync(site.output), false);
});

test('fails early when HTML references a missing script', t => {
  const site = fixture(t);
  site.write('source-archive.html', '<script src="/static/js/missing.js"></script>');
  assert.throws(() => buildAssets(site.root), /HTML resource missing from deployment/);
});

test('enforces free asset count and per-file maximum without deleting the last good build', t => {
  const site = fixture(t);
  buildAssets(site.root);
  const oldHtml = fs.readFileSync(path.join(site.output, 'index.html'));
  assert.throws(() => buildAssets(site.root, { maxAssetCount: 10 }), /Static asset count 11 exceeds 10/);
  site.write('static/data/history/archive-books/qingshigao.json', JSON.stringify({ text: crypto.randomBytes(40_000).toString('hex') }));
  assert.throws(() => buildAssets(site.root, { maxAssetBytes: 8192 }), /Asset exceeds 8192 bytes/);
  assert.deepEqual(fs.readFileSync(path.join(site.output, 'index.html')), oldHtml);
});

test('refuses a new oversized canonical URL until Worker gzip routing is registered', t => {
  const site = fixture(t);
  site.write('static/data/history/unregistered-large.json', JSON.stringify({ text: '史記'.repeat(10000) }));
  assert.throws(() => buildAssets(site.root, { maxAssetBytes: 8192 }), /Oversized JSON route is not registered/);
  assert.equal(fs.existsSync(site.output), false);
});

test('checks archive manifest paths against published files', t => {
  const site = fixture(t);
  site.write('static/data/history/web/manifest.json', JSON.stringify({ version: '0123456789abcdef', summary: { documents: 0 }, documentCatalogPath: '/static/data/history/web/releases/0123456789abcdef/missing.json' }));
  assert.throws(() => buildAssets(site.root), /Archive manifest resource missing/);
});
