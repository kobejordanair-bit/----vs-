import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadFixedManifest, COMPLETION_FIELDS } from './import.mjs';
import { CHUNKS, summarizeProgress } from './audit-progress.mjs';

const manifest = await loadFixedManifest();
function syntheticCompletedState() {
  // Deliberately synthetic status/receipt fixtures. auditProgress's production
  // reader obtains these states only by reopening actual files and rebuilding.
  const records = manifest.records.map(item => ({ id: item.id, prepared: true, generated: true, sourceQA: true, assembled: true, imported: true,
    perTask: { analysisStats: { prepared: true, generated: true, sourceQA: true }, soulEssence: { prepared: true, generated: true, sourceQA: true } },
    fields: Object.fromEntries(COMPLETION_FIELDS.map(field => [field, { generated: true, sourceQA: true, assembled: true, imported: true, sha256: sha256(`synthetic:${item.id}:${field}`) }])) }));
  const chunks = CHUNKS.map((range, at) => ({ range, imported: true, assembled: true, beforeRevision: 4 + at,
    beforeSha256: at === 0 ? manifest.sourceSha256 : sha256(`synthetic-doc:${at - 1}`), afterRevision: 5 + at, afterSha256: sha256(`synthetic-doc:${at}`),
    batchSha256: sha256(`synthetic-batch:${at}`), receiptSha256: sha256(`synthetic-receipt:${at}`) }));
  const imports = chunks.map(({ range, ...chunk }, at) => ({ chunk: range, ...chunk, snapshotVerificationPassed: true,
    rawBeforeReceiptSha256: sha256(`synthetic-raw-before:${at}`), rawAfterReceiptSha256: sha256(`synthetic-raw-after:${at}`), rawExtrasSha256: sha256('synthetic-raw-extras') }));
  const externalTransitions = imports.map((item, at) => ({ label: at === 0 ? 'baseline-to-first-import' : `${CHUNKS[at - 1]}-to-${CHUNKS[at]}`,
    fromRevision: at === 0 ? 4 : imports[at - 1].afterRevision, toRevision: item.beforeRevision,
    fromSha256: at === 0 ? manifest.sourceSha256 : imports[at - 1].afterSha256, toSha256: item.beforeSha256,
    changedFields: [], externalRevisionAdvance: false, classification: 'unchanged' }));
  externalTransitions.push({ label: 'last-import-to-final-read', fromRevision: 14, toRevision: 14,
    fromSha256: imports.at(-1).afterSha256, toSha256: imports.at(-1).afterSha256, changedFields: [], externalRevisionAdvance: false, classification: 'unchanged' });
  const preservedExistingFieldHashes = manifest.records.map(item => ({ id: item.id, field: 'deepAnalysis', sha256: item.preserved.deepAnalysis.sha256 }));
  const finalAudit = { format: 'dynasty-batch50-final-audit', schemaVersion: 1, passed: true, complete: true, manifestSha256: contentHash(manifest), revision: 14,
    documentSha256: chunks.at(-1).afterSha256,
    library: { beforeTotal: 962, afterTotal: 962, idsBeforeSha256: sha256('synthetic 962 IDs'), idsAfterSha256: sha256('synthetic 962 IDs'), idsPreserved: true },
    actualProductionRead: true, privateDataIncluded: false, previousPilotPreserved: true, allChunkUnrelatedContentPreserved: true,
    chunkCasRevisionsContiguous: true, externalChangesClassified: true, nonProgressBaselinePreserved: true, rawExtrasPreserved: true,
    exactBaselinePreserved: true, externalChangesObserved: false, nonProgressInitialSha256: sha256('synthetic-baseline'), nonProgressFinalSha256: sha256('synthetic-baseline'),
    unrelatedInitialBaselineSha256: sha256('synthetic-baseline'), unrelatedFinalBaselineSha256: sha256('synthetic-baseline'), changedProgressFields: [], imports, externalTransitions,
    preservedExistingFieldHashes, preservedDeepHashes: preservedExistingFieldHashes,
    rawExtrasVerification: { scope: 'first-successful-import-observation-through-final-read', checkedChunks: 10, currentSnapshotBound: true,
      initialSha256: sha256('synthetic-raw-extras'), finalSha256: sha256('synthetic-raw-extras'), finalReadReceiptSha256: sha256('synthetic-final-raw-receipt'),
      finalReadRawDocumentSha256: sha256('synthetic-final-raw-document'), finalReadVisibleDocumentSha256: chunks.at(-1).afterSha256 },
    writtenFieldHashes: records.flatMap(item => COMPLETION_FIELDS.map(field => ({ id: item.id, field, sha256: item.fields[field].sha256 }))) };
  return { manifest, records, chunks, finalAudit };
}

