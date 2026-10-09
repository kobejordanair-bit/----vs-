// Offline packaging of actual ChatGPT five-dimensional assessments. No scoring,
// article rewriting, credentials, HTTP access, or production imports happen here.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse } from '../cloudflare/src/contracts.mjs';
import { PilotError, contentHash, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_STATS_IDS, STATS_DIMENSIONS, validateStatsAnalysis, validateStatsBatch } from '../cloudflare/scripts/analysis-pilot-stats-import.mjs';
import { FIGURE_PACKAGES, sourceReferences } from './prepare-layer-request.mjs';
import { normalizeExport } from './normalize-chatgpt-export.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const bad = code => { throw new PilotError(code); };
const hashOk = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equalSet = (one, two) => Array.isArray(one) && isDeepStrictEqual([...one].sort(), [...two].sort());
const PUBLIC_CONTEXT_KEYS = ['id', 'name', 'type', 'dynasty', 'rank', 'title', 'tag', 'desc', 'poem'];
export const STATS_TARGETS = Object.freeze(FIGURE_PACKAGES.filter(item => AUTHORIZED_STATS_IDS.includes(item.id)));
export const statsContextPaths = slug => [
  { field: 'analysis', path: `analysis-pilot/drafts/${slug}.analysis.md` },
  { field: 'deepAnalysis', path: `analysis-pilot/drafts/${slug}.style.v2.md` },
  { field: 'soulEssence', path: `analysis-pilot/drafts/${slug}.soulEssence.md` },
];
export function normalizeStatsExport(raw) {
  const clean = normalizeExport(raw);
  const text = clean.text.replace(/`(<!-- STATS_COMPLETE [^>]+ -->)`/g, '$1').trim() + '\n';
  return { ...clean, text };
}

export function validateStatsRequest(request, bindings) {
  if (request?.format !== 'dynasty-stats-completion-request' || request.schemaVersion !== 1
    || !equalSet(request.allowedIds, AUTHORIZED_STATS_IDS) || !isDeepStrictEqual(request.statsOrder, STATS_DIMENSIONS)
    || request.records?.length !== 2 || !Number.isSafeInteger(request.baselineRevision)
    || request.baselineRevision < 0 || request.policy?.preserveAllExistingArticles !== true
    || request.policy?.preserveWangJianStats !== true || request.policy?.actualChatGPTWebAndWebSearchRequired !== true
    || request.policy?.privateStateExcluded !== true) bad('stats_request_invalid');
  if (bindings?.format !== 'dynasty-stats-input-bindings' || bindings.schemaVersion !== 1
    || bindings.baselineRevision !== request.baselineRevision || bindings.records?.length !== 2
    || bindings.referencePath !== 'analysis-pilot/stats-reference.v1.json' || !hashOk(bindings.referenceSha256)
    || !equalSet(bindings.records.map(item => item.id), AUTHORIZED_STATS_IDS)) bad('stats_input_bindings_invalid');
  if (!equalSet(request.records.map(item => item.id), AUTHORIZED_STATS_IDS)) bad('stats_request_invalid');
  for (const target of STATS_TARGETS) {
    const item = request.records.find(value => value.id === target.id), binding = bindings.records.find(value => value.id === target.id);
    if (item.slug !== target.slug || binding.slug !== target.slug || item.context?.id !== target.id
      || !equalSet(Object.keys(item.context), PUBLIC_CONTEXT_KEYS) || !Object.values(item.context).every(value => typeof value === 'string')
      || !hashOk(item.promptSha256) || !hashOk(item.analysisSha256) || !hashOk(item.deepAnalysisSha256) || !hashOk(item.soulEssenceSha256)
      || !hashOk(binding.inputSha256) || !hashOk(binding.sourcePackageSha256)
      || item.promptPath !== `analysis-pilot/prompts/${target.slug}.stats.prompt.md`
      || item.sourcePath !== `analysis-pilot/sources/${target.slug}.md`
      || item.outputPath !== `analysis-pilot/drafts/${target.slug}.stats.md`
      || item.marker !== `<!-- STATS_COMPLETE ${target.id} -->`) bad('stats_task_binding_invalid');
  }
  return request;
}

