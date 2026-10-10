import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { USER_DEFAULTS } from '../cloudflare/src/contracts.mjs';
import { contentHash, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadFixedManifest, validateChunk, validateBatch50Evidence, planBatch50Import, precheckBatch50Import, runBatch50Import,
  validatePriorReceiptDocument, SOUL_FORMAT, ANALYSIS_FIELDS } from './import.mjs';

// Soul-only continuation (06): only soulEssence may be added, and only while the
// live document still holds exactly the fields a verified apply receipt wrote.
// Everything below except the real 06 files is synthetic.
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const code = name => error => error?.code === name;
const fixed = await loadFixedManifest();
const realSoul = await json('./results.06-06.soul.v1.json');
const realReceipt = await json('./import.06-06.apply.json');
const publicDeep = Object.fromEntries(await Promise.all(fixed.records.map(async item => [item.id, await readFile(new URL('../' + item.preserved.deepAnalysis.path, import.meta.url), 'utf8')])));

function fixture() {
  const manifest = structuredClone(fixed);
  const base = [...manifest.records.map(item => structuredClone(item.context)), ...Array.from({ length: 912 }, (_, at) => ({ id: `synthetic_filler_${at}`, name: `合成人物${at}`, type: 'general' }))];
  const source = { ...structuredClone(USER_DEFAULTS), revision: 4, futureLegacy: { kept: true } };
  for (const item of manifest.records) source.modifiedLegends[item.id] = { deepAnalysis: publicDeep[item.id] };
  manifest.sourceSha256 = contentHash(source); manifest.baseLibrarySha256 = contentHash(base);
  const target = manifest.records[0];
  const published = { analysis: '合成已發布分析。'.repeat(20), stats: [11, 22, 33, 44, 55], statsAnalysis: '合成已發布理由。'.repeat(20) };
  const live = structuredClone(source); live.revision = 6;
  Object.assign(live.modifiedLegends[target.id], structuredClone(published));
  const soul = ['說話邏輯', '壓力反應', '核心驅動', '慣性盲點', '情感結構', '參照系', '內在裂縫'].map(label => `## 【${label}】\n${'完全合成測試內核，不描述任何真實歷史人物。[史載][推斷][詮釋]'.repeat(12)}`).join('\n\n');
  const priorReceipt = { file: 'analysis-batch-50/import.06-06.apply.json', sha256: 'b'.repeat(64), afterRevision: 6,
    fieldHashes: { analysis: sha256(published.analysis), stats: contentHash(published.stats), statsAnalysis: sha256(published.statsAnalysis) } };
  const batch = { format: SOUL_FORMAT, schemaVersion: 1, manifestSha256: contentHash(manifest), records: [{ id: target.id, inputSha256: target.inputSha256,
    promptSha256: 'a'.repeat(64), fields: { soulEssence: soul }, priorReceipt,
    provenance: { provider: 'ChatGPT web', webSearchPerformed: true, conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', generatedAt: '2026-10-10T00:00:00.000Z', checkedSources: [{ title: '合成來源', url: 'https://example.org/source', locator: '合成段落' }] } }] };
  return { manifest, base, source, live, batch, target, published };
}

test('real 06 soul continuation passes chunk validation, receipt binding and file-backed rebuild', async () => {
  assert.equal(realSoul.format, SOUL_FORMAT);
  assert.deepEqual(Object.keys(realSoul.records[0].fields), ['soulEssence']);
  validateChunk(realSoul);
  assert.equal(validatePriorReceiptDocument(realReceipt, realSoul.records[0]), true);
  assert.equal(await validateBatch50Evidence({ batch: realSoul }), true);
});

test('plan adds only soulEssence when live holds exactly the receipted fields', () => {
  const f = fixture();
  const plan = planBatch50Import(f.source, f.live, f.base, f.batch, f.manifest);
  assert.equal(plan.report.changedFields, 1);
  assert.deepEqual(plan.report.writtenFieldHashes.map(item => item.field), ['soulEssence']);
  const after = plan.after.modifiedLegends[f.target.id];
  for (const field of ANALYSIS_FIELDS) assert.deepEqual(after[field], f.published[field]);
  assert.equal(after.soulEssence, f.batch.records[0].fields.soulEssence);
  assert.equal(precheckBatch50Import(f.source, f.base, f.batch, f.manifest), true);
});

test('changed published fields, an existing soul, an unapplied receipt or a changed input stop the plan', () => {
  const tampered = fixture(); tampered.live.modifiedLegends[tampered.target.id].analysis += '改';
  assert.throws(() => planBatch50Import(tampered.source, tampered.live, tampered.base, tampered.batch, tampered.manifest), code('prior_receipt_fields_changed'));
  const missingField = fixture(); delete missingField.live.modifiedLegends[missingField.target.id].statsAnalysis;
  assert.throws(() => planBatch50Import(missingField.source, missingField.live, missingField.base, missingField.batch, missingField.manifest), code('prior_receipt_fields_changed'));
  const existing = fixture(); existing.live.modifiedLegends[existing.target.id].soulEssence = '既有內核';
  assert.throws(() => planBatch50Import(existing.source, existing.live, existing.base, existing.batch, existing.manifest), code('existing_live_field'));
  const early = fixture(); early.live.revision = 5;
  assert.throws(() => planBatch50Import(early.source, early.live, early.base, early.batch, early.manifest), code('prior_receipt_not_applied'));
  const other = fixture(); other.live.modifiedLegends[other.target.id].name = '合成改名';
  assert.throws(() => planBatch50Import(other.source, other.live, other.base, other.batch, other.manifest), code('live_input_changed'));
  const offline = fixture();
  assert.throws(() => planBatch50Import(offline.source, offline.source, offline.base, offline.batch, offline.manifest), code('prior_receipt_not_applied'));
});

test('the soul format cannot carry other fields and other formats cannot carry a receipt', () => {
  const extra = fixture(); extra.batch.records[0].fields.analysis = '偷渡分析';
  assert.throws(() => validateChunk(extra.batch, extra.manifest), code('invalid_completion_record'));
  const noReceipt = fixture(); delete noReceipt.batch.records[0].priorReceipt;
  assert.throws(() => validateChunk(noReceipt.batch, noReceipt.manifest), code('invalid_prior_receipt'));
  const wrongFields = fixture(); wrongFields.batch.records[0].priorReceipt.fieldHashes = { soulEssence: 'c'.repeat(64) };
  assert.throws(() => validateChunk(wrongFields.batch, wrongFields.manifest), code('invalid_prior_receipt'));
  const wrongFile = fixture(); wrongFile.batch.records[0].priorReceipt.file = '../cloudflare/private.json';
  assert.throws(() => validateChunk(wrongFile.batch, wrongFile.manifest), code('invalid_prior_receipt'));
  const full = structuredClone(realSoul); full.format = 'dynasty-analysis-batch50-results';
  assert.throws(() => validateChunk(full), code('invalid_completion_record'));
});

test('only a verified apply receipt of exactly the three fields unlocks the continuation', () => {
  const item = realSoul.records[0];
  const dry = { ...structuredClone(realReceipt), mode: 'dry-run' };
  assert.throws(() => validatePriorReceiptDocument(dry, item), code('prior_receipt_mismatch'));
  const failed = structuredClone(realReceipt); failed.verification.passed = false;
  assert.throws(() => validatePriorReceiptDocument(failed, item), code('prior_receipt_mismatch'));
  const otherHash = structuredClone(item); otherHash.priorReceipt.fieldHashes.analysis = 'd'.repeat(64);
  assert.throws(() => validatePriorReceiptDocument(realReceipt, otherHash), code('prior_receipt_mismatch'));
  const otherId = { ...structuredClone(item), id: fixed.records[0].id };
  assert.throws(() => validatePriorReceiptDocument(realReceipt, otherId), code('prior_receipt_mismatch'));
});

test('dry-run and apply against a live document write one field and verify readback', async () => {
  const f = fixture();
  let state = structuredClone(f.live); const backups = [];
  const request = async (method, body) => {
    if (method === 'GET') return { status: 200, body: structuredClone(state) };
    state.modifiedLegends = structuredClone(body.modifiedLegends); state.revision++;
    return { status: 200, body: { status: 'ok', revision: state.revision } };
  };
  const report = await runBatch50Import({ source: f.source, base: f.base, batch: f.batch, manifest: f.manifest, request });
  assert.equal(report.changedFields, 1); assert.equal(report.plannedAfterRevision, 7);
  const applied = await runBatch50Import({ source: f.source, base: f.base, batch: f.batch, manifest: f.manifest, request, apply: true, approvedReport: report,
    saveSnapshot: async (name, value) => backups.push(name), validateEvidence: async () => true });
  assert.equal(applied.status, 'applied_verified');
  assert.deepEqual(backups, ['before-attempt-1', 'after-write']);
  for (const field of ANALYSIS_FIELDS) assert.deepEqual(state.modifiedLegends[f.target.id][field], f.published[field]);
});
