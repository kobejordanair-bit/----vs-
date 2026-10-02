'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname,'..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const unique = values => [...new Set(values)];
const safeURL = value => { try { return ['https:','http:'].includes(new URL(value).protocol); } catch { return false; } };
function makeMatcher(queries) {
  const nodes = [{next:new Map(),fail:0,out:[]}];
  for (const query of unique(queries.filter(q=>typeof q==='string' && [...q].length>=2))) {
    let node=0; for(const char of query) { if(!nodes[node].next.has(char)){nodes[node].next.set(char,nodes.length);nodes.push({next:new Map(),fail:0,out:[]});} node=nodes[node].next.get(char); } nodes[node].out.push(query);
  }
  const queue=[...nodes[0].next.values()];
  for(let cursor=0;cursor<queue.length;cursor++){
    const node=queue[cursor];for(const [char,target] of nodes[node].next){queue.push(target);let fail=nodes[node].fail;while(fail && !nodes[fail].next.has(char))fail=nodes[fail].fail;nodes[target].fail=nodes[fail].next.get(char)||0;nodes[target].out.push(...nodes[nodes[target].fail].out);}
  }
  return text=>{
    const found=new Map();let node=0,offset=0;
    for(const char of text){while(node && !nodes[node].next.has(char))node=nodes[node].fail;node=nodes[node].next.get(char)||0;offset+=char.length;
      for(const query of nodes[node].out){const old=found.get(query);if(old)old.count++;else found.set(query,{query,count:1,offset:offset-query.length});}}
    return [...found.values()];
  };
}
function validateArchive(archive) {
  const errors=[],check=(value,message)=>{if(!value)errors.push(message);};
  check(archive?.format==='dynasty-source-archive' && archive.schemaVersion===1,'Invalid archive contract');
  if(!archive || !Array.isArray(archive.dossiers)||!Array.isArray(archive.documents)||!Array.isArray(archive.sources)||!Array.isArray(archive.books)||!Array.isArray(archive.reviews)) return {valid:false,errors:[...errors,'Missing collections']};
  const sets={};for(const [table,id] of [['dossiers','recordId'],['documents','id'],['sources','id'],['books','id'],['reviews','id']]){sets[table]=new Set(archive[table].map(item=>item[id]));check(sets[table].size===archive[table].length,'Duplicate '+table+' IDs');}
  const visit=(value,location)=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){check(!['deepAnalysis','soulEssence','analysis','stats','desc','poem','text','wikitext'].includes(key),'Private/article field in index: '+location+'.'+key);if(/^(url|sourceUrl|revisionUrl|historyUrl)$/.test(key) && item!==null)check(safeURL(item),'Unsafe URL at '+location+'.'+key);visit(item,location+'.'+key);}};visit(archive,'archive');
  for(const doc of archive.documents){check(sets.books.has(doc.bookId),'Unknown document book');check(/^\/static\/data\/history\/archive-books\/[a-z]+\.json$/.test(doc.contentPath),'Unsafe content path');if(doc.status==='downloaded'||doc.acquisitionStatus==='downloaded'){check(Number.isInteger(doc.revisionId)&&doc.revisionId>0,'Missing revision');check(/^[a-f0-9]{64}$/.test(doc.sha256),'Missing document hash');check(doc.characters>0,'Empty downloaded document');}}
  for(const review of archive.reviews){check(review.recordIds.every(id=>sets.dossiers.has(id)),'Review references missing record');check(review.evidence.length>0,'Review lacks evidence');for(const proof of review.evidence){check(sets.sources.has(proof.sourceId),'Review source not catalogued');check(Boolean(proof.locator&&proof.supportedFact&&proof.accessedOn),'Review lacks scoped statement');}}
  for(const dossier of archive.dossiers){check(['reviewed','candidate','ambiguous','unresolved'].includes(dossier.identityStatus),'Invalid identity status');check(dossier.reviewIds.every(id=>sets.reviews.has(id)),'Unknown dossier review');check(dossier.sourceIds.every(id=>sets.sources.has(id)),'Unknown dossier source');check(dossier.matches.every(item=>sets.documents.has(item.documentId)&&item.matchType==='name-occurrence'&&item.count>0&&item.offset>=0),'Invalid corpus occurrence');check(dossier.matchCount===new Set(dossier.matches.map(item=>item.documentId)).size,'Distinct document count mismatch');}
  check(archive.summary.records===archive.dossiers.length,'Record count mismatch');check(archive.summary.documents===archive.documents.length,'Document count mismatch');
  check(archive.summary.downloadedDocuments===archive.documents.filter(d=>d.status==='downloaded').length,'Retrieved count mismatch');
  check(archive.summary.identityReviewedRecords===archive.dossiers.filter(d=>d.identityStatus==='reviewed').length,'Identity review count mismatch');
  check(archive.summary.reviewedRecords===archive.dossiers.filter(d=>d.reviewIds.length||d.claimIds.length).length,'Scoped review count mismatch');
  for(const book of archive.books){const docs=archive.documents.filter(doc=>doc.bookId===book.id);check(book.chapterCount===docs.length,'Book chapter count mismatch');check(book.downloadedCount===docs.filter(doc=>doc.status==='downloaded').length,'Book retrieved count mismatch');}
  return {valid:errors.length===0,errors};
}
function buildArchive({library,harvest,catalog,editorial,corpus,quality={},pkg,loadBook,generatedAt=new Date().toISOString()}) {
  const recordIds=new Set(library.map(r=>r.id));
  if(recordIds.size!==library.length||harvest.records.length!==library.length||new Set(harvest.records.map(r=>r.recordId)).size!==library.length||harvest.records.some(r=>!recordIds.has(r.recordId)))throw Error('Harvest must cover each exact library record');
  const reviews=[...editorial.identityReviews,...editorial.readingReviews];
  const books=corpus.books.map(({documents,chapterTitles,...book})=>book), documents=corpus.books.flatMap(book=>book.documents||[]);
  const sourceMap=new Map(catalog.sources.map(source=>[source.id,source]));
  for(const source of pkg.sources) if(!sourceMap.has(source.id))sourceMap.set(source.id,{id:source.id,title:source.work+'・'+source.section,url:source.url,provider:source.author,type:source.kind,coverage:['楚漢切片'],access:{mode:'open',notes:source.editionNote},reuse:{status:'source-specific',notes:source.reuseNote},retrievalStatus:'opened',accessedOn:source.accessedOn,notes:source.limitations});
  const harvested=new Map(harvest.records.map(r=>[r.recordId,r]));
  const dossiers=library.map(record=>{
    const retrieved=harvested.get(record.id), relevant=reviews.filter(review=>review.recordIds.includes(record.id));
    const identity=relevant.filter(review=>review.id.startsWith('identity-review:')), known=pkg.persons.find(person=>person.libraryRefs.some(ref=>ref.recordId===record.id&&ref.name===record.name&&ref.type===record.type));
    const reviewed=identity.some(review=>review.status==='identity-supported')||Boolean(known);
    const ambiguous=identity.some(review=>review.status==='unresolved-identity')||retrieved.status==='ambiguous';
    const canonical=identity.find(review=>review.canonicalName)?.canonicalName||known?.name||null;
    const aliases=unique(identity.flatMap(review=>[review.canonicalName,...(review.aliases||[])]).filter(Boolean));
    const gaps=['原人物分析及能力數值尚未逐句核對。','來源中的年代、關係與評價仍需逐條轉成有出處的主張。'];
    if(!reviewed)gaps.unshift('身份連結尚未完成編輯核對；同名、異名或同時代關係可能有誤配。');
    if(!retrieved.candidates.length)gaps.push('本輪百科查找未取得人物候選頁；不表示沒有歷史記錄。');
    return {recordId:record.id,name:record.name,type:record.type,dynasty:record.dynasty||'未分類',title:record.title||'',canonicalName:canonical,aliases,
      identityStatus:reviewed?'reviewed':ambiguous?'ambiguous':retrieved.candidates.length?'candidate':'unresolved',candidatePages:retrieved.candidates,
      sourceIds:unique([...relevant.flatMap(review=>review.evidence.map(proof=>proof.sourceId)),...(known?known.claimIds.flatMap(id=>pkg.claims.find(claim=>claim.id===id)?.evidence.map(e=>e.sourceId)||[]):[])]),
      reviewIds:relevant.map(review=>review.id),claimIds:known?.claimIds||[],matches:[],matchCount:0,gaps,notes:[...(retrieved.notes||[]),'姓名、分類、時代及稱號保留原庫資料，不自動視為史實。']};
  });
  const queryRecords=new Map();for(const dossier of dossiers){for(const query of unique([dossier.name,...dossier.aliases])){if([...query].length<2)continue;if(!queryRecords.has(query))queryRecords.set(query,[]);queryRecords.get(query).push(dossier);}}
  const matcher=makeMatcher([...queryRecords.keys()]);
  for(const book of books){const body=loadBook(book),available=new Set(documents.filter(doc=>doc.bookId===book.id&&['downloaded','incomplete'].includes(doc.status)&&doc.characters>0).map(doc=>doc.id));
    for(const document of body.documents){if(!available.has(document.id))continue;
      for(const match of matcher(document.text)){for(const dossier of queryRecords.get(match.query))dossier.matches.push({documentId:document.id,query:match.query,count:match.count,offset:match.offset,excerpt:document.text.slice(Math.max(0,match.offset-40),match.offset+match.query.length+80),matchType:'name-occurrence'});}}
  }
  const docMap=new Map(documents.map(doc=>[doc.id,doc]));
  for(const dossier of dossiers){dossier.matchCount=unique(dossier.matches.map(match=>match.documentId)).length;dossier.sourceIds=unique([...dossier.sourceIds,...dossier.matches.map(match=>'source:'+docMap.get(match.documentId).bookId.slice(5)).filter(id=>sourceMap.has(id))]);if(!dossier.matches.length)dossier.gaps.push('目前下載的古籍正文未見姓名字串命中；帝號、異名、缺卷與近現代範圍都可能造成缺口。');}
  const candidatePages=new Map(dossiers.flatMap(d=>d.candidatePages).map(page=>[page.pageId,page]));
  const archive={format:'dynasty-source-archive',schemaVersion:1,archiveVersion:'1.0.0',createdAt:generatedAt,
    provenance:{personSnapshot:harvest.sourceSnapshot,harvestedAt:harvest.generatedAt,editorialCheckedOn:editorial.checkedOn,corpusUpdatedAt:corpus.updatedAt,editorialReview:'Codex-assisted scoped reading; not independent human-expert review',bibliographyLicense:'Metadata extracted from attributed Wikipedia revisions; applicable contributions CC BY-SA 4.0',bibliographyLicenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'},
    summary:{records:dossiers.length,uniqueNames:unique(dossiers.map(d=>d.name)).length,withCandidates:dossiers.filter(d=>d.candidatePages.length).length,ambiguous:dossiers.filter(d=>d.identityStatus==='ambiguous').length,unresolved:dossiers.filter(d=>d.identityStatus==='unresolved').length,reviewedRecords:dossiers.filter(d=>d.reviewIds.length||d.claimIds.length).length,identityReviewedRecords:dossiers.filter(d=>d.identityStatus==='reviewed').length,books:books.length,documents:documents.length,downloadedDocuments:documents.filter(d=>d.status==='downloaded').length,corpusCharacters:documents.filter(d=>d.status==='downloaded').reduce((n,d)=>n+d.characters,0),withCorpusMatches:dossiers.filter(d=>d.matches.length).length,uniqueCandidatePages:candidatePages.size,bibliographyEntries:[...candidatePages.values()].reduce((n,p)=>n+p.bibliography.length,0),catalogSources:sourceMap.size,editorialReviews:reviews.length},
    limitations:['本館收錄962筆原人物記錄的來源查找結果，不能宣稱取得歷史上所有來源或完成所有敘述的驗證。','百科條目與書目是尋找原始來源的線索，沒有自動核實每個外鏈、身份或主張。','古籍已取得版本快照；姓名字串命中可能是同名、稱號或後人討論，不直接建立人物關係與事件。','編輯核讀只限於列出的命題及段落，並非人類歷史學者對全文的審定。','古籍機器整理可能省略模板、表格與校注格式；可回查原始維基文字、固定版本及修訂歷史。','近現代來源和有存取限制的機構資料保留入口與可核讀摘記，沒有把受限全文整批複製。'],
    sources:[...sourceMap.values()],dossiers,books,documents,reviews,corpusQuality:quality};
  archive.summary.retrievedSnapshots=documents.filter(doc=>doc.acquisitionStatus==='downloaded'||doc.status==='downloaded').length;
  archive.summary.incompleteDocuments=documents.filter(doc=>doc.status==='incomplete').length;
  archive.summary.searchableCharacters=documents.filter(doc=>['downloaded','incomplete'].includes(doc.status)).reduce((n,doc)=>n+doc.characters,0);
  const validation=validateArchive(archive);if(!validation.valid)throw Error(validation.errors.join('\n'));return archive;
}
function main(){const arg=process.argv.indexOf('--library'),filename=arg>=0?process.argv[arg+1]:null;if(!filename)throw Error('Use --library <complete private snapshot.json>');const raw=fs.readFileSync(path.resolve(filename),'utf8'),library=JSON.parse(raw.replace(/^\uFEFF/,''));
  const inputs={library,harvest:read('data/source-archive/harvest-person-sources.json'),catalog:read('data/source-archive/catalog.json'),editorial:read('data/source-archive/editorial-reviews.json'),corpus:read('data/source-archive/corpus-manifest.json'),quality:read('data/source-archive/corpus-quality-overrides.json'),pkg:read('backend/static/data/history/chuhan-foundation.v1.json'),loadBook:book=>read('backend'+book.contentPath)};
  if(inputs.harvest.sourceSnapshot.sha256!==hash(raw))throw Error('Private snapshot differs from the harvested source SHA-256');
  const archive=buildArchive(inputs),file=path.join(ROOT,'backend/static/data/history/source-archive.v1.json');fs.writeFileSync(file,JSON.stringify(archive)+'\n','utf8');console.log(JSON.stringify(archive.summary,null,2));}
if(require.main===module){try{main();}catch(error){console.error(error.stack);process.exitCode=1;}}
module.exports={makeMatcher,validateArchive,buildArchive,hash};
