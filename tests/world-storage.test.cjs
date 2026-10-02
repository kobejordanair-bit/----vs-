'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const World = require('../backend/static/js/world-storage.js');
class Storage {
    constructor(value = null) { this.items = new Map(); if (value !== null) this.items.set(World.KEY, typeof value === 'string' ? value : JSON.stringify(value)); this.fail = null; }
    getItem(key) { return this.items.get(key) ?? null; }
    setItem(key, value) { if (this.fail) this.fail(key); this.items.set(key, value); }
    removeItem(key) { this.items.delete(key); }
}
function workspace(note = '') { const value = World.emptyWorkspace(); value.selection.notes = note; return value; }
function cloud(initial = null) { let current = initial, revision = 0; const writes = []; return { writes, get revision() { return revision; }, set(value) { current = value; revision++; }, async read() { return { revision, workspace: structuredClone(current) }; }, async write(body) { writes.push(body); if (body.revision !== revision) return { ok: false, status: 409, json: async () => ({}) }; current = structuredClone(body.workspace); return { status: 'ok', revision: ++revision }; } }; }
function store(local, remote, options = {}) { return World.create({ storage: local, readCloud: remote.read, writeCloud: remote.write, debounceMs: 10000, ...options }); }
test('updates save locally before any cloud read; successful empty cloud never erases local progress', async () => {
    const local = new Storage(), remote = cloud(), saved = store(local, remote);
    assert.equal(saved.update(workspace('原文錨點已選'), { autosave: false }).ok, true); assert.equal(await saved.flush(), false); assert.equal(remote.writes.length, 0);
    assert.equal((await saved.load()).ok, true); assert.equal(saved.capture().selection.notes, '原文錨點已選'); assert.equal(await saved.flush(), true); assert.equal(remote.writes.length, 1); assert.equal(saved.getState().running, false); saved.dispose();
});
test('cloud data loads only when local absent; different versions wait for explicit choice', async () => {
    const remote = cloud(workspace('雲端')), empty = store(new Storage(), remote);
    assert.equal((await empty.load()).ok, true); assert.equal(empty.capture().selection.notes, '雲端'); empty.dispose();
    const local = new Storage(workspace('本機')), saved = store(local, remote); assert.equal((await saved.load()).ok, false); assert.equal(saved.getState().state, 'conflict');
    assert.equal(saved.capture().selection.notes, '本機'); assert.equal(await saved.flush(), false); assert.equal(remote.writes.length, 0);
    assert.equal(saved.getRecoveries().length, 2); assert.equal(saved.adoptCloud().ok, true); assert.equal(saved.capture().selection.notes, '雲端'); assert(saved.getRecoveries().some(entry => JSON.parse(entry.raw).selection.notes === '本機')); saved.dispose();
});
test('explicit keepLocal writes latest loaded revision and preserves cloud version', async () => {
    const remote = cloud(workspace('雲端')), saved = store(new Storage(workspace('本機')), remote);
    await saved.load(); assert.equal(await saved.keepLocal(), true); assert.equal(remote.writes[0].revision, 0); assert.equal(remote.writes[0].workspace.selection.notes, '本機'); assert(saved.getRecoveries().some(entry => JSON.parse(entry.raw).selection.notes === '雲端')); saved.dispose();
});
test('409 after concurrent cloud changes preserves both versions and refuses autosave', async () => {
    const remote = cloud(), saved = store(new Storage(), remote); await saved.load(); saved.update(workspace('本機新局'), { autosave: false }); remote.set(workspace('其他分頁'));
    assert.equal(await saved.flush(), false); assert.equal(saved.getState().state, 'conflict'); assert.equal(saved.getState().revision, 1); assert.equal(saved.capture().selection.notes, '本機新局');
    assert(saved.getRecoveries().some(entry => JSON.parse(entry.raw).selection.notes === '其他分頁')); assert.equal(await saved.flush(), false); assert.equal(remote.writes.length, 1); saved.dispose();
});
test('network failure permits continued local play; retry first reads and detects an unknown successful write', async () => {
    const remote = cloud(), saved = store(new Storage(), remote, { writeCloud: async body => { await remote.write(body); throw new Error('connection lost after commit'); } });
    await saved.load(); saved.update(workspace('已送但失去回覆'), { autosave: false }); assert.equal(await saved.flush(), false); assert.equal(saved.getState().ready, false); assert.equal(await saved.retry(), true); assert.equal(saved.getState().state, 'synced'); assert.equal(remote.writes.length, 1); saved.dispose();
});
test('changes during an in-flight write drain in order using the acknowledged revision', async () => {
    const remote = cloud(); let release; const gate = new Promise(resolve => { release = resolve; }); let writes = 0;
    const saved = store(new Storage(), remote, { writeCloud: async body => { if (++writes === 1) await gate; return remote.write(body); } });
    await saved.load(); saved.update(workspace('一'), { autosave: false }); const flushing = saved.flush(); await Promise.resolve(); saved.update(workspace('二'), { autosave: false }); release();
    assert.equal(await flushing, true); assert.deepEqual(remote.writes.map(item => [item.revision, item.workspace.selection.notes]), [[0, '一'], [1, '二']]); assert.equal(saved.getState().dirty, false); saved.dispose();
});
test('quota failure does not apply unpersisted local changes', async () => {
    const local = new Storage(workspace('原稿')), saved = store(local, cloud()); local.fail = () => { throw new Error('QuotaExceededError'); };
    const result = saved.update(workspace('不應丟原稿')); assert.equal(result.ok, false); assert.equal(saved.capture().selection.notes, '原稿'); assert.equal(JSON.parse(local.getItem(World.KEY)).selection.notes, '原稿'); saved.dispose();
});
test('future local and cloud envelopes remain recoverable and block all replacement', async () => {
    const future = { ...workspace('future'), schemaVersion: 2, future: { original: true } };
    const local = new Storage(future), saved = store(local, cloud(workspace('cloud'))); await saved.load(); assert.equal(saved.getState().invalidLocal, true); assert.equal(await saved.keepLocal(), false); assert.equal(saved.adoptCloud().ok, false); assert.equal(JSON.parse(saved.captureRecovery().localRaw).schemaVersion, 2); saved.dispose();
    const second = store(new Storage(workspace('local')), cloud(future)); await second.load(); assert.equal(second.getState().invalidCloud, true); assert.equal(await second.keepLocal(), false); assert.equal(second.captureRecovery().cloudWorkspace.future.original, true); second.dispose();
});
test('vault refresh adopts imported local data without synchronizing it until keepLocal', async () => {
    const remote = cloud(workspace('原版')), local = new Storage(workspace('原版')), saved = store(local, remote); await saved.load(); local.setItem(World.KEY, JSON.stringify(workspace('匯入版')));
    assert.equal(saved.reloadLocal().ok, true); assert.equal(saved.getState().state, 'local-import'); assert.equal(saved.capture().selection.notes, '匯入版'); assert.equal(await saved.flush(), false); assert.equal(remote.writes.length, 0); assert.equal(await saved.keepLocal(), true); assert.equal(remote.writes[0].workspace.selection.notes, '匯入版'); saved.dispose();
});
test('external local edits are never overwritten by update or flush', async () => {
    const remote = cloud(), local = new Storage(), saved = store(local, remote); await saved.load(); saved.update(workspace('local'), { autosave: false }); local.setItem(World.KEY, JSON.stringify(workspace('external')));
    assert.equal(saved.update(workspace('would overwrite'), { autosave: false }).ok, false); assert.equal(await saved.flush(), false); assert.equal(JSON.parse(local.getItem(World.KEY)).selection.notes, 'external'); assert.equal(remote.writes.length, 0); saved.dispose();
});
test('restoring a preserved world retains current work and requires explicit synchronization', async () => {
    const remote = cloud(workspace('cloud')), saved = store(new Storage(workspace('local')), remote); await saved.load(); saved.adoptCloud();
    const recovery = saved.getRecoveries().find(item => JSON.parse(item.raw).selection.notes === 'local'); assert.equal(saved.restoreRecovery(recovery.id).ok, true); assert.equal(saved.capture().selection.notes, 'local'); assert.equal(saved.getState().blocked, true); assert.equal(await saved.flush(), false); saved.dispose();
});
test('workspace schema preserves selection extensions but rejects unknown envelope/session versions', () => {
    const value = workspace(); value.selection.futureContext = { original: ['保留'] }; assert.deepEqual(World.validateWorkspace(value), value);
    assert.throws(() => World.validateWorkspace({ ...value, unsupported: true }), /WORLD_UNSUPPORTED_VERSION/);
    value.sessions = [{ id: 'w', title: '世界', updatedAt: '2026-10-02T00:00:00Z', save: { format: 'dynasty-world-save', version: 2, state: {} }, narratives: [] }]; value.activeSessionId = 'w';
    assert.throws(() => World.validateWorkspace(value), /WORLD_UNSUPPORTED_SESSION_SAVE/);
});
test('flush claims the running lock synchronously so a simultaneous import/load cannot replace its state', async () => {
    const remote = cloud(), saved = store(new Storage(), remote); await saved.load(); saved.update(workspace('queued'), { autosave: false });
    const pending = saved.flush(); assert.equal(saved.getState().running, true); assert.throws(() => saved.reloadLocal(), /WORLD_SAVE_RUNNING/); assert.equal((await saved.load()).code, 'WORLD_SAVE_RUNNING');
    assert.equal(await pending, true); saved.dispose();
});
test('malformed selection cannot enter local or cloud state while unknown record IDs remain intact', () => {
    for (const patch of [{}, { enabled: 'yes' }, { recordIds: ['duplicate', 'duplicate'] }, { recordIds: Array.from({ length: 13 }, (_, i) => 'id-' + i) }, { anchors: [{ kind: 'analysis', recordId: 'missing', field: 'analysis', start: 0, end: 5 }] }, { setting: { kind: 'free' } }, { notes: {} }]) {
        const value = workspace(); value.selection = Object.keys(patch).length ? { ...value.selection, ...patch } : {};
        assert.throws(() => World.validateWorkspace(value), /WORLD_INVALID_(SELECTION|SETTING|ANCHOR)/);
    }
    const preserved = workspace(); preserved.selection.recordIds = ['unknown-to-current-library']; preserved.selection.anchors = [{ kind: 'analysis', recordId: 'unknown-to-current-library', field: 'deepAnalysis', start: 10, end: 18, quote: '原始引用', principle: 'care', interpretation: '玩家解讀' }];
    assert.deepEqual(World.validateWorkspace(preserved), preserved);
    for (const patch of [{ end: 0 }, { start: -1 }, { field: 'unsupported' }, { principle: 'unsupported' }, { quote: 1 }]) {
        const value = structuredClone(preserved); Object.assign(value.selection.anchors[0], patch); assert.throws(() => World.validateWorkspace(value), /WORLD_INVALID_ANCHOR/);
    }
});
