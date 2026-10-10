// Public evidence only. Registration booleans never establish publication.
import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictJsonParse } from '../cloudflare/src/contracts.mjs';
import { contentHash, sha256, PilotError } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { loadFixedManifest, validateBatch50Evidence, batchFields, COMPLETION_FIELDS, SOUL_FORMAT, validatePriorReceiptDocument } from './import.mjs';
import { readRegularText } from './capture.mjs';
import { validateImportReceipt } from './audit-progress.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const bad = code => { throw new PilotError(code); };
const read = async file => strictJsonParse(await readRegularText(resolve(root, file)));

export function reduceReceiptChain(steps, manifest) {
  const ordered = [...steps].sort((a,b) => a.receipt.beforeRevision - b.receipt.beforeRevision);
  const fields = new Map(manifest.records.map(item => [item.id, new Map()]));
  let revision = manifest.baselineRevision, hash = manifest.sourceSha256;
  const transitions = [];
  for (const step of ordered) {
    validateImportReceipt({ ...step, manifest });
    const receipt = step.receipt;
    if (receipt.beforeRevision < revision) bad('receipt_chain_overlap');
    if (receipt.beforeRevision === revision && receipt.beforeSha256 !== hash) bad('receipt_chain_hash_mismatch');
    if (receipt.beforeRevision > revision) transitions.push({ fromRevision: revision, toRevision: receipt.beforeRevision, classification: 'requires_private_snapshot_classification' });
    for (const item of step.batch.records) {
      if (step.batch.format === SOUL_FORMAT) {
        const prior = ordered.find(previous => `analysis-batch-50/${previous.file}` === item.priorReceipt.file);
        if (!prior || prior.receipt.verification.afterRevision > receipt.beforeRevision) bad('prior_receipt_not_in_chain');
        validatePriorReceiptDocument(prior.receipt, item, manifest);
      }
      for (const field of batchFields(step.batch)) {
        if (fields.get(item.id).has(field)) bad('receipt_rewrites_published_field');
        const written = receipt.writtenFieldHashes.find(value => value.id === item.id && value.field === field);
        fields.get(item.id).set(field, { sha256: written.sha256, provider: item.provenance.provider, receiptFile: step.file });
      }
    }
    revision = receipt.verification.afterRevision; hash = receipt.verification.afterSha256;
  }
  return { fields, ordered, revision, documentSha256: hash, transitions };
}

export function validateMixedFinalAudit(audit, chain, manifest) {
  const hashOk=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  const expected=manifest.records.flatMap(item=>COMPLETION_FIELDS.map(field=>({id:item.id,field,sha256:chain.fields.get(item.id).get(field)?.sha256})));
  const sorted=items=>[...items].sort((a,b)=>(a.id+'|'+a.field).localeCompare(b.id+'|'+b.field));
  if(audit?.format!=='dynasty-batch50-mixed-final-audit'||audit.schemaVersion!==2||audit.passed!==true||audit.actualProductionRead!==true||audit.privateDataIncluded!==false
    ||audit.manifestSha256!==contentHash(manifest)||audit.revision!==chain.revision||audit.documentSha256!==chain.documentSha256
    ||expected.some(item=>!hashOk(item.sha256))||!Array.isArray(audit.writtenFieldHashes)||contentHash(sorted(audit.writtenFieldHashes))!==contentHash(sorted(expected)))bad('mixed_final_audit_binding');
  const p=audit.preservation,l=audit.library;
  if(!l||l.beforeTotal!==962||l.afterTotal!==962||l.idsPreserved!==true||!hashOk(l.idsBeforeSha256)||l.idsBeforeSha256!==l.idsAfterSha256
    ||!p||contentHash(p.library)!==contentHash(l)||p.nonProgressBaselinePreserved!==true||!hashOk(p.nonProgressInitialSha256)||p.nonProgressInitialSha256!==p.nonProgressFinalSha256
    ||audit.rawExtrasPreserved!==true||!hashOk(audit.rawExtrasSha256)||!hashOk(audit.finalReadReceiptSha256))bad('mixed_final_audit_preservation');
  const preserved=new Map(p.preservedDeepHashes?.map(item=>[item.id,item.sha256]));
  if(manifest.records.some(item=>preserved.get(item.id)!==item.preserved.deepAnalysis.sha256))bad('mixed_final_audit_deep_binding');
  const snapshots=audit.publicationSnapshots;
  if(!Array.isArray(snapshots)||snapshots.length!==45)bad('mixed_final_audit_snapshot_count');
  const seen=new Set();for(const snapshot of snapshots){const step=chain.ordered.find(s=>contentHash(s.receipt)===snapshot.receiptSha256);if(!step||seen.has(snapshot.receiptSha256)||contentHash(snapshot.verification)!==contentHash(step.receipt.verification))bad('mixed_final_audit_snapshot_binding');seen.add(snapshot.receiptSha256);
    const t=snapshot.transition;if(!t||t.toRevision!==step.receipt.beforeRevision||t.toSha256!==step.receipt.beforeSha256||!Array.isArray(t.changedFields)||t.changedFields.some(f=>!['gameState','worldDeskState','gameHistory','simulationHistory','courtHistory','debateHistory','soulHistory','crisisHistory','snapshotHistory','history'].includes(f)))bad('mixed_final_audit_transition');}
  const t=audit.finalTransition;if(t?.fromRevision!==chain.revision||t.toRevision!==audit.revision||t.fromSha256!==chain.documentSha256||t.toSha256!==audit.documentSha256||t.changedFields?.length!==0)bad('mixed_final_audit_final_read_binding');
  return true;
}

