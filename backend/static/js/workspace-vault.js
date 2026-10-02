(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyWorkspaceVault = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';
    const FORMAT = 'dynasty-workspace-vault', SCHEMA_VERSION = 1;
    const RECOVERY_KEY = 'dynasty_workspace_recovery_v1';
    const WORLD_KEY = 'dynasty-world-workspace.v1';
    const LIMITS = Object.freeze({ bundleBytes: 128 * 1024 * 1024, entryBytes: 16 * 1024 * 1024, entries: 250, recoveries: 200 });
    const COURTS = Object.freeze({ dynasty_court_grain_v1: ['court-grain-v1', 1, 'DynastyCourt'], dynasty_court_grain_v2: ['court-grain-v2', 2, 'DynastyCouncil'], dynasty_court_grain_v3: ['court-grain-v3', 3, 'DynastyCampaign'] });
    const registry = new Map(), previews = new WeakMap(), plans = new WeakMap();
    const HISTORY = /^dynasty-history-investigation\.v([1-9]\d*)\.([A-Za-z0-9:._-]{1,150})$/;
    const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
    function fail(code) { const error = new Error(code); error.code = code; throw error; }
    function bytes(text) { return new TextEncoder().encode(text).length; }
    function bounded(text, maximum = LIMITS.entryBytes) { if (typeof text !== 'string' || text.length > maximum || bytes(text) > maximum) fail('VAULT_SIZE_LIMIT'); return text; }
    function copy(value, depth = 0, seen = new Set()) {
        if (depth > 100) fail('VAULT_JSON_DEPTH');
        if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return value;
        if (!Array.isArray(value) && !record(value)) fail('VAULT_INVALID_JSON_VALUE');
        if (seen.has(value)) fail('VAULT_CYCLIC_VALUE');
        seen.add(value);
        const result = Array.isArray(value) ? [] : {};
        if (Object.getOwnPropertySymbols(value).length || (Array.isArray(value) && Object.keys(value).length !== value.length)) fail('VAULT_INVALID_JSON_VALUE');
        for (const key of Object.keys(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('VAULT_UNSAFE_KEY');
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !own(descriptor, 'value')) fail('VAULT_INVALID_JSON_VALUE');
            result[key] = copy(descriptor.value, depth + 1, seen);
        }
        seen.delete(value); return result;
    }
    function parse(raw, maximum = LIMITS.bundleBytes) { if (typeof raw !== 'string') return copy(raw); bounded(raw, maximum); try { return copy(JSON.parse(raw.replace(/^\uFEFF/, ''))); } catch (error) { if (error.code) throw error; fail('VAULT_INVALID_JSON'); } }
    function timestamp(now) { const result = typeof now === 'function' ? now() : now || new Date().toISOString(); if (typeof result !== 'string' || !Number.isFinite(Date.parse(result))) fail('VAULT_INVALID_DATE'); return result; }
    function allowed(key) { return typeof key === 'string' && (own(COURTS, key) || HISTORY.test(key) || key === WORLD_KEY || key === RECOVERY_KEY || registry.has(key)); }
    function registerKey(key, settings = {}) {
        if (typeof key !== 'string' || key.length > 180 || !/^dynasty[-_](?:world|workspace|interpretation|selected[-_]context)[A-Za-z0-9:._-]*$/.test(key) || /token|secret|password|credential/i.test(key) || registry.size >= 16) fail('VAULT_KEY_NOT_ALLOWED');
        if (settings.validate !== undefined && typeof settings.validate !== 'function') fail('VAULT_INVALID_VALIDATOR');
        registry.set(key, { label: settings.label || key, validate: settings.validate });
    }
    function checkStorage(storage) { if (!storage || !['getItem', 'setItem', 'removeItem', 'key'].every(key => typeof storage[key] === 'function')) fail('VAULT_STORAGE_UNAVAILABLE'); }
    function recoveryValue(raw) {
        if (raw === null) return { format: 'dynasty-workspace-recoveries', schemaVersion: 1, entries: [] };
        const value = parse(raw, LIMITS.entryBytes);
        if (!record(value) || value.format !== 'dynasty-workspace-recoveries' || value.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > LIMITS.recoveries || Object.keys(value).some(key => !['format', 'schemaVersion', 'entries'].includes(key))) fail('VAULT_RECOVERY_NEEDS_EXPORT');
        const ids = new Set();
        for (const item of value.entries) {
            if (!record(item) || Object.keys(item).some(key => !['id', 'savedAt', 'reason', 'key', 'raw'].includes(key)) || typeof item.id !== 'string' || item.id.length > 160 || ids.has(item.id) || typeof item.reason !== 'string' || item.reason.length > 300 || !Number.isFinite(Date.parse(item.savedAt)) || !(allowed(item.key) || ['$bundle', '$main'].includes(item.key))) fail('VAULT_RECOVERY_NEEDS_EXPORT');
            ids.add(item.id); bounded(item.raw, LIMITS.bundleBytes);
        }
        return value;
    }
    function statusOf(entry, validators = {}) {
        let value;
        try { value = parse(entry.raw, LIMITS.entryBytes); } catch (_) { return { status: 'retained', reason: '無法解析的舊內容，僅封存' }; }
        try {
            if (entry.key === RECOVERY_KEY) { recoveryValue(entry.raw); return { status: 'recoveries', reason: '先前保留版本' }; }
            if (entry.key === WORLD_KEY) {
                const validator = validators[entry.key] || root.DynastyWorldStorage?.validateWorkspace || registry.get(entry.key)?.validate;
                if (!validator) return { status: 'retained', reason: '世界存檔驗證程式尚未載入，僅封存' };
                const verdict = validator(value); if (verdict === false || verdict?.valid === false) throw new Error('invalid');
            } else if (own(COURTS, entry.key)) {
                const [scenario, version, engineName] = COURTS[entry.key];
                if (!record(value) || value.format !== 'dynasty-court-save' || value.version !== version || value.scenario !== scenario || typeof value.presentOutcome !== 'boolean' || !record(value.state) || Object.keys(value).sort().join(',') !== 'format,presentOutcome,scenario,state,version') throw new Error('invalid');
                const validator = validators[entry.key] || root[engineName]?.validateState;
                if (!validator) return { status: 'retained', reason: '朝堂存檔驗證程式尚未載入，僅封存' };
                if (!validator(value.state) || (value.presentOutcome && !value.state.log.length)) throw new Error('invalid');
            } else if (HISTORY.test(entry.key)) {
                const match = entry.key.match(HISTORY), packageId = match[2].replace(/\.preserved-\d+-\d+$/, '');
                if (match[1] !== '1' || !record(value) || value.format !== 'dynasty-history-investigation' || value.schemaVersion !== 1 || value.packageId !== packageId || !Array.isArray(value.cases) || !record(value.workspace) || !Array.isArray(value.recoveries) || typeof value.activeCaseId !== 'string' || !value.cases.some(item => item?.caseId === value.activeCaseId) || !Number.isFinite(Date.parse(value.updatedAt)) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('invalid');
                if (value.cases.some(item => !record(item) || !['answers', 'materials', 'openedClaimIds', 'archive'].every(key => Array.isArray(item[key])) || !['thesis', 'counterargument', 'uncertainty'].every(key => typeof item[key] === 'string'))) throw new Error('invalid');
                if (validators[entry.key]) { const verdict = validators[entry.key](value); if (verdict === false || verdict?.valid === false) throw new Error('invalid'); }
            } else {
                const validator = validators[entry.key] || registry.get(entry.key)?.validate;
                if (!validator) return { status: 'retained', reason: '未提供此資料的驗證程式，僅封存' };
                const verdict = validator(value); if (verdict === false || verdict?.valid === false) throw new Error('invalid');
            }
            return { status: 'ready', reason: '' };
        } catch (_) { return { status: 'retained', reason: '新版本或內容驗證未通過，保留原文且不啟用' }; }
    }
    function capture({ storage, mainBackup, now } = {}) {
        checkStorage(storage);
        const localEntries = [], keys = new Set([...Object.keys(COURTS), WORLD_KEY, RECOVERY_KEY, ...registry.keys()]);
        for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (allowed(key)) keys.add(key); }
        for (const key of [...keys].sort()) { const raw = storage.getItem(key); if (raw !== null) { bounded(raw); localEntries.push({ key, raw }); } }
        if (localEntries.length > LIMITS.entries) fail('VAULT_ENTRY_LIMIT');
        const result = { format: FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: timestamp(now), mainBackup: mainBackup === undefined ? null : copy(mainBackup), localEntries };
        bounded(JSON.stringify(result), LIMITS.bundleBytes); return result;
    }
    function importPreview(raw, { backupApi = root.DynastyBackup, currentData, validators = {} } = {}) {
        try {
            const value = parse(raw); bounded(JSON.stringify(value), LIMITS.bundleBytes);
            if (!record(value) || value.format !== FORMAT || !Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1) fail('VAULT_UNKNOWN_FORMAT');
            const warnings = [], entries = []; let mainParsed = null, mainBackup = null, retainedEnvelope = null, retainedMain = null;
            if (value.schemaVersion > SCHEMA_VERSION || Object.keys(value).some(key => !['format', 'schemaVersion', 'exportedAt', 'mainBackup', 'localEntries'].includes(key))) {
                retainedEnvelope = JSON.stringify(value); warnings.push('此整合備份包含目前不支援的版本或欄位，將完整封存，不覆蓋現有進度。');
            } else {
                timestamp(value.exportedAt);
                if (!Array.isArray(value.localEntries) || value.localEntries.length > LIMITS.entries) fail('VAULT_ENTRY_LIMIT');
                const seen = new Set();
                for (const item of value.localEntries) {
                    if (!record(item) || Object.keys(item).sort().join(',') !== 'key,raw' || !allowed(item.key) || seen.has(item.key)) fail('VAULT_KEY_NOT_ALLOWED');
                    seen.add(item.key); bounded(item.raw); const entry = { key: item.key, raw: item.raw, ...statusOf(item, validators) }; entries.push(entry);
                    if (entry.status === 'retained') warnings.push(item.key + '：' + entry.reason);
                }
                if (value.mainBackup !== null && value.mainBackup !== undefined) {
                    if (!backupApi || typeof backupApi.parseBackup !== 'function') fail('VAULT_MAIN_VALIDATOR_UNAVAILABLE');
                    try { mainParsed = backupApi.parseBackup(value.mainBackup, currentData); mainBackup = value.mainBackup; }
                    catch (error) {
                        if (!['FUTURE_APP_VERSION', 'UNSUPPORTED_SCHEMA_VERSION', 'UNKNOWN_BACKUP_FIELD', 'UNKNOWN_DATA_FIELD'].includes(error.code)) throw error;
                        retainedMain = JSON.stringify(value.mainBackup); warnings.push('主程式備份含較新版本內容，原件已封存，不覆蓋現有雲端資料。');
                    }
                }
            }
            const summary = { localEntries: entries.length, ready: entries.filter(item => item.status === 'ready').length, retained: entries.filter(item => item.status === 'retained').length + Number(!!retainedEnvelope) + Number(!!retainedMain), hasMainBackup: !!mainBackup };
            const preview = { ok: true, errors: [], warnings, mainBackup: copy(mainBackup), mainParsed, localEntries: copy(entries), summary };
            previews.set(preview, { entries, mainBackup, retainedEnvelope, retainedMain }); return preview;
        } catch (error) { return { ok: false, errors: [error.code || error.message], warnings: [], mainBackup: null, mainParsed: null, localEntries: [], summary: null }; }
    }
    function planRestore(preview, { storage, strategy = 'preserve', now } = {}) {
        checkStorage(storage); if (!previews.has(preview) || !['preserve', 'replace'].includes(strategy)) fail('VAULT_INVALID_PREVIEW');
        const source = previews.get(preview), before = new Map(), after = new Map(), actions = [], stamp = timestamp(now);
        const observe = key => { if (!before.has(key)) before.set(key, storage.getItem(key)); return before.get(key); };
        let recovery = null, sequence = 0;
        function retain(key, raw, reason) {
            if (!recovery) recovery = recoveryValue(observe(RECOVERY_KEY));
            if (recovery.entries.some(item => item.key === key && item.raw === raw)) return;
            if (recovery.entries.length >= LIMITS.recoveries) fail('VAULT_RECOVERY_LIMIT_EXPORT_FIRST');
            let id; do { id = stamp + ':' + (++sequence); } while (recovery.entries.some(item => item.id === id));
            recovery.entries.push({ id, savedAt: stamp, reason, key, raw }); actions.push({ key, kind: 'retained', reason });
        }
        if (source.retainedEnvelope) retain('$bundle', source.retainedEnvelope, '保留較新整合備份');
        if (source.retainedMain) retain('$main', source.retainedMain, '保留較新主程式備份');
        for (const entry of source.entries) {
            const current = observe(entry.key); if (current === entry.raw) { actions.push({ key: entry.key, kind: 'unchanged' }); continue; }
            if (entry.status === 'recoveries') { const incoming = recoveryValue(entry.raw); incoming.entries.forEach(item => retain(item.key, item.raw, item.reason)); continue; }
            if (entry.status !== 'ready') { retain(entry.key, entry.raw, entry.reason); continue; }
            if (current !== null && strategy === 'preserve') { retain(entry.key, entry.raw, '匯入版本與目前工作不同，目前工作優先'); continue; }
            if (current !== null) retain(entry.key, current, '接續匯入版本前的本機工作');
            after.set(entry.key, entry.raw); actions.push({ key: entry.key, kind: current === null ? 'added' : 'replaced' });
        }
        if (recovery) { const raw = JSON.stringify(recovery); bounded(raw); after.set(RECOVERY_KEY, raw); }
        for (const [key, raw] of before) if (raw !== null) bounded(raw);
        const writes = [...after].sort(([a], [b]) => (a === RECOVERY_KEY ? -1 : b === RECOVERY_KEY ? 1 : a.localeCompare(b)));
        const plan = { strategy, actions: copy(actions), mainBackup: copy(source.mainBackup), summary: { writes: writes.length, retained: actions.filter(action => action.kind === 'retained').length, changed: actions.filter(action => ['added', 'replaced'].includes(action.kind)).length } };
        plans.set(plan, { before, writes, consumed: false }); return plan;
    }
    function restoreLocal(plan, { storage } = {}) {
        checkStorage(storage); const saved = plans.get(plan); if (!saved || saved.consumed) fail('VAULT_INVALID_PLAN');
        const applied = [], recovery = { format: 'dynasty-workspace-rollback', schemaVersion: 1, before: [...saved.before].map(([key, raw]) => ({ key, raw })), proposed: saved.writes.map(([key, raw]) => ({ key, raw })) };
        try {
            for (const [key, raw] of saved.before) if (storage.getItem(key) !== raw) fail('VAULT_STORAGE_CONFLICT');
            for (const [key, raw] of saved.writes) {
                if (storage.getItem(key) !== saved.before.get(key)) fail('VAULT_STORAGE_CONFLICT');
                storage.setItem(key, raw); applied.push([key, raw]);
                if (storage.getItem(key) !== raw) fail('VAULT_STORAGE_WRITE_UNCONFIRMED');
            }
            saved.consumed = true;
            return { ok: true, mainBackup: copy(plan.mainBackup), summary: copy(plan.summary), rollbackComplete: true, recovery: null };
        } catch (error) {
            let rollbackComplete = true;
            for (const [key, written] of applied.reverse()) {
                try {
                    if (storage.getItem(key) !== written) { rollbackComplete = false; continue; }
                    const previous = saved.before.get(key); if (previous === null) storage.removeItem(key); else storage.setItem(key, previous);
                    if (storage.getItem(key) !== previous) rollbackComplete = false;
                } catch (_) { rollbackComplete = false; }
            }
            return { ok: false, code: error.code || 'VAULT_STORAGE_WRITE_FAILED', message: error.message, rollbackComplete, recovery, mainBackup: null };
        }
    }
    function listRecoveries({ storage } = {}) { checkStorage(storage); return copy(recoveryValue(storage.getItem(RECOVERY_KEY)).entries); }
    function recoveryPreview(id, options = {}) {
        const entry = listRecoveries(options).find(item => item.id === id); if (!entry) fail('VAULT_RECOVERY_NOT_FOUND');
        if (entry.key === '$bundle') return importPreview(entry.raw, options);
        const value = { format: FORMAT, schemaVersion: 1, exportedAt: entry.savedAt, mainBackup: entry.key === '$main' ? parse(entry.raw) : null, localEntries: entry.key === '$main' ? [] : [{ key: entry.key, raw: entry.raw }] };
        return importPreview(value, options);
    }
    return Object.freeze({ FORMAT, SCHEMA_VERSION, RECOVERY_KEY, WORLD_KEY, LIMITS, registerKey, capture, importPreview, planRestore, restoreLocal, listRecoveries, recoveryPreview });
});
