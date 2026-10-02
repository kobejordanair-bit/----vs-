'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../backend/index.html'), 'utf8');
const networkSource = html.slice(html.indexOf('async function prepareWorldRequestContents'), html.indexOf('\nfunction openSnapshot()'));
const entrySource = html.slice(html.indexOf('        let worldRouteOpened = false;'), html.indexOf('        // Start\n'));
const clone = value => JSON.parse(JSON.stringify(value));

test('shipped app scripts compile and preserve original feature entry points alongside v16 assets', () => {
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (match[1].trim()) new vm.Script(match[1]);
  for (const name of ['openEvalModal', 'startChat', 'startCompare', 'runCourtPhase', 'runBattlePhase', 'handleSoulAction', 'openSoulDeep', 'openSoulSaves', 'startDebate', 'openSnapshot', 'openChronicle']) assert(html.includes('function ' + name + '('));
  for (const name of ['play-context', 'world-engine', 'workspace-vault', 'world-storage', 'world-ui']) assert(html.includes('/static/js/' + name + '.js?v=16.0'));
  assert(html.includes('/static/css/world.css?v=16.0'));
  assert(html.includes('id="worldWorkspaceButton"'));
  assert(html.includes('id="worldBackupButton"'));
});

function networkHarness(options = {}) {
  const requests = [], prepared = [], toast = { style: {}, textContent: '' };
  let attempt = 0;
  const context = vm.createContext({ console, TextDecoder, JSON, cloneState: clone, BACKEND_URL: 'https://test.invalid', APP_TOKEN: 'synthetic-token', document: { getElementById: () => toast }, setTimeout: callback => { callback(); return 1; }, fetch: async (url, request) => {
    requests.push({ url, body: JSON.parse(request.body) }); attempt++;
    if (options.retry && attempt === 1) throw new Error('synthetic retry');
    if (url.endsWith('/stream')) {
      let read = false;
      const bytes = new TextEncoder().encode('data: {"model":"test-flash"}\ndata: {"text":"完成"}\ndata: [DONE]\n');
      return { ok: true, body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { value: bytes, done: false }) }) } };
    }
    return { ok: true, json: async () => ({ result: '完成', model: 'test-pro' }) };
  } });
  if (options.enabled !== false) context.DynastyWorldUI = { prepareContents: async contents => { prepared.push(clone(contents)); contents[0].parts[0].text += ' (copy-only)'; return [{ role: 'user', parts: [{ text: 'material' }] }, ...contents]; } };
  vm.runInContext(networkSource, context);
  return { context, requests, prepared };
}

test('native JSON/multiturn requests add background once across retry without mutating history', async () => {
  const h = networkHarness({ retry: true });
  const history = [{ role: 'user', parts: [{ text: '原本人物指令' }] }, { role: 'model', parts: [{ text: '前一輪回應' }] }, { role: 'user', parts: [{ text: '續問' }] }];
  const before = clone(history);
  const result = await h.context._callGeminiNative(history, true);
  assert.equal(result, '完成');
  assert.equal(h.prepared.length, 1);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[0].body, h.requests[1].body);
  assert.equal(h.requests[0].body.is_json, true);
  assert.equal(h.requests[0].body.contents.filter(item => item.parts[0].text === 'material').length, 1);
  assert.deepEqual(h.requests[0].body.contents.slice(1).map(item => item.role), history.map(item => item.role));
  assert.deepEqual(history, before);
});

test('stream discussion override, partial output and model callback retain original behavior', async () => {
  const h = networkHarness();
  const history = [{ role: 'user', parts: [{ text: '討論內容' }] }, { role: 'model', parts: [{ text: '原討論回覆' }] }], before = clone(history);
  const chunks = [], models = [];
  const result = await h.context._callGeminiStream(null, text => chunks.push(text), model => models.push(model), history);
  assert.equal(result, '完成');
  assert.deepEqual(chunks, ['完成']);
  assert.deepEqual(models, ['test-flash']);
  assert.equal(h.prepared.length, 1);
  assert.equal(h.requests[0].body.contents.length, 3);
  assert.deepEqual(history, before);
});

test('missing optional workspace keeps existing AI request payload unchanged', async () => {
  const h = networkHarness({ enabled: false });
  const history = [{ role: 'user', parts: [{ text: '原本請求' }] }];
  await h.context._callGeminiNative(history);
  assert.deepEqual(h.requests[0].body.contents, history);
  assert.equal(h.requests[0].body.is_json, false);
});

