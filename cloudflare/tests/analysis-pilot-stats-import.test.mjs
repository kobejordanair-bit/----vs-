import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { USER_DEFAULTS, USER_FIELDS, saveUserdata, loadUserdata } from '../src/contracts.mjs';
import { contentHash } from '../scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_STATS_IDS, STATS_DIMENSIONS, statsInputSha256, validateStatsAnalysis, validateStatsBatch, planStatsImport, verifyStatsWrite, runStatsImport } from '../scripts/analysis-pilot-stats-import.mjs';

const [emperor, minister] = AUTHORIZED_STATS_IDS, general = 'general_王翦_306401394';
const backup = createRequire(import.meta.url)('../../backend/static/js/backup.js');
function fixture() {
  const base = [...AUTHORIZED_STATS_IDS, general].map((id, index) => ({ id, name: `公開測試人物${index}`, rank: 'A', desc: '完全合成離線測試資料' }));
  const source = { ...structuredClone(USER_DEFAULTS), revision: 4, futureLegacy: { untouched: true }, soulSaves: [{ id: 'synthetic-save', text: '合成存檔內容' }] };
  for (const id of [...AUTHORIZED_STATS_IDS, general]) source.modifiedLegends[id] = { analysis: '既有賞析原件', deepAnalysis: '既有校準原件', soulEssence: '既有靈魂原件', unknownNested: { retain: true } };
  source.modifiedLegends[general].stats = [1, 2, 3, 4, 5];
  source.modifiedLegends[general].statsAnalysis = '既有王翦五維理由';
  source.modifiedLegends.orphan = { unknown: '孤立資料原件' };
  const records = AUTHORIZED_STATS_IDS.map(id => ({ id, inputSha256: statsInputSha256(source, base, id), promptSha256: 'a'.repeat(64),
    fields: { stats: [10, 20, 30, 40, 50], statsAnalysis: STATS_DIMENSIONS.map((label, index) => `### ${label}：${(index + 1) * 10}\n${'純合成理由，不代表任何歷史人物。'.repeat(5)}`).join('\n\n') },
    provenance: { provider: 'ChatGPT web', webSearchPerformed: true, conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', generatedAt: '2026-10-09T00:00:00.000Z', checkedSources: [{ title: '測試來源', url: 'https://example.org/history', locator: '測試定位' }] },
  }));
  return { source, base, batch: { format: 'dynasty-analysis-pilot-stats-results', schemaVersion: 1, records } };
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
      const revision = state.revision;
      afterWrite?.(state);
      return { status: 200, body: { status: 'ok', revision } };
    },
  };
}
const approval = f => planStatsImport(f.source, f.source, f.base, f.batch).report;
const apply = (f, fake, extra = {}) => runStatsImport({ ...f, request: fake.request, apply: true, approvedReport: approval(f), saveSnapshot: fake.saveSnapshot, ...extra });

test('dry-run adds exactly four allowed fields and preserves Wang Jian and every completed article', async () => {
  const f = fixture(), fake = fakeApi(f.source), plan = planStatsImport(f.source, f.source, f.base, f.batch);
  assert.equal(plan.report.changedFields, 4); assert.equal(plan.report.provenanceFieldsWritten, 0);
  assert.deepEqual(Object.keys(plan.patch), ['revision', 'modifiedLegends']);
  for (const id of [...AUTHORIZED_STATS_IDS, general]) for (const field of ['analysis', 'deepAnalysis', 'soulEssence', 'unknownNested']) assert.deepEqual(plan.after.modifiedLegends[id][field], f.source.modifiedLegends[id][field]);
  assert.deepEqual(plan.after.modifiedLegends[general], f.source.modifiedLegends[general]);
  const report = await runStatsImport({ ...f, request: fake.request });
  assert.equal(report.passed, true); assert.equal(report.mode, 'dry-run'); assert.deepEqual(fake.calls.map(call => call.method), ['GET']);
  for (const prose of ['純合成理由', '合成存檔內容', '既有賞析原件', '測試來源', general]) assert.ok(!JSON.stringify(report).includes(prose));
  assert.ok(!JSON.stringify(plan.patch).includes('conversationUrl'));
});

