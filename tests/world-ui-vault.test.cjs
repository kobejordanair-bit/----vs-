'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, boot, click, change, until, synthetic } = require('./helpers/world-dom.cjs');
const World = require('../backend/static/js/world-engine.js');
const Storage = require('../backend/static/js/world-storage.js');
const Backup = require('../backend/static/js/backup.js');
const Court = require('../backend/static/js/court-engine.js');
const Council = require('../backend/static/js/court-council.js');
const stamp = '2026-10-02T08:00:00.000Z';
const json = value => JSON.stringify(value);
function workspace(note = '') {
    const value = Storage.emptyWorkspace(); value.selection.notes = note; value.selection.recordIds = synthetic.slice(0, 2).map(item => item.id);
    let state = World.createSession({ mode: 'hegemony', seed: note || 'one', roster: synthetic.slice(0, 2).map(item => ({ recordId: item.id, name: item.name, type: item.type, stats: item.stats })) });
    state = World.resolveTurn(state, World.defaultOrder(state));
    value.sessions = [{ id: 'saved-world', title: '原文試局 ' + note, updatedAt: stamp, save: World.exportSession(state), narratives: [{ id: 'n-one', turn: 1, text: '完整已存敘事 ' + note, kind: 'local', createdAt: stamp }] }]; value.activeSessionId = 'saved-world'; return value;
}
function mainBackup() { const data = Backup.emptyData(); data.customLegends = [{ id: 'private-original', name: '測試原文', type: 'general', rank: 'A', deepAnalysis: '完整私人分析，不寫入公開靜態資料。' }]; return Backup.createBackup(data); }
function bundle(entries = [], main = null) { return { format: 'dynasty-workspace-vault', schemaVersion: 1, exportedAt: stamp, mainBackup: main, localEntries: entries }; }
function court(version = 1) { const engine = version === 1 ? Court : Council; return json({ format: 'dynasty-court-save', version, scenario: 'court-grain-v' + version, state: engine.createGame(), presentOutcome: false }); }
async function upload(ui, value, selector = '#w-vault-file') {
    const input = ui.document.querySelector(selector), raw = typeof value === 'string' ? value : json(value); assert(input, 'file input must be visible');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'test-backup.json', size: Buffer.byteLength(raw), text: async () => raw }] });
    input.dispatchEvent(new ui.window.Event('change', { bubbles: true })); await until(() => !ui.document.querySelector('#world-workbench').hasAttribute('aria-busy'));
}
const domTest = (name, fn) => test(name, { skip: !JSDOM }, fn);

