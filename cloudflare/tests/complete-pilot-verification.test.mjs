import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_DEFAULTS } from '../src/contracts.mjs';
import { figureInputSha256, planPilot } from '../scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_LAYERS, layerInputSha256, planLayerImport } from '../scripts/analysis-pilot-layers-import.mjs';
import { verifyCompletePilot, parseVerificationArguments } from '../../analysis-pilot/verify-complete-pilot.mjs';

function fixture() {
  const ids = Object.keys(AUTHORIZED_LAYERS);
  const base = ids.map(id => ({ id, name: '公開合成測試人物', type: 'emperor', rank: 'A', title: '原稱號', tag: '原標籤', desc: '原簡評', poem: '原判詞' }));
  const before = { ...structuredClone(USER_DEFAULTS), revision: 11, unknownFutureField: { privateFixture: 'do-not-emit-secret-fixture' } };
  for (const id of ids) before.modifiedLegends[id] = { stats: [77, 51, 89, 94, 76], preservedNested: { privateFixture: 'do-not-emit-secret-fixture' } };
  before.modifiedLegends[ids[1]].analysis = '原王翦賞析應完整保留';
  before.modifiedLegends['unrelated-orphan'] = { rank: 'B', analysis: '原有孤立人物資料' };
  before.simulationHistory = [{ id: 'simulation-fixture', result: '原模擬文字' }];
  before.soulSaves = [{ id: 'soul-fixture', snapshot: { chapters: [{ text: '原章節' }] } }];
  before.chatHistories = { [ids[0]]: [{ role: 'user', content: '原聊天文字' }] };
  const provenance = { provider: 'ChatGPT web', conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', generatedAt: '2026-10-09T00:00:00.000Z', checkedSources: [{ title: '公開合成測試', url: 'https://example.org/history', locator: '測試定位' }] };
  const deepBatch = { format: 'dynasty-analysis-pilot-results', schemaVersion: 1, records: ids.map(id => ({ id, inputSha256: figureInputSha256(before, base, id), promptSha256: 'a'.repeat(64), deepAnalysis: '僅為合成測試，不是真實人物文章。'.repeat(60) + '\n【建議定案】\n評級：A\n稱號：合成稱號\n標籤：合成標籤\n簡評：合成簡評\n判詞：合成判詞', provenance })) };
  const first = planPilot(before, before, base, deepBatch);
  const layersBatch = { format: 'dynasty-analysis-pilot-layer-results', schemaVersion: 1, records: ids.map(id => ({ id, inputSha256: layerInputSha256(first.after, base, id), promptSha256: 'b'.repeat(64), fields: Object.fromEntries(AUTHORIZED_LAYERS[id].map(field => [field, `${field}\n${'純合成測試內容，不含真實歷史分析。'.repeat(40)}`])), provenance })) };
  const after = planLayerImport(first.after, first.after, base, layersBatch).after;
  return { before, after, base, deepBatch, layersBatch };
}
const verify = f => verifyCompletePilot(f.before, f.after, f.base, f.deepBatch, f.layersBatch);

test('combined verification accepts exactly eight additions, preserves all 10 fields and emits only safe metadata', () => {
  const f = fixture(), report = verify(f);
  assert.equal(report.passed, true);
  assert.equal(report.authorization.totalAddedFields, 8);
  assert.equal(report.authorization.existingWangJianAnalysisPreserved, true);
  assert.equal(report.revision.after - report.revision.before, 2);
  assert.equal(report.userdataHashes.unaffectedBeforeSha256, report.userdataHashes.unaffectedAfterSha256);
  assert.equal(Object.keys(report.userdataFields).length, 10);
  assert.ok(Object.values(report.userdataFields).every(field => field.preserved));
  assert.equal(report.histories.after.simulations, 1);
  assert.equal(report.histories.after.soulSavedChapters, 1);
  assert.equal(report.worldworkspaces.checked, false);
  for (const privateText of ['do-not-emit-secret-fixture', '原王翦賞析應完整保留', '原章節', '原聊天文字', '僅為合成測試', '純合成測試內容']) assert.ok(!JSON.stringify(report).includes(privateText));
  assert.equal(report.layers.flatMap(person => person.additions).length, 8);
});

test('same-count changes to ratings, existing Wang Jian article, saved chapter, chat or unknown metadata are rejected', () => {
  for (const change of [
    f => { f.after.modifiedLegends['unrelated-orphan'].rank = 'S'; },
    f => { f.after.modifiedLegends['general_王翦_306401394'].analysis += '覆蓋'; },
    f => { f.after.modifiedLegends[Object.keys(AUTHORIZED_LAYERS)[0]].stats[0] = 99; },
    f => { f.after.soulSaves[0].snapshot.chapters[0].text = '篡改'; },
    f => { f.after.chatHistories[Object.keys(AUTHORIZED_LAYERS)[0]][0].content = '篡改'; },
    f => { f.after.unknownFutureField.privateFixture = '篡改'; },
  ]) {
    const f = fixture(); change(f);
    assert.throws(() => verify(f), error => error.code === 'unapproved_userdata_change');
  }
});

test('wrong revisions and altered added prose fail exact final-state verification', () => {
  const revision = fixture(); revision.after.revision++;
  assert.throws(() => verify(revision), error => error.code === 'complete_pilot_revision_mismatch');
  const prose = fixture(); prose.after.modifiedLegends[Object.keys(AUTHORIZED_LAYERS)[0]].soulEssence += '不一致';
  assert.throws(() => verify(prose), error => error.code === 'unapproved_userdata_change');
});

test('worldworkspaces is compared only when supplied in both snapshots', () => {
  const f = fixture(), wrap = (userdata, worldworkspaces) => ({ format: 'dynasty-migration-snapshot', schemaVersion: 1, documents: { userdata, worldworkspaces } });
  const suppliedBefore = wrap(f.before, { revision: 7, workspace: { notes: '合成備註' } });
  const suppliedAfter = wrap(f.after, { revision: 7, workspace: { notes: '合成備註' } });
  const report = verifyCompletePilot(suppliedBefore, suppliedAfter, f.base, f.deepBatch, f.layersBatch);
  assert.equal(report.worldworkspaces.checked, true);
  assert.equal(report.worldworkspaces.beforeSha256, report.worldworkspaces.afterSha256);
  assert.equal(verifyCompletePilot(suppliedBefore, f.after, f.base, f.deepBatch, f.layersBatch).worldworkspaces.checked, false);
  suppliedAfter.documents.worldworkspaces.workspace.notes = '變更';
  assert.throws(() => verifyCompletePilot(suppliedBefore, suppliedAfter, f.base, f.deepBatch, f.layersBatch), error => error.code === 'provided_world_snapshot_changed');
});

test('CLI requires all five input/output arguments and refuses ambiguous options', () => {
  const args = ['--before', 'before.json', '--after', 'after.json', '--deep-batch', 'deep.json', '--layers-batch', 'layers.json', '--output', 'complete-delivery-audit.json'];
  assert.equal(Object.keys(parseVerificationArguments(args)).length, 5);
  assert.throws(() => parseVerificationArguments(args.slice(0, -2)), error => error.code === 'missing_verification_argument');
  assert.throws(() => parseVerificationArguments([...args, '--before', 'other.json']), error => error.code === 'invalid_verification_arguments');
});
