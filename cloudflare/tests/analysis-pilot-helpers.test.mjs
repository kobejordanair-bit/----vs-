import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_DEFAULTS } from '../src/contracts.mjs';
import { sha256, contentHash } from '../scripts/analysis-pilot-import.mjs';
import { AUTHORIZED_LAYERS } from '../scripts/analysis-pilot-layers-import.mjs';
import { prepareLayerRequest, FIGURE_PACKAGES } from '../../analysis-pilot/prepare-layer-request.mjs';
import { renderOriginalTemplate, verifyWebsiteSourceBinding } from '../../analysis-pilot/original-prompt-renderer.mjs';
import { prepareDeepStyleRequest } from '../../analysis-pilot/prepare-deep-style-request.mjs';
import { assembleLayerResults } from '../../analysis-pilot/assemble-layer-results.mjs';

const template = rawTemplateLiteral => ({ rawTemplateLiteral, templateSha256: sha256(rawTemplateLiteral) });
function websiteBindingFixture() {
  const raw = 'first\r\nconst prompt = `alpha\r\nbeta`;\nlast\r\n', normalized = raw.replace(/\r\n/g, '\n');
  const source = { path: 'backend/index.html', sha256: sha256(raw) };
  const binding = { format: 'dynasty-website-source-binding', schemaVersion: 1, normalization: 'CRLF-to-LF',
    source: { path: source.path, rawSha256: source.sha256, lfNormalizedSha256: sha256(normalized) },
    provenance: { originalPromptPackage: 'analysis-pilot/original-prompts.v1.json', originalSourceSha256: source.sha256 } };
  return { raw, normalized, source, binding };
}

test('original website source accepts LF and CRLF checkouts without changing rendered literal bytes', () => {
  const f = websiteBindingFixture();
  for (const source of [f.raw, f.normalized, f.normalized.replace(/\n/g, '\r\n')]) assert.equal(verifyWebsiteSourceBinding(source, f.source, f.binding), f.normalized);
  assert.equal(renderOriginalTemplate(template('`alpha\r\nbeta`'), { legend: {} }), 'alpha\r\nbeta');
});

test('website binding rejects source content changes and transformations beyond CRLF to LF', () => {
  const f = websiteBindingFixture();
  for (const source of [f.raw.replace('alpha', 'changed'), f.normalized + ' ', f.raw.replace(/\r\n/g, '\r')]) {
    assert.throws(() => verifyWebsiteSourceBinding(source, f.source, f.binding), error => error.code === 'website_prompt_source_changed');
  }
});

test('website binding must exist and remain bound to the original raw source package', () => {
  const f = websiteBindingFixture();
  assert.throws(() => verifyWebsiteSourceBinding(f.raw, f.source), error => error.code === 'invalid_website_source_binding');
  for (const change of [
    binding => { binding.source.rawSha256 = 'a'.repeat(64); },
    binding => { binding.source.lfNormalizedSha256 = 'b'.repeat(64); },
    binding => { binding.source.path = 'other/source.html'; },
    binding => { binding.provenance.originalSourceSha256 = 'a'.repeat(64); },
    binding => { binding.normalization = 'trim-and-reformat'; },
  ]) {
    const binding = structuredClone(f.binding); change(binding);
    assert.throws(() => verifyWebsiteSourceBinding(f.raw, f.source, binding), error => error.code === 'invalid_website_source_binding');
  }
});

