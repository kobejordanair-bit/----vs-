// Claude author mode (author-policy.v2.json). Claude writes one combined
// manuscript from the unchanged compiled packet; this file only splits, binds
// and assembles it. It never labels text as ChatGPT, never invents a
// conversation URL or browser evidence, and makes no production writes.
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse, record } from '../cloudflare/src/contracts.mjs';
import { PilotError, sha256, contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadFixedManifest, validateManifest, validateChunk, SOUL_FORMAT, validatePriorReceiptDocument } from './import.mjs';
import { TASKS, ANALYSIS_LABELS, validateRequest, validateArticleSections, parseManuscript, fieldHashes, readRegularText } from './capture.mjs';
import { verifyOriginalPromptBinding, recheckOriginalPromptMaterials } from './prompt-bindings.mjs';
import { validateSourceReview } from './assemble.mjs';
import { quote } from './claude/archive-quote.mjs';
import { CLAUDE_PROVIDER, AUTHOR_POLICY_FILE, AUTHOR_POLICY_SHA256, validClaudeSessionUrl } from './claude/provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const bad = code => { throw new PilotError(code); };
// source_package_prior_review: the handoff source package recorded an earlier
// opened reading (locator + supported proposition); not reopened in this session.
export const SOURCE_ACCESS = Object.freeze(['fixed_revision_archive_fulltext', 'web_search_result_summary', 'source_package_prior_review']);
const COMPOSITION = 'Written directly by Claude from the unchanged compiled packet. Split mechanically at the two completion markers; prose and scores are not rewritten by this tool.';

export function splitClaudeCombined(raw, id) {
  if (typeof raw !== 'string' || raw.includes('\0') || raw.includes('\r')) bad('invalid_claude_manuscript');
  const analysisMarker = `<!-- BATCH50_COMPLETE ${id} analysisStats -->`, soulMarker = `<!-- BATCH50_COMPLETE ${id} soulEssence -->`;
  const lines = raw.trimEnd().split('\n');
  const cuts = lines.flatMap((line, at) => line === analysisMarker ? [at] : []);
  if (cuts.length !== 1 || lines.at(-1) !== soulMarker) bad('combined_incomplete');
  const parts = { analysisStats: lines.slice(0, cuts[0] + 1).join('\n') + '\n', soulEssence: lines.slice(cuts[0] + 1).join('\n').trim() + '\n' };
  return { parts, analysisFields: parseManuscript(parts.analysisStats, id, 'analysisStats'), soulFields: parseManuscript(parts.soulEssence, id, 'soulEssence') };
}

// The log records what was actually searched. Archive checks are re-run
// against the fixed-revision texts every time, so a quotation that is not in
// the archive fails here instead of passing on trust.
export async function verifySearchLog(log, recordId, packetSha256) {
  if (!record(log) || log.format !== 'dynasty-batch50-claude-search-log' || log.schemaVersion !== 1 || log.recordId !== recordId
    || log.packetSha256 !== packetSha256 || !Array.isArray(log.webSearches) || !log.webSearches.length
    || !Array.isArray(log.archiveChecks) || !Array.isArray(log.limits)) bad('invalid_search_log');
  // Modern figures have no classical archive text, so archive checks may be
  // empty; real web searches are always required.
  for (const search of log.webSearches) {
    if (!record(search) || search.tool !== 'WebSearch' || typeof search.query !== 'string' || !search.query.trim()
      || !Array.isArray(search.returnedUrls) || !search.returnedUrls.length
      || search.returnedUrls.some(url => { try { return new URL(url).protocol !== 'https:'; } catch { return true; } })) bad('invalid_search_log_entry');
  }
  for (const check of log.archiveChecks) {
    if (!record(check) || typeof check.book !== 'string' || typeof check.title !== 'string' || typeof check.quote !== 'string' || !check.quote.trim()) bad('invalid_archive_check');
    let result; try { result = await quote(check.book, check.title, check.quote); } catch { bad('archive_check_unavailable'); }
    if (!result.found || result.sourceUrl !== check.sourceUrl) bad('archive_check_failed');
  }
  return { webSearchCount: log.webSearches.length, archiveCheckCount: log.archiveChecks.length };
}

