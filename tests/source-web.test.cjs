'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),zlib=require('node:zlib'),vm=require('node:vm');
const {build,safeCleanupOwnedDirectory,MANIFEST_LIMIT,MAX_FILE_BYTES}=require('../scripts/build-source-web.cjs');
const {createEngine,shardForGram,gramAt}=require('../backend/static/js/source-search-engine.js');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
let root,fixture,result,requests=[];
function save(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));}
function readURL(url){return JSON.parse(fs.readFileSync(path.join(root,'backend','.'+url),'utf8'));}
function fetchJSON(url,signal){requests.push(url);if(signal?.aborted){const error=Error('Cancelled');error.name='AbortError';return Promise.reject(error);}return Promise.resolve(readURL(url));}
function reference(query,bookIds=[]){
 if(!query)return [];const wanted=new Set(bookIds);
 return fixture.documents.filter(doc=>!wanted.size||wanted.has(doc.bookId)).map(doc=>{
  let position=0,first=-1,count=0;while((position=doc.text.indexOf(query,position))!==-1){if(first<0)first=position;count++;position+=query.length;}
  return {docId:doc.id,count,offset:first,firstOffset:first};
 }).filter(item=>item.count);
}
test.before(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'dynasty-source-web-test-'));
 const raw=['aaaaa 甲乙丙 丁\n漢書 👑𠀀 罕見字 串尾甲','乙下篇 aaaa abababa ABC abc \u0000 x','缺表仍有文字。秦始皇與劉邦。'];
 const documents=Array.from({length:36},(_,i)=>{const text=(i<3?raw[i]:'aaaaa 人物'+i+' 👑')+(i%2?'乙丙甲乙':'');return {id:'document:fixture-'+i,bookId:i<18?'book:a':'book:b',title:'測試卷'+i,requestedTitle:'測試卷'+i,revisionId:i+1,revisionUrl:'https://example.org/'+i,sha256:hash(text),textSha256:hash(text),text,wikitext:text,status:i===2?'incomplete':'downloaded',characters:text.length,contentPath:'/static/data/history/archive-books/'+(i<18?'a':'b')+'.json',...(i===3?{supplementsDocumentId:'document:fixture-2',editionNote:'補篇'}:{})};});
 const books=['a','b'].map(id=>({id:'book:'+id,title:id,contentPath:'/static/data/history/archive-books/'+id+'.json'}));
 const metadata=documents.map(({text,wikitext,...meta})=>meta);
 const archive={format:'dynasty-source-archive',schemaVersion:1,archiveVersion:'1.0.0',createdAt:'2026-10-02T00:00:00Z',summary:{records:1,documents:36},provenance:{scope:'fixture'},limitations:['限定核讀'],sources:[],reviews:[],books,documents:metadata,corpusQuality:{entries:[]},dossiers:[{recordId:'private-original-id',name:'人物',type:'minister',dynasty:'测试',title:'人物的分析',canonicalName:'人物',aliases:['別名'],identityStatus:'candidate',candidatePages:[{title:'人物條目'}],sourceIds:[],reviewIds:[],claimIds:['claim:one'],matches:[{documentId:documents[0].id,query:'甲',count:1,offset:6}],matchCount:1}]};
 for(const book of books)save(path.join(root,'backend','.'+book.contentPath),{bookId:book.id,documents:documents.filter(doc=>doc.bookId===book.id)});
 save(path.join(root,'backend/static/data/history/source-archive.v1.json'),archive);
 fixture={archive,documents};
 result=await build({root});
});
test.after(()=>{if(root){const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('dynasty-source-web-test-'));fs.rmSync(target,{recursive:true,force:true});}});

