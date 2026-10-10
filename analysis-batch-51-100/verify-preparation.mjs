// Read-only verification for a fresh Claude checkout; does not author or publish.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadFixedManifest} from './import.mjs';
import {sha256,contentHash} from '../cloudflare/scripts/analysis-pilot-import.mjs';
import {verifyOriginalPromptBinding} from './prompt-bindings.mjs';
const read=p=>readFile(resolve(p),'utf8'),json=async p=>JSON.parse(await read(p));
const root='analysis-batch-51-100',manifest=await loadFixedManifest(),first=await json('analysis-batch-50/manifest.v1.json');
if(new Set(manifest.records.map(r=>r.id)).size!==50||manifest.records.some(r=>first.records.some(p=>p.id===r.id)))throw Error('selection_duplicate');
const editorial=await read(root+'/EDITORIAL_BRIEF.md'),reference=await json(root+'/stats-reference.v1.json');
if(reference.count!==116||reference.records.length!==116||reference.records.some(r=>!Array.isArray(r.stats)||r.stats.length!==5||r.stats.some(v=>!Number.isInteger(v)||v<0||v>100)))throw Error('reference_invalid');
let people=0;
for(const item of manifest.records){
 const request=await json(`${root}/tasks/${item.slug}.json`),deep=await read(item.preserved.deepAnalysis.path),source=await read(item.sourcesPath),sourceJson=await json(`${root}/sources/${item.slug}.json`);
 if(sha256(deep)!==item.preserved.deepAnalysis.sha256||sourceJson.id!==item.id||request.manifestSha256!==contentHash(manifest)||request.sourceSha256!==sha256(source))throw Error('person_binding_changed');
 for(const task of ['analysisStats','soulEssence']){
  const prompt=await read(request.tasks[task].promptFile);if(sha256(prompt)!==request.tasks[task].promptSha256)throw Error('prompt_changed');
  verifyOriginalPromptBinding({target:item,request,task,prompt,deepAnalysis:deep,sourcePackage:source});
 }
 const proof=await json(`${root}/tasks/${item.slug}.combined.json`),packet=await read(proof.packetFile);
 if(sha256(packet)!==proof.packetSha256||proof.editorialBriefSha256!==sha256(editorial)||proof.referenceSha256!==sha256(await read(root+'/stats-reference.v1.json'))||!packet.startsWith(editorial))throw Error('compiled_binding_changed');
 people++;
}
console.log(JSON.stringify({passed:true,people,originalPromptBindings:people*2,combinedPackets:people,firstBatchOverlap:0,referencePeople:116,manifestSha256:contentHash(manifest),privateDataRead:false}));
