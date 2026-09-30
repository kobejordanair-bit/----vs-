'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const backup = require('../backend/static/js/backup.js');

function factionFixture() {
    return { id: 'faction_1', name: '青龍', colorIdx: 0, territories: ['關中'], courtSlots: { emperor: 'emperor_甲' }, militarySlots: { commander: null } };
}

function fixture() {
    const data = backup.emptyData();
    data.customLegends = [{
        id: 'general_姓名&別名_1774556533470', name: '姓名&別名', type: 'general', rank: 'S＋',
        analysis: '完整分析\n第二段「內容」。',
        deepAnalysis: '完整深度分析\n政治結構與矛盾。',
        analysisMetadata: { perspective: '政治結構', arguments: [{ title: '矛盾', evidence: ['一', '二'] }] },
        stats: [87, 80, 95, 70, 85], soulEssence: { values: ['信用', '功業'], limits: null }
    }];
    data.modifiedLegends = { general_舊姓名: { analysis: '舊版全文', rank: 'A+' } };
    data.chatHistories = { general_舊姓名: [{ role: 'model', content: '回應', extra: { citation: '史料' } }] };
    data.simulationHistory = [{ type: '逐鹿', fullResult: '完整史冊', nested: { phases: ['甲', '乙'] } }];
    data.discussionHistories = { topic_1: { messages: [{ role: 'user', content: '問題', participants: ['甲'] }], extra: { perspective: '財政' } } };
    data.soulSaves = [{ id: 'save_1', snapshot: { phase: 'chapters', chapters: [{ content: '完整章節' }], generating: false } }];
    data.hegemonySavedSim = { factions: [factionFixture()], setup: { battlefield: null, scenario: 'battle' }, phases: [] };
    data.scenes = [{ id: 'scene_1', name: '場景', custom: { choices: ['甲', '乙'] } }];
    data.sceneEdits = { scene_1: { desc: '修訂描述', extra: [1, true, null] } };
    data.soulSession = { hostId: 'emperor_甲', phase: 'chapters', chapters: [{ content: '當前章節' }] };
    return data;
}

function legacyFixture() {
    const data = fixture();
    delete data.soulSaves;
    delete data.hegemonySavedSim;
    delete data.soulSession;
    return { ...data, version: '15.9' };
}

test('all ten persisted fields survive JSON backup round trip with rich nested content', () => {
    const data = fixture();
    const wrapper = backup.createBackup(data, {
        appVersion: '15.10',
        referenceData: {
            staticLegends: [{ id: 'emperor_甲_1', name: '甲', type: 'emperor', rank: 'A', analysis: '完整賞析', sourceMetadata: { complete: true } }],
            staticScenes: [{ id: 'sc_1', name: '朝會', participants: ['甲'] }]
        },
        runtime: { hegemony: { factions: [], battleSetup: { scenario: 'battle' } }, debateMode: { topic: '財政' }, soulMode: { selection: { host: 'emperor_甲_1' } } }
    });
    const parsed = backup.parseBackup(JSON.stringify(wrapper));
    assert.deepEqual(parsed.data, data);
    assert.deepEqual(Object.keys(parsed.data).sort(), [...backup.PERSISTED_FIELDS].sort());
    assert.deepEqual(parsed.referenceData, wrapper.referenceData);
    assert.deepEqual(parsed.runtime, wrapper.runtime);
    assert.deepEqual(parsed.missingFields, []);
    assert.equal(parsed.summary.soulSaves, 1);
    assert.equal(parsed.summary.chatMessages, 1);
    assert.equal(parsed.summary.simulationHistory, 1);
    parsed.data.customLegends[0].analysisMetadata.arguments[0].title = '改動';
    assert.equal(data.customLegends[0].analysisMetadata.arguments[0].title, '矛盾');
});

test('emptyData creates independent defaults without shared arrays or maps', () => {
    const first = backup.emptyData(), second = backup.emptyData();
    first.soulSaves.push({ id: 'saved' });
    first.modifiedLegends.legacy = { analysis: '內容' };
    assert.deepEqual(second, backup.emptyData());
    assert.equal(Object.keys(second).length, 10);
    assert.equal(second.soulSession, null);
    assert.equal(second.hegemonySavedSim, null);
});