test('apply saves complete snapshots and verifies all unaffected content hashes', async () => {
  const f = fixture(), fake = fakeApi(f.source), report = await apply(f, fake);
  assert.equal(report.status, 'applied_verified'); assert.equal(report.writeSucceeded, true);
  assert.equal(report.verification.unaffectedBeforeSha256, report.verification.unaffectedAfterSha256);
  assert.deepEqual(fake.backups.map(item => item.name), ['before-attempt-1', 'after-write']);
  assert.equal(contentHash(fake.backups[0].value), contentHash(f.source)); assert.equal(fake.read().revision, 5);
  for (const item of f.batch.records) assert.deepEqual(fake.read().modifiedLegends[item.id].stats, item.fields.stats);
});

test('Cloudflare save/load and user backup preserve the new reasons without discarding unknown fields', async () => {
  const f = fixture(), plan = planStatsImport(f.source, f.source, f.base, f.batch);
  let stored = structuredClone(f.source);
  const store = { async read() { return { document: structuredClone(stored), version: 'synthetic-version' }; }, async compareAndSwap(id, observed, next) { stored = structuredClone(next); return true; } };
  await saveUserdata(store, plan.patch);
  const observed = await loadUserdata(store);
  assert.equal(verifyStatsWrite(plan, observed, f.batch).passed, true);
  const data = Object.fromEntries(USER_FIELDS.map(field => [field, observed[field]]));
  const restored = backup.parseBackup(JSON.stringify(backup.createBackup(data)));
  assert.deepEqual(restored.data.modifiedLegends, plan.after.modifiedLegends);
});

test('non-integer, out-of-range, short and malformed score arrays are rejected before any access', async () => {
  for (const scores of [[0, 1, 2, 3], [0, 1, 2, 3, 4, 5], [0, 1.5, 2, 3, 4], [0, -1, 2, 3, 4], [0, 101, 2, 3, 4], [0, '1', 2, 3, 4], [0, null, 2, 3, 4], null, '1,2,3,4,5']) {
    const f = fixture(); f.batch.records[0].fields.stats = scores; let calls = 0;
    await assert.rejects(runStatsImport({ ...f, request: async () => { calls++; } }), error => error.code === 'invalid_stats_values');
    assert.equal(calls, 0);
  }
});

test('other targets, rating/article edits, incomplete fields and duplicate records fail locally', async () => {
  for (const mutate of [f => { f.batch.records[0].id = general; }, f => { f.batch.records[0].id = 'other'; }, f => { f.batch.records[0].fields.rank = 'S'; }, f => { f.batch.records[0].fields.analysis = 'overwrite'; }, f => { delete f.batch.records[0].fields.statsAnalysis; }, f => { f.batch.records[0].id = f.batch.records[1].id; }, f => { f.batch.records.pop(); }]) {
    const f = fixture(); mutate(f); let calls = 0;
    await assert.rejects(runStatsImport({ ...f, request: async () => { calls++; } })); assert.equal(calls, 0);
  }
});

test('existing source scores, malformed legacy scores or existing reasons are never overwritten', () => {
  for (const stats of [[1, 2, 3, 4, 5], [], '', {}]) {
    const f = fixture(); f.source.modifiedLegends[emperor].stats = stats;
    f.batch.records[0].inputSha256 = statsInputSha256(f.source, f.base, emperor);
    assert.throws(() => planStatsImport(f.source, f.source, f.base, f.batch), error => error.code === 'existing_source_stats');
  }
  const f = fixture(); f.source.modifiedLegends[minister].statsAnalysis = '既有理由';
  f.batch.records[1].inputSha256 = statsInputSha256(f.source, f.base, minister);
  assert.throws(() => planStatsImport(f.source, f.source, f.base, f.batch), error => error.code === 'existing_source_stats');
  const incomplete = fixture(); delete incomplete.source.modifiedLegends[emperor].soulEssence;
  assert.throws(() => statsInputSha256(incomplete.source, incomplete.base, emperor), error => error.code === 'completed_layers_required');
});

