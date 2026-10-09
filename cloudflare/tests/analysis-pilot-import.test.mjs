import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_DEFAULTS } from '../src/contracts.mjs';
import { planPilot, runPilotImport, verifyPilotWrite, figureInputSha256, contentHash, validateBatch, parseArguments, validateOrigin, productionAdapter, PilotError } from '../scripts/analysis-pilot-import.mjs';

function fixture() {
  const base = [{ id: 'emperor-test', name: '測試帝王', type: 'emperor', rank: 'A', desc: '測試人物簡評' }];
  const source = { ...structuredClone(USER_DEFAULTS), revision: 11,
    customLegends: [{ id: 'general-test', name: '測試將軍', type: 'general', rank: 'A' }, { id: 'minister-test', name: '測試名臣', type: 'minister', rank: 'B' }],
    modifiedLegends: { 'general-test': { analysis: '保留原有一般分析', stats: [1, 2, 3, 4, 5], unknownLegacy: { retain: true } }, 'orphan-id': { deepAnalysis: '保留孤立分析', oldField: 9 } },
    soulSaves: [{ id: 'save-id', privateText: '私人魂穿原件' }], futureUserdata: { untouched: ['完整未知欄位'] },
  };
  const records = ['emperor-test', 'general-test', 'minister-test'].map((id, index) => ({ id, inputSha256: figureInputSha256(source, base, id), promptSha256: 'a'.repeat(64),
    deepAnalysis: `# 私人新分析${index}\n${'歷史事實、制度背景與評級推論，標示來源及不確定性。'.repeat(35)}\n【建議定案】\n評級：A\n稱號：試跑稱號\n標籤：試跑標籤\n簡評：僅為離線測試\n判詞：資料完整保留\n`,
    provenance: { provider: 'ChatGPT web', conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', generatedAt: '2026-10-09T00:00:00.000Z', checkedSources: [{ title: '測試史料', url: 'https://example.org/history', locator: '卷一' }] },
  }));
  return { base, source, batch: { format: 'dynasty-analysis-pilot-results', schemaVersion: 1, records } };
}
function api(source, { conflict = null, afterChange = null, unknownOutcome = false } = {}) {
  let state = structuredClone(source), posts = 0;
  const calls = [], backups = [];
  return {
    calls, backups,
    read: () => structuredClone(state),
    saveSnapshot: async (name, value) => { backups.push({ name, value: structuredClone(value) }); },
    request: async (method, body) => {
      calls.push({ method, body: body && structuredClone(body) });
      if (method === 'GET') return { status: 200, body: structuredClone(state) };
      posts++;
      if (posts === 1 && conflict) { conflict(state); state.revision++; return { status: 409, body: { secret: '禁止回傳錯誤原文' } }; }
      if (body.revision !== state.revision) return { status: 409, body: {} };
      state.modifiedLegends = structuredClone(body.modifiedLegends); state.revision++;
      if (unknownOutcome) throw new Error('TOKEN 私人原件伺服器錯誤');
      const revision = state.revision;
      if (afterChange) { afterChange(state); state.revision++; }
      return { status: 200, body: { status: 'ok', revision } };
    },
  };
}
const approved = fixture_ => planPilot(fixture_.source, fixture_.source, fixture_.base, fixture_.batch).report;
const assertCode = (callback, code) => assert.throws(callback, error => error instanceof PilotError && error.code === code);

test('dry-run reads without POST, does not print private prose and preserves all untouched fields', async () => {
  const f = fixture(), fake = api(f.source);
  const report = await runPilotImport({ ...f, request: fake.request });
  assert.equal(report.mode, 'dry-run'); assert.equal(report.passed, true); assert.equal(report.targetCount, 3);
  assert.deepEqual(fake.calls.map(call => call.method), ['GET']);
  for (const value of ['私人新分析', '私人魂穿原件', '保留原有一般分析', '測試史料', 'emperor-test', 'TOKEN', '完整未知欄位']) assert.ok(!JSON.stringify(report).includes(value));
  const plan = planPilot(f.source, f.source, f.base, f.batch);
  assert.deepEqual(Object.keys(plan.patch), ['revision', 'modifiedLegends']);
  assert.equal(plan.report.provenanceFieldsWritten, 0);
  assert.deepEqual(plan.after.modifiedLegends['orphan-id'], f.source.modifiedLegends['orphan-id']);
  assert.equal(plan.after.modifiedLegends['general-test'].analysis, f.source.modifiedLegends['general-test'].analysis);
  assert.deepEqual(plan.after.modifiedLegends['general-test'].stats, [1, 2, 3, 4, 5]);
  assert.ok(!JSON.stringify(plan.patch).includes('conversationUrl'));
});

test('apply writes exactly three deepAnalysis fields and proves complete unaffected document equality', async () => {
  const f = fixture(), fake = api(f.source);
  const report = await runPilotImport({ ...f, request: fake.request, apply: true, approvedReport: approved(f), saveSnapshot: fake.saveSnapshot });
  assert.equal(report.status, 'applied_verified'); assert.equal(report.writeSucceeded, true);
  assert.equal(report.verification.contentPreserved, true);
  assert.equal(report.verification.unaffectedBeforeSha256, report.verification.unaffectedAfterSha256);
  assert.equal(fake.read().revision, 12); assert.deepEqual(fake.calls.map(call => call.method), ['GET', 'POST', 'GET']);
  assert.deepEqual(fake.backups.map(item => item.name), ['before-attempt-1', 'after-write']);
  assert.equal(contentHash(fake.backups[0].value), contentHash(f.source));
});

test('CAS conflict re-reads, re-merges the full modified map and preserves concurrent unrelated progress', async () => {
  const f = fixture(), fake = api(f.source, { conflict: state => { state.modifiedLegends['new-unrelated'] = { title: '別的視窗新資料' }; state.soulSaves.push({ id: 'new-save' }); } });
  const report = await runPilotImport({ ...f, request: fake.request, apply: true, approvedReport: approved(f), saveSnapshot: fake.saveSnapshot });
  assert.equal(report.passed, true); assert.equal(report.conflicts, 1);
  assert.deepEqual(fake.calls.map(call => call.method), ['GET', 'POST', 'GET', 'POST', 'GET']);
  assert.equal(fake.read().modifiedLegends['new-unrelated'].title, '別的視窗新資料');
  assert.equal(fake.read().soulSaves.length, 2);
  assert.deepEqual(fake.backups.map(item => item.name), ['before-attempt-1', 'before-attempt-2', 'after-write']);
});

test('a concurrent new analysis stops a conflicting retry without overwriting it', async () => {
  const f = fixture(), fake = api(f.source, { conflict: state => { state.modifiedLegends['emperor-test'] = { deepAnalysis: '剛新增的既有分析' }; } });
  await assert.rejects(runPilotImport({ ...f, request: fake.request, apply: true, approvedReport: approved(f), saveSnapshot: fake.saveSnapshot }), error => error.code === 'existing_analysis');
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(fake.read().modifiedLegends['emperor-test'].deepAnalysis, '剛新增的既有分析');
});

test('a concurrent target biography change stops the retry even if its analysis is still blank', async () => {
  const f = fixture(), fake = api(f.source, { conflict: state => { state.modifiedLegends['emperor-test'] = { rank: 'S' }; } });
  await assert.rejects(runPilotImport({ ...f, request: fake.request, apply: true, approvedReport: approved(f), saveSnapshot: fake.saveSnapshot }), error => error.code === 'live_input_changed');
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
});

test('existing source analysis, incorrect input hashes and duplicate or unknown targets fail before requests', async () => {
  for (const mutate of [
    f => { f.source.modifiedLegends['emperor-test'] = { deepAnalysis: '既有分析' }; },
    f => { f.batch.records[0].inputSha256 = 'b'.repeat(64); },
    f => { f.source.customLegends.push({ ...f.base[0] }); },
    f => { f.batch.records[0].id = 'missing-id'; },
  ]) {
    const f = fixture(); mutate(f); let calls = 0;
    await assert.rejects(runPilotImport({ ...f, request: async () => { calls++; } })); assert.equal(calls, 0);
  }
});

test('approval is bound to source, base and exact generated batch including local provenance', async () => {
  for (const mutate of [
    f => { f.batch.records[0].deepAnalysis += '\n更改生成結果'; },
    f => { f.batch.records[0].provenance.checkedSources[0].locator = '卷二'; },
    f => { f.source.soulSaves.push({ id: 'changed-source' }); },
    f => { f.base.push({ id: 'new-base', name: '新內建人物' }); },
  ]) {
    const f = fixture(), approval = approved(f); mutate(f); let calls = 0;
    await assert.rejects(runPilotImport({ ...f, request: async () => { calls++; }, apply: true, approvedReport: approval }), error => error.code === 'dry_run_approval_required');
    assert.equal(calls, 0);
  }
});

test('pre-write backup failure prevents POST; post-write backup failure reports the completed write', async () => {
  const f = fixture(), fake = api(f.source);
  await assert.rejects(runPilotImport({ ...f, request: fake.request, apply: true, approvedReport: approved(f), saveSnapshot: async () => { throw new Error('私人磁碟錯誤'); } }), error => error.code === 'pre_write_backup_failed' && error.report.writeSucceeded === false);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 0);
  const second = api(f.source);
  await assert.rejects(runPilotImport({ ...f, request: second.request, apply: true, approvedReport: approved(f), saveSnapshot: async name => { if (name === 'after-write') throw new Error('私人磁碟錯誤'); } }), error => error.code === 'post_write_backup_failed' && error.report.writeSucceeded === true);
  assert.equal(second.calls.filter(call => call.method === 'POST').length, 1);
});

