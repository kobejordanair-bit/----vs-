'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual browser integration in one VM realm. Every fixture is synthetic;
// fetch, DOM, localStorage, downloads and AI calls are controlled by this harness.
const sourceDirectory = path.join(__dirname, '../backend/static/js');
const sources = ['backup.js', 'storage.js', 'persistence.js'].map(file => ({
    file, source: fs.readFileSync(path.join(sourceDirectory, file), 'utf8')
}));
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

const references = {
    staticLegends: [{ id: 'general_甲_1', name: '甲', type: 'general', rank: 'A', desc: '合成人物', dynasty: '測試朝' }],
    staticScenes: [{ id: 'scene_base', name: '合成場景', desc: '場景描述' }]
};
const soulDefaults = {
    phase: 'idle', hostId: null, soulId: null, soulTraits: null, moment: null,
    moments: [], soulMoment: null, soulMoments: [], chapters: [], viewingChapter: -1,
    figureStates: [], soulGrowth: [], generating: false, hostDead: false,
    deathChapter: -1, hostState: '', pendingTensions: [], shockedFigures: [],
    lastChapterTypes: [], globalSummary: '', hostPhysique: null, tensionStaleChapters: 0,
    lastGrowthChapter: -1, lastCostChapter: -1, keyEvents: [], currentDate: '',
    narrativeMode: 'drama', chronicleScale: 'standard', factionStates: [], totalMonthsElapsed: 0
};
const gameplayDefaults = {
    hegemony: {
        minimized: false, activeSlot: null, factions: [],
        battleSetup: { battlefield: null, scenario: 'battle' }, phases: [], savedSimulation: null
    },
    debateMode: {
        minimized: false, activeSlot: null,
        pro: { debater1: null, debater2: null, debater3: null, debater4: null },
        con: { debater1: null, debater2: null, debater3: null, debater4: null }, topic: ''
    },
    soulMode: {
        minimized: false, activeTab: 'free', activeSlot: null, activeScenario: null,
        selection: { host: null, soul: null, defector: null, newLord: null, teacher: null, student: null, figureA: null, figureB: null, duoLord: null }
    }
};
function fixture(label = 'loaded') {
    const faction = {
        id: `faction_${label}`, name: `勢力 ${label}`, colorIdx: 0, territories: ['關中'],
        courtSlots: { emperor: 'general_甲_1' }, militarySlots: { commander: null },
        courtCollapsed: false, militaryCollapsed: false
    };
    return {
        customLegends: [{ id: `custom_${label}`, name: `人物 ${label}`, type: 'minister', rank: 'A', desc: `描述 ${label}`, dynasty: '測試朝', analysis: `分析 ${label}`, deepAnalysis: `深度分析 ${label}`, extra: { reasons: ['合成'] } }],
        modifiedLegends: { general_甲_1: { analysis: `改動 ${label}` } },
        chatHistories: { general_甲_1: [{ role: 'user', content: `對話 ${label}`, extension: { retain: true } }] },
        simulationHistory: [{ type: '合成推演', content: `紀錄 ${label}`, extra: [1, null] }],
        discussionHistories: { topic_one: { messages: [{ role: 'model', content: `討論 ${label}` }], extra: { keep: true } } },
        soulSaves: [{ id: `save_${label}`, name: `存檔 ${label}`, snapshot: { ...clone(soulDefaults), phase: 'chapters', chapters: [{ content: `存檔章節 ${label}` }] } }],
        hegemonySavedSim: { factions: [faction], setup: { battlefield: null, scenario: 'battle' }, phases: [{ content: `逐鹿 ${label}` }] },
        scenes: [{ id: `scene_${label}`, name: `場景 ${label}`, desc: `自訂場景 ${label}` }],
        sceneEdits: { scene_base: { desc: `場景修改 ${label}`, unknown: [true] } },
        soulSession: { ...clone(soulDefaults), phase: 'chapters', hostId: 'general_甲_1', chapters: [{ content: `目前章節 ${label}`, streaming: true, generating: true }], generating: true }
    };
}

