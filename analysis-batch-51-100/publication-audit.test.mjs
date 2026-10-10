import test from 'node:test';
import assert from 'node:assert/strict';
import {contentHash} from '../cloudflare/scripts/analysis-pilot-import.mjs';
import {loadFixedManifest,COMPLETION_FIELDS} from './import.mjs';
import {validatePublicationAudit} from './publication-audit.mjs';
const manifest=await loadFixedManifest(),hash='a'.repeat(64);
function fixture(){
  const fields=new Map(manifest.records.map(item=>[item.id,new Map(COMPLETION_FIELDS.map(field=>[field,{sha256:hash}]))]));
  let revision=manifest.baselineRevision,documentSha256=manifest.sourceSha256;
  const ordered=[],publicationSnapshots=[];
  for(const target of manifest.records){
    const beforeRevision=revision,beforeSha256=documentSha256;
    revision++;documentSha256=contentHash({revision});
    const verification={passed:true,afterRevision:revision,afterSha256:documentSha256};
    const receipt={beforeRevision,beforeSha256,verification,rawExtrasPreserved:true};
    ordered.push({receipt});publicationSnapshots.push({slug:target.slug,receiptSha256:contentHash(receipt),verification,
      transition:{fromRevision:beforeRevision,toRevision:beforeRevision,fromSha256:beforeSha256,toSha256:beforeSha256,changedFields:[]}});
  }
  const library={beforeTotal:962,afterTotal:962,idsPreserved:true,idsBeforeSha256:hash,idsAfterSha256:hash};
  const audit={format:'dynasty-batch51-100-publication-final-audit',schemaVersion:2,passed:true,actualProductionRead:true,privateDataIncluded:false,
    manifestSha256:contentHash(manifest),revision,documentSha256,library,
    writtenFieldHashes:manifest.records.flatMap(item=>COMPLETION_FIELDS.map(field=>({id:item.id,field,sha256:hash}))),
    preservation:{library,nonProgressBaselinePreserved:true,nonProgressInitialSha256:hash,nonProgressFinalSha256:hash,preservedDeepHashes:manifest.records.map(item=>({id:item.id,sha256:item.preserved.deepAnalysis.sha256}))},
    rawExtrasPreserved:true,rawExtrasSha256:hash,finalReadReceiptSha256:hash,publicationSnapshots,
    finalTransition:{fromRevision:revision,toRevision:revision,fromSha256:documentSha256,toSha256:documentSha256,changedFields:[]}};
  return {audit,chain:{fields,ordered,revision,documentSha256}};
}
test('complete individual receipt chain binds the final production observation',()=>{
  const {audit,chain}=fixture();assert.equal(validatePublicationAudit(audit,chain,manifest),true);
});
test('missing or reordered publication evidence is rejected',()=>{
  const {audit,chain}=fixture();audit.publicationSnapshots.pop();assert.throws(()=>validatePublicationAudit(audit,chain,manifest));
  const other=fixture();[other.audit.publicationSnapshots[0],other.audit.publicationSnapshots[1]]=[other.audit.publicationSnapshots[1],other.audit.publicationSnapshots[0]];
  assert.throws(()=>validatePublicationAudit(other.audit,other.chain,manifest));
});
test('changed written content, deep analysis or final read cannot be marked complete',()=>{
  for(const change of [a=>a.writtenFieldHashes[0].sha256='b'.repeat(64),a=>a.preservation.preservedDeepHashes[0].sha256=hash,a=>a.finalTransition.toRevision--]){
    const {audit,chain}=fixture();change(audit);assert.throws(()=>validatePublicationAudit(audit,chain,manifest));
  }
});
test('unclassified library changes between writes are rejected',()=>{
  const {audit,chain}=fixture();audit.publicationSnapshots[3].transition.changedFields=['customLegends'];
  assert.throws(()=>validatePublicationAudit(audit,chain,manifest));
});
