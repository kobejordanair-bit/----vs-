import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, contentHash } from '../cloudflare/scripts/analysis-pilot-import.mjs';
import { USER_DEFAULTS } from '../cloudflare/src/contracts.mjs';
import { loadFixedManifest, planBatch50Import, runBatch50Import } from './import.mjs';
import { TASKS, ANALYSIS_LABELS, SOUL_LABELS, captureExport, parseManuscript, normalizeBatchExport, batchSearchEvidence } from './capture.mjs';
import { searchEvidence as legacySearchEvidence } from '../analysis-pilot/assemble-stats-results.mjs';
import { assembleResults, assembleAnalysisResults } from './assemble.mjs';
import { verifyOriginalPromptBinding } from './prompt-bindings.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const manifest = await loadFixedManifest(), target = manifest.records[0];
const sourcePackage = await readFile(resolve(repo, target.sourcesPath), 'utf8');
const deepAnalysis = await readFile(resolve(repo, target.preserved.deepAnalysis.path), 'utf8');
const statsReference = await readFile(resolve(here, 'stats-reference.v1.json'), 'utf8');
const requestSeed = JSON.parse(await readFile(resolve(here, 'tasks', `${target.slug}.json`), 'utf8'));
const promptSeeds = Object.fromEntries(await Promise.all(TASKS.map(async task => [task, await readFile(resolve(repo, requestSeed.tasks[task].promptFile), 'utf8')])));
const sourceUrl = 'https://example.org/synthetic-primary-text';
const repeated = '完全合成測試內容，不是真實人物分析，也不是歷史評分。';
const sections = (labels, count, annotation = '') => labels.map(label => `## 【${label}】\n\n${annotation}${repeated.repeat(count)}`).join('\n\n');
const analysis = sections(ANALYSIS_LABELS, 10) + `\n\n[合成來源](${sourceUrl})`;
const soul = sections(SOUL_LABELS, 8, '[詮釋] ') + `\n\n[合成來源](${sourceUrl})`;
const stats = [10, 20, 30, 40, 50];
const statsAnalysis = '## 【五維能力數值】\n\n' + ['統率', '武力', '智謀', '政治', '魅力'].map((label, index) => `### ${label}：${stats[index]}\n\n${repeated.repeat(3)}`).join('\n\n');
const generatedAt = '2026-10-10T00:00:00.000Z', conversationUrl = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const rejected = (run, code) => assert.throws(run, error => code ? error.code === code : error instanceof Error);

function fixture(currentManifest = manifest) {
  const manifest = currentManifest;
  // Prose, UI evidence and scores are synthetic unit fixtures. The sealed
  // public prompt, person identity, source package and deep-article are real.
  const prompts = { ...promptSeeds }, request = structuredClone(requestSeed);
  request.manifestSha256 = contentHash(manifest);
  const raws = {
    analysisStats: `${JSON.stringify({ stats })}\n\n${analysis}\n\n${request.tasks.analysisStats.reasonMarker}\n\n${statsAnalysis}\n\n${request.tasks.analysisStats.marker}\n`,
    soulEssence: `${soul}\n\n${request.tasks.soulEssence.marker}\n`,
  };
  const tasks = {};
  for (const task of TASKS) {
    const inputs = { manifest, request, task, prompt: prompts[task], sourcePackage, deepAnalysis, statsReference,
      analysisContext: task === 'soulEssence' ? analysis + '\n' : null, raw: raws[task], evidenceText: 'Synthetic UI fixture: 已搜尋 3 個網站\n', conversationUrl, generatedAt };
    const output = captureExport(inputs);
    const fieldsFiles = Object.fromEntries(Object.entries(output.fields).map(([field, value]) => [field, field === 'stats' ? JSON.stringify(value) + '\n' : value + '\n']));
    const review = { format: 'dynasty-batch50-source-review', schemaVersion: 1, recordId: target.id, task, passed: true,
      manuscriptSha256: output.capture.responseSha256, rawResponseSha256: output.capture.rawResponseSha256, sourcePackageSha256: output.capture.sourcePackageSha256,
      materialIssues: [], checkedSources: [{ title: 'Synthetic checked primary text', url: sourceUrl, locator: 'Synthetic paragraph 1', type: 'primary_text', checked: true }] };
    if (task === 'analysisStats') review.stats = [...stats];
    tasks[task] = { ...inputs, response: output.text, capture: output.capture, fieldsFiles, review };
  }
  return { manifest, people: [{ request, tasks }] };
}

