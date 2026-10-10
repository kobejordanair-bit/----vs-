// Mechanical preservation of an actual ChatGPT browser clipboard response.
// No model calls, history authoring, credentials or production writes.
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { strictJsonParse, record } from '../cloudflare/src/contracts.mjs';
import { PilotError, sha256, contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { validateStatsAnalysis } from '../cloudflare/scripts/analysis-pilot-stats-import.mjs';
import { normalizeExport } from '../analysis-pilot/normalize-chatgpt-export.mjs';
import { searchEvidence as legacySearchEvidence } from '../analysis-pilot/assemble-stats-results.mjs';
import { loadFixedManifest, validateManifest } from './import.mjs';
import { verifyTemplateHashes, verifyOriginalPromptBinding, recheckOriginalPromptMaterials } from './prompt-bindings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const bad = code => { throw new PilotError(code); };
const hashOk = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const TASKS = Object.freeze(['analysisStats', 'soulEssence']);
export const ANALYSIS_LABELS = Object.freeze(['歷史局勢與定位', '深度功過剖析', '人性與性格側寫', '如果生在現代']);
export const SOUL_LABELS = Object.freeze(['說話邏輯', '壓力反應', '核心驅動', '慣性盲點', '情感結構', '參照系', '內在裂縫']);

export function validateConversation(conversationUrl, generatedAt) {
  let url; try { url = new URL(conversationUrl); } catch { bad('invalid_capture_conversation'); }
  if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || !/^\/(?:g\/[^/]+\/)?c\/[a-zA-Z0-9-]+$/.test(url.pathname)
    || url.username || url.password || url.search || url.hash || typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) bad('invalid_capture_conversation');
  return url.href;
}

export function validateRequest(manifest, request) {
  validateManifest(manifest);
  const target = manifest.records.find(item => item.id === request?.id && item.slug === request?.slug);
  if (!target || !record(request) || request.format !== 'dynasty-batch50-person-request' || request.schemaVersion !== 1
    || request.manifestSha256 !== contentHash(manifest) || request.inputSha256 !== target.inputSha256
    || !hashOk(request.sourceSha256) || request.preservedDeepSha256 !== target.preserved.deepAnalysis.sha256
    || !record(request.tasks) || !isDeepStrictEqual(Object.keys(request.tasks).sort(), [...TASKS].sort())) bad('person_request_changed');
  for (const task of TASKS) {
    const item = request.tasks[task];
    if (!record(item) || item.promptFile !== `analysis-batch-51-100/prompts/${target.slug}.${task}.prompt.md`
      || !hashOk(item.promptSha256) || !hashOk(item.originalTemplateSha256) || !hashOk(item.renderedOriginalSha256)
      || item.marker !== `<!-- BATCH50_COMPLETE ${target.id} ${task} -->`) bad('task_request_changed');
  }
  const analysis = request.tasks.analysisStats;
  if (analysis.reasonMarker !== `<!-- STATS_REASONS_BEGIN ${target.id} -->` || !hashOk(analysis.appendTemplateSha256)) bad('task_request_changed');
  if (request.tasks.soulEssence.contextPath !== `analysis-batch-51-100/drafts/${target.slug}.analysis.md`) bad('task_request_changed');
  if (analysis.referencePath !== 'analysis-batch-51-100/stats-reference.v1.json' || !hashOk(analysis.referenceSha256)) bad('stats_reference_binding_invalid');
  verifyTemplateHashes(request);
  return target;
}

