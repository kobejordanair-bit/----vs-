// Stages only the three selected figures. Prompts are supplied by the root
// agent from the app's original prompts and existing writing examples; this
// helper never authors, evaluates or rewrites a prompt or historical prose.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strictJsonParse } from '../cloudflare/src/contracts.mjs';
import { PilotError, sourceUserdata, contentHash, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_LAYERS, layerFigureInput, layerInputSha256 } from '../cloudflare/scripts/analysis-pilot-layers-import.mjs';
import { loadBaseLibrary } from '../cloudflare/scripts/audit-counts.mjs';
import { loadOriginalPromptMaterials, renderOriginalTemplate, writingSupplement } from './original-prompt-renderer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const bad = code => { throw new PilotError(code); };
const absent = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());
const CONTEXT_FIELDS = ['id', 'name', 'type', 'dynasty', 'rank', 'title', 'tag', 'desc', 'poem'];
export const FIGURE_PACKAGES = Object.freeze([
  { id: 'emperor_北魏孝文帝_33257620', slug: 'xiaowendi', titles: ['魏書卷七上・高祖紀上', '魏書卷七下・高祖紀下', '北史卷三・魏本紀第三'] },
  { id: 'general_王翦_306401394', slug: 'wangjian', titles: ['史記卷七十三・白起王翦列傳', '史記卷六・秦始皇本紀'] },
  { id: 'minister_姚崇_2003901767', slug: 'yaochong', titles: ['舊唐書卷九十六・姚崇傳', '新唐書卷一百二十四・姚崇傳', '資治通鑑卷二百一十一・唐紀二十七'] },
]);
export function sourceReferences(text, metadata) {
  const urls = [...new Set(text.match(/https:\/\/zh\.wikisource\.org\/w\/index\.php\?oldid=\d+/g) || [])];
  if (urls.length !== metadata.titles.length) bad('source_reference_count_mismatch');
  return urls.map((url, index) => ({ title: metadata.titles[index], url, locator: `analysis-pilot/sources/${metadata.slug}.md；原典節錄、卷次定位及版本雜湊見該來源包` }));
}