test('legacy v15.9 missing fields preserve the current three omitted saves', () => {
    const current = fixture();
    const original = JSON.stringify(current);
    const imported = legacyFixture();
    imported.chatHistories = {};
    const parsed = backup.parseBackup(imported, current);
    assert.equal(parsed.format, 'legacy');
    assert.deepEqual(parsed.missingFields.sort(), ['hegemonySavedSim', 'soulSaves', 'soulSession'].sort());
    assert.deepEqual(parsed.data.soulSaves, current.soulSaves);
    assert.deepEqual(parsed.data.soulSession, current.soulSession);
    assert.deepEqual(parsed.data.hegemonySavedSim, current.hegemonySavedSim);
    assert.deepEqual(parsed.data.chatHistories, {});
    assert.equal(JSON.stringify(current), original);
    parsed.data.soulSaves[0].snapshot.chapters[0].content = '改動';
    assert.equal(current.soulSaves[0].snapshot.chapters[0].content, '完整章節');
});

test('legacy explicit empty array and nullable null intentionally clear current fields', () => {
    const parsed = backup.parseBackup({ version: '15.9', soulSaves: [], soulSession: null, hegemonySavedSim: null }, fixture());
    assert.deepEqual(parsed.data.soulSaves, []);
    assert.equal(parsed.data.soulSession, null);
    assert.equal(parsed.data.hegemonySavedSim, null);
    assert.equal(parsed.data.customLegends.length, 1);
});

test('only absent custom IDs in legacy exports receive the existing app hash', () => {
    const legacy = { version: '13.9', customLegends: [
        { name: '測試人物', type: 'general', rank: 'A' },
        { id: '中文&既有ID_123', name: '既有人物', type: 'minister', rank: 'B' }
    ] };
    const before = JSON.stringify(legacy);
    const parsed = backup.parseBackup(legacy);
    let hash = 0;
    for (const character of 'general_測試人物') hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
    assert.equal(parsed.data.customLegends[0].id, 'general_測試人物_' + Math.abs(hash));
    assert.equal(parsed.data.customLegends[1].id, '中文&既有ID_123');
    assert.equal(JSON.stringify(legacy), before);
    assert.ok(parsed.warningCodes.includes('LEGACY_CUSTOM_IDS_GENERATED'));
    assert.ok(parsed.warnings.some(message => message.includes('已按原程式規則補上')));
    const duplicate = { version: '13.9', customLegends: [legacy.customLegends[0], { ...legacy.customLegends[0] }] };
    assert.throws(() => backup.parseBackup(duplicate), /DUPLICATE_CUSTOM_ID/);
    assert.throws(() => backup.parseBackup({ version: '15.9', customLegends: [{ ...legacy.customLegends[0], id: null }] }), /INVALID_CHARACTER_FIELD/);
    const complete = backup.createBackup(fixture());
    delete complete.data.customLegends[0].id;
    assert.throws(() => backup.parseBackup(complete), /INVALID_CHARACTER_FIELD/);
});

test('invalid types do not mutate current data or source backup', () => {
    for (const [field, value] of [['customLegends', null], ['soulSaves', {}], ['modifiedLegends', []], ['hegemonySavedSim', []], ['soulSession', false], ['chatHistories', { x: {} }]]) {
        const current = fixture();
        const imported = { version: '15.9', [field]: value };
        const beforeCurrent = JSON.stringify(current), beforeSource = JSON.stringify(imported);
        assert.throws(() => backup.parseBackup(imported, current));
        assert.equal(JSON.stringify(current), beforeCurrent);
        assert.equal(JSON.stringify(imported), beforeSource);
    }
});

test('future schema, future app version, unknown format and recovery archives are rejected', () => {
    const current = fixture(), before = JSON.stringify(current);
    const cases = [
        { ...backup.createBackup(current), schemaVersion: 2 },
        { ...backup.createBackup(current), appVersion: '15.14' },
        { ...backup.createBackup(current), appVersion: '16.0' },
        { ...backup.createBackup(current), appVersion: '15.13.1' },
        { version: '16.0', customLegends: [] },
        { ...backup.createBackup(current), format: 'unknown' },
        { format: 'dynasty-recovery-bundle', exportedState: current, characters: [] },
        { exportedState: current, characters: [] },
        { ...backup.createBackup(current), appVersion: 'fifteen' }
    ];
    for (const value of cases) assert.throws(() => backup.parseBackup(value, current));
    assert.equal(JSON.stringify(current), before);
});

