// Public, file-backed progress audit. This module never reads backups, secrets,
// private userdata, browser state or credentials and never writes production.
import { lstat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse, record, validRevision } from '../cloudflare/src/contracts.mjs';
import { PilotError, sha256, contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadFixedManifest, validateManifest, validateChunk, COMPLETION_FIELDS, EXPECTED_TOTAL } from './import.mjs';
import { TASKS, validateRequest, captureExport, readRegularText } from './capture.mjs';
import { verifyOriginalPromptBinding, recheckOriginalPromptMaterials } from './prompt-bindings.mjs';
import { assembleResults, validateSourceReview } from './assemble.mjs';
import { PROGRESS_FIELDS, FINAL_CHUNKS } from './final-audit-proof.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const bad = code => { throw new PilotError(code); };
const hashOk = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const errorCode = error => error instanceof PilotError ? error.code : error.code === 'ENOENT' ? 'not_yet_present' : 'public_evidence_invalid';
export const CHUNKS = FINAL_CHUNKS;
const expectedHashes = batch => batch.records.flatMap(item => COMPLETION_FIELDS.map(field => ({ id: item.id, field, sha256: field === 'stats' ? contentHash(item.fields[field]) : sha256(item.fields[field]) })));
const sortedHashes = values => values.map(value => ({ id: value.id, field: value.field, sha256: value.sha256 })).sort((one, two) => (one.id + '\0' + one.field).localeCompare(two.id + '\0' + two.field));

function validateHashList(actual, expected) {
  if (!Array.isArray(actual) || actual.some(item => !record(item) || !isDeepStrictEqual(Object.keys(item).sort(), ['field', 'id', 'sha256']) || !hashOk(item.sha256))
    || !isDeepStrictEqual(sortedHashes(actual), sortedHashes(expected))) bad('written_field_hashes_mismatch');
}

function validateReceiptHeader(value, mode, batch, manifest) {
  validateChunk(batch, manifest);
  if (!record(value) || value.format !== 'dynasty-analysis-batch50-import' || value.schemaVersion !== 1 || value.mode !== mode || value.passed !== true
      || value.status !== (mode === 'apply' ? 'applied_verified' : 'planned') || value.authorizedTargetCount !== 50
      || value.targetCount !== batch.records.length || value.changedFields !== batch.records.length * 4 || value.provenanceFieldsWritten !== 0
      || value.manifestSha256 !== contentHash(manifest) || value.batchSha256 !== contentHash(batch)
      || value.sourceSha256 !== manifest.sourceSha256 || value.baseLibrarySha256 !== manifest.baseLibrarySha256
      || !validRevision(value.beforeRevision) || value.beforeRevision < manifest.baselineRevision
      || value.plannedAfterRevision !== value.beforeRevision + 1 || !hashOk(value.beforeSha256) || !hashOk(value.plannedAfterSha256)) bad('import_receipt_missing_or_stale');
  validateHashList(value.writtenFieldHashes, expectedHashes(batch));
  return true;
}

export function validateImportReceipt({ receipt, dryRun, batch, manifest }) {
  validateReceiptHeader(dryRun, 'dry-run', batch, manifest);
  validateReceiptHeader(receipt, 'apply', batch, manifest);
  const proof = receipt.verification;
  if (receipt.writeAttempted !== true || receipt.writeSucceeded !== true || !Number.isSafeInteger(receipt.conflicts) || receipt.conflicts < 0 || receipt.conflicts > 3
    || !record(proof) || proof.passed !== true || proof.targetsMatch !== true || proof.contentPreserved !== true || proof.revisionMatches !== true
    || proof.afterRevision !== receipt.plannedAfterRevision || proof.afterSha256 !== receipt.plannedAfterSha256
    || !hashOk(proof.unaffectedBeforeSha256) || proof.unaffectedBeforeSha256 !== proof.unaffectedAfterSha256) bad('import_preservation_not_verified');
  return true;
}

