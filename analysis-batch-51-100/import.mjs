// Fixed 50-person completion. No AI requests or prose generation. The CLI
// defaults to a read-only plan; every write requires a bound dry-run and backups.
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse, record, validRevision } from '../cloudflare/src/contracts.mjs';
import { MAX_DOCUMENT_BYTES } from '../cloudflare/src/d1-store.mjs';
import { loadBaseLibrary } from '../cloudflare/scripts/audit-counts.mjs';
import { PilotError, sourceUserdata, contentHash, sha256, validateOrigin, productionAdapter } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { validateStatsAnalysis } from '../cloudflare/scripts/analysis-pilot-stats-import.mjs';
import { CHATGPT_PROVIDER, CLAUDE_PROVIDER, validClaudeProvenance } from './claude/provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXED_MANIFEST_SHA256 = 'a3a02fac420f353cb79cbdae1605baca1278ce13ae876d17314cc755aa43ec2f';
export const COMPLETION_FIELDS = Object.freeze(['analysis', 'soulEssence', 'stats', 'statsAnalysis']);
export const ANALYSIS_FIELDS = Object.freeze(['analysis', 'stats', 'statsAnalysis']);
export const ANALYSIS_FORMAT = 'dynasty-analysis-batch50-analysis-results';
// Soul-only continuation for a person whose analysis/stats/statsAnalysis were
// already published by a verified apply receipt. Each record names that
// receipt; the live document must still hold exactly the receipted three
// fields, so this format can add soulEssence and nothing else.
export const SOUL_FIELDS = Object.freeze(['soulEssence']);
export const SOUL_FORMAT = 'dynasty-analysis-batch50-soul-results';
export const batchFields = batch => batch.format === ANALYSIS_FORMAT ? ANALYSIS_FIELDS : batch.format === SOUL_FORMAT ? SOUL_FIELDS : COMPLETION_FIELDS;
const fieldHash = (field, value) => field === 'stats' ? contentHash(value) : sha256(value);
export const EXPECTED_TOTAL = 962;
const own = (value, key) => Object.hasOwn(value, key);
const bad = (code, report = null) => { throw new PilotError(code, report); };
const hashOk = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameKeys = (one, two) => isDeepStrictEqual([...one].sort(), [...two].sort());
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const missing = (value, field) => value === undefined || value === null || (field !== 'stats' && typeof value === 'string' && !value.trim());

export async function loadFixedManifest() {
  const manifest = strictJsonParse(await readFile(resolve(here, 'manifest.v1.json'), 'utf8'));
  if (contentHash(manifest) !== FIXED_MANIFEST_SHA256) bad('fixed_manifest_changed');
  return manifest;
}
const authority = await loadFixedManifest();
export const AUTHORIZED_IDS = Object.freeze(authority.records.map(item => item.id));

// Explicit manifests make the pure functions testable with synthetic full
// documents. IDs, every target input and public context remain fixed. The
// production CLI loads the entire sealed manifest above, including source/base.
export function validateManifest(manifest) {
  if (!record(manifest) || manifest.format !== 'dynasty-analysis-batch50-manifest' || manifest.schemaVersion !== 1
    || manifest.targetCount !== 50 || manifest.baselineRevision !== authority.baselineRevision
    || !hashOk(manifest.sourceSha256) || !hashOk(manifest.baseLibrarySha256)
    || !Array.isArray(manifest.records) || manifest.records.length !== 50
    || !isDeepStrictEqual(manifest.records, authority.records)
    || !isDeepStrictEqual(manifest.selection, authority.selection)
    || !isDeepStrictEqual(manifest.policy, authority.policy)) bad('invalid_fixed_manifest');
  return manifest;
}

