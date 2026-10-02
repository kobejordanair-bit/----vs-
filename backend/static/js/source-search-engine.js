/* Exact UTF-16 literal search over static, versioned positional indexes. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SourceSearchEngine=factory();}(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const ENGINE_VERSION='1.0.0';
function abortError(){const error=new Error('Search cancelled');error.name='AbortError';return error;}
function check(signal){if(signal?.aborted)throw abortError();}
function shardForGram(value,count){let hash=value>>>0;hash=Math.imul(hash^(hash>>>16),0x45d9f3b)>>>0;hash=Math.imul(hash^(hash>>>16),0x45d9f3b)>>>0;return (hash^(hash>>>16))&(count-1);}
function gramAt(text,index){return ((text.charCodeAt(index)*65536)+text.charCodeAt(index+1))>>>0;}
function base64Bytes(value){
 if(typeof value!=='string'||value.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('Invalid index base64');
 if(typeof Buffer!=='undefined')return new Uint8Array(Buffer.from(value,'base64'));
 const decoded=atob(value),bytes=new Uint8Array(decoded.length);for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);return bytes;
}
function decodeVarints(data,count){
 const bytes=base64Bytes(data),output=new Uint32Array(count);let cursor=0;
 for(let index=0;index<count;index++){
  let value=0,multiplier=1,done=false;
  for(let byteIndex=0;byteIndex<5;byteIndex++){
   if(cursor>=bytes.length)throw Error('Truncated index varint');
   const byte=bytes[cursor++];value+=(byte&127)*multiplier;
   if(value>0xffffffff)throw Error('Index varint overflow');
   if(!(byte&128)){done=true;break;}multiplier*=128;
  }
  if(!done)throw Error('Invalid index varint');output[index]=value;
 }
 if(cursor!==bytes.length)throw Error('Unexpected index trailing bytes');return output;
}
function decodePositions(entry,maxPositions){
 if(!Array.isArray(entry)||!Number.isSafeInteger(entry[0])||entry[0]<1||entry[0]>maxPositions)throw Error('Invalid position count');
 const output=decodeVarints(entry[1],entry[0]);let previous=0;
 for(let i=0;i<output.length;i++){if(i&&output[i]===0)throw Error('Duplicate index position');previous+=output[i];if(previous>0xffffffff)throw Error('Position overflow');output[i]=previous;}
 return output;
}
function createEngine({search,fetchJSON,yieldControl,maxCacheBytes=24*1024*1024}={}){
 if(!search||search.format!=='dynasty-literal-search'||search.schemaVersion!==1||search.unit!=='utf16-code-unit'||search.encoding!=='delta-varint-base64-v1')throw Error('Unsupported search index');
 for(const kind of ['bigrams','unigrams']){const config=search[kind];if(!config||!Number.isInteger(config.shardCount)||config.shardCount<1||config.shardCount>256||(config.shardCount&(config.shardCount-1))||!config.pathTemplate?.includes('{shard}'))throw Error('Invalid search shard configuration');}
 const fetcher=fetchJSON||async function(url,signal){const response=await fetch(url,{credentials:'same-origin',signal});if(!response.ok)throw Error('Index request failed (HTTP '+response.status+')');return response.json();};
 const giveWay=yieldControl||(()=>new Promise(resolve=>setTimeout(resolve,0)));
 const cache=new Map();let cacheBytes=0,documents=null;
 async function ready(signal){
  check(signal);if(documents)return documents;
  const value=await fetcher(search.documentsPath,signal);check(signal);
  if(value?.format!=='dynasty-search-documents'||value.schemaVersion!==1||value.version!==search.version||!Array.isArray(value.documents)||value.documents.length!==search.documentCount)throw Error('Search document catalogue version mismatch');
  let previousEnd=-1;const seen=new Set();
  for(const item of value.documents){if(!item||typeof item.id!=='string'||typeof item.bookId!=='string'||seen.has(item.id)||!Number.isSafeInteger(item.start)||!Number.isSafeInteger(item.length)||item.length<0||item.start<=previousEnd||item.start+item.length>0xffffffff)throw Error('Invalid search document bounds');seen.add(item.id);previousEnd=item.start+item.length;}
  documents=value.documents;return documents;
 }
 async function loadShard(kind,gram,signal){
  check(signal);const config=search[kind],shard=shardForGram(gram,config.shardCount),key=kind+':'+shard;
  if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit.value;}
  const url=config.pathTemplate.replace('{shard}',shard.toString(16).padStart(2,'0')),value=await fetcher(url,signal);check(signal);
  if(value?.format!=='dynasty-'+kind+'-shard'||value.schemaVersion!==1||value.version!==search.version||value.shard!==shard||!value.entries||typeof value.entries!=='object')throw Error('Search shard version mismatch');
  const bytes=Object.entries(value.entries).reduce((sum,[key,entry])=>sum+key.length+(typeof entry?.[1]==='string'?entry[1].length:0)+32,0);
  while(cache.size&&cacheBytes+bytes>maxCacheBytes){const first=cache.keys().next().value;cacheBytes-=cache.get(first).bytes;cache.delete(first);}
  if(bytes<=maxCacheBytes){cache.set(key,{value,bytes});cacheBytes+=bytes;}return value;
 }
 function findDocument(position){
  let left=0,right=documents.length-1;
  while(left<=right){const mid=(left+right)>>>1,item=documents[mid];if(position<item.start)right=mid-1;else if(position>=item.start+item.length)left=mid+1;else return mid;}return -1;
 }
 async function perform(query,{bookIds=[],signal,onProgress=()=>{},onPartial=()=>{}}={}){
  if(typeof query!=='string')throw TypeError('Search query must be a string');
  const started=Date.now(),results=[];let totalMatches=0,documentsSearched=0,lastYield=Date.now(),lastPartial=0;
  const report=(incomplete=false)=>({query,results:results.slice(),totalMatches,documentsSearched,elapsedMs:Date.now()-started,exact:true,...(incomplete?{incomplete:true}:{})});
  async function cooperate(force=false){check(signal);if(force||Date.now()-lastYield>=12){await giveWay();lastYield=Date.now();check(signal);}}
  function partial(){if(!lastPartial||Date.now()-lastPartial>=80){onPartial(report(true));lastPartial=Date.now();}}
  try{
   await ready(signal);check(signal);
   const books=new Set(bookIds||[]),selected=documents.map(item=>!books.size||books.has(item.bookId)),totalDocuments=selected.filter(Boolean).length;
   const completedBefore=new Uint32Array(documents.length+1);for(let i=0;i<documents.length;i++)completedBefore[i+1]=completedBefore[i]+Number(selected[i]);
   if(!query||!totalDocuments){documentsSearched=totalDocuments;return report();}
   if(query.length===1){
    const code=query.charCodeAt(0),shard=await loadShard('unigrams',code,signal),entry=shard.entries[String(code)];
    onProgress({phase:'index',completed:1,total:1});await cooperate(true);
    if(entry){
     if(!Array.isArray(entry)||!Number.isSafeInteger(entry[0])||entry[0]<1||entry[0]>documents.length)throw Error('Invalid unigram document count');
     const values=decodeVarints(entry[1],entry[0]*3);let ordinal=0;
     for(let i=0;i<values.length;i+=3){
      if(i&&values[i]===0)throw Error('Duplicate unigram document');ordinal+=values[i];
      const item=documents[ordinal],count=values[i+1],offset=values[i+2];
      if(!item||!count||count>item.length||offset>=item.length)throw Error('Invalid unigram bounds');
      if(selected[ordinal]){results.push({docId:item.id,count,offset,firstOffset:offset});totalMatches+=count;}
      documentsSearched=completedBefore[ordinal+1];
      if((i/3+1)%24===0){partial();await cooperate();}
     }
    }
    documentsSearched=totalDocuments;return report();
   }
   // Disjoint bigrams cover all query code units; odd lengths overlap the last.
   const constraints=[];for(let offset=0;offset<query.length-1;offset+=2)constraints.push({gram:gramAt(query,offset),offset});
   if(query.length%2)constraints.push({gram:gramAt(query,query.length-2),offset:query.length-2});
   const unique=[...new Set(constraints.map(item=>item.gram))],postings=new Map();
   for(let i=0;i<unique.length;i++){
    const gram=unique[i],shard=await loadShard('bigrams',gram,signal),entry=shard.entries[String(gram)];
    onProgress({phase:'index',completed:i+1,total:unique.length});await cooperate(true);
    if(!entry){documentsSearched=totalDocuments;return report();}
    postings.set(gram,decodePositions(entry,search.characters));await cooperate();
   }
   constraints.sort((a,b)=>postings.get(a.gram).length-postings.get(b.gram).length);
   const anchor=constraints[0],starts=postings.get(anchor.gram),candidates=new Uint32Array(starts.length);let size=0;
   for(let i=0;i<starts.length;i++){
    const position=starts[i]-anchor.offset;if(position<0)continue;
    const ordinal=findDocument(position);
    if(ordinal>=0&&selected[ordinal]&&position+query.length<=documents[ordinal].start+documents[ordinal].length)candidates[size++]=position;
    if((i&8191)===0)await cooperate();
   }
   for(let k=1;k<constraints.length&&size;k++){
    const constraint=constraints[k],positions=postings.get(constraint.gram);let pointer=0,write=0;
    for(let i=0;i<size;i++){
     const target=candidates[i]+constraint.offset;while(pointer<positions.length&&positions[pointer]<target)pointer++;
     if(pointer<positions.length&&positions[pointer]===target)candidates[write++]=candidates[i];
     if((i&8191)===0)await cooperate();
    }
    size=write;onProgress({phase:'verify',completed:k,total:constraints.length-1});await cooperate();
   }
   let currentOrdinal=-1,current=null,lastAccepted=-1,closed=0;
   function finishCurrent(){
    if(current){results.push(current);totalMatches+=current.count;documentsSearched=completedBefore[currentOrdinal+1];current=null;closed++;}
   }
   for(let i=0;i<size;i++){
    const position=candidates[i],ordinal=findDocument(position);
    if(ordinal!==currentOrdinal){finishCurrent();currentOrdinal=ordinal;lastAccepted=-1;
     if(closed&&closed%24===0){partial();await cooperate();}
    }
    if(position<lastAccepted+query.length&&lastAccepted>=0)continue;
    const offset=position-documents[ordinal].start;
    if(!current)current={docId:documents[ordinal].id,count:0,offset,firstOffset:offset};
    current.count++;lastAccepted=position;if((i&8191)===0)await cooperate();
   }
   finishCurrent();documentsSearched=totalDocuments;check(signal);return report();
  }catch(error){
   if(signal?.aborted||error.name==='AbortError'){const cancelled=abortError();cancelled.partial=report(true);throw cancelled;}throw error;
  }
 }
 return {ready,search:perform,clearCache(){cache.clear();cacheBytes=0;},cacheInfo(){return {shards:cache.size,bytes:cacheBytes};}};
}
return {ENGINE_VERSION,createEngine,shardForGram,gramAt,decodeVarints,decodePositions};
}));

