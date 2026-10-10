import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { splitCombined } from './combined-pilot.mjs';
import { parseManuscript } from './capture.mjs';

const id='emperor_明成祖_281780435';
const a=await readFile(new URL('./drafts/04.analysisStats.response.md',import.meta.url),'utf8');
const s=await readFile(new URL('./drafts/04.soulEssence.response.md',import.meta.url),'utf8');
const joined=a.trimEnd()+'\n\n'+s;

test('splitting retains every published word and score from both tasks',()=>{
  const result=splitCombined(joined,id);
  assert.deepEqual(result.analysisFields,parseManuscript(a,id,'analysisStats'));
  assert.deepEqual(result.soulFields,parseManuscript(s,id,'soulEssence'));
});
test('known clipboard escaping is accepted at the interior completion marker',()=>{
  const result=splitCombined(joined.replace(`<!-- BATCH50_COMPLETE ${id} analysisStats -->`,`\\<!-- BATCH50_COMPLETE ${id} analysisStats -->`),id);
  assert.deepEqual(result.analysisFields,parseManuscript(a,id,'analysisStats'));
});
test('truncated soul, duplicate analysis boundary and cross-person output reject',()=>{
  assert.throws(()=>splitCombined(joined.replace(`<!-- BATCH50_COMPLETE ${id} soulEssence -->`,''),id));
  assert.throws(()=>splitCombined(a+joined,id));
  assert.throws(()=>splitCombined(joined.replace(`<!-- BATCH50_COMPLETE ${id} soulEssence -->`,'<!-- BATCH50_COMPLETE someone_else soulEssence -->'),id));
});
test('double-escaped and inline analysis boundary reject',()=>{
  assert.throws(()=>splitCombined(joined.replace(`<!-- BATCH50_COMPLETE ${id} analysisStats -->`,`\\\\<!-- BATCH50_COMPLETE ${id} analysisStats -->`),id));
  assert.throws(()=>splitCombined(joined.replace(`<!-- BATCH50_COMPLETE ${id} analysisStats -->`,`text <!-- BATCH50_COMPLETE ${id} analysisStats -->`),id));
});
