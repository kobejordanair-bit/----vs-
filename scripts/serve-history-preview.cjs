'use strict';
// Standalone loopback preview: no database, credentials, AI provider or build step.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseLibrary } = require('../backend/static/js/history-data.js');
const ROOT = path.resolve(__dirname, '../backend');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const ASSETS = new Set([
  '/history-lab.html', '/static/js/history-data.js', '/static/js/history-investigation.js',
  '/static/js/history-lab.js', '/static/css/history-lab.css', '/static/data/legends.js',
  '/static/data/history/chuhan-foundation.v1.json', '/static/data/history/schema.v1.json',
  '/static/data/history/chuhan-cases.v1.json', '/static/art/history/archive-hall-v1.png',
  '/static/art/history/asset-provenance.json', '/source-archive.html',
  '/static/js/source-archive.js', '/static/css/source-archive.css', '/static/data/history/source-archive.v1.json'
]);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

function readPrivateLibrary(filename, root = ROOT) {
  if (fs.statSync(filename).size > 30_000_000) throw new Error('人物檔超過30MB。');
  const input = fs.readFileSync(filename, 'utf8');
  const base = vm.runInNewContext(fs.readFileSync(path.join(root, 'static/data/legends.js'), 'utf8') + '\nstaticLegendsData;', {}, { timeout: 1000 });
  const records = parseLibrary(input, base);
  return { raw: Buffer.from(JSON.stringify(records)), count: records.length };
}

function createPreviewServer(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const library = options.libraryPath ? readPrivateLibrary(options.libraryPath, root) : null;
  const snapshotDate = options.snapshotDate || null;
  if (snapshotDate && !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error('快照日期須使用YYYY-MM-DD。');
  const requests = [];
  const server = http.createServer((request, response) => {
    const address = server.address();
    const allowedHosts = new Set(['127.0.0.1:' + address.port, 'localhost:' + address.port]);
    if (!allowedHosts.has(request.headers.host)) { response.writeHead(403); response.end('Loopback host required'); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch { response.writeHead(400); response.end('Invalid URL'); return; }
    requests.push({ method: request.method, path: pathname });
    if (requests.length > 300) requests.shift();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', CSP);
    const origin = request.headers.origin;
    if ((origin && ![...allowedHosts].some(host => origin === 'http://' + host)) || request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403); response.end('Local preview only'); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    if (pathname === '/' || pathname === '/history-lab') {
      response.writeHead(302, { Location: '/history-lab.html' + (library ? '?local=1' : '') }); response.end(); return;
    }
    if (pathname === '/source-archive') { response.writeHead(302, { Location: '/source-archive.html' }); response.end(); return; }
    if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    let raw, type;
    if (pathname === '/private-library.json' && library) {
      raw = library.raw; type = MIME['.json'];
      if (snapshotDate) response.setHeader('X-Library-Snapshot-Date', snapshotDate);
    } else if (pathname === '/preview-audit') {
      raw = Buffer.from(JSON.stringify({ productionWrites: 0, modelCalls: 0, libraryRecords: library?.count || 0, snapshotDate, requests })); type = MIME['.json'];
    } else if (ASSETS.has(pathname) || /^\/static\/data\/history\/archive-books\/[a-z]+\.json$/.test(pathname)) {
      const filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
      try { raw = fs.readFileSync(filename); type = MIME[path.extname(filename)]; }
      catch { response.writeHead(404); response.end('Preview asset unavailable'); return; }
    } else { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': raw.length });
    response.end(request.method === 'HEAD' ? undefined : raw);
  });
  return server;
}

function parseOptions(args) {
  const options = { port: 8877 };
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--port': 'port', '--library': 'libraryPath', '--snapshot-date': 'snapshotDate' }[args[i]];
    if (!key || !args[i + 1]) throw new Error('用法：node scripts/serve-history-preview.cjs [--port 8877] [--library 完整人物.json] [--snapshot-date YYYY-MM-DD]');
    options[key] = key === 'port' ? Number(args[i + 1]) : args[i + 1];
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('port須在1024至65535之間。');
  return options;
}

if (require.main === module) {
  try {
    const options = parseOptions(process.argv.slice(2)), server = createPreviewServer(options);
    server.on('error', error => { console.error('預覽服務未啟動：' + error.message); process.exitCode = 1; });
    server.listen(options.port, '127.0.0.1', () => {
      console.log('來源檔案館： http://127.0.0.1:' + options.port + '/source-archive');
      console.log('史論案卷： http://127.0.0.1:' + options.port + '/history-lab.html' + (options.libraryPath ? '?local=1' : ''));
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createPreviewServer, readPrivateLibrary, parseOptions };