domTest('vault UI preserves current world, recovers imported engine save, and requires explicit cloud sync', async () => {
    const original = workspace('目前'), incoming = workspace('匯入'), ui = await boot({ local: original, cloud: original });
    try {
        await click(ui, '[data-view="backup"]'); await upload(ui, bundle([{ key: Storage.KEY, raw: json(incoming) }]));
        assert(ui.document.querySelector('[data-action="restore-preserve"]')); assert.equal(ui.workspace().selection.notes, '目前');
        await click(ui, '[data-action="restore-preserve"]'); assert.equal(ui.workspace().selection.notes, '目前');
        assert.equal(ui.requests.filter(item => item.options.method === 'POST').length, 0); assert(ui.downloads.length >= 1);
        await click(ui, '[data-action="vault-recovery"]'); await click(ui, '[data-action="restore-replace"]');
        assert.equal(ui.workspace().selection.notes, '匯入'); assert.deepEqual(World.importSession(ui.workspace().sessions[0].save), World.importSession(incoming.sessions[0].save));
        assert.equal(ui.requests.filter(item => item.options.method === 'POST').length, 0); assert(ui.document.querySelector('[data-action="sync-local"]'));
        await click(ui, '[data-action="sync-local"]'); const posted = ui.requests.filter(item => item.options.method === 'POST'); assert.equal(posted.length, 1); assert.equal(JSON.parse(posted[0].options.body).workspace.selection.notes, '匯入');
    } finally { ui.close(); }
});
domTest('classic backup uses its original confirmation path with complete private text and no local overwrite', async () => {
    const ui = await boot();
    try {
        await click(ui, '[data-view="backup"]'); const main = mainBackup(); await upload(ui, main);
        assert.match(ui.document.querySelector('#w-content').textContent, /包含人物館主備份/); assert.equal(ui.workspace(), null);
        await click(ui, '[data-action="restore-main"]'); assert.equal(ui.legacy.length, 1); assert.deepEqual(JSON.parse(json(ui.legacy[0].backup)), main);
        assert.equal(ui.legacy[0].backup.data.customLegends[0].deepAnalysis, '完整私人分析，不寫入公開靜態資料。'); assert.equal(ui.requests.filter(item => item.options.method === 'POST').length, 0);
    } finally { ui.close(); }
});
domTest('a court-only restore does not mark an unchanged world as pending conflict', async () => {
    const original = workspace('同步中'), ui = await boot({ local: original, cloud: original });
    try {
        await click(ui, '[data-view="backup"]'); await upload(ui, bundle([{ key: 'dynasty_court_grain_v1', raw: court() }])); await click(ui, '[data-action="restore-replace"]');
        assert.equal(ui.window.localStorage.getItem('dynasty_court_grain_v1'), court()); assert.equal(ui.document.querySelector('[data-action="sync-local"]'), null); assert.equal(ui.workspace().selection.notes, '同步中');
    } finally { ui.close(); }
});
domTest('background autosave conflict shows recovery controls without losing the current form input', async () => {
    const original = workspace('原本'), remote = workspace('他處'); let reads = 0;
    const ui = await boot({ local: original, cloud: original, fetchHook: async (url, options, window) => {
        if (url !== '/api/world-workspace') return null;
        if (options.method === 'POST') return { ok: false, status: 409, json: async () => ({}) };
        if (++reads > 1) return { ok: true, status: 200, json: async () => window.JSON.parse(json({ revision: 9, workspace: remote })) };
        return null;
    } });
    try {
        await click(ui, '[data-view="setup"]'); await change(ui, '#w-notes', '本機新筆記'); const before = ui.document.querySelector('#w-notes');
        await until(() => !!ui.document.querySelector('[data-action="sync-cloud"]')); assert.equal(ui.document.querySelector('#w-notes'), before); assert.equal(before.value, '本機新筆記'); assert.equal(ui.workspace().selection.notes, '本機新筆記');
        assert.match(ui.document.querySelector('#w-sync-panel').textContent, /版本|兩版/);
    } finally { ui.close(); }
});
domTest('restore quota failure rolls back UI data and downloads a complete failure recovery', async () => {
    const ui = await boot();
    try {
        await click(ui, '[data-view="backup"]'); await upload(ui, bundle([{ key: 'dynasty_court_grain_v1', raw: court() }, { key: 'dynasty_court_grain_v2', raw: court(2) }]));
        const proto = ui.window.Storage.prototype, write = proto.setItem; proto.setItem = function (key, value) { if (key === 'dynasty_court_grain_v2') throw new ui.window.DOMException('full', 'QuotaExceededError'); return write.call(this, key, value); };
        await click(ui, '[data-action="restore-replace"]');
        assert.equal(ui.window.localStorage.getItem('dynasty_court_grain_v1'), null); assert.equal(ui.window.localStorage.getItem('dynasty_court_grain_v2'), null); assert.match(ui.document.querySelector('#w-notice').textContent, /已回復/);
        assert(ui.downloads.some(blob => json(blob.parts).includes('dynasty-workspace-rollback')));
    } finally { ui.close(); }
});
domTest('busy classic-data gate blocks full exports while a separate world recovery remains downloadable', async () => {
    const ui = await boot({ adapters: { canBackup: () => false } });
    try {
        await click(ui, '[data-view="backup"]'); await click(ui, '[data-action="export-all"]'); assert.equal(ui.downloads.length, 0); assert.match(ui.document.querySelector('#w-notice').textContent, /生成或還原完成/);
        await click(ui, '[data-action="recovery-export"]'); assert.equal(ui.downloads.length, 1);
    } finally { ui.close(); }
});
domTest('damaged recovery archives still allow users to export their original contents', async () => {
    const ui = await boot();
    try {
        ui.window.localStorage.setItem('dynasty_workspace_recovery_v1', '{original broken archive'); ui.window.localStorage.setItem(Storage.RECOVERY_KEY, '{broken world archive');
        await click(ui, '[data-view="backup"]'); assert.match(ui.document.querySelector('#w-content').textContent, /原件仍保留/); await click(ui, '[data-action="export-all"]');
        const exported = JSON.parse(ui.downloads[0].parts.join('')); assert(exported.localEntries.some(item => item.raw === '{original broken archive')); assert(exported.localEntries.some(item => item.raw === '{broken world archive'));
        await click(ui, '[data-view="saves"]'); assert.match(ui.document.querySelector('#w-content').textContent, /世界復原區含新版本/); assert(ui.document.querySelector('[data-action="recovery-export"]'));
    } finally { ui.close(); }
});
domTest('unknown session bundle fields are rejected and do not become a new playable world', async () => {
    const ui = await boot();
    try {
        await click(ui, '[data-view="saves"]'); const source = workspace('future').sessions[0];
        await upload(ui, { format: 'dynasty-world-session-bundle', schemaVersion: 1, exportedAt: stamp, session: source, futureField: 'must retain in original file' }, '#w-session-file');
        assert.equal(ui.workspace(), null); assert.match(ui.document.querySelector('#w-notice').textContent, /新版欄位/);
    } finally { ui.close(); }
});
