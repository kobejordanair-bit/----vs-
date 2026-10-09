import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLiveApi, parseArguments, verifySse, expectedSnapshots } from '../scripts/verify-live-api.mjs';
const secret = 'synthetic-only-password', token = 'synthetic-only-token';
const snapshot = () => ({ format: 'dynasty-migration-snapshot', schemaVersion: 1, documents: { userdata: { revision: 7, scenes: [{ id: 'exact-id', text: '絕不可列印的原始人物資料' }], futureLegacy: { retain: true } }, worldworkspaces: { revision: 3, workspace: null, futureEnvelope: { original: '未知原件' } } } });
function fake(source, { mismatch = false, leakError = false } = {}) {
  const expected = expectedSnapshots(source), calls = [];
  let userdata = structuredClone(expected.userdata), world = structuredClone(expected.world);
  if (mismatch) userdata.futureLegacy = { retain: false };
  return {
    calls,
    async fetcher(url, options) {
      const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ path, method: options.method, body });
      if (path === '/api/health') return Response.json({ status: 'ok', storageReady: true, runtime: 'cloudflare-workers' });
      if (path === '/api/auth') return body.password === secret ? Response.json({ token }) : Response.json({ detail: leakError ? `${secret} ${token} 絕不可列印的原始人物資料` : 'wrong' }, { status: 401 });
      if (options.headers['x-app-token'] !== token) return Response.json({ detail: 'denied' }, { status: 403 });
      if (path === '/api/userdata' || path === '/api/world-workspace') {
        let value = path === '/api/userdata' ? userdata : world;
        if (options.method === 'GET') return Response.json(value);
        if (body.revision !== value.revision) return Response.json({ detail: 'conflict' }, { status: 409 });
        value = { ...value, ...body, revision: value.revision + 1 };
        if (path === '/api/userdata') userdata = value; else world = value;
        return Response.json({ status: 'ok', revision: value.revision });
      }
      if (path === '/api/gemini') return Response.json({ model: 'gemini-test-model', result: body.is_json ? '{"ok":true}' : 'OK' });
      if (path === '/api/gemini/stream') return new Response('data: {"model":"gemini-test-model"}\n\ndata: {"text":"OK"}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
      throw new Error(`${secret} unhandled-original-data`);
    },
  };
}
test('live verifier defaults to read-only and preserves unknown fields in exact comparison', async () => {
  const source = snapshot(), api = fake(source, { leakError: true });
  const report = await verifyLiveApi({ origin: 'https://fixture.invalid', secret, source, fetcher: api.fetcher });
  assert.equal(report.passed, true); assert.equal(report.readOnly, true); assert.equal(report.original.unexposedWorldEnvelopeFields, 1);
  assert.ok(api.calls.filter(call => call.method === 'POST').every(call => call.path === '/api/auth'));
  const output = JSON.stringify(report); for (const privateValue of [secret, token, '絕不可列印的原始人物資料', '未知原件', 'exact-id', 'futureLegacy']) assert.ok(!output.includes(privateValue));
});
test('explicit writes use same values, increase revisions and prove stale conflict without deleting data', async () => {
  const source = snapshot(), api = fake(source);
  const report = await verifyLiveApi({ origin: 'https://fixture.invalid', secret, source, checkWrites: true, fetcher: api.fetcher });
  assert.equal(report.passed, true); assert.equal(report.readOnly, false);
  assert.deepEqual(report.writes.revisions, { userdataBefore: 7, worldBefore: 3, userdataAfter: 8, worldAfter: 4 });
  assert.equal(report.checks.userdataStaleRejected.status, 409); assert.equal(report.checks.worldStaleRejected.status, 409);
  const userPosts = api.calls.filter(call => call.path === '/api/userdata' && call.method === 'POST'); assert.equal(userPosts.length, 2);
  assert.deepEqual(userPosts[0].body, { revision: 7, scenes: source.documents.userdata.scenes });
  assert.ok(!JSON.stringify(report).includes('絕不可列印的原始人物資料'));
});
test('source mismatch skips all data writes and paid AI calls', async () => {
  const source = snapshot(), api = fake(source, { mismatch: true });
  const report = await verifyLiveApi({ origin: 'https://fixture.invalid', secret, source, checkWrites: true, checkAi: true, fetcher: api.fetcher });
  assert.equal(report.passed, false); assert.equal(report.writes.attempted, false); assert.equal(report.ai.requestsAttempted, 0);
  assert.ok(api.calls.filter(call => call.method === 'POST').every(call => call.path === '/api/auth'));
});
test('missing original world remains absent and does not receive any write', async () => {
  const source = snapshot(); source.documents.worldworkspaces = null; const api = fake(source);
  const report = await verifyLiveApi({ origin: 'https://fixture.invalid', secret, source, checkWrites: true, fetcher: api.fetcher });
  assert.equal(report.passed, true); assert.equal(report.checks.worldSameValueWrite.status, 'skipped_missing_document'); assert.equal(report.checks.worldSameValueWrite.documentCreated, false);
  assert.ok(!api.calls.some(call => call.path === '/api/world-workspace' && call.method === 'POST'));
  assert.equal(report.writes.revisions.worldBefore, 0); assert.equal(Object.hasOwn(report.writes.revisions, 'worldAfter'), false);
});
test('explicit AI performs exactly three tiny normal, JSON and SSE requests and reports hashes only', async () => {
  const source = snapshot(), api = fake(source);
  const report = await verifyLiveApi({ origin: 'https://fixture.invalid', secret, source, checkAi: true, fetcher: api.fetcher });
  assert.equal(report.passed, true); assert.equal(report.ai.requestsAttempted, 3);
  const calls = api.calls.filter(call => call.path.startsWith('/api/gemini')); assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.body.is_json), [false, true, false]); assert.ok(calls.every(call => call.body.contents[0].parts[0].text.length < 60));
  assert.equal(report.checks.aiSse.complete, true); assert.ok(!JSON.stringify(report).includes('"OK"'));
});
test('network/provider failures never copy raw errors or private inputs into reports', async () => {
  const report = await verifyLiveApi({ origin: 'https://fixture.invalid', secret, source: snapshot(), fetcher: async () => { throw new Error(`${secret} ${token} original-private-data`); } });
  assert.equal(report.passed, false); assert.ok(Object.values(report.checks).every(check => check.status === null)); assert.ok(!JSON.stringify(report).includes(secret)); assert.ok(!JSON.stringify(report).includes(token));
});
test('SSE verification requires model, visible text, DONE, and no error or trailing frames', () => {
  const complete = 'data: {"model":"test-model"}\n\ndata: {"text":"OK"}\n\ndata: [DONE]\n\n';
  assert.equal(verifySse(complete).passed, true);
  assert.equal(verifySse(complete.replace('data: [DONE]\n\n', '')).passed, false);
  assert.equal(verifySse(complete + 'data: {"text":"extra"}\n\n').passed, false);
  assert.equal(verifySse(complete.replace('data: [DONE]', 'data: {"error":"secret-sensitive-provider-error"}')).passed, false);
});
test('CLI requires private file references and enables writes/AI only by explicit flags', () => {
  const parsed = parseArguments(['--origin', 'https://fixture.invalid', '--secret-file', 'private-secrets.json', '--source', 'snapshot.json', '--output', 'report.json']);
  assert.equal(parsed.checkWrites, false); assert.equal(parsed.checkAi, false);
  assert.equal(parseArguments(['--origin', 'https://fixture.invalid', '--secret-file', 'x', '--source', 'y', '--output', 'z', '--check-writes', '--check-ai']).checkAi, true);
  assert.throws(() => parseArguments(['--secret', secret])); assert.throws(() => parseArguments(['--origin', 'https://fixture.invalid']));
});
