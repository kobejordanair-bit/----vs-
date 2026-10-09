import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { gzipSync } from 'node:zlib';

test('real workerd executes Free SQLite DO with D1 auth and multi-MiB cloud contracts', { timeout: 60000 }, async () => {
  const stateRoot = fileURLToPath(new URL('../.wrangler/', import.meta.url)); mkdirSync(stateRoot, { recursive: true });
  const state = mkdtempSync(`${stateRoot}rt-`);
  const assetsDirectory = `${state}/assets`, archivePath = '/static/data/history/archive-books/qingshigao.json';
  mkdirSync(`${assetsDirectory}/static/data/history/archive-books`, { recursive: true });
  const archiveFixture = { title: '完整公開史料', text: '漢😀'.repeat(1000) }, compressedFixture = gzipSync(JSON.stringify(archiveFixture));
  writeFileSync(`${assetsDirectory}${archivePath}`, compressedFixture); writeFileSync(`${assetsDirectory}${archivePath}.gz`, compressedFixture);
  writeFileSync(`${assetsDirectory}/_headers`, `${archivePath}\n  Content-Encoding: gzip\n  Content-Type: application/json; charset=utf-8\n`);
  const instance = new Miniflare(convertV4MiniflareOptions({
    resourceTmpPath: `${state}/tmp`, resourcePersistencePath: `${state}/persist`, isolatedResourcePersistencePath: `${state}/isolated`,
    workers: [{
    name: 'dynasty',
    modules: ['runtime', 'worker', 'contracts', 'd1-store', 'auth', 'gemini', 'static-assets'].map(name => ({ type: 'ESModule', path: fileURLToPath(new URL(`../src/${name}.mjs`, import.meta.url)) })),
    compatibilityDate: '2026-10-09',
    durableObjects: { DYNASTY_API: { className: 'DynastyApi', useSQLite: true } },
    d1Databases: { DYNASTY_DB: 'local-contract-test' },
    bindings: { APP_SECRET: 'runtime-test-only-secret', ALLOWED_ORIGINS: 'https://dynasty.piamamba.com' },
    assets: { directory: assetsDirectory, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { html_handling: 'none', not_found_handling: 'none' } },
    }],
  }));
  try {
    const database = await instance.getD1Database('DYNASTY_DB');
    const schema = readFileSync(new URL('../migrations/0001_storage.sql', import.meta.url), 'utf8');
    for (const query of schema.split(';').map(value => value.trim()).filter(Boolean)) await database.prepare(query).run();
    const privateCheck = await instance.dispatchFetch('https://dynasty.piamamba.com/private-library.json'); assert.equal(privateCheck.status, 404, await privateCheck.clone().text());
    const unauthenticated = await instance.dispatchFetch('https://dynasty.piamamba.com/api/userdata');
    assert.equal(unauthenticated.status, 403, await unauthenticated.clone().text());
    const login = await instance.dispatchFetch('https://dynasty.piamamba.com/api/auth', { method: 'POST', body: '{"password":"runtime-test-only-secret"}' });
    assert.equal(login.status, 200);
    const { token } = await login.json(); assert.ok(!token.includes('runtime-test-only-secret'));
    const headers = { 'x-app-token': token, 'Content-Type': 'application/json' };
    const figure = { id: 'exact-record-962', name: '完整人物', deepAnalysis: '人物原始深度分析😀'.repeat(100000), futureField: { retained: '原文' } };
    const userdata = { revision: 0, customLegends: [figure], soulSession: { chapters: [{ content: '尚未結束的章節' }] } };
    const saved = await instance.dispatchFetch('https://dynasty.piamamba.com/api/userdata', { method: 'POST', headers, body: JSON.stringify(userdata) });
    assert.equal(saved.status, 200, await saved.clone().text()); assert.deepEqual(await saved.json(), { status: 'ok', revision: 1 });
    const loaded = await (await instance.dispatchFetch('https://dynasty.piamamba.com/api/userdata', { headers })).json();
    assert.deepEqual(loaded.customLegends, [figure]); assert.deepEqual(loaded.soulSession, userdata.soulSession);
    const patch = await instance.dispatchFetch('https://dynasty.piamamba.com/api/userdata', { method: 'POST', headers, body: '{"revision":1,"scenes":[]}' }); assert.equal(patch.status, 200);
    const preserved = await (await instance.dispatchFetch('https://dynasty.piamamba.com/api/userdata', { headers })).json(); assert.deepEqual(preserved.customLegends, [figure]);
    const stale = await instance.dispatchFetch('https://dynasty.piamamba.com/api/userdata', { method: 'POST', headers, body: '{"revision":1,"customLegends":[]}' }); assert.equal(stale.status, 409);
    const racing = await Promise.all(['one', 'two'].map(id => instance.dispatchFetch('https://dynasty.piamamba.com/api/userdata', { method: 'POST', headers, body: JSON.stringify({ revision: 2, scenes: [{ id }] }) })));
    assert.deepEqual(racing.map(response => response.status).sort(), [200, 409]);
    const world = { format: 'dynasty-world-workspace', schemaVersion: 1, sessions: [{ id: 'world-one', title: '完整世界', updatedAt: '2026-10-09T08:00:00.000Z', save: { format: 'dynasty-world-save', version: 1, state: { paragraphs: '漢😀'.repeat(500000) } }, narratives: [] }], activeSessionId: 'world-one', selection: { enabled: true, recordIds: ['exact-record-962'], anchors: [], setting: { kind: 'free', eventId: '', placeIds: [], factionIds: [] }, notes: '共用背景' } };
    const savedWorld = await instance.dispatchFetch('https://dynasty.piamamba.com/api/world-workspace', { method: 'POST', headers, body: JSON.stringify({ revision: 0, workspace: world }) });
    assert.equal(savedWorld.status, 200, await savedWorld.clone().text());
    const loadedWorld = await (await instance.dispatchFetch('https://dynasty.piamamba.com/api/world-workspace', { headers })).json(); assert.deepEqual(loadedWorld, { revision: 1, workspace: world });
    const health = await instance.dispatchFetch('https://dynasty.piamamba.com/api/health'); assert.equal(health.status, 200); assert.equal((await health.json()).runtime, 'cloudflare-workers');
    const documentCount = await database.prepare('SELECT count(*) AS count FROM workspace_documents').first(); assert.equal(documentCount.count, 2);
    const chunks = await database.prepare('SELECT count(*) AS count FROM workspace_chunks').first(); assert.ok(chunks.count > 3);
    assert.equal((await instance.dispatchFetch('https://dynasty.piamamba.com/private-library.json')).status, 404);
    const origin = (await instance.ready).origin;
    const identity = await fetch(`${origin}${archivePath}?local-test=1`, { headers: { 'accept-encoding': 'identity', Range: 'bytes=0-10', 'If-None-Match': 'compressed-placeholder' } });
    assert.equal(identity.status, 200); assert.equal(identity.headers.get('content-encoding'), null); assert.equal(identity.headers.get('vary'), 'Accept-Encoding'); assert.deepEqual(await identity.json(), archiveFixture);
    const gzip = await fetch(`${origin}${archivePath}`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gzip.status, 200); assert.equal(gzip.headers.get('content-encoding'), 'gzip');
    assert.deepEqual(await gzip.json(), archiveFixture);
    const head = await fetch(`${origin}${archivePath}`, { method: 'HEAD', headers: { 'accept-encoding': 'gzip;q=0, *;q=1' } });
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-encoding'), null); assert.equal(await head.text(), '');
    // No GOOGLE_API_KEY or live fetch is configured; this test makes no model call.
    const missingKey = await instance.dispatchFetch('https://dynasty.piamamba.com/api/gemini', { method: 'POST', headers, body: '{"contents":[{"role":"user","parts":[{"text":"不應發出真實AI呼叫"}]}]}' }); assert.equal(missingKey.status, 503);
  } finally {
    await instance.dispose();
    if (!state.startsWith(`${stateRoot}rt-`)) throw new Error('Refusing to remove a runtime directory outside the test workspace');
    rmSync(state, { recursive: true, force: true });
  }
});