test('mechanical split retains the exact four-chapter prose, scores, reasons and seven soul sections', () => {
  const input = fixture(), batch = assembleResults(input), item = batch.records[0];
  assert.deepEqual(item.fields, { analysis, soulEssence: soul, stats, statsAnalysis });
  assert.deepEqual(Object.keys(item.fields), ['analysis', 'soulEssence', 'stats', 'statsAnalysis']);
  assert.deepEqual(Object.keys(item.provenance.perTask), TASKS);
  for (const task of TASKS) {
    assert.equal(item.provenance.perTask[task].webSearchEvidence.visibleSearchCount, 3);
    assert.equal(item.provenance.perTask[task].captureSha256, contentHash(input.people[0].tasks[task].capture));
  }
  assert.equal(item.provenance.perTask.soulEssence.analysisContextSha256, sha256(analysis + '\n'));
});

test('first-line JSON rejects extras, duplicate aliases, fractions, strings and out-of-range values', () => {
  const text = fixture().people[0].tasks.analysisStats.response, suffix = text.slice(text.indexOf('\n'));
  for (const line of ['前言', '```json', '{"stats":[10,20,30,40]}', '{"stats":[10,20,30,40,50,60]}', '{"stats":[10,20,30,40,1.5]}', '{"stats":[10,20,30,40,"50"]}', '{"stats":[10,20,30,40,101]}', '{"stats":[10,20,30,40,-1]}', '{"stats":[10,20,30,40,50],"rank":"S"}', '{"stats":[10,20,30,40,50],"stats":[1,2,3,4,5]}', '{"stats":[10,20,30,40,50],"st\\u0061ts":[1,2,3,4,5]}']) {
    rejected(() => parseManuscript(line + suffix, target.id, 'analysisStats'));
  }
});

test('completion and reason separators must be unique, standalone, last and bound to the correct ID', () => {
  const input = fixture().people[0], text = input.tasks.analysisStats.response, item = input.request.tasks.analysisStats;
  for (const broken of [text.replace(item.marker, ''), text + '續寫', text + item.marker, text.replace(item.marker, '<!-- BATCH50_COMPLETE wrong analysisStats -->'), text.replace(item.reasonMarker, ''), text.replace(item.reasonMarker, '<!-- STATS_REASONS_BEGIN wrong -->'), text.replace(item.reasonMarker, item.reasonMarker + '\n' + item.reasonMarker), text.replace(item.marker, '正文 ' + item.marker)]) rejected(() => parseManuscript(broken, target.id, 'analysisStats'));
});

test('missing article sections, score discrepancies and unlabeled soul interpretations are rejected', () => {
  const input = fixture().people[0], text = input.tasks.analysisStats.response, soulText = input.tasks.soulEssence.response;
  for (const broken of [text.replace('【歷史局勢與定位】', '【其他】'), text.replace('【深度功過剖析】', '【人性與性格側寫】'), text.replace('統率：10', '統率：11'), text.replace('武力：20', '魅力：20'), text.replace('【五維能力數值】', '【其他】')]) rejected(() => parseManuscript(broken, target.id, 'analysisStats'));
  rejected(() => parseManuscript(soulText.replaceAll('[詮釋] ', ''), target.id, 'soulEssence'), 'soul_annotations_missing');
  rejected(() => parseManuscript(soulText.replace('【內在裂縫】', '【其他】'), target.id, 'soulEssence'));
});