function harness(options = {}) {
    const elements = new Map(), cache = new Map(Object.entries(options.cache || {}));
    const requests = [], downloads = [], alerts = [], uiCalls = [], warnings = [];
    let getHandler = options.get || (() => ({ ...fixture(), revision: 4 }));
    let postHandler = options.post || (body => ({ status: 'ok', revision: body.revision + 1 }));
    let nextBlob = 0;
    const blobs = new Map();
    function element(id) {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id, {
                id, hidden: false, disabled: false, textContent: '', dataset: {}, style: {}, open: false,
                classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
                showModal() { this.open = true; }, close() { this.open = false; },
                click() { downloads.push({ filename: this.download, text: blobs.get(this.href)?.text }); }
            });
        }
        return elements.get(id);
    }
    const context = vm.createContext({
        console: { warn: (...args) => warnings.push(args), log() {}, error() {} },
        setTimeout: (action, duration) => {
            const timer = setTimeout(action, duration);
            if (duration === 1000) timer.unref(); // Download URL cleanup need not keep tests alive.
            return timer;
        },
        clearTimeout, AbortSignal,
        Blob: class { constructor(parts) { this.text = parts.join(''); } },
        URL: { createObjectURL(blob) { const id = `synthetic:blob-${++nextBlob}`; blobs.set(id, blob); return id; }, revokeObjectURL(id) { blobs.delete(id); } },
        document: { getElementById: element, createElement: type => element(`created_${type}_${nextBlob}`) },
        localStorage: { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, String(value)), removeItem: key => cache.delete(key) },
        location: { reload: () => uiCalls.push('reload') },
        customAlert: text => alerts.push(text),
        customConfirm: (_text, action) => action(),
        el: element,
        fetch: async (url, request = {}) => {
            const method = request.method || 'GET';
            const body = request.body ? JSON.parse(request.body) : null;
            requests.push({ url, method, body });
            const result = await (method === 'POST' ? postHandler(body, request) : getHandler(request));
            if (result && Object.hasOwn(result, 'httpStatus')) {
                return { ok: false, status: result.httpStatus, json: async () => vm.runInContext(JSON.stringify(result.data || {}), context) };
            }
            return { ok: true, status: 200, json: async () => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(result))})`, context) };
        },
        _callGeminiStream: (...args) => options.ai ? options.ai(...args) : Promise.resolve('synthetic AI'),
        _callGeminiNative: (...args) => options.ai ? options.ai(...args) : Promise.resolve('synthetic AI')
    });
    for (const { file, source } of sources.slice(0, 2)) vm.runInContext(source, context, { filename: file });
    vm.runInContext(`
        const BACKEND_URL = 'https://synthetic.invalid';
        const APP_TOKEN = 'synthetic-token';
        const APP_VERSION = '15.10';
        const staticLegendsData = ${JSON.stringify(references.staticLegends)};
        const staticScenesData = ${JSON.stringify(references.staticScenes)};
        const GAMEPLAY_DEFAULTS = ${JSON.stringify(gameplayDefaults)};
        const SOUL_SESSION_DEFAULTS = ${JSON.stringify(soulDefaults)};
        const appState = { ...DynastyBackup.emptyData(), ...JSON.parse(JSON.stringify(GAMEPLAY_DEFAULTS)), mode: 'browse', compareList: [], chatMode: { targetId: null, history: [] } };
        let soulSession = JSON.parse(JSON.stringify(SOUL_SESSION_DEFAULTS));
        let currentRequestToken = 8;
        let pendingReactionLegendId = 'old-reaction';
        let _debateState = { currentRound: 2, autoRun: true };
        function safeJSONParse(text, fallback) { try { return text ? JSON.parse(text) : fallback; } catch (_) { return fallback; } }
    `, context, { filename: 'synthetic-browser-state' });
    for (const name of ['refreshData', 'initScenarios', 'updateHegemonyUI', 'updateSoulModeUI', 'closeModal', 'closeSoulSaves', 'closeUIMsg', 'closeAllPanels', 'renderSoulSaves']) {
        context[name] = () => {
            uiCalls.push(name);
            if (options.uiFailure?.(name)) throw new Error('synthetic UI failure');
        };
    }
    vm.runInContext(sources[2].source, context, { filename: sources[2].file });
    const evaluate = code => vm.runInContext(code, context);
    const json = code => JSON.parse(evaluate(`JSON.stringify(${code})`));
    const input = (value, text = () => Promise.resolve(typeof value === 'string' ? value : JSON.stringify(value))) => {
        const node = { files: [{ text }], value: 'selected.json' };
        context.syntheticFileInput = node;
        return { node, load: () => evaluate('loadDataFile(syntheticFileInput)') };
    };
    return {
        evaluate, json, input, element, cache, requests, downloads, alerts, uiCalls, warnings,
        setGet: handler => { getHandler = handler; }, setPost: handler => { postHandler = handler; },
        state: () => json('({data: captureUserData(), appState, soulSession})'),
        postRequests: () => requests.filter(request => request.method === 'POST'),
        backup: (data = fixture('imported'), metadata = {}) => json(`DynastyBackup.createBackup(${JSON.stringify(data)}, ${JSON.stringify(metadata)})`),
        init: () => evaluate('init()'),
        store: () => json('cloudStore.getState()')
    };
}

test('GET 500 keeps the initial data intact, closes the write gate and permits a later retry', async () => {
    const h = harness({ get: () => ({ httpStatus: 500 }) });
    const before = h.state();
    await h.init();
    assert.deepEqual(h.state(), before);
    assert.equal(h.store().ready, false);
    assert.equal(await h.evaluate('syncToCloud()'), false);
    assert.equal(h.postRequests().length, 0);
    assert.equal(h.element('retryLoadBtn').hidden, false);
    assert.match(h.element('dataLoadMessage').textContent, /HTTP 500/);
    h.setGet(() => ({ ...fixture('retry'), revision: 10 }));
    await h.init();
    assert.equal(h.store().ready, true);
    assert.equal(h.store().revision, 10);
    assert.equal(h.state().data.customLegends[0].id, 'custom_retry');
});

test('malformed cloud data, a missing field and invalid revisions cannot open the write gate', async () => {
    const missingField = { ...fixture(), revision: 4 };
    delete missingField.soulSaves;
    const cases = [null, [], { ...fixture() }, { ...fixture(), revision: -1 }, { ...fixture(), revision: true }, { ...fixture(), revision: 1.5 }, missingField, { ...fixture(), revision: 4, soulSession: [] }];
    for (const payload of cases) {
        const h = harness({ get: () => payload });
        const before = h.state();
        await h.init();
        assert.deepEqual(h.state(), before);
        assert.equal(h.store().ready, false);
        assert.equal(await h.evaluate('syncToCloud()'), false);
        assert.equal(h.postRequests().length, 0);
        assert.equal(h.element('retryLoadBtn').hidden, false);
    }
});

test('a successful load captures all ten fields and uses the independent soulSession', async () => {
    const data = fixture();
    const h = harness({ get: () => ({ ...data, revision: 4 }) });
    await h.init();
    const normalized = clone(data);
    normalized.soulSession.generating = false;
    normalized.soulSession.chapters.forEach(chapter => { chapter.generating = false; chapter.streaming = false; });
    assert.deepEqual(h.state().data, normalized);
    assert.equal(Object.keys(h.state().data).length, 10);
    h.evaluate("appState.soulSession = {phase: 'chapters', chapters: [{content: 'stale decoy'}]}");
    assert.deepEqual(h.json('captureUserData().soulSession'), normalized.soulSession);
    const captured = h.json('captureUserData()');
    captured.customLegends[0].analysis = 'outside mutation';
    assert.equal(h.state().data.customLegends[0].analysis, data.customLegends[0].analysis);
});

test('a non-null idle soul session retains historical and extension fields in capture and backup', async () => {
    const data = fixture();
    data.soulSession = { ...clone(soulDefaults), historicalChapters: [{ content: 'archived idle content' }], extension: { retain: [true, null, 3] } };
    const h = harness({ get: () => ({ ...data, revision: 4 }) });
    await h.init();
    assert.equal(h.store().ready, true);
    assert.deepEqual(h.state().data.soulSession, data.soulSession);
    assert.deepEqual(h.json('backupObject().data.soulSession'), data.soulSession);
    assert.equal(await h.evaluate('cloudStore.save({immediate:true})'), true);
    assert.deepEqual(h.postRequests()[0].body.soulSession, data.soulSession);
});

test('a post-load UI failure invalidates the gate and retry is not blocked by ready state', async () => {
    let fail = true;
    const h = harness({ uiFailure: name => name === 'refreshData' && fail });
    await h.init();
    assert.equal(h.store().ready, false);
    assert.equal(h.element('retryLoadBtn').hidden, false);
    assert.equal(await h.evaluate('syncToCloud()'), false);
    fail = false;
    await h.init();
    assert.equal(h.store().ready, true);
    assert.equal(h.element('dataLoadingScreen').style.display, 'none');
});

test('preview displays counts without changing data or cache, and cancel clears the candidate', async () => {
    const h = harness();
    await h.init();
    const before = h.state(), cache = [...h.cache.entries()];
    const selected = h.input(h.backup());
    await selected.load();
    assert.equal(selected.node.value, '');
    assert.deepEqual(h.state(), before);
    assert.deepEqual([...h.cache.entries()], cache);
    assert.equal(h.postRequests().length, 0);
    assert.equal(h.element('restoreDialog').open, true);
    assert.equal(h.element('confirmRestoreBtn').disabled, false);
    assert.match(h.element('restoreDetails').textContent, /人物修改 1/);
    h.evaluate('cancelRestore()');
    assert.equal(h.evaluate('pendingRestore'), null);
    assert.equal(h.evaluate('restoreLock'), false);
    assert.equal(h.element('restoreDialog').open, false);
    await h.evaluate('confirmRestore()');
    assert.equal(h.postRequests().length, 0);
});

test('a cancelled asynchronous file cannot resurrect a candidate or replace a second preview', async () => {
    const h = harness();
    await h.init();
    const waiting = deferred();
    const first = h.input(null, () => waiting.promise).load();
    await turn();
    h.evaluate('cancelRestore()');
    const second = h.input(h.backup(fixture('second'))).load();
    await second;
    waiting.resolve(JSON.stringify(h.backup(fixture('cancelled'))));
    await first;
    assert.equal(h.json('pendingRestore.data.customLegends[0].id'), 'custom_second');
    assert.equal(h.element('restoreDialog').open, true);
    assert.equal(h.evaluate('restoreLock'), true);
    assert.equal(h.postRequests().length, 0);
    h.evaluate('cancelRestore()');
    assert.equal(h.evaluate('pendingRestore'), null);
});

test('cancel while waiting for a pending save leaves no ghost restoration when flush finishes', async () => {
    const response = deferred();
    const h = harness({ post: () => response.promise });
    await h.init();
    h.evaluate('syncToCloud()');
    const before = h.state();
    const loading = h.input(h.backup()).load();
    await turn();
    assert.equal(h.postRequests().length, 1);
    h.evaluate('cancelRestore()');
    response.resolve({ status: 'ok', revision: 5 });
    await loading;
    assert.deepEqual(h.state(), before);
    assert.equal(h.evaluate('pendingRestore'), null);
    assert.equal(h.evaluate('restoreLock'), false);
    assert.equal(h.element('restoreDialog').open, false);
    await h.evaluate('confirmRestore()');
    assert.equal(h.postRequests().length, 1);
});

test('active tracked AI prevents importing and exporting until its finally block completes', async () => {
    const response = deferred();
    const h = harness({ ai: () => response.promise });
    await h.init();
    const ai = h.evaluate("callGeminiStream('synthetic prompt')");
    let reads = 0;
    await h.input(null, () => { reads++; return Promise.resolve('{}'); }).load();
    h.evaluate('handleDownloadJSON()');
    assert.equal(reads, 0);
    assert.equal(h.downloads.length, 0);
    assert.equal(h.postRequests().length, 0);
    assert.equal(h.evaluate('activeAiRequests'), 1);
    response.reject(new Error('synthetic AI failure'));
    await assert.rejects(ai, /synthetic AI failure/);
    assert.equal(h.evaluate('activeAiRequests'), 0);
    h.evaluate('handleDownloadJSON()');
    assert.equal(h.downloads.length, 1);
});

test('the preview lock rejects new AI requests until the user cancels', async () => {
    let calls = 0;
    const h = harness({ ai: () => { calls++; return Promise.resolve('ok'); } });
    await h.init();
    await h.input(h.backup()).load();
    await assert.rejects(h.evaluate("callGeminiNative('synthetic prompt')"), /正在還原/);
    assert.equal(calls, 0);
    h.evaluate('cancelRestore()');
    assert.equal(await h.evaluate("callGeminiNative('synthetic prompt')"), 'ok');
    assert.equal(calls, 1);
});

test('confirm downloads the original data and applies all fields only after the POST acknowledgment', async () => {
    const response = deferred();
    const h = harness({ post: () => response.promise });
    await h.init();
    const before = h.state();
    const imported = fixture('imported');
    const runtime = {
        hegemony: { ...clone(gameplayDefaults.hegemony), factions: imported.hegemonySavedSim.factions, activeSlot: { side: 0, slot: 'emperor' }, battleSetup: { battlefield: '關中', scenario: 'battle' } },
        debateMode: { ...clone(gameplayDefaults.debateMode), topic: '合成辯題' },
        soulMode: { ...clone(gameplayDefaults.soulMode), selection: { ...gameplayDefaults.soulMode.selection, host: 'general_甲_1' } }
    };
    await h.input(h.backup(imported, { runtime })).load();
    const confirming = h.evaluate('confirmRestore()');
    await turn();
    assert.deepEqual(h.state(), before);
    assert.equal(h.evaluate('restoreLock'), true);
    assert.equal(h.element('cancelRestoreBtn').disabled, true);
    assert.equal(h.downloads.length, 1);
    assert.match(h.downloads[0].filename, /^before_restore_/);
    assert.deepEqual(JSON.parse(h.downloads[0].text).data, before.data);
    const posted = clone(h.postRequests()[0].body);
    assert.equal(posted.revision, 4);
    delete posted.revision;
    assert.deepEqual(posted, imported);
    response.resolve({ status: 'ok', revision: 5 });
    await confirming;
    const normalized = clone(imported);
    normalized.soulSession.generating = false;
    normalized.soulSession.chapters.forEach(chapter => { chapter.generating = false; chapter.streaming = false; });
    assert.deepEqual(h.state().data, normalized);
    assert.equal(h.json('appState.hegemony.activeSlot'), null);
    assert.equal(h.json('appState.debateMode.topic'), '合成辯題');
    assert.equal(h.evaluate('_debateState'), null);
    assert.equal(h.evaluate('pendingReactionLegendId'), null);
    assert.equal(h.evaluate('currentRequestToken'), 9);
    assert.equal(h.evaluate('pendingRestore'), null);
    assert.equal(h.evaluate('restoreLock'), false);
    assert.equal(h.element('restoreDialog').open, false);
    assert.equal(h.store().revision, 5);
});

test('POST 409 aborts restoration, retains the original state and blocks further saves', async () => {
    const h = harness({ post: () => ({ httpStatus: 409 }) });
    await h.init();
    const before = h.state(), cache = [...h.cache.entries()];
    await h.input(h.backup()).load();
    await h.evaluate('confirmRestore()');
    assert.deepEqual(h.state(), before);
    assert.deepEqual([...h.cache.entries()], cache);
    assert.equal(h.evaluate('restoreSnapshot'), null);
    assert.equal(h.evaluate('pendingRestore'), null);
    assert.equal(h.store().blocked, true);
    assert.equal(await h.evaluate('syncToCloud()'), false);
    assert.equal(h.postRequests().length, 1);
    assert.match(h.element('restoreDetails').textContent, /本機仍保留原資料/);
    assert.equal(h.alerts.some(message => message.includes('完整資料已還原')), false);
});

test('POST 500 preserves local data and a subsequent retry captures original data instead of the abandoned import', async () => {
    const h = harness({ post: () => ({ httpStatus: 500 }) });
    await h.init();
    const before = h.state();
    await h.input(h.backup()).load();
    await h.evaluate('confirmRestore()');
    assert.deepEqual(h.state(), before);
    assert.equal(h.store().blocked, false);
    assert.equal(h.store().dirty, true);
    h.setPost(body => ({ status: 'ok', revision: body.revision + 1 }));
    assert.equal(await h.evaluate('cloudStore.save({immediate:true})'), true);
    const retry = clone(h.postRequests()[1].body);
    delete retry.revision;
    assert.deepEqual(retry, before.data);
    assert.deepEqual(h.state(), before);
});

test('an explicit null clears the hegemony mirror and resets runtime without deleting preserved cache', async () => {
    const archive = [{ label: 'older local-only save' }];
    const h = harness({ cache: { dynasty_preserved_local_hegemony: JSON.stringify(archive) } });
    await h.init();
    assert.equal(h.cache.has('hegemony_saved_sim'), true);
    await h.input({ version: '15.9', soulSession: null, soulSaves: [], hegemonySavedSim: null }).load();
    await h.evaluate('confirmRestore()');
    assert.equal(h.cache.has('hegemony_saved_sim'), false);
    assert.deepEqual(JSON.parse(h.cache.get('dynasty_preserved_local_hegemony')), archive);
    assert.equal(h.state().data.hegemonySavedSim, null);
    assert.equal(h.state().data.soulSession, null);
    assert.deepEqual(h.state().data.soulSaves, []);
    assert.deepEqual(h.json('appState.hegemony'), gameplayDefaults.hegemony);
    assert.equal(h.json('soulSession.phase'), 'idle');
});

test('cloud extension fields and a different local-only simulation survive backup and restore as archives', async () => {
    const cloudExtension = { futureDrafts: [{ content: 'cloud extension' }] };
    const localOnly = { factions: [], setup: { scenario: 'local' }, phases: [{ content: 'local-only result' }] };
    const h = harness({ get: () => ({ ...fixture(), ...cloudExtension, revision: 4 }), cache: { hegemony_saved_sim: JSON.stringify(localOnly) } });
    await h.init();
    assert.deepEqual(JSON.parse(h.cache.get('dynasty_preserved_local_hegemony')), [localOnly]);
    const exported = h.json('backupObject()');
    assert.deepEqual(exported.cloudExtras, { loadedCloudFields: cloudExtension, localHegemonySaves: [localOnly] });
    assert.deepEqual(JSON.parse(h.cache.get('hegemony_saved_sim')), fixture().hegemonySavedSim);
    const importedExtras = { futureDrafts: [{ content: 'imported extension' }], anotherUnknown: { retain: true } };
    await h.input(h.backup(fixture('imported'), { cloudExtras: importedExtras })).load();
    await h.evaluate('confirmRestore()');
    const restored = h.json('backupObject()');
    assert.deepEqual(restored.cloudExtras.loadedCloudFields, exported.cloudExtras);
    assert.deepEqual(restored.cloudExtras.importedBackupFields, importedExtras);
    assert.equal(Object.hasOwn(h.postRequests()[0].body, 'futureDrafts'), false);
    assert.equal(Object.hasOwn(h.postRequests()[0].body, 'cloudExtras'), false);
    assert.deepEqual(JSON.parse(h.cache.get('dynasty_preserved_local_hegemony')), [localOnly]);
});

test('changed reference data cannot reach confirmation or POST; object key order is irrelevant', async () => {
    const h = harness();
    await h.init();
    const before = h.state();
    const different = clone(references);
    different.staticLegends[0].desc = 'different built-in version';
    await h.input(h.backup(fixture('imported'), { referenceData: different })).load();
    assert.equal(h.evaluate('pendingRestore'), null);
    assert.equal(h.element('confirmRestoreBtn').disabled, true);
    assert.match(h.element('restoreDetails').textContent, /內建人物／場景與目前版本不同/);
    await h.evaluate('confirmRestore()');
    assert.equal(h.postRequests().length, 0);
    assert.deepEqual(h.state(), before);
    h.evaluate('cancelRestore()');
    const reordered = clone(references);
    reordered.staticLegends[0] = Object.fromEntries(Object.entries(reordered.staticLegends[0]).reverse());
    await h.input(h.backup(fixture('imported'), { referenceData: reordered })).load();
    assert.equal(h.element('confirmRestoreBtn').disabled, false);
    h.evaluate('cancelRestore()');
});

test('invalid JSON and malformed gameplay data are rejected during preview before a POST', async () => {
    const h = harness();
    await h.init();
    const before = h.state();
    const malformedRuntime = h.backup();
    malformedRuntime.runtime = { hegemony: { factions: [{}] } };
    const malformedChapter = h.backup();
    malformedChapter.data.soulSession.chapters = [null];
    const malformedDescription = h.backup();
    malformedDescription.data.customLegends[0].desc = {};
    for (const raw of ['{invalid JSON', malformedRuntime, malformedChapter, malformedDescription]) {
        await h.input(raw).load();
        assert.equal(h.evaluate('pendingRestore'), null);
        assert.equal(h.element('confirmRestoreBtn').disabled, true);
        await h.evaluate('confirmRestore()');
        assert.deepEqual(h.state(), before);
        assert.equal(h.postRequests().length, 0);
        h.evaluate('cancelRestore()');
    }
});

test('legacy local migration preserves ambiguous names and never replaces a current-ID version', async () => {
    const data = fixture();
    data.modifiedLegends = {};
    data.customLegends.push({ id: 'general_甲_2', name: '甲', type: 'general', rank: 'B', desc: '同名合成人物' });
    const legacy = { 甲: { analysis: 'ambiguous legacy version' }, 孤立人物: { analysis: 'orphan version' } };
    const h = harness({ get: () => ({ ...data, revision: 4 }), cache: { modifiedLegends_v13_9: JSON.stringify(legacy) } });
    await h.init();
    assert.deepEqual(h.state().data.modifiedLegends, legacy);
    assert.equal(Object.hasOwn(h.state().data.modifiedLegends, 'general_甲_1'), false);
    assert.deepEqual(JSON.parse(h.cache.get('modifiedLegends_v13_9')), legacy);
    assert.equal(h.store().revision, 5);
    const existing = harness({ cache: { modifiedLegends_v13_9: JSON.stringify(legacy) } });
    await existing.init();
    assert.deepEqual(existing.state().data.modifiedLegends, fixture().modifiedLegends);
    assert.equal(existing.postRequests().length, 0);
});

test('optional world UI initialization failure cannot close a successful userdata load gate', async () => {
    const h = harness();
    h.evaluate('globalThis.readyWorldWorkspace = async () => { throw new Error("synthetic world UI failure"); };');
    await h.init();
    await turn();
    assert.equal(h.store().ready, true);
    assert.equal(h.postRequests().length, 0);
    assert.deepEqual(h.state().data.customLegends, fixture().customLegends);
    assert(h.alerts.some(message => message.includes('世界書桌載入失敗')));
});
