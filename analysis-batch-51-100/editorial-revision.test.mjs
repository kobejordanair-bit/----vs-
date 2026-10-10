import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBatch50Evidence} from './import.mjs';
import {applyEditorialRevision,loadEditorialPolicy} from './editorial-revision.mjs';
const read=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
test('explicit copy edits rebuild from unchanged Claude captures and the sealed policy',async()=>{
  for(const slug of ['04','47'])assert.equal(await validateBatch50Evidence({batch:await read(`results.${slug}-${slug}.editorial.v1.json`)}),true);
});
test('unlisted score or prose changes cannot hide behind an editorial label',async()=>{
  const batch=await read('results.04-04.editorial.v1.json');
  batch.records[0].fields.stats[0]++;
  await assert.rejects(validateBatch50Evidence({batch}));
  const prose=await read('results.47-47.editorial.v1.json');
  prose.records[0].fields.analysis+='invented claim';
  await assert.rejects(validateBatch50Evidence({batch:prose}));
});
test('editor attribution and original evidence hashes are bound',async()=>{
  const batch=await read('results.47-47.editorial.v1.json');
  batch.records[0].provenance.editorialRevision.editor='Claude';
  await assert.rejects(validateBatch50Evidence({batch}));
  const original=await read('results.04-04.v1.json');
  original.records[0].fields.analysis+='changed';
  assert.throws(()=>applyEditorialRevision(original,awaitPolicy,'04'));
});
const awaitPolicy=await loadEditorialPolicy();