test('capture binds public prompt, source, preserved deep analysis, reference and allowed file paths', () => {
  for (const mutate of [value => value.prompt += ' changed', value => value.sourcePackage += ' changed', value => value.deepAnalysis += ' changed', value => value.statsReference += ' changed', value => value.request.tasks.analysisStats.promptFile = 'cloudflare/private/data.json', value => value.request.tasks.analysisStats.referenceSha256 = '0'.repeat(64), value => value.request.inputSha256 = '0'.repeat(64)]) {
    const value = fixture().people[0].tasks.analysisStats; mutate(value); rejected(() => captureExport(value));
  }
});

test('actual search UI count is necessary and invalid conversation URLs are rejected', () => {
  for (const evidenceText of ['沒有搜尋', '已搜尋 0 個網站', '已搜尋 9 個網站\n已搜尋 0 個網站', '9\n12']) rejected(() => captureExport({ ...fixture().people[0].tasks.analysisStats, evidenceText }), 'actual_search_evidence_required');
  for (const url of ['http://chatgpt.com/c/test', 'https://example.org/c/test', 'https://chatgpt.com/', 'https://chatgpt.com/c/test?x=1']) rejected(() => captureExport({ ...fixture().people[0].tasks.analysisStats, conversationUrl: url }), 'invalid_capture_conversation');
});

test('single search groups and repeated identical counts keep legacy capture evidence byte for byte', () => {
  for (const evidenceText of ['已搜尋3個網站', '已搜尋 3 個網站\n已搜尋 3 個網站', 'Searched 3 websites\n已搜尋3個網站']) {
    const legacy = legacySearchEvidence(evidenceText), actual = batchSearchEvidence(evidenceText);
    assert.equal(JSON.stringify(actual), JSON.stringify(legacy));
    const value = fixture().people[0].tasks.analysisStats, capture = captureExport({ ...value, evidenceText }).capture;
    assert.equal(JSON.stringify(capture.webSearchEvidence), JSON.stringify({ file: 'analysis-batch-50/drafts/01.analysisStats.search-evidence.txt',
      sha256: legacy.sha256, visibleSearchCount: legacy.count, uiLabel: legacy.label }));
  }
});

test('different actual search groups retain all observed counts and use the last segment without claiming a unique total', () => {
  const input = fixture(), value = input.people[0].tasks.analysisStats;
  value.evidenceText = '實際活動段落一：已搜尋9個網站\n實際活動段落二：Searched 12 sites\n';
  const output = captureExport(value); value.capture = output.capture;
  const evidence = output.capture.webSearchEvidence;
  assert.deepEqual(evidence.visibleSearchCounts, [9, 12]); assert.equal(evidence.visibleSearchCount, 12);
  assert.equal(evidence.visibleSearchCountScope, 'last-visible-search-segment'); assert.match(evidence.uiLabel, /非全程唯一網站總數/);
  assert.equal(evidence.sha256, sha256(value.evidenceText));
  assert.deepEqual(assembleResults(input).records[0].provenance.perTask.analysisStats.webSearchEvidence, evidence);
  value.capture.webSearchEvidence.visibleSearchCounts = [21];
  rejected(() => assembleResults(input), 'capture_missing_or_stale');
});

test('known UI formatting is normalized while original clipboard hash remains distinct', () => {
  const value = fixture().people[0].tasks.analysisStats;
  const raw = value.raw.replace('## 【歷史局勢與定位】', '维基文库，自由的图书馆\n\n## 【歷史局勢與定位】').replace(value.request.tasks.analysisStats.marker, '`' + value.request.tasks.analysisStats.marker + '`');
  const output = captureExport({ ...value, raw });
  assert.deepEqual(output.fields.stats, stats); assert.equal(output.fields.analysis, analysis);
  assert.equal(output.capture.rawResponseSha256, sha256(raw)); assert.equal(output.capture.removedCardLines, 1);
  assert.equal(normalizeBatchExport(raw).text, output.text);
});

test('assembly rejects stale raw, clean captures, search receipts and split article files', () => {
  for (const mutate of [value => value.raw += ' changed', value => value.response += ' changed', value => value.capture.webSearchVerified = false, value => value.evidenceText = '已搜尋 4 個網站', value => value.fieldsFiles.analysis += ' changed', value => value.fieldsFiles.stats = '[11,20,30,40,50]\n', value => value.capture.responseSha256 = '0'.repeat(64), value => value.capture.promptSha256 = '0'.repeat(64)]) {
    const input = fixture(); mutate(input.people[0].tasks.analysisStats); rejected(() => assembleResults(input));
  }
});