export function prepareLayerRequest({ source, base, sourcePackages, prompts = null, materials = null, preparedAt = new Date().toISOString() }) {
  const userdata = sourceUserdata(source), records = [];
  let missingFields = 0;
  for (const metadata of FIGURE_PACKAGES) {
    const figure = layerFigureInput(userdata, base, metadata.id);
    const fields = AUTHORIZED_LAYERS[metadata.id].filter(field => absent(figure[field]));
    // This request is for all five currently missing layers. A changed source
    // must be reviewed before a different task set is issued.
    if (fields.length !== AUTHORIZED_LAYERS[metadata.id].length) bad('unexpected_missing_field_set');
    if (metadata.slug === 'wangjian' && (typeof figure.analysis !== 'string' || !figure.analysis.trim())) bad('existing_wangjian_analysis_required');
    const sourceText = sourcePackages?.[metadata.slug];
    if (typeof sourceText !== 'string' || !sourceText.trim()) bad('missing_source_package');
    const context = Object.fromEntries(CONTEXT_FIELDS.filter(field => Object.hasOwn(figure, field)).map(field => [field, figure[field]]));
    if (Object.values(context).some(value => typeof value !== 'string')) bad('non_text_figure_context');
    const layers = {};
    for (const field of fields) {
      const marker = `<!-- LAYER_COMPLETE ${metadata.id} ${field} -->`;
      let prompt = prompts ? prompts[`${metadata.slug}.${field}`] : null, template = null, originalPrompt = null, sample = null;
      const contextPaths = field === 'soulEssence' ? [{ role: 'analysis', path: `analysis-pilot/drafts/${metadata.slug === 'wangjian' ? 'wangjian.existing.analysis' : `${metadata.slug}.analysis`}.md`, expectedSha256: metadata.slug === 'wangjian' ? sha256(figure.analysis) : null }] : [];
      if (!prompts && materials) {
        template = materials.original.templates[field]; sample = materials.styles[`${context.type}.${field}`];
        const sourceCtx = `${field === 'soulEssence' ? `【賞析】\n請透過工作區外掛讀取完整歷史賞析稿：${contextPaths[0].path}\n\n` : ''}【深度評鑑】\n${figure.deepAnalysis.slice(0, 2000)}\n\n`;
        const sourceBlock = field === 'soulEssence' ? renderOriginalTemplate(template.sourceBlockTemplates.withContext, { legend: context, sourceCtx }) : '';
        originalPrompt = renderOriginalTemplate(template, { legend: context, sourceBlock });
        const contextInstruction = '\n\n請以繁體中文完成原PROMPT文章。' + (field === 'soulEssence' ? '\n本欄生成順序：先讀上面賞析檔的完整正文，再依原七欄生成；這是本人物歷史文章，不是聊天摘錄。若賞析檔尚未完成，等完成後再執行。本次背景資料不包含私人聊天或模擬存檔。' : '');
        prompt = originalPrompt + contextInstruction + writingSupplement({ field, sample, sourceText, marker, deepAnalysis: field === 'analysis' ? figure.deepAnalysis : '' });
      }
      if ((prompts || materials) && (typeof prompt !== 'string' || !prompt.trim() || !prompt.includes(marker))) bad('original_prompt_missing_or_incomplete');
      layers[field] = {
        field, marker,
        contextPaths,
        promptFile: `analysis-pilot/prompts/${metadata.slug}.${field}.prompt.md`, prompt, promptSha256: prompt === null ? null : sha256(prompt),
        ...(template ? { originalTemplateSha256: template.templateSha256, renderedOriginalSha256: sha256(originalPrompt), styleSamplePath: sample.path, styleSampleSha256: sample.sha256 } : {}),
        draftPath: `analysis-pilot/drafts/${metadata.slug}.${field}.md`,
        capturePath: `analysis-pilot/drafts/${metadata.slug}.${field}.capture.json`,
        reviewPath: `analysis-pilot/source-review.${metadata.slug}.${field}.json`,
      };
      missingFields++;
    }
    const preservedAnalysis = metadata.slug === 'wangjian' ? { field: 'analysis', characters: figure.analysis.length, sha256: sha256(figure.analysis), embedded: false, backgroundPath: 'analysis-pilot/drafts/wangjian.existing.analysis.md', action: 'preserve_exactly' } : null;
    records.push({
      id: metadata.id, slug: metadata.slug, inputSha256: layerInputSha256(userdata, base, metadata.id), context,
      deepAnalysis: { text: figure.deepAnalysis, sha256: sha256(figure.deepAnalysis), manuscriptPath: `analysis-pilot/drafts/${metadata.slug}.style.v2.md`, snapshotField: `modifiedLegends[${JSON.stringify(metadata.id)}].deepAnalysis` },
      sourcePackage: { path: `analysis-pilot/sources/${metadata.slug}.md`, sha256: sha256(sourceText), text: sourceText, checkedSources: sourceReferences(sourceText, metadata) },
      preservedAnalysis, layers,
      promptSha256: prompts || materials ? contentHash(Object.fromEntries(Object.entries(layers).map(([field, task]) => [field, task.promptSha256]))) : null,
    });
  }
  if (missingFields !== 5) bad('unexpected_missing_field_set');
  return {
    format: 'dynasty-analysis-pilot-layer-request', schemaVersion: 1, preparedAt,
    status: prompts || materials ? 'ready' : 'staged_waiting_prompts', baselineRevision: userdata.revision, targetCount: 3, missingFields,
    sourceSha256: contentHash(userdata), baseLibrarySha256: contentHash(base),
    policy: { reuseOriginalPrompts: true, preserveExistingWritingStyle: true, webSearchRequired: true, originalAnalysisPreserved: true, provenanceLocalOnly: true, websiteFieldsAllowed: ['analysis', 'soulEssence'] },
    records,
  };
}
export function parsePrepareArguments(values) {
  const result = { output: resolve(here, 'layer-request.v1.json') };
  const fields = { '--source': 'source', '--output': 'output', '--prompt-dir': 'promptDir' };
  const seen = new Set();
  for (let index = 0; index < values.length; index++) {
    const key = fields[values[index]];
    if (!key || seen.has(key) || !values[index + 1] || values[index + 1].startsWith('--')) bad('invalid_arguments');
    seen.add(key); result[key] = resolve(values[++index]);
  }
  if (!result.source) bad('source_required');
  return result;
}
export async function main(values = process.argv.slice(2)) {
  try {
    const args = parsePrepareArguments(values);
    try { await stat(args.output); bad('output_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const source = strictJsonParse(await readFile(args.source, 'utf8')), { base } = await loadBaseLibrary();
    const sourcePackages = {}, prompts = args.promptDir ? {} : null;
    for (const metadata of FIGURE_PACKAGES) {
      sourcePackages[metadata.slug] = await readFile(resolve(here, 'sources', `${metadata.slug}.md`), 'utf8');
      if (prompts) for (const field of AUTHORIZED_LAYERS[metadata.id]) prompts[`${metadata.slug}.${field}`] = await readFile(resolve(args.promptDir, `${metadata.slug}.${field}.prompt.md`), 'utf8');
    }
    const materials = prompts ? null : await loadOriginalPromptMaterials();
    const request = prepareLayerRequest({ source, base, sourcePackages, prompts, materials });
    const wang = request.records.find(item => item.slug === 'wangjian');
    if (sha256(await readFile(resolve(here, 'drafts/wangjian.existing.analysis.md'), 'utf8')) !== wang.preservedAnalysis.sha256) bad('existing_wangjian_analysis_changed');
    await mkdir(resolve(here, 'prompts'), { recursive: true });
    for (const item of request.records) for (const [field, task] of Object.entries(item.layers)) {
      const file = resolve(here, 'prompts', `${item.slug}.${field}.prompt.md`);
      try { await writeFile(file, task.prompt, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST' || sha256(await readFile(file, 'utf8')) !== task.promptSha256) bad('staged_prompt_exists_or_changed'); }
    }
    await mkdir(dirname(args.output), { recursive: true });
    await writeFile(args.output, JSON.stringify(request, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: request.status, targetCount: request.targetCount, missingFields: request.missingFields, baselineRevision: request.baselineRevision, requestSha256: contentHash(request) }));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ status: error instanceof PilotError ? error.code : 'prepare_failed', passed: false })); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