// The marker and first-line JSON are transport metadata. Everything between
// them becomes statsAnalysis verbatim, with only outer whitespace removed.
export function parseStatsManuscript(raw, id) {
  if (!AUTHORIZED_STATS_IDS.includes(id) || typeof raw !== 'string' || raw.includes('\0')) bad('invalid_stats_manuscript');
  const text = raw.trimEnd(), marker = `<!-- STATS_COMPLETE ${id} -->`;
  if (!text.endsWith(marker) || text.indexOf(marker) !== text.lastIndexOf(marker)
    || (text.match(/<!--\s*(?:STATS|LAYER|PILOT)_COMPLETE\b/g) || []).length !== 1) bad('incomplete_stats_capture');
  const lineEnd = text.indexOf('\n');
  if (lineEnd < 0) bad('first_line_stats_json_required');
  let object; try { object = strictJsonParse(text.slice(0, lineEnd).trim()); } catch { bad('first_line_stats_json_required'); }
  if (!object || Array.isArray(object) || !isDeepStrictEqual(Object.keys(object), ['stats'])
    || !Array.isArray(object.stats) || object.stats.length !== 5
    || !object.stats.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100)) bad('invalid_stats_values');
  const prose = text.slice(lineEnd + 1, -marker.length).trim();
  if (!/\[[^\]\n]+\]\(https:\/\/[^\s)]+\)/.test(prose)) bad('stats_source_links_required');
  validateStatsAnalysis(prose, object.stats);
  return { stats: [...object.stats], statsAnalysis: prose };
}

export function contextArticle(text, id, field) {
  if (typeof text !== 'string') bad('stats_context_missing');
  const marker = field === 'deepAnalysis' ? `<!-- PILOT_COMPLETE ${id} -->` : `<!-- LAYER_COMPLETE ${id} ${field} -->`;
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith(marker) || trimmed.indexOf(marker) !== trimmed.lastIndexOf(marker)) bad('stats_context_incomplete');
  return trimmed.slice(0, -marker.length).trimEnd();
}

export function searchEvidence(text) {
  if (typeof text !== 'string') bad('actual_search_evidence_required');
  const matches = [...text.matchAll(/(?:已搜尋\s*(\d+)\s*個網站|Searched\s+(\d+)\s+(?:sites|websites))/gi)];
  const counts = matches.map(match => Number(match[1] ?? match[2]));
  if (!counts.length || counts.some(count => !Number.isSafeInteger(count) || count < 1) || new Set(counts).size !== 1) bad('actual_search_evidence_required');
  return { count: counts[0], sha256: sha256(text), label: `ChatGPT 思考摘要：已搜尋 ${counts[0]} 個網站` };
}

function verifiedSources(packageText, target, review) {
  const sources = sourceReferences(packageText, target), seen = new Set(sources.map(item => new URL(item.url).href));
  if (!Array.isArray(review.checkedExternalSources)) bad('stats_review_sources_required');
  for (const source of review.checkedExternalSources) {
    let url; try { url = new URL(source?.url); } catch { bad('invalid_external_source'); }
    if (url.protocol !== 'https:' || url.username || url.password || typeof source.title !== 'string' || !source.title.trim()
      || typeof source.locator !== 'string' || !source.locator.trim()) bad('invalid_external_source');
    if (!seen.has(url.href)) { sources.push({ title: source.title, url: url.href, locator: source.locator }); seen.add(url.href); }
  }
  return sources;
}