test('only the observed standalone final escaped completion marker is normalized and forged markers reject', () => {
  const value = fixture().people[0].tasks.soulEssence, marker = value.request.tasks.soulEssence.marker;
  const raw = value.raw.replace(marker, '\\' + marker), output = captureExport({ ...value, raw });
  assert.equal(output.fields.soulEssence, soul);
  assert.equal(output.text, value.response);
  assert.equal(output.capture.rawResponseSha256, sha256(raw));
  assert.notEqual(output.capture.rawResponseSha256, output.capture.responseSha256);
  const preservedEscape = value.raw.replace(repeated, '\\保留正文的反斜線' + repeated);
  assert.ok(normalizeBatchExport(preservedEscape).text.includes('\\保留正文的反斜線'));
  for (const replacement of [
    '\\<!-- BATCH50_COMPLETE wrong soulEssence -->',
    `\\<!-- BATCH50_COMPLETE ${target.id} analysisStats -->`,
    '\\\\' + marker,
    '正文 \\' + marker,
    marker + '\n\\' + marker,
    `\\<!-- BATCH50_COMPLETE ${target.id} soulEssence changed -->`,
    '\\' + marker + '\n繼續正文',
  ]) rejected(() => captureExport({ ...value, raw: value.raw.replace(marker, replacement) }), 'incomplete_actual_capture');
});

test('forged clean prose cannot pass by updating clean and review hashes while retaining actual raw export', () => {
  const input = fixture(), value = input.people[0].tasks.analysisStats;
  value.response = value.response.replace(repeated, '人為改寫的新文字'); value.capture.responseSha256 = sha256(value.response); value.review.manuscriptSha256 = value.capture.responseSha256;
  rejected(() => assembleResults(input), 'capture_missing_or_stale');
});

test('the observed single escaped standalone reason marker preserves prose and rejects forged or repeated separators', () => {
  const value = fixture().people[0].tasks.analysisStats, task = value.request.tasks.analysisStats;
  const raw = value.raw.replace(task.reasonMarker, '\\' + task.reasonMarker).replace(task.marker, '\\' + task.marker);
  const output = captureExport({ ...value, raw });
  assert.equal(output.text, value.response); assert.deepEqual(output.fields, { stats, analysis, statsAnalysis });
  assert.equal(output.capture.rawResponseSha256, sha256(raw));
  for (const replacement of ['\\<!-- STATS_REASONS_BEGIN wrong -->', '\\\\' + task.reasonMarker,
    '正文 \\' + task.reasonMarker, task.reasonMarker + '\n\\' + task.reasonMarker,
    '\\' + task.reasonMarker + '\n\\' + task.reasonMarker, `\\<!-- STATS_REASONS_BEGIN ${target.id} changed -->`]) {
    rejected(() => captureExport({ ...value, raw: value.raw.replace(task.reasonMarker, replacement) }), 'stats_reason_separator_missing');
  }
});

test('QA must pass without material issues and bind both raw and complete clean manuscripts', () => {
  for (const mutate of [review => review.passed = false, review => review.materialIssues.push('待核'), review => review.manuscriptSha256 = '0'.repeat(64), review => review.rawResponseSha256 = '0'.repeat(64), review => review.sourcePackageSha256 = '0'.repeat(64), review => review.recordId = 'wrong', review => review.stats[0]++, review => review.checks = [{ id: 'check', passed: false, detail: 'failed' }]]) {
    const input = fixture(); mutate(input.people[0].tasks.analysisStats.review); rejected(() => assembleResults(input));
  }
});

