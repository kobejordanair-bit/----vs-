// Offline packaging of reviewed, actual ChatGPT web captures. Never generates
// historical prose, scores, credentials, HTTP requests or production imports.
import { writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse, record } from '../cloudflare/src/contracts.mjs';
import { PilotError, sha256, contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadFixedManifest, validateManifest, validateChunk, ANALYSIS_FORMAT } from './import.mjs';
import { TASKS, captureExport, loadCaptureInputs, readRegularText, validateRequest } from './capture.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const bad = code => { throw new PilotError(code); };
export const SOURCE_TYPES = Object.freeze(['primary_text', 'official_institution', 'scholarly_primary']);

export function validateSourceReview(review, capture, fields) {
  if (!record(review) || review.format !== 'dynasty-batch50-source-review' || review.schemaVersion !== 1
    || review.recordId !== capture.recordId || review.task !== capture.task || review.passed !== true
    || review.manuscriptSha256 !== capture.responseSha256 || review.rawResponseSha256 !== capture.rawResponseSha256
    || review.sourcePackageSha256 !== capture.sourcePackageSha256
    || !Array.isArray(review.materialIssues) || review.materialIssues.length
    || !Array.isArray(review.checkedSources) || !review.checkedSources.length) bad('source_review_missing_or_stale');
  if (review.stats !== undefined && !isDeepStrictEqual(review.stats, fields.stats)) bad('review_stats_mismatch');
  if (review.checks !== undefined && (!Array.isArray(review.checks) || !review.checks.length
    || review.checks.some(check => !record(check) || typeof check.id !== 'string' || !check.id.trim() || check.passed !== true || typeof check.detail !== 'string' || !check.detail.trim()))) bad('source_review_checks_failed');
  const sources = [], seen = new Set();
  for (const source of review.checkedSources) {
    let url; try { url = new URL(source?.url); } catch { bad('invalid_checked_source'); }
    if (url.protocol !== 'https:' || url.username || url.password || typeof source.title !== 'string' || !source.title.trim()
      || typeof source.locator !== 'string' || !source.locator.trim() || !SOURCE_TYPES.includes(source.type) || source.checked !== true) bad('invalid_checked_source');
    if (!seen.has(url.href)) { sources.push({ title: source.title, url: url.href, locator: source.locator, type: source.type, checked: true }); seen.add(url.href); }
  }
  for (const value of Object.values(fields)) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\)/g)) {
      let url; try { url = new URL(match[1]); } catch { bad('unreviewed_manuscript_source'); }
      if (url.protocol !== 'https:' || !seen.has(url.href)) bad('unreviewed_manuscript_source');
    }
  }
  return sources;
}