export function assembleStatsResults({ request, bindings, referenceText, prompts, sourcePackages, contextFiles, drafts, captures, reviews, rawExports, searchEvidenceFiles }) {
  validateStatsRequest(request, bindings);
  if (typeof referenceText !== 'string' || sha256(referenceText) !== bindings.referenceSha256) bad('stats_reference_changed');
  const records = STATS_TARGETS.map(target => {
    const item = request.records.find(value => value.id === target.id), binding = bindings.records.find(value => value.id === target.id);
    const source = sourcePackages[target.slug], raw = drafts[target.slug], capture = captures[target.slug], qa = reviews[target.slug];
    if (typeof prompts[target.slug] !== 'string' || sha256(prompts[target.slug]) !== item.promptSha256) bad('stats_prompt_changed');
    if (typeof source !== 'string' || sha256(source) !== binding.sourcePackageSha256) bad('source_package_changed');
    if (typeof raw !== 'string' || capture?.provider !== 'ChatGPT web' || capture.recordId !== item.id || capture.field !== 'stats'
      || capture.promptSha256 !== item.promptSha256 || capture.responseSha256 !== sha256(raw)
      || capture.inputSha256 !== binding.inputSha256 || capture.sourcePackageSha256 !== sha256(source)) bad('stats_capture_missing_or_stale');
    if (capture.referencePath !== bindings.referencePath || capture.referenceSha256 !== bindings.referenceSha256) bad('stats_reference_capture_stale');
    if (capture.webSearchPerformed !== true || capture.webSearchVerified !== true) bad('web_search_not_verified');
    const evidence = searchEvidence(searchEvidenceFiles[target.slug]);
    if (capture.webSearchEvidence?.file !== `analysis-pilot/drafts/${target.slug}.stats.search-evidence.txt`
      || capture.webSearchEvidence.sha256 !== evidence.sha256 || capture.webSearchEvidence.visibleSearchCount !== evidence.count) bad('web_search_evidence_stale');
    if (typeof rawExports[target.slug] !== 'string' || capture.fragments?.length !== 1
      || capture.fragments[0].file !== `${target.slug}.stats.raw.md` || capture.fragments[0].sha256 !== sha256(rawExports[target.slug])) bad('raw_capture_missing_or_stale');
    if (normalizeStatsExport(rawExports[target.slug]).text !== raw) bad('response_differs_from_actual_export');
    if (qa?.passed !== true || qa.recordId !== item.id || qa.field !== 'stats'
      || qa.manuscriptSha256 !== sha256(raw) || qa.sourcePackageSha256 !== sha256(source)
      || !Array.isArray(qa.materialIssues) || qa.materialIssues.length) bad('source_review_missing_or_stale');
    const fields = parseStatsManuscript(raw, item.id);
    if (qa.stats !== undefined && !isDeepStrictEqual(qa.stats, fields.stats)) bad('review_stats_mismatch');
    const expectedContexts = statsContextPaths(target.slug), verifiedContext = [];
    if (!Array.isArray(capture.contextFiles) || capture.contextFiles.length !== expectedContexts.length
      || !equalSet(capture.contextFiles.map(value => value.path), expectedContexts.map(value => value.path))) bad('stats_context_capture_missing_or_stale');
    for (const context of expectedContexts) {
      const text = contextFiles[context.path], captured = capture.contextFiles.find(value => value.path === context.path);
      if (typeof text !== 'string' || captured.field !== context.field || captured.articleSha256 !== item[`${context.field}Sha256`]
        || captured.sha256 !== sha256(text) || sha256(contextArticle(text, item.id, context.field)) !== item[`${context.field}Sha256`]) bad('stats_context_capture_missing_or_stale');
      verifiedContext.push({ field: context.field, path: context.path, sha256: sha256(text), articleSha256: item[`${context.field}Sha256`] });
    }
    const checkedSources = verifiedSources(source, target, qa);
    const sources = new Set(checkedSources.map(value => new URL(value.url).href));
    for (const match of fields.statsAnalysis.matchAll(/\[[^\]\n]+\]\((https:\/\/[^\s)]+)\)/g)) {
      let url; try { url = new URL(match[1]); } catch { bad('unreviewed_manuscript_source'); }
      if (!sources.has(url.href)) bad('unreviewed_manuscript_source');
    }
    return { id: item.id, inputSha256: binding.inputSha256, promptSha256: item.promptSha256, fields,
      provenance: { provider: 'ChatGPT web', conversationUrl: capture.conversationUrl, generatedAt: capture.generatedAt,
        webSearchPerformed: true, checkedSources, sourcePackageSha256: sha256(source), contextFiles: verifiedContext,
        requestSha256: contentHash(request), inputBindingsSha256: contentHash(bindings), rawResponseSha256: sha256(raw),
        referencePath: bindings.referencePath, referenceSha256: bindings.referenceSha256, captureSha256: contentHash(capture),
        captureFile: `analysis-pilot/drafts/${target.slug}.stats.capture.json`, sourceReviewFile: `analysis-pilot/source-review.${target.slug}.stats.json`,
        sourceReviewSha256: contentHash(qa), webSearchEvidence: { file: capture.webSearchEvidence.file, sha256: evidence.sha256, visibleSearchCount: evidence.count, label: evidence.label },
      },
    };
  });
  const batch = { format: 'dynasty-analysis-pilot-stats-results', schemaVersion: 1, records };
  validateStatsBatch(batch); return batch;
}