export async function buildReceiptLedger() {
  const manifest = await loadFixedManifest(), files = await readdir(root);
  const batches = new Map(), staged = new Map(manifest.records.map(item => [item.id, new Map()]));
  for (const file of files.filter(name => /^results\.\d\d-\d\d(?:\.soul)?\.v1\.json$/.test(name))) {
    const batch = await read(file); batches.set(contentHash(batch), { batch, file });
  }
  const steps = [];
  for (const file of files.filter(name => /^import\.\d\d-\d\d(?:\.soul)?\.apply\.json$/.test(name))) {
    const receipt = await read(file), result = batches.get(receipt.batchSha256);
    if (!result) bad('receipt_result_missing');
    const dryRun = await read(file.replace(/apply\.json$/, 'dry-run.json'));
    await validateBatch50Evidence({ batch: result.batch });
    steps.push({ file, receipt, dryRun, batch: result.batch, resultsFile: result.file });
  }
  const chain = reduceReceiptChain(steps, manifest);
  // All newly assembled Claude files must rebuild from their actual captures,
  // reviews, source logs and policy. Unused legacy dry-run artifacts are excluded.
  const checked = new Set();
  for (const [hash, result] of batches) {
    if (!result.batch.records.some(item => item.provenance?.provider === 'Claude Code (Anthropic)') && !steps.some(step => step.receipt.batchSha256 === hash)) continue;
    await validateBatch50Evidence({ batch: result.batch }); checked.add(hash);
    for (const item of result.batch.records) for (const field of batchFields(result.batch)) staged.get(item.id).set(field, { resultsFile: result.file, provider: item.provenance.provider });
  }
  const records = manifest.records.map(item => {
    const published = chain.fields.get(item.id), available = staged.get(item.id);
    const full = COMPLETION_FIELDS.every(field => published.has(field)), assembled = COMPLETION_FIELDS.every(field => available.has(field));
    return { slug: item.slug, id: item.id, name: item.context.name, prepared: true,
      generated: assembled, reviewed: assembled, sourceQA: assembled, assembled,
      imported: full, verified: full, fullyImported: full,
      importedFields: COMPLETION_FIELDS.filter(field => published.has(field)),
      published: Object.fromEntries(published), assembledFields: Object.fromEntries(available),
      status: full ? 'fully_imported' : published.size ? 'partial_imported_with_assembled_continuation' : assembled ? 'assembled_awaiting_local_dry_run' : 'incomplete' };
  });
  const count = key => records.filter(item => item[key]).length;
  let finalAuditVerified=false;
  if(files.includes('final-audit.mixed.v2.json'))finalAuditVerified=validateMixedFinalAudit(await read('final-audit.mixed.v2.json'),chain,manifest);
  return { format: 'dynasty-batch50-receipt-ledger', schemaVersion: 2, generatedAt: new Date().toISOString(),
    manifestSha256: contentHash(manifest), targetCount: 50, libraryTotalExpected: 962,
    status: finalAuditVerified ? 'fully_published_final_audit_verified' : count('verified') === 50 ? 'all_fields_receipted_final_audit_pending' : 'assembled_awaiting_publication',
    passed: true, complete: finalAuditVerified, finalAuditVerified, libraryPreserved: finalAuditVerified ? true : null,
    basis: 'Validated apply + dry-run receipts and rebuilt manuscript evidence; no registration flags or fixed five-person chunks.',
    latestVerifiedPublicationRevision: chain.revision, latestReceiptedDocumentSha256: chain.documentSha256,
    counts: { prepared: 50, generated: count('generated'), reviewed: count('reviewed'), sourceQA: count('sourceQA'), assembled: count('assembled'), imported: count('imported'), verified: count('verified'),
      partialImported: records.filter(item => item.importedFields.length && !item.imported).length,
      importedPeople: records.filter(item => item.importedFields.length).length,
      importedFields: records.reduce((sum,item) => sum + item.importedFields.length,0), remainingIncomplete: 50-count('verified') },
    imports: chain.ordered.map(step => ({ file: step.file, receiptSha256: contentHash(step.receipt), resultsFile: step.resultsFile, beforeRevision: step.receipt.beforeRevision, afterRevision: step.receipt.verification.afterRevision, changedFields: step.receipt.changedFields })),
    externalTransitionsRequiringSnapshotProof: chain.transitions, rebuiltBatchCount: checked.size,
    finalAuditNote: finalAuditVerified ? 'All fields and preserved library were verified by the production final read at latestVerifiedPublicationRevision; this records that observation, not perpetual freshness.' : 'Receipt readbacks establish publication at each recorded revision, not a fresh current production read. Mixed-chain private final snapshot + identity/raw-extra audit is still required to declare overall completion.', records };
}
