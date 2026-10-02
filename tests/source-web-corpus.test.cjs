'use strict';
// Real-corpus integration checks. Does not change source snapshots or web releases.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createEngine}=require('../backend/static/js/source-search-engine.js');
const ROOT=path.resolve(__dirname,'..'),MANIFEST=path.join(ROOT,'backend/static/data/history/web/manifest.json');
const available=fs.existsSync(MANIFEST);
test('full-corpus exact search matches non-overlapping indexOf without loading body files',{skip:!available},async()=>{
 const manifest=JSON.parse(fs.readFileSync(MANIFEST,'utf8')),archive=JSON.parse(fs.readFileSync(path.join(ROOT,'backend/static/data/history/source-archive.v1.json'),'utf8'));
 const documents=[];
 for(const book of archive.books){const file=JSON.parse(fs.readFileSync(path.join(ROOT,'backend','.'+book.contentPath),'utf8'));for(const item of file.documents)documents.push({id:item.id,bookId:item.bookId,status:item.status,text:item.text||''});}
 const calls=[];let jsonBytes=0,gzipBytes=0;
 const fetchJSON=async url=>{
  assert.ok(url.includes('/search/'),'Search fetched a body file: '+url);
  const file=path.join(ROOT,'backend','.'+url),buffer=fs.readFileSync(file);jsonBytes+=buffer.length;gzipBytes+=fs.statSync(file+'.gz').size;calls.push(url);return JSON.parse(buffer);
 };
 const engine=createEngine({search:manifest.search,fetchJSON});
 const startupAt=performance.now();await engine.ready();
 const startup={milliseconds:Number((performance.now()-startupAt).toFixed(2)),jsonBytes,gzipBytes,requests:calls.length};
 function reference(query,bookIds=[]){
  const selected=new Set(bookIds),result=[];
  for(const doc of documents){if(selected.size&&!selected.has(doc.bookId))continue;let offset=0,count=0,first=-1;while((offset=doc.text.indexOf(query,offset))!==-1){if(first<0)first=offset;count++;offset+=query.length;}if(count)result.push({docId:doc.id,count,offset:first,firstOffset:first});}
  return result;
 }
 const queries=['劉邦','秦始皇','諸葛亮','郭太','林則徐','王安石','曹操','韓信','長安','太史公曰','黃帝者，少典之子','𣶯','𠀀','之','人','\n','\n\n','表略','{{SKchar','絕不存在的歷史字串🦄🦄'];
 const samples=[];
 for(let i=0;i<16;i++){const doc=documents[(i*251+17)%documents.length];if(doc.text.length>30){const start=(i*839+123)%(doc.text.length-20);samples.push(doc.text.slice(start,start+2+(i%13)));}}
 const cases=[...queries,...samples].map(query=>({query,bookIds:[]}));
 cases.push({query:'秦始皇',bookIds:['book:shiji']},{query:'表略',bookIds:['book:qingshigao']});
 const rows=[];
 for(const {query,bookIds}of cases){
  engine.clearCache();const previousCalls=calls.length,previousJSON=jsonBytes,previousGzip=gzipBytes,began=performance.now();let partialMessages=0;
  const result=await engine.search(query,{bookIds,onPartial:()=>partialMessages++}),coldMs=performance.now()-began,expected=reference(query,bookIds);
  assert.deepEqual(result.results,expected,'Query '+JSON.stringify(query)+' '+bookIds.join(','));
  assert.equal(result.totalMatches,expected.reduce((sum,item)=>sum+item.count,0));
  const requests=calls.length-previousCalls,transferredJSON=jsonBytes-previousJSON,transferredGzip=gzipBytes-previousGzip;
  const warmStart=performance.now(),warm=await engine.search(query,{bookIds});assert.deepEqual(warm.results,expected);
  rows.push({query,bookIds,documentMatches:result.results.length,totalMatches:result.totalMatches,coldMs:Number(coldMs.toFixed(2)),warmMs:Number((performance.now()-warmStart).toFixed(2)),requests,jsonBytes:transferredJSON,gzipBytes:transferredGzip,partialMessages});
 }
 const incomplete=documents.filter(item=>item.status==='incomplete'&&item.text.includes('表略')).map(item=>item.id);
 const omissions=await engine.search('表略');for(const id of incomplete)assert.ok(omissions.results.some(item=>item.docId===id),'Incomplete source omitted: '+id);
 const reportFile=path.join(ROOT,'data/source-archive/web-build-report.json'),report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
 assert.equal(report.version,manifest.version);
 report.verification={checkedAt:new Date().toISOString(),runtime:process.version,environment:'Node on local disk, JSON parse + index search; transfer sizes use generated gzip sidecars, not measured network latency',queriesChecked:rows.length,fullCorpusIndexOfComparisons:rows.length,documentsCompared:documents.length,incompleteDocumentsMatched:incomplete.length,allExact:true,startup,queries:rows,maxColdMs:Math.max(...rows.map(item=>item.coldMs)),maxWarmMs:Math.max(...rows.map(item=>item.warmMs)),maxQueryGzipBytes:Math.max(...rows.map(item=>item.gzipBytes)),requestsNeverLoadedBodyFiles:true,cacheLimitBytes:24*1024*1024};
 if(process.env.SOURCE_WEB_WRITE_REPORT==='1')fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({version:manifest.version,queries:rows.length,documents:documents.length,startup,maxColdMs:report.verification.maxColdMs,maxWarmMs:report.verification.maxWarmMs,maxQueryGzipBytes:report.verification.maxQueryGzipBytes,allExact:true}));
});