export async function main(values = process.argv.slice(2)) {
  try {
    const args = { request: resolve(here, 'stats-request.v1.json'), bindings: resolve(here, 'stats-input-bindings.v1.json'), output: resolve(here, 'stats-results.v1.json') }, seen = new Set();
    for (let index = 0; index < values.length; index++) {
      const key = { '--request': 'request', '--bindings': 'bindings', '--output': 'output' }[values[index]];
      if (!key || seen.has(key) || !values[index + 1] || values[index + 1].startsWith('--')) bad('invalid_arguments');
      seen.add(key); args[key] = resolve(values[++index]);
    }
    const request = strictJsonParse(await readFile(args.request, 'utf8')), bindings = strictJsonParse(await readFile(args.bindings, 'utf8'));
    validateStatsRequest(request, bindings);
    const inputs = { request, bindings, referenceText: await readFile(resolve(here, '../', bindings.referencePath), 'utf8'), prompts: {}, sourcePackages: {}, contextFiles: {}, drafts: {}, captures: {}, reviews: {}, rawExports: {}, searchEvidenceFiles: {} };
    for (const item of request.records) {
      inputs.prompts[item.slug] = await readFile(resolve(here, '../', item.promptPath), 'utf8');
      inputs.sourcePackages[item.slug] = await readFile(resolve(here, '../', item.sourcePath), 'utf8');
      inputs.drafts[item.slug] = await readFile(resolve(here, 'drafts', `${item.slug}.stats.md`), 'utf8');
      inputs.captures[item.slug] = strictJsonParse(await readFile(resolve(here, 'drafts', `${item.slug}.stats.capture.json`), 'utf8'));
      inputs.reviews[item.slug] = strictJsonParse(await readFile(resolve(here, `source-review.${item.slug}.stats.json`), 'utf8'));
      inputs.rawExports[item.slug] = await readFile(resolve(here, 'drafts', `${item.slug}.stats.raw.md`), 'utf8');
      inputs.searchEvidenceFiles[item.slug] = await readFile(resolve(here, 'drafts', `${item.slug}.stats.search-evidence.txt`), 'utf8');
      for (const context of statsContextPaths(item.slug)) inputs.contextFiles[context.path] = await readFile(resolve(here, '../', context.path), 'utf8');
    }
    const batch = assembleStatsResults(inputs);
    await writeFile(args.output, JSON.stringify(batch, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'assembled', records: 2, fields: 4, batchSha256: contentHash(batch), captureQaHashesVerified: true })); return 0;
  } catch (error) { console.error(JSON.stringify({ status: error instanceof PilotError ? error.code : 'stats_assembly_failed', passed: false })); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
