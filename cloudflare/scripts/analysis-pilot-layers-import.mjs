// Phase 2 for the same three-person pilot. Only missing normal analysis and
// soulEssence may be added. Existing deep analysis, ratings and stats stay exact.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { record, validRevision, strictJsonParse } from '../src/contracts.mjs';
import { MAX_DOCUMENT_BYTES } from '../src/d1-store.mjs';
import { loadBaseLibrary } from './audit-counts.mjs';
import { PilotError, sourceUserdata, contentHash, sha256, parseArguments, validateOrigin, productionAdapter } from './analysis-pilot-import.mjs';

export const AUTHORIZED_LAYERS = Object.freeze({
  'emperor_北魏孝文帝_33257620': Object.freeze(['analysis', 'soulEssence']),
  'general_王翦_306401394': Object.freeze(['soulEssence']),
  'minister_姚崇_2003901767': Object.freeze(['analysis', 'soulEssence']),
});
const TARGET_IDS = Object.keys(AUTHORIZED_LAYERS);
const own = (value, key) => Object.hasOwn(value, key);
const bad = code => { throw new PilotError(code); };
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const absent = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());
const sameKeys = (one, two) => isDeepStrictEqual([...one].sort(), [...two].sort());

export function layerFigureInput(document, base, id) {
  if (!own(AUTHORIZED_LAYERS, id)) bad('unauthorized_target');
  if (!Array.isArray(base) || base.some(item => !record(item) || typeof item.id !== 'string') || new Set(base.map(item => item.id)).size !== base.length) bad('invalid_base_library');
  const value = sourceUserdata(document);
  const matches = [...base, ...value.customLegends].filter(item => item.id === id);
  if (matches.length !== 1) bad('target_missing_or_duplicate');
  const modification = own(value.modifiedLegends, id) ? value.modifiedLegends[id] : {};
  if (!record(modification)) bad('invalid_target_modification');
  const figure = { ...matches[0], ...modification, id };
  if (typeof figure.deepAnalysis !== 'string' || !figure.deepAnalysis.trim()) bad('deep_analysis_required');
  delete figure.isModified;
  return figure;
}
export function layerInputSha256(document, base, id) { return contentHash(layerFigureInput(document, base, id)); }
function validateProvenance(value) {
  if (!record(value) || value.provider !== 'ChatGPT web' || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt)) || !Array.isArray(value.checkedSources) || !value.checkedSources.length) bad('invalid_provenance');
  let conversation; try { conversation = new URL(value.conversationUrl); } catch { bad('invalid_provenance'); }
  if (conversation.protocol !== 'https:' || conversation.hostname !== 'chatgpt.com' || !/^\/(?:g\/[^/]+\/)?c\/[a-zA-Z0-9-]+$/.test(conversation.pathname) || conversation.username || conversation.password || conversation.search || conversation.hash) bad('invalid_provenance');
  for (const source of value.checkedSources) {
    if (!record(source) || typeof source.title !== 'string' || !source.title.trim() || typeof source.locator !== 'string' || !source.locator.trim()) bad('invalid_provenance');
    let url; try { url = new URL(source.url); } catch { bad('invalid_provenance'); }
    if (url.protocol !== 'https:' || url.username || url.password) bad('invalid_provenance');
  }
}
export function validateLayerBatch(batch) {
  if (!record(batch) || batch.format !== 'dynasty-analysis-pilot-layer-results' || batch.schemaVersion !== 1 || !Array.isArray(batch.records) || batch.records.length !== TARGET_IDS.length) bad('invalid_layer_batch');
  const ids = new Set();
  for (const item of batch.records) {
    if (!record(item) || !own(AUTHORIZED_LAYERS, item.id) || ids.has(item.id) || !validHash(item.inputSha256) || !validHash(item.promptSha256) || !record(item.fields)) bad('invalid_layer_record');
    // Refuse extras such as rank/stats/deepAnalysis even if input text asks.
    if (Object.keys(item.fields).some(field => !AUTHORIZED_LAYERS[item.id].includes(field))) bad('unauthorized_field');
    for (const prose of Object.values(item.fields)) if (typeof prose !== 'string' || prose.trim().length < 300 || prose.includes('\0')) bad('incomplete_layer');
    validateProvenance(item.provenance); ids.add(item.id);
  }
  if (!sameKeys(ids, TARGET_IDS)) bad('unauthorized_target');
  return batch;
}
export function planLayerImport(source, latest, base, batch) {
  validateLayerBatch(batch);
  const baseline = sourceUserdata(source), before = sourceUserdata(latest), modifications = structuredClone(before.modifiedLegends);
  let changedFields = 0;
  for (const item of batch.records) {
    const original = layerFigureInput(baseline, base, item.id), live = layerFigureInput(before, base, item.id);
    const missing = AUTHORIZED_LAYERS[item.id].filter(field => absent(original[field]));
    if (!sameKeys(Object.keys(item.fields), missing)) bad('batch_must_match_missing_layers');
    if (contentHash(original) !== item.inputSha256) bad('source_input_hash_mismatch');
    for (const field of Object.keys(item.fields)) if (!absent(live[field])) bad('existing_layer');
    if (contentHash(live) !== item.inputSha256) bad('live_input_changed');
    if (missing.length) Object.defineProperty(modifications, item.id, { value: { ...(own(modifications, item.id) ? modifications[item.id] : {}), ...item.fields }, writable: true, enumerable: true, configurable: true });
    changedFields += missing.length;
  }
  if (!changedFields) bad('no_missing_layers');
  const patch = { revision: before.revision, modifiedLegends: modifications };
  const after = { ...structuredClone(before), modifiedLegends: modifications, revision: before.revision + 1 };
  if (!validRevision(after.revision)) bad('revision_exhausted');
  if (bytes(patch) > MAX_DOCUMENT_BYTES || bytes(after) > MAX_DOCUMENT_BYTES) bad('userdata_size_limit');
  return { before, patch, after, report: {
    format: 'dynasty-analysis-pilot-layer-import', schemaVersion: 1, mode: 'dry-run', status: 'planned', passed: true,
    targetCount: TARGET_IDS.length, changedFields, provenanceFieldsWritten: 0, batchSha256: contentHash(batch), sourceSha256: contentHash(baseline), baseLibrarySha256: contentHash(base),
    beforeSha256: contentHash(before), plannedAfterSha256: contentHash(after), beforeRevision: before.revision, plannedAfterRevision: after.revision, patchBytes: bytes(patch), plannedDocumentBytes: bytes(after),
    inputHashes: batch.records.map(item => item.inputSha256), writtenLayerHashes: batch.records.flatMap(item => Object.entries(item.fields).map(([field, prose]) => ({ field, sha256: sha256(prose) }))),
  } };
}
export function verifyLayerWrite(plan, observed, batch) {
  const after = sourceUserdata(observed), clean = structuredClone(after), baseline = structuredClone(plan.before);
  delete clean.revision; delete baseline.revision;
  let targetsMatch = true;
  for (const item of batch.records) {
    const original = own(plan.before.modifiedLegends, item.id) ? plan.before.modifiedLegends[item.id] : null;
    const current = clean.modifiedLegends[item.id];
    if (Object.keys(item.fields).length && !record(current)) bad('verification_target_missing');
    for (const [field, prose] of Object.entries(item.fields)) {
      targetsMatch &&= current[field] === prose;
      if (original && own(original, field)) current[field] = original[field]; else delete current[field];
    }
    if (!original && current && !Object.keys(current).length) delete clean.modifiedLegends[item.id];
  }
  const contentPreserved = isDeepStrictEqual(clean, baseline), revisionMatches = after.revision === plan.after.revision;
  return { passed: targetsMatch && contentPreserved && revisionMatches && isDeepStrictEqual(after, plan.after), targetsMatch, contentPreserved, revisionMatches, afterRevision: after.revision, afterSha256: contentHash(after), unaffectedBeforeSha256: contentHash(baseline), unaffectedAfterSha256: contentHash(clean) };
}
function approvalMatches(report, source, base, batch) {
  return record(report) && report.format === 'dynasty-analysis-pilot-layer-import' && report.mode === 'dry-run' && report.status === 'planned' && report.passed === true
    && report.batchSha256 === contentHash(batch) && report.sourceSha256 === contentHash(sourceUserdata(source)) && report.baseLibrarySha256 === contentHash(base);
}
export async function runLayerImport({ source, base, batch, request, apply = false, approvedReport = null, saveSnapshot = null }) {
  planLayerImport(source, source, base, batch);
  if (apply && !approvalMatches(approvedReport, source, base, batch)) bad('dry_run_approval_required');
  if (apply && typeof saveSnapshot !== 'function') bad('backup_required');
  let conflicts = 0;
  for (;;) {
    let current; try { current = await request('GET'); } catch { bad('userdata_read_failed'); }
    if (current.status !== 200) bad('userdata_read_failed');
    const plan = planLayerImport(source, current.body, base, batch);
    if (!apply) return plan.report;
    const report = { ...plan.report, mode: 'apply', status: 'pending', passed: false, conflicts, writeAttempted: false, writeSucceeded: false };
    try { await saveSnapshot(`before-attempt-${conflicts + 1}`, plan.before); } catch { throw new PilotError('pre_write_backup_failed', report); }
    report.writeAttempted = true; report.writeSucceeded = null;
    let response; try { response = await request('POST', plan.patch); } catch { throw new PilotError('write_outcome_unknown', report); }
    if (response.status === 409) { report.writeSucceeded = false; if (conflicts >= 3) throw new PilotError('conflict_retry_limit', report); conflicts++; continue; }
    if (response.status !== 200) { if ([400, 401, 403, 404, 405, 413, 422, 429].includes(response.status)) report.writeSucceeded = false; throw new PilotError('userdata_write_failed', report); }
    if (response.body?.status !== 'ok' || response.body?.revision !== plan.after.revision) throw new PilotError('write_acknowledgement_invalid', report);
    report.writeSucceeded = true;
    let readback; try { readback = await request('GET'); } catch { throw new PilotError('post_write_read_failed', report); }
    if (readback.status !== 200) throw new PilotError('post_write_read_failed', report);
    try { await saveSnapshot('after-write', readback.body); } catch { throw new PilotError('post_write_backup_failed', report); }
    let verification; try { verification = verifyLayerWrite(plan, readback.body, batch); } catch { throw new PilotError('post_write_verification_failed', report); }
    return { ...report, verification, passed: verification.passed, status: verification.passed ? 'applied_verified' : 'applied_verification_failed' };
  }
}
export async function main(values = process.argv.slice(2)) {
  let output = null, report = null;
  try {
    const args = parseArguments(values), origin = validateOrigin(args.origin); output = resolve(args.outputFile);
    try { await stat(output); bad('output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dirname(output), { recursive: true });
    const source = strictJsonParse(await readFile(resolve(args.sourceFile), 'utf8')), batch = strictJsonParse(await readFile(resolve(args.resultsFile), 'utf8'));
    const { base } = await loadBaseLibrary(); planLayerImport(source, source, base, batch);
    const approvedReport = args.apply ? strictJsonParse(await readFile(resolve(args.approvedReportFile), 'utf8')) : null;
    if (args.apply && !approvalMatches(approvedReport, source, base, batch)) bad('dry_run_approval_required');
    const backupDir = args.apply ? resolve(args.backupDir) : null;
    if (backupDir) await mkdir(backupDir, { recursive: false, mode: 0o700 });
    const credentials = strictJsonParse(await readFile(resolve(args.secretFile || args.tokenFile), 'utf8'));
    if (!record(credentials)) bad('invalid_credentials');
    const request = await productionAdapter(origin, args.secretFile ? { APP_SECRET: credentials.APP_SECRET } : { token: credentials.token });
    report = await runLayerImport({ source, base, batch, request, apply: args.apply, approvedReport,
      saveSnapshot: async (name, value) => writeFile(resolve(backupDir, `${name}.private.json`), JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 }),
    });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, passed: report.passed, mode: report.mode, targetCount: report.targetCount, changedFields: report.changedFields, conflicts: report.conflicts ?? 0 }));
    return report.passed ? 0 : 1;
  } catch (error) {
    const code = error instanceof PilotError ? error.code : 'import_failed';
    report = { ...(error instanceof PilotError && error.report ? error.report : report || {}), status: code, passed: false };
    if (output) { try { await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); } catch { /* Preserve existing output. */ } }
    console.error(JSON.stringify({ status: code, passed: false, writeSucceeded: own(report, 'writeSucceeded') ? report.writeSucceeded : false }));
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