export function captureClaudeTask({ manifest, request, task, prompt, sourcePackage, deepAnalysis, statsReference = null, analysisContext = null, raw, searchLog, searchLogText, packetSha256, sessionUrl, generatedAt }) {
  const target = validateRequest(manifest, request), item = request.tasks[task];
  if (!item) bad('unsupported_capture_task');
  if (typeof prompt !== 'string' || sha256(prompt) !== item.promptSha256) bad('prompt_changed');
  if (typeof sourcePackage !== 'string' || sha256(sourcePackage) !== request.sourceSha256) bad('source_package_changed');
  if (typeof deepAnalysis !== 'string' || sha256(deepAnalysis) !== request.preservedDeepSha256) bad('preserved_deep_changed');
  const originalBinding = verifyOriginalPromptBinding({ target, request, task, prompt, deepAnalysis, sourcePackage });
  if (task === 'analysisStats' && (typeof statsReference !== 'string' || sha256(statsReference) !== item.referenceSha256)) bad('stats_reference_changed');
  if (task === 'soulEssence') validateArticleSections(analysisContext, ANALYSIS_LABELS, 800);
  if (!validClaudeSessionUrl(sessionUrl) || typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) bad('invalid_claude_session');
  if (typeof raw !== 'string' || raw.includes('\r')) bad('invalid_claude_manuscript');
  const fields = parseManuscript(raw, target.id, task);
  const capture = {
    format: 'dynasty-batch50-claude-capture', schemaVersion: 1, provider: CLAUDE_PROVIDER, recordId: target.id, slug: target.slug, task,
    sessionUrl, generatedAt, authorPolicyFile: AUTHOR_POLICY_FILE, authorPolicySha256: AUTHOR_POLICY_SHA256, combinedPacketSha256: packetSha256,
    requestSha256: contentHash(request), manifestSha256: contentHash(manifest), inputSha256: target.inputSha256,
    promptSha256: item.promptSha256, sourcePackageSha256: sha256(sourcePackage), preservedDeepSha256: sha256(deepAnalysis), ...originalBinding,
    rawResponseFile: `analysis-batch-50/drafts/${target.slug}.${task}.raw.md`, rawResponseSha256: sha256(raw),
    responseFile: `analysis-batch-50/drafts/${target.slug}.${task}.response.md`, responseSha256: sha256(raw), fieldsHashes: fieldHashes(fields),
    webSearchPerformed: true,
    searchLog: { file: `analysis-batch-50/drafts/${target.slug}.combined.search-log.json`, sha256: sha256(searchLogText),
      webSearchCount: searchLog.webSearches.length, archiveCheckCount: searchLog.archiveChecks.length },
    composition: COMPOSITION,
  };
  if (task === 'analysisStats') Object.assign(capture, { referencePath: item.referencePath, referenceSha256: item.referenceSha256 });
  if (task === 'soulEssence') Object.assign(capture, { analysisContextPath: item.contextPath, analysisContextSha256: sha256(analysisContext) });
  return { text: raw, fields, capture };
}

async function loadShared(slug) {
  await recheckOriginalPromptMaterials();
  const manifest = await loadFixedManifest(), target = manifest.records.find(item => item.slug === slug);
  if (!target) bad('usage_slug_required');
  const request = strictJsonParse(await readRegularText(resolve(here, 'tasks', `${slug}.json`)));
  validateRequest(manifest, request);
  const proof = strictJsonParse(await readRegularText(resolve(here, 'tasks', `${slug}.combined.json`)));
  const packet = await readRegularText(resolve(repo, proof.packetFile));
  if (proof.recordId !== target.id || sha256(packet) !== proof.packetSha256) bad('combined_prompt_changed');
  const searchLogText = await readRegularText(resolve(here, 'drafts', `${slug}.combined.search-log.json`));
  const searchLog = strictJsonParse(searchLogText);
  await verifySearchLog(searchLog, target.id, proof.packetSha256);
  const read = path => readRegularText(resolve(repo, path));
  return { manifest, target, request, packetSha256: proof.packetSha256, searchLog, searchLogText,
    prompts: Object.fromEntries(await Promise.all(TASKS.map(async task => [task, await read(request.tasks[task].promptFile)]))),
    sourcePackage: await read(target.sourcesPath), deepAnalysis: await read(target.preserved.deepAnalysis.path),
    statsReference: await read(request.tasks.analysisStats.referencePath) };
}