function validateLibrary(document, base) {
  const validId = item => record(item) && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 180
    && !['__proto__', 'constructor', 'prototype'].includes(item.id) && !item.id.includes('\0');
  if (!Array.isArray(base) || base.some(item => !validId(item))) bad('invalid_base_library');
  const entries = [...base, ...document.customLegends];
  if (entries.length !== EXPECTED_TOTAL || entries.some(item => !validId(item)) || new Set(entries.map(item => item.id)).size !== entries.length) bad('library_identity_changed');
  return entries;
}

export function figureInput(document, base, id) {
  if (!AUTHORIZED_IDS.includes(id)) bad('unauthorized_target');
  const value = sourceUserdata(document), entries = validateLibrary(value, base);
  const matches = entries.filter(item => item.id === id);
  if (matches.length !== 1) bad('target_missing_or_duplicate');
  const modification = own(value.modifiedLegends, id) ? value.modifiedLegends[id] : {};
  if (!record(modification)) bad('invalid_target_modification');
  return { ...matches[0], ...modification, id };
}

function validateBaseline(source, base, manifest) {
  validateManifest(manifest);
  const baseline = sourceUserdata(source);
  validateLibrary(baseline, base);
  if (baseline.revision !== manifest.baselineRevision || contentHash(baseline) !== manifest.sourceSha256) bad('source_document_changed');
  if (contentHash(base) !== manifest.baseLibrarySha256) bad('base_library_changed');
  for (const target of manifest.records) {
    const figure = figureInput(baseline, base, target.id);
    if (contentHash(figure) !== target.inputSha256) bad('source_input_hash_mismatch');
    if (typeof figure.deepAnalysis !== 'string' || sha256(figure.deepAnalysis) !== target.preserved.deepAnalysis.sha256) bad('preserved_deep_analysis_changed');
    if (COMPLETION_FIELDS.some(field => !missing(figure[field], field))) bad('existing_source_field');
  }
  return baseline;
}

function validateProvenance(provenance) {
  if (!record(provenance) || ![CHATGPT_PROVIDER, CLAUDE_PROVIDER].includes(provenance.provider) || provenance.webSearchPerformed !== true
    || typeof provenance.generatedAt !== 'string' || !Number.isFinite(Date.parse(provenance.generatedAt))
    || !Array.isArray(provenance.checkedSources) || !provenance.checkedSources.length) bad('invalid_provenance');
  // Claude-authored records (author-policy.v2.json) carry a Claude session URL
  // and the policy hash, never a ChatGPT conversation URL.
  if (provenance.provider === CLAUDE_PROVIDER) { if (!validClaudeProvenance(provenance)) bad('invalid_provenance'); }
  else {
    let url; try { url = new URL(provenance.conversationUrl); } catch { bad('invalid_provenance'); }
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || !/^\/(?:g\/[^/]+\/)?c\/[a-zA-Z0-9-]+$/.test(url.pathname)
      || url.username || url.password || url.search || url.hash) bad('invalid_provenance');
  }
  for (const source of provenance.checkedSources) {
    let sourceUrl; try { sourceUrl = new URL(source?.url); } catch { bad('invalid_provenance'); }
    if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password
      || typeof source.title !== 'string' || !source.title.trim() || typeof source.locator !== 'string' || !source.locator.trim()) bad('invalid_provenance');
  }
}

