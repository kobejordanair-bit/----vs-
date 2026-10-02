'use strict';
// Retrieve explicitly reviewed alternate editions as additional documents.
// Never replace the incomplete source document or silently merge editions.
const fs=require('node:fs'),path=require('node:path');
const {api,sourceURL,digest,plainText}=require('./harvest-historical-corpus.cjs');
const {extractionVersion}=require('./wikisource-text.cjs');
const ROOT=path.resolve(__dirname,'..');
async function run(){
 const manifestFile=path.join(ROOT,'data/source-archive/corpus-manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 const quality=JSON.parse(fs.readFileSync(path.join(ROOT,'data/source-archive/corpus-quality-overrides.json'),'utf8'));
 let fetched=0;
 for(const entry of quality.entries.filter(item=>item.supplementTitle)){
  const book=manifest.books.find(b=>b.documents.some(d=>d.requestedTitle===entry.requestedTitle));if(!book)throw Error('Unknown supplement target '+entry.requestedTitle);
  const file=path.join(ROOT,'backend'+book.contentPath),body=JSON.parse(fs.readFileSync(file,'utf8')),original=body.documents.find(d=>d.requestedTitle===entry.requestedTitle);
  if(body.documents.some(d=>d.requestedTitle===entry.supplementTitle&&d.status==='downloaded'))continue;
  const data=await api({titles:entry.supplementTitle,redirects:'1',prop:'revisions',rvprop:'ids|timestamp|content',rvslots:'main'}),page=data.query?.pages?.[0],revision=page?.revisions?.[0];
  if(!revision||page.missing)throw Error('Supplement unavailable '+entry.supplementTitle);
  const raw=revision.slots.main.content,text=plainText(raw);
  const doc={id:'document:'+book.id.slice(5)+'-'+digest(entry.supplementTitle).slice(0,16),bookId:book.id,requestedTitle:entry.supplementTitle,title:page.title,sourceUrl:sourceURL(page.title),revisionUrl:'https://zh.wikisource.org/w/index.php?oldid='+revision.revid,historyUrl:sourceURL(page.title)+'?action=history',revisionId:revision.revid,revisionTimestamp:revision.timestamp,retrievedAt:new Date().toISOString(),sha256:digest(raw),textSha256:digest(text),characters:text.length,contentPath:book.contentPath,status:text.length>=100?'downloaded':'incomplete',text,wikitext:raw,reuse:book.license,extraction:extractionVersion,editionNote:'異版補篇：'+entry.supplementTitle+'。保留原轉錄缺口，兩版不自動混合。',supplementsDocumentId:original.id};
  body.documents=[...body.documents.filter(d=>d.id!==doc.id),doc];body.generatedAt=new Date().toISOString();
  fs.writeFileSync(file,JSON.stringify(body)+'\n','utf8');
  book.primaryChapterCount=book.primaryChapterCount||book.chapterTitles.length;book.chapterTitles=[...new Set([...book.chapterTitles,doc.requestedTitle])];book.chapterCount=body.documents.length;book.downloadedCount=body.documents.filter(d=>d.status==='downloaded').length;book.supplementCount=body.documents.filter(d=>d.supplementsDocumentId).length;book.documents=body.documents.map(({text,wikitext,...meta})=>meta);book.status=book.downloadedCount===book.chapterCount?'downloaded':'partial';
  manifest.updatedAt=new Date().toISOString();fs.writeFileSync(manifestFile,JSON.stringify(manifest)+'\n','utf8');console.log('SUPPLEMENT '+doc.title+' '+doc.characters);fetched++;
 }
 console.log(JSON.stringify({supplementsFetched:fetched}));
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
