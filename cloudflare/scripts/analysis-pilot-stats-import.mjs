// Complete the missing five-dimensional scores for two pilot figures only.
// No AI requests. Default mode plans; prose and credentials never enter reports.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { record, validRevision, strictJsonParse } from '../src/contracts.mjs';
import { MAX_DOCUMENT_BYTES } from '../src/d1-store.mjs';
import { loadBaseLibrary } from './audit-counts.mjs';
import { PilotError, sourceUserdata, contentHash, sha256, parseArguments, validateOrigin, productionAdapter } from './analysis-pilot-import.mjs';
import { layerFigureInput } from './analysis-pilot-layers-import.mjs';

export const AUTHORIZED_STATS_IDS = Object.freeze(['emperor_北魏孝文帝_33257620', 'minister_姚崇_2003901767']);
export const STATS_DIMENSIONS = Object.freeze(['統率', '武力', '智謀', '政治', '魅力']);
const FIELDS = Object.freeze(['stats', 'statsAnalysis']);
const own = (value, key) => Object.hasOwn(value, key);
const bad = code => { throw new PilotError(code); };
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const missingStats = value => value === undefined || value === null;
const missingProse = value => missingStats(value) || (typeof value === 'string' && !value.trim());
const sameKeys = (one, two) => isDeepStrictEqual([...one].sort(), [...two].sort());