function validateSections(prose, labels, minimum) {
  if (prose.trim().length < minimum) bad('incomplete_article');
  const lines = prose.replace(/\r\n/g, '\n').split('\n'), sections = [];
  for (const [at, line] of lines.entries()) {
    const title = line.trim().replace(/^#{1,6}[ \t]+/, '').replace(/\*\*/g, '').replace(/^\d+[.)、．][ \t]*/, '');
    const match = title.match(/^【([^】]+)】(?:[ \t：:—–-].*)?$/);
    if (match && labels.includes(match[1])) sections.push({ label: match[1], at });
  }
  if (!isDeepStrictEqual(sections.map(section => section.label), labels)) bad('incomplete_article_sections');
  return sections.map((section, at) => {
    const body = lines.slice(section.at + 1, sections[at + 1]?.at ?? lines.length).join('\n').trim();
    if (body.length < 20) bad('incomplete_article_section');
    return body;
  });
}

export function validateCompletionFields(fields) { return validateFields(fields, COMPLETION_FIELDS); }

function validateFields(fields, allowedFields) {
  if (!record(fields) || !sameKeys(Object.keys(fields), allowedFields)) bad('unauthorized_completion_fields');
  for (const field of allowedFields.filter(field => field !== 'stats')) {
    if (typeof fields[field] !== 'string' || !fields[field].trim() || fields[field].includes('\0')
      || /<!--\s*(?:BATCH50_COMPLETE|STATS_REASONS_BEGIN)\b/.test(fields[field])) bad('incomplete_completion_field');
  }
  if (allowedFields.includes('analysis')) validateSections(fields.analysis, ['歷史局勢與定位', '深度功過剖析', '人性與性格側寫', '如果生在現代'], 800);
  if (allowedFields.includes('soulEssence')) {
    const soulSections = validateSections(fields.soulEssence, ['說話邏輯', '壓力反應', '核心驅動', '慣性盲點', '情感結構', '參照系', '內在裂縫'], 1000);
    if (soulSections.some(body => !/\[(?:史載|推斷|詮釋)\]/.test(body))) bad('soul_annotations_missing');
  }
  if (allowedFields.includes('statsAnalysis')) validateStatsAnalysis(fields.statsAnalysis, fields.stats);
  return fields;
}

export function validatePriorReceipt(prior) {
  if (!record(prior) || !sameKeys(Object.keys(prior), ['file', 'sha256', 'afterRevision', 'fieldHashes'])
    || typeof prior.file !== 'string' || !/^analysis-batch-51-100\/import\.\d\d-\d\d\.apply\.json$/.test(prior.file)
    || !hashOk(prior.sha256) || !validRevision(prior.afterRevision)
    || !record(prior.fieldHashes) || !sameKeys(Object.keys(prior.fieldHashes), ANALYSIS_FIELDS)
    || ANALYSIS_FIELDS.some(field => !hashOk(prior.fieldHashes[field]))) bad('invalid_prior_receipt');
  return prior;
}

// The receipt must be a verified apply of exactly these three fields for this
// person; anything else (dry-run, failed write, other fields) cannot unlock a
// soul-only continuation.
export function validatePriorReceiptDocument(receipt, item, manifest = authority) {
  validatePriorReceipt(item?.priorReceipt);
  const written = Array.isArray(receipt?.writtenFieldHashes) ? receipt.writtenFieldHashes.filter(entry => entry?.id === item.id) : [];
  if (!record(receipt) || receipt.format !== 'dynasty-analysis-batch50-import' || receipt.mode !== 'apply' || receipt.status !== 'applied_verified'
    || receipt.schemaVersion !== 1 || receipt.passed !== true || receipt.writeAttempted !== true || receipt.writeSucceeded !== true
    || receipt.verification?.passed !== true || receipt.verification.targetsMatch !== true
    || receipt.verification.contentPreserved !== true || receipt.verification.revisionMatches !== true
    || !validRevision(receipt.beforeRevision) || receipt.beforeRevision < manifest.baselineRevision
    || receipt.plannedAfterRevision !== receipt.beforeRevision + 1
    || receipt.verification.afterRevision !== receipt.plannedAfterRevision
    || !hashOk(receipt.plannedAfterSha256) || receipt.verification.afterSha256 !== receipt.plannedAfterSha256
    || !hashOk(receipt.verification.unaffectedBeforeSha256)
    || receipt.verification.unaffectedBeforeSha256 !== receipt.verification.unaffectedAfterSha256
    || receipt.manifestSha256 !== contentHash(manifest) || contentHash(receipt) !== item.priorReceipt.sha256
    || receipt.verification.afterRevision !== item.priorReceipt.afterRevision
    || !sameKeys(written.map(entry => entry.field), ANALYSIS_FIELDS) || written.length !== ANALYSIS_FIELDS.length
    || written.some(entry => entry.sha256 !== item.priorReceipt.fieldHashes[entry.field])) bad('prior_receipt_mismatch');
  return true;
}

export function validateChunk(batch, manifest = authority) {
  validateManifest(manifest);
  if (!record(batch) || !['dynasty-analysis-batch50-results', ANALYSIS_FORMAT, SOUL_FORMAT].includes(batch.format) || batch.schemaVersion !== 1
    || batch.manifestSha256 !== contentHash(manifest) || !Array.isArray(batch.records) || !batch.records.length || batch.records.length > 5) bad('invalid_completion_chunk');
  const seen = new Set();
  for (const item of batch.records) {
    const target = manifest.records.find(value => value.id === item?.id);
    if (!record(item) || !target || seen.has(item.id) || item.inputSha256 !== target.inputSha256 || !hashOk(item.promptSha256)
      || !record(item.fields) || !sameKeys(Object.keys(item.fields), batchFields(batch))) bad('invalid_completion_record');
    validateFields(item.fields, batchFields(batch));
    if (batch.format === SOUL_FORMAT) validatePriorReceipt(item.priorReceipt); else if (own(item, 'priorReceipt')) bad('invalid_completion_record');
    validateProvenance(item.provenance);
    seen.add(item.id);
  }
  return batch;
}

export function planBatch50Import(source, latest, base, batch, manifest = authority) {
  const baseline = validateBaseline(source, base, manifest);
  validateChunk(batch, manifest);
  const before = sourceUserdata(latest), modifications = structuredClone(before.modifiedLegends);
  validateLibrary(before, base);
  for (const item of batch.records) {
    const live = figureInput(before, base, item.id);
    if (batch.format === SOUL_FORMAT) {
      // Exactly the receipted fields may be present; their removal must give
      // back the sealed original input. soulEssence must still be empty.
      if (before.revision < item.priorReceipt.afterRevision) bad('prior_receipt_not_applied');
      if (SOUL_FIELDS.some(field => !missing(live[field], field))) bad('existing_live_field');
      if (ANALYSIS_FIELDS.some(field => missing(live[field], field) || fieldHash(field, live[field]) !== item.priorReceipt.fieldHashes[field])) bad('prior_receipt_fields_changed');
      const original = { ...live };
      for (const field of ANALYSIS_FIELDS) delete original[field];
      if (contentHash(original) !== item.inputSha256) bad('live_input_changed');
    } else {
      if (COMPLETION_FIELDS.some(field => !missing(live[field], field))) bad('existing_live_field');
      if (contentHash(live) !== item.inputSha256) bad('live_input_changed');
    }
    Object.defineProperty(modifications, item.id, { value: { ...(own(modifications, item.id) ? modifications[item.id] : {}), ...structuredClone(item.fields) }, writable: true, enumerable: true, configurable: true });
  }
  const patch = { revision: before.revision, modifiedLegends: modifications };
  const after = { ...structuredClone(before), modifiedLegends: modifications, revision: before.revision + 1 };
  if (!validRevision(after.revision)) bad('revision_exhausted');
  if (bytes(patch) > MAX_DOCUMENT_BYTES || bytes(after) > MAX_DOCUMENT_BYTES) bad('userdata_size_limit');
  return { before, patch, after, report: {
    format: 'dynasty-analysis-batch50-import', schemaVersion: 1, mode: 'dry-run', status: 'planned', passed: true,
    authorizedTargetCount: 50, targetCount: batch.records.length, changedFields: batch.records.length * batchFields(batch).length,
    provenanceFieldsWritten: 0, manifestSha256: contentHash(manifest), batchSha256: contentHash(batch), sourceSha256: contentHash(baseline), baseLibrarySha256: contentHash(base),
    beforeSha256: contentHash(before), plannedAfterSha256: contentHash(after), beforeRevision: before.revision, plannedAfterRevision: after.revision,
    patchBytes: bytes(patch), plannedDocumentBytes: bytes(after),
    writtenFieldHashes: batch.records.flatMap(item => batchFields(batch).map(field => ({ id: item.id, field, sha256: fieldHash(field, item.fields[field]) }))),
    ...(batch.format === SOUL_FORMAT ? { priorReceipts: batch.records.map(item => ({ id: item.id, file: item.priorReceipt.file, sha256: item.priorReceipt.sha256 })) } : {}),
  } };
}

// Offline pre-check before any read. A soul-only continuation is planned
// against the live document (which already holds the receipted fields), so
// offline it can only check the sealed baseline and the chunk itself.
export function precheckBatch50Import(source, base, batch, manifest = authority) {
  if (batch?.format === SOUL_FORMAT) { validateBaseline(source, base, manifest); validateChunk(batch, manifest); return true; }
  planBatch50Import(source, source, base, batch, manifest); return true;
}

export function verifyBatch50Write(plan, observed, batch) {
  const after = sourceUserdata(observed), clean = structuredClone(after), before = structuredClone(plan.before);
  delete clean.revision; delete before.revision;
  let targetsMatch = true;
  for (const item of batch.records) {
    const original = own(plan.before.modifiedLegends, item.id) ? plan.before.modifiedLegends[item.id] : null;
    const current = clean.modifiedLegends[item.id];
    if (!record(current)) bad('verification_target_missing');
    for (const field of batchFields(batch)) {
      targetsMatch &&= isDeepStrictEqual(current[field], item.fields[field]);
      if (original && own(original, field)) current[field] = original[field]; else delete current[field];
    }
    if (!original && !Object.keys(current).length) delete clean.modifiedLegends[item.id];
  }
  const contentPreserved = isDeepStrictEqual(clean, before), revisionMatches = after.revision === plan.after.revision;
  return { passed: targetsMatch && contentPreserved && revisionMatches && isDeepStrictEqual(after, plan.after), targetsMatch, contentPreserved, revisionMatches,
    afterRevision: after.revision, afterSha256: contentHash(after), unaffectedBeforeSha256: contentHash(before), unaffectedAfterSha256: contentHash(clean),
  };
}

function approved(report, source, base, batch, manifest) {
  return record(report) && report.format === 'dynasty-analysis-batch50-import' && report.mode === 'dry-run' && report.status === 'planned' && report.passed === true
    && report.manifestSha256 === contentHash(manifest) && report.batchSha256 === contentHash(batch)
    && report.sourceSha256 === contentHash(sourceUserdata(source)) && report.baseLibrarySha256 === contentHash(base);
}

// Production CLI and SDK callers share this actual file-backed evidence gate.
// Dynamic import avoids loading the assembler during module initialization.
export async function validateBatch50Evidence({ batch, manifest = authority }) {
  validateChunk(batch, manifest);
  if (batch.records.some(item => item.provenance.editorialRevision !== undefined)) {
    const { validateEditorialRevision } = await import('./editorial-revision.mjs');
    return validateEditorialRevision({ batch, manifest, validateOriginal: validateBatch50Evidence });
  }
  const providers = new Set(batch.records.map(item => item.provenance.provider));
  if (providers.size !== 1) bad('mixed_provider_batch');
  if (batch.format === SOUL_FORMAT) {
    if (!providers.has(CLAUDE_PROVIDER)) bad('soul_continuation_requires_claude');
    const { loadClaudeSoulPerson, assembleClaudeSoulResults } = await import('./claude-author.mjs');
    const people = [];
    for (const item of batch.records) {
      const receipt = strictJsonParse(await readFile(resolve(here, '..', item.priorReceipt.file), 'utf8'));
      validatePriorReceiptDocument(receipt, item, manifest);
      people.push(await loadClaudeSoulPerson(manifest.records.find(value => value.id === item.id).slug, item.priorReceipt.file));
    }
    if (contentHash(assembleClaudeSoulResults({ manifest, people })) !== contentHash(batch)) bad('batch_evidence_changed');
    return true;
  }
  if (providers.has(CLAUDE_PROVIDER)) {
    if (batch.format === ANALYSIS_FORMAT) bad('claude_analysis_only_unsupported');
    const { loadClaudePerson, assembleClaudeResults } = await import('./claude-author.mjs');
    const people = [];
    for (const item of batch.records) people.push(await loadClaudePerson(manifest.records.find(value => value.id === item.id).slug));
    if (contentHash(assembleClaudeResults({ manifest, people })) !== contentHash(batch)) bad('batch_evidence_changed');
    return true;
  }
  const { loadPerson, assembleResults, loadAnalysisPerson, assembleAnalysisResults } = await import('./assemble.mjs');
  const analysisOnly = batch.format === ANALYSIS_FORMAT;
  const people = [];
  for (const item of batch.records) {
    const target = manifest.records.find(value => value.id === item.id);
    people.push(await (analysisOnly ? loadAnalysisPerson : loadPerson)(target.slug));
  }
  const rebuilt = (analysisOnly ? assembleAnalysisResults : assembleResults)({ manifest, people });
  if (contentHash(rebuilt) !== contentHash(batch)) bad('batch_evidence_changed');
  return true;
}

async function requireEvidence(validateEvidence, batch, manifest) {
  if (typeof validateEvidence !== 'function') bad('evidence_validation_required');
  const batchHash = contentHash(batch), manifestHash = contentHash(manifest);
  let passed;
  try { passed = await validateEvidence({ batch: structuredClone(batch), manifest: structuredClone(manifest) }); }
  catch { bad('evidence_validation_failed'); }
  if (passed !== true || contentHash(batch) !== batchHash || contentHash(manifest) !== manifestHash) bad('evidence_validation_failed');
}

export async function runBatch50Import({ source, base, batch, manifest = authority, request, apply = false, approvedReport = null, saveSnapshot = null, validateEvidence = null, maxConflicts = 3 }) {
  precheckBatch50Import(source, base, batch, manifest);
  if (typeof request !== 'function') bad('request_adapter_required');
  if (!Number.isSafeInteger(maxConflicts) || maxConflicts < 0 || maxConflicts > 3) bad('invalid_retry_limit');
  if (apply && !approved(approvedReport, source, base, batch, manifest)) bad('dry_run_approval_required');
  if (apply && typeof saveSnapshot !== 'function') bad('backup_required');
  let conflicts = 0;
  for (;;) {
    // Validate actual captures and reviewed source files before every apply
    // attempt, including a CAS retry. Dry-run remains an offline planning API.
    if (apply) await requireEvidence(validateEvidence, batch, manifest);
    let current; try { current = await request('GET'); } catch { bad('userdata_read_failed'); }
    if (current?.status !== 200) bad('userdata_read_failed');
    const plan = planBatch50Import(source, current.body, base, batch, manifest);
    if (!apply) return plan.report;
    const report = { ...plan.report, mode: 'apply', status: 'pending', passed: false, conflicts, writeAttempted: false, writeSucceeded: false };
    try { await saveSnapshot(`before-attempt-${conflicts + 1}`, plan.before); } catch { bad('pre_write_backup_failed', report); }
    report.writeAttempted = true; report.writeSucceeded = null;
    let response; try { response = await request('POST', plan.patch); } catch { bad('write_outcome_unknown', report); }
    if (response?.status === 409) { report.writeSucceeded = false; if (conflicts >= maxConflicts) bad('conflict_retry_limit', report); conflicts++; continue; }
    if (response?.status !== 200) {
      if ([400, 401, 403, 404, 405, 413, 422, 429].includes(response?.status)) report.writeSucceeded = false;
      bad('userdata_write_failed', report);
    }
    if (response.body?.status !== 'ok' || response.body?.revision !== plan.after.revision) bad('write_acknowledgement_invalid', report);
    report.writeSucceeded = true;
    let readback; try { readback = await request('GET'); } catch { bad('post_write_read_failed', report); }
    if (readback?.status !== 200) bad('post_write_read_failed', report);
    try { await saveSnapshot('after-write', readback.body); } catch { bad('post_write_backup_failed', report); }
    let verification; try { verification = verifyBatch50Write(plan, readback.body, batch); } catch { bad('post_write_verification_failed', report); }
    return { ...report, verification, passed: verification.passed, status: verification.passed ? 'applied_verified' : 'applied_verification_failed' };
  }
}

export function parseArguments(values) {
  const args = { apply: false }, fields = { '--origin': 'origin', '--source': 'sourceFile', '--results': 'resultsFile', '--output': 'outputFile', '--secret-file': 'secretFile', '--token-file': 'tokenFile', '--approved-report': 'approvedReportFile', '--backup-dir': 'backupDir' };
  for (let at = 0; at < values.length; at++) {
    if (values[at] === '--apply' && !args.apply) args.apply = true;
    else if (fields[values[at]] && !args[fields[values[at]]] && values[at + 1] && !values[at + 1].startsWith('--')) {
      const key = fields[values[at]];
      args[key] = values[++at];
    }
    else bad('invalid_arguments');
  }
  if (!args.origin || !args.sourceFile || !args.resultsFile || !args.outputFile || Boolean(args.secretFile) === Boolean(args.tokenFile)) bad('missing_arguments');
  if (args.apply && (!args.approvedReportFile || !args.backupDir)) bad('apply_requires_report_and_backup');
  if (!args.apply && (args.approvedReportFile || args.backupDir)) bad('unused_apply_arguments');
  return args;
}
async function readRegularJson(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) bad('input_must_be_regular_file');
  return strictJsonParse(await readFile(path, 'utf8'));
}
export async function main(values = process.argv.slice(2)) {
  let output = null, report = null;
  try {
    const args = parseArguments(values), origin = validateOrigin(args.origin), manifest = await loadFixedManifest();
    output = resolve(args.outputFile);
    try { await lstat(output); bad('output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const source = await readRegularJson(resolve(args.sourceFile)), batch = await readRegularJson(resolve(args.resultsFile));
    const { base } = await loadBaseLibrary();
    precheckBatch50Import(source, base, batch, manifest);
    const approvedReport = args.apply ? await readRegularJson(resolve(args.approvedReportFile)) : null;
    if (args.apply && !approved(approvedReport, source, base, batch, manifest)) bad('dry_run_approval_required');
    // Check evidence before even loading credentials or authenticating. The
    // runner checks the same files again before its first read and each retry.
    if (args.apply) await requireEvidence(validateBatch50Evidence, batch, manifest);
    const backupDir = args.apply ? resolve(args.backupDir) : null;
    if (backupDir) await mkdir(backupDir, { recursive: false, mode: 0o700 });
    const credentials = await readRegularJson(resolve(args.secretFile || args.tokenFile));
    if (!record(credentials)) bad('invalid_credentials');
    const request = await productionAdapter(origin, args.secretFile ? { APP_SECRET: credentials.APP_SECRET } : { token: credentials.token });
    report = await runBatch50Import({ source, base, batch, manifest, request, apply: args.apply, approvedReport, validateEvidence: validateBatch50Evidence,
      saveSnapshot: (name, value) => writeFile(resolve(backupDir, `${name}.private.json`), JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 }),
    });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, passed: report.passed, mode: report.mode, targetCount: report.targetCount, changedFields: report.changedFields, conflicts: report.conflicts ?? 0 }));
    return report.passed ? 0 : 1;
  } catch (error) {
    const code = error instanceof PilotError ? error.code : 'import_failed';
    report = { ...(error instanceof PilotError && error.report ? error.report : report || {}), status: code, passed: false };
    if (output) { try { await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); } catch { /* Never replace existing evidence. */ } }
    console.error(JSON.stringify({ status: code, passed: false, writeSucceeded: own(report, 'writeSucceeded') ? report.writeSucceeded : false }));
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
