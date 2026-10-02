'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Vault = require('../backend/static/js/workspace-vault.js');
const Backup = require('../backend/static/js/backup.js');
const WorldStorage = require('../backend/static/js/world-storage.js');
const Court = require('../backend/static/js/court-engine.js');
const Council = require('../backend/static/js/court-council.js');
const Campaign = require('../backend/static/js/court-campaign.js');
const Investigation = require('../backend/static/js/history-investigation.js');
const pkg = require('../backend/static/data/history/chuhan-foundation.v1.json');
const cases = require('../backend/static/data/history/chuhan-cases.v1.json');
const stamp = '2026-10-02T08:00:00.000Z';
WorldStorage.registerWithVault(Vault);
const validators = { dynasty_court_grain_v1: Court.validateState, dynasty_court_grain_v2: Council.validateState, dynasty_court_grain_v3: Campaign.validateState, [WorldStorage.KEY]: WorldStorage.validateWorkspace };
class MemoryStorage {
    constructor(values = {}) { this.values = new Map(Object.entries(values)); this.reads = []; this.writes = []; this.beforeWrite = null; }
    get length() { return this.values.size; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    getItem(key) { this.reads.push(key); return this.values.get(key) ?? null; }
    setItem(key, value) { if (this.beforeWrite) this.beforeWrite(key, value); this.writes.push(key); this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}
function court(version = 1) { const engine = [null, Court, Council, Campaign][version]; return JSON.stringify({ format: 'dynasty-court-save', version, scenario: 'court-grain-v' + version, state: engine.createGame(), presentOutcome: false }); }
function bundle(entries = [], mainBackup = null) { return { format: Vault.FORMAT, schemaVersion: 1, exportedAt: stamp, mainBackup, localEntries: entries }; }
function preview(entries, mainBackup) { const result = Vault.importPreview(bundle(entries, mainBackup), { backupApi: Backup, validators }); assert.equal(result.ok, true, result.errors?.join(',')); return result; }

test('complete capture preserves private analyses, runtime and cloud extra fields but reads no credential keys', () => {
    const data = Backup.emptyData(); data.customLegends = [{ id: 'one', name: '甲', type: '文臣', rank: 'S', analysis: '人物完整原文', deepAnalysis: '深入長文' }];
    const main = Backup.createBackup(data, { cloudExtras: { future: { history: ['保留'] } }, referenceData: { staticLegends: [{ id: 'base', name: '原庫人物', analysis: '完整私有文章' }] } });
    const storage = new MemoryStorage({ dynasty_token: 'must-never-read', api_key: 'secret', dynasty_court_grain_v1: court(), [WorldStorage.KEY]: JSON.stringify(WorldStorage.emptyWorkspace()) });
    const captured = Vault.capture({ storage, mainBackup: main, now: stamp });
    assert.deepEqual(captured.mainBackup, main); assert.equal(captured.localEntries.length, 2);
    assert.equal(storage.reads.includes('dynasty_token'), false); assert.equal(storage.reads.includes('api_key'), false);
    const result = Vault.importPreview(captured, { backupApi: Backup, validators });
    assert.equal(result.ok, true); assert.equal(result.summary.hasMainBackup, true); assert.deepEqual(result.mainBackup, main);
    assert.equal(result.mainParsed.data.customLegends[0].analysis, '人物完整原文');
});
test('all three court versions and real historical investigations roundtrip', () => {
    const engine = Investigation.createEngine({ package: pkg, cases });
    const entries = [1, 2, 3].map(version => ({ key: 'dynasty_court_grain_v' + version, raw: court(version) }));
    entries.push({ key: engine.storageKey, raw: engine.exportJSON() });
    const imported = preview(entries), storage = new MemoryStorage();
    assert.equal(imported.summary.ready, 4);
    const plan = Vault.planRestore(imported, { storage }); const result = Vault.restoreLocal(plan, { storage });
    assert.equal(result.ok, true); entries.forEach(item => assert.equal(storage.getItem(item.key), item.raw));
    assert.throws(() => Vault.restoreLocal(plan, { storage }), /VAULT_INVALID_PLAN/);
});
test('default conflicts preserve active version and expose imported version for explicit recovery', () => {
    const old = court(), changed = JSON.parse(old); changed.state = Court.choose(changed.state, Court.getChoices(changed.state).find(item => !item.disabledReason).id);
    const incoming = JSON.stringify(changed), storage = new MemoryStorage({ dynasty_court_grain_v1: old });
    const plan = Vault.planRestore(preview([{ key: 'dynasty_court_grain_v1', raw: incoming }]), { storage, now: stamp });
    assert.equal(Vault.restoreLocal(plan, { storage }).ok, true); assert.equal(storage.getItem('dynasty_court_grain_v1'), old);
    const retained = Vault.listRecoveries({ storage }); assert.equal(retained.length, 1); assert.equal(retained[0].raw, incoming);
    const recovery = Vault.recoveryPreview(retained[0].id, { storage, backupApi: Backup, validators });
    const replacement = Vault.planRestore(recovery, { storage, strategy: 'replace' });
    assert.equal(Vault.restoreLocal(replacement, { storage }).ok, true); assert.equal(storage.getItem('dynasty_court_grain_v1'), incoming);
    assert(Vault.listRecoveries({ storage }).some(item => item.raw === old));
});
test('invalid JSON, replay corruption and unknown newer versions are retained without activation', () => {
    const corrupted = JSON.parse(court()); corrupted.state.resources.grain += 50;
    const future = JSON.parse(court(2)); future.version = 99;
    const values = [{ key: 'dynasty_court_grain_v1', raw: JSON.stringify(corrupted) }, { key: 'dynasty_court_grain_v2', raw: JSON.stringify(future) }, { key: 'dynasty_court_grain_v3', raw: '{broken' }];
    const result = preview(values), storage = new MemoryStorage(); assert.equal(result.summary.retained, 3); assert.equal(result.summary.ready, 0);
    assert.equal(Vault.restoreLocal(Vault.planRestore(result, { storage }), { storage }).ok, true);
    assert.equal(storage.getItem('dynasty_court_grain_v1'), null); assert.equal(Vault.listRecoveries({ storage }).length, 3);
});
test('future main backup and whole bundle survive exactly in recoveries', () => {
    const main = Backup.createBackup(Backup.emptyData()); main.appVersion = '999.0'; main.unknown = ['new'];
    const storage = new MemoryStorage(), imported = preview([], main);
    assert.equal(imported.mainBackup, null); assert.equal(imported.summary.retained, 1);
    assert.equal(Vault.restoreLocal(Vault.planRestore(imported, { storage }), { storage }).ok, true);
    assert.deepEqual(JSON.parse(Vault.listRecoveries({ storage })[0].raw), main);
    const newer = { ...bundle(), schemaVersion: 50, futureFields: { nested: 'must remain' } };
    const p = Vault.importPreview(newer, { backupApi: Backup }); assert.equal(p.ok, true);
    assert.equal(Vault.restoreLocal(Vault.planRestore(p, { storage }), { storage }).ok, true);
    assert.deepEqual(JSON.parse(Vault.listRecoveries({ storage }).find(item => item.key === '$bundle').raw), newer);
});
test('quota failure rolls back every applied write and supplies lossless recovery download', () => {
    const existing = { dynasty_court_grain_v1: court(), [Vault.RECOVERY_KEY]: null };
    const storage = new MemoryStorage({ dynasty_court_grain_v1: existing.dynasty_court_grain_v1 });
    const next = JSON.parse(court()); next.state = Court.choose(next.state, Court.getChoices(next.state).find(item => !item.disabledReason).id);
    const imported = preview([{ key: 'dynasty_court_grain_v1', raw: JSON.stringify(next) }, { key: 'dynasty_court_grain_v2', raw: court(2) }]);
    const before = [...storage.values]; const plan = Vault.planRestore(imported, { storage, strategy: 'replace' });
    storage.beforeWrite = key => { if (key === 'dynasty_court_grain_v2') throw new Error('QuotaExceededError'); };
    const result = Vault.restoreLocal(plan, { storage }); assert.equal(result.ok, false); assert.equal(result.rollbackComplete, true); assert.deepEqual([...storage.values], before);
    assert(result.recovery.before.some(item => item.raw === existing.dynasty_court_grain_v1)); assert(result.recovery.proposed.some(item => item.key === 'dynasty_court_grain_v2'));
});
test('stale preflight does no writes and never overwrites a third party during rollback', () => {
    const storage = new MemoryStorage(), imported = preview([{ key: 'dynasty_court_grain_v1', raw: court() }]);
    const plan = Vault.planRestore(imported, { storage }); storage.values.set('dynasty_court_grain_v1', 'external');
    const result = Vault.restoreLocal(plan, { storage }); assert.equal(result.code, 'VAULT_STORAGE_CONFLICT'); assert.equal(storage.writes.length, 0); assert.equal(storage.getItem('dynasty_court_grain_v1'), 'external');
});
test('duplicate or unapproved storage keys reject the entire preview', () => {
    const entry = { key: 'dynasty_court_grain_v1', raw: court() };
    assert.equal(Vault.importPreview(bundle([entry, entry]), { backupApi: Backup }).ok, false);
    assert.equal(Vault.importPreview(bundle([{ key: 'dynasty_token', raw: 'secret' }]), { backupApi: Backup }).ok, false);
    assert.throws(() => Vault.registerKey('dynasty-world-token'), /VAULT_KEY_NOT_ALLOWED/);
    const malicious = '{"format":"dynasty-workspace-vault","schemaVersion":1,"__proto__":{"polluted":true}}';
    assert.equal(Vault.importPreview(malicious).ok, false); assert.equal({}.polluted, undefined);
});
test('main restore never writes cloud or local mirrored classic data', () => {
    const data = Backup.emptyData(); data.soulSession = { phase: 'chapters', chapters: [{ content: '完整章節' }] };
    const main = Backup.createBackup(data), imported = preview([], main), storage = new MemoryStorage({ hegemony_saved_sim: 'old' });
    const result = Vault.restoreLocal(Vault.planRestore(imported, { storage }), { storage });
    assert.equal(result.ok, true); assert.deepEqual(result.mainBackup, main); assert.equal(storage.writes.length, 0); assert.equal(storage.getItem('hegemony_saved_sim'), 'old');
});
test('corrupt existing recovery bucket blocks replacement before any mutation', () => {
    const storage = new MemoryStorage({ [Vault.RECOVERY_KEY]: '{broken', dynasty_court_grain_v1: 'old' });
    assert.throws(() => Vault.planRestore(preview([{ key: 'dynasty_court_grain_v1', raw: court() }]), { storage, strategy: 'replace' }), /VAULT_INVALID_JSON/);
    assert.equal(storage.writes.length, 0);
});
test('new playable world, exact character IDs and original interpretation survive vault and engine replay', () => {
    const Engine = require('../backend/static/js/world-engine.js');
    WorldStorage.setSessionValidator(save => { Engine.importSession(save); return true; });
    let state = Engine.createSession({ mode: 'hegemony', seed: 'vault-roundtrip', roster: [
        { recordId: 'one', name: '同名', analysisAnchors: [{ id: 'anchor-one', quote: '完整原始人物分析摘錄', sourceField: 'deepAnalysis', principle: 'care' }] },
        { recordId: 'two', name: '同名' }
    ] });
    state = Engine.resolveTurn(state, Engine.defaultOrder(state));
    const value = WorldStorage.emptyWorkspace(); value.sessions = [{ id: 'session-one', title: '人物原文世界', updatedAt: stamp, save: Engine.exportSession(state), narratives: [{ id: 'n-one', turn: 1, text: '完整敘事', kind: 'local', createdAt: stamp, contextVersion: '1' }] }]; value.activeSessionId = 'session-one';
    const storage = new MemoryStorage(), imported = preview([{ key: WorldStorage.KEY, raw: JSON.stringify(value) }]);
    assert.equal(imported.summary.ready, 1); assert.equal(Vault.restoreLocal(Vault.planRestore(imported, { storage }), { storage }).ok, true);
    const restored = WorldStorage.validateWorkspace(JSON.parse(storage.getItem(WorldStorage.KEY))); assert.deepEqual(Engine.importSession(restored.sessions[0].save), state);
    assert.equal(restored.sessions[0].save.state.config.roster[0].analysisAnchors[0].quote, '完整原始人物分析摘錄');
    const tampered = structuredClone(value); tampered.sessions[0].save.state.resources.grain++;
    const rejected = preview([{ key: WorldStorage.KEY, raw: JSON.stringify(tampered) }]); assert.equal(rejected.summary.retained, 1); assert.equal(rejected.summary.ready, 0);
});
test('rollback never destroys a concurrent external version and supplies prior originals', () => {
    const storage = new MemoryStorage(), imported = preview([{ key: 'dynasty_court_grain_v1', raw: court() }, { key: 'dynasty_court_grain_v2', raw: court(2) }]);
    const plan = Vault.planRestore(imported, { storage });
    storage.beforeWrite = key => { if (key === 'dynasty_court_grain_v2') { storage.values.set('dynasty_court_grain_v1', 'external'); throw new Error('quota'); } };
    const result = Vault.restoreLocal(plan, { storage }); assert.equal(result.ok, false); assert.equal(result.rollbackComplete, false); assert.equal(storage.getItem('dynasty_court_grain_v1'), 'external'); assert(result.recovery.proposed.some(item => item.raw === court()));
});