export function validateArticleSections(prose, labels, minimum) {
  if (typeof prose !== 'string' || prose.includes('\0') || prose.trim().length < minimum) bad('incomplete_article');
  const lines = prose.replace(/\r\n/g, '\n').split('\n'), sections = [];
  for (const [at, line] of lines.entries()) {
    const title = line.trim().replace(/^#{1,6}[ \t]+/, '').replace(/\*\*/g, '').replace(/^\d+[.)、．][ \t]*/, '');
    const match = title.match(/^【([^】]+)】(?:[ \t：:—–-].*)?$/);
    if (match && labels.includes(match[1])) sections.push({ label: match[1], at });
  }
  if (!isDeepStrictEqual(sections.map(item => item.label), labels)) bad('incomplete_article_sections');
  return sections.map((section, at) => {
    const body = lines.slice(section.at + 1, sections[at + 1]?.at ?? lines.length).join('\n').trim();
    if (body.length < 20) bad('incomplete_article_section');
    return body;
  });
}

export function normalizeBatchExport(raw) {
  if (typeof raw !== 'string' || raw.includes('\0')) bad('invalid_raw_capture');
  const normalized = normalizeExport(raw);
  const text = normalized.text.replace(/`(<!-- (?:BATCH50_COMPLETE|STATS_REASONS_BEGIN) [^>]+ -->)`/g, '$1').trim();
  // Observed clipboard exports can prefix a standalone transport marker with
  // one literal backslash. Only the exact reason line and terminal completion
  // are normalized; parsing still binds the ID/task and unique marker count.
  const reasons = text.replace(/^\\(<!-- STATS_REASONS_BEGIN [^\s<>]+ -->)$/gm, '$1');
  return { ...normalized, text: reasons.replace(/(^|\n)\\(<!-- BATCH50_COMPLETE [^\s<>]+ (?:analysisStats|soulEssence) -->)$/, '$1$2') + '\n' };
}

export function parseManuscript(text, id, task) {
  if (!TASKS.includes(task) || typeof text !== 'string' || text.includes('\0')) bad('invalid_manuscript');
  const trimmed = text.trimEnd(), marker = `<!-- BATCH50_COMPLETE ${id} ${task} -->`;
  if (!trimmed.endsWith(marker) || trimmed.indexOf(marker) !== trimmed.lastIndexOf(marker)
    || (trimmed.match(/<!--\s*(?:BATCH50|PILOT|LAYER|STATS)_COMPLETE\b/g) || []).length !== 1
    || trimmed.split('\n').at(-1).trim() !== marker) bad('incomplete_actual_capture');
  const body = trimmed.slice(0, -marker.length).trim();
  if (!/\[[^\]\n]+\]\(https:\/\/[^\s)]+\)/.test(body)) bad('source_links_required');
  if (task === 'soulEssence') {
    if (/<!--\s*STATS_REASONS_BEGIN\b/.test(body)) bad('unexpected_stats_transport');
    const sections = validateArticleSections(body, SOUL_LABELS, 1000);
    if (sections.some(section => !/\[(?:史載|推斷|詮釋)\]/.test(section))) bad('soul_annotations_missing');
    return { soulEssence: body };
  }
  const lineEnd = body.indexOf('\n');
  let object; try { object = strictJsonParse(body.slice(0, lineEnd).trim()); } catch { bad('first_line_stats_json_required'); }
  if (lineEnd < 0 || !record(object) || !isDeepStrictEqual(Object.keys(object), ['stats'])
    || !Array.isArray(object.stats) || object.stats.length !== 5 || !object.stats.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100)) bad('invalid_stats_values');
  const reasonMarker = `<!-- STATS_REASONS_BEGIN ${id} -->`, lines = body.slice(lineEnd + 1).split('\n');
  const indices = lines.flatMap((line, at) => line.trim() === reasonMarker ? [at] : []);
  if (indices.length !== 1 || (body.match(/<!--\s*STATS_REASONS_BEGIN\b/g) || []).length !== 1) bad('stats_reason_separator_missing');
  const analysis = lines.slice(0, indices[0]).join('\n').trim(), statsAnalysis = lines.slice(indices[0] + 1).join('\n').trim();
  validateArticleSections(analysis, ANALYSIS_LABELS, 800);
  if (!/^(?:#{1,6}[ \t]+)?(?:\*\*)?(?:5[.)、．][ \t]*)?【五維能力數值】(?:\*\*)?[ \t]*$/m.test(statsAnalysis)) bad('stats_chapter_missing');
  validateStatsAnalysis(statsAnalysis, object.stats);
  return { analysis, stats: [...object.stats], statsAnalysis };
}

export function fieldHashes(fields) {
  return Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, field === 'stats' ? contentHash(value) : sha256(value)]));
}

export function batchSearchEvidence(text) {
  if (typeof text !== 'string') bad('actual_search_evidence_required');
  const matches = [...text.matchAll(/(?:已搜尋\s*(\d+)\s*個網站|Searched\s+(\d+)\s+(?:sites|websites))/gi)];
  const counts = matches.map(match => Number(match[1] ?? match[2]));
  if (!counts.length || counts.some(count => !Number.isSafeInteger(count) || count < 1)) bad('actual_search_evidence_required');
  // Preserve existing sealed captures exactly, including their label and keys.
  if (new Set(counts).size === 1) return legacySearchEvidence(text);
  const count = counts.at(-1);
  return { count, counts, sha256: sha256(text),
    label: `ChatGPT 思考摘要：各搜尋段落依序顯示 ${counts.join('、')} 個網站；最後可見段 ${count} 個網站（非全程唯一網站總數）` };
}