test('complete v1 backup must contain all ten fields and reject unknown data', () => {
    const incomplete = backup.createBackup(fixture());
    delete incomplete.data.soulSession;
    assert.throws(() => backup.parseBackup(incomplete), /MISSING_DATA_FIELD/);
    const unknown = backup.createBackup(fixture());
    unknown.data.futureSave = {};
    assert.throws(() => backup.parseBackup(unknown), /UNKNOWN_DATA_FIELD/);
    assert.throws(() => backup.parseBackup({ ...backup.createBackup(fixture()), futureMetadata: true }), /UNKNOWN_BACKUP_FIELD/);
    assert.throws(() => backup.validateData({ ...backup.emptyData(), token: 'secret' }), /UNKNOWN_DATA_FIELD/);
});

test('duplicate custom IDs are rejected, while same names and nonstandard IDs remain distinct', () => {
    const data = fixture();
    data.customLegends.push({ ...data.customLegends[0] });
    assert.throws(() => backup.createBackup(data), /DUPLICATE_CUSTOM_ID/);
    data.customLegends[1].id = 'minister_姓名&別名_2';
    data.customLegends[1].type = 'minister';
    assert.equal(backup.createBackup(data).data.customLegends.length, 2);
    data.customLegends[1].rank = 5;
    assert.throws(() => backup.createBackup(data), /INVALID_CHARACTER_FIELD/);
});

test('legacy reference review reports ambiguity and never applies aliases or overwrites content', () => {
    const data = backup.emptyData();
    data.modifiedLegends = { general_同名: { analysis: '旧內容' }, general_同名_123456: { analysis: '第二版' }, emperor_未知: { rank: 'A' } };
    data.chatHistories = { general_同名: [{ role: 'user', content: '問題' }] };
    const characters = [
        { id: 'general_同名_1', name: '同名', type: 'general', rank: 'A' },
        { id: 'general_同名_2', name: '同名', type: 'general', rank: 'B' },
        { id: 'minister_同名_3', name: '同名', type: 'minister', rank: 'A' }
    ];
    const before = JSON.stringify(data);
    const review = backup.reviewLegacyReferences(data, characters);
    assert.equal(review.modifications[0].candidates.length, 2);
    assert.equal(review.modifications[0].ambiguous, true);
    assert.equal(review.modifications[1].candidates.length, 2);
    assert.equal(review.modifications[2].candidates.length, 0);
    assert.equal(review.chats[0].candidates.some(x => x.type === 'minister'), false);
    assert.equal(JSON.stringify(data), before);
    const unique = backup.reviewLegacyReferences(data, [characters[0]]);
    assert.equal(unique.modifications[0].ambiguous, false);
    assert.equal(unique.modifications[0].candidates[0].id, 'general_同名_1');
});

test('credential globals and nested runtime secrets are excluded from exported backups', () => {
    const wrapper = backup.createBackup(fixture(), {
        runtime: {
            APP_TOKEN: 'global-secret', token: 'token-secret', appState: { anything: true },
            hegemony: { factions: [{ ...factionFixture(), apiKey: 'nested-secret' }], APP_SECRET: 'secret', battleSetup: { scenario: 'battle' } },
            soulMode: { selection: { host: 'host' }, authorization: 'bearer-secret' }
        }
    });
    assert.deepEqual(Object.keys(wrapper.runtime).sort(), ['hegemony', 'soulMode']);
    assert.deepEqual(wrapper.runtime.hegemony.factions, [factionFixture()]);
    for (const value of ['global-secret', 'token-secret', 'nested-secret', 'bearer-secret']) assert.equal(JSON.stringify(wrapper).includes(value), false);
    assert.throws(() => backup.parseBackup({ ...wrapper, runtime: { token: 'secret' } }), /UNKNOWN_RUNTIME_FIELD/);
    assert.throws(() => backup.parseBackup({ ...wrapper, runtime: { hegemony: { token: 'secret' } } }), /CREDENTIAL_IN_RUNTIME/);
    assert.throws(() => backup.createBackup(fixture(), { runtime: { debateMode: [] } }), /INVALID_RUNTIME_FIELD/);
    assert.throws(() => backup.createBackup(fixture(), { runtime: { hegemony: { factions: 'invalid' } } }), /INVALID_RUNTIME_FIELD/);
    assert.throws(() => backup.createBackup(fixture(), { runtime: { debateMode: { pro: { debater1: 42 } } } }), /INVALID_RUNTIME_FIELD/);
    assert.throws(() => backup.createBackup(fixture(), { runtime: { soulMode: { selection: [] } } }), /INVALID_RUNTIME_FIELD/);
});