export function validateFinalAudit({ audit, manifest, fieldHashes, latestImportRevision, latestImportSha256, imports }) {
  validateManifest(manifest);
  if (!record(audit) || audit.format !== 'dynasty-batch50-final-audit' || audit.schemaVersion !== 1 || audit.passed !== true
    || audit.manifestSha256 !== contentHash(manifest) || !validRevision(audit.revision) || audit.revision < latestImportRevision
    || !hashOk(audit.documentSha256) || (audit.revision === latestImportRevision && audit.documentSha256 !== latestImportSha256)) bad('final_document_audit_missing_or_stale');
  const library = audit.library;
  if (!record(library) || library.beforeTotal !== EXPECTED_TOTAL || library.afterTotal !== EXPECTED_TOTAL || library.idsPreserved !== true
    || !hashOk(library.idsBeforeSha256) || library.idsBeforeSha256 !== library.idsAfterSha256) bad('final_library_identity_not_verified');
  if (fieldHashes.length !== 200 || new Set(fieldHashes.map(item => item.id)).size !== 50) bad('all_fifty_imports_required');
  validateHashList(audit.writtenFieldHashes, fieldHashes);
  if (audit.actualProductionRead !== true || audit.privateDataIncluded !== false || audit.previousPilotPreserved !== true
    || audit.allChunkUnrelatedContentPreserved !== true || audit.chunkCasRevisionsContiguous !== true || audit.externalChangesClassified !== true
    || audit.nonProgressBaselinePreserved !== true || audit.rawExtrasPreserved !== true || typeof audit.exactBaselinePreserved !== 'boolean'
    || typeof audit.externalChangesObserved !== 'boolean' || !hashOk(audit.nonProgressInitialSha256) || audit.nonProgressInitialSha256 !== audit.nonProgressFinalSha256
    || !hashOk(audit.unrelatedInitialBaselineSha256) || !hashOk(audit.unrelatedFinalBaselineSha256)
    || audit.exactBaselinePreserved !== (audit.unrelatedInitialBaselineSha256 === audit.unrelatedFinalBaselineSha256)) bad('final_preservation_proof_missing');
  if (!Array.isArray(audit.changedProgressFields) || !isDeepStrictEqual(audit.changedProgressFields, [...new Set(audit.changedProgressFields)].sort())
    || audit.changedProgressFields.some(field => !PROGRESS_FIELDS.includes(field))
    || audit.exactBaselinePreserved !== (audit.changedProgressFields.length === 0)) bad('final_progress_changes_not_classified');
  if (!Array.isArray(audit.imports) || !isDeepStrictEqual(audit.imports.map(item => item.chunk), CHUNKS)
    || !Array.isArray(imports) || imports.length !== CHUNKS.length) bad('final_import_chain_missing');
  for (const [at, item] of audit.imports.entries()) {
    const expected = imports[at];
    if (!record(item) || !record(expected) || (expected.chunk ?? expected.range) !== item.chunk || item.snapshotVerificationPassed !== true
      || !validRevision(item.beforeRevision) || item.beforeRevision < manifest.baselineRevision || item.afterRevision !== item.beforeRevision + 1
      || at > 0 && item.beforeRevision < audit.imports[at - 1].afterRevision
      || ['batchSha256', 'receiptSha256', 'beforeSha256', 'afterSha256', 'rawBeforeReceiptSha256', 'rawAfterReceiptSha256', 'rawExtrasSha256'].some(field => !hashOk(item[field]))
      || ['batchSha256', 'receiptSha256', 'beforeRevision', 'afterRevision', 'beforeSha256', 'afterSha256'].some(field => item[field] !== expected[field])) bad('final_import_chain_not_bound');
  }
  const last = audit.imports.at(-1);
  if (last.afterRevision !== latestImportRevision || last.afterSha256 !== latestImportSha256) bad('final_latest_import_not_bound');
  const transitions = audit.externalTransitions;
  if (!Array.isArray(transitions) || transitions.length !== CHUNKS.length + 1) bad('final_external_transitions_missing');
  for (const [at, transition] of transitions.entries()) {
    const fromRevision = at === 0 ? manifest.baselineRevision : audit.imports[at - 1].afterRevision;
    const fromSha256 = at === 0 ? manifest.sourceSha256 : audit.imports[at - 1].afterSha256;
    const toRevision = at === CHUNKS.length ? audit.revision : audit.imports[at].beforeRevision;
    const toSha256 = at === CHUNKS.length ? audit.documentSha256 : audit.imports[at].beforeSha256;
    const label = at === 0 ? 'baseline-to-first-import' : at === CHUNKS.length ? 'last-import-to-final-read' : `${CHUNKS[at - 1]}-to-${CHUNKS[at]}`;
    if (!record(transition) || transition.label !== label || transition.fromRevision !== fromRevision || transition.toRevision !== toRevision
      || transition.fromSha256 !== fromSha256 || transition.toSha256 !== toSha256 || toRevision < fromRevision
      || transition.externalRevisionAdvance !== (toRevision > fromRevision) || !Array.isArray(transition.changedFields)
      || !isDeepStrictEqual(transition.changedFields, [...new Set(transition.changedFields)].sort())
      || transition.changedFields.some(field => !PROGRESS_FIELDS.includes(field))
      || toRevision === fromRevision && (fromSha256 !== toSha256 || transition.changedFields.length !== 0)
      || transition.classification !== (toRevision === fromRevision ? 'unchanged' : transition.changedFields.length ? 'known-progress-fields-only' : 'revision-only')) bad('final_external_transition_not_bound');
  }
  if (audit.externalChangesObserved !== transitions.some(item => item.externalRevisionAdvance)
    || audit.changedProgressFields.some(field => !transitions.some(item => item.changedFields.includes(field)))) bad('final_external_changes_not_reported');
  const raw = audit.rawExtrasVerification;
  if (!record(raw) || raw.scope !== 'first-successful-import-observation-through-final-read' || raw.checkedChunks !== CHUNKS.length || raw.currentSnapshotBound !== true
    || ['initialSha256', 'finalSha256', 'finalReadReceiptSha256', 'finalReadRawDocumentSha256', 'finalReadVisibleDocumentSha256'].some(field => !hashOk(raw[field]))
    || raw.initialSha256 !== raw.finalSha256 || raw.finalReadVisibleDocumentSha256 !== audit.documentSha256
    || audit.imports.some(item => item.rawExtrasSha256 !== raw.initialSha256)) bad('final_raw_extras_not_verified');
  const preserved = audit.preservedExistingFieldHashes;
  if (!Array.isArray(preserved) || preserved.some(item => !record(item) || !isDeepStrictEqual(Object.keys(item).sort(), ['field', 'id', 'sha256'])
    || !['analysis', 'deepAnalysis', 'soulEssence', 'stats', 'statsAnalysis', 'rank'].includes(item.field) || !hashOk(item.sha256))
    || new Set(preserved.map(item => item.id + '/' + item.field)).size !== preserved.length
    || manifest.records.some(target => !preserved.some(item => item.id === target.id && item.field === 'deepAnalysis' && item.sha256 === target.preserved.deepAnalysis.sha256))) bad('final_previous_content_not_verified');
  validateHashList(audit.preservedDeepHashes, preserved.filter(item => item.field === 'deepAnalysis'));
  return true;
}

