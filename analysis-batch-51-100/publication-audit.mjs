import {contentHash, PilotError} from '../cloudflare/scripts/analysis-pilot-import.mjs';
import {COMPLETION_FIELDS} from './import.mjs';
import {PROGRESS_FIELDS} from './final-audit-proof.mjs';
const bad=code=>{throw new PilotError(code);};
const hashOk=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sorted=items=>[...items].sort((a,b)=>(a.id+'|'+a.field).localeCompare(b.id+'|'+b.field));
export function validatePublicationAudit(audit,chain,manifest){
  const expected=manifest.records.flatMap(item=>COMPLETION_FIELDS.map(field=>({id:item.id,field,sha256:chain.fields.get(item.id).get(field)?.sha256})));
  if(audit?.format!=='dynasty-batch51-100-publication-final-audit'||audit.schemaVersion!==2||audit.passed!==true||audit.actualProductionRead!==true||audit.privateDataIncluded!==false
    ||audit.manifestSha256!==contentHash(manifest)||audit.revision!==chain.revision||audit.documentSha256!==chain.documentSha256
    ||expected.some(item=>!hashOk(item.sha256))||!Array.isArray(audit.writtenFieldHashes)||contentHash(sorted(audit.writtenFieldHashes))!==contentHash(sorted(expected)))bad('publication_audit_binding');
  const p=audit.preservation,l=audit.library;
  if(!l||l.beforeTotal!==962||l.afterTotal!==962||l.idsPreserved!==true||!hashOk(l.idsBeforeSha256)||l.idsBeforeSha256!==l.idsAfterSha256
    ||!p||contentHash(p.library)!==contentHash(l)||p.nonProgressBaselinePreserved!==true||!hashOk(p.nonProgressInitialSha256)||p.nonProgressInitialSha256!==p.nonProgressFinalSha256
    ||audit.rawExtrasPreserved!==true||!hashOk(audit.rawExtrasSha256)||!hashOk(audit.finalReadReceiptSha256))bad('publication_audit_preservation');
  const preserved=new Map(p.preservedDeepHashes?.map(item=>[item.id,item.sha256]));
  if(manifest.records.some(item=>preserved.get(item.id)!==item.preserved.deepAnalysis.sha256))bad('publication_deep_binding');
  const snapshots=audit.publicationSnapshots;
  if(!Array.isArray(snapshots)||snapshots.length!==chain.ordered.length||snapshots.length!==50)bad('publication_snapshot_count');
  let previousRevision=manifest.baselineRevision,previousHash=manifest.sourceSha256;
  for(const [at,snapshot]of snapshots.entries()){
    const step=chain.ordered[at];
    if(contentHash(step.receipt)!==snapshot.receiptSha256||contentHash(snapshot.verification)!==contentHash(step.receipt.verification)||step.receipt.rawExtrasPreserved!==true)bad('publication_snapshot_binding');
    const t=snapshot.transition;
    if(!t||t.fromRevision!==previousRevision||t.fromSha256!==previousHash||t.toRevision!==step.receipt.beforeRevision||t.toSha256!==step.receipt.beforeSha256
      ||t.toRevision<t.fromRevision||!Array.isArray(t.changedFields)||t.changedFields.some(f=>!PROGRESS_FIELDS.includes(f))
      ||t.toRevision===t.fromRevision&&(t.toSha256!==t.fromSha256||t.changedFields.length))bad('publication_transition');
    previousRevision=step.receipt.verification.afterRevision;previousHash=step.receipt.verification.afterSha256;
  }
  const t=audit.finalTransition;
  if(t?.fromRevision!==chain.revision||t.toRevision!==audit.revision||t.fromSha256!==chain.documentSha256||t.toSha256!==audit.documentSha256||t.changedFields?.length!==0)bad('publication_final_read_binding');
  return true;
}
