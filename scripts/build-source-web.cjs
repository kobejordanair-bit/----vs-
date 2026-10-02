'use strict';
// Build immutable web releases without changing any original corpus snapshot.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {shardForGram,gramAt,ENGINE_VERSION}=require('../backend/static/js/source-search-engine.js');
const ROOT=path.resolve(__dirname,'..'),MAX_FILE_BYTES=25*1024*1024,MANIFEST_LIMIT=1024*1024;
const BUILD_VERSION='1.0.0',BINARY_BUFFER=64*1024;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function encodeVarint(value,buffer,state){if(!Number.isSafeInteger(value)||value<0||value>0xffffffff)throw Error('Varint value out of range');while(value>=128){buffer[state.index++]=(value%128)|128;value=Math.floor(value/128);}buffer[state.index++]=value;}
function encodeNumbers(values){const bytes=Buffer.allocUnsafe(values.length*5),state={index:0};for(const value of values)encodeVarint(value,bytes,state);return bytes.subarray(0,state.index).toString('base64');}
function writeJSON(file,value,stats,maxBytes=MAX_FILE_BYTES){
 const bytes=Buffer.from(JSON.stringify(value)+'\n');
 if(bytes.length>maxBytes)throw Error('Web JSON exceeds byte budget: '+file+' ('+bytes.length+')');
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
 const compressed=zlib.gzipSync(bytes,{level:6,mtime:0});fs.writeFileSync(file+'.gz',compressed);
 if(stats){stats.files+=2;stats.jsonBytes+=bytes.length;stats.gzipBytes+=compressed.length;stats.largestFileBytes=Math.max(stats.largestFileBytes,bytes.length);}
 return bytes.length;
}
function safeCleanupOwnedDirectory(directory,parent,prefix){
 const resolved=path.resolve(directory),resolvedParent=path.resolve(parent);
 if(path.dirname(resolved)!==resolvedParent||!path.basename(resolved).startsWith(prefix))throw Error('Refusing cleanup outside owned build directory');
 fs.rmSync(resolved,{recursive:true,force:true});
}
class Buckets{
 constructor(directory,count,width){this.directory=directory;this.count=count;this.width=width;this.states=Array.from({length:count},()=>({buffer:Buffer.allocUnsafe(BINARY_BUFFER),used:0,fd:null,records:0}));fs.mkdirSync(directory,{recursive:true});}
 add(shard,values){const state=this.states[shard];if(state.used+this.width>BINARY_BUFFER)this.flush(shard);for(let i=0;i<values.length;i++)state.buffer.writeUInt32LE(values[i]>>>0,state.used+i*4);state.used+=this.width;state.records++;}
 flush(shard){const state=this.states[shard];if(!state.used)return;if(state.fd===null)state.fd=fs.openSync(path.join(this.directory,shard.toString(16).padStart(2,'0')+'.bin'),'a');fs.writeSync(state.fd,state.buffer,0,state.used);state.used=0;}
 close(){for(let shard=0;shard<this.count;shard++){this.flush(shard);const state=this.states[shard];if(state.fd!==null){fs.closeSync(state.fd);state.fd=null;}}}
 read(shard){const file=path.join(this.directory,shard.toString(16).padStart(2,'0')+'.bin');return fs.existsSync(file)?fs.readFileSync(file):Buffer.alloc(0);}
}
function alignedBuffer(buffer,alignment){if(buffer.byteOffset%alignment===0)return buffer;const copy=Buffer.allocUnsafeSlow(buffer.length);buffer.copy(copy);return copy;}
function buildBigramShard(buffer){
 if(!buffer.length)return {};
 if(buffer.length%8)throw Error('Invalid bigram bucket record size');
 buffer=alignedBuffer(buffer,8);const records=new BigUint64Array(buffer.buffer,buffer.byteOffset,buffer.length/8);records.sort();
 const words=new Uint32Array(buffer.buffer,buffer.byteOffset,buffer.length/4),entries=Object.create(null);let row=0;
 while(row<records.length){
  const first=row,gram=words[row*2+1];while(row<records.length&&words[row*2+1]===gram)row++;
  const bytes=Buffer.allocUnsafe((row-first)*5),state={index:0};let previous=0;
  for(let i=first;i<row;i++){const position=words[i*2];if(i>first&&position<=previous)throw Error('Duplicate or unordered posting');encodeVarint(position-previous,bytes,state);previous=position;}
  entries[String(gram)]=[row-first,bytes.subarray(0,state.index).toString('base64')];
 }
 return entries;
}
function buildUnigramShard(buffer){
 if(!buffer.length)return {};
 if(buffer.length%16)throw Error('Invalid unigram bucket record size');
 buffer=alignedBuffer(buffer,4);const rows=buffer.length/16,words=new Uint32Array(buffer.buffer,buffer.byteOffset,buffer.length/4);
 const order=new BigUint64Array(rows),keys=new Uint32Array(order.buffer);
 for(let i=0;i<rows;i++){const code=words[i*4],ordinal=words[i*4+1];if(ordinal>65535)throw Error('Unigram document ordinal overflow');keys[i*2]=i;keys[i*2+1]=(code*65536+ordinal)>>>0;}
 order.sort();const entries=Object.create(null);let row=0;
 while(row<rows){
  const first=row,code=keys[row*2+1]>>>16;while(row<rows&&(keys[row*2+1]>>>16)===code)row++;
  const bytes=Buffer.allocUnsafe((row-first)*15),state={index:0};let previous=0;
  for(let i=first;i<row;i++){const source=keys[i*2]*4,ordinal=words[source+1];if(i>first&&ordinal<=previous)throw Error('Duplicate unigram document');encodeVarint(ordinal-previous,bytes,state);encodeVarint(words[source+2],bytes,state);encodeVarint(words[source+3],bytes,state);previous=ordinal;}
  entries[String(code)]=[row-first,bytes.subarray(0,state.index).toString('base64')];
 }
 return entries;
}
function sourcePath(root,contentPath){
 const base=path.resolve(root,'backend/static/data/history/archive-books'),file=path.resolve(root,'backend','.'+contentPath),relative=path.relative(base,file);
 if(!contentPath.startsWith('/static/data/history/archive-books/')||relative.startsWith('..')||path.isAbsolute(relative)||path.extname(file)!=='.json')throw Error('Invalid corpus source path');return file;
}
async function build({root=ROOT,archivePath=path.join(root,'backend/static/data/history/source-archive.v1.json'),reportPath=path.join(root,'data/source-archive/web-build-report.json'),onProgress=()=>{}}={}){
 if(os.endianness()!=='LE')throw Error('Numeric bucket build requires a little-endian Node runtime');
 const started=Date.now(),sourceBytes=fs.readFileSync(archivePath),archive=JSON.parse(sourceBytes);
 if(archive.format!=='dynasty-source-archive'||archive.schemaVersion!==1||!Array.isArray(archive.dossiers)||!Array.isArray(archive.documents))throw Error('Invalid source archive');
 const releaseHash=crypto.createHash('sha256').update(sourceBytes).update(BUILD_VERSION+ENGINE_VERSION).update(fs.readFileSync(__filename)).update(fs.readFileSync(path.join(__dirname,'../backend/static/js/source-search-engine.js')));
 // Hash every input snapshot byte, including dependency bodies and attribution.
 // Reading one book at a time keeps this pass bounded by the largest book.
 const inputBooks=[];
 for(const book of archive.books){const bytes=fs.readFileSync(sourcePath(root,book.contentPath));releaseHash.update(book.id).update(bytes);inputBooks.push({bookId:book.id,sha256:hash(bytes),bytes:bytes.length});}
 const version=releaseHash.digest('hex').slice(0,16);
 const web=path.join(root,'backend/static/data/history/web'),release=path.join(web,'releases',version),urlBase='/static/data/history/web/releases/'+version;
 fs.mkdirSync(web,{recursive:true});fs.mkdirSync(path.dirname(release),{recursive:true});
 const temp=fs.mkdtempSync(path.join(web,'.source-web-temp-')),stage=fs.mkdtempSync(path.join(web,'releases','.source-web-stage-'));
 const stats={files:0,jsonBytes:0,gzipBytes:0,largestFileBytes:0,peakRssBytes:process.memoryUsage().rss};
 const sampleMemory=()=>{stats.peakRssBytes=Math.max(stats.peakRssBytes,process.memoryUsage().rss);};
 const bigrams=new Buckets(path.join(temp,'bigrams'),256,8),unigrams=new Buckets(path.join(temp,'unigrams'),64,16);
 let closed=false;
 try{
  const documents=[],searchDocuments=[],documentById=new Map(),archiveMetadata=new Map(archive.documents.map(item=>[item.id,item]));
  const phases={};const documentStarted=Date.now();
  const related=new Map(),personPaths=new Set();let globalStart=0,characters=0,positionRecords=0,unigramRecords=0;
  for(const item of archive.documents)if(item.supplementsDocumentId){for(const [id,other]of [[item.id,item.supplementsDocumentId],[item.supplementsDocumentId,item.id]]){if(!related.has(id))related.set(id,[]);related.get(id).push(other);}}
  for(const book of archive.books){
   const corpusBytes=fs.readFileSync(sourcePath(root,book.contentPath));
   if(hash(corpusBytes)!==inputBooks.find(item=>item.bookId===book.id).sha256)throw Error('Corpus changed during build: '+book.id);
   const corpus=JSON.parse(corpusBytes);
   for(const source of corpus.documents){
    const originalMeta=archiveMetadata.get(source.id);if(!originalMeta)throw Error('Corpus document missing from archive index: '+source.id);
    if(documentById.has(source.id))throw Error('Duplicate corpus document ID: '+source.id);
    const name=hash(source.id).slice(0,20),textPath=urlBase+'/documents/'+name+'.json',wikitextPath=urlBase+'/wikitext/'+name+'.json';
    const meta={...originalMeta,textPath,wikitextPath,relatedDocumentIds:related.get(source.id)||[]};
    const ordinal=documents.length,text=typeof source.text==='string'?source.text:'';
    if(ordinal>65535||globalStart+text.length+1>0xffffffff)throw Error('Corpus exceeds static index numeric range');
    if(source.textSha256&&hash(text)!==source.textSha256)throw Error('Source text hash mismatch: '+source.id);
    if(typeof source.wikitext==='string'&&source.sha256&&hash(source.wikitext)!==source.sha256)throw Error('Source original hash mismatch: '+source.id);
    documents.push(meta);documentById.set(meta.id,meta);searchDocuments.push({id:source.id,bookId:source.bookId,start:globalStart,length:text.length});
    const counts=new Map();
    for(let offset=0;offset<text.length;offset++){
     const code=text.charCodeAt(offset),count=counts.get(code);if(count)count.count++;else counts.set(code,{count:1,first:offset});
     if(offset+1<text.length){const gram=gramAt(text,offset);bigrams.add(shardForGram(gram,256),[globalStart+offset,gram]);positionRecords++;}
    }
    for(const [code,value]of counts){unigrams.add(shardForGram(code,64),[code,ordinal,value.count,value.first]);unigramRecords++;}
    characters+=text.length;globalStart+=text.length+1;
    // Related metadata paths can be computed before its file has been written.
    const relatedDocuments=(related.get(source.id)||[]).map(id=>{const item=archiveMetadata.get(id);if(!item)return null;const key=hash(id).slice(0,20);return {...item,textPath:urlBase+'/documents/'+key+'.json',wikitextPath:urlBase+'/wikitext/'+key+'.json'};}).filter(Boolean);
    writeJSON(path.join(stage,'documents',name+'.json'),{id:source.id,version,text,metadata:{...meta,relatedDocuments}},stats);
    writeJSON(path.join(stage,'wikitext',name+'.json'),{id:source.id,version,wikitext:source.wikitext||'',transclusions:source.transclusions||[],metadata:meta},stats);
   }
   sampleMemory();onProgress({phase:'documents',book:book.title,completed:documents.length,total:archive.documents.length});
  }
  if(documents.length!==archive.documents.length)throw Error('Corpus catalogue count mismatch');
  bigrams.close();unigrams.close();closed=true;
  phases.documentsAndBucketsMs=Date.now()-documentStarted;
  const searchStarted=Date.now(),searchStartJSON=stats.jsonBytes,searchStartGzip=stats.gzipBytes;let largestShardBytes=0;
  writeJSON(path.join(stage,'search','documents.json'),{format:'dynasty-search-documents',schemaVersion:1,version,documents:searchDocuments},stats);
  for(const [kind,count,buckets,convert]of [['bigrams',256,bigrams,buildBigramShard],['unigrams',64,unigrams,buildUnigramShard]]){
   for(let shard=0;shard<count;shard++){
    const entries=convert(buckets.read(shard));
    largestShardBytes=Math.max(largestShardBytes,writeJSON(path.join(stage,'search',kind,shard.toString(16).padStart(2,'0')+'.json'),{format:'dynasty-'+kind+'-shard',schemaVersion:1,version,shard,entries},stats));
    sampleMemory();if(shard%16===0||shard===count-1)onProgress({phase:kind,completed:shard+1,total:count});
   }
  }
  phases.indexSortEncodeGzipMs=Date.now()-searchStarted;
  const searchJSONBytes=stats.jsonBytes-searchStartJSON,searchGzipBytes=stats.gzipBytes-searchStartGzip,detailsStarted=Date.now();
  const dossiers=archive.dossiers.map(person=>{
   const key=hash(String(person.recordId)).slice(0,20);if(personPaths.has(key))throw Error('Duplicate person ID/path');personPaths.add(key);
   const detailPath=urlBase+'/people/'+key+'.json';
   const matchedDocuments=[...new Set((person.matches||[]).map(item=>item.documentId||item.docId))].map(id=>documentById.get(id)).filter(Boolean);
   writeJSON(path.join(stage,'people',key+'.json'),{...person,version,matchedDocuments},stats);
   const searchNames=[...new Set([person.name,person.title,person.canonicalName,...(person.aliases||[]),String(person.recordId),...(person.candidatePages||[]).map(item=>item.title)].filter(Boolean))];
   return {recordId:person.recordId,name:person.name,type:person.type,dynasty:person.dynasty,title:person.title,canonicalName:person.canonicalName,aliases:person.aliases||[],identityStatus:person.identityStatus,candidateCount:(person.candidatePages||[]).length,candidatePageCount:(person.candidatePages||[]).length,claimCount:(person.claimIds||[]).length,reviewCount:(person.reviewIds||[]).length,matchCount:person.matchCount||0,sourceIds:person.sourceIds||[],reviewIds:person.reviewIds||[],detailPath,searchNames};
  });
  const books=archive.books.map(book=>{
   const documentsPath=urlBase+'/books/'+book.id.replace(/^book:/,'')+'.json';
   writeJSON(path.join(stage,'books',book.id.replace(/^book:/,'')+'.json'),{bookId:book.id,version,documents:documents.filter(item=>item.bookId===book.id)},stats);
   return {...book,documentsPath};
  });
  const documentCatalogPath=urlBase+'/documents.json';
  writeJSON(path.join(stage,'documents.json'),{format:'dynasty-source-document-catalog',schemaVersion:1,version,documents},stats);
  const search={format:'dynasty-literal-search',schemaVersion:1,version,unit:'utf16-code-unit',encoding:'delta-varint-base64-v1',documentsPath:urlBase+'/search/documents.json',documentCount:documents.length,characters,bigrams:{shardCount:256,pathTemplate:urlBase+'/search/bigrams/{shard}.json'},unigrams:{shardCount:64,pathTemplate:urlBase+'/search/unigrams/{shard}.json'}};
  const summary={...archive.summary,withClaims:archive.dossiers.filter(person=>(person.claimIds||[]).length).length,uniqueClaimCount:new Set(archive.dossiers.flatMap(person=>person.claimIds||[])).size};
  const manifest={format:'dynasty-source-web',schemaVersion:1,version,archiveVersion:archive.archiveVersion,createdAt:archive.createdAt,summary,provenance:archive.provenance,limitations:archive.limitations,sources:archive.sources,reviews:archive.reviews,books,corpusQuality:archive.corpusQuality,dossiers,documentCatalogPath,exportPath:'/static/data/history/source-archive.v1.json',search};
  const manifestBytes=writeJSON(path.join(stage,'manifest.json'),manifest,stats,MANIFEST_LIMIT);
  phases.dossierAndMetadataMs=Date.now()-detailsStarted;
  // Existing immutable releases are never overwritten. Same inputs yield same bytes.
  if(fs.existsSync(release)){
   const existing=fs.readFileSync(path.join(release,'manifest.json')),built=fs.readFileSync(path.join(stage,'manifest.json'));
   if(!existing.equals(built))throw Error('Immutable release collision');
   safeCleanupOwnedDirectory(stage,path.join(web,'releases'),'.source-web-stage-');
  }else fs.renameSync(stage,release);
  const manifestTemp=path.join(web,'.manifest-'+process.pid+'.json');
  writeJSON(manifestTemp,manifest,null,MANIFEST_LIMIT);
  fs.renameSync(manifestTemp,path.join(web,'manifest.json'));fs.renameSync(manifestTemp+'.gz',path.join(web,'manifest.json.gz'));
  sampleMemory();
  const report={format:'dynasty-source-web-build-report',schemaVersion:1,builtAt:new Date().toISOString(),version,buildVersion:BUILD_VERSION,engineVersion:ENGINE_VERSION,sourceArchiveSha256:hash(sourceBytes),inputBooks,records:dossiers.length,documents:documents.length,characters,positionRecords,unigramRecords,manifestBytes,manifestGzipBytes:fs.statSync(path.join(web,'manifest.json.gz')).size,searchJSONBytes,searchGzipBytes,largestShardBytes,...stats,temporaryNumericBytes:positionRecords*8+unigramRecords*16,phases,elapsedMs:Date.now()-started,manifestPath:'/static/data/history/web/manifest.json',releasePath:urlBase,semantics:'UTF-16 String.indexOf literal search; non-overlapping count and first offset; no text normalization or model calls'};
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  return {manifest,report,release};
 }finally{
  if(!closed){bigrams.close();unigrams.close();}
  safeCleanupOwnedDirectory(temp,web,'.source-web-temp-');
  if(fs.existsSync(stage))safeCleanupOwnedDirectory(stage,path.join(web,'releases'),'.source-web-stage-');
 }
}
if(require.main===module)build({onProgress:progress=>console.log(JSON.stringify(progress))}).then(({report})=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={build,encodeNumbers,buildBigramShard,buildUnigramShard,safeCleanupOwnedDirectory,MAX_FILE_BYTES,MANIFEST_LIMIT};