export function summarizeProgress({ manifest, records, chunks, finalAudit = null, errors = [], generatedAt = new Date().toISOString() }) {
  validateManifest(manifest);
  if (!Array.isArray(records) || records.length !== 50 || !isDeepStrictEqual(records.map(item => item.id), manifest.records.map(item => item.id))) bad('progress_identity_changed');
  if (!Array.isArray(chunks) || !isDeepStrictEqual(chunks.map(chunk => chunk.range), CHUNKS)) bad('progress_chunk_identity_changed');
  for (const item of records) {
    if (!record(item.fields) || !isDeepStrictEqual(Object.keys(item.fields).sort(), [...COMPLETION_FIELDS].sort())
      || !record(item.perTask) || !isDeepStrictEqual(Object.keys(item.perTask).sort(), [...TASKS].sort())) bad('progress_field_scope_changed');
    for (const stage of ['prepared', 'generated', 'sourceQA']) {
      if (typeof item[stage] !== 'boolean' || item[stage] !== TASKS.every(task => item.perTask[task][stage] === true)) bad('progress_task_status_mismatch');
    }
    if (item.assembled && !item.sourceQA || item.imported && !item.assembled) bad('progress_stage_order_mismatch');
    for (const field of COMPLETION_FIELDS) {
      const task = field === 'soulEssence' ? 'soulEssence' : 'analysisStats', value = item.fields[field];
      if (!record(value) || value.generated !== item.perTask[task].generated || value.sourceQA !== item.perTask[task].sourceQA
        || value.assembled !== item.assembled || value.imported !== item.imported
        || (value.generated ? !hashOk(value.sha256) : value.sha256 !== null)) bad('progress_field_status_mismatch');
    }
  }
  const counts = Object.fromEntries(['prepared', 'generated', 'sourceQA', 'assembled', 'imported'].map(stage => [stage, records.filter(item => item[stage] === true).length]));
  const importedFieldHashes = records.flatMap(item => item.imported ? COMPLETION_FIELDS.map(field => ({ id: item.id, field, sha256: item.fields[field].sha256 })) : []);
  const imports = chunks.filter(chunk => chunk.imported);
  const latest = imports.reduce((value, chunk) => !value || chunk.afterRevision > value.afterRevision ? chunk : value, null);
  let finalAuditVerified = false;
  if (finalAudit) {
    try {
      if (!latest) bad('all_fifty_imports_required');
      validateFinalAudit({ audit: finalAudit, manifest, fieldHashes: importedFieldHashes, latestImportRevision: latest.afterRevision, latestImportSha256: latest.afterSha256, imports });
      finalAuditVerified = true;
    } catch (error) { errors.push({ file: 'analysis-batch-50/final-audit.v1.json', code: errorCode(error) }); }
  }
  const complete = ['prepared', 'generated', 'sourceQA', 'assembled', 'imported'].every(stage => counts[stage] === 50)
    && importedFieldHashes.length === 200 && imports.length === 10 && finalAuditVerified && !errors.length;
  return {
    format: 'dynasty-batch50-progress', schemaVersion: 1, generatedAt, manifestSha256: contentHash(manifest),
    complete, status: complete ? 'complete_verified' : 'in_progress', passed: !errors.length,
    targetCount: 50, completionFields: [...COMPLETION_FIELDS], counts: { ...counts, importedFields: importedFieldHashes.length },
    finalAuditVerified, libraryPreserved: finalAuditVerified, libraryTotal: finalAuditVerified ? EXPECTED_TOTAL : null,
    finalAuditFile: finalAudit ? 'analysis-batch-50/final-audit.v1.json' : null, finalAuditSha256: finalAudit ? contentHash(finalAudit) : null,
    records, chunks, errors, privateFilesRead: false,
  };
}