export function captureExport({ manifest, request, task, prompt, sourcePackage, deepAnalysis, statsReference = null, analysisContext = null, raw, evidenceText, conversationUrl, generatedAt = new Date().toISOString() }) {
  const target = validateRequest(manifest, request), item = request.tasks[task];
  if (!item) bad('unsupported_capture_task');
  if (typeof prompt !== 'string' || sha256(prompt) !== item.promptSha256) bad('prompt_changed');
  if (typeof sourcePackage !== 'string' || sha256(sourcePackage) !== request.sourceSha256) bad('source_package_changed');
  if (typeof deepAnalysis !== 'string' || sha256(deepAnalysis) !== request.preservedDeepSha256) bad('preserved_deep_changed');
  const originalBinding = verifyOriginalPromptBinding({ target, request, task, prompt, deepAnalysis, sourcePackage });
  if (task === 'analysisStats' && item.referencePath && (typeof statsReference !== 'string' || sha256(statsReference) !== item.referenceSha256)) bad('stats_reference_changed');
  if (task === 'soulEssence') validateArticleSections(analysisContext, ANALYSIS_LABELS, 800);
  const url = validateConversation(conversationUrl, generatedAt), normalized = normalizeBatchExport(raw);
  const fields = parseManuscript(normalized.text, target.id, task), evidence = batchSearchEvidence(evidenceText);
  const capture = {
    format: 'dynasty-batch50-actual-capture', schemaVersion: 1, provider: 'ChatGPT web', recordId: target.id, slug: target.slug, task,
    conversationUrl: url, generatedAt, requestSha256: contentHash(request), manifestSha256: contentHash(manifest), inputSha256: target.inputSha256,
    promptSha256: item.promptSha256, sourcePackageSha256: sha256(sourcePackage), preservedDeepSha256: sha256(deepAnalysis),
    ...originalBinding,
    rawResponseFile: `analysis-batch-51-100/drafts/${target.slug}.${task}.raw.md`, rawResponseSha256: sha256(raw),
    responseFile: `analysis-batch-51-100/drafts/${target.slug}.${task}.response.md`, responseSha256: sha256(normalized.text), fieldsHashes: fieldHashes(fields),
    webSearchPerformed: true, webSearchVerified: true,
    webSearchEvidence: { file: `analysis-batch-51-100/drafts/${target.slug}.${task}.search-evidence.txt`, sha256: evidence.sha256, visibleSearchCount: evidence.count, uiLabel: evidence.label,
      ...(evidence.counts ? { visibleSearchCounts: [...evidence.counts], visibleSearchCountScope: 'last-visible-search-segment' } : {}) },
    removedCardLines: normalized.removedCardLines,
    composition: 'Actual browser clipboard retained. Only known ChatGPT export formatting normalized; transport metadata split mechanically. Scores and prose are neither authored nor rewritten.',
  };
  if (task === 'analysisStats' && item.referencePath) Object.assign(capture, { referencePath: item.referencePath, referenceSha256: item.referenceSha256 });
  if (task === 'soulEssence') Object.assign(capture, { analysisContextPath: item.contextPath, analysisContextSha256: sha256(analysisContext) });
  return { text: normalized.text, fields, capture };
}

export async function readRegularText(path) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) bad('input_must_be_regular_file');
  return readFile(path, 'utf8');
}
export async function loadCaptureInputs(slug, task) {
  await recheckOriginalPromptMaterials();
  const manifest = await loadFixedManifest(), target = manifest.records.find(item => item.slug === slug);
  if (!target || !TASKS.includes(task)) bad('usage_slug_task_required');
  const request = strictJsonParse(await readRegularText(resolve(here, 'tasks', `${slug}.json`)));
  validateRequest(manifest, request);
  const item = request.tasks[task];
  return { manifest, request, task,
    prompt: await readRegularText(resolve(repo, item.promptFile)), sourcePackage: await readRegularText(resolve(repo, target.sourcesPath)),
    deepAnalysis: await readRegularText(resolve(repo, target.preserved.deepAnalysis.path)),
    statsReference: task === 'analysisStats' && item.referencePath ? await readRegularText(resolve(repo, item.referencePath)) : null,
    analysisContext: task === 'soulEssence' ? await readRegularText(resolve(repo, item.contextPath)) : null,
    raw: await readRegularText(resolve(here, 'drafts', `${slug}.${task}.raw.md`)),
    evidenceText: await readRegularText(resolve(here, 'drafts', `${slug}.${task}.search-evidence.txt`)),
  };
}

export async function main(values = process.argv.slice(2)) {
  try {
    const [slug, task, conversationUrl, ...extra] = values;
    if (extra.length || !/^(?:0[1-9]|[1-4]\d|50)$/.test(slug || '') || !TASKS.includes(task) || !conversationUrl) bad('usage_slug_task_conversation_url_required');
    const result = captureExport({ ...await loadCaptureInputs(slug, task), conversationUrl });
    const outputs = [
      [`${slug}.${task}.response.md`, result.text], [`${slug}.${task}.capture.json`, JSON.stringify(result.capture, null, 2) + '\n'],
      ...Object.entries(result.fields).map(([field, value]) => [`${slug}.${field}.${field === 'stats' ? 'json' : 'md'}`, field === 'stats' ? JSON.stringify(value) + '\n' : value + '\n']),
    ];
    for (const [file] of outputs) { try { await lstat(resolve(here, 'drafts', file)); bad('capture_output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    for (const [file, text] of outputs) await writeFile(resolve(here, 'drafts', file), text, { flag: 'wx' });
    console.log(JSON.stringify({ status: 'captured', slug, task, characters: result.text.length, responseSha256: result.capture.responseSha256, actualSearchCount: result.capture.webSearchEvidence.visibleSearchCount })); return 0;
  } catch (error) { console.error(JSON.stringify({ status: error instanceof PilotError ? error.code : 'batch50_capture_failed', passed: false })); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
