import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_DEFAULTS } from '../src/contracts.mjs';
import { contentHash } from '../scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_LAYERS, layerInputSha256, validateLayerBatch, planLayerImport, verifyLayerWrite, runLayerImport } from '../scripts/analysis-pilot-layers-import.mjs';

const ids = Object.keys(AUTHORIZED_LAYERS), [emperor, general, minister] = ids;
function fixture() {
  const base = ids.map((id, index) => ({ id, name: `公開測試人物${index}`, rank: 'A', desc: '此為離線測試資料' }));
  const source = { ...structuredClone(USER_DEFAULTS), revision: 2, futureLegacy: { untouched: true }, soulSaves: [{ id: 'original-save', text: '私人存檔原件' }] };
  for (const id of ids) source.modifiedLegends[id] = { deepAnalysis: `原有深度分析 ${id}`, stats: [1, 2, 3, 4, 5], unknownNested: { retain: true } };
  source.modifiedLegends[general].analysis = '王翦既有赏析必須完整保留';
  source.modifiedLegends['orphan'] = { deepAnalysis: '孤立分析亦須保留' };
  const records = ids.map(id => ({ id, inputSha256: layerInputSha256(source, base, id), promptSha256: 'a'.repeat(64),
    fields: Object.fromEntries(AUTHORIZED_LAYERS[id].map(field => [field, `${'純合成測試內容，不包含真實人物分析。'.repeat(30)}\n${field}`])),
    provenance: { provider: 'ChatGPT web', conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', generatedAt: '2026-10-09T00:00:00.000Z', checkedSources: [{ title: '測試來源', url: 'https://example.org/history', locator: '測試定位' }] },
  }));
  return { base, source, batch: { format: 'dynasty-analysis-pilot-layer-results', schemaVersion: 1, records } };
}
function fakeApi(source, { conflict = null, afterWrite = null, failPost = null } = {}) {
  let state = structuredClone(source), posts = 0;
  const calls = [], backups = [];
  return { calls, backups, read: () => structuredClone(state),
    saveSnapshot: async (name, value) => { backups.push({ name, value: structuredClone(value) }); },
    request: async (method, body) => {
      calls.push({ method, body: body && structuredClone(body) });
      if (method === 'GET') return { status: 200, body: structuredClone(state) };
      posts++;
      if (posts === 1 && conflict) { conflict(state); state.revision++; return { status: 409, body: {} }; }
      if (failPost) return failPost();
      state.modifiedLegends = structuredClone(body.modifiedLegends); state.revision++;
      const revision = state.revision;
      if (afterWrite) { afterWrite(state); state.revision++; }
      return { status: 200, body: { status: 'ok', revision } };
    },
  };
}
const approval = f => planLayerImport(f.source, f.source, f.base, f.batch).report;

test('layer dry-run allows exactly five missing fields and preserves all existing deep analysis and Wang Jian analysis', async () => {
  const f = fixture(), fake = fakeApi(f.source), plan = planLayerImport(f.source, f.source, f.base, f.batch);
  assert.equal(plan.report.changedFields, 5); assert.equal(plan.report.provenanceFieldsWritten, 0);
  assert.deepEqual(Object.keys(plan.patch), ['revision', 'modifiedLegends']);
  assert.deepEqual(plan.after.modifiedLegends[general].analysis, f.source.modifiedLegends[general].analysis);
  for (const id of ids) {
    assert.equal(plan.after.modifiedLegends[id].deepAnalysis, f.source.modifiedLegends[id].deepAnalysis);
    assert.deepEqual(plan.after.modifiedLegends[id].stats, f.source.modifiedLegends[id].stats);
  }
  const report = await runLayerImport({ ...f, request: fake.request });
  assert.equal(report.passed, true); assert.equal(report.mode, 'dry-run'); assert.deepEqual(fake.calls.map(call => call.method), ['GET']);
  for (const prose of ['純合成測試內容', '私人存檔原件', '原有深度分析', '王翦既有赏析', '測試來源', general]) assert.ok(!JSON.stringify(report).includes(prose));
  assert.ok(!JSON.stringify(plan.patch).includes('conversationUrl'));
});

test('successful layer apply saves complete before/after snapshots and verifies every untouched document field', async () => {
  const f = fixture(), fake = fakeApi(f.source);
  const report = await runLayerImport({ ...f, request: fake.request, apply: true, approvedReport: approval(f), saveSnapshot: fake.saveSnapshot });
  assert.equal(report.status, 'applied_verified'); assert.equal(report.writeSucceeded, true); assert.equal(report.changedFields, 5);
  assert.equal(report.verification.unaffectedBeforeSha256, report.verification.unaffectedAfterSha256);
  assert.deepEqual(fake.backups.map(item => item.name), ['before-attempt-1', 'after-write']);
  assert.equal(contentHash(fake.backups[0].value), contentHash(f.source)); assert.equal(fake.read().revision, 3);
  assert.equal(fake.read().modifiedLegends[general].analysis, f.source.modifiedLegends[general].analysis);
});

test('CAS retry uses latest whole map, revision and unrelated player progress', async () => {
  const f = fixture(), fake = fakeApi(f.source, { conflict: state => { state.modifiedLegends['other'] = { future: 'new' }; state.soulSaves.push({ id: 'new-save' }); } });
  const report = await runLayerImport({ ...f, request: fake.request, apply: true, approvedReport: approval(f), saveSnapshot: fake.saveSnapshot });
  assert.equal(report.passed, true); assert.equal(report.conflicts, 1); assert.equal(report.beforeRevision, 3);
  assert.equal(fake.read().modifiedLegends['other'].future, 'new'); assert.equal(fake.read().soulSaves.length, 2);
  assert.deepEqual(fake.calls.map(call => call.method), ['GET', 'POST', 'GET', 'POST', 'GET']);
});

test('any changed current deep analysis stops a retry before another write', async () => {
  const f = fixture(), fake = fakeApi(f.source, { conflict: state => { state.modifiedLegends[emperor].deepAnalysis += '另一視窗更新'; } });
  await assert.rejects(runLayerImport({ ...f, request: fake.request, apply: true, approvedReport: approval(f), saveSnapshot: fake.saveSnapshot }), error => error.code === 'live_input_changed');
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
});

test('a newly filled target layer stops the retry instead of overwriting it', async () => {
  const f = fixture(), fake = fakeApi(f.source, { conflict: state => { state.modifiedLegends[minister].soulEssence = '其他視窗剛補齊的內核'; } });
  await assert.rejects(runLayerImport({ ...f, request: fake.request, apply: true, approvedReport: approval(f), saveSnapshot: fake.saveSnapshot }), error => error.code === 'existing_layer');
  assert.equal(fake.read().modifiedLegends[minister].soulEssence, '其他視窗剛補齊的內核');
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
});

test('rank, stats, deepAnalysis, Wang Jian normal analysis and other IDs are never allowed targets', async () => {
  for (const mutate of [
    f => { f.batch.records[0].fields.rank = 'S'; }, f => { f.batch.records[0].fields.stats = [9, 9, 9, 9, 9]; },
    f => { f.batch.records[0].fields.deepAnalysis = 'overwrite'; }, f => { f.batch.records[1].fields.analysis = 'overwrite'; },
    f => { f.batch.records[0].id = 'other-id'; },
  ]) {
    const f = fixture(); mutate(f); let calls = 0;
    await assert.rejects(runLayerImport({ ...f, request: async () => { calls++; } })); assert.equal(calls, 0);
  }
});

test('phase2 requires existing deep analysis and full input hash including every prior layer', () => {
  const f = fixture(), originalHash = f.batch.records[0].inputSha256;
  f.source.modifiedLegends[emperor].deepAnalysis += '改變';
  assert.notEqual(layerInputSha256(f.source, f.base, emperor), originalHash);
  assert.throws(() => planLayerImport(f.source, f.source, f.base, f.batch), error => error.code === 'source_input_hash_mismatch');
  delete f.source.modifiedLegends[emperor].deepAnalysis;
  assert.throws(() => layerInputSha256(f.source, f.base, emperor), error => error.code === 'deep_analysis_required');
});

test('baseline existing content is preserved and batches must exactly match its remaining missing layers', () => {
  const f = fixture(); f.source.modifiedLegends[emperor].analysis = '先前已完成的賞析';
  f.batch.records[0].inputSha256 = layerInputSha256(f.source, f.base, emperor);
  assert.throws(() => planLayerImport(f.source, f.source, f.base, f.batch), error => error.code === 'batch_must_match_missing_layers');
  delete f.batch.records[0].fields.analysis;
  const plan = planLayerImport(f.source, f.source, f.base, f.batch);
  assert.equal(plan.report.changedFields, 4); assert.equal(plan.after.modifiedLegends[emperor].analysis, '先前已完成的賞析');
  assert.equal(verifyLayerWrite(plan, plan.after, f.batch).passed, true);
});

test('new layer dry-run approval is bound to batch/source and refuses the deep phase report', async () => {
  const f = fixture(), approved = approval(f); let calls = 0;
  f.batch.records[0].fields.analysis += '新更動';
  await assert.rejects(runLayerImport({ ...f, request: async () => { calls++; }, apply: true, approvedReport: approved }), error => error.code === 'dry_run_approval_required');
  const second = fixture(); const wrongFormat = { ...approval(second), format: 'dynasty-analysis-pilot-import' };
  await assert.rejects(runLayerImport({ ...second, request: async () => { calls++; }, apply: true, approvedReport: wrongFormat }), error => error.code === 'dry_run_approval_required');
  assert.equal(calls, 0);
});

test('mandatory backup succeeds before writes, or any backup failure prevents the CAS', async () => {
  const f = fixture(), fake = fakeApi(f.source);
  await assert.rejects(runLayerImport({ ...f, request: fake.request, apply: true, approvedReport: approval(f) }), error => error.code === 'backup_required');
  await assert.rejects(runLayerImport({ ...f, request: fake.request, apply: true, approvedReport: approval(f), saveSnapshot: async () => { throw new Error('synthetic-private-disk-error'); } }), error => error.code === 'pre_write_backup_failed' && error.report.writeSucceeded === false);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 0);
});