async function exists(path) {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) bad('input_must_be_regular_file'); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const readJson = async path => strictJsonParse(await readRegularText(path));

async function preparedInputs(manifest, target) {
  const request = await readJson(resolve(here, 'tasks', `${target.slug}.json`));
  validateRequest(manifest, request);
  const sourcePackage = await readRegularText(resolve(repo, target.sourcesPath));
  const deepAnalysis = await readRegularText(resolve(repo, target.preserved.deepAnalysis.path));
  const statsReference = await readRegularText(resolve(here, 'stats-reference.v1.json'));
  if (sha256(sourcePackage) !== request.sourceSha256 || sha256(deepAnalysis) !== request.preservedDeepSha256
    || sha256(statsReference) !== request.tasks.analysisStats.referenceSha256) bad('prepared_material_changed');
  const prompts = {};
  for (const task of TASKS) {
    prompts[task] = await readRegularText(resolve(repo, request.tasks[task].promptFile));
    verifyOriginalPromptBinding({ target, request, task, prompt: prompts[task], deepAnalysis, sourcePackage });
  }
  return { request, sourcePackage, deepAnalysis, statsReference, prompts };
}

async function observeTask(manifest, target, prepared, task, taskStatus) {
  const capturePath = resolve(here, 'drafts', `${target.slug}.${task}.capture.json`);
  if (!await exists(capturePath)) return null;
  const capture = await readJson(capturePath);
  const input = { manifest, request: prepared.request, task, prompt: prepared.prompts[task], sourcePackage: prepared.sourcePackage,
    deepAnalysis: prepared.deepAnalysis, statsReference: prepared.statsReference,
    analysisContext: task === 'soulEssence' ? await readRegularText(resolve(here, 'drafts', `${target.slug}.analysis.md`)) : null,
    raw: await readRegularText(resolve(here, 'drafts', `${target.slug}.${task}.raw.md`)),
    evidenceText: await readRegularText(resolve(here, 'drafts', `${target.slug}.${task}.search-evidence.txt`)),
    conversationUrl: capture.conversationUrl, generatedAt: capture.generatedAt,
  };
  const actual = captureExport(input), response = await readRegularText(resolve(here, 'drafts', `${target.slug}.${task}.response.md`));
  if (!isDeepStrictEqual(capture, actual.capture) || response !== actual.text) bad('capture_missing_or_stale');
  const fieldsFiles = {};
  for (const [field, value] of Object.entries(actual.fields)) {
    fieldsFiles[field] = await readRegularText(resolve(here, 'drafts', `${target.slug}.${field}.${field === 'stats' ? 'json' : 'md'}`));
    if (fieldsFiles[field] !== (field === 'stats' ? JSON.stringify(value) + '\n' : value + '\n')) bad('split_field_changed');
  }
  Object.assign(taskStatus, { generated: true, rawResponseSha256: capture.rawResponseSha256, responseSha256: capture.responseSha256,
    fieldsHashes: capture.fieldsHashes, actualSearchCount: capture.webSearchEvidence.visibleSearchCount });
  const reviewPath = resolve(here, 'reviews', `${target.slug}.${task}.json`);
  let review = null;
  if (await exists(reviewPath)) {
    review = await readJson(reviewPath);
    validateSourceReview(review, capture, actual.fields); taskStatus.sourceQA = true; taskStatus.sourceReviewSha256 = contentHash(review);
  }
  return { ...input, capture, response, fieldsFiles, review };
}