test('reference arrays and every reference record are validated before importing', () => {
    for (const referenceData of [null, { staticLegends: {} }, { staticScenes: [null] }, { staticLegends: [{ id: 1 }] }, { staticScenes: [{ name: 5 }] }, { futureReference: [] }]) {
        assert.throws(() => backup.createBackup(fixture(), { referenceData }));
    }
    const wrapper = backup.createBackup(fixture());
    assert.throws(() => backup.parseBackup({ ...wrapper, referenceData: { staticScenes: 'invalid' } }));
});

test('cloud extras survive archive round trip but remain outside the ten restored fields', () => {
    const data = fixture();
    const extras = { futureDrafts: [{ id: 'draft_1', content: '尚未公開的草稿', nested: { choices: [1, null, true] } }], extensionSettings: { enabled: false } };
    const original = JSON.stringify(extras);
    const wrapper = backup.createBackup(data, { cloudExtras: extras });
    const parsed = backup.parseBackup(JSON.stringify(wrapper));
    assert.deepEqual(parsed.cloudExtras, extras);
    assert.deepEqual(parsed.data, data);
    assert.equal(Object.hasOwn(parsed.data, 'futureDrafts'), false);
    assert.equal(Object.keys(parsed.data).length, 10);
    assert.ok(parsed.warningCodes.includes('CLOUD_EXTRAS_ARCHIVED_ONLY'));
    assert.ok(parsed.warnings.some(message => message.includes('雲端額外欄位已封存')));
    parsed.cloudExtras.futureDrafts[0].nested.choices.push('local');
    assert.equal(JSON.stringify(extras), original);
    assert.deepEqual(backup.parseBackup(backup.createBackup(data, { cloudExtras: {} })).cloudExtras, {});
    assert.equal(backup.parseBackup(backup.createBackup(data)).cloudExtras, undefined);
    for (const cloudExtras of [null, [], 'invalid', JSON.parse('{"constructor":{"polluted":true}}')]) {
        assert.throws(() => backup.createBackup(data, { cloudExtras }));
        assert.throws(() => backup.parseBackup({ ...backup.createBackup(data), cloudExtras }));
    }
    assert.equal({}.polluted, undefined);
});

test('known character text fields reject objects while additional rich metadata is preserved', () => {
    for (const field of ['title', 'desc', 'dynasty', 'tag', 'poem', 'analysis', 'deepAnalysis']) {
        const data = fixture();
        data.customLegends[0][field] = { bad: true };
        assert.throws(() => backup.createBackup(data), /INVALID_CHARACTER_FIELD/);
        const modified = fixture();
        modified.modifiedLegends.legacy = { [field]: { bad: true } };
        assert.throws(() => backup.createBackup(modified), /INVALID_CHARACTER_FIELD/);
    }
    const data = fixture();
    const parsed = backup.parseBackup(backup.createBackup(data));
    assert.deepEqual(parsed.data.customLegends[0].soulEssence, data.customLegends[0].soulEssence);
    assert.deepEqual(parsed.data.customLegends[0].analysisMetadata, data.customLegends[0].analysisMetadata);
    assert.equal(parsed.data.customLegends[0].deepAnalysis, data.customLegends[0].deepAnalysis);
    data.customLegends[0].stats = { bad: true };
    assert.throws(() => backup.createBackup(data), /INVALID_CHARACTER_FIELD/);
});

test('malformed faction records are rejected in runtime and saved simulations before restoring', () => {
    const mutations = [
        value => delete value.id,
        value => { value.name = ''; },
        value => { value.colorIdx = -1; },
        value => { value.colorIdx = 0.5; },
        value => delete value.courtSlots,
        value => { value.militarySlots = []; },
        value => { value.courtSlots.emperor = 42; },
        value => delete value.territories,
        value => { value.territories = [null]; }
    ];
    for (const mutate of mutations) {
        const faction = factionFixture();
        mutate(faction);
        const data = fixture();
        data.hegemonySavedSim.factions = [faction];
        const before = JSON.stringify(data);
        assert.throws(() => backup.createBackup(data), /INVALID_FACTION_FIELD/);
        assert.equal(JSON.stringify(data), before);
        assert.throws(() => backup.createBackup(fixture(), { runtime: { hegemony: { factions: [faction] } } }), /INVALID_FACTION_FIELD/);
    }
    assert.throws(() => backup.createBackup(fixture(), { runtime: { hegemony: { factions: [{}] } } }), /INVALID_FACTION_FIELD/);
    for (const malformed of [{ factions: {} }, { setup: null }, { phases: [null] }, { phases: ['chapter'] }]) {
        const data = fixture();
        data.hegemonySavedSim = malformed;
        assert.throws(() => backup.createBackup(data));
    }
    const data = fixture();
    data.hegemonySavedSim.factions.push(factionFixture());
    assert.throws(() => backup.createBackup(data), /DUPLICATE_FACTION_ID/);
});