function fixture() {
  const base = FIGURE_PACKAGES.map((meta, index) => ({ id: meta.id, name: `測試人物${index}`, type: ['emperor', 'general', 'minister'][index], dynasty: '測試時代', rank: 'A', title: '測試稱號', tag: '測試標籤', desc: '測試簡評', poem: '測試判詞' }));
  const source = { ...structuredClone(USER_DEFAULTS), revision: 2, chatHistories: { private: { text: 'NOT_STAGE_PRIVATE_CHAT' } }, simulationHistory: [{ text: 'NOT_STAGE_PRIVATE_SIMULATION' }] };
  for (const figure of base) source.modifiedLegends[figure.id] = { deepAnalysis: '已完成深度評鑑，僅作離線測試。'.repeat(35), privateNotes: 'NOT_STAGE_PERSON_NOTES' };
  source.modifiedLegends[base[1].id].analysis = '王翦既有賞析測試內容';
  const sourcePackages = Object.fromEntries(FIGURE_PACKAGES.map((meta, index) => [meta.slug, meta.titles.map((_, at) => `https://zh.wikisource.org/w/index.php?oldid=${index * 10 + at + 1}`).join('\n')]));
  const original = { templates: {
    deepCalibration: template('`原深度PROMPT ${rankingRef} ${legend.name} ${typeLabel} ${legend.rank}`'),
    analysis: template('`原賞析PROMPT ${legend.name}（${legend.title}）`'),
    soulEssence: { ...template('`${sourceBlock} 原七欄PROMPT`'), sourceBlockTemplates: { withContext: template("`以下是關於${legend.name}（${legend.title||''}，${legend.dynasty||''}）的評鑑資料：\\n\\n${sourceCtx}`") } },
  } };
  const styles = {};
  for (const type of ['emperor', 'general', 'minister']) for (const field of ['analysis', 'deepAnalysis', 'soulEssence']) {
    const text = '現有文章的合成測試範例'; styles[`${type}.${field}`] = { text, sha256: sha256(text), path: `analysis-pilot/style-samples/${type}.${field}.md` };
  }
  const materials = { original, styles, ranking: { total: 962 }, rankingRef: '全962位的合成測試榜單' };
  const request = prepareLayerRequest({ source, base, sourcePackages, materials, preparedAt: '2026-10-09T00:00:00.000Z' });
  return { source, base, sourcePackages, materials, request };
}
function assembledFixture() {
  const f = fixture(), drafts = {}, captures = {}, reviews = {}, backgroundFiles = {};
  for (const item of f.request.records) for (const [field, task] of Object.entries(item.layers)) {
    const key = `${item.slug}.${field}`, raw = `${'完全合成的離線測試文章，不是歷史分析。'.repeat(40)}\n${task.marker}\n`;
    drafts[key] = raw;
    captures[key] = { promptSha256: task.promptSha256, responseSha256: sha256(raw), recordId: item.id, field, conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', generatedAt: '2026-10-09T01:00:00.000Z', webSearchPerformed: true, webSearchEvidence: '已搜尋3個網站（合成測試標籤）' };
    reviews[key] = { passed: true, manuscriptSha256: sha256(raw), sourcePackageSha256: item.sourcePackage.sha256 };
  }
  for (const item of f.request.records) {
    const context = item.layers.soulEssence.contextPaths[0];
    const raw = item.slug === 'wangjian' ? f.source.modifiedLegends[item.id].analysis : drafts[`${item.slug}.analysis`];
    backgroundFiles[context.path] = raw;
    captures[`${item.slug}.soulEssence`].contextFiles = [{ path: context.path, sha256: sha256(raw) }];
  }
  return { request: f.request, sourcePackages: f.sourcePackages, drafts, captures, reviews, backgroundFiles };
}

test('original template rendering preserves literal text and safely handles the original role conditional', () => {
  const raw = "`開頭\\n${legend.name}：${legend.type === 'emperor' ? '帝王本位' : legend.type === 'general' ? '將領本位' : '名臣本位'}；${legend.title||''}結尾`";
  assert.equal(renderOriginalTemplate(template(raw), { legend: { name: '${must-not-execute}', type: 'general', title: '' } }), '開頭\n${must-not-execute}：將領本位；結尾');
  assert.throws(() => renderOriginalTemplate(template('`${process.env.SECRET}`'), { legend: {} }), error => error.code === 'unsupported_original_interpolation');
  assert.throws(() => renderOriginalTemplate({ ...template(raw), templateSha256: 'a'.repeat(64) }, { legend: {} }), error => error.code === 'original_template_hash_mismatch');
});

test('phase2 staging includes only selected figure/deep/source material and exact five missing layers', () => {
  const f = fixture(), text = JSON.stringify(f.request);
  assert.equal(f.request.status, 'ready'); assert.equal(f.request.missingFields, 5);
  for (const forbidden of ['NOT_STAGE_PRIVATE_CHAT', 'NOT_STAGE_PRIVATE_SIMULATION', 'NOT_STAGE_PERSON_NOTES', '王翦既有賞析測試內容']) assert.ok(!text.includes(forbidden));
  assert.equal(Object.keys(f.request.records[1].layers).join(','), 'soulEssence');
  for (const item of f.request.records) {
    assert.equal(item.promptSha256, contentHash(Object.fromEntries(Object.entries(item.layers).map(([field, task]) => [field, task.promptSha256]))));
    for (const task of Object.values(item.layers)) assert.equal(sha256(task.prompt), task.promptSha256);
  }
});

test('default layer prompts faithfully start with original templates, include style and actual web-search requests', () => {
  const f = fixture(), emperor = f.request.records[0], wang = f.request.records[1];
  assert.ok(emperor.layers.analysis.prompt.startsWith('原賞析PROMPT 測試人物0（測試稱號）'));
  assert.ok(wang.layers.soulEssence.prompt.startsWith('以下是關於測試人物1'));
  assert.ok(wang.layers.soulEssence.prompt.includes('wangjian.existing.analysis.md'));
  assert.ok(emperor.layers.soulEssence.prompt.includes('xiaowendi.analysis.md'));
  assert.ok(emperor.layers.analysis.prompt.includes('2600–3600')); assert.ok(emperor.layers.soulEssence.prompt.includes('1800–2400'));
  assert.ok(emperor.layers.analysis.prompt.includes('實際上網搜尋'));
  assert.ok(emperor.layers.soulEssence.prompt.includes('[史載]/[推斷]/[詮釋]'));
});

test('deep style request keeps safe input bindings and renders original prompt with the full ranking reference', () => {
  const f = fixture(), oldRequest = { format: 'dynasty-analysis-pilot-request', schemaVersion: 1, onlyFill: 'deepAnalysis', targetCount: 3, baselineRevision: 1,
    records: f.base.map((figure, index) => ({ id: figure.id, order: index + 1, inputSha256: 'b'.repeat(64), context: { ...figure, privateNotes: 'NOT_STAGE_CONTEXT_NOTE' }, anchors: [{ id: 'safe-anchor', name: '參考人物', type: figure.type, rank: 'A', privateText: 'NOT_STAGE_ANCHOR_NOTE' }] })) };
  const output = prepareDeepStyleRequest({ request: oldRequest, materials: f.materials, sourcePackages: f.sourcePackages });
  assert.equal(output.libraryCount, 962); assert.ok(!JSON.stringify(output).includes('NOT_STAGE_'));
  for (const item of output.records) {
    assert.equal(item.inputSha256, 'b'.repeat(64)); assert.ok(item.prompt.startsWith('原深度PROMPT 全962位'));
    assert.ok(item.promptPath.endsWith('.deepAnalysis.style.v2.md')); assert.ok(item.draftPath.endsWith('.style.v2.md'));
  }
});

test('unsealed prompts, absent deep analysis or a changed missing-field set cannot produce a ready request', () => {
  const f = fixture(); const waiting = prepareLayerRequest({ source: f.source, base: f.base, sourcePackages: f.sourcePackages });
  assert.equal(waiting.status, 'staged_waiting_prompts'); assert.equal(waiting.records[0].promptSha256, null);
  f.source.modifiedLegends[f.base[0].id].analysis = 'already exists';
  assert.throws(() => prepareLayerRequest({ source: f.source, base: f.base, sourcePackages: f.sourcePackages, materials: f.materials }), error => error.code === 'unexpected_missing_field_set');
});

test('assembly gates all five field captures and QA hashes, strips only completion markers and retains per-field provenance', () => {
  const f = assembledFixture(), batch = assembleLayerResults(f);
  assert.equal(batch.records.length, 3); assert.equal(batch.records.reduce((sum, record) => sum + Object.keys(record.fields).length, 0), 5);
  for (const item of batch.records) {
    assert.equal(item.provenance.perField.length, AUTHORIZED_LAYERS[item.id].length);
    for (const prose of Object.values(item.fields)) { assert.ok(prose.startsWith('完全合成')); assert.ok(!prose.includes('LAYER_COMPLETE')); }
  }
  assert.equal(Object.hasOwn(batch.records[1].fields, 'analysis'), false);
});

test('any changed capture, prompt, manuscript review, source package, marker or background draft stops assembly', () => {
  for (const mutate of [
    f => { f.captures['xiaowendi.analysis'].responseSha256 = 'a'.repeat(64); },
    f => { f.captures['xiaowendi.analysis'].promptSha256 = 'a'.repeat(64); },
    f => { f.reviews['xiaowendi.analysis'].passed = false; },
    f => { f.reviews['xiaowendi.analysis'].manuscriptSha256 = 'a'.repeat(64); },
    f => { f.sourcePackages.xiaowendi += 'changed'; },
    f => { f.drafts['xiaowendi.analysis'] += 'extra after marker'; f.captures['xiaowendi.analysis'].responseSha256 = sha256(f.drafts['xiaowendi.analysis']); },
    f => { const path = f.request.records[0].layers.soulEssence.contextPaths[0].path; f.backgroundFiles[path] += 'changed'; },
  ]) { const f = assembledFixture(); mutate(f); assert.throws(() => assembleLayerResults(f)); }
});

test('assembly rejects unsigned stage requests and unsafe paths before reading files', () => {
  const f = assembledFixture(); f.request.status = 'staged_waiting_prompts'; assert.throws(() => assembleLayerResults(f), error => error.code === 'layer_request_not_ready');
  const second = assembledFixture(); second.request.records[0].layers.analysis.draftPath = '../private/credentials.json';
  assert.throws(() => assembleLayerResults(second), error => error.code === 'invalid_layer_task_binding');
});

test('every field requires a literal true web-search verification flag and keeps bounded local evidence', () => {
  for (const value of [undefined, false, 'true', 1]) {
    const f = assembledFixture(); f.captures['xiaowendi.analysis'].webSearchPerformed = value;
    assert.throws(() => assembleLayerResults(f), error => error.code === 'web_search_not_verified');
  }
  const verified = assembledFixture(); delete verified.captures['xiaowendi.analysis'].webSearchPerformed; verified.captures['xiaowendi.analysis'].webSearchVerified = true;
  const batch = assembleLayerResults(verified), evidence = batch.records[0].provenance.perField.find(field => field.field === 'analysis');
  assert.equal(evidence.webSearchPerformed, true); assert.equal(evidence.webSearchEvidence.verifiedFlag, 'webSearchVerified');
  assert.equal(evidence.webSearchEvidence.label, '已搜尋3個網站（合成測試標籤）');
});

test('QA external sources are deduplicated by URL across layers and original source references', () => {
  const f = assembledFixture(), original = f.sourcePackages.xiaowendi.split('\n')[0];
  f.reviews['xiaowendi.analysis'].checkedExternalSources = [{ title: '原典重複', url: original, locator: '測試位置' }, { title: '外部學術來源甲', url: 'https://example.org/paper', locator: '摘要' }];
  f.reviews['xiaowendi.soulEssence'].checkedExternalSources = [{ title: '來源甲重複', url: 'https://example.org/paper', locator: '相同摘要' }, { title: '外部學術來源乙', url: 'https://example.org/second', locator: '第二節' }];
  const checked = assembleLayerResults(f).records[0].provenance.checkedSources;
  assert.equal(checked.length, FIGURE_PACKAGES[0].titles.length + 2);
  assert.equal(checked.filter(source => source.url === 'https://example.org/paper').length, 1);
  assert.equal(checked.find(source => source.url === 'https://example.org/paper').locator, '摘要');
  for (const source of [{ title: '不安全', url: 'http://example.org/paper', locator: '摘要' }, { title: '無定位', url: 'https://example.org/paper' }, { title: '憑證網址', url: 'https://secret@example.org/paper', locator: '摘要' }]) {
    const invalid = assembledFixture(); invalid.reviews['xiaowendi.analysis'].checkedExternalSources = [source]; assert.throws(() => assembleLayerResults(invalid), error => error.code === 'invalid_external_source');
  }
});
