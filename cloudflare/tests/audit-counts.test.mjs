import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSnapshot, loadBaseLibrary } from '../scripts/audit-counts.mjs';

const envelope = documents => ({ format: 'dynasty-migration-snapshot', schemaVersion: 1, documents });

test('public base inventory reproduces the actual 296 built-in identities', async () => {
  const { base, baseSourceSha256 } = await loadBaseLibrary();
  assert.equal(base.length, 296);
  assert.equal(base.filter(record => record.type === 'emperor').length, 74);
  assert.equal(base.filter(record => record.type === 'general').length, 129);
  assert.equal(base.filter(record => record.type === 'minister').length, 93);
  assert.equal(new Set(base.map(record => record.id)).size, 296);
  assert.ok(base.every(record => typeof record.id === 'string' && record.id.startsWith(record.type + '_' + record.name + '_')));
  assert.match(baseSourceSha256, /^[0-9a-f]{64}$/);
});

test('296 built-in plus 666 unique custom figures produces 962, without adding modification-map length', async () => {
  const { base } = await loadBaseLibrary();
  const custom = Array.from({ length: 666 }, (_, index) => ({ id: 'fake-custom-' + index, name: '測試人物', type: 'general' }));
  const modifications = { [base[0].id]: { id: 'cannot-replace-original-id', deepAnalysis: 'PRIVATE-ORIGINAL-ANALYSIS' }, [custom[0].id]: { analysis: 'PRIVATE-SECOND-ANALYSIS', soulEssence: 'PRIVATE-PERSONALITY' } };
  const input = envelope({ userdata: { revision: 31, customLegends: custom, modifiedLegends: modifications }, worldworkspaces: null });
  const before = JSON.stringify(input);
  const report = auditSnapshot(input, base, null, 962);
  assert.equal(report.figures.builtIn, 296);
  assert.equal(report.figures.custom, 666);
  assert.equal(report.figures.modifications, 2);
  assert.equal(report.figures.visibleEntries, 962);
  assert.equal(report.figures.uniqueIds, 962);
  assert.equal(report.figures.duplicateMergedIds, 0);
  assert.equal(report.figures.withAnyAnalysis, 2);
  assert.equal(report.figures.deepAnalysis.uniqueFigures, 1);
  assert.equal(report.figures.analysis.uniqueFigures, 1);
  assert.equal(report.figures.soulEssence.uniqueFigures, 1);
  assert.equal(report.figures.orphanModificationRecords, 0);
  assert.equal(report.expectedFigures.countMatches, 1);
  assert.equal(JSON.stringify(input), before);
  assert.ok(!JSON.stringify(report).includes('PRIVATE-'));
  assert.ok(!JSON.stringify(report).includes('fake-custom-'));
  assert.ok(!JSON.stringify(report).includes(base[0].name));
});

test('duplicate identities and orphaned legacy references are counted without merging away original records', () => {
  const base = [{ id: 'base-1', name: '測試帝', type: 'emperor' }];
  const input = envelope({ userdata: {
    customLegends: [{ id: 'base-1', name: '同ID人物', type: 'general' }, { id: 'duplicate-custom', name: '人一', type: 'minister' }, { id: 'duplicate-custom', name: '人二', type: 'minister' }],
    modifiedLegends: { orphan: { deepAnalysis: 'PRIVATE-ORPHAN-ARTICLE' } },
    chatHistories: { orphan: [{ content: 'PRIVATE-ORPHAN-CHAT' }], 'base-1': [{ role: 'user' }, { role: 'model' }] },
    discussionHistories: { orphan: { messages: [{ content: 'PRIVATE-DISCUSSION' }] } },
  }, worldworkspaces: null });
  const report = auditSnapshot(input, base);
  assert.equal(report.figures.visibleEntries, 4);
  assert.equal(report.figures.uniqueIds, 2);
  assert.equal(report.figures.duplicateMergedIds, 2);
  assert.equal(report.figures.duplicateCustomIds, 1);
  assert.equal(report.figures.customCollisionsWithBuiltIn, 1);
  assert.equal(report.figures.orphanModificationRecords, 1);
  assert.equal(report.figures.deepAnalysis.storedModificationRecords, 1);
  assert.equal(report.figures.deepAnalysis.uniqueFigures, 0);
  assert.equal(report.histories.chatMessages, 3);
  assert.equal(report.histories.orphanChatGroups, 1);
  assert.equal(report.histories.discussionMessages, 1);
  assert.equal(report.histories.orphanDiscussionGroups, 1);
  assert.ok(!JSON.stringify(report).includes('PRIVATE-'));
});