test('network and 503 unknown write outcomes are not automatically retried and do not leak raw errors', async () => {
  for (const failPost of [() => { throw new Error('synthetic-private-token'); }, () => ({ status: 503, body: { detail: 'synthetic-private-token' } })]) {
    const f = fixture(), fake = fakeApi(f.source, { failPost });
    await assert.rejects(runLayerImport({ ...f, request: fake.request, apply: true, approvedReport: approval(f), saveSnapshot: fake.saveSnapshot }), error => error.report.writeSucceeded === null && !JSON.stringify(error.report).includes('synthetic-private-token'));
    assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('post-write concurrent progress and accidental deep/stat changes are detected without rollback', async () => {
  const f = fixture(), plan = planLayerImport(f.source, f.source, f.base, f.batch);
  for (const mutate of [after => { after.modifiedLegends[general].analysis = 'changed'; }, after => { after.modifiedLegends[emperor].deepAnalysis += 'changed'; }, after => { after.modifiedLegends[minister].stats[0] = 99; }, after => { after.futureLegacy.untouched = false; }]) {
    const after = structuredClone(plan.after); mutate(after); assert.equal(verifyLayerWrite(plan, after, f.batch).contentPreserved, false);
  }
  const fake = fakeApi(f.source, { afterWrite: state => { state.soulSaves.push({ id: 'new-live-save' }); } });
  const report = await runLayerImport({ ...f, request: fake.request, apply: true, approvedReport: approval(f), saveSnapshot: fake.saveSnapshot });
  assert.equal(report.passed, false); assert.equal(report.writeSucceeded, true); assert.equal(report.verification.targetsMatch, true);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1); assert.equal(fake.read().soulSaves.length, 2);
});

test('size cap, incomplete prose, missing provenance and duplicate targets fail locally', () => {
  const f = fixture(); f.source.futureLegacy.large = 'x'.repeat(32 * 1024 * 1024);
  assert.throws(() => planLayerImport(f.source, f.source, f.base, f.batch), error => error.code === 'userdata_size_limit');
  for (const mutate of [batch => { batch.records[0].fields.analysis = 'truncated'; }, batch => { batch.records[0].provenance.checkedSources = []; }, batch => { batch.records[0].id = batch.records[1].id; }]) {
    const { batch } = fixture(); mutate(batch); assert.throws(() => validateLayerBatch(batch));
  }
});