test('unknown POST outcome never automatically retries or reports a certain failure', async () => {
  const f = fixture(), fake = api(f.source, { unknownOutcome: true });
  await assert.rejects(runPilotImport({ ...f, request: fake.request, apply: true, approvedReport: approved(f), saveSnapshot: fake.saveSnapshot }), error => {
    assert.equal(error.code, 'write_outcome_unknown'); assert.equal(error.report.writeSucceeded, null);
    assert.ok(!JSON.stringify(error.report).includes('TOKEN')); return true;
  });
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
});

test('post-write concurrent progress is detected without trying to undo player data', async () => {
  const f = fixture(), fake = api(f.source, { afterChange: state => { state.soulSaves.push({ id: 'new-save-after-write' }); } });
  const report = await runPilotImport({ ...f, request: fake.request, apply: true, approvedReport: approved(f), saveSnapshot: fake.saveSnapshot });
  assert.equal(report.passed, false); assert.equal(report.writeSucceeded, true);
  assert.equal(report.verification.targetsMatch, true); assert.equal(report.verification.contentPreserved, false);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(fake.read().soulSaves.length, 2);
});

test('complete readback comparison detects changes to any field or unknown nested data', () => {
  const f = fixture(), plan = planPilot(f.source, f.source, f.base, f.batch);
  assert.equal(verifyPilotWrite(plan, plan.after, f.batch).passed, true);
  for (const mutate of [after => { after.futureUserdata.untouched.push('changed'); }, after => { delete after.modifiedLegends['general-test'].stats; }, after => { delete after.modifiedLegends['orphan-id']; }]) {
    const after = structuredClone(plan.after); mutate(after);
    assert.equal(verifyPilotWrite(plan, after, f.batch).contentPreserved, false);
  }
});

