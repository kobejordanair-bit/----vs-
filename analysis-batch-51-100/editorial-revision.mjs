// Explicit Codex copy edits over sealed Claude evidence. Original captures stay intact.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
const here = dirname(fileURLToPath(import.meta.url));
// Bound to the independently reviewed, public correction policy during generation.
export const POLICY_SHA256 = '8e71dbb87af5f6b6ece40b2847b4118f47c476d8707073c97c5fd716f7ed3f74';
const json = async file => JSON.parse(await readFile(resolve(here, file), 'utf8'));
export async function loadEditorialPolicy() {
  const policy = await json('editorial-revision.20261011.json');
  if (contentHash(policy) !== POLICY_SHA256) throw Error('editorial_policy_changed');
  return policy;
}
export function applyEditorialRevision(original, policy, slug) {
  const correction = policy.records.find(item => item.slug === slug);
  if (!correction || original.records.length !== 1 || contentHash(original) !== correction.originalBatchSha256)
    throw Error('editorial_original_changed');
  const batch = structuredClone(original), item = batch.records[0];
  if (item.id !== correction.id || item.provenance.editorialRevision !== undefined) throw Error('editorial_target_changed');
  for (const patch of correction.patches) {
    if (!['analysis', 'statsAnalysis', 'soulEssence'].includes(patch.field) || !patch.before || typeof patch.after !== 'string')
      throw Error('editorial_invalid_patch');
    const text = item.fields[patch.field];
    if (typeof text !== 'string' || text.split(patch.before).length !== 2) throw Error('editorial_anchor_not_unique');
    item.fields[patch.field] = text.replace(patch.before, patch.after);
  }
  item.provenance.editorialRevision = {
    editor: 'Codex (OpenAI)', policyFile: 'analysis-batch-51-100/editorial-revision.20261011.json',
    policySha256: POLICY_SHA256, originalResultsFile: `analysis-batch-51-100/results.${slug}-${slug}.v1.json`,
    originalBatchSha256: correction.originalBatchSha256,
    note: 'Claude authored the preserved original manuscript. Codex made the listed factual copy edits; original captures are unchanged.'
  };
  return batch;
}
export async function validateEditorialRevision({ batch, manifest, validateOriginal }) {
  if (batch.records.length !== 1 || typeof validateOriginal !== 'function') throw Error('editorial_single_record_required');
  const policy = await loadEditorialPolicy(), correction = policy.records.find(item => item.id === batch.records[0].id);
  if (!correction) throw Error('editorial_target_not_authorized');
  const original = await json(`results.${correction.slug}-${correction.slug}.v1.json`);
  if (original.records.some(item => item.provenance.editorialRevision !== undefined)) throw Error('editorial_nested_revision');
  await validateOriginal({ batch: original, manifest });
  if (contentHash(applyEditorialRevision(original, policy, correction.slug)) !== contentHash(batch)) throw Error('editorial_evidence_changed');
  return true;
}
