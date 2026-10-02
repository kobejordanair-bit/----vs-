/* Static exact-search worker. Request IDs isolate stale and cancelled results. */
'use strict';
importScripts('/static/js/source-search-engine.js');
let engine=null,active=null,generation=0;
function errorMessage(requestId,error){postMessage({type:'error',requestId,name:error.name||'Error',message:error.message||String(error),retryable:true});}
self.onmessage=async function(event){
 const message=event.data||{},requestId=message.requestId;
 if(message.type==='cancel'){
  if(active&&active.requestId===requestId)active.controller.abort();
  else postMessage({type:'cancelled',requestId,partialResults:[],totalMatches:0,documentsSearched:0});
  return;
 }
 if(message.type==='init'){
  if(active)active.controller.abort();engine=null;const current=++generation;
  try{const next=SourceSearchEngine.createEngine({search:message.search});await next.ready();if(current!==generation)return;engine=next;postMessage({type:'ready',requestId});}catch(error){if(current===generation)errorMessage(requestId,error);}return;
 }
 if(message.type!=='search')return;
 if(!engine){errorMessage(requestId,new Error('Search index is not initialized'));return;}
 if(active)active.controller.abort();
 const task={requestId,controller:new AbortController()},current=generation;active=task;
 try{
  const result=await engine.search(message.query,{bookIds:message.bookIds||[],signal:task.controller.signal,
   onProgress:progress=>{if(current===generation&&!task.controller.signal.aborted)postMessage({type:'progress',requestId,...progress});},
   onPartial:partial=>{if(current===generation&&!task.controller.signal.aborted)postMessage({type:'partial',requestId,...partial});}});
  if(current===generation&&!task.controller.signal.aborted)postMessage({type:'result',requestId,...result});
 }catch(error){
  if(error.name==='AbortError')postMessage({type:'cancelled',requestId,query:message.query,partialResults:error.partial?.results||[],totalMatches:error.partial?.totalMatches||0,documentsSearched:error.partial?.documentsSearched||0});
  else if(current===generation)errorMessage(requestId,error);
 }finally{if(active===task)active=null;}
};