export function statsFigureInput(document, base, id) {
  if (!AUTHORIZED_STATS_IDS.includes(id)) bad('unauthorized_target');
  const figure = layerFigureInput(document, base, id);
  for (const field of ['analysis', 'deepAnalysis', 'soulEssence']) {
    if (typeof figure[field] !== 'string' || !figure[field].trim()) bad('completed_layers_required');
  }
  return figure;
}
export function statsInputSha256(document, base, id) { return contentHash(statsFigureInput(document, base, id)); }
function validateProvenance(value) {
  if (!record(value) || value.provider !== 'ChatGPT web' || value.webSearchPerformed !== true || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt)) || !Array.isArray(value.checkedSources) || !value.checkedSources.length) bad('invalid_provenance');
  let conversation; try { conversation = new URL(value.conversationUrl); } catch { bad('invalid_provenance'); }
  if (conversation.protocol !== 'https:' || conversation.hostname !== 'chatgpt.com' || !/^\/(?:g\/[^/]+\/)?c\/[a-zA-Z0-9-]+$/.test(conversation.pathname) || conversation.username || conversation.password || conversation.search || conversation.hash) bad('invalid_provenance');
  for (const source of value.checkedSources) {
    if (!record(source) || typeof source.title !== 'string' || !source.title.trim() || typeof source.locator !== 'string' || !source.locator.trim()) bad('invalid_provenance');
    let url; try { url = new URL(source.url); } catch { bad('invalid_provenance'); }
    if (url.protocol !== 'https:' || url.username || url.password) bad('invalid_provenance');
  }
}
export function validateStatsAnalysis(prose, stats) {
  if (!Array.isArray(stats) || stats.length !== STATS_DIMENSIONS.length || !stats.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100)) bad('invalid_stats_values');
  if (typeof prose !== 'string' || prose.trim().length < 150 || prose.includes('\0')) bad('incomplete_stats_analysis');
  const lines = prose.replace(/\r\n/g, '\n').split('\n'), headers = [];
  for (const [index, line] of lines.entries()) {
    const title = line.trim().replace(/^#{1,6}[ \t]+/, '').replace(/\*\*/g, '').trim();
    if (!/^(?:\d+[.)、．][ \t]*)?(?:統率|武力|智謀|政治|魅力)(?=[ \t：:（(]|$)/.test(title)) continue;
    const match = title.match(/^(?:(\d+)[.)、．][ \t]*)?(統率|武力|智謀|政治|魅力)[ \t]*[：:][ \t]*(0|[1-9]\d{0,2})(?:[ \t]*\/[ \t]*100)?[ \t]*$/);
    if (!match || (line.match(/\*\*/g) || []).length % 2) bad('invalid_stats_analysis_heading');
    headers.push({ line: index, number: match[1] === undefined ? null : Number(match[1]), dimension: match[2], score: Number(match[3]) });
  }
  if (headers.length !== STATS_DIMENSIONS.length) bad('invalid_stats_analysis_sections');
  return headers.map((header, index) => {
    if (header.dimension !== STATS_DIMENSIONS[index] || (header.number !== null && header.number !== index + 1)) bad('stats_analysis_order_mismatch');
    if (header.score !== stats[index]) bad('stats_analysis_score_mismatch');
    const reason = lines.slice(header.line + 1, headers[index + 1]?.line ?? lines.length).join('\n').trim();
    if (reason.length < 20) bad('incomplete_stats_reason');
    return { dimension: header.dimension, score: header.score, reason };
  });
}
export function validateStatsBatch(batch) {
  if (!record(batch) || batch.format !== 'dynasty-analysis-pilot-stats-results' || batch.schemaVersion !== 1 || !Array.isArray(batch.records) || batch.records.length !== AUTHORIZED_STATS_IDS.length) bad('invalid_stats_batch');
  const ids = new Set();
  for (const item of batch.records) {
    if (!record(item) || !AUTHORIZED_STATS_IDS.includes(item.id) || ids.has(item.id) || !validHash(item.inputSha256) || !validHash(item.promptSha256) || !record(item.fields)) bad('invalid_stats_record');
    if (!sameKeys(Object.keys(item.fields), FIELDS)) bad('unauthorized_field');
    validateStatsAnalysis(item.fields.statsAnalysis, item.fields.stats);
    validateProvenance(item.provenance); ids.add(item.id);
  }
  if (!sameKeys(ids, AUTHORIZED_STATS_IDS)) bad('unauthorized_target');
  return batch;
}
export function planStatsImport(source, latest, base, batch) {
  validateStatsBatch(batch);
  const baseline = sourceUserdata(source), before = sourceUserdata(latest), modifications = structuredClone(before.modifiedLegends);
  for (const item of batch.records) {
    const original = statsFigureInput(baseline, base, item.id), live = statsFigureInput(before, base, item.id);
    if (!missingStats(original.stats) || !missingProse(original.statsAnalysis)) bad('existing_source_stats');
    if (contentHash(original) !== item.inputSha256) bad('source_input_hash_mismatch');
    if (!missingStats(live.stats) || !missingProse(live.statsAnalysis)) bad('existing_stats');
    if (contentHash(live) !== item.inputSha256) bad('live_input_changed');
    Object.defineProperty(modifications, item.id, { value: { ...(own(modifications, item.id) ? modifications[item.id] : {}), stats: [...item.fields.stats], statsAnalysis: item.fields.statsAnalysis }, writable: true, enumerable: true, configurable: true });
  }
  const patch = { revision: before.revision, modifiedLegends: modifications };
  const after = { ...structuredClone(before), modifiedLegends: modifications, revision: before.revision + 1 };
  if (!validRevision(after.revision)) bad('revision_exhausted');
  if (bytes(patch) > MAX_DOCUMENT_BYTES || bytes(after) > MAX_DOCUMENT_BYTES) bad('userdata_size_limit');
  return { before, patch, after, report: {
    format: 'dynasty-analysis-pilot-stats-import', schemaVersion: 1, mode: 'dry-run', status: 'planned', passed: true,
    targetCount: AUTHORIZED_STATS_IDS.length, changedFields: AUTHORIZED_STATS_IDS.length * FIELDS.length, provenanceFieldsWritten: 0,
    batchSha256: contentHash(batch), sourceSha256: contentHash(baseline), baseLibrarySha256: contentHash(base),
    beforeSha256: contentHash(before), plannedAfterSha256: contentHash(after), beforeRevision: before.revision, plannedAfterRevision: after.revision, patchBytes: bytes(patch), plannedDocumentBytes: bytes(after),
    inputHashes: batch.records.map(item => item.inputSha256), writtenFieldHashes: batch.records.flatMap(item => FIELDS.map(field => ({ field, sha256: field === 'stats' ? contentHash(item.fields[field]) : sha256(item.fields[field]) }))),
  } };
}
export function verifyStatsWrite(plan, observed, batch) {
  const after = sourceUserdata(observed), clean = structuredClone(after), baseline = structuredClone(plan.before);
  delete clean.revision; delete baseline.revision;
  let targetsMatch = true;
  for (const item of batch.records) {
    const original = own(plan.before.modifiedLegends, item.id) ? plan.before.modifiedLegends[item.id] : null;
    const current = clean.modifiedLegends[item.id];
    if (!record(current)) bad('verification_target_missing');
    for (const field of FIELDS) {
      targetsMatch &&= isDeepStrictEqual(current[field], item.fields[field]);
      if (original && own(original, field)) current[field] = original[field]; else delete current[field];
    }
    if (!original && !Object.keys(current).length) delete clean.modifiedLegends[item.id];
  }
  const contentPreserved = isDeepStrictEqual(clean, baseline), revisionMatches = after.revision === plan.after.revision;
  return { passed: targetsMatch && contentPreserved && revisionMatches && isDeepStrictEqual(after, plan.after), targetsMatch, contentPreserved, revisionMatches, afterRevision: after.revision, afterSha256: contentHash(after), unaffectedBeforeSha256: contentHash(baseline), unaffectedAfterSha256: contentHash(clean) };
}
function approvalMatches(report, source, base, batch) {
  return record(report) && report.format === 'dynasty-analysis-pilot-stats-import' && report.mode === 'dry-run' && report.status === 'planned' && report.passed === true
    && report.batchSha256 === contentHash(batch) && report.sourceSha256 === contentHash(sourceUserdata(source)) && report.baseLibrarySha256 === contentHash(base);
}
export async function runStatsImport({ source, base, batch, request, apply = false, approvedReport = null, saveSnapshot = null }) {
  planStatsImport(source, source, base, batch);
  if (apply && !approvalMatches(approvedReport, source, base, batch)) bad('dry_run_approval_required');
  if (apply && typeof saveSnapshot !== 'function') bad('backup_required');
  let conflicts = 0;
  for (;;) {
    let current; try { current = await request('GET'); } catch { bad('userdata_read_failed'); }
    if (current.status !== 200) bad('userdata_read_failed');
    const plan = planStatsImport(source, current.body, base, batch);
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
    let verification; try { verification = verifyStatsWrite(plan, readback.body, batch); } catch { throw new PilotError('post_write_verification_failed', report); }
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
    const { base } = await loadBaseLibrary(); planStatsImport(source, source, base, batch);
    const approvedReport = args.apply ? strictJsonParse(await readFile(resolve(args.approvedReportFile), 'utf8')) : null;
    if (args.apply && !approvalMatches(approvedReport, source, base, batch)) bad('dry_run_approval_required');
    const backupDir = args.apply ? resolve(args.backupDir) : null;
    if (backupDir) await mkdir(backupDir, { recursive: false, mode: 0o700 });
    const credentials = strictJsonParse(await readFile(resolve(args.secretFile || args.tokenFile), 'utf8'));
    if (!record(credentials)) bad('invalid_credentials');
    const request = await productionAdapter(origin, args.secretFile ? { APP_SECRET: credentials.APP_SECRET } : { token: credentials.token });
    report = await runStatsImport({ source, base, batch, request, apply: args.apply, approvedReport,
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