test('build creates a small deterministic versioned manifest and gzip sidecars',async()=>{
 const manifest=result.manifest,bytes=fs.readFileSync(path.join(root,'backend/static/data/history/web/manifest.json'));
 assert.match(manifest.version,/^[0-9a-f]{16}$/);assert.ok(bytes.length<MANIFEST_LIMIT);
 assert.equal(manifest.summary.withClaims,1);assert.equal(manifest.summary.uniqueClaimCount,1);
 const gzip=fs.readFileSync(path.join(root,'backend/static/data/history/web/manifest.json.gz'));
 assert.deepEqual(zlib.gunzipSync(gzip),bytes);assert.equal(gzip.readUInt32LE(4),0);
 const second=await build({root});assert.equal(second.manifest.version,manifest.version);assert.equal(second.report.manifestBytes,bytes.length);
 assert.ok(result.report.largestFileBytes<MAX_FILE_BYTES);
 assert.deepEqual(fs.readdirSync(path.join(root,'backend/static/data/history/web')).filter(name=>name.startsWith('.source-web-temp-')),[]);
});

test('people, book metadata, individual reading text and raw snapshots load separately',()=>{
 const manifest=result.manifest,stub=manifest.dossiers[0],person=readURL(stub.detailPath);
 assert.equal(stub.recordId,'private-original-id');assert.equal(stub.candidateCount,1);assert.ok(stub.searchNames.includes('人物條目'));
 assert.equal(stub.matches,undefined);assert.equal(person.matches.length,1);assert.equal(person.matchedDocuments[0].id,'document:fixture-0');
 const catalogue=readURL(manifest.documentCatalogPath);
 assert.equal(catalogue.documents.length,36);assert.equal(catalogue.documents[0].text,undefined);assert.equal(catalogue.documents[0].wikitext,undefined);
 const original=catalogue.documents.find(item=>item.id==='document:fixture-2'),reading=readURL(original.textPath),raw=readURL(original.wikitextPath);
 assert.equal(reading.text,fixture.documents[2].text);assert.equal(raw.wikitext,fixture.documents[2].wikitext);
 assert.equal(reading.metadata.relatedDocuments[0].id,'document:fixture-3');
 assert.equal(readURL(manifest.books[0].documentsPath).documents.length,18);
});

test('every raw snapshot byte contributes to the immutable release version',async()=>{
 const file=path.join(root,'backend/static/data/history/archive-books/a.json'),original=fs.readFileSync(file),changed=JSON.parse(original);
 changed.attribution={changeNotice:'新增來源署名資訊，正文未變'};
 try{save(file,changed);const next=await build({root});assert.notEqual(next.manifest.version,result.manifest.version);}
 finally{fs.writeFileSync(file,original);}
});

test('literal counts and offsets match non-overlapping indexOf for one, two and longer strings',async()=>{
 requests=[];const engine=createEngine({search:result.manifest.search,fetchJSON});
 const queries=['a','aa','aaa','aaaa','aaaaa','aaaaaa','abababa','ababa','甲','甲乙','甲乙丙','乙丙甲乙','\n','👑','𠀀','\ud83d','\udc51','罕見字','缺表','秦始皇與劉邦','ABC','abc','不存在','串尾甲乙下篇','\u0000',''];
 for(const query of queries){const actual=await engine.search(query);assert.deepEqual(actual.results,reference(query),JSON.stringify(query));assert.equal(actual.totalMatches,actual.results.reduce((sum,item)=>sum+item.count,0));}
 for(const query of ['a','👑','甲乙'])assert.deepEqual((await engine.search(query,{bookIds:['book:b']})).results,reference(query,['book:b']));
 assert.deepEqual((await engine.search('a',{bookIds:['missing-book']})).results,[]);
 assert.ok(requests.every(url=>url.includes('/search/')),JSON.stringify(requests));
});

test('arbitrary slices including repeated and surrogate code units match the reference',async()=>{
 const engine=createEngine({search:result.manifest.search,fetchJSON});let seed=92721;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let i=0;i<160;i++){const source=fixture.documents[random()%fixture.documents.length].text,start=random()%source.length,length=1+random()%12,query=source.slice(start,start+length);assert.deepEqual((await engine.search(query)).results,reference(query),JSON.stringify(query));}
});