test('whole-figure hashes bind completed articles and stop a changed live target before another write', async () => {
  const f = fixture(); f.source.modifiedLegends[emperor].analysis += 'source changed';
  assert.throws(() => planStatsImport(f.source, f.source, f.base, f.batch), error => error.code === 'source_input_hash_mismatch');
  const next = fixture(), fake = fakeApi(next.source, { conflict: state => { state.modifiedLegends[minister].deepAnalysis += 'live changed'; } });
  await assert.rejects(apply(next, fake), error => error.code === 'live_input_changed');
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
  const filled = fixture(), race = fakeApi(filled.source, { conflict: state => { state.modifiedLegends[emperor].stats = [1, 1, 1, 1, 1]; } });
  await assert.rejects(apply(filled, race), error => error.code === 'existing_stats');
  assert.deepEqual(race.read().modifiedLegends[emperor].stats, [1, 1, 1, 1, 1]);
});

test('CAS retry merges the latest full map and preserves concurrent unrelated progress', async () => {
  const f = fixture(), fake = fakeApi(f.source, { conflict: state => { state.modifiedLegends.other = { future: 'new' }; state.soulSaves.push({ id: 'new-save' }); state.futureLegacy.concurrent = true; } });
  const report = await apply(f, fake);
  assert.equal(report.passed, true); assert.equal(report.conflicts, 1); assert.equal(report.beforeRevision, 5);
  assert.equal(fake.read().modifiedLegends.other.future, 'new'); assert.equal(fake.read().soulSaves.length, 2); assert.equal(fake.read().futureLegacy.concurrent, true);
  assert.deepEqual(fake.calls.map(call => call.method), ['GET', 'POST', 'GET', 'POST', 'GET']);
  const other = fixture(), repeated = fakeApi(other.source, { alwaysConflict: true });
  await assert.rejects(apply(other, repeated), error => error.code === 'conflict_retry_limit' && error.report.writeSucceeded === false);
  assert.equal(repeated.calls.filter(call => call.method === 'POST').length, 4);
});

test('approval is bound to stats phase, source, batch and base before any network access', async () => {
  for (const mutate of [f => { f.batch.records[0].fields.stats[0]++; f.batch.records[0].fields.statsAnalysis = f.batch.records[0].fields.statsAnalysis.replace('統率：10', '統率：11'); }, f => { f.source.futureLegacy.new = true; }, f => { f.base[0].desc += ' changed'; }]) {
    const f = fixture(), approvedReport = approval(f); mutate(f); let calls = 0;
    await assert.rejects(runStatsImport({ ...f, request: async () => { calls++; }, apply: true, approvedReport, saveSnapshot: async () => {} }), error => ['dry_run_approval_required', 'source_input_hash_mismatch'].includes(error.code));
    assert.equal(calls, 0);
  }
  const f = fixture(), fake = fakeApi(f.source);
  await assert.rejects(apply(f, fake, { approvedReport: { ...approval(f), format: 'dynasty-analysis-pilot-layer-import' } }), error => error.code === 'dry_run_approval_required');
  assert.equal(fake.calls.length, 0);
});

test('a mandatory backup failure prevents every write', async () => {
  const f = fixture(), fake = fakeApi(f.source);
  await assert.rejects(apply(f, fake, { saveSnapshot: null }), error => error.code === 'backup_required');
  await assert.rejects(apply(f, fake, { saveSnapshot: async () => { throw Error('synthetic disk error'); } }), error => error.code === 'pre_write_backup_failed' && error.report.writeSucceeded === false);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 0);
});