test('32 MiB full-document and request limits are checked before a write', () => {
  const f = fixture(); f.source.futureUserdata.large = 'x'.repeat(32 * 1024 * 1024);
  assertCode(() => planPilot(f.source, f.source, f.base, f.batch), 'userdata_size_limit');
});

test('incomplete prose, fewer than three results, unsafe IDs and ungrounded provenance are rejected', () => {
  for (const mutate of [
    batch => { batch.records.pop(); }, batch => { batch.records[0].id = '__proto__'; },
    batch => { batch.records[0].deepAnalysis = batch.records[0].deepAnalysis.replace('判詞：資料完整保留', ''); },
    batch => { batch.records[0].provenance.checkedSources = []; },
    batch => { batch.records[0].provenance.conversationUrl = 'https://evil.invalid/c/private'; },
  ]) { const { batch } = fixture(); mutate(batch); assert.throws(() => validateBatch(batch)); }
});

test('CLI requires explicit apply, approval, unique backup directory and exactly one file-based credential', () => {
  const args = ['--origin', 'https://dynasty.piamamba.com', '--source', 'source.json', '--results', 'results.json', '--output', 'report.json', '--secret-file', 'credentials.json'];
  assert.equal(parseArguments(args).apply, false);
  assert.equal(parseArguments([...args, '--apply', '--approved-report', 'dry.json', '--backup-dir', 'new-private-backup']).apply, true);
  assert.throws(() => parseArguments([...args, '--apply']));
  assert.throws(() => parseArguments([...args, '--token-file', 'token.json']));
  assert.throws(() => parseArguments([...args, '--secret', 'never-command-line']));
  assert.equal(validateOrigin('https://dynasty.piamamba.com'), 'https://dynasty.piamamba.com');
  assert.equal(validateOrigin('http://127.0.0.1:8878'), 'http://127.0.0.1:8878');
  for (const origin of ['https://evil.invalid', 'https://dynasty.piamamba.com/api/userdata', 'https://secret@dynasty.piamamba.com', 'http://dynasty.piamamba.com']) assert.throws(() => validateOrigin(origin));
});

test('an old revision1 baseline permits newer live progress while applying against the live revision', async () => {
  const f = fixture(); f.source.revision = 1;
  const latest = structuredClone(f.source); latest.revision = 28;
  latest.soulSaves.push({ id: 'latest-save' }); latest.modifiedLegends['other-figure'] = { analysis: '新的非目標分析' };
  latest.futureUserdata.fromOtherWindow = true;
  const fake = api(latest);
  const report = await runPilotImport({ ...f, request: fake.request, apply: true, approvedReport: approved(f), saveSnapshot: fake.saveSnapshot });
  assert.equal(report.passed, true); assert.equal(report.beforeRevision, 28); assert.equal(report.verification.afterRevision, 29);
  assert.equal(fake.calls.find(call => call.method === 'POST').body.revision, 28);
  assert.equal(fake.read().soulSaves.length, 2); assert.equal(fake.read().futureUserdata.fromOtherWindow, true);
  assert.equal(fake.read().modifiedLegends['other-figure'].analysis, '新的非目標分析');
});

