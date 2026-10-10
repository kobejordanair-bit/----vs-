import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateChunk, validateBatch50Evidence, loadFixedManifest } from './import.mjs';
import { verifySearchLog, splitClaudeCombined, assembleClaudeResults, loadClaudePerson } from './claude-author.mjs';
import { validClaudeProvenance, AUTHOR_POLICY_SHA256, CLAUDE_PROVIDER } from './claude/provenance.mjs';
import { locate } from './claude/archive-quote.mjs';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const batch = await json('./results.08-08.v1.json');
const code = name => error => error?.code === name;

test('Claude results pass chunk validation and file-backed evidence rebuild', async () => {
  assert.equal(batch.records[0].provenance.provider, CLAUDE_PROVIDER);
  assert.equal(batch.records[0].provenance.conversationUrl, undefined);
  validateChunk(batch);
  assert.equal(await validateBatch50Evidence({ batch }), true);
});

test('Claude text cannot be relabelled as ChatGPT or carry a ChatGPT URL', () => {
  const relabelled = structuredClone(batch);
  relabelled.records[0].provenance.provider = 'ChatGPT web';
  assert.throws(() => validateChunk(relabelled), code('invalid_provenance'));
  const fakeUrl = structuredClone(batch);
  fakeUrl.records[0].provenance.conversationUrl = 'https://chatgpt.com/c/abc';
  assert.throws(() => validateChunk(fakeUrl), code('invalid_provenance'));
  assert.equal(validClaudeProvenance({ ...batch.records[0].provenance, authorPolicySha256: '0'.repeat(64) }), false);
  assert.equal(validClaudeProvenance({ ...batch.records[0].provenance, sessionUrl: 'https://claude.ai/chat/x' }), false);
});

test('edited fields or mixed providers fail the evidence gate', async () => {
  const edited = structuredClone(batch);
  edited.records[0].fields.stats = [88, 48, 95, 97, 87];
  edited.records[0].fields.statsAnalysis = edited.records[0].fields.statsAnalysis.replace('魅力：86', '魅力：87');
  validateChunk(edited);
  await assert.rejects(validateBatch50Evidence({ batch: edited }), code('batch_evidence_changed'));
  const original = await json('./results.07-07.v1.json');
  const mixed = { ...batch, records: [...original.records, ...batch.records] };
  validateChunk(mixed);
  await assert.rejects(validateBatch50Evidence({ batch: mixed }), code('mixed_provider_batch'));
});

test('search log rejects a quotation that is not in the archive', async () => {
  const log = await json('./drafts/08.combined.search-log.json');
  await verifySearchLog(log, log.recordId, log.packetSha256);
  const forged = structuredClone(log);
  forged.archiveChecks.push({ ...log.archiveChecks[0], quote: '宣帝親率五萬騎出塞' });
  await assert.rejects(verifySearchLog(forged, log.recordId, log.packetSha256), code('archive_check_failed'));
  await assert.rejects(verifySearchLog({ ...log, webSearches: [] }, log.recordId, log.packetSha256), code('invalid_search_log'));
});

test('self-review must be declared and source access stated', async () => {
  const manifest = await loadFixedManifest(), person = await loadClaudePerson('08');
  assembleClaudeResults({ manifest, people: [person] });
  const undeclared = structuredClone(person);
  undeclared.tasks.analysisStats.review.reviewer.independent = true;
  assert.throws(() => assembleClaudeResults({ manifest, people: [undeclared] }), code('self_review_not_declared'));
  const noAccess = structuredClone(person);
  delete noAccess.tasks.soulEssence.review.checkedSources[0].access;
  assert.throws(() => assembleClaudeResults({ manifest, people: [noAccess] }), code('source_access_not_declared'));
});

test('combined split needs both exact markers; quote locator skips commentary', () => {
  const id = batch.records[0].id;
  assert.throws(() => splitClaudeCombined('x\n', id), code('combined_incomplete'));
  assert.throws(() => splitClaudeCombined('a\r\nb', id), code('invalid_claude_manuscript'));
  assert.deepEqual(locate('上爲〔師古曰：「注」〕之涕泣', '上爲之涕泣'), [{ charStart: 0, charEnd: 14 }]);
  assert.equal(AUTHOR_POLICY_SHA256.length, 64);
});