test('a frozen-world stream keeps only its saved source context while retaining stream callbacks', async () => {
  const h = networkHarness();
  const frozen = [{ role: 'user', parts: [{ text: '本局已凍結的人物與回合' }] }], before = clone(frozen), chunks = [];
  const result = await h.context._callGeminiStream(null, value => chunks.push(value), null, frozen, { context: 'frozen' });
  assert.equal(result, '完成');
  assert.deepEqual(chunks, ['完成']);
  assert.equal(h.prepared.length, 0);
  assert.deepEqual(h.requests[0].body.contents, frozen);
  assert.deepEqual(frozen, before);
});

function entryHarness(options = {}) {
  const calls = [], state = { ready: options.ready !== false, blocked: false };
  const appState = { mode: 'browse', modifiedLegends: {}, compareList: [], soulMode: { selection: {} }, hegemony: { factions: [
    { courtSlots: { emperor: 'existing', strategist: null }, militarySlots: { commander: null } },
    { courtSlots: { emperor: null, strategist: null }, militarySlots: { commander: null } }
  ] }, debateMode: { pro: { debater1: 'existing', debater2: null, debater3: null, debater4: null }, con: { debater1: null, debater2: null, debater3: null, debater4: null } } };
  const context = vm.createContext({ console, location: { pathname: options.pathname || '/' }, cloudStore: { getState: () => state }, restoreLock: false, activeAiRequests: 0, pendingRestore: null, APP_TOKEN: 'synthetic-token', appState,
    legendsData: ['a', 'b', 'c', 'existing'].map(id => ({ id, name: '同名', type: 'general' })),
    customAlert: text => calls.push(['alert', text]),
    DynastyWorldUI: { configure: adapters => { context.adapters = adapters; }, close: () => calls.push(['close']), open: async tab => calls.push(['open', tab]), ready: async () => calls.push(['ready']) },
    toggleMode: mode => { appState.mode = mode; calls.push(['mode', mode]); },
    setSoulTab: tab => calls.push(['soulTab', tab]),
    el: () => ({ click: () => calls.push(['inputClick']) }),
    backupObject: () => ({ format: 'main-synthetic' }), captureUserData: () => ({ syntheticData: true }),
    loadDataFile: async input => { calls.push(['loadDataFile', JSON.parse(await input.files[0].text())]); context.pendingRestore = { preview: true }; },
    callGeminiStream: (...args) => calls.push(['narrate', ...args]), window: { open: (...args) => calls.push(['window', ...args]) }
  });
  for (const name of ['resetApp', 'openEvalModal', 'startChat', 'updateCompareUI', 'renderLegends', 'updateHegemonyUI', 'updateSoulModeUI', 'openSoulDeep', 'openSoulSaves', 'updateDebateModeUI', 'openCourtGame', 'openScenesPanel', 'openSnapshot', 'openChronicle', 'openStatsPanel', 'openAddModal', 'openEditHub', 'handleDownloadJSON']) context[name] = (...args) => calls.push([name, ...args]);
  vm.runInContext(entrySource, context);
  return { context, state, appState, calls, adapters: context.adapters };
}

test('all-feature adapters expose live records, runtime backup and explicit main restore preview', async () => {
  const h = entryHarness();
  for (const key of ['getRecords', 'getModifications', 'getMainBackup', 'getCurrentData', 'getToken', 'launchLegacy', 'restoreMain', 'narrate', 'isReady']) assert.equal(typeof h.adapters[key], 'function');
  assert.equal(h.adapters.getRecords()[0].id, 'a');
  assert.equal(h.adapters.getToken(), 'synthetic-token');
  assert.equal(h.adapters.getMainBackup().format, 'main-synthetic');
  const narrateCallback = () => {};
  h.adapters.narrate('frozen prompt', narrateCallback);
  const narrated = h.calls.find(call => call[0] === 'narrate');
  assert.equal(narrated[2], narrateCallback);
  assert.deepEqual(clone(narrated[5]), { context: 'frozen' });
  const result = await h.adapters.restoreMain({ format: 'synthetic-import' });
  assert.equal(result.pending, true);
  assert(h.calls.some(call => call[0] === 'loadDataFile'));
  assert(!h.calls.some(call => call[0] === 'confirmRestore'));
  h.context.activeAiRequests = 1;
  assert.throws(() => h.adapters.getMainBackup(), /生成/);
});

