// Public supplement only. No production calls, credentials or private snapshots.
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStatsBatch, STATS_DIMENSIONS } from '../cloudflare/scripts/analysis-pilot-stats-import.mjs';
import { sha256, contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { markdownToHtml } from './build-delivery.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const out=resolve(here,'../../人物分析ChatGPT試跑_2026-10-09/五維補評交付');
const json=async name=>JSON.parse(await readFile(resolve(here,name),'utf8'));
const batch=validateStatsBatch(await json('stats-results.v1.json'));
const meta={emperor_北魏孝文帝_33257620:{name:'北魏孝文帝',slug:'xiaowendi'},minister_姚崇_2003901767:{name:'姚崇',slug:'yaochong'}};
const audit=await json('stats-completion-audit.json');
if(audit.passed!==true||audit.status!=='complete_verified'||audit.batchSha256!==contentHash(batch)
  ||!Number.isSafeInteger(audit.beforeRevision)||audit.beforeRevision<0||audit.afterRevision!==audit.beforeRevision+1) throw new Error('complete_stats_audit_required');
const css='body{margin:0;background:#f5f1e8;color:#28383e;font:17px/1.85 "Microsoft JhengHei",sans-serif}main{max-width:980px;margin:auto;padding:44px 24px}h1,h2,h3{font-family:"PMingLiU",serif}a{color:#49627b}table{width:100%;border-collapse:collapse;background:#fffdf7}th,td{padding:13px;border-bottom:1px solid #dbd2bd;text-align:center}.article{background:#fffdf7;padding:24px;border:1px solid #dbd2bd;border-radius:12px;margin:24px 0}.muted{font-size:14px;color:#637177}';
const page=(title,body)=>'<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>'+css+'</style><main>'+body+'</main></html>';
const names=batch.records.map(record=>meta[record.id].name);
const files=['stats-results.v1.json','stats-completion-audit.json','stats-deployment.json','browser-verification-observed.json','stats-browser-verification.json','stats-final-tests.log','stats-request.v1.json','stats-input-bindings.v1.json','stats-reference.v1.json','website-source-binding.json','stats-d1-adapter-design.v1.json','stats-capture-contract.md'];
for(const record of batch.records){const slug=meta[record.id].slug;files.push('prompts/'+slug+'.stats.prompt.md','drafts/'+slug+'.stats.raw.md','drafts/'+slug+'.stats.md','drafts/'+slug+'.stats.capture.json','drafts/'+slug+'.stats.search-evidence.txt','source-review.'+slug+'.stats.json');}
const sourceFiles=[];
for(const file of files){const source=resolve(here,file),info=await lstat(source);if(!info.isFile()||info.isSymbolicLink())throw new Error('regular_public_evidence_required');sourceFiles.push({file,bytes:await readFile(source)});}
try{await lstat(out);throw new Error('delivery_output_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(out,{recursive:false});
for(let i=0;i<batch.records.length;i++){
  const record=batch.records[i],slug=meta[record.id].slug;
  await writeFile(resolve(out,slug+'.五維.html'),page(names[i]+'・五維補評','<a href="總覽.html">← 返回五維總覽</a><h1>'+names[i]+'・五維補評</h1><p>統率／武力／智謀／政治／魅力：'+record.fields.stats.join('／')+'</p><article class="article">'+markdownToHtml(record.fields.statsAnalysis)+'</article><p class="muted">ChatGPT 實際網搜稿；文體轉換未補寫正文。正文 SHA-256：'+sha256(record.fields.statsAnalysis)+'</p>'));
}
const manifest=[];
for(const {file,bytes} of sourceFiles){
  const target=resolve(out,'evidence',file);
  await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
  manifest.push({path:'evidence/'+file,bytes:bytes.length,sha256:sha256(bytes)});
}
const rows=batch.records.map((r,i)=>'<tr><th>'+names[i]+'</th>'+r.fields.stats.map(n=>'<td>'+n+'</td>').join('')+'<td><a href="'+meta[r.id].slug+'.五維.html">閱讀理由</a></td></tr>').join('');
await writeFile(resolve(out,'總覽.html'),page('王侯將相・五維補評交付','<h1>五維補評完成</h1><p>補上孝文帝與姚崇的五項能力與評分理由。三人的九份原文章、王翦原五維與其他使用者資料均保留。</p><p><a href="https://dynasty.piamamba.com/play">開啟網站</a> · <a href="../最終交付/總覽.html">閱讀原九份文章</a></p><table><thead><tr><th>人物</th>'+STATS_DIMENSIONS.map(n=>'<th>'+n+'</th>').join('')+'<th>全文</th></tr></thead><tbody>'+rows+'</tbody></table><div class="article"><h2>網站功能修正</h2><p>賞析頁顯示雷達图、五項數值與獨立評分理由。「生成／重算五維」只更新五維與理由，保留原賞析。純閱讀使用已保存內容。</p><p>userdata revision '+audit.beforeRevision+' → '+audit.afterRevision+'，本次只新增兩人四個欄位。<a href="evidence/stats-completion-audit.json">資料保全核對</a> · <a href="evidence/stats-browser-verification.json">網站驗證</a></p></div><h2>可重現證據</h2><p>封存原 PROMPT、實際 ChatGPT 稿件、網搜紀錄、來源查核、測試與部署收據。<a href="public-manifest.json">檔案清單與雜湊</a>。</p>'));
for(const file of ['總覽.html','xiaowendi.五維.html','yaochong.五維.html']){const bytes=await readFile(resolve(out,file));manifest.push({path:file,bytes:bytes.length,sha256:sha256(bytes)});}
await writeFile(resolve(out,'public-manifest.json'),JSON.stringify({format:'dynasty-stats-public-delivery',schemaVersion:1,createdAt:new Date().toISOString(),privateFilesIncluded:false,files:manifest},null,2)+'\n');
console.log(JSON.stringify({status:'public_delivery_built',fileCount:manifest.length,output:out}));
