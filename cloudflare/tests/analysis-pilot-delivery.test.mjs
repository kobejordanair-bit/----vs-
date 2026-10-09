import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_FIELDS } from '../src/contracts.mjs';
import { contentHash, sha256 } from '../scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_LAYERS } from '../scripts/analysis-pilot-layers-import.mjs';
import { validateCompleteAudit, markdownToHtml, parseDeliveryArguments } from '../../analysis-pilot/build-delivery.mjs';

function fixture() {
  const ids = Object.keys(AUTHORIZED_LAYERS), provenance = { provider: 'ChatGPT web', conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', generatedAt: '2026-10-09T00:00:00.000Z', checkedSources: [{ title: 'Synthetic public fixture', url: 'https://example.org/history', locator: 'Synthetic locator' }] };
  const deep = { format: 'dynasty-analysis-pilot-results', schemaVersion: 1, records: ids.map(id => ({ id, inputSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64), deepAnalysis: 'Synthetic fixture, not a historical manuscript. '.repeat(30) + '\n【建議定案】\n評級：A\n稱號：合成\n標籤：合成\n簡評：合成\n判詞：合成', provenance })) };
  const layers = { format: 'dynasty-analysis-pilot-layer-results', schemaVersion: 1, records: ids.map(id => ({ id, inputSha256: 'c'.repeat(64), promptSha256: 'd'.repeat(64), fields: Object.fromEntries(AUTHORIZED_LAYERS[id].map(field => [field, 'Synthetic layer fixture, not a historical manuscript. '.repeat(20)])), provenance })) };
  const audit = {
    format: 'dynasty-complete-pilot-delivery-audit', schemaVersion: 1, status: 'complete_verified', passed: true,
    authorization: { deepAnalysisAdditions: 3, additionalLayerAdditions: 5, totalAddedFields: 8, existingWangJianAnalysisPreserved: true },
    revision: { before: 1, after: 3, passed: true },
    batchHashes: { deepBatchSha256: contentHash(deep), layersBatchSha256: contentHash(layers) },
    userdataFields: Object.fromEntries(USER_FIELDS.map(field => [field, { preserved: true, beforeSha256: 'e'.repeat(64), afterRemovingAllowedAdditionsSha256: 'e'.repeat(64) }])),
    userdataHashes: { unaffectedBeforeSha256: 'f'.repeat(64), unaffectedAfterSha256: 'f'.repeat(64) },
    histories: { before: { simulations: 9 }, after: { simulations: 9 }, preserved: true },
    figures: { before: { uniqueIds: 3, deepAnalysis: { uniqueFigures: 0 }, analysis: { uniqueFigures: 1 }, soulEssence: { uniqueFigures: 0 } }, after: { uniqueIds: 3, deepAnalysis: { uniqueFigures: 3 }, analysis: { uniqueFigures: 3 }, soulEssence: { uniqueFigures: 3 } } },
    worldworkspaces: { checked: false },
    layers: ids.map(id => ({ id, additions: ['deepAnalysis', ...AUTHORIZED_LAYERS[id]].map(field => { const text = field === 'deepAnalysis' ? deep.records.find(item => item.id === id).deepAnalysis : layers.records.find(item => item.id === id).fields[field]; return { field, sha256: sha256(text), utf16CodeUnits: text.length }; }) })),
  };
  return { audit, deep, layers };
}

test('delivery gate requires a genuine completed audit and exact eight verified batch hashes', () => {
  const f = fixture(); assert.equal(validateCompleteAudit(f.audit, f.deep, f.layers), f.audit);
  assert.throws(() => validateCompleteAudit(null, f.deep, f.layers), error => error.code === 'complete_delivery_audit_required');
  f.audit.passed = false;
  assert.throws(() => validateCompleteAudit(f.audit, f.deep, f.layers), error => error.code === 'complete_delivery_audit_required');
});

test('delivery rejects changed batch, missing preserved field, wrong counts and altered manuscript hash', () => {
  for (const [change, code] of [
    [f => { f.deep.records[0].deepAnalysis += 'Changed'; }, 'delivery_batch_hash_mismatch'],
    [f => { f.audit.userdataFields.chatHistories.preserved = false; }, 'complete_delivery_preservation_missing'],
    [f => { f.audit.figures.after.soulEssence.uniqueFigures = 2; }, 'delivery_analysis_counts_mismatch'],
    [f => { f.audit.layers[0].additions[0].sha256 = '0'.repeat(64); }, 'delivery_layer_hash_mismatch'],
  ]) { const f = fixture(); change(f); assert.throws(() => validateCompleteAudit(f.audit, f.deep, f.layers), error => error.code === code); }
});

test('article renderer displays original text safely without executing HTML', () => {
  const output = markdownToHtml('# 標題\n\n<script>alert(1)</script>\n**原文強調**\n[來源](https://example.org/history)');
  assert.ok(!output.includes('<script>'));
  assert.match(output, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(output, /<strong>原文強調<\/strong>/);
  assert.match(output, /href="https:\/\/example.org\/history"/);
});

test('delivery arguments keep output in the workspace and prohibit private artifact paths', () => {
  assert.match(parseDeliveryArguments([]).output, /人物分析ChatGPT試跑_2026-10-09/);
  assert.throws(() => parseDeliveryArguments(['--audit', 'cloudflare/private/final.json']), error => error.code === 'public_artifact_path_required');
  assert.throws(() => parseDeliveryArguments(['--output', 'analysis-pilot/output']), error => error.code === 'delivery_output_outside_workspace');
  assert.throws(() => parseDeliveryArguments(['--output', 'C:/Windows/output']), error => error.code === 'delivery_output_outside_workspace');
});
