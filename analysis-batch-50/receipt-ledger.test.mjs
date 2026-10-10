import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFixedManifest, validatePriorReceiptDocument, validateChunk } from './import.mjs';
import { contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { buildReceiptLedger, reduceReceiptChain, validateMixedFinalAudit } from './receipt-ledger.mjs';
const json = async file => JSON.parse(await readFile(new URL(file,import.meta.url),'utf8'));
const manifest = await loadFixedManifest();
const steps = await Promise.all(['01-04','06-06','07-07'].map(async range => ({ file: `import.${range}.apply.json`, receipt: await json(`./import.${range}.apply.json`), dryRun: await json(`./import.${range}.dry-run.json`), batch: await json(`./results.${range}.v1.json`) })));
const soul = await json('./results.06-06.soul.v1.json');

test('mixed actual full and partial receipt chain has 23 unique fields, not ten fixed chunks', () => {
  const chain = reduceReceiptChain(steps,manifest);
  assert.equal(chain.revision,7);
  assert.equal([...chain.fields.values()].reduce((sum,fields)=>sum+fields.size,0),23);
  assert.equal([...chain.fields.values()].filter(fields=>fields.size===4).length,5);
  assert.equal(chain.fields.get(soul.records[0].id).size,3);
});

test('duplicate publication and same-revision changed documents cannot inflate the ledger', () => {
  assert.throws(()=>reduceReceiptChain([...steps,steps[0]],manifest),error=>error.code==='receipt_chain_overlap');
  const mismatch=structuredClone(steps);mismatch[1].receipt.beforeSha256='a'.repeat(64);
  assert.throws(()=>reduceReceiptChain(mismatch,manifest),error=>error.code==='receipt_chain_hash_mismatch');
});

test('failed preservation/readback cannot unlock soul continuation even with updated receipt hash', () => {
  for(const flag of ['targetsMatch','contentPreserved','revisionMatches']) {
    const receipt=structuredClone(steps[1].receipt);receipt.verification[flag]=false;
    const item=structuredClone(soul.records[0]);item.priorReceipt.sha256=contentHash(receipt);
    assert.throws(()=>validatePriorReceiptDocument(receipt,item,manifest),error=>error.code==='prior_receipt_mismatch');
  }
  const receipt=structuredClone(steps[1].receipt);receipt.verification.unaffectedAfterSha256='a'.repeat(64);
  const item=structuredClone(soul.records[0]);item.priorReceipt.sha256=contentHash(receipt);
  assert.throws(()=>validatePriorReceiptDocument(receipt,item,manifest),error=>error.code==='prior_receipt_mismatch');
});

test('a complete valid full batch cannot smuggle a prior receipt', async () => {
  const full=await json('./results.08-08.v1.json');full.records[0].priorReceipt=soul.records[0].priorReceipt;
  assert.throws(()=>validateChunk(full),error=>error.code==='invalid_completion_record');
});

test('real file-backed ledger binds both authors to the completed production final audit',async()=>{
  const ledger=await buildReceiptLedger();
  assert.equal(ledger.counts.assembled,50);assert.equal(ledger.counts.imported,50);
  assert.equal(ledger.counts.partialImported,0);assert.equal(ledger.counts.importedFields,200);
  assert.equal(ledger.complete,true);assert.equal(ledger.finalAuditVerified,true);
  assert.equal(ledger.imports.length,48);
  assert.equal(ledger.records.find(item=>item.slug==='06').published.analysis.provider,'ChatGPT web');
  assert.equal(ledger.records.find(item=>item.slug==='06').assembledFields.soulEssence.provider,'Claude Code (Anthropic)');
  const actualSteps=await Promise.all(ledger.imports.map(async item=>({file:item.file,receipt:await json('./'+item.file),dryRun:await json('./'+item.file.replace('apply.json','dry-run.json')),batch:await json('./'+item.resultsFile)})));
  const chain=reduceReceiptChain(actualSteps,manifest),audit=await json('./final-audit.mixed.v2.json');
  const changed=structuredClone(audit);changed.writtenFieldHashes[0].sha256='a'.repeat(64);
  assert.throws(()=>validateMixedFinalAudit(changed,chain,manifest),e=>e.code==='mixed_final_audit_binding');
  const forged=structuredClone(audit);forged.publicationSnapshots[0].receiptSha256='a'.repeat(64);
  assert.throws(()=>validateMixedFinalAudit(forged,chain,manifest),e=>e.code==='mixed_final_audit_snapshot_binding');
});import { loadClaudePerson, assembleClaudeResults } from './claude-author.mjs';

test('source access labels and review search hashes must point to the recorded evidence', async () => {
  const person=await loadClaudePerson('08');
  const stale=structuredClone(person);stale.tasks.analysisStats.review.searchLogSha256='a'.repeat(64);
  assert.throws(()=>assembleClaudeResults({manifest,people:[stale]}),error=>error.code==='review_search_log_changed');
  const forged=structuredClone(person);forged.tasks.analysisStats.review.checkedSources[0].access='web_search_result_summary';
  assert.throws(()=>assembleClaudeResults({manifest,people:[forged]}),error=>error.code==='source_access_evidence_missing');
});
