(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const FORMAT = 'dynasty-backup';
    const SCHEMA_VERSION = 1;
    const APP_VERSION = '15.11';
    const PERSISTED_FIELDS = Object.freeze([
        'customLegends', 'modifiedLegends', 'chatHistories', 'simulationHistory',
        'discussionHistories', 'soulSaves', 'hegemonySavedSim', 'scenes',
        'sceneEdits', 'soulSession'
    ]);
    const ARRAY_FIELDS = new Set(['customLegends', 'simulationHistory', 'soulSaves', 'scenes']);
    const MAP_FIELDS = new Set(['modifiedLegends', 'chatHistories', 'discussionHistories', 'sceneEdits']);
    const OPTIONAL_OBJECT_FIELDS = new Set(['hegemonySavedSim', 'soulSession']);
    const RUNTIME_FIELDS = Object.freeze(['hegemony', 'debateMode', 'soulMode']);
    const REFERENCE_FIELDS = Object.freeze(['staticLegends', 'staticScenes']);
    const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const CREDENTIAL_KEYS = new Set([
        'token', 'apptoken', 'accesstoken', 'refreshtoken', 'apikey', 'googleapikey',
        'openaiapikey', 'secret', 'appsecret', 'password', 'authorization', 'cookie',
        'cookies', 'credentials'
    ]);
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

    function fail(code, location) {
        const error = new Error(code + (location ? ': ' + location : ''));
        error.code = code;
        throw error;
    }

    function isRecord(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const proto = Object.getPrototypeOf(value);
        return proto === Object.prototype || proto === null;
    }

    // Validate before copying; JSON.stringify alone would silently lose undefined,
    // non-finite numbers, accessors, and non-JSON objects.
    function cloneJSON(value, location = '$', ancestors = new Set(), depth = 0) {
        if (depth > 100) fail('JSON_DEPTH_EXCEEDED', location);
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value !== 'object') fail('INVALID_JSON_VALUE', location);
        if (ancestors.has(value)) fail('CYCLIC_JSON_VALUE', location);
        if (!Array.isArray(value) && !isRecord(value)) fail('INVALID_JSON_OBJECT', location);
        if (Object.getOwnPropertySymbols(value).length) fail('INVALID_JSON_KEY', location);
        ancestors.add(value);
        const result = Array.isArray(value) ? [] : {};
        const keys = Object.keys(value);
        if (Array.isArray(value) && keys.length !== value.length) fail('INVALID_JSON_ARRAY', location);
        for (const key of keys) {
            if (UNSAFE_KEYS.has(key)) fail('UNSAFE_JSON_KEY', location + '.' + key);
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !own(descriptor, 'value')) fail('INVALID_JSON_ACCESSOR', location + '.' + key);
            if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) fail('INVALID_JSON_ARRAY', location);
            result[key] = cloneJSON(descriptor.value, location + '.' + key, ancestors, depth + 1);
        }
        ancestors.delete(value);
        return result;
    }

    function emptyData() {
        return {
            customLegends: [], modifiedLegends: {}, chatHistories: {}, simulationHistory: [],
            discussionHistories: {}, soulSaves: [], hegemonySavedSim: null,
            scenes: [], sceneEdits: {}, soulSession: null
        };
    }

    function validateLegend(record, location, requireIdentity) {
        if (!isRecord(record)) fail('INVALID_RECORD', location);
        for (const field of ['id', 'name', 'type', 'rank']) {
            if (requireIdentity || own(record, field)) {
                if (typeof record[field] !== 'string' || !record[field].trim()) {
                    fail('INVALID_CHARACTER_FIELD', location + '.' + field);
                }
            }
        }
        for (const field of ['title', 'desc', 'dynasty', 'tag', 'poem', 'analysis', 'deepAnalysis']) {
            if (own(record, field) && typeof record[field] !== 'string') fail('INVALID_CHARACTER_FIELD', location + '.' + field);
        }
        if (own(record, 'soulEssence') && typeof record.soulEssence !== 'string' && !isRecord(record.soulEssence)) {
            fail('INVALID_CHARACTER_FIELD', location + '.soulEssence');
        }
        if (own(record, 'stats') && (!Array.isArray(record.stats) || !record.stats.every(value => typeof value === 'number' && Number.isFinite(value)))) {
            fail('INVALID_CHARACTER_FIELD', location + '.stats');
        }
    }

    function isRoleMap(value) {
        return isRecord(value) && Object.values(value).every(role => role === null || typeof role === 'string');
    }

    function isRecordArray(value) {
        return Array.isArray(value) && value.every(isRecord);
    }

    function validateFactions(factions, location) {
        if (!isRecordArray(factions)) fail('INVALID_FACTIONS', location);
        const seen = new Set();
        factions.forEach((faction, index) => {
            const path = location + '[' + index + ']';
            for (const field of ['id', 'name']) {
                if (typeof faction[field] !== 'string' || !faction[field].trim()) fail('INVALID_FACTION_FIELD', path + '.' + field);
            }
            if (seen.has(faction.id)) fail('DUPLICATE_FACTION_ID', path + '.id');
            seen.add(faction.id);
            if (!Number.isInteger(faction.colorIdx) || faction.colorIdx < 0) fail('INVALID_FACTION_FIELD', path + '.colorIdx');
            for (const field of ['courtSlots', 'militarySlots']) {
                if (!isRoleMap(faction[field])) fail('INVALID_FACTION_FIELD', path + '.' + field);
            }
            if (!Array.isArray(faction.territories) || !faction.territories.every(value => typeof value === 'string')) {
                fail('INVALID_FACTION_FIELD', path + '.territories');
            }
        });
    }

    function validateSavedSimulation(simulation, location) {
        if (!isRecord(simulation)) fail('INVALID_SAVED_SIMULATION', location);
        if (own(simulation, 'factions')) validateFactions(simulation.factions, location + '.factions');
        if (own(simulation, 'setup') && !isRecord(simulation.setup)) fail('INVALID_SAVED_SIMULATION', location + '.setup');
        if (own(simulation, 'phases') && !isRecordArray(simulation.phases)) fail('INVALID_SAVED_SIMULATION', location + '.phases');
    }

    function validateSoulSession(session, location) {
        if (!isRecord(session)) fail('INVALID_SOUL_SESSION', location);
        if (typeof session.phase !== 'string' || !session.phase.trim()) fail('INVALID_SOUL_SESSION', location + '.phase');
        if (own(session, 'chapters') && !isRecordArray(session.chapters)) fail('INVALID_SOUL_SESSION', location + '.chapters');
        for (const field of ['moments', 'soulMoments', 'keyEvents', 'figureStates', 'soulGrowth', 'pendingTensions', 'shockedFigures', 'lastChapterTypes', 'factionStates']) {
            if (own(session, field) && !Array.isArray(session[field])) fail('INVALID_SOUL_SESSION', location + '.' + field);
        }
    }

    function validateData(data, { partial = false } = {}) {
        const copied = cloneJSON(data);
        if (!isRecord(copied)) fail('INVALID_DATA', '$');
        for (const field of Object.keys(copied)) {
            if (!PERSISTED_FIELDS.includes(field)) fail('UNKNOWN_DATA_FIELD', field);
        }
        for (const field of PERSISTED_FIELDS) {
            if (!own(copied, field)) {
                if (!partial) fail('MISSING_DATA_FIELD', field);
                continue;
            }
            const value = copied[field];
            if (ARRAY_FIELDS.has(field) && !Array.isArray(value)) fail('INVALID_FIELD_TYPE', field);
            if (MAP_FIELDS.has(field) && !isRecord(value)) fail('INVALID_FIELD_TYPE', field);
            if (OPTIONAL_OBJECT_FIELDS.has(field) && value !== null && !isRecord(value)) {
                fail('INVALID_FIELD_TYPE', field);
            }
            if (field === 'soulSession' && value !== null) validateSoulSession(value, field);
            if (field === 'hegemonySavedSim' && value !== null) validateSavedSimulation(value, field);
            if (ARRAY_FIELDS.has(field)) {
                value.forEach((record, index) => {
                    if (!isRecord(record)) fail('INVALID_RECORD', field + '[' + index + ']');
                });
            }
            if (field === 'customLegends') {
                const seen = new Set();
                value.forEach((record, index) => {
                    validateLegend(record, field + '[' + index + ']', true);
                    if (seen.has(record.id)) fail('DUPLICATE_CUSTOM_ID', record.id);
                    seen.add(record.id);
                });
            }
            if (field === 'soulSaves') {
                value.forEach((record, index) => {
                    if (own(record, 'snapshot')) validateSoulSession(record.snapshot, field + '[' + index + '].snapshot');
                });
            }
            if (field === 'modifiedLegends' || field === 'sceneEdits') {
                for (const [id, record] of Object.entries(value)) {
                    if (!id.trim() || !isRecord(record)) fail('INVALID_RECORD', field + '.' + id);
                    if (field === 'modifiedLegends') validateLegend(record, field + '.' + id, false);
                }
            }
            if (field === 'chatHistories' || field === 'discussionHistories') {
                for (const [id, group] of Object.entries(value)) {
                    if (field === 'discussionHistories' && (!isRecord(group) || !Array.isArray(group.messages))) {
                        fail('INVALID_HISTORY_GROUP', field + '.' + id);
                    }
                    const messages = field === 'discussionHistories' ? group.messages : group;
                    if (!id.trim() || !Array.isArray(messages)) fail('INVALID_HISTORY_GROUP', field + '.' + id);
                    messages.forEach((message, index) => {
                        const location = field + '.' + id + '[' + index + ']';
                        if (!isRecord(message)) fail('INVALID_RECORD', location);
                        for (const key of ['role', 'content']) {
                            if (own(message, key) && typeof message[key] !== 'string') {
                                fail('INVALID_MESSAGE_FIELD', location + '.' + key);
                            }
                        }
                    });
                }
            }
        }
        return copied;
    }

    function validateAppVersion(value) {
        if (typeof value !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value)) fail('INVALID_APP_VERSION');
        const requested = value.split('.').map(Number);
        const supported = APP_VERSION.split('.').map(Number);
        for (let index = 0; index < 3; index++) {
            const difference = (requested[index] || 0) - (supported[index] || 0);
            if (difference > 0) fail('FUTURE_APP_VERSION', value);
            if (difference < 0) break;
        }
        return value;
    }

    function validateReferenceData(value) {
        if (value === undefined) return undefined;
        const copied = cloneJSON(value, '$.referenceData');
        if (!isRecord(copied)) fail('INVALID_REFERENCE_DATA');
        for (const field of Object.keys(copied)) {
            if (!REFERENCE_FIELDS.includes(field)) fail('UNKNOWN_REFERENCE_FIELD', field);
            if (!Array.isArray(copied[field])) fail('INVALID_REFERENCE_FIELD', field);
            copied[field].forEach((record, index) => {
                if (!isRecord(record)) fail('INVALID_REFERENCE_RECORD', field + '[' + index + ']');
                if (field === 'staticLegends') validateLegend(record, field + '[' + index + ']', false);
                if (field === 'staticScenes') {
                    for (const key of ['id', 'name']) {
                        if (own(record, key) && (typeof record[key] !== 'string' || !record[key].trim())) {
                            fail('INVALID_REFERENCE_RECORD', field + '[' + index + '].' + key);
                        }
                    }
                }
            });
        }
        return copied;
    }

    function isCredential(key) {
        return CREDENTIAL_KEYS.has(key.replace(/[_-]/g, '').toLowerCase());
    }

    function stripCredentials(value) {
        if (Array.isArray(value)) return value.map(stripCredentials);
        if (!isRecord(value)) return value;
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            if (!isCredential(key)) result[key] = stripCredentials(item);
        }
        return result;
    }

    function assertNoCredentials(value, location) {
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
            if (isCredential(key)) fail('CREDENTIAL_IN_RUNTIME', location + '.' + key);
            assertNoCredentials(item, location + '.' + key);
        }
    }

    function validateRuntimeMode(mode, key) {
        const location = '$.runtime.' + key;
        const check = (field, predicate) => {
            if (own(mode, field) && !predicate(mode[field])) fail('INVALID_RUNTIME_FIELD', location + '.' + field);
        };
        const nullableRecord = value => value === null || isRecord(value);
        const nullableString = value => value === null || typeof value === 'string';
        check('minimized', value => typeof value === 'boolean');
        if (key === 'hegemony') {
            check('factions', isRecordArray);
            if (own(mode, 'factions')) validateFactions(mode.factions, location + '.factions');
            check('activeSlot', nullableRecord);
            check('battleSetup', isRecord);
            check('phases', isRecordArray);
            check('savedSimulation', nullableRecord);
            if (mode.savedSimulation) validateSavedSimulation(mode.savedSimulation, location + '.savedSimulation');
        } else if (key === 'debateMode') {
            check('activeSlot', nullableRecord);
            check('pro', isRoleMap);
            check('con', isRoleMap);
            check('topic', value => typeof value === 'string');
        } else {
            check('activeSlot', nullableString);
            check('activeTab', value => typeof value === 'string');
            check('activeScenario', nullableRecord);
            check('selection', isRoleMap);
        }
    }

    function validateRuntime(value, exporting = false) {
        if (value === undefined) return undefined;
        if (!isRecord(value)) fail('INVALID_RUNTIME');
        // Export only the named gameplay modes, never appState wholesale.
        const selected = {};
        for (const key of Object.keys(value)) {
            if (!RUNTIME_FIELDS.includes(key)) {
                if (!exporting) fail('UNKNOWN_RUNTIME_FIELD', key);
                continue;
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !own(descriptor, 'value')) fail('INVALID_JSON_ACCESSOR', '$.runtime.' + key);
            if (!isRecord(descriptor.value)) fail('INVALID_RUNTIME_FIELD', key);
            selected[key] = descriptor.value;
        }
        const copied = cloneJSON(selected, '$.runtime');
        for (const [key, mode] of Object.entries(copied)) validateRuntimeMode(mode, key);
        if (exporting) return stripCredentials(copied);
        assertNoCredentials(copied, '$.runtime');
        return copied;
    }

    function summaryFor(data) {
        const messageCount = groups => Object.values(groups).reduce((total, messages) => total + messages.length, 0);
        return {
            customLegends: data.customLegends.length,
            modifiedLegends: Object.keys(data.modifiedLegends).length,
            chatGroups: Object.keys(data.chatHistories).length,
            chatMessages: messageCount(data.chatHistories),
            simulationHistory: data.simulationHistory.length,
            discussionGroups: Object.keys(data.discussionHistories).length,
            discussionMessages: Object.values(data.discussionHistories).reduce((total, group) => total + group.messages.length, 0),
            soulSaves: data.soulSaves.length,
            scenes: data.scenes.length,
            sceneEdits: Object.keys(data.sceneEdits).length
        };
    }

    function validateCloudExtras(value) {
        if (value === undefined) return undefined;
        const copied = cloneJSON(value, '$.cloudExtras');
        if (!isRecord(copied)) fail('INVALID_CLOUD_EXTRAS');
        return copied;
    }

    function createBackup(data, { appVersion = APP_VERSION, referenceData, runtime, cloudExtras } = {}) {
        const result = {
            format: FORMAT, schemaVersion: SCHEMA_VERSION,
            appVersion: validateAppVersion(appVersion), exportedAt: new Date().toISOString(),
            data: validateData(data)
        };
        const references = validateReferenceData(referenceData);
        const gameplay = validateRuntime(runtime, true);
        const archivedExtras = validateCloudExtras(cloudExtras);
        if (references !== undefined) result.referenceData = references;
        if (gameplay !== undefined) result.runtime = gameplay;
        if (archivedExtras !== undefined) result.cloudExtras = archivedExtras;
        return result;
    }

    function parseBackup(raw, currentData = emptyData()) {
        let decoded;
        if (typeof raw === 'string') {
            try { decoded = JSON.parse(raw); }
            catch (_) { fail('INVALID_JSON'); }
        } else decoded = raw;
        const backup = cloneJSON(decoded);
        if (!isRecord(backup)) fail('INVALID_BACKUP');
        if (backup.format === 'dynasty-recovery-bundle') fail('RECOVERY_ARCHIVE_NOT_IMPORTABLE');
        const current = validateData(currentData);
        let data, missingFields, format, referenceData, runtime, cloudExtras;
        const warnings = [];
        const warningCodes = [];
        const warn = (code, message) => { warningCodes.push(code); warnings.push(message); };
        if (own(backup, 'format')) {
            if (backup.format !== FORMAT) fail('UNKNOWN_BACKUP_FORMAT');
            if (backup.schemaVersion !== SCHEMA_VERSION) fail('UNSUPPORTED_SCHEMA_VERSION');
            validateAppVersion(backup.appVersion);
            if (typeof backup.exportedAt !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt))) {
                fail('INVALID_EXPORT_TIME');
            }
            const allowed = ['format', 'schemaVersion', 'appVersion', 'exportedAt', 'data', 'referenceData', 'runtime', 'cloudExtras'];
            for (const key of Object.keys(backup)) {
                if (!allowed.includes(key)) fail('UNKNOWN_BACKUP_FIELD', key);
            }
            data = validateData(backup.data);
            missingFields = [];
            format = FORMAT;
            referenceData = validateReferenceData(backup.referenceData);
            runtime = validateRuntime(backup.runtime);
            cloudExtras = validateCloudExtras(backup.cloudExtras);
            if (cloudExtras !== undefined) {
                warn('CLOUD_EXTRAS_ARCHIVED_ONLY', '雲端額外欄位已封存於此備份；還原時不會寫入或覆蓋這些欄位。');
            }
        } else {
            // A recovery archive is a report, not a legacy app export.
            if (own(backup, 'exportedState') || own(backup, 'characters') || own(backup, 'unmatchedData')) {
                fail('RECOVERY_ARCHIVE_NOT_IMPORTABLE');
            }
            if (own(backup, 'schemaVersion') || own(backup, 'appVersion') || own(backup, 'data')) {
                fail('UNKNOWN_BACKUP_FORMAT');
            }
            if (own(backup, 'version')) validateAppVersion(backup.version);
            const selected = {};
            for (const key of Object.keys(backup)) {
                if (key !== 'version' && !PERSISTED_FIELDS.includes(key)) fail('UNKNOWN_LEGACY_FIELD', key);
            }
            for (const field of PERSISTED_FIELDS) {
                if (own(backup, field)) selected[field] = backup[field];
            }
            if (!Object.keys(selected).length) fail('EMPTY_LEGACY_BACKUP');
            // Older exports predate IDs. Match the app's hash only for an absent
            // property; an existing ID is immutable, including legacy suffixes.
            let generatedIds = 0;
            if (Array.isArray(selected.customLegends)) {
                selected.customLegends.forEach((record, index) => {
                    if (!isRecord(record)) fail('INVALID_RECORD', 'customLegends[' + index + ']');
                    if (!own(record, 'id')) {
                        if (typeof record.type !== 'string' || !record.type.trim() || typeof record.name !== 'string' || !record.name.trim()) {
                            fail('INVALID_CHARACTER_FIELD', 'customLegends[' + index + ']');
                        }
                        let hash = 0;
                        for (const character of record.type + '_' + record.name) hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
                        record.id = record.type + '_' + record.name + '_' + Math.abs(hash);
                        generatedIds++;
                    }
                });
            }
            const partial = validateData(selected, { partial: true });
            missingFields = PERSISTED_FIELDS.filter(field => !own(partial, field));
            data = validateData({ ...current, ...partial });
            format = 'legacy';
            if (generatedIds) warn('LEGACY_CUSTOM_IDS_GENERATED', '舊版部分新增人物沒有 ID，已按原程式規則補上；既有人物 ID 保持原值。');
            if (missingFields.length) warn('LEGACY_MISSING_FIELDS_PRESERVED', '這份舊版匯出未包含部分資料；缺少的欄位會保留目前內容，請在還原預覽中確認。');
            warn('LEGACY_NO_REFERENCE_DATA', '舊版匯出未包含內建人物與場景，還原時會使用目前版本的內建資料。');
        }
        return { data, missingFields, format, warnings, warningCodes, summary: summaryFor(data), referenceData, runtime, cloudExtras };
    }

    function reviewLegacyReferences(data, allCharacters) {
        const checked = validateData(data);
        const characters = cloneJSON(allCharacters);
        if (!Array.isArray(characters)) fail('INVALID_CHARACTER_LIST');
        characters.forEach((record, index) => validateLegend(record, 'allCharacters[' + index + ']', true));
        const ids = new Set(characters.map(character => character.id));
        const review = field => Object.keys(checked[field]).filter(id => !ids.has(id)).map(legacyId => {
            const candidates = characters.filter(character => {
                const prefix = character.type + '_' + character.name;
                return legacyId === prefix || (legacyId.startsWith(prefix + '_') && /^\d+$/.test(legacyId.slice(prefix.length + 1)));
            }).map(character => ({ id: character.id, name: character.name, type: character.type }));
            return { legacyId, candidates, ambiguous: candidates.length !== 1 };
        });
        return { modifications: review('modifiedLegends'), chats: review('chatHistories'), discussions: review('discussionHistories') };
    }

    return Object.freeze({
        PERSISTED_FIELDS, emptyData, validateData, createBackup, parseBackup, reviewLegacyReferences
    });
});
