import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {verifySearchLog} from './claude-author.mjs';
import {sha256} from '../cloudflare/scripts/analysis-pilot-import.mjs';
const proof=JSON.parse(await readFile(new URL('./tasks/01.combined.json',import.meta.url),'utf8'));
const make=()=>({format:'dynasty-batch50-claude-search-log',schemaVersion:1,recordId:proof.recordId,packetSha256:proof.packetSha256,webSearches:[{tool:'WebSearch',query:'test fixture only',returnedUrls:['https://example.org/fixture']}],archiveChecks:[],limits:[]});
test('page-reading evidence binds the actual saved text and rejects a modified file',async()=>{
 const file=`analysis-batch-51-100/sources/readings/01.test-${randomUUID()}.txt`,text='Explicit test fixture, not a historical source. '.repeat(4);
 await mkdir('analysis-batch-51-100/sources/readings',{recursive:true});await writeFile(file,text,{flag:'wx'});
 try{const log=make();log.pageReads=[{url:'https://example.org/fixture',tool:'WebFetch',scope:'excerpt',readAt:'2026-10-10T00:00:00Z',textFile:file,textSha256:sha256(text)}];
  await verifySearchLog(log,proof.recordId,proof.packetSha256);
  await writeFile(file,text+'changed');await assert.rejects(verifySearchLog(log,proof.recordId,proof.packetSha256),e=>e.code==='page_read_text_changed');
 }finally{await unlink(file);}
});
test('page reads cannot access private paths or pass a scope implying unrecorded access',async()=>{
 for(const patch of [{textFile:'cloudflare/private/baseline.private.json'},{scope:'search_summary'}]){
  const log=make();log.pageReads=[{url:'https://example.org/fixture',tool:'WebFetch',scope:'excerpt',readAt:'2026-10-10T00:00:00Z',textFile:'analysis-batch-51-100/sources/readings/01.test.txt',textSha256:'a'.repeat(64),...patch}];
  await assert.rejects(verifySearchLog(log,proof.recordId,proof.packetSha256),e=>e.code==='invalid_page_read');
 }
});
