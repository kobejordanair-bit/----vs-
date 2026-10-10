// Reuses the sealed website prompts and existing prose; never authors history.
import {readFile,writeFile,mkdir,lstat,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadOriginalPromptMaterials,renderOriginalTemplate,writingSupplement} from '../analysis-pilot/original-prompt-renderer.mjs';
import {sha256,contentHash} from '../cloudflare/scripts/analysis-pilot-import.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await readFile(resolve(here,'manifest.v1.json'),'utf8'));
if(contentHash(manifest)!=='2a3b89a666da387061414e92b372b85f0c6562e19f750ff28b9d57e2e0a32700')throw new Error('sealed_manifest_changed');
const materials=await loadOriginalPromptMaterials();
for(const folder of ['prompts','tasks','drafts','reviews'])await mkdir(resolve(here,folder),{recursive:true});
const refreshStaging=process.argv.includes('--refresh-staging');
if(refreshStaging&&(await readdir(resolve(here,'drafts'))).length)throw new Error('cannot_refresh_after_generation');
const statsReferencePath='analysis-batch-50/stats-reference.v1.json';
const statsReferenceSha256=sha256(await readFile(resolve(here,'stats-reference.v1.json'),'utf8'));
let ready=0,pending=0;
for(const item of manifest.records){
 let source;
 try {const sourcePath=resolve(here,'sources',item.slug+'.md');const info=await lstat(sourcePath);if(!info.isFile()||info.isSymbolicLink())throw new Error('source_not_regular');source=await readFile(sourcePath,'utf8');}
 catch(error){if(error.code==='ENOENT'){pending++;continue;}throw error;}
 const deep=await readFile(resolve(here,'existing',item.slug+'.deepAnalysis.md'),'utf8');
 if(sha256(deep)!==item.preserved.deepAnalysis.sha256)throw new Error('preserved_deep_changed');
 const legend=item.context,analysisTemplate=materials.original.templates.analysis;
 const originalAnalysis=renderOriginalTemplate(analysisTemplate,{legend})+renderOriginalTemplate(analysisTemplate.conditionalStatsAppend,{legend});
 const analysisMarker=`<!-- BATCH50_COMPLETE ${item.id} analysisStats -->`;
 const reasonMarker=`<!-- STATS_REASONS_BEGIN ${item.id} -->`;
 const supplement=writingSupplement({field:'analysis',sample:materials.styles[legend.type+'.analysis'],sourceText:source,marker:analysisMarker,deepAnalysis:deep})
  .replace('本次只補這一層文章，不重做或輸出人物評級、五維數值。','本次補賞析與原第五章五維；保留既有評級與深度評鑑。');
 const analysisPrompt=originalAnalysis+supplement+`\n\n【網站五維格式與校準參照】\n請完整讀取 analysis-batch-50/stats-reference.v1.json 既有66人的五維，依同類型可比人物校準。第一行僅輸出原PROMPT要求的單一JSON，五維皆為0–100整數；接著完整寫四章賞析。第五章前另加独立一行 ${reasonMarker}；第五章維持原【五維能力數值】，每維用小標題「統率：數值」「武力：數值」「智謀：數值」「政治：數值」「魅力：數值」，順序固定，理由各約150–250字，以具體事件、同角色參照與能力短板推進，避免臆造。五維是分析模型，不冒充史料原載。全文最後仍用 ${analysisMarker}。此段只規定可匯入格式，不改原四章或文風。`;
 const soulTemplate=materials.original.templates.soulEssence;
 const sourceCtx=`【賞析】\n請先完整讀取本人物已完成、查核後的賞析：analysis-batch-50/drafts/${item.slug}.analysis.md\n\n【深度評鑑】\n${deep.slice(0,2000)}\n\n`;
 const sourceBlock=renderOriginalTemplate(soulTemplate.sourceBlockTemplates.withContext,{legend,sourceCtx});
 const originalSoul=renderOriginalTemplate(soulTemplate,{legend,sourceBlock});
 const soulMarker=`<!-- BATCH50_COMPLETE ${item.id} soulEssence -->`;
 const soulPrompt=originalSoul+`\n\n請先透過工作區連接完整讀取上面本人物賞析，以及 ${item.preserved.deepAnalysis.path} 的完整深度評鑑，不能只用上面2000字節錄；賞析尚未完成時請等待，不要用其他人的文章或聊天替代。\n`+writingSupplement({field:'soulEssence',sample:materials.styles[legend.type+'.soulEssence'],sourceText:source,marker:soulMarker});
 const tasks={format:'dynasty-batch50-person-request',schemaVersion:1,id:item.id,slug:item.slug,manifestSha256:contentHash(manifest),inputSha256:item.inputSha256,sourceSha256:sha256(source),preservedDeepSha256:sha256(deep),tasks:{analysisStats:{referencePath:statsReferencePath,referenceSha256:statsReferenceSha256,promptFile:`analysis-batch-50/prompts/${item.slug}.analysisStats.prompt.md`,promptSha256:sha256(analysisPrompt),originalTemplateSha256:analysisTemplate.templateSha256,appendTemplateSha256:analysisTemplate.conditionalStatsAppend.templateSha256,renderedOriginalSha256:sha256(originalAnalysis),marker:analysisMarker,reasonMarker},soulEssence:{promptFile:`analysis-batch-50/prompts/${item.slug}.soulEssence.prompt.md`,promptSha256:sha256(soulPrompt),originalTemplateSha256:soulTemplate.templateSha256,renderedOriginalSha256:sha256(originalSoul),marker:soulMarker,contextPath:`analysis-batch-50/drafts/${item.slug}.analysis.md`}}};
 for(const [file,text] of [[`prompts/${item.slug}.analysisStats.prompt.md`,analysisPrompt],[`prompts/${item.slug}.soulEssence.prompt.md`,soulPrompt],[`tasks/${item.slug}.json`,JSON.stringify(tasks,null,2)+'\n']]){
  try{await writeFile(resolve(here,file),text,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(sha256(await readFile(resolve(here,file),'utf8'))!==sha256(text)){if(!refreshStaging)throw new Error('staged_prompt_changed');await writeFile(resolve(here,file),text);}}
 }
 ready++;
}
console.log(JSON.stringify({status:'prompts_staged',ready,pending,originalTemplatesVerified:true,privateFieldsIncluded:false}));