test('typed checked primary sources require HTTPS, title, locator and coverage of every manuscript link', () => {
  for (const mutate of [review => review.checkedSources = [], review => review.checkedSources[0].checked = false, review => review.checkedSources[0].type = 'blog', review => review.checkedSources[0].url = 'http://example.org/synthetic-primary-text', review => review.checkedSources[0].locator = '', review => review.checkedSources[0].title = '', review => review.checkedSources[0].url = 'https://example.org/unrelated']) {
    const input = fixture(); mutate(input.people[0].tasks.analysisStats.review); rejected(() => assembleResults(input));
  }
});

test('soul captures remain bound to the exact reviewed appraisal context', () => {
  const input = fixture(); input.people[0].tasks.soulEssence.analysisContext += ' changed';
  rejected(() => assembleResults(input), 'soul_analysis_context_changed');
  const next = fixture(); next.people[0].tasks.soulEssence.capture.analysisContextSha256 = '0'.repeat(64);
  rejected(() => assembleResults(next), 'capture_missing_or_stale');
});

test('chunks reject empty, six-person, duplicate or incomplete-person submissions', () => {
  rejected(() => assembleResults({ manifest, people: [] }));
  const input = fixture(); rejected(() => assembleResults({ manifest, people: Array(6).fill(input.people[0]) }));
  rejected(() => assembleResults({ manifest, people: [input.people[0], input.people[0]] }));
  delete input.people[0].tasks.soulEssence; rejected(() => assembleResults(input));
});

test('all 100 frozen prompts reproduce the original templates, rendered prefixes and full staged suffixes', async () => {
  let verified = 0;
  for (const person of manifest.records) {
    const request = JSON.parse(await readFile(resolve(here, 'tasks', `${person.slug}.json`), 'utf8'));
    const deep = await readFile(resolve(repo, person.preserved.deepAnalysis.path), 'utf8');
    const source = await readFile(resolve(repo, person.sourcesPath), 'utf8');
    for (const task of TASKS) {
      const prompt = await readFile(resolve(repo, request.tasks[task].promptFile), 'utf8');
      const result = verifyOriginalPromptBinding({ target: person, request, task, prompt, deepAnalysis: deep, sourcePackage: source });
      assert.equal(result.originalPromptVerified, true);
      assert.equal(result.renderedOriginalSha256, request.tasks[task].renderedOriginalSha256);
      verified++;
    }
  }
  assert.equal(verified, 100);
});

test('forged template and rendered hashes cannot pass as hash-shaped metadata', () => {
  for (const [task, field] of [['analysisStats', 'originalTemplateSha256'], ['analysisStats', 'appendTemplateSha256'], ['analysisStats', 'renderedOriginalSha256'], ['soulEssence', 'originalTemplateSha256'], ['soulEssence', 'renderedOriginalSha256']]) {
    const input = fixture(), value = input.people[0].tasks[task];
    value.request.tasks[task][field] = '0'.repeat(64);
    rejected(() => captureExport(value));
    rejected(() => assembleResults(input));
  }
});

test('replacement original prefixes or staged suffixes are rejected even after updating the claimed prompt SHA', () => {
  for (const task of TASKS) {
    for (const replace of [prompt => '取代原提示詞\n' + prompt, prompt => prompt + '\n取代結尾指令']) {
      const input = fixture(), value = input.people[0].tasks[task];
      value.prompt = replace(value.prompt); value.request.tasks[task].promptSha256 = sha256(value.prompt);
      rejected(() => captureExport(value));
      rejected(() => assembleResults(input));
    }
  }
});