const taskInputs = (shared, task, raw, analysisContext) => ({ manifest: shared.manifest, request: shared.request, task, prompt: shared.prompts[task],
  sourcePackage: shared.sourcePackage, deepAnalysis: shared.deepAnalysis, statsReference: task === 'analysisStats' ? shared.statsReference : null,
  analysisContext: task === 'soulEssence' ? analysisContext : null, raw, searchLog: shared.searchLog, searchLogText: shared.searchLogText, packetSha256: shared.packetSha256 });

const fieldFile = field => field === 'stats' ? 'json' : 'md';
const fieldText = (field, value) => field === 'stats' ? JSON.stringify(value) + '\n' : value + '\n';

async function writeAllNew(outputs) {
  for (const [path] of outputs) { try { await lstat(path); bad('claude_output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  for (const [path, text] of outputs) await writeFile(path, text, { flag: 'wx' });
}

export async function split(slug, sessionUrl, generatedAt = new Date().toISOString()) {
  const shared = await loadShared(slug), raw = await readRegularText(resolve(here, 'drafts', `${slug}.combined.raw.md`));
  const { parts } = splitClaudeCombined(raw, shared.target.id);
  const analysis = captureClaudeTask({ ...taskInputs(shared, 'analysisStats', parts.analysisStats), sessionUrl, generatedAt });
  const analysisContext = analysis.fields.analysis + '\n';
  const soul = captureClaudeTask({ ...taskInputs(shared, 'soulEssence', parts.soulEssence, analysisContext), sessionUrl, generatedAt });
  const drafts = name => resolve(here, 'drafts', name), outputs = [];
  for (const [task, result] of [['analysisStats', analysis], ['soulEssence', soul]]) {
    outputs.push([drafts(`${slug}.${task}.raw.md`), result.text], [drafts(`${slug}.${task}.response.md`), result.text],
      [drafts(`${slug}.${task}.capture.json`), JSON.stringify(result.capture, null, 2) + '\n'],
      ...Object.entries(result.fields).map(([field, value]) => [drafts(`${slug}.${field}.${fieldFile(field)}`), fieldText(field, value)]));
  }
  outputs.push([drafts(`${slug}.combined.capture.json`), JSON.stringify({ format: 'dynasty-batch50-claude-combined', schemaVersion: 1, slug, recordId: shared.target.id,
    provider: CLAUDE_PROVIDER, sessionUrl, generatedAt, authorPolicySha256: AUTHOR_POLICY_SHA256, packetSha256: shared.packetSha256,
    combinedFile: `analysis-batch-50/drafts/${slug}.combined.raw.md`, combinedSha256: sha256(raw), searchLogSha256: sha256(shared.searchLogText),
    parts: Object.fromEntries(Object.entries(parts).map(([task, text]) => [task, { rawFile: `analysis-batch-50/drafts/${slug}.${task}.raw.md`, rawSha256: sha256(text) }])),
    composition: COMPOSITION }, null, 2) + '\n']);
  await writeAllNew(outputs);
  return { status: 'split', slug, stats: analysis.fields.stats, analysisCharacters: analysis.fields.analysis.length, soulCharacters: soul.fields.soulEssence.length };
}

// Soul-only continuation (author-policy.v2.json, 06): the manuscript holds
// only the seven soul sections, written against the analysis that a verified
// apply receipt already published. It may not carry an analysis marker.
export function splitClaudeSoul(raw, id) {
  if (typeof raw !== 'string' || raw.includes('\0') || raw.includes('\r')) bad('invalid_claude_manuscript');
  const lines = raw.trimEnd().split('\n');
  if (lines.at(-1) !== `<!-- BATCH50_COMPLETE ${id} soulEssence -->` || lines.some(line => line === `<!-- BATCH50_COMPLETE ${id} analysisStats -->`)) bad('soul_continuation_incomplete');
  const text = lines.join('\n').trim() + '\n';
  return { text, soulFields: parseManuscript(text, id, 'soulEssence') };
}

const receiptPrior = (receipt, file, id) => ({ file, sha256: contentHash(receipt), afterRevision: receipt?.verification?.afterRevision,
  fieldHashes: Object.fromEntries((receipt?.writtenFieldHashes ?? []).filter(entry => entry?.id === id).map(entry => [entry.field, entry.sha256])) });

export async function splitSoulOnly(slug, sessionUrl, receiptFile, generatedAt = new Date().toISOString()) {
  const shared = await loadShared(slug), raw = await readRegularText(resolve(here, 'drafts', `${slug}.soulonly.raw.md`));
  const receipt = strictJsonParse(await readRegularText(resolve(repo, receiptFile)));
  const prior = receiptPrior(receipt, receiptFile, shared.target.id);
  validatePriorReceiptDocument(receipt, { id: shared.target.id, priorReceipt: prior }, shared.manifest);
  const context = await readRegularText(resolve(repo, shared.request.tasks.soulEssence.contextPath));
  if (sha256(context.replace(/\n$/, '')) !== prior.fieldHashes.analysis) bad('soul_context_not_published_analysis');
  const { text } = splitClaudeSoul(raw, shared.target.id);
  const soul = captureClaudeTask({ ...taskInputs(shared, 'soulEssence', text, context), sessionUrl, generatedAt });
  const drafts = name => resolve(here, 'drafts', name);
  await writeAllNew([[drafts(`${slug}.soulEssence.raw.md`), soul.text], [drafts(`${slug}.soulEssence.response.md`), soul.text],
    [drafts(`${slug}.soulEssence.capture.json`), JSON.stringify(soul.capture, null, 2) + '\n'],
    [drafts(`${slug}.soulEssence.md`), fieldText('soulEssence', soul.fields.soulEssence)],
    [drafts(`${slug}.soulonly.capture.json`), JSON.stringify({ format: 'dynasty-batch50-claude-soul-continuation', schemaVersion: 1, slug, recordId: shared.target.id,
      provider: CLAUDE_PROVIDER, sessionUrl, generatedAt, authorPolicySha256: AUTHOR_POLICY_SHA256, packetSha256: shared.packetSha256,
      manuscriptFile: `analysis-batch-50/drafts/${slug}.soulonly.raw.md`, manuscriptSha256: sha256(raw), priorReceipt: prior,
      analysisContextPath: shared.request.tasks.soulEssence.contextPath, composition: COMPOSITION }, null, 2) + '\n']]);
  return { status: 'split_soul_only', slug, soulCharacters: soul.fields.soulEssence.length, priorReceipt: receiptFile };
}

export async function loadClaudeSoulPerson(slug, receiptFile) {
  const shared = await loadShared(slug), task = 'soulEssence';
  const capture = strictJsonParse(await readRegularText(resolve(here, 'drafts', `${slug}.${task}.capture.json`)));
  const review = strictJsonParse(await readRegularText(resolve(here, 'reviews', `${slug}.${task}.json`)));
  const raw = await readRegularText(resolve(here, 'drafts', `${slug}.${task}.raw.md`));
  const response = await readRegularText(resolve(here, 'drafts', `${slug}.${task}.response.md`));
  const fieldsFiles = { soulEssence: await readRegularText(resolve(here, 'drafts', `${slug}.soulEssence.md`)) };
  const analysisContext = await readRegularText(resolve(repo, shared.request.tasks.soulEssence.contextPath));
  const receipt = strictJsonParse(await readRegularText(resolve(repo, receiptFile)));
  return { request: shared.request, receiptFile, receipt, task: { ...taskInputs(shared, task, raw, analysisContext), capture, review, response, fieldsFiles } };
}

export function assembleClaudeSoulResults({ manifest, people }) {
  validateManifest(manifest);
  if (!Array.isArray(people) || !people.length || people.length > 5) bad('chunk_requires_one_to_five_people');
  const seen = new Set();
  const records = people.map(person => {
    const request = person?.request, target = validateRequest(manifest, request);
    if (seen.has(target.id)) bad('duplicate_or_incomplete_person');
    seen.add(target.id);
    const priorReceipt = receiptPrior(person.receipt, person.receiptFile, target.id);
    validatePriorReceiptDocument(person.receipt, { id: target.id, priorReceipt }, manifest);
    if (typeof person.task?.analysisContext !== 'string' || sha256(person.task.analysisContext.replace(/\n$/, '')) !== priorReceipt.fieldHashes.analysis) bad('soul_context_not_published_analysis');
    const soul = verifiedClaudeTask(person.task);
    return { id: target.id, inputSha256: target.inputSha256, promptSha256: request.tasks.soulEssence.promptSha256,
      fields: { soulEssence: soul.fields.soulEssence }, priorReceipt,
      provenance: { provider: CLAUDE_PROVIDER, sessionUrl: soul.provenance.sessionUrl, generatedAt: soul.provenance.generatedAt,
        authorPolicySha256: AUTHOR_POLICY_SHA256, webSearchPerformed: true, checkedSources: soul.checkedSources, requestSha256: contentHash(request),
        sourcePackageSha256: request.sourceSha256, preservedDeepSha256: request.preservedDeepSha256, perTask: { soulEssence: soul.provenance } } };
  });
  const batch = { format: SOUL_FORMAT, schemaVersion: 1, manifestSha256: contentHash(manifest), records };
  validateChunk(batch, manifest); return batch;
}

export async function loadClaudePerson(slug) {
  const shared = await loadShared(slug), tasks = {};
  for (const task of TASKS) {
    const capture = strictJsonParse(await readRegularText(resolve(here, 'drafts', `${slug}.${task}.capture.json`)));
    const review = strictJsonParse(await readRegularText(resolve(here, 'reviews', `${slug}.${task}.json`)));
    const raw = await readRegularText(resolve(here, 'drafts', `${slug}.${task}.raw.md`));
    const response = await readRegularText(resolve(here, 'drafts', `${slug}.${task}.response.md`));
    const names = task === 'analysisStats' ? ['analysis', 'stats', 'statsAnalysis'] : ['soulEssence'], fieldsFiles = {};
    for (const field of names) fieldsFiles[field] = await readRegularText(resolve(here, 'drafts', `${slug}.${field}.${fieldFile(field)}`));
    const analysisContext = task === 'soulEssence' ? await readRegularText(resolve(repo, shared.request.tasks.soulEssence.contextPath)) : null;
    tasks[task] = { ...taskInputs(shared, task, raw, analysisContext), capture, review, response, fieldsFiles };
  }
  return { request: shared.request, tasks };
}

function verifiedClaudeTask(inputs) {
  const actual = captureClaudeTask({ ...inputs, sessionUrl: inputs.capture?.sessionUrl, generatedAt: inputs.capture?.generatedAt });
  if (!isDeepStrictEqual(inputs.capture, actual.capture) || inputs.response !== actual.text) bad('capture_missing_or_stale');
  for (const [field, value] of Object.entries(actual.fields)) if (inputs.fieldsFiles?.[field] !== fieldText(field, value)) bad('split_field_changed');
  if (inputs.review?.reviewer?.independent !== false || inputs.review.reviewer.provider !== CLAUDE_PROVIDER) bad('self_review_not_declared');
  const checkedSources = validateSourceReview(inputs.review, actual.capture, actual.fields);
  const access = new Map(inputs.review.checkedSources.map(source => [new URL(source.url).href, source.access]));
  for (const source of checkedSources) {
    source.access = access.get(source.url);
    if (!SOURCE_ACCESS.includes(source.access)) bad('source_access_not_declared');
  }
  const capture = actual.capture;
  return { fields: actual.fields, checkedSources, provenance: {
    task: capture.task, promptSha256: capture.promptSha256, requestSha256: capture.requestSha256, inputSha256: capture.inputSha256,
    originalTemplateSha256: capture.originalTemplateSha256, renderedOriginalSha256: capture.renderedOriginalSha256, originalPromptVerified: capture.originalPromptVerified,
    sourcePackageSha256: capture.sourcePackageSha256, preservedDeepSha256: capture.preservedDeepSha256, sessionUrl: capture.sessionUrl, generatedAt: capture.generatedAt,
    rawResponseFile: capture.rawResponseFile, rawResponseSha256: capture.rawResponseSha256, responseFile: capture.responseFile, responseSha256: capture.responseSha256,
    fieldsHashes: capture.fieldsHashes, captureFile: `analysis-batch-50/drafts/${capture.slug}.${capture.task}.capture.json`, captureSha256: contentHash(capture),
    sourceReviewFile: `analysis-batch-50/reviews/${capture.slug}.${capture.task}.json`, sourceReviewSha256: contentHash(inputs.review),
    webSearchPerformed: true, searchLog: capture.searchLog, checkedSources,
    ...(capture.referencePath ? { referencePath: capture.referencePath, referenceSha256: capture.referenceSha256 } : {}),
    ...(capture.appendTemplateSha256 ? { appendTemplateSha256: capture.appendTemplateSha256 } : {}),
    ...(capture.analysisContextPath ? { analysisContextPath: capture.analysisContextPath, analysisContextSha256: capture.analysisContextSha256 } : {}) } };
}

export function assembleClaudeResults({ manifest, people }) {
  validateManifest(manifest);
  if (!Array.isArray(people) || !people.length || people.length > 5) bad('chunk_requires_one_to_five_people');
  const seen = new Set();
  const records = people.map(person => {
    const request = person?.request, target = validateRequest(manifest, request);
    if (seen.has(target.id) || !record(person.tasks) || !isDeepStrictEqual(Object.keys(person.tasks).sort(), [...TASKS].sort())) bad('duplicate_or_incomplete_person');
    seen.add(target.id);
    const analysis = verifiedClaudeTask(person.tasks.analysisStats);
    if (person.tasks.soulEssence.analysisContext !== analysis.fields.analysis + '\n') bad('soul_analysis_context_changed');
    const soul = verifiedClaudeTask(person.tasks.soulEssence);
    const checkedSources = [], urls = new Set();
    for (const source of [...analysis.checkedSources, ...soul.checkedSources]) if (!urls.has(source.url)) { checkedSources.push(source); urls.add(source.url); }
    return { id: target.id, inputSha256: target.inputSha256,
      promptSha256: contentHash(Object.fromEntries(TASKS.map(task => [task, request.tasks[task].promptSha256]))),
      fields: { analysis: analysis.fields.analysis, soulEssence: soul.fields.soulEssence, stats: analysis.fields.stats, statsAnalysis: analysis.fields.statsAnalysis },
      provenance: { provider: CLAUDE_PROVIDER, sessionUrl: analysis.provenance.sessionUrl, generatedAt: soul.provenance.generatedAt,
        authorPolicySha256: AUTHOR_POLICY_SHA256, webSearchPerformed: true, checkedSources, requestSha256: contentHash(request),
        sourcePackageSha256: request.sourceSha256, preservedDeepSha256: request.preservedDeepSha256,
        perTask: { analysisStats: analysis.provenance, soulEssence: soul.provenance } } };
  });
  const batch = { format: 'dynasty-analysis-batch50-results', schemaVersion: 1, manifestSha256: contentHash(manifest), records };
  validateChunk(batch, manifest); return batch;
}

export async function main(values = process.argv.slice(2)) {
  try {
    const [mode, ...rest] = values;
    if (mode === 'split') {
      const [slug, sessionUrl, ...extra] = rest;
      if (extra.length || !/^(?:0[1-9]|[1-4]\d|50)$/.test(slug || '') || !validClaudeSessionUrl(sessionUrl)) bad('usage_split_slug_session_url');
      console.log(JSON.stringify(await split(slug, sessionUrl))); return 0;
    }
    if (mode === 'assemble') {
      let output; const slugs = [];
      for (let at = 0; at < rest.length; at++) {
        if (rest[at] === '--output' && !output && rest[at + 1]) output = resolve(rest[++at]);
        else if (/^(?:0[1-9]|[1-4]\d|50)$/.test(rest[at])) slugs.push(rest[at]); else bad('invalid_assembly_arguments');
      }
      if (!output || !slugs.length || slugs.length > 5 || new Set(slugs).size !== slugs.length) bad('usage_one_to_five_slugs_output_required');
      try { await lstat(output); bad('assembly_output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const manifest = await loadFixedManifest(), people = [];
      for (const slug of slugs) people.push(await loadClaudePerson(slug));
      const batch = assembleClaudeResults({ manifest, people });
      await writeFile(output, JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ status: 'assembled', provider: CLAUDE_PROVIDER, records: batch.records.length, fields: batch.records.length * 4, batchSha256: contentHash(batch) })); return 0;
    }
    bad('usage_mode_split_or_assemble');
  } catch (error) { console.error(JSON.stringify({ status: error instanceof PilotError ? error.code : 'claude_author_failed', passed: false, ...(error instanceof PilotError ? {} : { message: String(error?.message || error) }) })); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