test('damaged soul arrays and chapters are rejected intact rather than replaced with defaults', () => {
    const mutations = [
        session => delete session.phase,
        session => { session.phase = 42; },
        session => { session.phase = ''; },
        session => { session.chapters = [null]; },
        session => { session.chapters = ['text']; },
        session => { session.chapters = {}; },
        ...['moments', 'soulMoments', 'keyEvents', 'figureStates', 'soulGrowth', 'pendingTensions', 'shockedFigures', 'lastChapterTypes', 'factionStates'].map(field => session => { session[field] = 'damaged content'; })
    ];
    for (const mutate of mutations) {
        for (const savedSnapshot of [false, true]) {
            const data = fixture();
            const session = savedSnapshot ? data.soulSaves[0].snapshot : data.soulSession;
            mutate(session);
            const before = JSON.stringify(data);
            assert.throws(() => backup.createBackup(data), /INVALID_SOUL_SESSION/);
            assert.equal(JSON.stringify(data), before);
        }
    }
    const data = fixture();
    data.soulSaves[0].snapshot = null;
    assert.throws(() => backup.createBackup(data), /INVALID_SOUL_SESSION/);
    data.soulSaves[0].snapshot = { phase: 'chapters', customStructure: { originalContent: ['keep', null] } };
    assert.deepEqual(backup.parseBackup(backup.createBackup(data)).data.soulSaves[0].snapshot, data.soulSaves[0].snapshot);
});

test('actual app initial mode and soul shapes support a complete preserved save round trip', () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/index.html'), 'utf8');
    const appMatch = source.match(/const appState = (\{[\s\S]*?\n        \});/);
    const soulMatch = source.match(/let soulSession = (\{[^;\n]*\});/);
    assert.ok(appMatch, 'appState fixture source must be available');
    assert.ok(soulMatch, 'soulSession fixture source must be available');
    const appState = JSON.parse(vm.runInNewContext('JSON.stringify((' + appMatch[1] + '))'));
    const session = JSON.parse(vm.runInNewContext('JSON.stringify((' + soulMatch[1] + '))'));
    session.phase = 'chapters';
    session.chapters = [{ title: '朝會', content: '完整故事', preStateSnapshot: { custom: ['preserve'] } }];
    const data = backup.emptyData();
    for (const field of backup.PERSISTED_FIELDS) if (Object.hasOwn(appState, field)) data[field] = appState[field];
    data.soulSession = session;
    data.soulSaves = [{ id: 'app_fixture_save', snapshot: structuredClone(session) }];
    data.hegemonySavedSim = { factions: structuredClone(appState.hegemony.factions), setup: structuredClone(appState.hegemony.battleSetup), phases: [{ title: '第一階段', content: '完整局勢', type: 'strategy' }] };
    const runtime = { hegemony: appState.hegemony, debateMode: appState.debateMode, soulMode: appState.soulMode };
    const wrapper = backup.createBackup(data, { runtime });
    const parsed = backup.parseBackup(JSON.stringify(wrapper));
    assert.deepEqual(parsed.data, data);
    assert.deepEqual(parsed.runtime, runtime);
});

test('unsafe nested keys and non-JSON values are rejected without prototype mutation', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
        const raw = JSON.parse('{"version":"15.9","modifiedLegends":{"legacy":{"' + key + '":{"polluted":true}}}}');
        assert.throws(() => backup.parseBackup(raw), /UNSAFE_JSON_KEY/);
        assert.equal({}.polluted, undefined);
    }
    const cyclic = backup.emptyData();
    cyclic.soulSession = {};
    cyclic.soulSession.self = cyclic.soulSession;
    assert.throws(() => backup.createBackup(cyclic), /CYCLIC_JSON_VALUE/);
    const data = backup.emptyData();
    data.soulSession = { value: Infinity };
    assert.throws(() => backup.createBackup(data), /INVALID_JSON_VALUE/);
    data.soulSession = { value: undefined };
    assert.throws(() => backup.createBackup(data), /INVALID_JSON_VALUE/);
    let accessed = false;
    data.soulSession = { get value() { accessed = true; return 'unexpected'; } };
    assert.throws(() => backup.createBackup(data), /INVALID_JSON_ACCESSOR/);
    assert.equal(accessed, false);
});