test('fifty completed stage flags never constitute completion without a final public document/library audit', () => {
  const input = syntheticCompletedState(); delete input.finalAudit;
  const progress = summarizeProgress(input);
  assert.equal(progress.counts.imported, 50); assert.equal(progress.counts.importedFields, 200);
  assert.equal(progress.complete, false); assert.equal(progress.libraryPreserved, false);
});

test('a claimed complete audit cannot hide missing fields, altered hashes, stale document or a changed 962-person identity', () => {
  for (const mutate of [audit => audit.writtenFieldHashes.pop(), audit => audit.writtenFieldHashes[0].sha256 = '0'.repeat(64),
    audit => audit.writtenFieldHashes[0].id = 'outside', audit => audit.library.afterTotal = 961,
    audit => audit.library.idsAfterSha256 = '0'.repeat(64), audit => audit.library.idsPreserved = false,
    audit => audit.documentSha256 = '0'.repeat(64), audit => audit.revision = 13,
    audit => delete audit.rawExtrasVerification, audit => audit.rawExtrasVerification.finalReadVisibleDocumentSha256 = '0'.repeat(64),
    audit => audit.imports[0].beforeRevision++, audit => audit.externalChangesObserved = true,
    audit => audit.exactBaselinePreserved = false, audit => audit.preservedExistingFieldHashes = []]) {
    const input = syntheticCompletedState(); mutate(input.finalAudit);
    const progress = summarizeProgress(input);
    assert.equal(progress.complete, false); assert.equal(progress.finalAuditVerified, false); assert.equal(progress.passed, false);
  }
  assert.equal(summarizeProgress(syntheticCompletedState()).complete, true);
});

test('individual stage flags must agree with both actual task states and all four field hashes', () => {
  for (const mutate of [input => input.records[0].perTask.soulEssence.generated = false,
    input => input.records[0].fields.stats.sha256 = null, input => input.records[0].fields.analysis.imported = false,
    input => input.records[0].fields.deepAnalysis = { sha256: '0'.repeat(64) }, input => input.chunks[0].range = 'private']) {
    const input = syntheticCompletedState(); mutate(input);
    assert.throws(() => summarizeProgress(input));
  }
});

test('final public proof accepts classified progress revisions without claiming an exact initial baseline', () => {
  const input = syntheticCompletedState(), audit = input.finalAudit;
  for (let at = 3; at < CHUNKS.length; at++) {
    input.chunks[at].beforeRevision += 2; input.chunks[at].afterRevision += 2;
    audit.imports[at].beforeRevision += 2; audit.imports[at].afterRevision += 2;
  }
  input.chunks[3].beforeSha256 = audit.imports[3].beforeSha256 = sha256('synthetic progress before fourth import');
  for (const [at, transition] of audit.externalTransitions.entries()) {
    transition.fromRevision = at === 0 ? 4 : audit.imports[at - 1].afterRevision;
    transition.toRevision = at === 10 ? 17 : audit.imports[at].beforeRevision;
    transition.fromSha256 = at === 0 ? manifest.sourceSha256 : audit.imports[at - 1].afterSha256;
    transition.toSha256 = at === 10 ? sha256('synthetic final progress') : audit.imports[at].beforeSha256;
    transition.changedFields = at === 3 ? ['soulSaves'] : at === 10 ? ['chatHistories'] : [];
    transition.externalRevisionAdvance = transition.toRevision > transition.fromRevision;
    transition.classification = transition.externalRevisionAdvance ? 'known-progress-fields-only' : 'unchanged';
  }
  audit.revision = 17; audit.documentSha256 = sha256('synthetic final progress');
  audit.rawExtrasVerification.finalReadVisibleDocumentSha256 = audit.documentSha256;
  audit.exactBaselinePreserved = false; audit.externalChangesObserved = true;
  audit.changedProgressFields = ['chatHistories', 'soulSaves']; audit.unrelatedFinalBaselineSha256 = sha256('synthetic changed progress');
  assert.equal(summarizeProgress(input).complete, true);
  audit.externalTransitions[3].changedFields = ['modifiedLegends'];
  assert.equal(summarizeProgress(input).complete, false);
});