test('HTTP and corrupt-shard failures remain errors and can be retried',async()=>{
 let failure=true;const engine=createEngine({search:result.manifest.search,fetchJSON:async(url,signal)=>{if(failure&&url.includes('/bigrams/'))throw Error('HTTP 503');return fetchJSON(url,signal);}});
 await assert.rejects(engine.search('甲乙'),/503/);failure=false;assert.deepEqual((await engine.search('甲乙')).results,reference('甲乙'));
 const wrong=createEngine({search:result.manifest.search,fetchJSON:async url=>{const value=readURL(url);if(url.includes('/bigrams/'))value.version='wrong';return value;}});
 await assert.rejects(wrong.search('甲乙'),/version mismatch/);
 const corrupt=createEngine({search:result.manifest.search,fetchJSON:async url=>{const value=readURL(url);if(url.includes('/bigrams/'))value.entries[String(gramAt('甲乙',0))]=[2,'AA=='];return value;}});
 await assert.rejects(corrupt.search('甲乙'),/Truncated/);
});

test('cancellation interrupts fetch/verification and retains only verified partial documents',async()=>{
 const cancelled=new AbortController();cancelled.abort();const engine=createEngine({search:result.manifest.search,fetchJSON});
 await assert.rejects(engine.search('a',{signal:cancelled.signal}),{name:'AbortError'});
 const partialController=new AbortController();let partial;
 await assert.rejects(engine.search('a',{signal:partialController.signal,onPartial:value=>{partial=value;partialController.abort();}}),error=>{
  assert.equal(error.name,'AbortError');assert.ok(error.partial.results.length>=24);
  assert.deepEqual(error.partial.results,reference('a').slice(0,error.partial.results.length));return true;
 });
 assert.ok(partial?.incomplete);
 const duringIndex=new AbortController(),yielding=createEngine({search:result.manifest.search,fetchJSON,yieldControl:async()=>{duringIndex.abort();}});
 await assert.rejects(yielding.search('甲乙',{signal:duringIndex.signal}),{name:'AbortError'});
});

test('worker protocol handles initialization, exact results, cancellation, and recoverable errors',async()=>{
 const messages=[],context={console,AbortController,Uint8Array,Uint32Array,Buffer,setTimeout,clearTimeout,Date,Map,Set,postMessage:message=>messages.push(message)};
 context.self=context;context.globalThis=context;context.fetch=async url=>({ok:true,json:async()=>readURL(url)});
 const sandbox=vm.createContext(context);
 context.importScripts=()=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend/static/js/source-search-engine.js'),'utf8'),sandbox);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend/static/js/source-search-worker.js'),'utf8'),sandbox);
 await context.onmessage({data:{type:'search',requestId:'early',query:'甲'}});
 assert.equal(messages.at(-1).type,'error');
 await context.onmessage({data:{type:'init',requestId:'init',search:result.manifest.search}});
 assert.equal(messages.at(-1).type,'ready');
 await context.onmessage({data:{type:'search',requestId:'q',query:'甲乙',bookIds:[]}});
 const completed=messages.find(message=>message.type==='result'&&message.requestId==='q');
 assert.deepEqual(JSON.parse(JSON.stringify(completed.results)),reference('甲乙'));
 const running=context.onmessage({data:{type:'search',requestId:'cancel',query:'aaaa'}});await context.onmessage({data:{type:'cancel',requestId:'cancel'}});await running;
 assert.ok(messages.some(message=>message.type==='cancelled'&&message.requestId==='cancel'));
});

test('temporary cleanup refuses directories not owned by this builder',()=>{
 assert.throws(()=>safeCleanupOwnedDirectory(path.join(root,'backend'),root,'.source-web-temp-'),/Refusing/);
});

