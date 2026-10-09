// Root-only offline staging. Emits public figure/stat fields only, no chat or saves.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBaseLibrary } from '../cloudflare/scripts/audit-counts.mjs';
import { sourceUserdata, sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadOriginalPromptMaterials, renderOriginalTemplate } from './original-prompt-renderer.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const source = sourceUserdata(JSON.parse(await readFile(resolve(process.argv[2]), 'utf8')));
const { base } = await loadBaseLibrary();
const figures = [...base, ...source.customLegends].map(f => ({...f, ...source.modifiedLegends[f.id], id:f.id}));
const fields = ['id','name','type','dynasty','rank','title','tag','desc','poem'];
const safeContext = f => Object.fromEntries(fields.map(k=>[k,f[k]??'']));
const validStats = s => Array.isArray(s) && s.length===5 && s.every(n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=100);
const refs = figures.filter(f=>validStats(f.stats)).map(f=>({...safeContext(f),stats:f.stats}));
const materials = await loadOriginalPromptMaterials();
const originalAppend = renderOriginalTemplate(materials.original.templates.analysis.conditionalStatsAppend,{legend:{}});
const records = [];
for (const [id,slug] of [['emperor_北魏孝文帝_33257620','xiaowendi'],['minister_姚崇_2003901767','yaochong']]) {
  const f=figures.find(f=>f.id===id);
  if(!f || f.stats != null || !f.analysis || !f.deepAnalysis || !f.soulEssence) throw Error('unexpected_stats_task_scope');
  const context=safeContext(f);
  const originalAnalysis=renderOriginalTemplate(materials.original.templates.analysis,{legend:context});
  const marker=`<!-- STATS_COMPLETE ${id} -->`;
  const prompt=originalAnalysis+originalAppend+`\n\n【本次補完方式】\n原賞析四章已完成，請完整讀取 analysis-pilot/drafts/${slug}.analysis.md 及 ${slug}.style.v2.md、${slug}.soulEssence.md。這次僅補原第五章【五維能力數值】，不重寫前四章，不調整既有評級。維持原角色本位與具體事件的論證風格。五維是本遊戲的詮釋評分，以0–100的整數給出明確主張；武力是個人戰鬥/體能表現，不能把施政、出兵或勇於負責當成個人戰績。統率以軍隊組織、戰略指揮與作戰實績衡量，勿與政治混算；魅力考慮領導號召、信任與整合，也納入分裂代價。材料薄弱時簡短指出依據限度，不用反覆套語，也不造事例。\n請實際上網搜尋原典或官方學術來源，核對評分所用事件；analysis-pilot/sources/${slug}.md 是起點。讀取 analysis-pilot/stats-reference.v1.json 校對既有數值尺度，既有數值只作參照，不替其他人物重算。\n第一行只輸出原格式 JSON {\"stats\":[統率,武力,智謀,政治,魅力]}，隨後撰寫約700–1000字的第五章，按同順序五個小標題，各寫數值、加分理由、扣分或限制及具體事件，附可點擊Markdown來源連結。結尾簡短說明相對既有參照人物的尺度。此章將獨立保存為statsAnalysis，不拼接或覆蓋analysis。全文最後一行用inline code輸出 ${marker}。`;
  const promptPath=`analysis-pilot/prompts/${slug}.stats.prompt.md`;
  await writeFile(resolve(here,'prompts',`${slug}.stats.prompt.md`),prompt,{flag:'wx'});
  records.push({id,slug,context,promptPath,promptSha256:sha256(prompt),originalStatsAppendSha256:materials.original.templates.analysis.conditionalStatsAppend.templateSha256,analysisSha256:sha256(f.analysis),deepAnalysisSha256:sha256(f.deepAnalysis),soulEssenceSha256:sha256(f.soulEssence),sourcePath:`analysis-pilot/sources/${slug}.md`,outputPath:`analysis-pilot/drafts/${slug}.stats.md`,marker});
}
await writeFile(resolve(here,'stats-reference.v1.json'),JSON.stringify({format:'dynasty-public-stats-reference',schemaVersion:1,statsOrder:['統率','武力','智謀','政治','魅力'],scope:'Existing public historical figures and valid stats only; excludes chat, discussion and game saves.',figureCount:figures.length,referenceCount:refs.length,records:refs},null,2)+'\n',{flag:'wx'});
await writeFile(resolve(here,'stats-request.v1.json'),JSON.stringify({format:'dynasty-stats-completion-request',schemaVersion:1,preparedAt:new Date().toISOString(),baselineRevision:source.revision,statsOrder:['統率','武力','智謀','政治','魅力'],allowedIds:records.map(r=>r.id),policy:{preserveAllExistingArticles:true,preserveWangJianStats:true,actualChatGPTWebAndWebSearchRequired:true,privateStateExcluded:true},records},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'staged',targets:records.length,referenceCount:refs.length,baselineRevision:source.revision}));
