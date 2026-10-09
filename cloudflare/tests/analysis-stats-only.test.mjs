import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../backend/index.html', import.meta.url), 'utf8');
const dimensions = ['統率', '武力', '智謀', '政治', '魅力'];
const plain = value => JSON.parse(JSON.stringify(value));
function code(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `frontend code anchors: ${start}`);
  return html.slice(a, b);
}
const sources = [
  code('// ── 獨立五維：', 'function forceRegenerateDeep('),
  code('function openModal(', 'let statsChartInstances'),
  code('function openEvalModal(', 'function forceRegenerateSoulEssence('),
  code('async function _loadReviewContent(', '// 校準 tab 內容載入'),
  code('async function _loadSoulEssenceContent(', 'function _saveSoulEssence('),
  code('async function startCompare(', '// Native Multi-turn Chat Logic'),
].join('\n');
function validResponse() {
  return {
    stats: [81, 52, 93, 96, 80],
    reasons: dimensions.map(dimension => ({ dimension, reason: `${dimension}的純合成測試理由，說明此維度評估的具體依據及限制，並非真實歷史人物的評價與資料。` })),
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(options = {}) {
  const elements = new Map();
  const calls = { ai: 0, sync: 0, refresh: 0, radar: [], discussions: [], prompts: [] };
  const first = {
    analysis: '原有賞析完整原文', deepAnalysis: '原有深度校準', soulEssence: '原有靈魂內核',
    rank: 'A+', tag: '測試標籤', title: '測試稱號', desc: '測試簡評', poem: '測試詩句',
    futureNested: { retained: ['未知欄位', 9] }, ...options.modified,
  };
  const second = { analysis: '另一人物賞析', deepAnalysis: '另一人物校準', soulEssence: '另一人物內核', stats: [40, 41, 42, 43, 44], statsAnalysis: '另一人物既有理由' };
  const state = {
    customLegends: [], modifiedLegends: { first, second }, compareList: ['first', 'second'],
    chatMode: { targetId: null }, chatHistories: { first: [{ role: 'user', content: '純合成對話' }] },
    discussionHistories: { first: { messages: [{ role: 'user', content: '純合成討論' }] } },
    simulationHistory: [{ synthetic: true }], soulSaves: [{ synthetic: true }],
    hegemonySavedSim: { synthetic: true }, scenes: [{ synthetic: true }], sceneEdits: { synthetic: true },
    soulSession: { synthetic: true }, futureUserField: { preserved: true },
  };
  const context = vm.createContext({
    legendsData: [{ id: 'first', name: '人物一', title: '稱號一', type: 'emperor', desc: '合成簡介' }, { id: 'second', name: '人物二', title: '稱號二', type: 'general' }],
    appState: structuredClone(state), currentAnalysisId: 'first', currentEvalTab: 'review',
    currentStatsRequestToken: 0, currentRequestToken: 0, pendingReactionLegendId: null,
    window: { DynastySourceLinks: { clear() {}, setPerson() {} } },
    document: { querySelectorAll: () => ['review', 'calibrate', 'soul-essence'].map(tab => context.el('eval-tab-' + tab)) },
    el(id) {
      if (!elements.has(id)) {
        const classes = new Set(['hidden']);
        elements.set(id, {
          innerHTML: '', textContent: '', title: '', disabled: false, className: '',
          classList: {
            add: (...values) => values.forEach(value => classes.add(value)),
            remove: (...values) => values.forEach(value => classes.delete(value)),
            contains: value => classes.has(value),
            toggle(value, enabled) {
              const next = enabled ?? !classes.has(value);
              if (next) classes.add(value); else classes.delete(value);
              return next;
            },
          },
        });
      }
      return elements.get(id);
    },
    safeMarkdown: text => text,
    escapeHtml: text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    renderRadarChart(...args) { calls.radar.push(plain(args)); context.el('radarChartContainer').classList.remove('hidden'); },
    setModalContent(text) { context.el('loadingState').classList.add('hidden'); context.el('modalContent').innerHTML = text; },
    renderDiscussionPanel: (id, text) => calls.discussions.push({ id, text }),
    _loadCalibrationContent(id) { context.el('modalContent').innerHTML = context.appState.modifiedLegends[id].deepAnalysis; },
    _aiErrorHTML: (action, message) => 'Error: ' + message,
    showRelatedReactions() { throw new Error('Unexpected related-reactions generation'); },
    refreshData() { calls.refresh++; },
    syncToCloud() { calls.sync++; },
    async callGeminiStream(prompt, onPartial) {
      calls.ai++;
      calls.prompts.push(prompt);
      if (options.stream) return options.stream(prompt, onPartial);
      onPartial(JSON.stringify(validResponse()));
    },
  });
  vm.runInContext(sources, context);
  return { context, calls, initial: plain(context.appState), element: context.el, open: () => context.openEvalModal('first') };
}

test('explicit five-dimensional generation updates only scores and independent reasons, keeping article and discussion context intact', async () => {
  const f = fixture();
  await f.open();
  const originalArticleDom = f.element('modalContent').innerHTML;
  const originalDiscussions = structuredClone(f.calls.discussions);
  await f.context.forceRegenerateStats();
  const expected = structuredClone(f.initial);
  expected.modifiedLegends.first.stats = validResponse().stats;
  expected.modifiedLegends.first.statsAnalysis = dimensions.map((dimension, index) => `### ${dimension}：${validResponse().stats[index]}\n${validResponse().reasons[index].reason}`).join('\n\n');
  assert.deepEqual(plain(f.context.appState), expected);
  assert.equal(f.calls.ai, 1);
  assert.equal(f.calls.sync, 1);
  assert.equal(f.element('modalContent').innerHTML, originalArticleDom);
  assert.deepEqual(f.calls.discussions, originalDiscussions);
  assert.match(f.element('statsValues').innerHTML, /81/);
  assert.match(f.element('statsAnalysisContent').innerHTML, /五維評分理由/);
  assert.match(f.element('statsGenerationStatus').textContent, /已更新/);
  assert.equal(f.element('regenStatsBtn').disabled, false);
  assert.match(f.calls.prompts[0], /固定順序為 \[統率, 武力, 智謀, 政治, 魅力\]/);
});

test('cached scores and independent reasons render visibly without AI or POST, while discussion sees only the article', async () => {
  const f = fixture({ modified: { stats: [90, 50, 80, 85, 75], statsAnalysis: '只在独立區顯示的五维理由' } });
  await f.open();
  assert.equal(f.calls.ai, 0);
  assert.equal(f.calls.sync, 0);
  assert.deepEqual(plain(f.context.appState), f.initial);
  assert.match(f.element('statsValues').innerHTML, /90/);
  assert.match(f.element('statsAnalysisContent').innerHTML, /只在独立區/);
  assert.equal(f.element('modalContent').innerHTML, f.initial.modifiedLegends.first.analysis);
  assert.deepEqual(f.calls.discussions, [{ id: 'first', text: f.initial.modifiedLegends.first.analysis }]);
});

test('strict parser rejects invalid scores, missing or reordered dimensions, truncated reasons and extra output fields', () => {
  const f = fixture();
  for (const stats of [[1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [-1, 2, 3, 4, 5], [101, 2, 3, 4, 5], [1.5, 2, 3, 4, 5], ['1', 2, 3, 4, 5], [null, 2, 3, 4, 5], { length: 5 }]) {
    assert.throws(() => f.context._parseStatsOnlyResponse(JSON.stringify({ ...validResponse(), stats })), /五維必須/);
  }
  for (const mutate of [
    p => p.reasons.pop(), p => { p.reasons[4].dimension = '統率'; }, p => p.reasons.reverse(),
    p => { p.reasons[0].reason = '太短'; }, p => { p.reasons[0].reason = '待補'.repeat(30); },
    p => { p.reasons[0].reason = null; }, p => { delete p.reasons[0].reason; },
    p => { p.analysis = '不應出現的文章'; }, p => { p.reasons[0].extra = true; },
  ]) {
    const response = validResponse(); mutate(response);
    assert.throws(() => f.context._parseStatsOnlyResponse(JSON.stringify(response)), /未更新數值/);
  }
  for (const text of ['{"stats":[1,2', '```json\n' + JSON.stringify(validResponse()) + '\n```', JSON.stringify(validResponse()) + '\n追加文字']) {
    assert.throws(() => f.context._parseStatsOnlyResponse(text), /完整 JSON/);
  }
});

test('validation failure after a complete response leaves existing scores, reasons and all prose untouched', async () => {
  const f = fixture({ modified: { stats: [90, 50, 80, 85, 75], statsAnalysis: '既有五維理由' }, stream: async (_, chunk) => chunk(JSON.stringify({ ...validResponse(), stats: [101, 2, 3, 4, 5] })) });
  await f.open();
  const before = f.element('modalContent').innerHTML;
  await f.context.forceRegenerateStats();
  assert.deepEqual(plain(f.context.appState), f.initial);
  assert.equal(f.calls.sync, 0);
  assert.equal(f.element('modalContent').innerHTML, before);
  assert.match(f.element('statsGenerationStatus').textContent, /失敗/);
  assert.equal(f.element('regenStatsBtn').disabled, false);
});

test('duplicate JSON keys, including escaped aliases and nested reason keys, reject before any data write', async () => {
  const response = JSON.stringify(validResponse());
  const duplicates = [
    response.replace('"stats":', '"stats":[1,2,3,4,5],"stats":'),
    response.replace('"stats":', '"\\u0073tats":[1,2,3,4,5],"stats":'),
    response.replace('"dimension":"統率"', '"dimension":"武力","dimension":"統率"'),
    response.replace('"dimension":"統率"', '"\\u0064imension":"武力","dimension":"統率"'),
    response.replace('"reason":', '"reason":"先前理由","reason":'),
  ];
  for (const text of duplicates) {
    // Native JSON.parse accepts these; the UI must reject the ambiguity instead.
    assert.doesNotThrow(() => JSON.parse(text));
    const f = fixture({ stream: async (_, chunk) => chunk(text) });
    await f.open();
    assert.throws(() => f.context._parseStatsOnlyResponse(text), /重複 JSON/);
    await f.context.forceRegenerateStats();
    assert.deepEqual(plain(f.context.appState), f.initial);
    assert.equal(f.calls.sync, 0);
    assert.equal(f.element('modalContent').innerHTML, f.initial.modifiedLegends.first.analysis);
    assert.match(f.element('statsGenerationStatus').textContent, /重複 JSON/);
  }
  const f = fixture();
  const quotedWords = validResponse();
  quotedWords.reasons[0].reason += ' 正文內引用 "dimension"、反斜線 \\、括號 {} 並不代表重複鍵。';
  assert.doesNotThrow(() => f.context._parseStatsOnlyResponse(JSON.stringify(quotedWords)));
});

test('API failure after a partial reply preserves article, prior scores and reasons without any data write', async () => {
  const f = fixture({ modified: { stats: [90, 50, 80, 85, 75], statsAnalysis: '既有五維理由' }, stream: async (_, chunk) => { chunk('{"stats":[1'); throw new Error('合成串流中斷'); } });
  await f.open();
  await f.context.forceRegenerateStats();
  assert.deepEqual(plain(f.context.appState), f.initial);
  assert.equal(f.calls.sync, 0);
  assert.equal(f.element('modalContent').innerHTML, f.initial.modifiedLegends.first.analysis);
  assert.match(f.element('statsGenerationStatus').textContent, /合成串流中斷/);
  assert.equal(f.element('regenStatsBtn').disabled, false);
});

test('switching people during stats generation discards both late success and late failure without affecting the newly opened article', async () => {
  for (const fail of [false, true]) {
    const gate = deferred();
    const f = fixture({ stream: async (_, chunk) => { chunk('{"stats":[1'); await gate.promise; chunk(JSON.stringify(validResponse())); } });
    await f.open();
    const running = f.context.forceRegenerateStats();
    f.context.openEvalModal('second');
    const secondDom = f.element('modalContent').innerHTML;
    const secondStatus = f.element('statsGenerationStatus').textContent;
    if (fail) gate.reject(new Error('late error')); else gate.resolve();
    await running;
    assert.deepEqual(plain(f.context.appState), f.initial);
    assert.equal(f.calls.sync, 0);
    assert.equal(f.element('modalContent').innerHTML, secondDom);
    assert.equal(f.element('statsGenerationStatus').textContent, secondStatus);
    assert.equal(f.element('regenStatsBtn').disabled, false);
  }
});

test('switching tabs during generation invalidates the request, including returning to the same review tab before completion', async () => {
  for (const tab of ['calibrate', 'soul-essence', 'back-to-review']) {
    const gate = deferred();
    const f = fixture({ stream: async (_, chunk) => { await gate.promise; chunk(JSON.stringify(validResponse())); } });
    await f.open();
    const running = f.context.forceRegenerateStats();
    f.context.setEvalTab(tab === 'back-to-review' ? 'soul-essence' : tab);
    if (tab === 'back-to-review') f.context.setEvalTab('review');
    const afterSwitch = f.element('modalContent').innerHTML;
    gate.resolve(); await running;
    assert.deepEqual(plain(f.context.appState), f.initial);
    assert.equal(f.calls.sync, 0);
    assert.equal(f.element('modalContent').innerHTML, afterSwitch);
    assert.equal(f.element('statsDetailsContainer').classList.contains('hidden'), tab !== 'back-to-review');
  }
});

test('closing the modal cancels pending stats results; double-clicking a pending button starts only one request', async () => {
  const gate = deferred();
  const f = fixture({ stream: async (_, chunk) => { await gate.promise; chunk(JSON.stringify(validResponse())); } });
  await f.open();
  const running = f.context.forceRegenerateStats();
  await f.context.forceRegenerateStats();
  assert.equal(f.calls.ai, 1);
  f.context.closeModal();
  gate.resolve(); await running;
  assert.deepEqual(plain(f.context.appState), f.initial);
  assert.equal(f.calls.sync, 0);
  assert.equal(f.element('statsDetailsContainer').classList.contains('hidden'), true);
});

test('a stale person id cannot generate stats from a calibration tab or a different modal', async () => {
  const f = fixture();
  await f.open();
  f.context.setEvalTab('calibrate');
  await f.context.forceRegenerateStats();
  f.context.openModal('合成其他功能');
  f.context.currentEvalTab = 'review';
  await f.context.forceRegenerateStats();
  assert.equal(f.calls.ai, 0);
  assert.equal(f.calls.sync, 0);
  assert.deepEqual(plain(f.context.appState), f.initial);
  assert.equal(f.element('regenStatsBtn').classList.contains('hidden'), true);
});

test('compare fills only the missing person, clearing stale independent reasons and preserving the other existing scores and reasons', async () => {
  const f = fixture({ modified: { statsAnalysis: '舊而孤立的五維理由' }, stream: async (_, chunk) => chunk('合成比較文章\n{"stats1":[1,2,3,4,5],"stats2":[99,99,99,99,99]}') });
  await f.context.startCompare();
  const expected = structuredClone(f.initial);
  expected.modifiedLegends.first.stats = [1, 2, 3, 4, 5];
  delete expected.modifiedLegends.first.statsAnalysis;
  assert.deepEqual(plain(f.context.appState), expected);
  assert.equal(f.calls.sync, 1);
  assert.deepEqual(plain(f.context.appState.modifiedLegends.second.stats), [40, 41, 42, 43, 44]);
});

test('refreshData does not mark scores, analysis or statsAnalysis alone as a character edit', () => {
  const f = fixture();
  f.context.staticLegendsData = f.context.legendsData;
  f.context.appState.modifiedLegends = { first: { analysis: '原文', stats: [1, 2, 3, 4, 5], statsAnalysis: '理由' }, second: { statsAnalysis: '理由', rank: 'S' } };
  f.context.renderLegends = () => {};
  vm.runInContext(code('function refreshData()', 'function setTypeFilter('), f.context);
  f.context.refreshData();
  assert.equal(f.context.legendsData[0].isModified, false);
  assert.equal(f.context.legendsData[1].isModified, true);
});