function verifiedTask({ manifest, request, task, inputs }) {
  if (!record(inputs)) bad('task_inputs_missing');
  const actual = captureExport({ ...inputs, manifest, request, task, conversationUrl: inputs.capture?.conversationUrl, generatedAt: inputs.capture?.generatedAt });
  if (!isDeepStrictEqual(inputs.capture, actual.capture) || inputs.response !== actual.text) bad('capture_missing_or_stale');
  if (!record(inputs.fieldsFiles) || !isDeepStrictEqual(Object.keys(inputs.fieldsFiles).sort(), Object.keys(actual.fields).sort())) bad('split_fields_missing');
  for (const [field, value] of Object.entries(actual.fields)) {
    const expected = field === 'stats' ? JSON.stringify(value) + '\n' : value + '\n';
    if (inputs.fieldsFiles[field] !== expected) bad('split_field_changed');
  }
  const checkedSources = validateSourceReview(inputs.review, actual.capture, actual.fields);
  const capture = actual.capture;
  const provenance = {
    task, promptSha256: capture.promptSha256, requestSha256: capture.requestSha256, inputSha256: capture.inputSha256,
    originalTemplateSha256: capture.originalTemplateSha256, renderedOriginalSha256: capture.renderedOriginalSha256, originalPromptVerified: capture.originalPromptVerified,
    sourcePackageSha256: capture.sourcePackageSha256, preservedDeepSha256: capture.preservedDeepSha256,
    conversationUrl: capture.conversationUrl, generatedAt: capture.generatedAt,
    rawResponseFile: capture.rawResponseFile, rawResponseSha256: capture.rawResponseSha256,
    responseFile: capture.responseFile, responseSha256: capture.responseSha256, fieldsHashes: capture.fieldsHashes,
    captureFile: `analysis-batch-51-100/drafts/${request.slug}.${task}.capture.json`, captureSha256: contentHash(capture),
    sourceReviewFile: `analysis-batch-51-100/reviews/${request.slug}.${task}.json`, sourceReviewSha256: contentHash(inputs.review),
    webSearchPerformed: true, webSearchVerified: true, webSearchEvidence: capture.webSearchEvidence, checkedSources,
  };
  if (capture.referencePath) Object.assign(provenance, { referencePath: capture.referencePath, referenceSha256: capture.referenceSha256 });
  if (capture.appendTemplateSha256) provenance.appendTemplateSha256 = capture.appendTemplateSha256;
  if (capture.analysisContextPath) Object.assign(provenance, { analysisContextPath: capture.analysisContextPath, analysisContextSha256: capture.analysisContextSha256 });
  return { fields: actual.fields, provenance, checkedSources };
}

export function assembleResults({ manifest, people }) {
  validateManifest(manifest);
  if (!Array.isArray(people) || !people.length || people.length > 5) bad('chunk_requires_one_to_five_people');
  const seen = new Set();
  const records = people.map(person => {
    const request = person?.request, target = validateRequest(manifest, request);
    if (seen.has(target.id) || !record(person.tasks) || !isDeepStrictEqual(Object.keys(person.tasks).sort(), [...TASKS].sort())) bad('duplicate_or_incomplete_person');
    seen.add(target.id);
    const analysis = verifiedTask({ manifest, request, task: 'analysisStats', inputs: person.tasks.analysisStats });
    const soulInputs = person.tasks.soulEssence;
    if (soulInputs.analysisContext !== analysis.fields.analysis + '\n') bad('soul_analysis_context_changed');
    const soul = verifiedTask({ manifest, request, task: 'soulEssence', inputs: soulInputs });
    const checkedSources = [], sourceUrls = new Set();
    for (const source of [...analysis.checkedSources, ...soul.checkedSources]) {
      if (!sourceUrls.has(source.url)) { checkedSources.push(source); sourceUrls.add(source.url); }
    }
    return {
      id: target.id, inputSha256: target.inputSha256,
      promptSha256: contentHash(Object.fromEntries(TASKS.map(task => [task, request.tasks[task].promptSha256]))),
      fields: { analysis: analysis.fields.analysis, soulEssence: soul.fields.soulEssence, stats: analysis.fields.stats, statsAnalysis: analysis.fields.statsAnalysis },
      provenance: { provider: 'ChatGPT web', conversationUrl: analysis.provenance.conversationUrl, generatedAt: soul.provenance.generatedAt,
        webSearchPerformed: true, checkedSources, requestSha256: contentHash(request), sourcePackageSha256: request.sourceSha256,
        preservedDeepSha256: request.preservedDeepSha256, perTask: { analysisStats: analysis.provenance, soulEssence: soul.provenance } },
    };
  });
  const batch = { format: 'dynasty-analysis-batch50-results', schemaVersion: 1, manifestSha256: contentHash(manifest), records };
  validateChunk(batch, manifest); return batch;
}