export async function auditProgress() {
  await recheckOriginalPromptMaterials();
  const manifest = await loadFixedManifest(), records = [], errors = [], people = new Map();
  for (const target of manifest.records) {
    const item = { id: target.id, slug: target.slug, name: target.context.name, type: target.context.type,
      prepared: false, generated: false, sourceQA: false, assembled: false, imported: false,
      fields: Object.fromEntries(COMPLETION_FIELDS.map(field => [field, { generated: false, sourceQA: false, assembled: false, imported: false, sha256: null }])),
      perTask: Object.fromEntries(TASKS.map(task => [task, { prepared: false, generated: false, sourceQA: false }])), issues: [] };
    records.push(item);
    let prepared;
    try { prepared = await preparedInputs(manifest, target); item.prepared = true; for (const task of TASKS) item.perTask[task].prepared = true; }
    catch (error) { const code = errorCode(error); item.issues.push({ stage: 'prepared', code }); if (code !== 'not_yet_present') errors.push({ id: target.id, stage: 'prepared', code }); continue; }
    const tasks = {};
    for (const task of TASKS) {
      try { const observed = await observeTask(manifest, target, prepared, task, item.perTask[task]); if (observed) tasks[task] = observed; }
      catch (error) { const code = errorCode(error); item.issues.push({ stage: task, code }); errors.push({ id: target.id, stage: task, code }); }
      for (const [field, hash] of Object.entries(item.perTask[task].fieldsHashes || {})) {
        Object.assign(item.fields[field], { generated: item.perTask[task].generated, sourceQA: item.perTask[task].sourceQA, sha256: hash });
      }
    }
    item.generated = TASKS.every(task => item.perTask[task].generated);
    item.sourceQA = TASKS.every(task => item.perTask[task].sourceQA);
    if (item.sourceQA) people.set(target.id, { request: prepared.request, tasks });
  }
  const chunks = [];
  for (const range of CHUNKS) {
    const files = { results: `results.${range}.v1.json`, dryRun: `import.${range}.dry-run.json`, apply: `import.${range}.apply.json` };
    const summary = { range, assembled: false, dryRunVerified: false, imported: false, targetCount: 0, resultsFile: `analysis-batch-50/${files.results}`,
      dryRunFile: `analysis-batch-50/${files.dryRun}`, applyFile: `analysis-batch-50/${files.apply}` };
    chunks.push(summary);
    try {
      if (!await exists(resolve(here, files.results))) {
        if (await exists(resolve(here, files.apply)) || await exists(resolve(here, files.dryRun))) bad('import_receipt_without_results');
        continue;
      }
      const batch = await readJson(resolve(here, files.results)); validateChunk(batch, manifest);
      const [start, end] = range.split('-').map(Number), allowed = new Set(manifest.records.slice(start - 1, end).map(item => item.id));
      if (batch.records.some(item => !allowed.has(item.id))) bad('chunk_range_identity_mismatch');
      if (batch.records.some(item => !people.has(item.id))) bad('chunk_actual_captures_or_qa_missing');
      const rebuilt = assembleResults({ manifest, people: batch.records.map(item => people.get(item.id)) });
      if (contentHash(rebuilt) !== contentHash(batch)) bad('chunk_evidence_changed');
      Object.assign(summary, { assembled: true, targetCount: batch.records.length, batchSha256: contentHash(batch) });
      for (const result of batch.records) {
        const item = records.find(value => value.id === result.id); item.assembled = true; item.chunkRange = range;
        for (const field of COMPLETION_FIELDS) item.fields[field].assembled = true;
      }
      let dryRun = null;
      if (await exists(resolve(here, files.dryRun))) {
        dryRun = await readJson(resolve(here, files.dryRun)); validateReceiptHeader(dryRun, 'dry-run', batch, manifest);
        summary.dryRunVerified = true; summary.dryRunSha256 = contentHash(dryRun);
      }
      if (!await exists(resolve(here, files.apply))) continue;
      if (!dryRun) bad('applied_import_without_dry_run');
      const receipt = await readJson(resolve(here, files.apply));
      validateImportReceipt({ receipt, dryRun, batch, manifest });
      Object.assign(summary, { imported: true, beforeRevision: receipt.beforeRevision, beforeSha256: receipt.beforeSha256,
        afterRevision: receipt.verification.afterRevision, afterSha256: receipt.verification.afterSha256,
        contentPreserved: true, receiptSha256: contentHash(receipt), dryRunSha256: contentHash(dryRun), changedFields: receipt.changedFields });
      for (const result of batch.records) {
        const item = records.find(value => value.id === result.id); item.imported = true; item.importRevision = summary.afterRevision;
        for (const field of COMPLETION_FIELDS) item.fields[field].imported = true;
      }
    } catch (error) { errors.push({ chunk: range, code: errorCode(error) }); }
  }
  let finalAudit = null;
  try { if (await exists(resolve(here, 'final-audit.v1.json'))) finalAudit = await readJson(resolve(here, 'final-audit.v1.json')); }
  catch (error) { errors.push({ file: 'analysis-batch-50/final-audit.v1.json', code: errorCode(error) }); }
  return summarizeProgress({ manifest, records, chunks, finalAudit, errors });
}

export async function main(values = process.argv.slice(2)) {
  try {
    if (values.length !== 0 && !(values.length === 2 && values[0] === '--output' && values[1] && !values[1].startsWith('--'))) bad('usage_output_only');
    // Output stays in the public batch root. Existing progress may be refreshed
    // intentionally; raw captures, receipts and other evidence are immutable.
    const output = values.length ? resolve(values[1]) : resolve(here, 'progress.v1.json');
    if (dirname(output) !== here || !/^(?:progress(?:[.\w-]*)?)\.json$/.test(output.slice(here.length + 1))) bad('output_must_be_public_progress_file');
    try { const info = await lstat(output); if (!info.isFile() || info.isSymbolicLink()) bad('output_must_be_regular_file'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const progress = await auditProgress();
    await writeFile(output, JSON.stringify(progress, null, 2) + '\n');
    console.log(JSON.stringify({ status: progress.status, passed: progress.passed, complete: progress.complete, counts: progress.counts, libraryPreserved: progress.libraryPreserved }));
    return progress.passed ? 0 : 1;
  } catch (error) { console.error(JSON.stringify({ status: errorCode(error), passed: false, complete: false })); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
