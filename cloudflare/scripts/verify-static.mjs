#!/usr/bin/env node
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const report = JSON.parse(await fs.readFile(new URL('../build/assets-report.json', import.meta.url), 'utf8'));
const base = new URL(process.argv[2] || 'http://127.0.0.1:8878');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search) throw new Error('需要不含帳密的網站 origin');
const checks = [], files = new Map(report.files.map(file => [file.path, file]));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function check(route, asset, { encoding, head = false, status = 200, csp = false, immutable = false } = {}) {
  const started = performance.now();
  const response = await fetch(new URL(route, base), { method: head ? 'HEAD' : 'GET', headers: encoding ? { 'Accept-Encoding': encoding } : {}, signal: AbortSignal.timeout(90000) });
  const body = Buffer.from(await response.arrayBuffer());
  const expected = asset ? files.get(asset) : null;
  if (asset && !expected) throw new Error('build 報告缺少指定資產');
  const digest = hash(body);
  const matching = !asset || head || digest === (expected.mode === 'gzip-canonical' ? expected.sourceSha256 : expected.sha256);
  const findings = [];
  if (response.status !== status) findings.push('HTTP status');
  if (!matching) findings.push('content hash');
  if (asset?.endsWith('.json') && !head && response.status === 200) {
    try { JSON.parse(body.toString('utf8')); } catch { findings.push('JSON decode'); }
  }
  if (csp && !response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) findings.push('CSP');
  if (immutable && !response.headers.get('cache-control')?.includes('immutable')) findings.push('immutable cache');
  if (head && body.length) findings.push('HEAD body');
  if (encoding === 'identity' && response.headers.get('content-encoding')) findings.push('identity content encoding');
  checks.push({ route, encoding: encoding || 'default', method: head ? 'HEAD' : 'GET', status: response.status, bytes: body.length, elapsedMs: Math.round(performance.now() - started), sha256: digest, sourceMatches: matching, passed: findings.length === 0, findings });
  console.log(`${findings.length ? 'FAIL' : 'PASS'} ${head ? 'HEAD' : 'GET'} ${route} ${encoding || ''}`);
}
for (const [route, asset, csp] of [['/', 'index.html'], ['/play', 'index.html'], ['/history-lab', 'history-lab.html', true], ['/history-lab.html', 'history-lab.html', true], ['/source-archive', 'source-archive.html', true], ['/source-archive.html', 'source-archive.html', true], ['/manifest.json', 'manifest.json'], ['/sw.js', 'sw.js']]) await check(route, asset, { csp });
await check('/static/icon-192.png', 'static/icon-192.png', { immutable: true });
await check('/static/icon-512.png', 'static/icon-512.png', { immutable: true, head: true });
for (const asset of ['static/data/legends.js', 'static/js/world-engine.js', 'static/js/history-lab.js', 'static/js/source-archive.js', 'static/data/history/web/manifest.json']) if (files.has(asset)) await check(`/${asset}`, asset);
const prefix = `static/data/history/web/releases/${report.archive.version}/`;
for (const folder of ['books/', 'records/', 'search/', 'documents/']) {
  const sample = report.files.find(file => file.path.startsWith(prefix + folder) && file.path.endsWith('.json'));
  if (sample) await check('/' + sample.path, sample.path, { immutable: true });
}
for (const route of report.gzipCanonicalPaths) {
  await check(route, route.slice(1), { encoding: 'gzip' });
  await check(route, route.slice(1), { encoding: 'identity' });
  await check(route, route.slice(1), { encoding: 'gzip;q=0, *;q=1', head: true });
}
await check('/private-library.json', null, { status: 404 });
await check('/api/nonexistent-migration-test', null, { status: 404 });
await check('/nonexistent-migration-test', null, { status: 404 });
const outcome = { format: 'dynasty-static-http-verification', testedAt: new Date().toISOString(), origin: base.origin, appVersion: report.appVersion, privateDataIncluded: false, passed: checks.every(check => check.passed), checks };
const output = process.argv[3] || new URL('../build/http-verification.json', import.meta.url);
await fs.writeFile(output, JSON.stringify(outcome, null, 2));
console.log(JSON.stringify({ passed: outcome.passed, total: checks.length }));
if (!outcome.passed) process.exitCode = 1;