export function assembleAnalysisResults({ manifest, people }) {
  validateManifest(manifest);
  if (!Array.isArray(people) || !people.length || people.length > 5) bad('chunk_requires_one_to_five_people');
  const seen = new Set();
  const records = people.map(person => {
    const request = person?.request, target = validateRequest(manifest, request);
    if (seen.has(target.id) || !record(person.tasks) || !isDeepStrictEqual(Object.keys(person.tasks), ['analysisStats'])) bad('duplicate_or_incomplete_person');
    seen.add(target.id);
    const analysis = verifiedTask({ manifest, request, task: 'analysisStats', inputs: person.tasks.analysisStats });
    return { id: target.id, inputSha256: target.inputSha256,
      promptSha256: contentHash({ analysisStats: request.tasks.analysisStats.promptSha256 }),
      fields: analysis.fields,
      provenance: { provider: 'ChatGPT web', conversationUrl: analysis.provenance.conversationUrl, generatedAt: analysis.provenance.generatedAt,
        webSearchPerformed: true, checkedSources: analysis.checkedSources, requestSha256: contentHash(request), sourcePackageSha256: request.sourceSha256,
        preservedDeepSha256: request.preservedDeepSha256, perTask: { analysisStats: analysis.provenance } } };
  });
  const batch = { format: ANALYSIS_FORMAT, schemaVersion: 1, manifestSha256: contentHash(manifest), records };
  validateChunk(batch, manifest); return batch;
}

export async function loadAnalysisPerson(slug) { return loadPersonTasks(slug, ['analysisStats']); }

export async function loadPerson(slug) { return loadPersonTasks(slug, TASKS); }

async function loadPersonTasks(slug, taskNames) {
  const tasks = {};
  let request;
  for (const task of taskNames) {
    const inputs = await loadCaptureInputs(slug, task); request ??= inputs.request;
    const capture = strictJsonParse(await readRegularText(resolve(here, 'drafts', `${slug}.${task}.capture.json`)));
    const review = strictJsonParse(await readRegularText(resolve(here, 'reviews', `${slug}.${task}.json`)));
    const responsePath = `analysis-batch-51-100/drafts/${slug}.${task}.response.md`;
    if (capture.responseFile !== responsePath) bad('capture_response_path_changed');
    const response = await readRegularText(resolve(repo, responsePath));
    const fieldNames = task === 'analysisStats' ? ['analysis', 'stats', 'statsAnalysis'] : ['soulEssence'];
    const fieldsFiles = {};
    for (const field of fieldNames) fieldsFiles[field] = await readRegularText(resolve(here, 'drafts', `${slug}.${field}.${field === 'stats' ? 'json' : 'md'}`));
    tasks[task] = { ...inputs, capture, review, response, fieldsFiles };
  }
  return { request, tasks };
}

export async function main(values = process.argv.slice(2)) {
  try {
    let output, slugs = [], analysisOnly = false;
    for (let at = 0; at < values.length; at++) {
      if (values[at] === '--analysis-only' && !analysisOnly) analysisOnly = true;
      else if (values[at] === '--output' && !output && values[at + 1] && !values[at + 1].startsWith('--')) output = resolve(values[++at]);
      else if (/^(?:0[1-9]|[1-4]\d|50)$/.test(values[at])) slugs.push(values[at]);
      else bad('invalid_assembly_arguments');
    }
    if (!output || !slugs.length || slugs.length > 5 || new Set(slugs).size !== slugs.length) bad('usage_one_to_five_slugs_output_required');
    try { await lstat(output); bad('assembly_output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const manifest = await loadFixedManifest(), people = [];
    for (const slug of slugs) people.push(await (analysisOnly ? loadAnalysisPerson : loadPerson)(slug));
    const batch = (analysisOnly ? assembleAnalysisResults : assembleResults)({ manifest, people });
    await writeFile(output, JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: 'assembled', records: batch.records.length, fields: batch.records.length * (analysisOnly ? 3 : 4), batchSha256: contentHash(batch), actualCapturesAndSourceReviewsVerified: true })); return 0;
  } catch (error) { console.error(JSON.stringify({ status: error instanceof PilotError ? error.code : 'batch50_assembly_failed', passed: false })); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