test('full-field hashes detect changes in unknown future data even when all visible counts are equal', () => {
  const input = envelope({ userdata: { revision: 2, unknownFuture: { keep: 'PRIVATE-FIRST' }, soulSaves: [{ snapshot: { chapters: [{ content: 'PRIVATE-CHAPTER' }] } }] }, worldworkspaces: { revision: 3, workspace: { schemaVersion: 99, sessions: [{ narratives: [{ text: 'PRIVATE-NARRATIVE' }], unknown: true }], futureWorldField: { keep: 'PRIVATE-FIRST' } }, futureDocField: 'PRIVATE-FIRST' } });
  const copied = structuredClone(input);
  const exact = auditSnapshot(input, [], copied);
  assert.equal(exact.comparison.matchingDocuments, 2);
  assert.equal(exact.userdata.unknownTopLevelFields, 1);
  assert.equal(exact.histories.soulSavedChapters, 1);
  assert.equal(exact.world.workspaceUnknownFields, 1);
  assert.equal(exact.world.unknownTopLevelFields, 1);
  assert.equal(exact.world.sessionNarratives, 1);
  copied.documents.userdata.unknownFuture.keep = 'PRIVATE-CHANGED';
  copied.documents.worldworkspaces.workspace.futureWorldField.keep = 'PRIVATE-CHANGED';
  const mismatched = auditSnapshot(input, [], copied);
  assert.equal(mismatched.comparison.matchingDocuments, 0);
  assert.equal(mismatched.comparison.mismatchingDocuments, 2);
  assert.notEqual(mismatched.comparison.sourceFullDocumentsSha256, mismatched.comparison.comparisonFullDocumentsSha256);
  assert.ok(!JSON.stringify(mismatched).includes('PRIVATE-'));
  assert.ok(!JSON.stringify(mismatched).includes('unknownFuture'));
  assert.ok(!JSON.stringify(mismatched).includes('futureWorldField'));
});

test('all ten fields, current soul, hegemony, worlds, and missing documents have count/hash coverage', () => {
  const input = envelope({ userdata: { revision: 1, customLegends: [], modifiedLegends: {}, chatHistories: {}, simulationHistory: [{ content: 'PRIVATE-SIMULATION' }], discussionHistories: {}, soulSaves: [], hegemonySavedSim: { factions: [{ name: 'PRIVATE-FACTION' }], phases: [{ content: 'PRIVATE-PHASE' }] }, scenes: [{ title: 'PRIVATE-SCENE' }], sceneEdits: { 'private-id': { text: 'PRIVATE-EDIT' } }, soulSession: { chapters: [{ content: 'PRIVATE-ACTIVE-CHAPTER' }] } }, worldworkspaces: { revision: 2, workspace: { schemaVersion: 1, sessions: [], narratives: [{ text: 'PRIVATE-NARRATIVE' }], selection: { recordIds: ['private-id'], anchors: [{ quote: 'PRIVATE-QUOTE' }] } } } });
  const report = auditSnapshot(input, []);
  assert.equal(Object.keys(report.userdata.fields).length, 10);
  assert.equal(Object.values(report.userdata.fields).every(field => field.present === 1 && /^[0-9a-f]{64}$/.test(field.sha256)), true);
  assert.equal(report.histories.simulations, 1);
  assert.equal(report.histories.hegemonyFactions, 1);
  assert.equal(report.histories.hegemonyPhases, 1);
  assert.equal(report.histories.activeSoulChapters, 1);
  assert.equal(report.histories.sceneEdits, 1);
  assert.equal(report.world.workspaceNarratives, 1);
  assert.equal(report.world.selectedFigures, 1);
  assert.equal(report.world.analysisAnchors, 1);
  assert.ok(!JSON.stringify(report).includes('PRIVATE-'));
  const empty = auditSnapshot(envelope({ userdata: null, worldworkspaces: null }), []);
  assert.equal(empty.userdata.documentPresent, 0);
  assert.equal(empty.world.documentPresent, 0);
  assert.equal(empty.figures.visibleEntries, 0);
});

test('unsafe shapes are rejected without printing private values', () => {
  const marker = 'PRIVATE-DO-NOT-PRINT';
  assert.throws(() => auditSnapshot(envelope({ userdata: { customLegends: marker }, worldworkspaces: null }), []), error => !error.message.includes(marker));
  assert.throws(() => auditSnapshot(envelope({ userdata: null }), []), /快照格式/);
  assert.throws(() => auditSnapshot(envelope({ userdata: null, worldworkspaces: null }), [], null, NaN), /期望人物數/);
});

test('preliminary inventories never become formal cutover evidence, including a matching comparison', () => {
  const documents = { userdata: { revision: 1, customLegends: [], modifiedLegends: {} }, worldworkspaces: null };
  const base = [{ id: 'synthetic-person', name: '測試人物', type: 'general' }];
  const preliminary = { ...envelope(documents), format: 'dynasty-preliminary-snapshot' };
  const formal = envelope(structuredClone(documents));
  for (const [source, comparison] of [[preliminary, null], [preliminary, formal], [formal, preliminary], [preliminary, preliminary]]) {
    const report = auditSnapshot(source, base, comparison, 1);
    assert.equal(report.stage, 'preliminary');
    assert.equal(report.expectedFigures.countMatches, 1);
    assert.equal(report.eligibleForFormalCutover, 0);
    if (comparison) assert.equal(report.comparison.matchingDocuments, 2);
  }
  const migration = auditSnapshot(formal, base, structuredClone(formal), 1);
  assert.equal(migration.stage, 'migration');
  assert.equal(migration.comparison.matchingDocuments, 2);
  assert.equal(migration.eligibleForFormalCutover, 1);
  assert.equal(auditSnapshot(formal, base).eligibleForFormalCutover, 0);
});
