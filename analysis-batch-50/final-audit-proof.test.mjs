import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_DEFAULTS, userSnapshot } from '../cloudflare/src/contracts.mjs';
import { contentHash, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadFixedManifest, COMPLETION_FIELDS } from './import.mjs';
import { FINAL_CHUNKS, verifyTransitionChain, verifyFinalDocumentPreservation, verifyRawChunk, verifyRawFinalRead, rawExtrasHash } from './final-audit-proof.mjs';

const manifest = await loadFixedManifest();
function fixture(withProgress = false) {
  // Every new field and save here is synthetic. No generated historical prose
  // or actual private userdata is read by this test.
  const base = [...manifest.records.map(item => structuredClone(item.context)), ...Array.from({ length: 912 }, (_, at) => ({ id: `synthetic-${at}`, rank: 'synthetic-rank' }))];
  const baseline = { ...structuredClone(USER_DEFAULTS), revision: 4, futureLegacy: { unchanged: true } };
  baseline.modifiedLegends['synthetic-0'] = { analysis: 'synthetic existing article', stats: [1, 2, 3, 4, 5], rank: 'synthetic original rank' };
  for (const item of manifest.records) baseline.modifiedLegends[item.id] = { deepAnalysis: 'synthetic existing deep article' };
  const steps = [], expectedFields = [];
  let current = structuredClone(baseline);
  for (const [at, chunk] of FINAL_CHUNKS.entries()) {
    if (withProgress && at === 3) { current.soulSaves.push({ id: 'synthetic concurrent save' }); current.revision += 2; }
    const before = structuredClone(current);
    for (const item of manifest.records.slice(at * 5, at * 5 + 5)) for (const field of COMPLETION_FIELDS) {
      const value = field === 'stats' ? [11, 22, 33, 44, 55] : `synthetic ${field} ${item.id}`;
      current.modifiedLegends[item.id][field] = value;
      expectedFields.push({ id: item.id, field, sha256: field === 'stats' ? contentHash(value) : sha256(value) });
    }
    current.revision++;
    steps.push({ chunk, before, after: structuredClone(current) });
  }
  if (withProgress) { current.chatHistories.synthetic = [{ text: 'synthetic new chat' }]; current.revision++; }
  return { baseline, steps, current, base, manifest, expectedFields };
}

test('legitimate progress between chunks and after the last chunk is preserved and explicitly differs from baseline', () => {
  const plain = fixture(), clean = verifyFinalDocumentPreservation(plain);
  assert.equal(clean.exactBaselinePreserved, true); assert.equal(verifyTransitionChain(plain).externalChangesObserved, false);
  const withProgress = fixture(true), chain = verifyTransitionChain(withProgress), proof = verifyFinalDocumentPreservation(withProgress);
  assert.equal(chain.externalChangesObserved, true); assert.equal(chain.chunkCasRevisionsContiguous, true);
  assert.deepEqual(chain.transitions.filter(item => item.changedFields.length).map(item => item.changedFields), [['soulSaves'], ['chatHistories']]);
  assert.equal(proof.exactBaselinePreserved, false); assert.equal(proof.nonProgressBaselinePreserved, true);
  assert.deepEqual(proof.changedProgressFields, ['chatHistories', 'soulSaves']); assert.equal(withProgress.current.revision, 17);
  assert.equal(proof.library.afterTotal, 962); assert.equal(proof.preservedExistingFieldHashes.some(item => item.field === 'rank'), true);
});

test('external old-article, rank, unknown extra and identity changes are rejected rather than labelled player progress', () => {
  for (const mutate of [value => value.current.modifiedLegends['synthetic-0'].analysis = 'overwritten',
    value => value.current.modifiedLegends['synthetic-0'].rank = 'overwritten', value => value.current.futureLegacy.unchanged = false,
    value => value.current.customLegends.push({ id: 'unexpected' })]) {
    const value = fixture(true); mutate(value);
    assert.throws(() => verifyFinalDocumentPreservation(value)); assert.throws(() => verifyTransitionChain(value));
  }
  const brokenCas = fixture(); brokenCas.steps[0].after.revision++;
  assert.throws(() => verifyTransitionChain(brokenCas), error => error.code === 'chunk_cas_revision_not_contiguous');
  const sameRevision = fixture(); sameRevision.current.soulSaves.push({ id: 'unversioned' });
  assert.throws(() => verifyTransitionChain(sameRevision), error => error.code === 'external_same_revision_document_changed');
});

function rawReceipt(raw, phase, extra = {}) {
  return { format: 'dynasty-batch50-d1-raw-receipt', schemaVersion: 1, collection: 'userdata', phase,
    observed: { document: structuredClone(raw), version: 'synthetic-version' }, rawDocumentSha256: contentHash(raw),
    visibleDocumentSha256: contentHash(userSnapshot(raw)), rawExtrasSha256: rawExtrasHash(raw), ...extra };
}
test('raw extras require an actual final receipt bound to the same visible snapshot and reject changed envelopes', () => {
  const rawBefore = { ...structuredClone(USER_DEFAULTS), revision: 4, _id: 'synthetic-envelope', futureLegacy: { kept: true } };
  const patch = { revision: 4, modifiedLegends: { synthetic: { deepAnalysis: 'synthetic' } } };
  const rawAfter = { ...structuredClone(rawBefore), ...structuredClone(patch), revision: 5 };
  const details = { attempt: 'synthetic-cas', expectedNextRawSha256: contentHash(rawAfter), expectedNextRevision: 5, expectedNextRawExtrasSha256: rawExtrasHash(rawAfter) };
  const beforeReceipt = rawReceipt(rawBefore, 'before', details), afterReceipt = rawReceipt(rawAfter, 'after', { ...details, casSucceeded: true });
  const proof = verifyRawChunk({ beforeReceipt, afterReceipt, before: userSnapshot(rawBefore), after: userSnapshot(rawAfter), patch });
  const input = { steps: Array.from({ length: 10 }, () => proof), finalReceipt: rawReceipt(rawAfter, 'read'), current: userSnapshot(rawAfter) };
  assert.equal(verifyRawFinalRead(input).currentSnapshotBound, true);
  assert.throws(() => verifyRawFinalRead({ ...input, finalReceipt: null }));
  const changedRaw = { ...rawAfter, _id: 'changed-envelope' };
  assert.throws(() => verifyRawFinalRead({ ...input, finalReceipt: rawReceipt(changedRaw, 'read') }), error => error.code === 'final_raw_extras_changed');
  const alteredVisible = structuredClone(input.current); alteredVisible.soulSaves.push({ id: 'later read' });
  assert.throws(() => verifyRawFinalRead({ ...input, current: alteredVisible }), error => error.code === 'final_raw_receipt_not_bound');
});
