'use strict';
// Offline by default. Original snapshots and their hashes never change.
const fs=require('node:fs'),path=require('node:path');
const {plainText,extractionVersion}=require('./wikisource-text.cjs');
const {digest,sourceURL,api}=require('./harvest-historical-corpus.cjs');
const ROOT=path.resolve(__dirname,'..');
const MANIFEST=path.join(ROOT,'data/source-archive/corpus-manifest.json');
const OVERRIDES=path.join(ROOT,'data/source-archive/corpus-quality-overrides.json');
const MAX_DEPTH=6,MAX_DEPENDENCIES=40;
const normalizeTitle=title=>String(title||'').replace(/_/g,' ').replace(/[\t ]+/g,' ').trim();
const OPAQUE=/(<!--[\s\S]*?-->|<(?:nowiki|pre|source|syntaxhighlight)\b[^>]*>[\s\S]*?<\/(?:nowiki|pre|source|syntaxhighlight)\s*>)/gi;
function replaceReferences(raw,callback,baseTitle=''){
 return raw.split(OPAQUE).map((part,index)=>index%2?part:part.replace(/\{\{\s*([:/])\s*([^{}|]+?)\s*\}\}/g,
  (original,prefix,name)=>callback(original,normalizeTitle(prefix==='/'?baseTitle+'/'+name:name)))).join('');
}
function references(raw,baseTitle=''){
 const found=new Set();replaceReferences(raw,(original,title)=>{found.add(title);return original;},baseTitle);return [...found];
}
function transcludedContent(raw){
 const slots=[];let prefix='\uE000INCLUDE';while(raw.includes(prefix))prefix+='X';
 const visible=raw.replace(OPAQUE,original=>original.startsWith('<!--')?'':prefix+(slots.push(original)-1)+'\uE001');
 const only=[...visible.matchAll(/<onlyinclude\b[^>]*>([\s\S]*?)<\/onlyinclude\s*>/gi)];
 return (only.length?only.map(match=>match[1]).join('\n'):visible)
  .replace(/<noinclude\b[^>]*>[\s\S]*?<\/noinclude\s*>/gi,'').replace(/<\/?includeonly\b[^>]*>/gi,'')
  .replace(new RegExp(prefix+'(\\d+)\uE001','g'),(_,index)=>slots[Number(index)]);
}
function dependencyMap(documents){
 const map=new Map(),seen=new Set();
 function add(item){
  if(!item||seen.has(item))return;seen.add(item);
  if(typeof item.wikitext!=='string'||!item.sha256||digest(item.wikitext)!==item.sha256)throw Error('Dependency snapshot hash mismatch: '+(item.requestedTitle||item.title||'(unnamed)'));
  if(!item.revisionId||!normalizeTitle(item.title||item.requestedTitle))throw Error('Dependency revision metadata missing: '+(item.requestedTitle||'(unnamed)'));
  for(const title of [item.requestedTitle,item.title].filter(Boolean)){
   const key=normalizeTitle(title),previous=map.get(key);
   if(previous&&(previous.sha256!==item.sha256||previous.revisionId!==item.revisionId))throw Error('Conflicting dependency snapshots: '+key);
   map.set(key,item);
  }
  for(const child of item.transclusions||[])add(child);
 }
 for(const item of documents||[])add(item);return map;
}
function expandDetailed(raw,dependencies,{baseTitle='',seen=new Set(),maxDepth=MAX_DEPTH,maxExpansions=2000,maxExpandedCharacters=16000000}={}){
 const issues=[],expandedTitles=new Set();let occurrences=0,expandedCharacters=0;
 const visit=(source,parentTitle,chain,depth)=>replaceReferences(source,(original,title)=>{
  const item=dependencies.get(title),canonical=normalizeTitle(item?.title||title);let kind;
  if(!item||typeof item.wikitext!=='string')kind='missing';
  else if(chain.has(title)||chain.has(canonical))kind='cycle';
  else if(depth>=maxDepth)kind='depth-limit';
  else if(occurrences>=maxExpansions||expandedCharacters+item.wikitext.length>maxExpandedCharacters)kind='expansion-limit';
  if(kind){issues.push({kind,title});return original;}
  if(!item.sha256||digest(item.wikitext)!==item.sha256)throw Error('Dependency snapshot hash mismatch: '+title);
  expandedTitles.add(canonical);occurrences++;expandedCharacters+=item.wikitext.length;
  return '\n'+visit(transcludedContent(item.wikitext),canonical,new Set([...chain,title,canonical]),depth+1)+'\n';
 },parentTitle);
 const chain=new Set([...seen].map(normalizeTitle));if(baseTitle)chain.add(normalizeTitle(baseTitle));
 const wikitext=visit(raw,baseTitle,chain,0);
 return {wikitext,issues:[...new Map(issues.map(issue=>[issue.kind+':'+issue.title,issue])).values()],expandedTitles:[...expandedTitles]};
}
function expand(raw,dependencies,seen=new Set()){return expandDetailed(raw,dependencies,{seen}).wikitext;}
// Explicit allowlist: no arbitrary nested body fields reach the main index.
const META_FIELDS=['id','bookId','requestedTitle','title','sourceUrl','revisionUrl','historyUrl','revisionId','revisionTimestamp','retrievedAt','sha256','textSha256','expandedWikitextSha256','characters','contentPath','status','acquisitionStatus','error','reuse','extraction','normalizedAt','upstreamTextQuality','upstreamTextQualityMeaning','textCompleteness','editionNote','supplementsDocumentId'];
function metadata(document,seen=new Set()){
 if(!document||seen.has(document))return null;
 const next=new Set([...seen,document]),meta={};
 for(const key of META_FIELDS){const value=document[key];if(value===null||['string','number','boolean'].includes(typeof value))meta[key]=value;}
 for(const key of ['extractionNotes','expandedTransclusionTitles'])if(Array.isArray(document[key]))meta[key]=document[key].filter(value=>typeof value==='string');
 if(Array.isArray(document.transclusionIssues))meta.transclusionIssues=document.transclusionIssues.filter(issue=>issue&&typeof issue==='object').map(issue=>Object.fromEntries(['kind','title'].filter(key=>typeof issue[key]==='string').map(key=>[key,issue[key]])));
 if(document.qualityReview){
  meta.qualityReview={};
  for(const key of ['requestedTitle','revisionId','status','reason','checkedOn','evidenceURL','supplementTitle','applied']){
   const value=document.qualityReview[key];if(value===null||['string','number','boolean'].includes(typeof value))meta.qualityReview[key]=value;
  }
 }
 if(Array.isArray(document.transclusions))meta.transclusions=document.transclusions.map(item=>metadata(item,next)).filter(Boolean);
 return meta;
}
async function fetchDependency(title){
 const response=await api({titles:title,redirects:'1',prop:'revisions',rvprop:'ids|timestamp|content',rvslots:'main'});
 const page=response.query?.pages?.[0],revision=page?.revisions?.[0],raw=revision?.slots?.main?.content;
 if(!revision||page.missing||typeof raw!=='string')throw Error('Missing transcluded page '+title);
 return {requestedTitle:title,title:page.title,wikitext:raw,sourceUrl:sourceURL(page.title),revisionUrl:'https://zh.wikisource.org/w/index.php?oldid='+revision.revid,historyUrl:sourceURL(page.title)+'?action=history',revisionId:revision.revid,revisionTimestamp:revision.timestamp,retrievedAt:new Date().toISOString(),sha256:digest(raw),reuse:'Wikisource transcription attribution and CC BY-SA 4.0 for applicable contributions'};
}
function qualityOverride(document,overrides){
 const entries=Array.isArray(overrides)?overrides:overrides?.entries||[];
 const matches=entries.filter(entry=>normalizeTitle(entry.requestedTitle)===normalizeTitle(document.requestedTitle));
 const exact=matches.find(entry=>entry.revisionId!=null&&String(entry.revisionId)===String(document.revisionId));
 const entry=exact||matches[0];if(!entry)return null;
 if(!['incomplete','downloaded'].includes(entry.status))throw Error('Invalid corpus quality override status: '+entry.status);
 return {...entry,applied:entry.revisionId!=null&&String(entry.revisionId)===String(document.revisionId)};
}
async function normalizeDocument(document,{online=false,fetcher=fetchDependency,overrides=[],now=new Date().toISOString()}={}){
 if(typeof document.wikitext!=='string'||!document.revisionId)return {...document};
 if(!document.sha256||digest(document.wikitext)!==document.sha256)throw Error('Original snapshot hash mismatch: '+document.id);
 const deps=dependencyMap(document.transclusions),needed=references(document.wikitext,document.title),fetchErrors=[];
 for(let index=0;index<needed.length&&index<MAX_DEPENDENCIES;index++){
  const title=needed[index];
  if(!deps.has(title)&&online){
   try{
    const item=await fetcher(title),checked=dependencyMap([item]);
    for(const [key,value]of checked){
     const old=deps.get(key);if(old&&(old.sha256!==value.sha256||old.revisionId!==value.revisionId))throw Error('Conflicting dependency snapshots: '+key);
    }
    for(const [key,value]of checked)deps.set(key,value);
    if(!deps.has(title))deps.set(title,item);
   }catch(error){fetchErrors.push('轉引取得失敗：'+title+'（'+error.message+'）');}
  }
  const item=deps.get(title);
  if(item)for(const nested of references(transcludedContent(item.wikitext),item.title))if(!needed.includes(nested))needed.push(nested);
 }
 const expanded=expandDetailed(document.wikitext,deps,{baseTitle:document.title});
 const text=plainText(expanded.wikitext),quality=document.wikitext.match(/\{\{\s*textquality\s*\|\s*(\d+)\s*%?\s*\}\}/i);
 const notes=[...fetchErrors],review=qualityOverride(document,overrides);
 if(review?.applied)notes.push('逐頁核讀：'+review.reason);
 else if(review)notes.push('既有缺文審查針對其他版本，未套用；須核對目前固定版本。');
 if(quality)notes.push('Textquality '+quality[1]+'% 是維基文庫平台品質標記，不代表正文已轉錄比例。');
 for(const issue of expanded.issues)notes.push(({missing:'尚未取得轉引：',cycle:'循環轉引未展開：','depth-limit':'轉引深度上限未展開：','expansion-limit':'轉引大小上限未展開：'})[issue.kind]+issue.title);
 const unresolved=/〔未展開(?:轉引|跨頁轉錄)：/.test(text);
 if(unresolved&&!expanded.issues.length)notes.push('含未展開的跨頁轉錄或帶參數轉引。');
 if(text.includes('〔未展開模板：'))notes.push('存在未知模板，保留原標記；尚未確認其呈現的全部內容。');
 const media=/〔圖像未轉錄：|\{\{\s*(?:SKchar\d*|GJchar|PUA)\b/i.test(text)||/\{\{\s*(?:SKchar\d*|GJchar|PUA)\b/i.test(expanded.wikitext);
 if(media)notes.push('含圖片或特殊字形；檔名、圖說或字形標記已保留，但影像內容尚未轉為文字，不能視為純文字完整。');
 const incomplete=!text||unresolved||expanded.issues.length>0||media||(review?.applied&&review.status==='incomplete');
 return {...document,transclusions:[...new Set(deps.values())],text,textSha256:digest(text),expandedWikitextSha256:digest(expanded.wikitext),characters:text.length,extraction:extractionVersion,normalizedAt:now,upstreamTextQuality:quality?Number(quality[1]):null,upstreamTextQualityMeaning:'Wikisource platform quality marker; not a percentage of text transcribed',extractionNotes:notes,transclusionIssues:expanded.issues,expandedTransclusionTitles:expanded.expandedTitles,...(review?{qualityReview:review}:{}),acquisitionStatus:'downloaded',textCompleteness:incomplete?'has-unresolved-material':'not-independently-collated',status:incomplete?'incomplete':'downloaded'};
}
function corpusFile(root,contentPath){
 const directory=path.resolve(root,'backend/static/data/history/archive-books');
 if(typeof contentPath!=='string'||!contentPath.startsWith('/static/data/history/archive-books/'))throw Error('Invalid corpus contentPath');
 const target=path.resolve(root,'backend','.'+contentPath),relative=path.relative(directory,target);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.extname(target)!=='.json')throw Error('Corpus path escapes archive-books');
 return target;
}
function writeJSON(file,value){
 const temporary=file+'.normalize-'+process.pid+'.tmp';
 fs.writeFileSync(temporary,JSON.stringify(value)+'\n','utf8');fs.renameSync(temporary,file);
}
async function run(){
 const manifest=JSON.parse(fs.readFileSync(MANIFEST,'utf8')),overrides=fs.existsSync(OVERRIDES)?JSON.parse(fs.readFileSync(OVERRIDES,'utf8')):[];
 const online=process.argv.includes('--fetch-transclusions');let dependencyCount=0,incompleteCount=0;
 for(const book of manifest.books){
  const file=corpusFile(ROOT,book.contentPath),body=JSON.parse(fs.readFileSync(file,'utf8')),normalized=[];
  for(const document of body.documents){
   const result=await normalizeDocument(document,{online,overrides});
   dependencyCount+=result.transclusions?.length||0;if(result.status!=='downloaded')incompleteCount++;normalized.push(result);
  }
  body.documents=normalized;body.generatedAt=new Date().toISOString();
  body.attribution={...body.attribution,changeNotice:'原始維基文字及其雜湊保留；使用保守模板解析整理閱讀文字。跨頁轉引另存依賴頁版本、原文與雜湊；圖片與字形缺口保留提示。'};
  writeJSON(file,body);book.documents=body.documents.map(item=>metadata(item));
  book.chapterCount=body.documents.length;book.downloadedCount=body.documents.filter(item=>item.status==='downloaded').length;
  book.status=book.downloadedCount===book.chapterCount?'downloaded':'partial';
  book.notes='維基文庫所列篇章的版本快照，未逐卷校勘。Textquality是平台品質標記，並非轉錄完成比例；已知上游缺文按逐頁審查記錄標示，轉引、圖片、字形與異版差異須回查固定版本。';
  console.log('NORMALIZED '+book.title+' '+book.downloadedCount+'/'+book.chapterCount);
 }
 manifest.updatedAt=new Date().toISOString();manifest.extractionVersion=extractionVersion;
 writeJSON(MANIFEST,manifest);console.log(JSON.stringify({books:manifest.books.length,transclusions:dependencyCount,incomplete:incompleteCount}));
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={references,expand,expandDetailed,metadata,normalizeDocument,dependencyMap,qualityOverride,corpusFile,transcludedContent};
