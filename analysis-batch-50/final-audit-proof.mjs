// Pure checks only. The private final runner supplies its saved documents;
// this module performs no I/O and never reads production or private files.
import { isDeepStrictEqual } from 'node:util';
import { USER_FIELDS, record, userSnapshot } from '../cloudflare/src/contracts.mjs';
import { PilotError, contentHash, sha256, sourceUserdata } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { COMPLETION_FIELDS, EXPECTED_TOTAL, validateManifest } from './import.mjs';

export const PROGRESS_FIELDS = Object.freeze(USER_FIELDS.filter(field => !['customLegends', 'modifiedLegends'].includes(field)));
export const FINAL_CHUNKS = Object.freeze(Array.from({ length: 10 }, (_, at) => `${String(at * 5 + 1).padStart(2, '0')}-${String(at * 5 + 5).padStart(2, '0')}`));
const bad = code => { throw new PilotError(code); };
const hashValue = (field, value) => field === 'stats' || typeof value !== 'string' ? contentHash(value) : sha256(value);
// The old three-person pilot's figureForInput rejects existing deepAnalysis;
// final audits must merge existing articles without any write-time guard.
function figureForAudit(document, base, id) {
  const matches = [...base, ...document.customLegends].filter(item => item.id === id);
  const modified = Object.hasOwn(document.modifiedLegends, id) ? document.modifiedLegends[id] : {};
  if (matches.length !== 1 || !record(modified)) bad('final_figure_missing_or_invalid');
  return { ...matches[0], ...modified, id };
}

export function verifyExternalTransition(fromValue, toValue, label) {
  const from = sourceUserdata(fromValue), to = sourceUserdata(toValue);
  if (to.revision < from.revision) bad('external_revision_regressed');
  const changedFields = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter(field => field !== 'revision' && !isDeepStrictEqual(from[field], to[field])).sort();
  if (changedFields.some(field => !PROGRESS_FIELDS.includes(field))) bad('external_non_progress_change');
  if (to.revision === from.revision && changedFields.length) bad('external_same_revision_document_changed');
  return { label, fromRevision: from.revision, toRevision: to.revision, fromSha256: contentHash(from), toSha256: contentHash(to),
    changedFields, externalRevisionAdvance: to.revision > from.revision,
    classification: to.revision === from.revision ? 'unchanged' : changedFields.length ? 'known-progress-fields-only' : 'revision-only' };
}

export function verifyTransitionChain({ baseline, steps, current }) {
  if (!Array.isArray(steps) || steps.length !== FINAL_CHUNKS.length || !isDeepStrictEqual(steps.map(step => step.chunk), FINAL_CHUNKS)) bad('final_chunk_chain_incomplete');
  const transitions = [];
  let previous = baseline;
  for (const [at, step] of steps.entries()) {
    const before = sourceUserdata(step.before), after = sourceUserdata(step.after);
    if (after.revision !== before.revision + 1) bad('chunk_cas_revision_not_contiguous');
    transitions.push(verifyExternalTransition(previous, before, at === 0 ? 'baseline-to-first-import' : `${steps[at - 1].chunk}-to-${step.chunk}`));
    previous = after;
  }
  transitions.push(verifyExternalTransition(previous, current, 'last-import-to-final-read'));
  return { transitions, externalChangesObserved: transitions.some(item => item.externalRevisionAdvance),
    chunkCasRevisionsContiguous: true, externalChangesClassified: true };
}

