'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {makeMatcher,validateArchive}=require('../scripts/build-source-archive.cjs');
const {plainText,digest}=require('../scripts/harvest-historical-corpus.cjs');
const load=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../backend/static/data/history/source-archive.v1.json'),'utf8'));
test('Unicode matching preserves exact offsets, overlapping names and repeated occurrences',()=>{
 const text='漢高祖曰韓信與鄭克𡒉。韓信';const matches=makeMatcher(['韓信','信','鄭克𡒉','克𡒉','不存在'])(text);
 assert.equal(matches.find(m=>m.query==='韓信').count,2);assert.equal(matches.some(m=>m.query==='信'),false);
 for(const item of matches)assert.equal(text.slice(item.offset,item.offset+item.query.length),item.query);
 assert.ok(matches.some(m=>m.query==='克𡒉'));
});
test('derived reading text removes markup without executing HTML and raw hash detects edits',()=>{
 const raw='{{header|title=某書}}\n== 人物 ==\n[[人物|韓信]]<ref>引文</ref><!-- comment -->';const text=plainText(raw);
 assert.match(text,/韓信〔引文〕/);assert.doesNotMatch(text,/header|comment|\[\[/);assert.notEqual(digest(raw),digest(raw+' '));
});
test('every original record has a dossier and all evidence, files and reviews reference real IDs',()=>{
 const archive=load();assert.equal(archive.dossiers.length,962);assert.equal(new Set(archive.dossiers.map(d=>d.recordId)).size,962);assert.deepEqual(validateArchive(archive),{valid:true,errors:[]});
 assert.ok(archive.limitations.some(s=>s.includes('不能宣稱')));assert.ok(archive.summary.reviewedRecords<962);
});
test('the archive validator rejects unsafe URLs, file traversal, private article fields and invented documents',()=>{
 for(const change of [a=>a.dossiers[0].deepAnalysis='PRIVATE',a=>a.sources[0].url='javascript:alert(1)',a=>a.documents[0].contentPath='/static/data/history/archive-books/../../secret.json',a=>a.dossiers[0].matches.push({documentId:'missing',count:1,offset:0,matchType:'name-occurrence'}),a=>a.summary.records=999]){
 const archive=load();change(archive);assert.equal(validateArchive(archive).valid,false);
 }
});
test('retrieved corpus metadata matches the saved original and derived text byte hashes',()=>{
 const archive=load();const byId=new Map(archive.documents.map(d=>[d.id,d]));
 for(const book of archive.books){const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../backend',book.contentPath),'utf8'));
  for(const document of data.documents){const metadata=byId.get(document.id);assert.ok(metadata);if(!document.wikitext)continue;
   assert.equal(digest(document.wikitext),metadata.sha256);assert.equal(digest(document.text),metadata.textSha256);assert.equal(document.text.length,metadata.characters);assert.match(document.revisionUrl,new RegExp('oldid='+document.revisionId+'$'));
   for(const dependency of document.transclusions||[]){assert.equal(digest(dependency.wikitext),dependency.sha256);assert.ok(metadata.transclusions.find(d=>d.sha256===dependency.sha256));}
  }
 }
});
test('known truncated editions retain their gap and supplements never replace the original',()=>{
 const archive=load();const original=archive.documents.find(d=>d.requestedTitle==='宋史/卷084');assert.equal(original.status,'incomplete');
 const alternate=archive.documents.find(d=>d.supplementsDocumentId===original.id);assert.ok(alternate);assert.match(alternate.title,/四庫全書/);assert.notEqual(alternate.revisionId,original.revisionId);
 assert.ok(archive.corpusQuality.entries.some(d=>d.requestedTitle==='清史稿/卷30'&&d.links?.length));
});
test('every machine name match can be reproduced in its actual document and is never labelled verified',()=>{
 const archive=load(),texts=new Map();for(const book of archive.books){const body=JSON.parse(fs.readFileSync(path.join(__dirname,'../backend',book.contentPath),'utf8'));for(const doc of body.documents)texts.set(doc.id,doc.text);}
 for(const dossier of archive.dossiers)for(const match of dossier.matches){assert.equal(match.matchType,'name-occurrence');assert.equal(texts.get(match.documentId).slice(match.offset,match.offset+match.query.length),match.query);}
});