test('apply requires an explicit backup implementation even when called without the CLI', async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(runPilotImport({ ...f, request: async () => { calls++; }, apply: true, approvedReport: approved(f) }), error => error.code === 'backup_required');
  assert.equal(calls, 0);
});

test('a blank final-section value cannot consume the next line as its missing content', () => {
  const { batch } = fixture(); batch.records[0].deepAnalysis = batch.records[0].deepAnalysis.replace('評級：A', '評級：   ');
  assertCode(() => validateBatch(batch), 'incomplete_analysis');
});

test('503 and invalid acknowledgements preserve unknown write outcome without automatic retry', async () => {
  for (const reply of [{ status: 503, body: { detail: 'synthetic-token-private-error' } }, { status: 200, body: { status: 'ok', revision: 999 } }]) {
    const f = fixture(); let posts = 0;
    const request = async method => method === 'GET' ? { status: 200, body: f.source } : (posts++, reply);
    await assert.rejects(runPilotImport({ ...f, request, apply: true, approvedReport: approved(f), saveSnapshot: async () => {} }), error => {
      assert.equal(error.report.writeSucceeded, null); assert.ok(!JSON.stringify(error.report).includes('synthetic-token-private-error')); return true;
    });
    assert.equal(posts, 1);
  }
});

test('bounded conflict retries stop after four CAS attempts and confirm that the rejected writes did not succeed', async () => {
  const f = fixture(); let revision = f.source.revision, posts = 0;
  const request = async method => method === 'GET' ? { status: 200, body: { ...f.source, revision } } : (posts++, revision++, { status: 409, body: {} });
  await assert.rejects(runPilotImport({ ...f, request, apply: true, approvedReport: approved(f), saveSnapshot: async () => {} }), error => error.code === 'conflict_retry_limit' && error.report.conflicts === 3 && error.report.writeSucceeded === false);
  assert.equal(posts, 4);
});

test('secret-file credentials authenticate once; only the returned token is sent to userdata requests', async () => {
  const password = 'synthetic-only-secret', token = 'synthetic-only-token', calls = [];
  const fetcher = async (url, options) => {
    calls.push({ path: new URL(url).pathname, ...options });
    if (new URL(url).pathname === '/api/auth') return Response.json({ token });
    return Response.json({ status: 'synthetic-response' });
  };
  const request = await productionAdapter('https://dynasty.piamamba.com', { APP_SECRET: password }, fetcher);
  await request('GET'); await request('POST', { revision: 1, modifiedLegends: {} });
  assert.deepEqual(calls.map(call => [call.path, call.method]), [['/api/auth', 'POST'], ['/api/userdata', 'GET'], ['/api/userdata', 'POST']]);
  assert.deepEqual(JSON.parse(calls[0].body), { password }); assert.equal(calls[0].headers['x-app-token'], undefined);
  assert.ok(calls.slice(1).every(call => call.headers['x-app-token'] === token && !JSON.stringify(call).includes(password)));
  assert.ok(calls.every(call => call.redirect === 'error'));
});

test('token-file credentials skip auth and access only userdata without extra credential requests', async () => {
  const token = 'synthetic-only-token', calls = [];
  const request = await productionAdapter('https://dynasty.piamamba.com', { token }, async (url, options) => {
    calls.push({ url, options }); return Response.json({ status: 'synthetic-response' });
  });
  assert.equal(calls.length, 0);
  await request('GET'); assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/api/userdata'); assert.equal(calls[0].options.headers['x-app-token'], token);
});

test('invalid credential inputs and untrusted origins fail without sending any request', async () => {
  let calls = 0; const fetcher = async () => { calls++; };
  for (const credentials of [null, {}, { APP_SECRET: '' }, { token: false }, { APP_SECRET: 'synthetic', token: 'synthetic' }]) await assert.rejects(productionAdapter('https://dynasty.piamamba.com', credentials, fetcher), error => error.code === 'invalid_credentials');
  await assert.rejects(productionAdapter('https://evil.invalid', { APP_SECRET: 'synthetic' }, fetcher), error => error.code === 'invalid_origin');
  assert.equal(calls, 0);
});

test('authentication errors retain a fixed error code and do not expose provider responses or credentials', async () => {
  const password = 'synthetic-only-secret';
  for (const fetcher of [async () => Response.json({ detail: password }, { status: 401 }), async () => { throw new Error(password); }]) {
    await assert.rejects(productionAdapter('https://dynasty.piamamba.com', { APP_SECRET: password }, fetcher), error => error.code === 'authentication_failed' && !String(error).includes(password));
  }
});
