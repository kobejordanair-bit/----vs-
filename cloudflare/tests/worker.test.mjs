import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1DocumentStore, splitUtf8, CHUNK_BYTES } from '../src/d1-store.mjs';
import { HttpError, strictJsonParse, readJson, loadUserdata, saveUserdata, loadWorld, saveWorld, USER_DEFAULTS, MAX_WORLD_BYTES, validateWorkspace } from '../src/contracts.mjs';
import { createToken, verifyToken, TOKEN_TTL_SECONDS } from '../src/auth.mjs';
import { generateGemini, streamGemini, PRIMARY_MODEL, FALLBACK_MODEL } from '../src/gemini.mjs';
import { importDocument } from '../src/import-documents.mjs';
import { createWorker } from '../src/worker.mjs';
import { serveLargeJson, acceptsGzip, clientAcceptEncoding } from '../src/static-assets.mjs';
import { gzipSync } from 'node:zlib';

class LocalD1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:');
    this.sql.exec(readFileSync(new URL('../migrations/0001_storage.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const database = this;
    return {
      sql, values: [], bind(...values) { this.values = values; return this; },
      async first() { return database.sql.prepare(this.sql).get(...this.values) || null; },
      async all() { return { results: database.sql.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; },
    };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const results = statements.map((item, index) => {
        this.beforeStatement?.(index);
        const statement = this.sql.prepare(item.sql);
        if (statement.columns().length) return { results: statement.all(...item.values), meta: { changes: Number(this.sql.prepare('SELECT changes() AS changes').get().changes) } };
        return { results: [], meta: { changes: Number(statement.run(...item.values).changes) } };
      });
      this.sql.exec('COMMIT'); return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
const storage = () => { const database = new LocalD1(); return { database, store: new D1DocumentStore(database) }; };
const workspace = () => ({ format: 'dynasty-world-workspace', schemaVersion: 1, sessions: [], activeSessionId: null,
  selection: { enabled: false, setting: { kind: 'free', eventId: '', placeIds: [], factionIds: [] }, recordIds: [], anchors: [], notes: '完整原文與選段' } });
const session = () => ({ id: 'world-one', title: '楚漢', updatedAt: '2026-10-02T12:00:00.000Z', save: { format: 'dynasty-world-save', version: 1, state: { config: { recordIds: ['精確-ID'] }, orders: [], futureInterpretation: { verbatim: '原段落' } } },
  narratives: [{ id: 'n-one', turn: 0, text: '人物說明', createdAt: '2026-10-02T12:00:00.000Z', kind: 'local', contextVersion: '1' }] });
const rejectsStatus = (promise, status) => assert.rejects(promise, error => error instanceof HttpError && error.status === status);
const allFields = () => ({
  customLegends: [{ id: 'general_test', name: '測試人物', deepAnalysis: { body: '長篇分析', future: { x: [1, true, null] } } }],
  modifiedLegends: { general_test: { stats: { leadership: 92 }, unrecognized: ['保留', { a: null }] } },
  chatHistories: { general_test: [{ role: 'user', parts: [{ text: '對話' }] }] },
  simulationHistory: [{ title: '史冊', fullResult: '完整內容', extra: { timeline: ['甲', '乙'] } }],
  discussionHistories: { general_test: { rounds: [{ content: '討論' }] } }, soulSaves: [{ id: 'save_test', snapshot: { chapters: [{ content: '已存章節' }] } }],
  hegemonySavedSim: { factions: [{ name: '測試國' }] }, scenes: [{ id: 'scene_test', unknown: { q: '值' } }], sceneEdits: { scene_test: { desc: '修訂場景' } },
  soulSession: { phase: 'chapters', chapters: [{ content: '當前章節' }], futureState: { relationship: [1, 2] } },
});

test('empty D1 returns complete defaults without creating a document', async () => {
  const { store, database } = storage();
  assert.deepEqual(await loadUserdata(store), { ...USER_DEFAULTS, revision: 0 });
  assert.deepEqual(await loadWorld(store), { revision: 0, workspace: null });
  assert.equal(database.sql.prepare('SELECT count(*) AS count FROM workspace_documents').get().count, 0);
});
test('all ten user fields roundtrip; a missing field is never a deletion', async () => {
  const { store } = storage(); const fields = allFields();
  assert.deepEqual(await saveUserdata(store, { revision: 0, ...fields }), { status: 'ok', revision: 1 });
  assert.deepEqual(await loadUserdata(store), { ...fields, revision: 1 });
  assert.deepEqual(await saveUserdata(store, { revision: 1, scenes: [] }), { status: 'ok', revision: 2 });
  assert.deepEqual(await loadUserdata(store), { ...fields, scenes: [], revision: 2 });
  await saveUserdata(store, { revision: 2, soulSession: null, hegemonySavedSim: null, soulSaves: [] });
  assert.deepEqual(await loadUserdata(store), { ...fields, scenes: [], soulSession: null, hegemonySavedSim: null, soulSaves: [], revision: 3 });
});
test('legacy missing revision and unknown fields survive a patch', async () => {
  const { store } = storage();
  const legacy = { _id: 'main', soulSaves: [{ id: 'legacy' }], futureStory: { neverDelete: [1, { name: '保留' }] } };
  await importDocument(store, 'userdata', legacy);
  assert.equal((await loadUserdata(store)).revision, 0);
  await saveUserdata(store, { revision: 0, modifiedLegends: { exactID: { text: '分析' } } });
  const actual = (await store.read('userdata')).document;
  assert.deepEqual(actual.futureStory, legacy.futureStory); assert.deepEqual(actual.soulSaves, legacy.soulSaves);
  assert.equal(actual._id, 'main'); assert.equal(Object.hasOwn(actual, 'scenes'), false);
});
test('revision conflict and missing nonzero create leave original unchanged', async () => {
  const { store } = storage(); await rejectsStatus(saveUserdata(store, { revision: 8, scenes: [] }), 409);
  await saveUserdata(store, { revision: 0, ...allFields() });
  const before = await store.read('userdata');
  for (const revision of [0, 2, 999]) await rejectsStatus(saveUserdata(store, { revision, scenes: [] }), 409);
  assert.deepEqual(await store.read('userdata'), before);
});
test('stored null or invalid revisions are preserved and never treated as absent zero', async () => {
  for (const revision of [null, true, -1, '0']) {
    const { store } = storage();
    await importDocument(store, 'userdata', { revision, scenes: [{ id: 'original' }] });
    await importDocument(store, 'worldworkspaces', { revision, workspace: workspace() });
    const userBefore = await store.read('userdata'), worldBefore = await store.read('worldworkspaces');
    await rejectsStatus(loadUserdata(store), 409); await rejectsStatus(loadWorld(store), 409);
    await rejectsStatus(saveUserdata(store, { revision: 0, scenes: [] }), 409); await rejectsStatus(saveWorld(store, { revision: 0, workspace: null }), 409);
    assert.deepEqual(await store.read('userdata'), userBefore); assert.deepEqual(await store.read('worldworkspaces'), worldBefore);
  }
});
test('actual SQLite CAS protects competing first writes and stale chunk writes', async () => {
  const { store, database } = storage(); const observed = await store.read('userdata');
  assert.equal(await store.compareAndSwap('userdata', observed, { revision: 1, scenes: [{ id: 'winner' }] }), true);
  const before = database.sql.prepare('SELECT * FROM workspace_chunks').all();
  assert.equal(await store.compareAndSwap('userdata', observed, { revision: 1, scenes: [{ id: 'loser' }] }), false);
  assert.deepEqual(database.sql.prepare('SELECT * FROM workspace_chunks').all(), before);
  const stale = await store.read('userdata');
  assert.equal(await store.compareAndSwap('userdata', stale, { revision: 2, scenes: [] }), true);
  const after = await store.read('userdata');
  assert.equal(await store.compareAndSwap('userdata', stale, { revision: 2, scenes: [{ id: 'stale' }] }), false);
  assert.deepEqual(await store.read('userdata'), after);
});
test('failed D1 batch rolls metadata and all chunks back together', async () => {
  const { store, database } = storage(); await saveUserdata(store, { revision: 0, scenes: [] });
  const before = await store.read('userdata');
  database.beforeStatement = index => { if (index === 2) throw new Error('injected SQL failure'); };
  await assert.rejects(saveUserdata(store, { revision: 1, scenes: [{ text: '甲'.repeat(500000) }] }));
  database.beforeStatement = null;
  assert.deepEqual(await store.read('userdata'), before);
});
const invalidUser = [{}, { scenes: [] }, { revision: 0 }, { revision: -1, scenes: [] }, { revision: '0', scenes: [] }, { revision: true, scenes: [] },
  { revision: 0, customLegends: {} }, { revision: 0, customLegends: ['bad'] }, { revision: 0, modifiedLegends: [] }, { revision: 0, chatHistories: [] },
  { revision: 0, discussionHistories: [] }, { revision: 0, simulationHistory: {} }, { revision: 0, soulSaves: null }, { revision: 0, soulSaves: [1] },
  { revision: 0, soulSession: [] }, { revision: 0, hegemonySavedSim: 'bad' }, { revision: 0, scenes: null }, { revision: 0, sceneEdits: [] }, { revision: 0, unknownField: {} }];
for (const [index, invalid] of invalidUser.entries()) test(`user invalid payload ${index} leaves storage intact`, async () => {
  const { store } = storage(); await importDocument(store, 'userdata', { ...allFields(), revision: 0, future: '保留' });
  const before = await store.read('userdata'); await rejectsStatus(saveUserdata(store, invalid), 422); assert.deepEqual(await store.read('userdata'), before);
});
test('raw JSON preserves strict number type and duplicate key safety', async () => {
  const { store } = storage();
  await rejectsStatus(saveUserdata(store, strictJsonParse('{"revision":0.0,"scenes":[]}')), 422);
  assert.throws(() => strictJsonParse('{"revision":0,"revision":1,"workspace":null}'), HttpError);
  for (const raw of ['NaN', 'Infinity', '1' + '0'.repeat(100), '{broken', '{"a":1,}', '[1,]', 'truefalse']) assert.throws(() => strictJsonParse(raw), HttpError);
  assert.deepEqual(strictJsonParse('{"x":[1,"甲",null,true],"escape":"a\\\"b"}'), { x: [1, '甲', null, true], escape: 'a"b' });
});
test('world complete original text and selection extensions survive roundtrip', async () => {
  const { store } = storage(); const value = workspace(); value.sessions = [session()]; value.activeSessionId = 'world-one';
  value.selection.futureCognition = { memory: ['必須保留', { nested: true }] };
  value.selection.recordIds = ['人物-ID']; value.selection.anchors = [{ kind: 'analysis', recordId: '人物-ID', field: 'deepAnalysis', start: 0, end: 4, quote: '完整原段', principle: 'care' }];
  await saveWorld(store, { revision: 0, workspace: value });
  assert.deepEqual(await loadWorld(store), { revision: 1, workspace: value });
  assert.equal((await store.read('userdata')).document, null);
});
test('world writes preserve unknown envelope and explicit null never touches userdata', async () => {
  const { store } = storage();
  await importDocument(store, 'worldworkspaces', { revision: 8, workspace: workspace(), futureEnvelope: { original: true } });
  await importDocument(store, 'userdata', { revision: 99, soulSession: { chapters: ['原章節'] } });
  const original = await store.read('userdata'); await saveWorld(store, { revision: 8, workspace: null });
  assert.deepEqual((await store.read('worldworkspaces')).document.futureEnvelope, { original: true });
  assert.deepEqual(await loadWorld(store), { revision: 9, workspace: null }); assert.deepEqual(await store.read('userdata'), original);
});
for (const future of [{ ...workspace(), schemaVersion: 2, futureValue: { original: '保留' } }, { ...workspace(), unknownCurrentField: ['保留'] }, { not: 'recognized' }]) test(`future world remains readable and blocks overwrite ${JSON.stringify(future).slice(-30)}`, async () => {
  const { store } = storage(); await importDocument(store, 'worldworkspaces', { revision: 4, workspace: future });
  assert.deepEqual(await loadWorld(store), { revision: 4, workspace: future });
  for (const incoming of [null, workspace()]) await rejectsStatus(saveWorld(store, { revision: 4, workspace: incoming }), 409);
  assert.deepEqual((await store.read('worldworkspaces')).document.workspace, future);
});
const invalidWorldPatches = [{ schemaVersion: true }, { schemaVersion: 2 }, { selection: [] }, { activeSessionId: [] }, { activeSessionId: 'missing' },
  { sessions: [session(), session()] }, { sessions: Array(13).fill(session()) }, { unsupported: true }, { notes: {} }];
for (const [index, patch] of invalidWorldPatches.entries()) test(`world invalid structure ${index} rejected without mutation`, async () => {
  const { store } = storage(); await rejectsStatus(saveWorld(store, { revision: 0, workspace: { ...workspace(), ...patch } }), 422); assert.equal((await store.read('worldworkspaces')).document, null);
});
for (const revision of [true, -1, 1.5, '0', null, Number.MAX_SAFE_INTEGER]) test(`world invalid revision ${JSON.stringify(revision)}`, async () => {
  const { store } = storage(); await rejectsStatus(saveWorld(store, { revision, workspace: workspace() }), 422);
});
const badSession = [item => { item.extra = 'future'; }, item => { item.save.version = 2; }, item => { item.save.version = true; }, item => { item.narratives[0].kind = []; },
  item => { item.narratives[0].turn = true; }, item => { item.narratives[0].unknown = 'future'; }, item => { item.updatedAt = 'invalid'; },
  item => { item.updatedAt = '2026-02-31T00:00:00Z'; }, item => { item.updatedAt = '2026-10-09T24:00:00Z'; }, item => { item.updatedAt = '2026-10-09T12:60:00Z'; },
  item => { item.updatedAt = '2026-02-29T12:00:00Z'; }, item => { item.updatedAt = '2026-10-09T12:00:00+24:00'; }];
for (const [index, mutate] of badSession.entries()) test(`world invalid session ${index}`, async () => {
  const { store } = storage(); const item = session(); mutate(item); const value = workspace(); value.sessions = [item]; value.activeSessionId = item.id;
  await rejectsStatus(saveWorld(store, { revision: 0, workspace: value }), 422);
});
for (const key of ['__proto__', 'constructor', 'prototype', '$set', 'a.b', 'bad\0key']) test(`unsafe world nested key ${JSON.stringify(key)} rejected`, async () => {
  const { store } = storage(); const value = workspace(); Object.defineProperty(value.selection, key, { value: 'unsafe', enumerable: true });
  await rejectsStatus(saveWorld(store, { revision: 0, workspace: value }), 422);
});
test('world UTF-8, strict integer literal and size validation match original safety limits', async () => {
  const { store } = storage(); const value = workspace(); value.selection.notes = '\ud800'; await rejectsStatus(saveWorld(store, { revision: 0, workspace: value }), 422);
  const raw = JSON.stringify({ revision: 0, workspace: workspace() }).replace('"schemaVersion":1', '"schemaVersion":1.0');
  await rejectsStatus(saveWorld(store, strictJsonParse(raw)), 422);
  const huge = workspace(); huge.sessions = [session()]; huge.sessions[0].save.state.text = 'x'.repeat(MAX_WORLD_BYTES);
  await rejectsStatus(saveWorld(store, { revision: 0, workspace: huge }), 413);
  const body = new Request('https://test/api/world-workspace', { method: 'POST', body: 'x'.repeat(MAX_WORLD_BYTES + 1) }); await rejectsStatus(readJson(body, MAX_WORLD_BYTES), 413);
  const invalidUtf8 = new Request('https://test', { method: 'POST', body: new Uint8Array([0xff]) }); await rejectsStatus(readJson(invalidUtf8, MAX_WORLD_BYTES), 422);
});
test('multi-MiB UTF-8 world saves cross D1 row limit without loss', async () => {
  const { store, database } = storage(); const value = workspace(); value.sessions = [session()]; value.sessions[0].save.state.text = '漢😀'.repeat(500000);
  await saveWorld(store, { revision: 0, workspace: value }); assert.deepEqual(await loadWorld(store), { revision: 1, workspace: value });
  const chunks = database.sql.prepare('SELECT content FROM workspace_chunks').all(); assert.ok(chunks.length > 2);
  for (const item of chunks) assert.ok(new TextEncoder().encode(item.content).length <= CHUNK_BYTES);
  assert.equal(splitUtf8('甲😀乙', 4).join(''), '甲😀乙');
});
test('private import preserves a raw snapshot and refuses any replacement', async () => {
  const { store } = storage(); const raw = { _id: 'main', revision: 37, ...allFields(), future: { old: '完整' } };
  await importDocument(store, 'userdata', raw); assert.deepEqual((await store.read('userdata')).document, raw);
  await rejectsStatus(importDocument(store, 'userdata', { revision: 1 }), 409); assert.deepEqual((await store.read('userdata')).document, raw);
});
const fixedNow = Date.parse('2026-10-09T08:00:00Z'), secret = 'test-only-secret';
test('new auth token is signed without exposing password; legacy remains compatible', async () => {
  const token = await createToken(secret, fixedNow); assert.ok(!token.includes(secret)); assert.match(token, /^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
  await verifyToken(token, secret, fixedNow); await verifyToken(`${secret}.${fixedNow / 1000}`, secret, fixedNow);
  await rejectsStatus(verifyToken(null, secret, fixedNow), 403); await rejectsStatus(verifyToken('plain-password', secret, fixedNow), 401);
  await rejectsStatus(verifyToken(`${secret}.${fixedNow / 1000 + 1}`, secret, fixedNow), 401);
  await rejectsStatus(verifyToken(`${secret}.${fixedNow / 1000 - TOKEN_TTL_SECONDS - 1}`, secret, fixedNow), 401);
  await rejectsStatus(verifyToken(token, 'different-secret', fixedNow), 403);
  await rejectsStatus(verifyToken(await createToken(secret, fixedNow + 1000), secret, fixedNow), 401);
});
const aiBody = { contents: [{ role: 'user', parts: [{ text: '測試' }] }], is_json: false };
const successJson = text => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
test('Gemini REST preserves content filtering, JSON configuration and result/model contract', async () => {
  let outgoing;
  const fetcher = async (url, options) => { outgoing = { url, options }; return Response.json(successJson('完整回答')); };
  const body = { contents: [{ role: 'system', parts: [{ text: '背景' }, { text: 'ignored' }] }, { role: 'user', parts: [] }, ...aiBody.contents], is_json: true };
  assert.deepEqual(await generateGemini({ GOOGLE_API_KEY: 'dummy-key' }, body, fetcher), { result: '完整回答', model: PRIMARY_MODEL });
  assert.match(outgoing.url, /^https:\/\/generativelanguage\.googleapis\.com\//); assert.equal(outgoing.options.headers['x-goog-api-key'], 'dummy-key');
  assert.deepEqual(JSON.parse(outgoing.options.body), { contents: [{ role: 'model', parts: [{ text: '背景' }] }, ...aiBody.contents], generationConfig: { responseMimeType: 'application/json' } });
});
for (const status of [429, 503]) test(`Gemini ${status} retries preserved fallback model`, async () => {
  const calls = []; const result = await generateGemini({ GOOGLE_API_KEY: 'dummy-key' }, aiBody, async url => { calls.push(url); return calls.length === 1 ? new Response('quota', { status }) : Response.json(successJson('備援回答')); });
  assert.equal(result.model, FALLBACK_MODEL); assert.ok(calls[1].includes(FALLBACK_MODEL)); assert.equal(calls.length, 2);
});
test('Gemini non-retry errors and missing credentials never leak provider secrets', async () => {
  let calls = 0; await rejectsStatus(generateGemini({ GOOGLE_API_KEY: 'hidden-key' }, aiBody, async () => { calls++; return new Response('hidden-key APP_SECRET verbose stack', { status: 400 }); }), 502); assert.equal(calls, 1);
  await rejectsStatus(generateGemini({}, aiBody, async () => { throw new Error('must not call'); }), 503);
  await rejectsStatus(generateGemini({ GOOGLE_API_KEY: 'key' }, { contents: [] }, async () => { throw new Error('must not call'); }), 400);
});
test('Gemini deployment variables can replace primary and fallback models', async () => {
  const calls = [];
  const result = await generateGemini({ GOOGLE_API_KEY: 'key', GEMINI_PRIMARY_MODEL: 'test-primary', GEMINI_FALLBACK_MODEL: 'test-fallback' }, aiBody, async url => {
    calls.push(url); return calls.length === 1 ? new Response('', { status: 503 }) : Response.json(successJson('可配置回答'));
  });
  assert.ok(calls[0].includes('test-primary')); assert.ok(calls[1].includes('test-fallback')); assert.equal(result.model, 'test-fallback');
});
function sseResponse(values, badTail = '') {
  const bytes = new TextEncoder().encode(values.map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join('') + badTail);
  let position = 0;
  return new Response(new ReadableStream({ pull(controller) { if (position >= bytes.length) { controller.close(); return; } controller.enqueue(bytes.slice(position, position += 7)); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
test('Gemini SSE handles CRLF, split UTF-8, model/text and DONE framing', async () => {
  const response = await streamGemini({ GOOGLE_API_KEY: 'key' }, aiBody, async () => sseResponse([successJson('漢😀'), successJson('第二段')]));
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const text = await response.text(); assert.ok(text.includes(`"model":"${PRIMARY_MODEL}"`)); assert.ok(text.includes('"text":"漢😀"')); assert.ok(text.includes('"text":"第二段"')); assert.ok(text.endsWith('data: [DONE]\n\n'));
});
test('stream opens fallback before HTTP success and reports midstream error without DONE', async () => {
  let calls = 0; const response = await streamGemini({ GOOGLE_API_KEY: 'key' }, aiBody, async () => ++calls === 1 ? new Response('', { status: 503 }) : sseResponse([successJson('部分回答')], 'data: {broken}\n\n'));
  const text = await response.text(); assert.ok(text.includes(FALLBACK_MODEL)); assert.ok(text.includes('"text":"部分回答"')); assert.ok(text.includes('"error":')); assert.ok(!text.includes('[DONE]'));
});
test('stream provider failures return ordinary errors before a success response', async () => {
  await rejectsStatus(streamGemini({ GOOGLE_API_KEY: 'key' }, aiBody, async () => new Response('', { status: 429 })), 429);
});
test('stream EOF without provider completion and MAX_TOKENS never announce DONE', async () => {
  for (const reason of [undefined, 'MAX_TOKENS', 'OTHER', 'FINISH_REASON_UNSPECIFIED']) {
    const partial = { candidates: [{ content: { parts: [{ text: '應保留的部分回覆' }] }, ...(reason ? { finishReason: reason } : {}) }] };
    const response = await streamGemini({ GOOGLE_API_KEY: 'key' }, aiBody, async () => sseResponse([partial]));
    const text = await response.text(); assert.ok(text.includes('應保留的部分回覆')); assert.ok(text.includes('"error":')); assert.ok(!text.includes('[DONE]'));
    await rejectsStatus(generateGemini({ GOOGLE_API_KEY: 'key' }, aiBody, async () => Response.json(partial)), 502);
  }
});
test('stream terminal metadata STOP confirms completion after prior text', async () => {
  const values = [{ candidates: [{ content: { parts: [{ text: '已完整的回覆' }] } }] }, { candidates: [{ finishReason: 'STOP' }] }];
  const response = await streamGemini({ GOOGLE_API_KEY: 'key' }, aiBody, async () => sseResponse(values));
  assert.ok((await response.text()).endsWith('data: [DONE]\n\n'));
});
test('Worker authorization, durable rate limit, contract responses and no Render proxy', async () => {
  const { store } = storage(); const worker = createWorker({ store, now: () => fixedNow, fetcher: async url => { assert.ok(!url.includes('render')); return Response.json(successJson('AI回答')); } });
  const env = { APP_SECRET: secret, GOOGLE_API_KEY: 'key' };
  const request = (path, options = {}) => worker.fetch(new Request(`https://dynasty.piamamba.com${path}`, options), env, {});
  assert.equal((await request('/api/userdata')).status, 403);
  const login = await request('/api/auth', { method: 'POST', body: JSON.stringify({ password: secret }) }); const { token } = await login.json(); assert.ok(!token.includes(secret));
  const headers = { 'x-app-token': token, origin: 'https://dynasty.piamamba.com' };
  const read = await request('/api/userdata', { headers }); assert.equal(read.status, 200); assert.equal((await read.json()).revision, 0); assert.equal(read.headers.get('access-control-allow-origin'), headers.origin);
  const saved = await request('/api/userdata', { method: 'POST', headers, body: '{"revision":0,"scenes":[]}' }); assert.deepEqual(await saved.json(), { status: 'ok', revision: 1 });
  const ai = await request('/api/gemini', { method: 'POST', headers, body: JSON.stringify(aiBody) }); assert.deepEqual(await ai.json(), { result: 'AI回答', model: PRIMARY_MODEL });
  for (let i = 0; i < 4; i++) assert.equal((await request('/api/auth', { method: 'POST', body: '{"password":"wrong"}' })).status, 401);
  const otherWorker = createWorker({ store, now: () => fixedNow }); assert.equal((await otherWorker.fetch(new Request('https://test/api/auth', { method: 'POST', body: JSON.stringify({ password: secret }) }), env, {})).status, 429);
  assert.equal((await request('/api/unknown')).status, 404); assert.equal((await request('/api/auth')).status, 405);
  const deniedOrigin = await request('/api/userdata', { headers: { ...headers, origin: 'https://untrusted.example' } }); assert.equal(deniedOrigin.headers.get('access-control-allow-origin'), null);
});
test('Worker import gate prevents reads/writes of incomplete migrated data', async () => {
  const { store } = storage(); const token = await createToken(secret, fixedNow); const worker = createWorker({ store, now: () => fixedNow });
  for (const path of ['/api/userdata', '/api/world-workspace']) for (const method of ['GET', 'POST']) {
    const response = await worker.fetch(new Request(`https://test${path}`, { method, headers: { 'x-app-token': token }, ...(method === 'POST' ? { body: '{}' } : {}) }), { APP_SECRET: secret, DATA_READY: 'false' }, {});
    assert.equal(response.status, 503);
  }
  assert.equal((await store.read('userdata')).document, null); assert.equal((await store.read('worldworkspaces')).document, null);
});
test('compressed public JSON supports identity, gzip negotiation and HEAD', async () => {
  const body = JSON.stringify({ title: '清史稿', records: ['完整公開原文'] }); const seen = [];
  const env = { ASSETS: { async fetch(request) {
    seen.push(new URL(request.url).pathname);
    if (new URL(request.url).pathname.endsWith('.gz')) {
      for (const header of ['range', 'if-range', 'if-none-match', 'if-modified-since']) assert.equal(request.headers.get(header), null);
    }
    return new Response(request.method === 'HEAD' ? null : gzipSync(body), { headers: { 'Content-Type': 'application/gzip', 'Content-Length': '99', ETag: 'compressed', ...(new URL(request.url).pathname.endsWith('.gz') ? {} : { 'Content-Encoding': 'gzip' }) } });
  } } };
  const url = 'https://dynasty.piamamba.com/static/data/history/archive-books/qingshigao.json';
  const identity = await serveLargeJson(new Request(url, { headers: { 'accept-encoding': 'gzip;q=0, *;q=1', range: 'bytes=0-10', 'if-range': 'compressed', 'if-none-match': 'compressed', 'if-modified-since': '2026-10-08' } }), env);
  assert.deepEqual(await identity.json(), JSON.parse(body)); assert.equal(identity.headers.get('content-encoding'), null); assert.equal(identity.headers.get('content-length'), null); assert.equal(identity.headers.get('vary'), 'Accept-Encoding');
  assert.ok(seen[0].endsWith('.gz'));
  const compressed = await serveLargeJson(new Request(url, { headers: { 'accept-encoding': 'br, gzip;q=0.5' } }), env); assert.equal(compressed.headers.get('content-encoding'), 'gzip'); assert.ok(seen[1].endsWith('.gz'));
  const head = await serveLargeJson(new Request(url, { method: 'HEAD', headers: { 'accept-encoding': 'identity' } }), env); assert.equal(await head.text(), '');
  assert.equal(await serveLargeJson(new Request('https://test/ordinary.json'), env), null);
  for (const header of ['', 'gzip;q=0', 'gzip;q=no', 'gzip;q=2', '*;q=1,gzip;q=0']) assert.equal(acceptsGzip(header), false);
  for (const header of ['gzip', '*;q=1', 'br, gzip;q=0.01']) assert.equal(acceptsGzip(header), true);
});
test('Cloudflare original client encoding wins over normalized headers and 304 keeps canonical headers', async () => {
  const request = new Request('https://test/static/data/history/source-archive.v1.json', { headers: { 'accept-encoding': 'br, gzip' } });
  Object.defineProperty(request, 'cf', { value: { clientAcceptEncoding: 'identity' } });
  assert.equal(clientAcceptEncoding(request), 'identity');
  const data = gzipSync('{"original":true}');
  const identity = await serveLargeJson(request, { ASSETS: { fetch: async () => new Response(data) } });
  assert.deepEqual(await identity.json(), { original: true }); assert.equal(identity.headers.get('content-encoding'), null);
  const notModified = await serveLargeJson(new Request(request.url, { headers: { 'accept-encoding': 'gzip', 'if-none-match': 'compressed' } }), { ASSETS: { fetch: async () => new Response(null, { status: 304, headers: { 'Content-Type': 'application/gzip' } }) } });
  assert.equal(notModified.status, 304); assert.equal(notModified.headers.get('content-type'), 'application/json; charset=utf-8'); assert.equal(notModified.headers.get('content-encoding'), 'gzip'); assert.equal(notModified.headers.get('vary'), 'Accept-Encoding');
});
