(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyWorldStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';
    const KEY = 'dynasty-world-workspace.v1', RECOVERY_KEY = 'dynasty-world-workspace.recovery.v1';
    const FORMAT = 'dynasty-world-workspace', MAX_BYTES = 8 * 1024 * 1024 - 100;
    const WORKSPACE_FIELDS = ['format', 'schemaVersion', 'sessions', 'activeSessionId', 'selection', 'notes', 'narratives'];
    const SESSION_FIELDS = ['id', 'title', 'updatedAt', 'save', 'narratives'];
    const NARRATIVE_FIELDS = ['id', 'turn', 'text', 'createdAt', 'kind', 'contextVersion'];
    let sessionValidator = null;
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
    const validText = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || !!value.trim());
    const validDate = value => validText(value, 80) && Number.isFinite(Date.parse(value));
    const fail = code => { const error = new Error(code); error.code = code; throw error; };
    function clone(value, depth = 0, ancestors = new Set()) {
        if (depth > 80) fail('WORLD_JSON_DEPTH');
        if (value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return value;
        if (!record(value) && !Array.isArray(value) || ancestors.has(value)) fail('WORLD_INVALID_JSON');
        if (Object.getOwnPropertySymbols(value).length || Array.isArray(value) && Object.keys(value).length !== value.length) fail('WORLD_INVALID_JSON');
        ancestors.add(value); const output = Array.isArray(value) ? [] : {};
        for (const key of Object.keys(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key) || key.includes('\0') || key.startsWith('$') || key.includes('.')) fail('WORLD_UNSAFE_KEY');
            const desc = Object.getOwnPropertyDescriptor(value, key); if (!desc || !own(desc, 'value')) fail('WORLD_INVALID_JSON');
            output[key] = clone(desc.value, depth + 1, ancestors);
        }
        ancestors.delete(value); return output;
    }
    function encoded(value) { const raw = JSON.stringify(value); if (raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES) fail('WORLD_SIZE_LIMIT'); return raw; }
    function decode(raw) { if (typeof raw !== 'string' || raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES) fail('WORLD_SIZE_LIMIT'); try { return clone(JSON.parse(raw)); } catch (error) { if (error.code) throw error; fail('WORLD_INVALID_JSON'); } }
    function narratives(items) {
        if (!Array.isArray(items) || items.length > 500) fail('WORLD_NARRATIVE_LIMIT'); const ids = new Set();
        for (const item of items) {
            if (!record(item) || Object.keys(item).some(key => !NARRATIVE_FIELDS.includes(key)) || !validText(item.id, 180) || ids.has(item.id) || !Number.isInteger(item.turn) || item.turn < 0 || item.turn > 100000 || !validText(item.text, 500000, true) || !validDate(item.createdAt) || !['ai', 'local'].includes(item.kind) || own(item, 'contextVersion') && !validText(item.contextVersion, 100)) fail('WORLD_INVALID_NARRATIVE');
            ids.add(item.id);
        }
    }
    function validateSelection(value) {
        const ids = (items, limit) => Array.isArray(items) && items.length <= limit && items.every(id => validText(id, 180)) && new Set(items).size === items.length;
        if (!record(value) || typeof value.enabled !== 'boolean' || !ids(value.recordIds, 12) || !validText(value.notes, 500000, true) || !record(value.setting) || !Array.isArray(value.anchors) || value.anchors.length > 40) fail('WORLD_INVALID_SELECTION');
        const setting = value.setting;
        if (!['free', 'historical', 'counterfactual'].includes(setting.kind) || setting.eventId !== null && !validText(setting.eventId, 180, true) || !ids(setting.placeIds, 40) || !ids(setting.factionIds, 40)) fail('WORLD_INVALID_SETTING');
        for (const anchor of value.anchors) {
            if (!record(anchor) || !['analysis', 'claim'].includes(anchor.kind) || own(anchor, 'interpretation') && !validText(anchor.interpretation, 20000, true) || own(anchor, 'quote') && !validText(anchor.quote, 2400, true) || own(anchor, 'principle') && !['none', 'care', 'order', 'bold', 'diplomacy', 'learning'].includes(anchor.principle)) fail('WORLD_INVALID_ANCHOR');
            if (anchor.kind === 'claim') { if (!validText(anchor.claimId, 180)) fail('WORLD_INVALID_ANCHOR'); }
            else if (!validText(anchor.recordId, 180) || !value.recordIds.includes(anchor.recordId) || !['deepAnalysis', 'analysis', 'soulEssence', 'desc'].includes(anchor.field) || !Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end - anchor.start > 2400 || anchor.end > 10000000) fail('WORLD_INVALID_ANCHOR');
        }
    }
    function validateWorkspace(input) {
        const value = clone(input);
        if (!record(value) || value.format !== FORMAT || value.schemaVersion !== 1 || Object.keys(value).some(key => !WORKSPACE_FIELDS.includes(key))) fail('WORLD_UNSUPPORTED_VERSION');
        if (!Array.isArray(value.sessions) || value.sessions.length > 12 || !record(value.selection)) fail('WORLD_INVALID_WORKSPACE');
        validateSelection(value.selection);
        const ids = new Set();
        for (const item of value.sessions) {
            if (!record(item) || Object.keys(item).sort().join(',') !== SESSION_FIELDS.slice().sort().join(',') || !validText(item.id, 180) || ids.has(item.id) || !validText(item.title, 300) || !validDate(item.updatedAt) || !record(item.save)) fail('WORLD_INVALID_SESSION');
            narratives(item.narratives);
            if (item.save.format !== 'dynasty-world-save' || item.save.version !== 1 || !record(item.save.state) || Object.keys(item.save).sort().join(',') !== 'format,state,version') fail('WORLD_UNSUPPORTED_SESSION_SAVE');
            if (sessionValidator) { const verdict = sessionValidator(item.save); if (verdict === false || verdict?.valid === false) fail('WORLD_INVALID_SESSION_SAVE'); }
            ids.add(item.id);
        }
        if (!own(value, 'activeSessionId') || value.activeSessionId !== null && !ids.has(value.activeSessionId)) fail('WORLD_INVALID_ACTIVE_SESSION');
        if (own(value, 'notes') && !validText(value.notes, 500000, true)) fail('WORLD_INVALID_NOTES');
        if (own(value, 'narratives')) narratives(value.narratives);
        encoded(value); return value;
    }
    function setSessionValidator(validate) { if (typeof validate !== 'function') fail('WORLD_INVALID_VALIDATOR'); sessionValidator = validate; }
    function emptyWorkspace() { return { format: FORMAT, schemaVersion: 1, sessions: [], activeSessionId: null, selection: { enabled: false, setting: { kind: 'free', eventId: '', placeIds: [], factionIds: [] }, recordIds: [], anchors: [], notes: '' } }; }
    function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'; return JSON.stringify(value); }
    function validateRecovery(input) {
        const value = clone(input);
        if (!record(value) || value.format !== 'dynasty-world-recoveries' || value.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > 24 || Object.keys(value).some(key => !['format', 'schemaVersion', 'entries'].includes(key))) fail('WORLD_RECOVERY_NEEDS_EXPORT');
        const ids = new Set();
        for (const item of value.entries) {
            if (!record(item) || Object.keys(item).some(key => !['id', 'savedAt', 'reason', 'raw', 'revision'].includes(key)) || !validText(item.id, 180) || ids.has(item.id) || !validDate(item.savedAt) || !validText(item.reason, 300) || typeof item.raw !== 'string' || item.raw.length > MAX_BYTES || item.revision !== null && (!Number.isSafeInteger(item.revision) || item.revision < 0)) fail('WORLD_RECOVERY_NEEDS_EXPORT'); ids.add(item.id);
        }
        encoded(value); return value;
    }
    function registerWithVault(vault) {
        vault.registerKey(KEY, { label: '共用世界', validate: validateWorkspace });
        vault.registerKey(RECOVERY_KEY, { label: '世界保留版本', validate: validateRecovery });
    }
    function create({ storage, readCloud, writeCloud, onStatus = () => {}, debounceMs = 500, now = () => new Date().toISOString() } = {}) {
        let workspace = emptyWorkspace(), localRaw = null, cloudWorkspace = null, cloudRaw = null, revision = null;
        let ready = false, blocked = false, dirty = false, running = false, state = 'local', message = '', timer = null, pending = null, generation = 0, sequence = 0, disposed = false, invalidLocal = false, invalidCloud = false;
        const memoryRecoveries = [];
        function readLocal() { if (!storage || typeof storage.getItem !== 'function') fail('WORLD_STORAGE_UNAVAILABLE'); return storage.getItem(KEY); }
        function snapshot() { return { state, message, ready, blocked, dirty, running, revision, localSaved: !invalidLocal, workspace: clone(workspace), cloudWorkspace: clone(cloudWorkspace), invalidLocal, invalidCloud, recoveryCount: memoryRecoveries.length }; }
        function emit(next, text = '') { state = next; message = text; try { onStatus(snapshot()); } catch (_) { /* A view failure must not alter persistence. */ } }
        function assertActive() { if (disposed) fail('WORLD_STORE_DISPOSED'); }
        function persist(value) {
            const raw = encoded(value);
            if (readLocal() !== localRaw) fail('WORLD_LOCAL_CONFLICT');
            storage.setItem(KEY, raw);
            if (readLocal() !== raw) fail('WORLD_LOCAL_WRITE_UNCONFIRMED');
            localRaw = raw; invalidLocal = false;
        }
        function preserve(raw, reason, atRevision = null) {
            if (raw === null) return;
            const item = { id: now() + ':' + (++sequence), savedAt: now(), reason, raw, revision: atRevision };
            if (!memoryRecoveries.some(entry => entry.raw === raw)) memoryRecoveries.push(item);
            const observed = storage.getItem(RECOVERY_KEY);
            const saved = observed === null ? { format: 'dynasty-world-recoveries', schemaVersion: 1, entries: [] } : validateRecovery(decode(observed));
            if (saved.entries.some(entry => entry.raw === raw)) return;
            if (saved.entries.length >= 24) fail('WORLD_RECOVERY_LIMIT_EXPORT_FIRST');
            while (saved.entries.some(entry => entry.id === item.id)) item.id = now() + ':' + (++sequence);
            saved.entries.push(item); const rawRecovery = encoded(saved);
            if (storage.getItem(RECOVERY_KEY) !== observed) fail('WORLD_RECOVERY_CONFLICT');
            storage.setItem(RECOVERY_KEY, rawRecovery);
        }
        function rememberConflict(reason) {
            let preserved = true;
            for (const [raw, version] of [[localRaw, null], [cloudRaw, revision]]) { try { preserve(raw, reason, version); } catch (_) { preserved = false; } }
            return preserved;
        }
        function initialiseLocal() {
            try { localRaw = readLocal(); if (localRaw !== null) workspace = validateWorkspace(decode(localRaw)); }
            catch (error) { invalidLocal = true; blocked = true; emit('local-invalid', '本機有新版本或無法驗證的原始存檔，請先下載保留。'); }
        }
        initialiseLocal();
        async function responseJSON(response) {
            if (response && typeof response.json === 'function') {
                if (!response.ok) { const error = new Error('HTTP ' + response.status); error.status = response.status; throw error; }
                return response.json();
            }
            return response;
        }
        function checkCloud(value) {
            if (!record(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !own(value, 'workspace')) fail('WORLD_INVALID_CLOUD_RESPONSE');
            revision = value.revision; cloudWorkspace = clone(value.workspace); cloudRaw = value.workspace === null ? null : encoded(value.workspace);
            try { if (value.workspace !== null) validateWorkspace(value.workspace); invalidCloud = false; }
            catch (_) { invalidCloud = true; }
        }
        async function load() {
            assertActive(); if (running) return { ok: false, code: 'WORLD_SAVE_RUNNING', ...snapshot() };
            const token = ++generation; clearTimeout(timer); timer = null; ready = false; emit('loading', '正在讀取共用世界雲端版本…');
            try {
                if (typeof readCloud !== 'function') fail('WORLD_CLOUD_UNAVAILABLE');
                const value = await responseJSON(await readCloud()); if (token !== generation || disposed) return { ok: false, code: 'WORLD_STALE_LOAD' };
                checkCloud(value); ready = true;
                if (invalidLocal || invalidCloud) { blocked = true; rememberConflict('保留無法啟用的版本'); emit('unsupported', '本機或雲端含較新／無法驗證的資料，兩份原件保留，暫停同步。'); return { ok: false, ...snapshot() }; }
                if (readLocal() !== localRaw) { blocked = true; emit('local-conflict', '其他視窗已修改本機世界，請重新讀取本機版本。'); return { ok: false, ...snapshot() }; }
                if (localRaw === null && cloudWorkspace !== null) { persist(cloudWorkspace); workspace = clone(cloudWorkspace); dirty = false; blocked = false; emit('synced', '共用世界已從雲端載入。'); }
                else if (cloudWorkspace === null) { blocked = false; dirty = localRaw !== null; emit(dirty ? 'local' : 'ready', dirty ? '本機世界已保留；雲端尚無存檔，可同步目前版本。' : '雲端已就緒，開始建立世界。'); }
                else if (canonical(workspace) === canonical(cloudWorkspace)) { blocked = false; dirty = false; emit('synced', '本機與雲端世界一致。'); }
                else { blocked = true; dirty = true; const kept = rememberConflict('本機與雲端內容不同'); emit('conflict', kept ? '本機與雲端都有進度，兩版已保留，請選擇接續版本。' : '本機與雲端都有進度；保留空間不足，請先下載完整備份。'); }
                return { ok: !blocked, ...snapshot() };
            } catch (error) { if (token !== generation || disposed) return { ok: false, code: 'WORLD_STALE_LOAD' }; ready = false; emit('offline', '雲端暫時無法讀取，本機進度保留。' + error.message); return { ok: false, code: error.code || 'WORLD_CLOUD_READ_FAILED', ...snapshot() }; }
        }
        function update(value, { autosave = true } = {}) {
            assertActive(); if (invalidLocal) fail('WORLD_LOCAL_REQUIRES_RECOVERY');
            const checked = validateWorkspace(value);
            try { persist(checked); }
            catch (error) { blocked = error.code === 'WORLD_LOCAL_CONFLICT' || blocked; emit(blocked ? 'local-conflict' : 'local-error', '本次修改未寫入本機；原進度保留。' + error.message); return { ok: false, code: error.code || 'WORLD_LOCAL_WRITE_FAILED', ...snapshot() }; }
            workspace = checked; dirty = true; sequence++;
            emit(blocked ? 'conflict' : 'local', blocked ? '修改已保存在本機；雲端版本尚待選擇。' : '修改已保存在本機。');
            if (autosave && ready && !blocked) { clearTimeout(timer); timer = setTimeout(() => { void flush(); }, debounceMs); }
            return { ok: true, ...snapshot() };
        }
        async function flush() {
            assertActive(); clearTimeout(timer); timer = null;
            if (pending) return pending;
            if (!ready || blocked || invalidLocal || invalidCloud) return false;
            if (!dirty) return true;
            running = true;
            pending = Promise.resolve().then(async () => {
                try {
                    while (dirty && ready && !blocked && !disposed) {
                        if (readLocal() !== localRaw) { blocked = true; emit('local-conflict', '另一個視窗已修改本機存檔，暫停同步。'); return false; }
                        const payload = clone(workspace), targetSequence = sequence, expected = revision;
                        emit('saving', '本機進度已保存，正在同步雲端…');
                        try {
                            if (typeof writeCloud !== 'function') fail('WORLD_CLOUD_UNAVAILABLE');
                            const ack = await responseJSON(await writeCloud({ revision: expected, workspace: payload }));
                            if (!ack || ack.status !== 'ok' || ack.revision !== expected + 1) { const error = new Error('雲端回覆無法確認'); error.status = 409; throw error; }
                            revision = ack.revision; cloudWorkspace = payload; cloudRaw = encoded(payload); dirty = targetSequence !== sequence;
                        } catch (error) {
                            dirty = true;
                            if (error.status === 409) {
                                blocked = true;
                                try { checkCloud(await responseJSON(await readCloud())); ready = true; } catch (_) { ready = false; }
                                const kept = rememberConflict('同步時發現雲端版本改變');
                                emit('conflict', kept ? '雲端已由其他視窗更新；兩版已保留，請選擇接續版本。' : '同步衝突；保留空間不足，請先下載兩版進度。');
                            } else { ready = false; emit('offline', '雲端未確認儲存，本機進度仍保留；重試會先重新讀取雲端。'); }
                            return false;
                        }
                    }
                    if (!dirty) emit('synced', '共用世界已同步至雲端。');
                    return !dirty && !blocked;
                } finally { running = false; pending = null; emit(state, message); }
            });
            return pending;
        }
        function reloadLocal() {
            assertActive(); if (running) fail('WORLD_SAVE_RUNNING'); clearTimeout(timer); timer = null; generation++;
            try {
                const raw = readLocal(), checked = raw === null ? emptyWorkspace() : validateWorkspace(decode(raw));
                if (raw !== localRaw) { try { preserve(localRaw, '重新讀取本機前的版本'); } catch (_) { fail('WORLD_RECOVERY_NEEDS_EXPORT'); } }
                localRaw = raw; workspace = checked; invalidLocal = false; dirty = true; blocked = true;
                emit('local-import', '已接回匯入的本機世界。確認接續本機或雲端版本後才會同步。'); return { ok: true, ...snapshot() };
            } catch (error) { invalidLocal = true; blocked = true; emit('local-invalid', '匯入的本機版本無法啟用，原始檔保留。'); return { ok: false, code: error.code || 'WORLD_LOCAL_READ_FAILED', ...snapshot() }; }
        }
        async function keepLocal() {
            assertActive(); if (running || !ready || invalidLocal || invalidCloud) return false;
            try { if (readLocal() !== localRaw) fail('WORLD_LOCAL_CONFLICT'); preserve(cloudRaw, '接續本機版本前的雲端版本', revision); }
            catch (error) { emit('recovery-error', '尚無法保留另一版本，請先下載完整備份。'); return false; }
            blocked = false; dirty = true; return flush();
        }
        function adoptCloud() {
            assertActive(); if (running || !ready || invalidCloud || invalidLocal) return { ok: false, code: 'WORLD_CLOUD_NOT_READY', ...snapshot() };
            try {
                const checked = cloudWorkspace === null ? emptyWorkspace() : validateWorkspace(cloudWorkspace);
                preserve(localRaw, '接續雲端版本前的本機版本'); persist(checked); workspace = checked; dirty = false; blocked = false;
                emit('synced', '已接續雲端版本；先前本機進度保留於復原紀錄。'); return { ok: true, ...snapshot() };
            } catch (error) { emit('recovery-error', '接續雲端未完成；本機原進度仍保留。' + error.message); return { ok: false, code: error.code || 'WORLD_LOCAL_WRITE_FAILED', ...snapshot() }; }
        }
        function captureRecovery() { let currentRaw = localRaw, persistedRecoveries = null; try { currentRaw = readLocal(); persistedRecoveries = storage.getItem(RECOVERY_KEY); } catch (_) { /* In-memory copies remain exportable. */ } return { format: 'dynasty-world-storage-recovery', schemaVersion: 1, exportedAt: now(), localRaw: currentRaw, memoryWorkspace: clone(workspace), cloudWorkspace: clone(cloudWorkspace), cloudRaw, revision, retained: clone(memoryRecoveries), persistedRecoveries }; }
        async function retry() { const loaded = await load(); if (!loaded.ok) return false; return dirty ? flush() : true; }
        function getRecoveries() { const raw = storage.getItem(RECOVERY_KEY); return raw === null ? [] : validateRecovery(decode(raw)).entries; }
        function restoreRecovery(id) {
            const entry = getRecoveries().find(item => item.id === id); if (!entry) fail('WORLD_RECOVERY_NOT_FOUND');
            const checked = validateWorkspace(decode(entry.raw)); preserve(localRaw, '接續保留版本前的本機進度');
            const result = update(checked, { autosave: false }); if (result.ok) { blocked = true; emit('local-import', '已接回保留版本，確認後才會同步雲端。'); }
            return { ...result, ...snapshot() };
        }
        return Object.freeze({ load, update, flush, retry, keepLocal, adoptCloud, reloadLocal, refreshLocal: reloadLocal, capture: () => clone(workspace), getState: snapshot, captureRecovery, getRecoveries, restoreRecovery, dispose() { clearTimeout(timer); timer = null; generation++; disposed = true; } });
    }
    return Object.freeze({ KEY, RECOVERY_KEY, FORMAT, MAX_BYTES, emptyWorkspace, validateWorkspace, validateRecovery, setSessionValidator, registerWithVault, create });
});
