// Three-person pilot only. No AI requests. Private prose, tokens and server
// errors never appear in reports. Default mode reads and plans without writing.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse, record, validRevision, validateUserFields, userSnapshot, USER_FIELDS } from '../src/contracts.mjs';
import { MAX_DOCUMENT_BYTES } from '../src/d1-store.mjs';
import { loadBaseLibrary } from './audit-counts.mjs';

export const PILOT_COUNT = 3;
const own = (value, key) => Object.hasOwn(value, key);
const bad = code => { throw new PilotError(code); };
export class PilotError extends Error {
  constructor(code, report = null) { super(code); this.code = code; this.report = report; }
}
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const contentHash = value => sha256(canonicalJson(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 180 && !['__proto__', 'constructor', 'prototype'].includes(value) && !value.includes('\0');
const absentAnalysis = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());

export function sourceUserdata(source) {
  const value = source?.format === 'dynasty-migration-snapshot' && source.schemaVersion === 1 ? source.documents?.userdata : source;
  if (!record(value) || USER_FIELDS.some(field => !own(value, field))) bad('incomplete_source');
  try { validateUserFields(value); } catch { bad('invalid_source_fields'); }
  const normalized = userSnapshot(value);
  if (!validRevision(normalized.revision)) bad('invalid_revision');
  return normalized;
}
function validateBase(base) {
  if (!Array.isArray(base) || base.some(item => !record(item) || !validId(item.id)) || new Set(base.map(item => item.id)).size !== base.length) bad('invalid_base_library');
}
export function figureForInput(document, base, id) {
  const matches = [...base, ...document.customLegends].filter(item => item.id === id);
  if (matches.length !== 1) bad('target_missing_or_duplicate');
  const modification = own(document.modifiedLegends, id) ? document.modifiedLegends[id] : {};
  if (!record(modification)) bad('invalid_target_modification');
  const figure = { ...matches[0], ...modification, id };
  if (!absentAnalysis(figure.deepAnalysis)) bad('existing_analysis');
  delete figure.deepAnalysis;
  delete figure.isModified;
  return figure;
}
export function figureInputSha256(document, base, id) { return contentHash(figureForInput(sourceUserdata(document), base, id)); }
function finalSectionComplete(value) {
  if (typeof value !== 'string' || value.trim().length < 500 || value.includes('\u0000')) return false;
  const section = value.match(/【建議定案】([\s\S]*)$/)?.[1];
  if (!section) return false;
  return ['評級', '稱號', '標籤', '簡評', '判詞'].every(label => new RegExp(`^[ \\t]*(?:[-*][ \\t]*)?(?:\\*\\*)?${label}(?:\\*\\*)?[ \\t]*[：:][ \\t]*\\S[^\\r\\n]*$`, 'm').test(section));
}
export function validateBatch(batch) {
  if (!record(batch) || batch.format !== 'dynasty-analysis-pilot-results' || batch.schemaVersion !== 1 || !Array.isArray(batch.records) || batch.records.length !== PILOT_COUNT) bad('invalid_pilot_batch');
  const seen = new Set();
  for (const item of batch.records) {
    if (!record(item) || !validId(item.id) || seen.has(item.id) || !validHash(item.inputSha256) || !validHash(item.promptSha256)) bad('invalid_pilot_record');
    if (!finalSectionComplete(item.deepAnalysis)) bad('incomplete_analysis');
    // Provenance remains local; no additional website fields are introduced.
    if (!record(item.provenance) || item.provenance.provider !== 'ChatGPT web' || typeof item.provenance.generatedAt !== 'string' || !Number.isFinite(Date.parse(item.provenance.generatedAt)) || !Array.isArray(item.provenance.checkedSources) || !item.provenance.checkedSources.length) bad('invalid_provenance');
    let conversation;
    try { conversation = new URL(item.provenance.conversationUrl); } catch { bad('invalid_provenance'); }
    if (conversation.protocol !== 'https:' || conversation.hostname !== 'chatgpt.com' || !/^\/(?:g\/[^/]+\/)?c\/[a-zA-Z0-9-]+$/.test(conversation.pathname) || conversation.username || conversation.password || conversation.search || conversation.hash) bad('invalid_provenance');
    for (const source of item.provenance.checkedSources) {
      if (!record(source) || typeof source.title !== 'string' || !source.title.trim() || typeof source.locator !== 'string' || !source.locator.trim()) bad('invalid_provenance');
      let url; try { url = new URL(source.url); } catch { bad('invalid_provenance'); }
      if (url.protocol !== 'https:' || url.username || url.password) bad('invalid_provenance');
    }
    seen.add(item.id);
  }
  return batch;
}

export function planPilot(source, latest, base, batch) {
  validateBase(base); validateBatch(batch);
  const baseline = sourceUserdata(source), before = sourceUserdata(latest);
  for (const item of batch.records) {
    if (contentHash(figureForInput(baseline, base, item.id)) !== item.inputSha256) bad('source_input_hash_mismatch');
    if (contentHash(figureForInput(before, base, item.id)) !== item.inputSha256) bad('live_input_changed');
  }
  const modifications = structuredClone(before.modifiedLegends);
  for (const item of batch.records) Object.defineProperty(modifications, item.id, { value: { ...(own(modifications, item.id) ? modifications[item.id] : {}), deepAnalysis: item.deepAnalysis }, writable: true, enumerable: true, configurable: true });
  const patch = { revision: before.revision, modifiedLegends: modifications };
  const after = { ...structuredClone(before), modifiedLegends: modifications, revision: before.revision + 1 };
  if (!validRevision(after.revision)) bad('revision_exhausted');
  if (bytes(patch) > MAX_DOCUMENT_BYTES || bytes(after) > MAX_DOCUMENT_BYTES) bad('userdata_size_limit');
  return { before, patch, after, report: {
    format: 'dynasty-analysis-pilot-import', schemaVersion: 1, mode: 'dry-run', status: 'planned', passed: true,
    targetCount: PILOT_COUNT, batchSha256: contentHash(batch), sourceSha256: contentHash(baseline), baseLibrarySha256: contentHash(base),
    beforeSha256: contentHash(before), plannedAfterSha256: contentHash(after), beforeRevision: before.revision, plannedAfterRevision: after.revision,
    patchBytes: bytes(patch), plannedDocumentBytes: bytes(after), changedFields: PILOT_COUNT, provenanceFieldsWritten: 0,
    targetInputHashes: batch.records.map(item => item.inputSha256), analysisHashes: batch.records.map(item => sha256(item.deepAnalysis)),
  } };
}

function removeAllowedChanges(value, before, batch) {
  const clean = structuredClone(value); delete clean.revision;
  for (const item of batch.records) {
    const original = own(before.modifiedLegends, item.id) ? before.modifiedLegends[item.id] : null;
    const current = clean.modifiedLegends[item.id];
    if (!record(current)) bad('verification_target_missing');
    if (original && own(original, 'deepAnalysis')) current.deepAnalysis = original.deepAnalysis;
    else delete current.deepAnalysis;
    if (!original && !Object.keys(current).length) delete clean.modifiedLegends[item.id];
  }
  return clean;
}
export function verifyPilotWrite(plan, observed, batch) {
  const after = sourceUserdata(observed);
  const baseline = structuredClone(plan.before); delete baseline.revision;
  const unaffected = removeAllowedChanges(after, plan.before, batch);
  const targetsMatch = batch.records.every(item => after.modifiedLegends[item.id]?.deepAnalysis === item.deepAnalysis);
  const contentPreserved = isDeepStrictEqual(baseline, unaffected);
  const revisionMatches = after.revision === plan.after.revision;
  return { passed: targetsMatch && contentPreserved && revisionMatches && isDeepStrictEqual(after, plan.after), targetsMatch, contentPreserved, revisionMatches, afterRevision: after.revision, afterSha256: contentHash(after), unaffectedBeforeSha256: contentHash(baseline), unaffectedAfterSha256: contentHash(unaffected) };
}

// request() is injected for synthetic offline tests. Production adapter only
// permits auth and userdata endpoints; the tool never calls an AI endpoint.
export async function runPilotImport({ source, base, batch, request, apply = false, approvedReport = null, saveSnapshot = null, maxConflicts = 3 }) {
  // Reject invalid or already-populated original data before any network read.
  planPilot(source, source, base, batch);
  if (!Number.isSafeInteger(maxConflicts) || maxConflicts < 0 || maxConflicts > 3) bad('invalid_retry_limit');
  if (apply && (!record(approvedReport) || approvedReport.mode !== 'dry-run' || approvedReport.status !== 'planned' || approvedReport.passed !== true || approvedReport.batchSha256 !== contentHash(batch) || approvedReport.sourceSha256 !== contentHash(sourceUserdata(source)) || approvedReport.baseLibrarySha256 !== contentHash(base))) bad('dry_run_approval_required');
  if (apply && typeof saveSnapshot !== 'function') bad('backup_required');
  let conflicts = 0;
  for (;;) {
    let current; try { current = await request('GET'); } catch { bad('userdata_read_failed'); }
    if (current.status !== 200) bad('userdata_read_failed');
    const plan = planPilot(source, current.body, base, batch);
    if (!apply) return plan.report;
    const report = { ...plan.report, mode: 'apply', status: 'pending', passed: false, conflicts, writeAttempted: false, writeSucceeded: false };
    try { await saveSnapshot(`before-attempt-${conflicts + 1}`, plan.before); } catch { throw new PilotError('pre_write_backup_failed', report); }
    // Save complete pre-write data before issuing this CAS request.
    report.writeAttempted = true;
    report.writeSucceeded = null;
    let response;
    try { response = await request('POST', plan.patch); } catch { throw new PilotError('write_outcome_unknown', report); }
    if (response.status === 409) {
      report.writeSucceeded = false;
      if (conflicts >= maxConflicts) throw new PilotError('conflict_retry_limit', report);
      conflicts++; continue; // Read again, recheck identity and merge the new map.
    }
    if (response.status !== 200) {
      // This worker catches unknown failures as 503. Such a failure may have
      // occurred after its atomic CAS completed, so do not claim no write.
      if ([400, 401, 403, 404, 405, 413, 422, 429].includes(response.status)) report.writeSucceeded = false;
      throw new PilotError('userdata_write_failed', report);
    }
    if (response.body?.status !== 'ok' || response.body?.revision !== plan.after.revision) throw new PilotError('write_acknowledgement_invalid', report);
    report.writeSucceeded = true;
    let readback;
    try { readback = await request('GET'); } catch { throw new PilotError('post_write_read_failed', report); }
    if (readback.status !== 200) throw new PilotError('post_write_read_failed', report);
    try { await saveSnapshot('after-write', readback.body); } catch { throw new PilotError('post_write_backup_failed', report); }
    let verification;
    try { verification = verifyPilotWrite(plan, readback.body, batch); } catch { throw new PilotError('post_write_verification_failed', report); }
    Object.assign(report, { verification, passed: verification.passed, status: verification.passed ? 'applied_verified' : 'applied_verification_failed' });
    // Never roll back: a newer revision can include legitimate player progress.
    return report;
  }
}

export function parseArguments(values) {
  const result = { apply: false };
  const fields = { '--origin': 'origin', '--source': 'sourceFile', '--results': 'resultsFile', '--output': 'outputFile', '--secret-file': 'secretFile', '--token-file': 'tokenFile', '--approved-report': 'approvedReportFile', '--backup-dir': 'backupDir' };
  for (let index = 0; index < values.length; index++) {
    const argument = values[index];
    if (argument === '--apply' && !result.apply) result.apply = true;
    else if (fields[argument] && values[index + 1] && !values[index + 1].startsWith('--') && !result[fields[argument]]) result[fields[argument]] = values[++index];
    else bad('invalid_arguments');
  }
  if (!result.origin || !result.sourceFile || !result.resultsFile || !result.outputFile || Boolean(result.secretFile) === Boolean(result.tokenFile)) bad('missing_arguments');
  if (result.apply && (!result.approvedReportFile || !result.backupDir)) bad('apply_requires_report_and_backup');
  if (!result.apply && (result.approvedReportFile || result.backupDir)) bad('unused_apply_arguments');
  return result;
}
export function validateOrigin(origin) {
  let url; try { url = new URL(origin); } catch { bad('invalid_origin'); }
  const trusted = (url.protocol === 'https:' && ['dynasty.piamamba.com', 'dynasty.kobejordanair.workers.dev'].includes(url.hostname) && !url.port)
    || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  if (!trusted || url.pathname !== '/' || url.search || url.hash || url.username || url.password) bad('invalid_origin');
  return url.origin;
}
async function readResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) bad('empty_response');
  const decoder = new TextDecoder('utf-8', { fatal: true }); let source = '', total = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_DOCUMENT_BYTES + 4096) { await reader.cancel(); bad('response_size_limit'); }
      source += decoder.decode(next.value, { stream: true });
    }
    return strictJsonParse(source + decoder.decode());
  } catch (error) { if (error instanceof PilotError) throw error; bad('invalid_response'); }
  finally { reader.releaseLock(); }
}
export async function productionAdapter(origin, credentials, fetcher = fetch) {
  origin = validateOrigin(origin);
  if (!record(credentials) || (own(credentials, 'APP_SECRET') && own(credentials, 'token'))) bad('invalid_credentials');
  let token;
  async function send(path, method, body, authenticated = true) {
    const headers = { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(authenticated && token ? { 'x-app-token': token } : {}) };
    const response = await fetcher(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(120000) });
    return { status: response.status, body: await readResponse(response) };
  }
  if (own(credentials, 'APP_SECRET')) {
    if (typeof credentials.APP_SECRET !== 'string' || !credentials.APP_SECRET) bad('invalid_credentials');
    let login; try { login = await send('/api/auth', 'POST', { password: credentials.APP_SECRET }, false); } catch { bad('authentication_failed'); }
    if (login.status !== 200 || typeof login.body?.token !== 'string' || !login.body.token) bad('authentication_failed');
    token = login.body.token;
  } else {
    if (typeof credentials.token !== 'string' || !credentials.token) bad('invalid_credentials');
    token = credentials.token;
  }
  return (method, body) => send('/api/userdata', method, body);
}
export async function main(values = process.argv.slice(2)) {
  let output = null, report = null;
  try {
    const args = parseArguments(values); const origin = validateOrigin(args.origin);
    output = resolve(args.outputFile);
    try { await stat(output); bad('output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dirname(output), { recursive: true });
    const source = strictJsonParse(await readFile(resolve(args.sourceFile), 'utf8'));
    const batch = strictJsonParse(await readFile(resolve(args.resultsFile), 'utf8'));
    const { base } = await loadBaseLibrary();
    // Validate original targets and complete prose before loading credentials.
    planPilot(source, source, base, batch);
    const approvedReport = args.apply ? strictJsonParse(await readFile(resolve(args.approvedReportFile), 'utf8')) : null;
    if (args.apply && (approvedReport?.mode !== 'dry-run' || approvedReport?.status !== 'planned' || approvedReport?.passed !== true || approvedReport?.batchSha256 !== contentHash(batch) || approvedReport?.sourceSha256 !== contentHash(sourceUserdata(source)) || approvedReport?.baseLibrarySha256 !== contentHash(base))) bad('dry_run_approval_required');
    const backupDir = args.apply ? resolve(args.backupDir) : null;
    if (backupDir) await mkdir(backupDir, { recursive: false, mode: 0o700 });
    const credentials = strictJsonParse(await readFile(resolve(args.secretFile || args.tokenFile), 'utf8'));
    if (!record(credentials)) bad('invalid_credentials');
    const request = await productionAdapter(origin, args.secretFile ? { APP_SECRET: credentials.APP_SECRET } : { token: credentials.token });
    report = await runPilotImport({ source, base, batch, request, apply: args.apply, approvedReport,
      saveSnapshot: async (name, value) => writeFile(resolve(backupDir, `${name}.private.json`), JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 }),
    });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, passed: report.passed, mode: report.mode, targetCount: report.targetCount, conflicts: report.conflicts ?? 0 }));
    return report.passed ? 0 : 1;
  } catch (error) {
    const code = error instanceof PilotError ? error.code : 'import_failed';
    report = { ...(error instanceof PilotError && error.report ? error.report : report || {}), status: code, passed: false };
    if (output) { try { await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); } catch { /* Never overwrite an existing result. */ } }
    console.error(JSON.stringify({ status: code, passed: false, writeSucceeded: own(report, 'writeSucceeded') ? report.writeSucceeded : false }));
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
