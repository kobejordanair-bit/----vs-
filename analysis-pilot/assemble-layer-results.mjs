// Packages copied and reviewed ChatGPT responses without rewriting their prose.
// All five fields must pass capture/hash/completion/source-review gates first.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PilotError, contentHash, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_LAYERS, validateLayerBatch } from '../cloudflare/scripts/analysis-pilot-layers-import.mjs';
import { FIGURE_PACKAGES, sourceReferences } from './prepare-layer-request.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const bad = code => { throw new PilotError(code); };
export function validateLayerRequest(request) {
  if (request?.format !== 'dynasty-analysis-pilot-layer-request' || request.schemaVersion !== 1 || request.status !== 'ready' || request.targetCount !== 3 || request.missingFields !== 5 || request.records?.length !== 3) bad('layer_request_not_ready');
  for (const metadata of FIGURE_PACKAGES) {
    const item = request.records.find(record => record.id === metadata.id);
    if (!item || item.slug !== metadata.slug || !/^[a-f0-9]{64}$/.test(item.inputSha256) || item.sourcePackage?.path !== `analysis-pilot/sources/${metadata.slug}.md`) bad('invalid_layer_request_binding');
    const fields = Object.keys(item.layers || {}).sort();
    if (JSON.stringify(fields) !== JSON.stringify([...AUTHORIZED_LAYERS[item.id]].sort())) bad('unauthorized_layer_request');
    const hashes = {};
    for (const field of fields) {
      const task = item.layers[field];
      if (task.field !== field || task.marker !== `<!-- LAYER_COMPLETE ${item.id} ${field} -->` || typeof task.prompt !== 'string' || task.promptSha256 !== sha256(task.prompt)
        || task.draftPath !== `analysis-pilot/drafts/${metadata.slug}.${field}.md` || task.capturePath !== `analysis-pilot/drafts/${metadata.slug}.${field}.capture.json` || task.reviewPath !== `analysis-pilot/source-review.${metadata.slug}.${field}.json`) bad('invalid_layer_task_binding');
      const expectedContext = field === 'soulEssence' ? `analysis-pilot/drafts/${metadata.slug === 'wangjian' ? 'wangjian.existing.analysis' : `${metadata.slug}.analysis`}.md` : null;
      if (!Array.isArray(task.contextPaths) || (expectedContext ? task.contextPaths.length !== 1 || task.contextPaths[0].path !== expectedContext : task.contextPaths.length !== 0)) bad('invalid_layer_context_binding');
      hashes[field] = task.promptSha256;
    }
    if (item.promptSha256 !== contentHash(hashes)) bad('aggregate_prompt_hash_mismatch');
  }
  return request;
}
export function assembleLayerResults({ request, sourcePackages, drafts, captures, reviews, backgroundFiles = {} }) {
  validateLayerRequest(request);
  const records = FIGURE_PACKAGES.map(metadata => {
    const item = request.records.find(record => record.id === metadata.id), sourceText = sourcePackages[metadata.slug];
    if (typeof sourceText !== 'string' || sha256(sourceText) !== item.sourcePackage.sha256) bad('source_package_changed');
    const fields = {}, perField = [], checkedSources = sourceReferences(sourceText, metadata);
    const seenUrls = new Set(checkedSources.map(source => new URL(source.url).href));
    for (const [field, task] of Object.entries(item.layers)) {
      const key = `${metadata.slug}.${field}`, raw = drafts[key], capture = captures[key], qa = reviews[key];
      if (typeof raw !== 'string' || capture?.responseSha256 !== sha256(raw) || capture.promptSha256 !== task.promptSha256) bad('capture_missing_or_stale');
      if (capture.webSearchPerformed !== true && capture.webSearchVerified !== true) bad('web_search_not_verified');
      if ((capture.recordId && capture.recordId !== item.id) || (capture.field && capture.field !== field)) bad('capture_target_mismatch');
      const trimmed = raw.trimEnd();
      if (!trimmed.endsWith(task.marker) || trimmed.indexOf(task.marker) !== trimmed.lastIndexOf(task.marker)) bad('incomplete_capture');
      if (qa?.passed !== true || qa.manuscriptSha256 !== sha256(raw) || qa.sourcePackageSha256 !== sha256(sourceText)) bad('source_review_missing_or_stale');
      if ((qa.recordId && qa.recordId !== item.id) || (qa.field && qa.field !== field)) bad('source_review_target_mismatch');
      if (qa.checkedExternalSources !== undefined && !Array.isArray(qa.checkedExternalSources)) bad('invalid_external_sources');
      for (const source of qa.checkedExternalSources || []) {
        let url; try { url = new URL(source?.url); } catch { bad('invalid_external_source'); }
        if (url.protocol !== 'https:' || url.username || url.password || typeof source.title !== 'string' || !source.title.trim() || typeof source.locator !== 'string' || !source.locator.trim()) bad('invalid_external_source');
        if (!seenUrls.has(url.href)) { checkedSources.push({ title: source.title, url: url.href, locator: source.locator }); seenUrls.add(url.href); }
      }
      const verifiedContext = [];
      for (const context of task.contextPaths) {
        const text = backgroundFiles[context.path], capturedContext = capture.contextFiles?.find(value => value.path === context.path);
        if (typeof text !== 'string' || capturedContext?.sha256 !== sha256(text) || (context.expectedSha256 && context.expectedSha256 !== sha256(text))) bad('context_capture_missing_or_stale');
        verifiedContext.push({ path: context.path, sha256: sha256(text) });
      }
      fields[field] = trimmed.slice(0, -task.marker.length).trimEnd();
      perField.push({ field, promptSha256: task.promptSha256, rawResponseSha256: sha256(raw), captureFile: task.capturePath, sourceReviewFile: task.reviewPath, sourceReviewSha256: contentHash(qa),
        conversationUrl: capture.conversationUrl, generatedAt: capture.generatedAt, sourcePackageSha256: sha256(sourceText), contextFiles: verifiedContext,
        webSearchPerformed: true,
        webSearchEvidence: { captureFile: task.capturePath, verifiedFlag: capture.webSearchVerified === true ? 'webSearchVerified' : 'webSearchPerformed',
          ...(() => { const evidence = capture.webSearchEvidence ?? capture.searchEvidence; const label = typeof evidence === 'string' ? evidence : evidence?.uiLabel ?? evidence?.uiText ?? evidence?.label; return typeof label === 'string' && label.trim() ? { label: label.trim().slice(0, 300) } : {}; })(),
        },
      });
    }
    const latest = [...perField].sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))[0];
    return { id: item.id, inputSha256: item.inputSha256, promptSha256: item.promptSha256, fields,
      provenance: { provider: 'ChatGPT web', conversationUrl: latest.conversationUrl, generatedAt: latest.generatedAt, checkedSources,
        sourcePackageSha256: sha256(sourceText), perField, requestSha256: contentHash(request) },
    };
  });
  // Validates exact authorized IDs/fields, prose minimum and top-level provenance.
  const batch = { format: 'dynasty-analysis-pilot-layer-results', schemaVersion: 1, records }; validateLayerBatch(batch);
  for (const item of records) for (const field of item.provenance.perField) {
    // Check each capture URL/time, not only the latest record-level metadata.
    validateLayerBatch({ ...batch, records: batch.records.map(record => record.id === item.id ? { ...record, provenance: { ...record.provenance, conversationUrl: field.conversationUrl, generatedAt: field.generatedAt } } : record) });
  }
  return batch;
}
export async function main(values = process.argv.slice(2)) {
  try {
    const args = { output: resolve(here, 'layer-results.v1.json') }, seen = new Set();
    for (let at = 0; at < values.length; at++) {
      const key = { '--request': 'request', '--output': 'output' }[values[at]];
      if (!key || seen.has(key) || !values[at + 1] || values[at + 1].startsWith('--')) bad('invalid_arguments');
      seen.add(key); args[key] = resolve(values[++at]);
    }
    if (!args.request) bad('request_required');
    const request = validateLayerRequest(JSON.parse(await readFile(args.request, 'utf8'))), sourcePackages = {}, drafts = {}, captures = {}, reviews = {}, backgroundFiles = {};
    for (const metadata of FIGURE_PACKAGES) {
      sourcePackages[metadata.slug] = await readFile(resolve(here, 'sources', `${metadata.slug}.md`), 'utf8');
      const item = request.records.find(record => record.id === metadata.id);
      for (const field of Object.keys(item.layers)) {
        const key = `${metadata.slug}.${field}`;
        drafts[key] = await readFile(resolve(here, 'drafts', `${key}.md`), 'utf8');
        captures[key] = JSON.parse(await readFile(resolve(here, 'drafts', `${key}.capture.json`), 'utf8'));
        reviews[key] = JSON.parse(await readFile(resolve(here, `source-review.${key}.json`), 'utf8'));
        for (const context of item.layers[field].contextPaths) backgroundFiles[context.path] = await readFile(resolve(here, '../', context.path), 'utf8');
      }
    }
    const batch = assembleLayerResults({ request, sourcePackages, drafts, captures, reviews, backgroundFiles });
    await writeFile(args.output, JSON.stringify(batch, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'assembled', records: 3, fields: 5, batchSha256: contentHash(batch), captureQaHashesVerified: true })); return 0;
  } catch (error) { console.error(JSON.stringify({ status: error instanceof PilotError ? error.code : 'assembly_failed', passed: false })); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
