import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sha256 } from '../scripts/analysis-pilot-import.mjs';
import { loadOriginalPromptMaterials, verifyOriginalTemplateLiterals } from '../../analysis-pilot/original-prompt-renderer.mjs';

const item = raw => ({ rawTemplateLiteral: raw, templateSha256: sha256(raw) });
test('UI changes retain original literals while actual prompt changes fail', () => {
  const literals = [item('`first\r\nsecond`'), item('`五維附錄`')];
  assert.equal(verifyOriginalTemplateLiterals('new UI\nconst a=`first\nsecond`;const b=`五維附錄`;', literals), true);
  assert.throws(() => verifyOriginalTemplateLiterals('const a=`first\nsecond`;const b=`changed`;', literals), e => e.code === 'original_template_source_mismatch');
  assert.throws(() => verifyOriginalTemplateLiterals('const a=`first\nsecond`;const b=`五維附錄`;', [{ ...literals[0], templateSha256: 'a'.repeat(64) }]), e => e.code === 'original_template_source_mismatch');
});
test('sealed historical source and all six original templates remain reproducible', async () => {
  const materials = await loadOriginalPromptMaterials();
  const original = materials.original;
  const templates = [original.templates.deepCalibration, original.templates.analysis, original.templates.analysis.conditionalStatsAppend,
    original.templates.soulEssence, original.templates.soulEssence.sourceBlockTemplates.withContext, original.templates.soulEssence.sourceBlockTemplates.withoutContext];
  const archived = await readFile(new URL('../../analysis-pilot/original-website-source.html', import.meta.url), 'utf8');
  assert.equal(sha256(archived), original.source.sha256);
  assert.equal(verifyOriginalTemplateLiterals(archived, templates), true);
  assert.equal(templates.length, 6);
  assert.throws(() => verifyOriginalTemplateLiterals(archived.replace(original.templates.analysis.conditionalStatsAppend.rawTemplateLiteral, '`changed stats appendix`'), templates), e => e.code === 'original_template_source_mismatch');
});