test('captured and reviewed fields import together after a CAS replan while preserving an earlier person and player progress', async () => {
  const syntheticManifest = structuredClone(manifest);
  const base = [...syntheticManifest.records.map(item => structuredClone(item.context)), ...Array.from({ length: 912 }, (_, at) => ({ id: `synthetic_pipeline_filler_${at}`, name: '合成管線人物' }))];
  const source = { ...structuredClone(USER_DEFAULTS), revision: 4, syntheticExtra: { kept: true }, soulSaves: [{ id: 'synthetic-before-save' }] };
  for (const item of syntheticManifest.records) source.modifiedLegends[item.id] = { deepAnalysis: await readFile(resolve(repo, item.preserved.deepAnalysis.path), 'utf8') };
  syntheticManifest.sourceSha256 = contentHash(source); syntheticManifest.baseLibrarySha256 = contentHash(base);
  const input = fixture(syntheticManifest), batch = assembleResults(input);
  assert.deepEqual(Object.keys(batch.records[0].provenance.perTask), TASKS);
  const dryRun = planBatch50Import(source, source, base, batch, syntheticManifest).report;
  let state = structuredClone(source), posts = 0;
  const backups = [], otherId = syntheticManifest.records[1].id;
  const report = await runBatch50Import({ source, base, batch, manifest: syntheticManifest, apply: true, approvedReport: dryRun,
    validateEvidence: async ({ batch: actualBatch, manifest: actualManifest }) => {
      assert.equal(contentHash(actualBatch), contentHash(batch)); assert.equal(contentHash(actualManifest), contentHash(syntheticManifest));
      // Synthetic unit fixture uses the same reconstruction logic; production
      // CLI/SDK use validateBatch50Evidence to reopen actual on-disk captures.
      return contentHash(assembleResults(input)) === contentHash(actualBatch);
    },
    saveSnapshot: async (name, value) => backups.push({ name, value: structuredClone(value) }),
    request: async (method, patch) => {
      if (method === 'GET') return { status: 200, body: structuredClone(state) };
      if (++posts === 1) {
        // A different full person and unrelated player progress arrive between
        // the first read and CAS. The pending person keeps its original input.
        Object.assign(state.modifiedLegends[otherId], structuredClone(batch.records[0].fields));
        state.soulSaves.push({ id: 'synthetic-concurrent-save' }); state.syntheticExtra.concurrent = true; state.revision++;
        return { status: 409, body: {} };
      }
      assert.equal(patch.revision, state.revision);
      state.modifiedLegends = structuredClone(patch.modifiedLegends); state.revision++;
      return { status: 200, body: { status: 'ok', revision: state.revision } };
    },
  });
  assert.equal(report.status, 'applied_verified'); assert.equal(report.changedFields, 4); assert.equal(report.conflicts, 1);
  assert.equal(report.verification.unaffectedBeforeSha256, report.verification.unaffectedAfterSha256);
  assert.deepEqual(backups.map(item => item.name), ['before-attempt-1', 'before-attempt-2', 'after-write']);
  for (const field of ['analysis', 'soulEssence', 'stats', 'statsAnalysis']) {
    assert.deepEqual(state.modifiedLegends[target.id][field], batch.records[0].fields[field]);
    assert.deepEqual(state.modifiedLegends[otherId][field], batch.records[0].fields[field]);
  }
  for (const item of syntheticManifest.records) assert.equal(state.modifiedLegends[item.id].deepAnalysis, source.modifiedLegends[item.id].deepAnalysis);
  assert.equal(state.soulSaves.length, 2); assert.equal(state.syntheticExtra.concurrent, true); assert.equal(state.revision, 6);
  assert.ok(!JSON.stringify(report).includes(repeated));
});


test('analysis-only assembly verifies actual three-field capture and QA without a soul task', () => {
  const input = fixture(); delete input.people[0].tasks.soulEssence;
  const batch = assembleAnalysisResults(input);
  assert.equal(batch.format, 'dynasty-analysis-batch50-analysis-results');
  assert.deepEqual(batch.records[0].fields, { analysis, stats, statsAnalysis });
  assert.deepEqual(Object.keys(batch.records[0].provenance.perTask), ['analysisStats']);
  for (const mutate of [v => { v.people[0].tasks.analysisStats.capture.responseSha256 = '0'.repeat(64); },
    v => { v.people[0].tasks.analysisStats.review.passed = false; },
    v => { v.people[0].tasks.analysisStats.fieldsFiles.soulEssence = 'crossed'; },
    v => { delete v.people[0].tasks.analysisStats.fieldsFiles.statsAnalysis; },
    v => { v.people[0].tasks.soulEssence = {}; }]) {
    const changed = structuredClone(input); mutate(changed); rejected(() => assembleAnalysisResults(changed));
  }
});
