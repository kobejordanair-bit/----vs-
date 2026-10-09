import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { STATS_DIMENSIONS } from '../cloudflare/scripts/analysis-pilot-stats-import.mjs';
import { STATS_TARGETS, statsContextPaths, validateStatsRequest, parseStatsManuscript, assembleStatsResults, normalizeStatsExport } from './assemble-stats-results.mjs';
import { captureStatsExport } from './capture-stats-export.mjs';

// Entirely synthetic test content; these numbers are never historical scores.
function fixture() {
  const source = [111, 222, 333].map(value => `https://zh.wikisource.org/w/index.php?oldid=${value}`).join('\n');
  const request = { format: 'dynasty-stats-completion-request', schemaVersion: 1, baselineRevision: 3,
    statsOrder: [...STATS_DIMENSIONS], allowedIds: STATS_TARGETS.map(value => value.id),
    policy: { preserveAllExistingArticles: true, preserveWangJianStats: true, actualChatGPTWebAndWebSearchRequired: true, privateStateExcluded: true }, records: [] };
  const referenceText = 'Synthetic public reference fixture, never production calibration data.';
  const bindings = { format: 'dynasty-stats-input-bindings', schemaVersion: 1, baselineRevision: 3, referencePath: 'analysis-pilot/stats-reference.v1.json', referenceSha256: sha256(referenceText), records: [] };
  const inputs = { request, bindings, referenceText, prompts: {}, sourcePackages: {}, contextFiles: {}, drafts: {}, captures: {}, reviews: {}, rawExports: {}, searchEvidenceFiles: {} };
  for (const target of STATS_TARGETS) {
    const item = { id: target.id, slug: target.slug, context: { id: target.id }, promptPath: `analysis-pilot/prompts/${target.slug}.stats.prompt.md`, sourcePath: `analysis-pilot/sources/${target.slug}.md`, outputPath: `analysis-pilot/drafts/${target.slug}.stats.md`, marker: `<!-- STATS_COMPLETE ${target.id} -->` };
    const prompt = `完全合成測試prompt ${item.id}`, stats = [10, 20, 30, 40, 50];
    Object.assign(item.context, Object.fromEntries(['name', 'type', 'dynasty', 'rank', 'title', 'tag', 'desc', 'poem'].map(key => [key, '合成測試公開欄位'])));
    item.promptSha256 = sha256(prompt);
    for (const context of statsContextPaths(target.slug)) {
      const body = `完全合成${context.field}文章，沒有私人資料或人物史實。`;
      item[`${context.field}Sha256`] = sha256(body);
      const marker = context.field === 'deepAnalysis' ? `<!-- PILOT_COMPLETE ${target.id} -->` : `<!-- LAYER_COMPLETE ${target.id} ${context.field} -->`;
      inputs.contextFiles[context.path] = `${body}\n\n${marker}\n`;
    }
    request.records.push(item);
    bindings.records.push({ id: item.id, slug: target.slug, inputSha256: sha256(`synthetic-input:${item.id}`), sourcePackageSha256: sha256(source) });
    const prose = STATS_DIMENSIONS.map((label, index) => `### ${index + 1}. ${label}：${stats[index]}\n\n${'純合成理由、加分與限制，沒有真實評分。'.repeat(4)}`).join('\n\n') + '\n\n[合成測試引用](https://zh.wikisource.org/w/index.php?oldid=111)';
    inputs.prompts[target.slug] = prompt; inputs.sourcePackages[target.slug] = source;
    inputs.rawExports[target.slug] = `${JSON.stringify({ stats })}\n\n${prose}\n\n\`${item.marker}\`\n`;
    inputs.searchEvidenceFiles[target.slug] = '合成UI測試證據：已搜尋 3 個網站\n';
  }
  for (const target of STATS_TARGETS) {
    const result = captureStatsExport({ slug: target.slug, request, bindings, referenceText, prompt: inputs.prompts[target.slug], sourcePackage: source, contextFiles: inputs.contextFiles,
      raw: inputs.rawExports[target.slug], evidenceText: inputs.searchEvidenceFiles[target.slug], conversationUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', generatedAt: '2026-10-09T00:00:00.000Z' });
    inputs.drafts[target.slug] = result.text; inputs.captures[target.slug] = result.capture;
    inputs.reviews[target.slug] = { passed: true, recordId: target.id, field: 'stats', manuscriptSha256: sha256(result.text), sourcePackageSha256: sha256(source), materialIssues: [], checkedExternalSources: [], stats: result.fields.stats };
  }
  return inputs;
}
const rejected = (run, code) => assert.throws(run, error => code ? error.code === code : error instanceof Error);

test('actual-export packaging copies exactly two arrays and reasons without changing prose', () => {
  const input = fixture(), batch = assembleStatsResults(input);
  assert.equal(batch.records.length, 2);
  for (const record of batch.records) {
    assert.deepEqual(Object.keys(record.fields), ['stats', 'statsAnalysis']);
    assert.deepEqual(record.fields.stats, [10, 20, 30, 40, 50]);
    assert.ok(!record.fields.statsAnalysis.includes('STATS_COMPLETE'));
    assert.ok(!record.fields.statsAnalysis.includes('"stats"'));
    assert.equal(record.provenance.contextFiles.length, 3);
    assert.equal(record.provenance.webSearchEvidence.visibleSearchCount, 3);
    assert.equal(record.provenance.referenceSha256, input.bindings.referenceSha256);
    assert.match(record.provenance.captureSha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(assembleStatsResults(input), batch);
});

test('first line must have the sole stats key and exactly five integer values in range', () => {
  const input = fixture(), id = STATS_TARGETS[0].id, text = input.drafts.xiaowendi;
  for (const first of ['前言', '```json', '{"stats":[10,20,30,40]}', '{"stats":[10,20,30,40,50,60]}', '{"stats":[10,20,30,40,1.5]}', '{"stats":[10,20,30,40,101]}', '{"stats":[10,20,30,40,"50"]}', '{"stats":[10,20,30,40,50],"rank":"S"}', '{"stats":[10,20,30,40,50],"stats":[1,2,3,4,5]}']) {
    rejected(() => parseStatsManuscript(first + text.slice(text.indexOf('\n')), id));
  }
});

test('headings must match five scores and order, with no missing or duplicate dimension', () => {
  const input = fixture(), id = STATS_TARGETS[0].id, text = input.drafts.xiaowendi;
  for (const broken of [text.replace('統率：10', '統率：11'), text.replace('2. 武力：20', '2. 政治：20'), text.replace('3. 智謀：30', '3. 武力：30'), text.replace('5. 魅力：50', '5. 其他：50'), text.replace('### 2. 武力：20', '### 2. 武力：20\n\n### 武力：20')]) rejected(() => parseStatsManuscript(broken, id));
  const withoutNumbers = text.replace(/### [1-5]\. /g, '### ');
  assert.deepEqual(parseStatsManuscript(withoutNumbers, id).stats, [10, 20, 30, 40, 50]);
  const bold = withoutNumbers.replace(/### ([^\n]+)/g, '### **$1**');
  assert.deepEqual(parseStatsManuscript(bold, id).stats, [10, 20, 30, 40, 50]);
});

test('completion must be unique, last, and bound to the exact person', () => {
  const input = fixture(), id = STATS_TARGETS[0].id, text = input.drafts.xiaowendi;
  for (const broken of [text.replace('STATS_COMPLETE', 'LAYER_COMPLETE'), text + '續寫', text + `\n<!-- STATS_COMPLETE ${id} -->`, text.replace(id, STATS_TARGETS[1].id)]) rejected(() => parseStatsManuscript(broken, id));
  rejected(() => parseStatsManuscript(text, 'general_王翦_306401394'));
});

test('scope and published input bindings reject unrelated or duplicate figures', () => {
  for (const mutate of [input => input.request.records.pop(), input => input.request.records[0].id = input.request.records[1].id, input => input.bindings.records[0].id = 'general_王翦_306401394', input => input.bindings.baselineRevision++, input => input.request.statsOrder.reverse(), input => input.request.records[0].outputPath = 'cloudflare/private/leak.json', input => input.request.policy.actualChatGPTWebAndWebSearchRequired = false]) {
    const input = fixture(); mutate(input); rejected(() => validateStatsRequest(input.request, input.bindings));
  }
});

test('each original article, source package, prompt and input binding must match capture', () => {
  for (const mutate of [input => input.prompts.xiaowendi += '改動', input => input.sourcePackages.xiaowendi += '改動', input => input.contextFiles['analysis-pilot/drafts/xiaowendi.analysis.md'] += '改動', input => input.captures.xiaowendi.contextFiles.pop(), input => input.captures.xiaowendi.inputSha256 = '0'.repeat(64)]) {
    const input = fixture(); mutate(input); rejected(() => assembleStatsResults(input));
  }
});

test('passed and current factual QA is required, including no outstanding material issues', () => {
  for (const mutate of [input => input.reviews.xiaowendi.passed = false, input => input.reviews.xiaowendi.materialIssues.push('待修'), input => input.reviews.xiaowendi.manuscriptSha256 = '0'.repeat(64), input => input.reviews.xiaowendi.sourcePackageSha256 = '0'.repeat(64), input => input.reviews.xiaowendi.stats[0]++, input => input.reviews.xiaowendi.recordId = STATS_TARGETS[1].id, input => delete input.reviews.xiaowendi.checkedExternalSources]) {
    const input = fixture(); mutate(input); rejected(() => assembleStatsResults(input));
  }
});

test('reference version and public context metadata are bound without accepting private keys', () => {
  for (const mutate of [input => input.referenceText += 'changed', input => input.captures.xiaowendi.referenceSha256 = '0'.repeat(64),
    input => input.request.records[0].context.chatHistory = 'private', input => input.captures.xiaowendi.contextFiles[0].field = 'deepAnalysis',
    input => input.captures.xiaowendi.contextFiles[0].articleSha256 = '0'.repeat(64)]) {
    const input = fixture(); mutate(input); rejected(() => assembleStatsResults(input));
  }
});

test('actual browser search evidence and raw export hashes cannot be fabricated from flags alone', () => {
  for (const mutate of [input => input.searchEvidenceFiles.xiaowendi = '沒有搜尋', input => input.searchEvidenceFiles.xiaowendi += '已搜尋 5 個網站', input => input.captures.xiaowendi.webSearchVerified = false, input => input.captures.xiaowendi.webSearchEvidence.visibleSearchCount++, input => input.rawExports.xiaowendi += '改動', input => input.captures.xiaowendi.fragments = []]) {
    const input = fixture(); mutate(input); rejected(() => assembleStatsResults(input));
  }
  const input = fixture(); input.drafts.xiaowendi = input.drafts.xiaowendi.replace('純合成理由', '伪造的新文');
  input.captures.xiaowendi.responseSha256 = sha256(input.drafts.xiaowendi); input.reviews.xiaowendi.manuscriptSha256 = sha256(input.drafts.xiaowendi);
  rejected(() => assembleStatsResults(input), 'response_differs_from_actual_export');
});

test('all manuscript links must be checked, and external-source receipts need HTTPS title and locator', () => {
  const input = fixture(); input.rawExports.xiaowendi = input.rawExports.xiaowendi.replace('oldid=111)', 'oldid=444)');
  input.drafts.xiaowendi = normalizeStatsExport(input.rawExports.xiaowendi).text;
  input.captures.xiaowendi.responseSha256 = sha256(input.drafts.xiaowendi); input.captures.xiaowendi.fragments[0].sha256 = sha256(input.rawExports.xiaowendi); input.reviews.xiaowendi.manuscriptSha256 = sha256(input.drafts.xiaowendi);
  rejected(() => assembleStatsResults(input), 'unreviewed_manuscript_source');
  input.reviews.xiaowendi.checkedExternalSources.push({ title: '合成外部來源', url: 'https://zh.wikisource.org/w/index.php?oldid=444', locator: '合成定位' });
  assert.equal(assembleStatsResults(input).records.length, 2);
  for (const source of [{ title: '來源', url: 'http://example.org', locator: '段' }, { title: '', url: 'https://example.org', locator: '段' }, { title: '來源', url: 'https://example.org', locator: '' }]) {
    const input = fixture(); input.reviews.xiaowendi.checkedExternalSources.push(source); rejected(() => assembleStatsResults(input));
  }
});

test('invalid ChatGPT conversation metadata and fabricated search UI are rejected at capture', () => {
  const input = fixture(); const fields = { slug: 'xiaowendi', request: input.request, bindings: input.bindings, referenceText: input.referenceText, prompt: input.prompts.xiaowendi, sourcePackage: input.sourcePackages.xiaowendi, contextFiles: input.contextFiles, raw: input.rawExports.xiaowendi, evidenceText: input.searchEvidenceFiles.xiaowendi };
  for (const conversationUrl of ['https://example.org/c/test', 'https://chatgpt.com/c/test?x=1', 'http://chatgpt.com/c/test', 'https://chatgpt.com/']) rejected(() => captureStatsExport({ ...fields, conversationUrl }));
  rejected(() => captureStatsExport({ ...fields, conversationUrl: 'https://chatgpt.com/c/test', evidenceText: '已搜尋 0 個網站' }));
});