export function verifyFinalDocumentPreservation({ baseline: source, current: observed, base, manifest, expectedFields }) {
  validateManifest(manifest);
  const baseline = sourceUserdata(source), current = sourceUserdata(observed);
  const ids = document => [...base, ...document.customLegends].map(item => item.id).sort();
  const beforeIds = ids(baseline), afterIds = ids(current);
  if (beforeIds.length !== EXPECTED_TOTAL || afterIds.length !== EXPECTED_TOTAL || new Set(afterIds).size !== EXPECTED_TOTAL || !isDeepStrictEqual(beforeIds, afterIds)) bad('final_library_identity_changed');
  if (!Array.isArray(expectedFields) || expectedFields.length !== 200 || new Set(expectedFields.map(item => item.id + '/' + item.field)).size !== 200
    || manifest.records.some(item => COMPLETION_FIELDS.some(field => !expectedFields.some(value => value.id === item.id && value.field === field)))) bad('final_field_count_changed');
  for (const item of expectedFields) {
    const value = figureForAudit(current, base, item.id)[item.field];
    if (value === undefined || hashValue(item.field, value) !== item.sha256) bad('final_new_field_changed');
  }
  const preserved = [];
  for (const id of beforeIds) {
    const before = figureForAudit(baseline, base, id), after = figureForAudit(current, base, id);
    for (const field of ['analysis', 'deepAnalysis', 'soulEssence', 'stats', 'statsAnalysis', 'rank']) {
      const value = before[field];
      if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) continue;
      if (!isDeepStrictEqual(value, after[field])) bad('final_previous_content_changed');
      preserved.push({ id, field, sha256: hashValue(field, value) });
    }
  }
  const clean = structuredClone(current), original = structuredClone(baseline);
  for (const target of manifest.records) {
    const old = original.modifiedLegends[target.id] ?? {};
    if (!record(clean.modifiedLegends[target.id])) bad('final_target_modification_missing');
    for (const field of COMPLETION_FIELDS) {
      if (Object.hasOwn(old, field)) clean.modifiedLegends[target.id][field] = structuredClone(old[field]);
      else delete clean.modifiedLegends[target.id][field];
    }
    if (!Object.hasOwn(original.modifiedLegends, target.id) && !Object.keys(clean.modifiedLegends[target.id]).length) delete clean.modifiedLegends[target.id];
  }
  delete clean.revision; delete original.revision;
  const exactBaselinePreserved = isDeepStrictEqual(clean, original);
  const unrelatedFinalBaselineSha256 = contentHash(clean), unrelatedInitialBaselineSha256 = contentHash(original);
  const changedProgressFields = PROGRESS_FIELDS.filter(field => !isDeepStrictEqual(clean[field], original[field])).sort();
  for (const field of PROGRESS_FIELDS) { delete clean[field]; delete original[field]; }
  if (!isDeepStrictEqual(clean, original)) bad('final_non_progress_content_changed');
  return { library: { beforeTotal: EXPECTED_TOTAL, afterTotal: EXPECTED_TOTAL, idsBeforeSha256: contentHash(beforeIds), idsAfterSha256: contentHash(afterIds), idsPreserved: true },
    preservedExistingFieldHashes: preserved, preservedDeepHashes: preserved.filter(item => item.field === 'deepAnalysis'),
    exactBaselinePreserved, unrelatedFinalBaselineSha256, unrelatedInitialBaselineSha256, changedProgressFields,
    nonProgressBaselinePreserved: true, nonProgressInitialSha256: contentHash(original), nonProgressFinalSha256: contentHash(clean) };
}

export const rawExtrasHash = document => contentHash(document === null ? null : Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'revision' && !USER_FIELDS.includes(key))));
export function verifyRawReceipt(receipt, visible) {
  if (!record(receipt) || receipt.format !== 'dynasty-batch50-d1-raw-receipt' || receipt.schemaVersion !== 1 || receipt.collection !== 'userdata'
    || !record(receipt.observed?.document) || typeof receipt.observed.version !== 'string'
    || receipt.rawDocumentSha256 !== contentHash(receipt.observed.document)
    || receipt.visibleDocumentSha256 !== contentHash(userSnapshot(receipt.observed.document))
    || receipt.rawExtrasSha256 !== rawExtrasHash(receipt.observed.document)
    || !isDeepStrictEqual(userSnapshot(receipt.observed.document), sourceUserdata(visible))) bad('final_raw_receipt_not_bound');
  return true;
}

export function verifyRawChunk({ beforeReceipt, afterReceipt, before, after, patch }) {
  verifyRawReceipt(beforeReceipt, before); verifyRawReceipt(afterReceipt, after);
  const next = { ...structuredClone(beforeReceipt.observed.document), ...structuredClone(patch), revision: before.revision + 1 };
  const expectedRaw = contentHash(next), expectedExtras = rawExtrasHash(next);
  if (beforeReceipt.phase !== 'before' || afterReceipt.phase !== 'after' || afterReceipt.casSucceeded !== true
    || beforeReceipt.attempt !== afterReceipt.attempt || typeof beforeReceipt.attempt !== 'string'
    || beforeReceipt.expectedNextRawSha256 !== expectedRaw || afterReceipt.expectedNextRawSha256 !== expectedRaw
    || afterReceipt.rawDocumentSha256 !== expectedRaw || beforeReceipt.expectedNextRevision !== after.revision || afterReceipt.expectedNextRevision !== after.revision
    || beforeReceipt.expectedNextRawExtrasSha256 !== expectedExtras || afterReceipt.expectedNextRawExtrasSha256 !== expectedExtras
    || beforeReceipt.rawExtrasSha256 !== afterReceipt.rawExtrasSha256 || afterReceipt.rawExtrasSha256 !== expectedExtras) bad('final_raw_cas_not_preserved');
  return { rawBeforeReceiptSha256: contentHash(beforeReceipt), rawAfterReceiptSha256: contentHash(afterReceipt), rawExtrasSha256: expectedExtras };
}

export function verifyRawFinalRead({ steps, finalReceipt, current }) {
  verifyRawReceipt(finalReceipt, current);
  if (finalReceipt.phase !== 'read' || steps.length !== 10) bad('final_raw_read_required');
  const initialSha256 = steps[0].rawExtrasSha256;
  if (steps.some(step => step.rawExtrasSha256 !== initialSha256) || finalReceipt.rawExtrasSha256 !== initialSha256) bad('final_raw_extras_changed');
  return { scope: 'first-successful-import-observation-through-final-read', checkedChunks: steps.length,
    initialSha256, finalSha256: finalReceipt.rawExtrasSha256, finalReadReceiptSha256: contentHash(finalReceipt),
    finalReadRawDocumentSha256: finalReceipt.rawDocumentSha256, finalReadVisibleDocumentSha256: finalReceipt.visibleDocumentSha256, currentSnapshotBound: true };
}