test('/play opens the new workspace once and only after cloud readiness', async () => {
  const h = entryHarness({ pathname: '/play' });
  await h.context.readyWorldWorkspace(); await h.context.readyWorldWorkspace();
  assert.equal(h.calls.filter(call => call[0] === 'open').length, 1);
  const locked = entryHarness({ ready: false });
  await locked.context.openWorldWorkspace();
  assert.equal(locked.calls.filter(call => call[0] === 'open').length, 0);
  assert(locked.calls.some(call => call[0] === 'alert'));
});

test('a primary-cloud conflict still permits read-only complete backup for recovery', async () => {
  const h = entryHarness(); h.state.blocked = true;
  assert.equal(h.adapters.isReady(), false);
  assert.equal(h.adapters.canBackup(), true);
  assert.equal(h.adapters.getMainBackup().format, 'main-synthetic');
  await h.context.openWorldWorkspace('backup');
  assert(h.calls.some(call => call[0] === 'open' && call[1] === 'backup'));
  assert.throws(() => h.adapters.launchLegacy('hegemony'), /載入雲端/);
});

test('legacy launch transfers exact IDs and preserves occupied hegemony and debate slots', () => {
  const h = entryHarness();
  h.adapters.launchLegacy('hegemony', ['a', 'b']);
  assert.equal(h.appState.hegemony.factions[0].courtSlots.emperor, 'existing');
  assert.equal(h.appState.hegemony.factions[1].courtSlots.emperor, 'a');
  assert.equal(h.appState.hegemony.factions[0].militarySlots.commander, 'b');
  h.adapters.launchLegacy('debate', ['a', 'b']);
  assert.equal(h.appState.debateMode.pro.debater1, 'existing');
  assert.equal(h.appState.debateMode.con.debater1, 'a');
  assert.equal(h.appState.debateMode.pro.debater2, 'b');
  h.adapters.launchLegacy('soul', ['b', 'a']);
  assert.equal(h.appState.soulMode.selection.host, 'b');
  assert.equal(h.appState.soulMode.selection.soul, 'a');
  h.adapters.launchLegacy('analysis', ['b']);
  assert(h.calls.some(call => call[0] === 'openEvalModal' && call[1] === 'b'));
  assert.throws(() => h.adapters.launchLegacy('chat', ['missing']), /不在目前人物庫/);
});

test('all old feature shortcuts remain callable without generated content or external navigation', () => {
  const h = entryHarness();
  for (const action of ['browse', 'compare', 'soul-deep', 'saves', 'court', 'scenes', 'snapshot', 'chronicle', 'stats', 'add', 'edit', 'backup', 'restore']) h.adapters.launchLegacy(action);
  for (const name of ['openSoulDeep', 'openSoulSaves', 'openCourtGame', 'openScenesPanel', 'openSnapshot', 'openChronicle', 'openStatsPanel', 'openAddModal', 'openEditHub', 'handleDownloadJSON', 'inputClick']) assert(h.calls.some(call => call[0] === name), name);
  assert(!h.calls.some(call => call[0] === 'narrate'));
});

test('missing selected IDs only block old features that consume the selected roster', () => {
  const h = entryHarness();
  for (const action of ['analysis', 'chat', 'source', 'history', 'compare', 'hegemony', 'soul', 'debate', 'review', 'freeSoul']) {
    assert.throws(() => h.adapters.launchLegacy(action, ['missing-on-device']), /目前人物庫：missing-on-device/);
  }
  assert.equal(h.calls.filter(call => call[0] === 'close').length, 0);
  for (const action of ['browse', 'soul-deep', 'saves', 'court', 'scenes', 'snapshot', 'chronicle', 'stats', 'add', 'edit', 'backup', 'restore']) {
    assert.doesNotThrow(() => h.adapters.launchLegacy(action, ['missing-on-device']));
  }
  assert.throws(() => h.adapters.launchLegacy('stats', [null]), /ID 清單格式/);
  assert.throws(() => h.adapters.launchLegacy('stats', 'missing-on-device'), /ID 清單格式/);
});
