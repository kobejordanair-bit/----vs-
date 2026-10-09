// Preserve an actual clipboard response and verify public prompt/context bindings.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strictJsonParse } from '../cloudflare/src/contracts.mjs';
import { PilotError, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { STATS_TARGETS, validateStatsRequest, parseStatsManuscript, statsContextPaths, contextArticle, searchEvidence, normalizeStatsExport } from './assemble-stats-results.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const bad = code => { throw new PilotError(code); };

export function captureStatsExport({ slug, request, bindings, referenceText, prompt, sourcePackage, contextFiles, raw, evidenceText, conversationUrl, generatedAt = new Date().toISOString() }) {
  validateStatsRequest(request, bindings);
  if (typeof referenceText !== 'string' || sha256(referenceText) !== bindings.referenceSha256) bad('stats_reference_changed');
  const target = STATS_TARGETS.find(value => value.slug === slug);
  if (!target) bad('unsupported_stats_capture');
  const item = request.records.find(value => value.id === target.id), binding = bindings.records.find(value => value.id === target.id);
  if (typeof raw !== 'string' || typeof prompt !== 'string' || sha256(prompt) !== item.promptSha256) bad('stats_prompt_changed');
  if (typeof sourcePackage !== 'string' || sha256(sourcePackage) !== binding.sourcePackageSha256) bad('source_package_changed');
  let url; try { url = new URL(conversationUrl); } catch { bad('invalid_capture_conversation'); }
  if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || !/^\/(?:g\/[^/]+\/)?c\/[a-zA-Z0-9-]+$/.test(url.pathname)
    || url.username || url.password || url.search || url.hash || !Number.isFinite(Date.parse(generatedAt))) bad('invalid_capture_conversation');
  const clean = normalizeStatsExport(raw), fields = parseStatsManuscript(clean.text, target.id), evidence = searchEvidence(evidenceText);
  const contexts = statsContextPaths(slug).map(context => {
    const text = contextFiles[context.path];
    if (typeof text !== 'string' || sha256(contextArticle(text, target.id, context.field)) !== item[`${context.field}Sha256`]) bad('stats_context_changed');
    return { field: context.field, path: context.path, sha256: sha256(text), articleSha256: item[`${context.field}Sha256`] };
  });
  return { text: clean.text, fields, capture: { provider: 'ChatGPT web', recordId: target.id, field: 'stats', conversationUrl: url.href, generatedAt,
    promptSha256: item.promptSha256, inputSha256: binding.inputSha256, sourcePackageSha256: binding.sourcePackageSha256,
    referencePath: bindings.referencePath, referenceSha256: bindings.referenceSha256,
    responseSha256: sha256(clean.text), fragments: [{ file: `${slug}.stats.raw.md`, sha256: sha256(raw) }], contextFiles: contexts,
    webSearchPerformed: true, webSearchVerified: true, webSearchEvidence: { uiLabel: evidence.label, visibleSearchCount: evidence.count,
      file: `analysis-pilot/drafts/${slug}.stats.search-evidence.txt`, sha256: evidence.sha256 },
    composition: 'Complete actual ChatGPT web response; only known source-card UI lines, escaped emphasis, completion-marker backticks and outer whitespace normalized. Raw clipboard retained. Scores and prose are not generated or rewritten.',
    removedCardLines: clean.removedCardLines,
  } };
}

export async function main(values = process.argv.slice(2)) {
  try {
    const [slug, conversationUrl, ...extra] = values;
    if (extra.length || !STATS_TARGETS.some(value => value.slug === slug) || !conversationUrl) bad('usage_slug_conversation_url_required');
    const request = strictJsonParse(await readFile(resolve(here, 'stats-request.v1.json'), 'utf8'));
    const bindings = strictJsonParse(await readFile(resolve(here, 'stats-input-bindings.v1.json'), 'utf8'));
    validateStatsRequest(request, bindings);
    const item = request.records.find(value => value.slug === slug), contextFiles = {};
    for (const context of statsContextPaths(slug)) contextFiles[context.path] = await readFile(resolve(here, '../', context.path), 'utf8');
    const input = { slug, request, bindings, conversationUrl, contextFiles, referenceText: await readFile(resolve(here, '../', bindings.referencePath), 'utf8'),
      prompt: await readFile(resolve(here, '../', item.promptPath), 'utf8'), sourcePackage: await readFile(resolve(here, '../', item.sourcePath), 'utf8'),
      raw: await readFile(resolve(here, 'drafts', `${slug}.stats.raw.md`), 'utf8'), evidenceText: await readFile(resolve(here, 'drafts', `${slug}.stats.search-evidence.txt`), 'utf8'),
    };
    const output = captureStatsExport(input);
    await writeFile(resolve(here, 'drafts', `${slug}.stats.md`), output.text, { flag: 'wx' });
    await writeFile(resolve(here, 'drafts', `${slug}.stats.capture.json`), JSON.stringify(output.capture, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: 'captured', slug, characters: output.text.length, responseSha256: output.capture.responseSha256, actualSearchCount: output.capture.webSearchEvidence.visibleSearchCount })); return 0;
  } catch (error) { console.error(JSON.stringify({ status: error instanceof PilotError ? error.code : 'stats_capture_failed', passed: false })); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
