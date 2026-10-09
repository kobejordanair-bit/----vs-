// Re-renders the original deep prompt with safe existing contexts, all 962
// ranking references and existing style samples. Does not touch old drafts.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PilotError, contentHash, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { FIGURE_PACKAGES } from './prepare-layer-request.mjs';
import { loadOriginalPromptMaterials, renderOriginalTemplate, writingSupplement } from './original-prompt-renderer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const bad = code => { throw new PilotError(code); };
const CONTEXT_FIELDS = ['id', 'name', 'type', 'dynasty', 'rank', 'title', 'tag', 'desc', 'poem'];
export function prepareDeepStyleRequest({ request, materials, sourcePackages, preparedAt = new Date().toISOString() }) {
  if (request.format !== 'dynasty-analysis-pilot-request' || request.schemaVersion !== 1 || request.onlyFill !== 'deepAnalysis' || request.targetCount !== 3 || request.records?.length !== 3) bad('invalid_deep_request');
  const records = FIGURE_PACKAGES.map(metadata => {
    const originalRecord = request.records.find(item => item.id === metadata.id);
    if (!originalRecord || !/^[a-f0-9]{64}$/.test(originalRecord.inputSha256)) bad('invalid_target_input_binding');
    const context = Object.fromEntries(CONTEXT_FIELDS.filter(field => Object.hasOwn(originalRecord.context || {}, field)).map(field => [field, originalRecord.context[field]]));
    if (context.id !== metadata.id || Object.values(context).some(value => typeof value !== 'string')) bad('invalid_safe_figure_context');
    const anchors = (originalRecord.anchors || []).map(item => Object.fromEntries(['id', 'name', 'type', 'dynasty', 'rank'].filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])));
    if (anchors.some(item => Object.values(item).some(value => typeof value !== 'string'))) bad('invalid_safe_anchor');
    const sample = materials.styles[`${context.type}.deepAnalysis`], sourceText = sourcePackages[metadata.slug];
    const marker = `<!-- PILOT_COMPLETE ${metadata.id} -->`;
    const originalPrompt = renderOriginalTemplate(materials.original.templates.deepCalibration, { legend: context, rankingRef: materials.rankingRef });
    const prompt = originalPrompt + writingSupplement({ field: 'deepAnalysis', sample, sourceText, marker });
    return {
      order: originalRecord.order, id: metadata.id, slug: metadata.slug, inputSha256: originalRecord.inputSha256, context, anchors,
      originalTemplateSha256: materials.original.templates.deepCalibration.templateSha256,
      renderedOriginalSha256: sha256(originalPrompt), styleSamplePath: sample.path, styleSampleSha256: sample.sha256,
      sourcePackagePath: `analysis-pilot/sources/${metadata.slug}.md`, sourcePackageSha256: sha256(sourceText),
      promptPath: `analysis-pilot/prompts/${metadata.slug}.deepAnalysis.style.v2.md`,
      marker, draftPath: `analysis-pilot/drafts/${metadata.slug}.style.v2.md`, capturePath: `analysis-pilot/drafts/${metadata.slug}.style.v2.capture.json`, reviewPath: `analysis-pilot/source-review.${metadata.slug}.style.v2.json`,
      prompt, promptSha256: sha256(prompt),
    };
  });
  return {
    format: 'dynasty-analysis-pilot-request', schemaVersion: 1, preparedAt, revision: 'style-v2', basedOnRequestSha256: contentHash(request),
    baselineRevision: request.baselineRevision, libraryCount: materials.ranking.total, rankingReferenceSha256: contentHash(materials.ranking),
    onlyFill: 'deepAnalysis', targetCount: 3,
    policy: { originalPromptPreserved: true, existingStyleSamplesUsed: true, actualWebSearchRequired: true, originalDraftsPreserved: true, privateFieldsIncluded: false }, records,
  };
}
export async function main(values = process.argv.slice(2)) {
  try {
    if (values.length) bad('invalid_arguments');
    const request = JSON.parse(await readFile(resolve(here, 'request.v1.json'), 'utf8'));
    const materials = await loadOriginalPromptMaterials(), sourcePackages = {};
    for (const metadata of FIGURE_PACKAGES) sourcePackages[metadata.slug] = await readFile(resolve(here, 'sources', `${metadata.slug}.md`), 'utf8');
    const output = prepareDeepStyleRequest({ request, materials, sourcePackages });
    await mkdir(resolve(here, 'prompts'), { recursive: true });
    for (const item of output.records) await writeFile(resolve(here, 'prompts', `${item.slug}.deepAnalysis.style.v2.md`), item.prompt, { flag: 'wx', mode: 0o600 });
    await writeFile(resolve(here, 'request.style.v2.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'ready', targetCount: output.targetCount, libraryCount: output.libraryCount, requestSha256: contentHash(output), promptCharacters: output.records.map(item => item.prompt.length), originalDraftsPreserved: true }));
    return 0;
  } catch (error) { console.error(JSON.stringify({ status: error instanceof PilotError ? error.code : 'prepare_failed', passed: false })); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
