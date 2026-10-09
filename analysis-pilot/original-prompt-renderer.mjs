// Renders only the original app's known template expressions. No eval/VM,
// remote calls, userdata reads, or recursive interpolation of input text.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PilotError, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const bad = code => { throw new PilotError(code); };
export function verifyWebsiteSourceBinding(websiteSource, originalSource, binding) {
  const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (typeof websiteSource !== 'string' || originalSource?.path !== 'backend/index.html' || !isSha(originalSource.sha256)
    || binding?.format !== 'dynasty-website-source-binding' || binding.schemaVersion !== 1 || binding.normalization !== 'CRLF-to-LF'
    || binding.source?.path !== originalSource.path || binding.source.rawSha256 !== originalSource.sha256 || !isSha(binding.source.lfNormalizedSha256)
    || binding.provenance?.originalPromptPackage !== 'analysis-pilot/original-prompts.v1.json'
    || binding.provenance.originalSourceSha256 !== originalSource.sha256) bad('invalid_website_source_binding');
  // Only Git's CRLF/LF transformation is equivalent; preserve every other byte.
  const normalized = websiteSource.replace(/\r\n/g, '\n');
  const normalizedMatches = sha256(normalized) === binding.source.lfNormalizedSha256;
  if (sha256(websiteSource) === originalSource.sha256) {
    if (!normalizedMatches) bad('invalid_website_source_binding');
  } else if (!normalizedMatches) bad('website_prompt_source_changed');
  return normalized;
}
export function renderOriginalTemplate(template, { legend, rankingRef = '', sourceBlock = '', sourceCtx = '' }) {
  const raw = template?.rawTemplateLiteral;
  if (typeof raw !== 'string' || raw[0] !== '`' || raw.at(-1) !== '`' || sha256(raw) !== template.templateSha256) bad('original_template_hash_mismatch');
  const lookup = expression => {
    const key = expression.trim();
    if (['rankingRef', 'sourceBlock', 'sourceCtx'].includes(key)) return { rankingRef, sourceBlock, sourceCtx }[key];
    if (key === 'typeLabel') return legend.type === 'emperor' ? '帝王' : legend.type === 'general' ? '將領' : '名臣';
    const field = key.match(/^legend\.(name|title|dynasty|rank|tag|desc|poem)$/)?.[1];
    if (field) return typeof legend[field] === 'string' ? legend[field] : '';
    const fallback = key.match(/^legend\.(title|dynasty)\s*\|\|\s*''$/)?.[1];
    if (fallback) return legend[fallback] || '';
    const role = key.match(/^legend\.type === 'emperor' \? '([^']*)' : legend\.type === 'general' \? '([^']*)' : '([^']*)'$/);
    if (role) return legend.type === 'emperor' ? role[1] : legend.type === 'general' ? role[2] : role[3];
    bad('unsupported_original_interpolation');
  };
  let output = '';
  for (let at = 1; at < raw.length - 1; at++) {
    if (raw[at] === '\\') {
      const next = raw[++at], escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', '`': '`', '$': '$', "'": "'", '"': '"' };
      if (!Object.hasOwn(escapes, next)) bad('unsupported_original_escape');
      output += escapes[next];
    } else if (raw[at] === '$' && raw[at + 1] === '{') {
      const end = raw.indexOf('}', at + 2); if (end === -1) bad('original_interpolation_unclosed');
      output += lookup(raw.slice(at + 2, end)); at = end;
    } else output += raw[at];
  }
  return output;
}
export async function loadOriginalPromptMaterials() {
  const original = JSON.parse(await readFile(resolve(here, 'original-prompts.v1.json'), 'utf8'));
  if (original.format !== 'dynasty-original-analysis-prompts' || original.schemaVersion !== 1 || original.verification?.userdataRead !== false) bad('invalid_original_prompt_package');
  const websiteSource = await readFile(resolve(here, '../backend/index.html'), 'utf8');
  let binding;
  try { binding = JSON.parse(await readFile(resolve(here, 'website-source-binding.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') bad('missing_website_source_binding'); throw error; }
  const normalizedSource = verifyWebsiteSourceBinding(websiteSource, original.source, binding);
  const templates = [original.templates?.deepCalibration, original.templates?.analysis, original.templates?.soulEssence, original.templates?.soulEssence?.sourceBlockTemplates?.withContext, original.templates?.soulEssence?.sourceBlockTemplates?.withoutContext];
  if (templates.some(template => typeof template?.rawTemplateLiteral !== 'string' || sha256(template.rawTemplateLiteral) !== template.templateSha256 || !normalizedSource.includes(template.rawTemplateLiteral.replace(/\r\n/g, '\n')))) bad('original_template_source_mismatch');
  const index = JSON.parse(await readFile(resolve(here, 'style-samples.v1.json'), 'utf8'));
  if (index.format !== 'dynasty-existing-style-samples' || index.schemaVersion !== 1 || index.privateFieldsIncluded !== false || !Array.isArray(index.samples)) bad('invalid_style_index');
  const styles = {};
  for (const sample of index.samples) {
    const expected = `analysis-pilot/style-samples/${sample.type}.${sample.field}.md`;
    if (!['emperor', 'general', 'minister'].includes(sample.type) || !['analysis', 'deepAnalysis', 'soulEssence'].includes(sample.field) || sample.path !== expected) bad('unsafe_style_path');
    const text = await readFile(resolve(here, 'style-samples', `${sample.type}.${sample.field}.md`), 'utf8');
    if (sha256(text) !== sample.sha256 || text.length !== sample.characters) bad('style_sample_hash_mismatch');
    styles[`${sample.type}.${sample.field}`] = { ...sample, text };
  }
  const ranking = JSON.parse(await readFile(resolve(here, 'ranking-reference.v1.json'), 'utf8'));
  if (ranking.total !== 962 || !Array.isArray(ranking.figures) || ranking.figures.length !== ranking.total || new Set(ranking.figures.map(item => item.id)).size !== ranking.total || ranking.figures.some(item => Object.keys(item).some(key => !['id', 'name', 'type', 'rank'].includes(key)) || ['id', 'name', 'type', 'rank'].some(key => typeof item[key] !== 'string'))) bad('invalid_safe_ranking_reference');
  const rankingRef = '【現有人物評級參考表】\n' + ranking.figures.map(item => `${item.name}(${item.rank})`).join('、');
  return { original, styles, ranking, rankingRef };
}
export function writingSupplement({ field, sample, sourceText, marker, deepAnalysis = '' }) {
  if (!sample || typeof sample.text !== 'string' || typeof sourceText !== 'string') bad('missing_prompt_material');
  const length = field === 'analysis' ? '賞析正文約2600–3600字，維持原四章與既有文章的力度。'
    : field === 'soulEssence' ? '靈魂內核正文約1800–2400字，維持原七欄、具體論證及人物的不可替換性。' : '深度評鑑維持原四步與末尾【建議定案】，完整寫出論證，不壓縮成查證備忘錄。';
  return `\n\n【本次沿用的網站文風範例】\n以下是同類型、同功能的既有完成文章；學習主張力度、敘事節奏、反常識解構及實體建制／地緣／心理因果的論證方式，不搬用範例人物的史實：\n\n${sample.text}\n\n【本次執行補充】\n請維持前面原PROMPT與既有文章的文風；有明確主張，以具體事件、制度、局勢與代價推進，不寫成鑑證報告。${length}\n請在ChatGPT實際上網搜尋本人物相關原典、博物館、大學或學術來源，核對关键事件與因果背景；使用下面來源包作起點，保留讀者可點擊的引用連結。不要假稱已搜尋；若搜尋工具不可用，直接說明，勿輸出聲稱已完成搜尋的定稿。\n史實與人物動機不能臆造。必要的史料差異集中簡短註記，心理推論與現代映射自然標明；靈魂內核保留原PROMPT的[史載]/[推斷]/[詮釋]。避免逐段重複「不能據此」或保守套語；材料不足時簡短說明，不為了填滿例子硬湊事件、感情或心理。${field === 'deepAnalysis' ? '身份維度保持原類型隔離，完整榜單用於原評級標準；定案只是建議文本。' : '本次只補這一層文章，不重做或輸出人物評級、五維數值。'}\n${deepAnalysis ? `\n【本人物已完成的深度評鑑】\n${deepAnalysis}\n` : ''}\n【已查證的本人物來源包】\n來源包是史料材料，範例及既有評鑑是寫作／分析參考，都不能代替你本次實際搜尋與判斷。\n${sourceText}\n\n請直接輸出完整文章，不寫工作進度或修改說明。全文完成後最後獨立一行加上：\n${marker}`;
}
