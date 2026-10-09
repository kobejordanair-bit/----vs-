// Packages actual copied ChatGPT responses. It never generates or rewrites prose.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateBatch } from '../cloudflare/scripts/analysis-pilot-import.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
const request = JSON.parse(await readFile(new URL('./request.style.v2.json',import.meta.url),'utf8'));
const files = ['xiaowendi','wangjian','yaochong'];
const records=[];
for (let i=0;i<3;i++) {
  const record=request.records[i], slug=files[i];
  const raw=await readFile(new URL(`../${record.draftPath}`,import.meta.url),'utf8');
  const capture=JSON.parse(await readFile(new URL(`../${record.capturePath}`,import.meta.url),'utf8'));
  if(hash(record.prompt)!==record.promptSha256 || capture.responseSha256!==hash(raw)) throw new Error('source_capture_mismatch');
  const marker=`<!-- PILOT_COMPLETE ${record.id} -->`;
  if(!raw.trimEnd().endsWith(marker)) throw new Error(`incomplete_capture_${slug}`);
  const sources=await readFile(new URL(`./sources/${slug}.md`,import.meta.url),'utf8');
  // Copy permanent references from the verified source package; QA determines
  // that the manuscript's factual claims are supported by those chapters.
  const urls=[...new Set(sources.match(/https:\/\/zh\.wikisource\.org\/w\/index\.php\?oldid=\d+/g)||[])];
  const titles=[['魏書卷七上・高祖紀上','魏書卷七下・高祖紀下','北史卷三・魏本紀第三'],['史記卷七十三・白起王翦列傳','史記卷六・秦始皇本紀'],['舊唐書卷九十六・姚崇傳','新唐書卷一百二十四・姚崇傳','資治通鑑卷二百一十一・唐紀二十七']][i];
  if(urls.length!==titles.length) throw new Error('source_reference_count_mismatch');
  const qa=JSON.parse(await readFile(new URL(`../${record.reviewPath}`,import.meta.url),'utf8'));
  if(qa.passed!==true || qa.manuscriptSha256!==hash(raw) || qa.sourcePackageSha256!==hash(sources)) throw new Error(`source_review_missing_or_stale_${slug}`);
  if(capture.webSearchVerified!==true) throw new Error(`web_search_evidence_missing_${slug}`);
  const checkedSources=urls.map((url,j)=>({title:titles[j],url,locator:`analysis-pilot/sources/${slug}.md；原典節錄與定位、版本雜湊見該史料包`}));
  for(const source of qa.checkedExternalSources||[]) if(!checkedSources.some(s=>s.url===source.url)) checkedSources.push(source);
  records.push({id:record.id,inputSha256:record.inputSha256,promptSha256:record.promptSha256,deepAnalysis:raw.slice(0,raw.lastIndexOf(marker)).trimEnd(),provenance:{provider:'ChatGPT web',conversationUrl:capture.conversationUrl,generatedAt:capture.generatedAt,checkedSources,sourcePackageSha256:hash(sources),captureFile:record.capturePath,responseAssembly: capture.composition || 'Single complete ChatGPT response; only marker formatting and final newline normalized.',rawResponseSha256:hash(raw),sourceReviewSha256:hash(JSON.stringify(qa)),originalWebsitePromptPreserved:true,existingWritingStyleUsed:true,webSearchVerified:true}});
}
const batch={format:'dynasty-analysis-pilot-results',schemaVersion:1,records};
validateBatch(batch);
await writeFile(new URL('./results.v1.json',import.meta.url),JSON.stringify(batch,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({records:3,characters:records.map(r=>({id:r.id,chars:r.deepAnalysis.length})),valid:true}));
