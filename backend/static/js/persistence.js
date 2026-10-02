// Browser integration. Backup parsing and cloud scheduling are separately testable.
let activeAiRequests = 0;
let restoreLock = false;
let restoreSnapshot = null;
let pendingRestore = null;
let restoreAttempt = 0;
let initialLoadRunning = false;
let cloudExtras = {};
const cloneState = value => JSON.parse(JSON.stringify(value));
const PERSISTED_LABELS = {
    customLegends: '自訂人物', modifiedLegends: '人物修改', chatHistories: '人物對話',
    simulationHistory: '推演紀錄', discussionHistories: '人物討論', soulSaves: '魂穿存檔',
    hegemonySavedSim: '逐鹿進度', scenes: '自訂場景', sceneEdits: '場景修改', soulSession: '目前魂穿'
};
const cloudStore = DynastyStorage.create({
    capture: () => restoreSnapshot || captureUserData(),
    post: body => fetch(`${BACKEND_URL}/api/userdata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-token': APP_TOKEN },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
    }),
    onStatus: showCloudStatus
});

function showCloudStatus({ state, message }) {
    const banner = document.getElementById('cloudStatus');
    if (!banner) return;
    const labels = { loaded: '雲端資料已載入', saving: '儲存中…', saved: '已儲存至雲端', unloaded: '資料尚未載入', error: '儲存失敗', conflict: '雲端版本已變更' };
    document.getElementById('cloudStatusText').textContent = message || labels[state] || state;
    banner.dataset.state = state;
    document.getElementById('retrySaveBtn').hidden = state !== 'error';
    document.getElementById('reloadCloudBtn').hidden = !['conflict', 'error'].includes(state);
    banner.style.background = ['conflict', 'error', 'unloaded'].includes(state) ? '#7f1d1d' : '#292524';
}

function normalizeSoulSession(value) {
    const state = { ...cloneState(SOUL_SESSION_DEFAULTS), ...cloneState(value || {}) };
    state.generating = false;
    for (const field of ['chapters', 'moments', 'soulMoments', 'figureStates', 'soulGrowth', 'pendingTensions', 'shockedFigures', 'lastChapterTypes', 'keyEvents', 'factionStates']) {
        if (!Array.isArray(state[field])) state[field] = [];
    }
    state.chapters = state.chapters.map(chapter => ({ ...chapter, streaming: false, generating: false }));
    return state;
}

function captureUserData() {
    return DynastyBackup.validateData({
        customLegends: appState.customLegends, modifiedLegends: appState.modifiedLegends,
        chatHistories: appState.chatHistories, simulationHistory: appState.simulationHistory,
        discussionHistories: appState.discussionHistories, soulSaves: appState.soulSaves,
        hegemonySavedSim: appState.hegemony.savedSimulation ?? null,
        scenes: appState.scenes, sceneEdits: appState.sceneEdits,
        // A loaded non-null idle session may still contain historical/future
        // fields. Only the explicit reset action clears it to null.
        soulSession: soulSession.phase !== 'idle' || appState.soulSession !== null ? soulSession : null
    });
}

function applyUserData(data, runtime) {
    for (const field of DynastyBackup.PERSISTED_FIELDS) {
        if (field !== 'hegemonySavedSim' && field !== 'soulSession') appState[field] = cloneState(data[field]);
    }
    soulSession = normalizeSoulSession(data.soulSession);
    appState.soulSession = data.soulSession === null ? null : soulSession;
    // Reset old gameplay selections before applying an imported in-progress game.
    appState.hegemony = cloneState(GAMEPLAY_DEFAULTS.hegemony);
    appState.debateMode = cloneState(GAMEPLAY_DEFAULTS.debateMode);
    appState.soulMode = cloneState(GAMEPLAY_DEFAULTS.soulMode);
    if (runtime) {
        for (const key of ['hegemony', 'debateMode', 'soulMode']) {
            if (runtime[key]) appState[key] = { ...appState[key], ...cloneState(runtime[key]), activeSlot: null };
        }
    } else if (data.hegemonySavedSim) {
        const sim = data.hegemonySavedSim;
        if (Array.isArray(sim.factions)) appState.hegemony.factions = cloneState(sim.factions);
        if (sim.setup && typeof sim.setup === 'object') appState.hegemony.battleSetup = cloneState(sim.setup);
        if (Array.isArray(sim.phases)) appState.hegemony.phases = cloneState(sim.phases);
    }
    appState.hegemony.savedSimulation = cloneState(data.hegemonySavedSim);
    appState.chatMode = { targetId: null, history: [] };
    appState.compareList = [];
    try {
        if (data.hegemonySavedSim === null) localStorage.removeItem('hegemony_saved_sim');
        else localStorage.setItem('hegemony_saved_sim', JSON.stringify(data.hegemonySavedSim));
    } catch (error) { console.warn('本機快取無法更新，雲端資料仍保留。', error); }
}

async function init() {
    if (initialLoadRunning || cloudStore.getState().ready) return;
    initialLoadRunning = true;
    const screen = el('dataLoadingScreen');
    screen.style.display = 'flex';
    el('dataLoadMessage').textContent = '正在翻閱史籍…';
    el('retryLoadBtn').hidden = true;
    try {
        const response = await fetch(`${BACKEND_URL}/api/userdata`, { headers: { 'x-app-token': APP_TOKEN } });
        if (!response.ok) {
            if ([401, 403].includes(response.status)) {
                localStorage.removeItem('dynasty_token');
                el('passwordScreen').style.display = 'flex';
                screen.style.display = 'none';
            }
            throw new Error(`雲端讀取失敗（HTTP ${response.status}）`);
        }
        const raw = await response.json();
        if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new Error('雲端尚未提供新版資料保護，請更新後端後再使用。');
        const selected = {};
        for (const field of DynastyBackup.PERSISTED_FIELDS) if (Object.hasOwn(raw, field)) selected[field] = raw[field];
        const data = DynastyBackup.validateData(selected);
        cloudExtras = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'revision' && !DynastyBackup.PERSISTED_FIELDS.includes(key)));
        const cachedSim = safeJSONParse(localStorage.getItem('hegemony_saved_sim'), null);
        const archivedSim = safeJSONParse(localStorage.getItem('dynasty_preserved_local_hegemony'), null);
        if (cachedSim && canonicalJSON(cachedSim) !== canonicalJSON(data.hegemonySavedSim)) {
            const versions = archivedSim ? [archivedSim, cachedSim] : [cachedSim];
            // Preserve a previously local-only simulation before resetting the
            // mirror to the cloud value. It remains an archive, never auto-written.
            try { localStorage.setItem('dynasty_preserved_local_hegemony', JSON.stringify(versions)); }
            catch (error) { throw new Error('本機逐鹿存檔尚無法封存，請先確認瀏覽器儲存空間。'); }
            cloudExtras = { loadedCloudFields: cloudExtras, localHegemonySaves: versions };
        } else if (archivedSim) cloudExtras = { loadedCloudFields: cloudExtras, localHegemonySaves: archivedSim };
        applyUserData(data);
        cloudStore.initialize(raw.revision);
        await migrateOldData();
        refreshData(); initScenarios(); updateHegemonyUI(); updateSoulModeUI();
        screen.style.display = 'none';
        // Optional workspace UI failures must never invalidate the loaded cloud data.
        if (typeof readyWorldWorkspace === 'function') {
            Promise.resolve().then(() => readyWorldWorkspace()).catch(error => {
                console.warn('世界書桌尚未開啟，原功能仍可使用。', error);
                customAlert('世界書桌載入失敗：' + error.message + '。可稍後從導覽列重試。');
            });
        }
    } catch (error) {
        cloudStore.invalidate();
        el('dataLoadMessage').textContent = `${error.message}。資料未載入，請重試。`;
        el('retryLoadBtn').hidden = false;
        showCloudStatus({ state: 'unloaded', message: error.message });
    } finally { initialLoadRunning = false; }
}

async function migrateOldData() {
    let changed = false;
    // Keep an ambiguous or orphaned name under its original key. Never use the
    // first matching name or replace a separately stored current-ID version.
    for (const [cacheKey, field] of [['modifiedLegends_v13_9', 'modifiedLegends'], ['legendChatHistories_v13_9', 'chatHistories']]) {
        const legacy = safeJSONParse(localStorage.getItem(cacheKey), null);
        if (!legacy || Object.keys(appState[field]).length) continue;
        const migrated = {};
        for (const [name, value] of Object.entries(legacy)) {
            const candidates = [...staticLegendsData, ...appState.customLegends].filter(l => l.name === name);
            const key = candidates.length === 1 ? candidates[0].id : name;
            migrated[key] = value;
        }
        try {
            DynastyBackup.validateData({ [field]: migrated }, { partial: true });
            appState[field] = migrated; changed = true;
        } catch (error) { console.warn('舊本機資料保留原處，格式需人工確認。', error.message); }
    }
    if (changed) await syncToCloud();
}

function syncToCloud() {
    if (restoreLock) return Promise.resolve(false);
    return cloudStore.save();
}

function backupObject() {
    const backup = DynastyBackup.createBackup(captureUserData(), {
        appVersion: APP_VERSION,
        referenceData: { staticLegends: staticLegendsData, staticScenes: staticScenesData },
        runtime: { hegemony: appState.hegemony, debateMode: appState.debateMode, soulMode: appState.soulMode },
        cloudExtras: Object.keys(cloudExtras).length ? cloudExtras : undefined
    });
    return backup;
}

function downloadBackup(backup, prefix = 'legends') {
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = `${prefix}_v${APP_VERSION.replace('.', '_')}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleDownloadJSON() {
    if (!cloudStore.getState().ready) return customAlert('請先成功載入雲端資料，再匯出完整備份。');
    if (activeAiRequests || restoreLock) return customAlert('請等待內容生成或還原完成，再匯出完整備份。');
    try { downloadBackup(backupObject()); }
    catch (error) { customAlert(`無法匯出：${error.message}`); }
}

function canonicalJSON(value) {
    if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}';
    return JSON.stringify(value);
}

function validateRestoreReferences(referenceData) {
    if (!referenceData) return;
    for (const [key, current] of [['staticLegends', staticLegendsData], ['staticScenes', staticScenesData]]) {
        if (referenceData[key] && canonicalJSON(referenceData[key]) !== canonicalJSON(current)) {
            throw new Error('此備份的內建人物／場景與目前版本不同，需先整理版本差異才能完整還原。原檔內容仍保留。');
        }
    }
}

async function loadDataFile(input) {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    if (!cloudStore.getState().ready || cloudStore.getState().blocked) return customAlert('請先成功載入最新雲端資料，再預覽還原。');
    if (activeAiRequests || restoreLock) return customAlert('目前仍在生成內容或處理還原，請完成後再讀檔。');
    restoreLock = true;
    const attempt = ++restoreAttempt;
    const dialog = el('restoreDialog');
    dialog.showModal();
    el('restoreDetails').textContent = '正在檢查檔案與待儲存內容…';
    el('confirmRestoreBtn').disabled = true;
    el('cancelRestoreBtn').disabled = false;
    try {
        if (!await cloudStore.flush()) throw new Error('現有內容尚未成功儲存，請先處理儲存錯誤。');
        const raw = await file.text();
        if (attempt !== restoreAttempt || !restoreLock) return;
        const parsed = DynastyBackup.parseBackup(raw, captureUserData());
        validateRestoreReferences(parsed.referenceData);
        pendingRestore = parsed;
        const refs = DynastyBackup.reviewLegacyReferences(parsed.data, [...staticLegendsData, ...parsed.data.customLegends]);
        const orphanCount = Object.values(refs).reduce((count, entries) => count + entries.length, 0);
        const s = parsed.summary;
        const lines = [
            `自訂人物 ${s.customLegends}；人物修改 ${s.modifiedLegends}`,
            `對話 ${s.chatGroups} 組／${s.chatMessages} 則；討論 ${s.discussionGroups} 組／${s.discussionMessages} 則`,
            `推演紀錄 ${s.simulationHistory}；魂穿存檔 ${s.soulSaves}`,
            `自訂場景 ${s.scenes}；場景修改 ${s.sceneEdits}`,
            `魂穿進度：${parsed.data.soulSession ? '有' : '無'}；逐鹿存檔：${parsed.data.hegemonySavedSim ? '有' : '無'}`,
            parsed.missingFields.length ? `舊檔缺少${parsed.missingFields.map(field => PERSISTED_LABELS[field]).join('、')}：保留目前內容。` : '十個資料欄位齊全。',
            orphanCount ? `${orphanCount} 組舊 ID／未對應紀錄會以原 ID 保留，不自動覆蓋人物。` : '人物參照檢查完成。',
            ...(parsed.warnings || []),
            '確認後會先下載目前完整備份，再將預覽內容還原至雲端。'
        ];
        el('restoreDetails').textContent = lines.join('\n');
        el('confirmRestoreBtn').disabled = false;
    } catch (error) {
        if (attempt !== restoreAttempt || !restoreLock) return;
        el('restoreDetails').textContent = `無法還原，檔案或儲存狀態需要確認：${error.message}\n\n現有資料未被此檔案覆寫。`;
    }
}

function cancelRestore() {
    if (restoreSnapshot) return;
    restoreAttempt++;
    pendingRestore = null; restoreLock = false;
    el('restoreDialog').close();
}

async function confirmRestore() {
    if (!pendingRestore || restoreSnapshot) return;
    el('confirmRestoreBtn').disabled = true;
    el('cancelRestoreBtn').disabled = true;
    const parsed = pendingRestore;
    try {
        downloadBackup(backupObject(), 'before_restore');
        restoreSnapshot = parsed.data;
        const ok = await cloudStore.save({ immediate: true });
        restoreSnapshot = null;
        if (!ok) throw new Error('未收到雲端儲存確認，本機仍保留原資料。請保留備份並重新載入雲端確認結果。');
        applyUserData(parsed.data, parsed.runtime);
        // Keep archived extension versions available without posting them to the
        // server's unknown fields. A collision retains the loaded server copy.
        if (parsed.cloudExtras && canonicalJSON(parsed.cloudExtras) !== canonicalJSON(cloudExtras)) {
            cloudExtras = { loadedCloudFields: cloudExtras, importedBackupFields: cloneState(parsed.cloudExtras) };
        }
        pendingReactionLegendId = null;
        currentRequestToken++;
        _debateState = null;
        closeModal(); closeSoulSaves(); closeUIMsg();
        for (const id of ['soulDeepModal', 'snapshotModal', 'chronicleModal', 'scenesPanel', 'editHubModal', 'addModal']) el(id)?.classList.add('hidden');
        appState.mode = 'browse';
        refreshData(); closeAllPanels(); renderSoulSaves();
        el('restoreDialog').close();
        pendingRestore = null;
        customAlert('完整資料已還原，並已收到雲端儲存確認。');
    } catch (error) {
        restoreSnapshot = null; pendingRestore = null;
        el('restoreDetails').textContent = error.message;
    } finally {
        restoreLock = false;
        el('cancelRestoreBtn').disabled = false;
    }
}

function reloadCloudSafely() {
    if (activeAiRequests || restoreLock) return customAlert('請先等待內容生成或還原完成。');
    customConfirm('先下載目前本機完整備份，再重新載入雲端版本？', () => {
        downloadBackup(backupObject(), 'before_reload');
        location.reload();
    });
}

async function runTrackedAI(action) {
    if (restoreLock || !cloudStore.getState().ready || cloudStore.getState().blocked) throw new Error('資料正在還原或尚未載入最新雲端版本，請完成後再生成內容。');
    activeAiRequests++;
    try { return await action(); }
    finally { activeAiRequests--; }
}
async function callGeminiStream(...args) { return runTrackedAI(() => _callGeminiStream(...args)); }
async function callGeminiNative(...args) { return runTrackedAI(() => _callGeminiNative(...args)); }
