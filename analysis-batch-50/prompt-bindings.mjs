// Reproduces the staged prompt mechanically from the sealed app templates.
// No prompt, style sample, source package or historical prose is edited here.
import { loadOriginalPromptMaterials, renderOriginalTemplate, writingSupplement } from '../analysis-pilot/original-prompt-renderer.mjs';
import { PilotError, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';

// Every CLI/module start checks the archived source and all six literals in
// both the archive and current website before any public response is accepted.
const materials = await loadOriginalPromptMaterials();
const bad = code => { throw new PilotError(code); };

export function verifyTemplateHashes(request) {
  const analysis = materials.original.templates.analysis, soul = materials.original.templates.soulEssence;
  if (request.tasks.analysisStats.originalTemplateSha256 !== analysis.templateSha256
    || request.tasks.analysisStats.appendTemplateSha256 !== analysis.conditionalStatsAppend.templateSha256
    || request.tasks.soulEssence.originalTemplateSha256 !== soul.templateSha256) bad('original_task_template_changed');
}

export function renderBoundPrompt({ target, task, deepAnalysis, sourcePackage }) {
  const legend = target.context;
  if (task === 'analysisStats') {
    const template = materials.original.templates.analysis;
    const original = renderOriginalTemplate(template, { legend }) + renderOriginalTemplate(template.conditionalStatsAppend, { legend });
    const marker = `<!-- BATCH50_COMPLETE ${target.id} analysisStats -->`, reasonMarker = `<!-- STATS_REASONS_BEGIN ${target.id} -->`;
    const supplement = writingSupplement({ field: 'analysis', sample: materials.styles[legend.type + '.analysis'], sourceText: sourcePackage, marker, deepAnalysis })
      .replace('本次只補這一層文章，不重做或輸出人物評級、五維數值。', '本次補賞析與原第五章五維；保留既有評級與深度評鑑。');
    const prompt = original + supplement + `\n\n【網站五維格式與校準參照】\n請完整讀取 analysis-batch-50/stats-reference.v1.json 既有66人的五維，依同類型可比人物校準。第一行僅輸出原PROMPT要求的單一JSON，五維皆為0–100整數；接著完整寫四章賞析。第五章前另加独立一行 ${reasonMarker}；第五章維持原【五維能力數值】，每維用小標題「統率：數值」「武力：數值」「智謀：數值」「政治：數值」「魅力：數值」，順序固定，理由各約150–250字，以具體事件、同角色參照與能力短板推進，避免臆造。五維是分析模型，不冒充史料原載。全文最後仍用 ${marker}。此段只規定可匯入格式，不改原四章或文風。`;
    return { original, prompt, originalTemplateSha256: template.templateSha256, appendTemplateSha256: template.conditionalStatsAppend.templateSha256 };
  }
  if (task !== 'soulEssence') bad('unsupported_prompt_task');
  const template = materials.original.templates.soulEssence;
  const sourceCtx = `【賞析】\n請先完整讀取本人物已完成、查核後的賞析：analysis-batch-50/drafts/${target.slug}.analysis.md\n\n【深度評鑑】\n${deepAnalysis.slice(0, 2000)}\n\n`;
  const sourceBlock = renderOriginalTemplate(template.sourceBlockTemplates.withContext, { legend, sourceCtx });
  const original = renderOriginalTemplate(template, { legend, sourceBlock });
  const marker = `<!-- BATCH50_COMPLETE ${target.id} soulEssence -->`;
  const prompt = original + `\n\n請先透過工作區連接完整讀取上面本人物賞析，以及 ${target.preserved.deepAnalysis.path} 的完整深度評鑑，不能只用上面2000字節錄；賞析尚未完成時請等待，不要用其他人的文章或聊天替代。\n`
    + writingSupplement({ field: 'soulEssence', sample: materials.styles[legend.type + '.soulEssence'], sourceText: sourcePackage, marker });
  return { original, prompt, originalTemplateSha256: template.templateSha256 };
}

export function verifyOriginalPromptBinding({ target, request, task, prompt, deepAnalysis, sourcePackage }) {
  verifyTemplateHashes(request);
  const expected = renderBoundPrompt({ target, task, deepAnalysis, sourcePackage }), item = request.tasks[task];
  const renderedOriginalSha256 = sha256(expected.original);
  if (item.renderedOriginalSha256 !== renderedOriginalSha256) bad('rendered_original_prompt_changed');
  if (typeof prompt !== 'string' || !prompt.startsWith(expected.original)) bad('original_prompt_prefix_changed');
  // Reconstructing the full frozen prompt also prevents replacing the suffix
  // and merely updating its claimed task SHA while retaining an intact prefix.
  if (prompt !== expected.prompt || item.promptSha256 !== sha256(expected.prompt)) bad('staged_original_prompt_changed');
  return { originalTemplateSha256: expected.originalTemplateSha256, renderedOriginalSha256,
    ...(expected.appendTemplateSha256 ? { appendTemplateSha256: expected.appendTemplateSha256 } : {}), originalPromptVerified: true };
}

export async function recheckOriginalPromptMaterials() {
  // Do not allow a long-lived reader to rely solely on its initial module load.
  const current = await loadOriginalPromptMaterials();
  if (JSON.stringify(current.original.templates) !== JSON.stringify(materials.original.templates)) bad('original_templates_changed_after_load');
  return true;
}
