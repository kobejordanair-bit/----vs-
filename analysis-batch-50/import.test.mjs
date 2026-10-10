import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { USER_DEFAULTS, saveUserdata, loadUserdata } from '../cloudflare/src/contracts.mjs';
import { contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_IDS, COMPLETION_FIELDS, FIXED_MANIFEST_SHA256, loadFixedManifest, validateManifest, validateChunk, figureInput, planBatch50Import, verifyBatch50Write, runBatch50Import, parseArguments } from './import.mjs';

// Public context and already-published deep analyses bind the real allowlist.
// Every new completion and all histories below are deliberately synthetic.
const fixed = await loadFixedManifest();
const publicDeep = Object.fromEntries(await Promise.all(fixed.records.map(async item => [item.id, await readFile(new URL('../' + item.preserved.deepAnalysis.path, import.meta.url), 'utf8')])));
function fixture(count = 1) {
  const manifest = structuredClone(fixed);
  const base = [...manifest.records.map(item => structuredClone(item.context)), ...Array.from({ length: 912 }, (_, at) => ({ id: `synthetic_filler_${at}`, name: `合成人物${at}`, type: 'general' }))];
  const source = { ...structuredClone(USER_DEFAULTS), revision: 4, futureLegacy: { kept: true }, soulSaves: [{ id: 'synthetic-save', text: '合成存檔' }], scenes: [{ id: 'synthetic-scene' }], chatHistories: { synthetic: [{ text: '合成聊天' }] } };
  for (const item of manifest.records) source.modifiedLegends[item.id] = { deepAnalysis: publicDeep[item.id] };
  source.modifiedLegends.orphan = { unknownNested: { kept: true } };
  manifest.sourceSha256 = contentHash(source); manifest.baseLibrarySha256 = contentHash(base);
  const analysis = ['歷史局勢與定位', '深度功過剖析', '人性與性格側寫', '如果生在現代'].map(label => `## 【${label}】\n${'完全合成測試段落，不描述任何真實歷史人物。'.repeat(35)}\n[合成來源](https://example.org/source)`).join('\n\n');
  const soul = ['說話邏輯', '壓力反應', '核心驅動', '慣性盲點', '情感結構', '參照系', '內在裂縫'].map(label => `## 【${label}】\n${'完全合成测试內核，不描述任何真實歷史人物。[史載][推斷][詮釋]'.repeat(12)}\n[合成來源](https://example.org/source)`).join('\n\n');
  const stats = [11, 22, 33, 44, 55];
  const reasons = ['統率', '武力', '智謀', '政治', '魅力'].map((label, at) => `### ${label}：${stats[at]}\n${'完全合成理由，不描述任何真實歷史人物。'.repeat(6)} [合成來源](https://example.org/source)`).join('\n\n');
  const batch = { format: 'dynasty-analysis-batch50-results', schemaVersion: 1, manifestSha256: contentHash(manifest), records: manifest.records.slice(0, count).map(item => ({
    id: item.id, inputSha256: item.inputSha256, promptSha256: 'a'.repeat(64), fields: { analysis, soulEssence: soul, stats: [...stats], statsAnalysis: reasons },
    provenance: { provider: 'ChatGPT web', webSearchPerformed: true, conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', generatedAt: '2026-10-10T00:00:00.000Z', checkedSources: [{ title: '合成來源', url: 'https://example.org/source', locator: '合成段落' }] },
  })) };
  return { source, base, batch, manifest };
}
function fakeApi(source, { conflict = null, alwaysConflict = false, afterWrite = null, failPost = null } = {}) {
  let state = structuredClone(source), posts = 0;
  const calls = [], backups = [];
  return { calls, backups, read: () => structuredClone(state),
    saveSnapshot: async (name, value) => { backups.push({ name, value: structuredClone(value) }); },
    request: async (method, body) => {
      calls.push({ method, body: body && structuredClone(body) });
      if (method === 'GET') return { status: 200, body: structuredClone(state) };
      posts++;
      if (alwaysConflict || (posts === 1 && conflict)) { conflict?.(state); state.revision++; return { status: 409, body: {} }; }
      if (failPost) return failPost();
      state.modifiedLegends = structuredClone(body.modifiedLegends); state.revision++;
      const revision = state.revision; afterWrite?.(state);
      return { status: 200, body: { status: 'ok', revision } };
    },
  };
}
const approval = f => planBatch50Import(f.source, f.source, f.base, f.batch, f.manifest).report;
const apply = (f, api, extra = {}) => runBatch50Import({ ...f, request: api.request, apply: true, approvedReport: approval(f), saveSnapshot: api.saveSnapshot, validateEvidence: async () => true, ...extra });

test('sealed manifest fixes exactly 50 original IDs, 15/20/15 types and four missing fields', () => {
  assert.equal(contentHash(fixed), FIXED_MANIFEST_SHA256); assert.equal(AUTHORIZED_IDS.length, 50); assert.equal(new Set(AUTHORIZED_IDS).size, 50);
  assert.equal(validateManifest(fixed), fixed);
  for (const mutation of [m => { m.records[0].id = 'outside'; }, m => { m.records[0].inputSha256 = 'b'.repeat(64); }, m => { m.records[0].missingFields.push('rank'); }, m => { m.records.pop(); }, m => { m.policy.onlyMissingFields = false; }]) {
    const manifest = structuredClone(fixed); mutation(manifest); assert.throws(() => validateManifest(manifest), error => error.code === 'invalid_fixed_manifest');
  }
});

test('one to five complete persons plan only four fields each, preserving every existing field and report privacy', async () => {
  for (const count of [1, 5]) {
    const f = fixture(count), api = fakeApi(f.source), plan = planBatch50Import(f.source, f.source, f.base, f.batch, f.manifest);
    assert.equal(plan.report.targetCount, count); assert.equal(plan.report.changedFields, count * 4); assert.equal(plan.report.authorizedTargetCount, 50); assert.equal(plan.report.provenanceFieldsWritten, 0);
    assert.deepEqual(Object.keys(plan.patch), ['revision', 'modifiedLegends']);
    for (const item of f.manifest.records) assert.equal(plan.after.modifiedLegends[item.id].deepAnalysis, publicDeep[item.id]);
    assert.equal(verifyBatch50Write(plan, plan.after, f.batch).passed, true);
    const report = await runBatch50Import({ ...f, request: api.request });
    assert.equal(report.passed, true); assert.deepEqual(api.calls.map(item => item.method), ['GET']); assert.equal(api.backups.length, 0);
    assert.ok(!JSON.stringify(report).includes('完全合成')); assert.ok(!JSON.stringify(report).includes('合成存檔')); assert.ok(!JSON.stringify(plan.patch).includes('conversationUrl'));
  }
});

test('empty, oversized, duplicate, foreign and incomplete chunks are rejected before networking', async () => {
  for (const mutation of [f => { f.batch.records = []; }, f => { f.batch.records = Array.from({ length: 6 }, () => structuredClone(f.batch.records[0])); }, f => { f.batch.records.push(structuredClone(f.batch.records[0])); }, f => { f.batch.records[0].id = 'outside'; }, f => { delete f.batch.records[0].fields.statsAnalysis; }, f => { f.batch.records[0].fields.rank = 'S+'; }, f => { f.batch.records[0].fields.deepAnalysis = 'overwrite'; }, f => { f.batch.manifestSha256 = 'b'.repeat(64); }]) {
    const f = fixture(); mutation(f); let calls = 0;
    await assert.rejects(runBatch50Import({ ...f, request: async () => { calls++; } })); assert.equal(calls, 0);
  }
});

test('all 50 original inputs, full source hash and 962 library identity are checked before any read', async () => {
  for (const mutation of [f => { f.source.futureLegacy.kept = false; }, f => { f.source.modifiedLegends[f.manifest.records[49].id].deepAnalysis += 'changed'; }, f => { f.base[900].name += 'changed'; }, f => { f.base.pop(); }, f => { f.source.customLegends.push({ id: f.base[0].id }); }]) {
    const f = fixture(); mutation(f); let calls = 0;
    await assert.rejects(runBatch50Import({ ...f, request: async () => { calls++; } })); assert.equal(calls, 0);
  }
  const f = fixture(); assert.equal(contentHash(figureInput(f.source, f.base, f.batch.records[0].id)), f.batch.records[0].inputSha256);
});

test('apply saves full before and after snapshots and compatible contracts retain unknown document fields', async () => {
  const f = fixture(2), api = fakeApi(f.source), report = await apply(f, api);
  assert.equal(report.status, 'applied_verified'); assert.equal(report.writeSucceeded, true); assert.equal(report.verification.contentPreserved, true);
  assert.equal(report.verification.unaffectedBeforeSha256, report.verification.unaffectedAfterSha256);
  assert.deepEqual(api.backups.map(item => item.name), ['before-attempt-1', 'after-write']); assert.equal(contentHash(api.backups[0].value), contentHash(f.source));
  let raw = { ...structuredClone(f.source), _id: 'synthetic-raw-envelope' };
  const store = { async read() { return { document: structuredClone(raw), version: 'synthetic-version' }; }, async compareAndSwap(id, observed, next) { raw = structuredClone(next); return true; } };
  const plan = planBatch50Import(f.source, f.source, f.base, f.batch, f.manifest);
  await saveUserdata(store, plan.patch); const observed = await loadUserdata(store);
  assert.equal(raw._id, 'synthetic-raw-envelope'); assert.deepEqual(raw.futureLegacy, f.source.futureLegacy); assert.equal(verifyBatch50Write(plan, observed, f.batch).passed, true);
});

test('CAS retry merges unrelated player progress and previously completed people without losing it', async () => {
  const f = fixture(), nextId = f.manifest.records[1].id;
  const api = fakeApi(f.source, { conflict: value => {
    value.soulSaves.push({ id: 'synthetic-new-save' }); value.futureLegacy.concurrent = true;
    value.modifiedLegends.orphan.unknownNested.concurrent = true;
    value.modifiedLegends[nextId].analysis = '另一完整person的原件';
  } });
  const report = await apply(f, api);
  assert.equal(report.passed, true); assert.equal(report.conflicts, 1); assert.equal(report.beforeRevision, 5);
  assert.equal(api.read().modifiedLegends[nextId].analysis, '另一完整person的原件'); assert.equal(api.read().soulSaves.length, 2); assert.equal(api.read().futureLegacy.concurrent, true);
  assert.deepEqual(api.calls.map(item => item.method), ['GET', 'POST', 'GET', 'POST', 'GET']);
  const repeated = fakeApi(f.source, { alwaysConflict: true });
  await assert.rejects(apply(f, repeated), error => error.code === 'conflict_retry_limit' && error.report.writeSucceeded === false);
  assert.equal(repeated.calls.filter(item => item.method === 'POST').length, 4);
});

test('a changed live target or newly populated field stops a retry instead of overwriting it', async () => {
  for (const mutation of [(value, id) => { value.modifiedLegends[id].deepAnalysis += 'changed'; }, (value, id) => { value.modifiedLegends[id].stats = [1, 2, 3, 4, 5]; }, (value, id) => { value.modifiedLegends[id].analysis = '另一視窗剛補的原件'; }, (value, id) => { value.modifiedLegends[id].rank = 'D'; }]) {
    const f = fixture(), id = f.batch.records[0].id, api = fakeApi(f.source, { conflict: value => mutation(value, id) });
    await assert.rejects(apply(f, api), error => ['live_input_changed', 'existing_live_field'].includes(error.code));
    assert.equal(api.calls.filter(item => item.method === 'POST').length, 1);
  }
});

test('approval binds source, base, manifest and chunk and backup failure prevents every write', async () => {
  const f = fixture(), api = fakeApi(f.source);
  for (const approvedReport of [null, { ...approval(f), format: 'dynasty-analysis-pilot-stats-import' }, { ...approval(f), manifestSha256: 'b'.repeat(64) }, { ...approval(f), batchSha256: 'b'.repeat(64) }]) {
    await assert.rejects(apply(f, api, { approvedReport }), error => error.code === 'dry_run_approval_required');
  }
  assert.equal(api.calls.length, 0);
  await assert.rejects(apply(f, api, { saveSnapshot: null }), error => error.code === 'backup_required');
  await assert.rejects(apply(f, api, { saveSnapshot: async () => { throw Error('synthetic private disk error'); } }), error => error.code === 'pre_write_backup_failed' && error.report.writeSucceeded === false);
  assert.equal(api.calls.filter(item => item.method === 'POST').length, 0);
});

test('unknown write outcomes are never automatically retried or logged with private errors', async () => {
  for (const failPost of [() => { throw Error('synthetic private credential'); }, () => ({ status: 503, body: { detail: 'synthetic private credential' } }), () => ({ status: 200, body: { status: 'ok', revision: 999 } })]) {
    const f = fixture(), api = fakeApi(f.source, { failPost });
    await assert.rejects(apply(f, api), error => error.report.writeSucceeded === null && !JSON.stringify(error.report).includes('synthetic private credential'));
    assert.equal(api.calls.filter(item => item.method === 'POST').length, 1);
  }
});

test('readback detects any unaffected document edit, wrong target or newer revision without rollback', async () => {
  const f = fixture(), plan = planBatch50Import(f.source, f.source, f.base, f.batch, f.manifest), id = f.batch.records[0].id;
  for (const mutation of [value => { value.futureLegacy.kept = false; }, value => { value.modifiedLegends[id].deepAnalysis += 'changed'; }, value => { value.soulSaves.push({ id: 'other-save' }); }, value => { value.modifiedLegends.orphan.unknownNested.kept = false; }]) {
    const observed = structuredClone(plan.after); mutation(observed); assert.equal(verifyBatch50Write(plan, observed, f.batch).contentPreserved, false);
  }
  const wrong = structuredClone(plan.after); wrong.modifiedLegends[id].stats[0]++; assert.equal(verifyBatch50Write(plan, wrong, f.batch).targetsMatch, false);
  const api = fakeApi(f.source, { afterWrite: value => { value.revision++; value.soulSaves.push({ id: 'later-save' }); } }), report = await apply(f, api);
  assert.equal(report.passed, false); assert.equal(report.writeSucceeded, true); assert.equal(report.verification.targetsMatch, true); assert.equal(api.calls.filter(item => item.method === 'POST').length, 1);
});

test('source size, unverified provenance and malformed stats are rejected locally', () => {
  const f = fixture(); f.source.futureLegacy.large = 'x'.repeat(32 * 1024 * 1024); f.manifest.sourceSha256 = contentHash(f.source); f.batch.manifestSha256 = contentHash(f.manifest);
  assert.throws(() => planBatch50Import(f.source, f.source, f.base, f.batch, f.manifest), error => error.code === 'userdata_size_limit');
  for (const mutation of [value => { value.records[0].provenance.webSearchPerformed = false; }, value => { value.records[0].provenance.checkedSources = []; }, value => { value.records[0].fields.stats = [1, 2, 3, 4]; }, value => { value.records[0].fields.stats[0] = 1.5; }, value => { value.records[0].fields.stats[0] = 101; }]) {
    const next = fixture(); mutation(next.batch); assert.throws(() => validateChunk(next.batch, next.manifest));
  }
});

test('CLI cannot change manifest scope and requires explicit apply, report and backup arguments', () => {
  const basic = ['--origin', 'https://dynasty.piamamba.com', '--source', 'source.private.json', '--results', 'results.json', '--output', 'report.json', '--token-file', 'token.private.json'];
  assert.equal(parseArguments(basic).apply, false);
  assert.equal(parseArguments([...basic, '--apply', '--approved-report', 'approved.json', '--backup-dir', 'new-private-dir']).apply, true);
  for (const extra of [['--manifest', 'foreign.json'], ['--apply'], ['--backup-dir', 'unused'], ['--apply', '--apply'], ['--origin', 'duplicate'], ['--secret-file', 'both.private.json']]) assert.throws(() => parseArguments([...basic, ...extra]));
  assert.deepEqual(COMPLETION_FIELDS, ['analysis', 'soulEssence', 'stats', 'statsAnalysis']);
});

test('all original article sections and five matching ordered reasons must be complete before a read', async () => {
  for (const mutation of [
    value => { value.analysis = value.analysis.replace('【如果生在現代】', '【缺失章節】'); },
    value => { value.analysis += '\n\n## 【歷史局勢與定位】\n重複章節'; },
    value => { value.soulEssence = value.soulEssence.replace('【內在裂縫】', '【缺失欄位】'); },
    value => { value.soulEssence = value.soulEssence.replace(/\[(?:史載|推斷|詮釋)\]/g, ''); },
    value => { value.statsAnalysis = value.statsAnalysis.replace('政治：44', '政治：45'); },
    value => { value.statsAnalysis = value.statsAnalysis.replace('魅力：55', '缺失：55'); },
    value => { value.statsAnalysis += '\n\n### 魅力：55\n' + '完全合成的重複理由。'.repeat(10); },
    value => { value.analysis += '\n<!-- BATCH50_COMPLETE test analysisStats -->'; },
  ]) {
    const f = fixture(); mutation(f.batch.records[0].fields); let calls = 0;
    await assert.rejects(runBatch50Import({ ...f, request: async () => { calls++; } })); assert.equal(calls, 0);
  }
});

test('apply requires passing evidence before any request and validates it again after a conflict', async () => {
  const f = fixture();
  for (const validateEvidence of [null, async () => false, async () => ({ passed: true }), async () => { throw Error('synthetic private credential'); }]) {
    const api = fakeApi(f.source);
    await assert.rejects(apply(f, api, { validateEvidence }), error => ['evidence_validation_required', 'evidence_validation_failed'].includes(error.code) && !JSON.stringify(error.report).includes('synthetic private credential'));
    assert.equal(api.calls.length, 0); assert.equal(api.backups.length, 0);
  }
  const api = fakeApi(f.source, { conflict: value => { value.soulSaves.push({ id: 'synthetic-new-save' }); } });
  let checks = 0;
  const validateEvidence = async ({ batch, manifest }) => {
    assert.equal(contentHash(batch), contentHash(f.batch)); assert.equal(contentHash(manifest), contentHash(f.manifest));
    return ++checks === 1;
  };
  await assert.rejects(apply(f, api, { validateEvidence }), error => error.code === 'evidence_validation_failed');
  assert.equal(checks, 2); assert.deepEqual(api.calls.map(item => item.method), ['GET', 'POST']);
  assert.equal(api.calls.filter(item => item.method === 'POST').length, 1);
});


test('analysis format allows exactly three coupled fields and preserves soul and all existing content', async () => {
  const f = fixture(); f.batch.format = 'dynasty-analysis-batch50-analysis-results';
  delete f.batch.records[0].fields.soulEssence;
  validateChunk(f.batch, f.manifest);
  const plan = planBatch50Import(f.source, f.source, f.base, f.batch, f.manifest);
  assert.equal(plan.report.changedFields, 3);
  assert.deepEqual(plan.report.writtenFieldHashes.map(v => v.field), ['analysis', 'stats', 'statsAnalysis']);
  assert.equal(plan.report.writtenFieldHashes.find(v => v.field === 'stats').sha256, contentHash(f.batch.records[0].fields.stats));
  assert.equal(Object.hasOwn(plan.after.modifiedLegends[f.batch.records[0].id], 'soulEssence'), false);
  assert.equal(verifyBatch50Write(plan, plan.after, f.batch).passed, true);
  for (const mutate of [b => { b.records[0].fields.soulEssence = 'crossed'; }, b => { delete b.records[0].fields.stats; },
    b => { b.format = 'dynasty-analysis-batch50-results'; }, b => { b.records[0].fields.deepAnalysis = 'overwrite'; }]) {
    const batch = structuredClone(f.batch); mutate(batch); assert.throws(() => validateChunk(batch, f.manifest));
  }
  for (const field of COMPLETION_FIELDS) {
    const latest = structuredClone(f.source); latest.modifiedLegends[f.batch.records[0].id][field] = field === 'stats' ? [1,2,3,4,5] : 'existing';
    assert.throws(() => planBatch50Import(f.source, latest, f.base, f.batch, f.manifest), e => e.code === 'existing_live_field');
  }
  const api = fakeApi(f.source), report = await apply(f, api);
  assert.equal(report.passed, true); assert.equal(report.changedFields, 3); assert.equal(report.verification.contentPreserved, true);
  const failing = fakeApi(f.source);
  await assert.rejects(apply(f, failing, { validateEvidence: async () => false }), e => e.code === 'evidence_validation_failed');
  assert.deepEqual(failing.calls, []);
});
