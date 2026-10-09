import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../backend/index.html', import.meta.url), 'utf8');
const start = html.indexOf('async function _loadReviewContent(');
const end = html.indexOf('// 校準 tab 內容載入', start);
assert.ok(start >= 0 && end > start, 'review loader is present');
const source = html.slice(start, end);
const statsStart = html.indexOf('// ── 獨立五維：');
const statsEnd = html.indexOf('function forceRegenerateDeep(', statsStart);
assert.ok(statsStart >= 0 && statsEnd > statsStart, 'independent stats helpers are present');

function setup(modified) {
  const elements = new Map();
  const calls = { ai: 0, radar: [], discussions: [], sync: 0 };
  const context = vm.createContext({
    legendsData: [{ id: 'pilot-person', name: '試跑人物', title: '稱號', type: 'emperor' }],
    appState: { modifiedLegends: { 'pilot-person': structuredClone(modified) } },
    currentRequestToken: 0,
    currentStatsRequestToken: 0,
    el(id) {
      if (!elements.has(id)) {
        const classes = new Set(['hidden']);
        elements.set(id, {
          innerHTML: '', title: '', disabled: true,
          classList: {
            add: value => classes.add(value),
            remove: value => classes.delete(value),
            contains: value => classes.has(value),
          },
        });
      }
      return elements.get(id);
    },
    renderRadarChart(name, stats) {
      calls.radar.push({ name, stats });
      context.el('radarChartContainer').classList.remove('hidden');
    },
    setModalContent: text => { context.el('modalContent').innerHTML = text; },
    renderDiscussionPanel: (id, text) => calls.discussions.push({ id, text }),
    async callGeminiStream(prompt, onPartial) {
      calls.ai += 1;
      onPartial('{"stats": [81, 52, 93, 96, 80]}\n重新生成的賞析');
    },
    safeMarkdown: text => text,
    escapeHtml: text => text,
    refreshData() {},
    syncToCloud: () => { calls.sync += 1; },
    _aiErrorHTML: (action, message) => `Error: ${message}`,
  });
  vm.runInContext(html.slice(statsStart, statsEnd), context);
  vm.runInContext(source, context);
  return { context, calls, run: force => context._loadReviewContent('pilot-person', force) };
}

test('imported賞析 opens without AI, invented scores or a data write when stats are absent', async () => {
  const modified = { analysis: 'ChatGPT 匯入的賞析', deepAnalysis: '現有校準', soulEssence: '現有內核' };
  const fixture = setup(modified);
  // The same modal previously displayed another person's radar.
  fixture.context.el('radarChartContainer').classList.remove('hidden');
  await fixture.run(false);

  assert.equal(fixture.calls.ai, 0);
  assert.equal(fixture.calls.sync, 0);
  assert.equal(fixture.calls.radar.length, 0);
  assert.equal(fixture.context.el('modalContent').innerHTML, modified.analysis);
  assert.equal(fixture.context.el('loadingState').classList.contains('hidden'), true);
  assert.equal(fixture.context.el('radarChartContainer').classList.contains('hidden'), true);
  assert.equal(fixture.context.el('regenStatsBtn').classList.contains('hidden'), false);
  assert.match(fixture.context.el('regenStatsBtn').innerHTML, /生成五維（AI）/);
  assert.match(fixture.context.el('regenStatsBtn').title, /只補上五維數值與理由，保留賞析原文/);
  assert.equal(fixture.context.el('extractScenesBtn').disabled, false);
  assert.deepEqual(fixture.calls.discussions, [{ id: 'pilot-person', text: modified.analysis }]);
  assert.deepEqual(fixture.context.appState.modifiedLegends['pilot-person'], modified);
});

test('cached賞析 with existing stats keeps the radar and normal controls', async () => {
  const modified = { analysis: '原有賞析', stats: [72, 66, 91, 88, 77], statsAnalysis: '獨立五維理由' };
  const fixture = setup(modified);
  await fixture.run(false);

  assert.equal(fixture.calls.ai, 0);
  assert.equal(fixture.calls.sync, 0);
  assert.deepEqual(fixture.calls.radar, [{ name: '試跑人物', stats: modified.stats }]);
  assert.equal(fixture.context.el('radarChartContainer').classList.contains('hidden'), false);
  assert.match(fixture.context.el('regenStatsBtn').innerHTML, /重算五維/);
  assert.equal(fixture.context.el('modalContent').innerHTML, modified.analysis);
  assert.match(fixture.context.el('statsValues').innerHTML, /72/);
  assert.match(fixture.context.el('statsAnalysisContent').innerHTML, /獨立五維理由/);
  assert.deepEqual(fixture.calls.discussions, [{ id: 'pilot-person', text: modified.analysis }]);
});

test('legacy article retry replaces any stale independent reasons when it writes new stats', async () => {
  const fixture = setup({ analysis: '匯入的賞析', deepAnalysis: '保留校準', soulEssence: '保留內核', statsAnalysis: '舊五維理由' });
  await fixture.run(true);

  assert.equal(fixture.calls.ai, 1);
  assert.equal(fixture.calls.sync, 1);
  const result = fixture.context.appState.modifiedLegends['pilot-person'];
  assert.deepEqual(Array.from(result.stats), [81, 52, 93, 96, 80]);
  assert.equal(result.analysis.trim(), '重新生成的賞析');
  assert.equal(result.deepAnalysis, '保留校準');
  assert.equal(result.soulEssence, '保留內核');
  assert.equal(Object.hasOwn(result, 'statsAnalysis'), false);
  assert.match(fixture.context.el('regenStatsBtn').innerHTML, /重算五維/);
});