test('ambiguous writes are never retried or reported as a definite non-write', async () => {
  for (const failPost of [() => { throw Error('synthetic private token'); }, () => ({ status: 503, body: { detail: 'synthetic private token' } }), () => ({ status: 200, body: { status: 'ok', revision: 999 } })]) {
    const f = fixture(), fake = fakeApi(f.source, { failPost });
    await assert.rejects(apply(f, fake), error => error.report.writeSucceeded === null && !JSON.stringify(error.report).includes('synthetic private token'));
    assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('verification detects target mismatches and changes to any article, Wang score or document extra', async () => {
  const f = fixture(), plan = planStatsImport(f.source, f.source, f.base, f.batch);
  for (const mutate of [after => { after.modifiedLegends[emperor].analysis += 'changed'; }, after => { after.modifiedLegends[minister].soulEssence += 'changed'; }, after => { after.modifiedLegends[general].stats[0]++; }, after => { after.futureLegacy.untouched = false; }]) {
    const after = structuredClone(plan.after); mutate(after); assert.equal(verifyStatsWrite(plan, after, f.batch).contentPreserved, false);
  }
  const wrongScores = structuredClone(plan.after); wrongScores.modifiedLegends[emperor].stats[0]++;
  assert.equal(verifyStatsWrite(plan, wrongScores, f.batch).targetsMatch, false);
  const fake = fakeApi(f.source, { afterWrite: state => { state.soulSaves.push({ id: 'new-live-save' }); state.revision++; } }), report = await apply(f, fake);
  assert.equal(report.passed, false); assert.equal(report.writeSucceeded, true); assert.equal(report.verification.targetsMatch, true);
  assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
});

test('32 MiB limit, missing dimension reasons and unverified web provenance fail locally', () => {
  const f = fixture(); f.source.futureLegacy.large = 'x'.repeat(32 * 1024 * 1024);
  assert.throws(() => planStatsImport(f.source, f.source, f.base, f.batch), error => error.code === 'userdata_size_limit');
  for (const mutate of [batch => { batch.records[0].fields.statsAnalysis = 'truncated'; }, batch => { batch.records[0].fields.statsAnalysis = batch.records[0].fields.statsAnalysis.replaceAll('魅力', '缺失'); }, batch => { batch.records[0].provenance.webSearchPerformed = false; }, batch => { batch.records[0].provenance.checkedSources = []; }]) {
    const { batch } = fixture(); mutate(batch); assert.throws(() => validateStatsBatch(batch));
  }
});

test('reason headings accept numbered, unnumbered, Markdown and bold decorations while preserving scores and reasons', () => {
  const { fields } = fixture().batch.records[0];
  for (const heading of [(label, score) => `### ${label}：${score}`, (label, score, index) => `${index + 1}. ${label}：${score}`, (label, score, index) => `## **${index + 1}. ${label}：${score}**`, (label, score) => `### **${label}**：${score}/100`]) {
    const prose = STATS_DIMENSIONS.map((label, index) => `${heading(label, fields.stats[index], index)}\n${'完全合成的理由段落，不描述任何真實人物。'.repeat(3)}`).join('\n\n');
    const parsed = validateStatsAnalysis(prose.replaceAll('\n', '\r\n'), fields.stats);
    assert.deepEqual(parsed.map(item => item.dimension), STATS_DIMENSIONS);
    assert.deepEqual(parsed.map(item => item.score), fields.stats);
    assert.equal(parsed.length, 5); assert.ok(parsed.every(item => item.reason.includes('完全合成')));
  }
});

test('reason heading duplicates, wrong order, wrong ordinal, mismatched scores and malformed titles are rejected', () => {
  const { fields } = fixture().batch.records[0];
  for (const prose of [
    fields.statsAnalysis + '\n\n### 魅力：50\n' + '重複標題合成理由。'.repeat(10),
    fields.statsAnalysis.replace('統率：10', '武力：10').replace('武力：20', '統率：20'),
    fields.statsAnalysis.replace('統率：10', '2. 統率：10'),
    fields.statsAnalysis.replace('政治：40', '政治：41'),
    fields.statsAnalysis.replace('智謀：30', '智謀：30 不合法標題'),
    fields.statsAnalysis.replace('魅力：50', '**魅力：50'),
  ]) assert.throws(() => validateStatsAnalysis(prose, fields.stats));
  const short = fields.statsAnalysis.replace('### 統率：10\n' + '純合成理由，不代表任何歷史人物。'.repeat(5), '### 統率：10\n短理由');
  assert.throws(() => validateStatsAnalysis(short, fields.stats), error => error.code === 'incomplete_stats_reason');
});
