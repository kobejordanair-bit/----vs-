(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyWorld = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const VERSION = 1;
    const RESOURCE_LABELS = { grain: '糧儲', treasury: '府庫', welfare: '民生', legitimacy: '公信', army: '軍備', administration: '行政', knowledge: '研習', influence: '議政支持' };
    const STAT_LABELS = { leadership: '統率', martial: '武力', intellect: '智力', politics: '政治', charisma: '魅力' };
    const STAT_KEYS = Object.keys(STAT_LABELS);
    const RULE_NOTICE = '資源、勢力反應、能力換算與結局皆為遊戲規則；人物館評值及原文不是已證實的歷史數值。歷史切片只提供參照，不宣稱重現史實。';
    const PRIMARY = [
        { id: 'harvest', title: '整備農務與糧倉', description: '投入府庫改善供給；過度連續動員會遞減產出，農戶也需要喘息。', cost: { treasury: 4 }, capacity: 2, stats: ['politics', 'leadership'] },
        { id: 'trade', title: '議價採買與通商', description: '先支付採買款，再收糧；商路安全影響到貨，對方也可能封鎖其他地域。', cost: { treasury: 12 }, capacity: 2, stats: ['charisma', 'politics'] },
        { id: 'tax', title: '限額徵調與籌款', description: '補充府庫並付出民生與公信代價。可搭配補償，但到期須真實支付。', cost: {}, capacity: 2, stats: ['politics', 'leadership'] },
        { id: 'relief', title: '賑濟與恢復生計', description: '直接花費糧款改善民生及地方秩序；不能同時把這些物資供給軍隊。', cost: { grain: 12, treasury: 3 }, capacity: 2, stats: ['politics', 'charisma'] },
        { id: 'fortify', title: '築防與輪換守軍', description: '改善指定地域防務；兩回合內必須支付接續糧餉。', cost: { grain: 7, treasury: 9 }, capacity: 3, stats: ['leadership', 'martial'] },
        { id: 'recon', title: '踏勘與交叉查訊', description: '建立指定地域兩回合情報，減低遭突襲的損失，為後續行動做準備。', cost: { treasury: 5 }, capacity: 2, stats: ['intellect', 'leadership'] },
        { id: 'campaign', title: '有限軍事施壓', description: '對指定勢力施壓，須負擔糧餉與傷耗；情報、防務、能力和授權影響戰果。', cost: { grain: 10, treasury: 12 }, capacity: 3, stats: ['leadership', 'martial'], needsTarget: true },
        { id: 'diplomacy', title: '締約與利益交換', description: '只對選定一方議約；成功後仍有貢付承諾，其他勢力不受此約約束。', cost: { grain: 3, treasury: 9 }, capacity: 2, stats: ['charisma', 'intellect'], needsTarget: true },
        { id: 'reform', title: '試行制度改革', description: '先投資、承擔議政阻力，兩回合後才回收改善；每地至多三期。', cost: { grain: 4, treasury: 12 }, capacity: 3, stats: ['politics', 'intellect'] },
        { id: 'recruit', title: '募補與部隊整合', description: '以糧款補足軍備，但徵募影響民生，下一回合還要履行續餉。', cost: { grain: 8, treasury: 10 }, capacity: 2, stats: ['leadership', 'charisma'] },
        { id: 'study', title: '研讀與處境適應', description: '將已選人物原文及史料列為反思依據，累積研習；引用本身不證明判斷正確。', cost: { treasury: 4 }, capacity: 2, stats: ['intellect', 'politics'] },
        { id: 'rest', title: '整頓、休息與例行配給', description: '降低任職疲勞，保留資源；時間、基本供給與各方壓力仍會照常推進。', cost: {}, capacity: 1, stats: ['leadership', 'politics'] }
    ];
    const SECONDARY = [
        { id: 'none', title: '保留人手', description: '不派另一位人物；到期承諾仍必須處理。', cost: {}, capacity: 0, stats: [] },
        { id: 'escort', title: '護運與備援', description: '指定地域增加守備與本回合護運；軍備較弱的其他地域仍會承壓。', cost: { grain: 3, treasury: 3 }, capacity: 1, stats: ['leadership', 'martial'] },
        { id: 'ledger', title: '公開帳目與交付', description: '改善公信及議政支持；不代替到期付款。', cost: { treasury: 3 }, capacity: 1, stats: ['politics', 'intellect'] },
        { id: 'compensate', title: '補償憑據', description: '只配徵調：即時付一府庫，下一回合再付七府庫；末回合必須當場全付。', cost: { treasury: 1 }, capacity: 1, stats: ['politics', 'charisma'] },
        { id: 'mediation', title: '召集民軍協商', description: '改善民生與議政支持，緩和指定地域的不安。', cost: { treasury: 5 }, capacity: 2, stats: ['charisma', 'politics'] },
        { id: 'counterintel', title: '查驗消息與反滲透', description: '本回合減輕地方干預與突襲，並延長指定地域情報。', cost: { treasury: 5 }, capacity: 1, stats: ['intellect', 'politics'] },
        { id: 'training', title: '分隊訓練', description: '花費糧款改善軍備和指定地域防務，教練會累積疲勞。', cost: { grain: 3, treasury: 4 }, capacity: 2, stats: ['martial', 'leadership'] },
        { id: 'archives', title: '整理史料與決策札記', description: '提高研習與行政，保留來源參照；不會把假說升格為史實。', cost: { treasury: 3 }, capacity: 1, stats: ['intellect', 'politics'] },
        { id: 'bond', title: '共同走訪與建立默契', description: '兩位受命者累積合作；魂穿時也改善宿主與原有社交圈的遊戲關係。', cost: { treasury: 2 }, capacity: 1, stats: ['charisma', 'leadership'] }
    ];
    const STANCES = [
        { id: 'prudent', title: '審慎限額', description: '主要收益乘九成，減少軍事傷耗與身份張力。' },
        { id: 'balanced', title: '常規授權', description: '按一般規則執行，不額外增加協調需求。' },
        { id: 'bold', title: '積極授權', description: '主要收益增一成五，多占一份協調，增加耗費、議政壓力及身份張力。' }
    ];
    const SETTLEMENTS = [
        { id: 'none', title: '本回合無到期義務' }, { id: 'pay', title: '付清到期承諾' },
        { id: 'defer', title: '協商延期一次', description: '每項府庫追加三點，公信和受益者信任下降；不能延到終局之後。' },
        { id: 'default', title: '公開違約', description: '不付款，但責任仍留在原受命者及對應盟約。' }
    ];
    const APPROACHES = [
        { id: 'host', title: '依宿主原有方法', description: '使用宿主能力，身份張力下降；穿越者知識只保留在反思中。' },
        { id: 'soul', title: '以穿越者方法介入', description: '新方法須經適應，較快累積適應，也提高身份張力與社交疑慮。' },
        { id: 'blend', title: '雙方折衷', description: '按適應程度混合能力；宿主關係與公開責任仍影響結果。' }
    ];
    const PRINCIPLES = [
        { id: 'none', title: '只作閱讀脈絡', description: '保留原文，不指定行為約定，不影響遊戲狀態。' },
        { id: 'care', title: '我的解讀：民生優先', description: '農務、賑濟、休整，或民軍協商相容；無補償徵調與軍事施壓相違。' },
        { id: 'order', title: '我的解讀：組織秩序', description: '築防、改革、募補或公開帳目相容；公開違約、積極授權的徵調相違。' },
        { id: 'bold', title: '我的解讀：進取冒險', description: '軍事施壓、改革、募補或積極授權相容；審慎限額的休整相違。' },
        { id: 'diplomacy', title: '我的解讀：協調聯盟', description: '締約、民軍協商或共同走訪相容；軍事施壓或公開違約相違。' },
        { id: 'learning', title: '我的解讀：調查學習', description: '踏勘、研習或整理史料相容；沒有有效情報就軍事施壓相違。' }
    ];
    const ORDER_FIELDS = ['primary', 'secondary', 'actorId', 'supportId', 'regionId', 'targetFactionId', 'stance', 'settlement', 'approach', 'anchorId'];
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const copy = x => JSON.parse(JSON.stringify(x));
    const clamp = (x, low = 0, high = 100) => Math.min(high, Math.max(low, Math.round(x)));
    const record = x => !!x && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
    function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
    function freeze(x) { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; }
    function fields(x, allowed, at) { if (!record(x) || Object.keys(x).some(k => !allowed.includes(k))) fail('INVALID_CONFIG', at + ' 欄位不符合共用格式。'); }
    function string(x, at, max = 160, empty = false) { if (typeof x !== 'string' || (!empty && !x.trim()) || x.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)) fail('INVALID_CONFIG', at + ' 不是允許的文字。'); return x; }
    function listStrings(x, at, max = 40) { if (x === undefined) return []; if (!Array.isArray(x) || x.length > max) fail('INVALID_CONFIG', at + ' 清單過長。'); const a = x.map(v => string(v, at)); if (new Set(a).size !== a.length) fail('INVALID_CONFIG', at + ' 有重複 ID。'); return a; }
    function safeJSON(x) {
        let nodes = 0;
        const visit = (v, depth) => { if (++nodes > 90000 || depth > 28) fail('INVALID_SAVE', '存檔結構過大或過深。'); if (v === null || typeof v === 'boolean' || typeof v === 'string') return; if (typeof v === 'number' && Number.isFinite(v)) return; if (Array.isArray(v)) return v.forEach(y => visit(y, depth + 1)); if (!record(v)) fail('INVALID_SAVE', '存檔只接受 JSON 資料。'); for (const k of Object.keys(v)) { if (['__proto__', 'constructor', 'prototype'].includes(k)) fail('INVALID_SAVE', '存檔包含不允許的物件欄位。'); visit(v[k], depth + 1); } };
        visit(x, 0); if (JSON.stringify(x).length > 1600000) fail('INVALID_SAVE', '存檔超過大小限制。');
    }
    function canonical(x) { if (!x || typeof x !== 'object') return JSON.stringify(x); if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']'; return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}'; }
    function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
    function jitter(state, key) { return hash(state.config.seed + ':' + (state.turn + 1) + ':' + key) % 5 - 2; }
    function refs(input) { if (input === undefined) return []; if (!Array.isArray(input) || input.length > 80) fail('INVALID_CONFIG', '來源參照超過上限。'); const result = input.map(ref => { if (typeof ref === 'string') return string(ref, '來源 ID', 2048); fields(ref, ['id', 'title', 'url', 'claimId'], '來源參照'); const item = {}; for (const k of Object.keys(ref)) item[k] = string(ref[k], '來源 ' + k, k === 'url' ? 2048 : k === 'title' ? 6000 : 300, k === 'url'); if (!item.id && !item.title) fail('INVALID_CONFIG', '來源參照缺少 ID 或標題。'); if (item.url && !/^https?:\/\//i.test(item.url)) fail('INVALID_CONFIG', '來源網址只接受 HTTP(S)。'); return item; }); if (JSON.stringify(result).length > 24000) fail('INVALID_CONFIG', '單組來源參照超過 24,000 字元，請縮減至本局相關範圍。'); return result; }
    function namedRefs(input, ids, at) { if (input === undefined) return []; if (!Array.isArray(input) || input.length > 40) fail('INVALID_CONFIG', at + ' 名稱過多。'); const seen = new Set(); return input.map(v => { fields(v, ['id', 'name'], at); const out = { id: string(v.id, at + ' ID'), name: string(v.name, at + ' 名稱', 200) }; if (!ids.includes(out.id) || seen.has(out.id)) fail('INVALID_CONFIG', at + ' 必須對應唯一的參照 ID。'); seen.add(out.id); return out; }); }
    function normalizeStats(input) {
        if (input === undefined || input === null) return { values: { leadership: 50, martial: 50, intellect: 50, politics: 50, charisma: 50 }, supplied: false };
        let values = {};
        if (Array.isArray(input)) { if (input.length !== 5) fail('INVALID_CONFIG', '人物評值須為五維。'); STAT_KEYS.forEach((k, i) => { values[k] = input[i]; }); }
        else { fields(input, STAT_KEYS, '人物評值'); if (!STAT_KEYS.every(k => own(input, k))) fail('INVALID_CONFIG', '人物評值缺少維度。'); values = copy(input); }
        for (const v of Object.values(values)) if (!Number.isFinite(v) || v < 0 || v > 100) fail('INVALID_CONFIG', '人物評值須介於 0 至 100。');
        return { values, supplied: true };
    }
    function normalizeConfig(input) {
        safeJSON(input);
        fields(input, ['mode', 'seed', 'setting', 'roster', 'hostId', 'soulId', 'playerFactionId', 'maxTurns'], '開局');
        if (!['hegemony', 'soul'].includes(input.mode)) fail('INVALID_CONFIG', '不支援的玩法。');
        let seed = input.seed === undefined ? 'dynasty-world' : input.seed;
        if (typeof seed === 'number' && Number.isSafeInteger(seed)) seed = String(seed);
        seed = string(seed, '種子', 128);
        const maxTurns = input.maxTurns === undefined ? 10 : input.maxTurns;
        if (!Number.isInteger(maxTurns) || maxTurns < 8 || maxTurns > 12) fail('INVALID_CONFIG', '完整劇局須為 8 至 12 回合。');
        const supplied = input.setting || {};
        fields(supplied, ['title', 'kind', 'eventId', 'time', 'placeIds', 'factionIds', 'sourceRefs', 'places', 'factions', 'notes'], '情境');
        const setting = { title: string(supplied.title || '人物共演', '情境標題', 200), kind: supplied.kind || 'fictional', eventId: supplied.eventId === undefined || supplied.eventId === null ? null : string(supplied.eventId, '事件 ID'), time: supplied.time === undefined ? null : copy(supplied.time), placeIds: listStrings(supplied.placeIds, '地點'), factionIds: listStrings(supplied.factionIds, '勢力'), sourceRefs: refs(supplied.sourceRefs), notes: string(supplied.notes === undefined ? '' : supplied.notes, '世界筆記', 6000, true) };
        if (!['historical-slice', 'fictional'].includes(setting.kind)) fail('INVALID_CONFIG', '情境必須區分歷史切片與架空。');
        if (setting.kind === 'historical-slice' && !setting.eventId) fail('INVALID_CONFIG', '歷史切片須保留事件 ID。');
        if (JSON.stringify(setting.time).length > 3000) fail('INVALID_CONFIG', '時間參照過大。');
        setting.places = namedRefs(supplied.places, setting.placeIds, '地點'); setting.factions = namedRefs(supplied.factions, setting.factionIds, '勢力');
        if (!Array.isArray(input.roster) || input.roster.length < 2 || input.roster.length > 12) fail('INVALID_CONFIG', '請選 2 至 12 份原始人物紀錄。');
        const ids = new Set();
        const roster = input.roster.map(r => {
            fields(r, ['recordId', 'name', 'type', 'stats', 'statsSupplied', 'analysisAnchors', 'sourceContext'], '人物');
            const recordId = string(r.recordId, '人物紀錄 ID'); if (recordId === 'none' || ids.has(recordId)) fail('INVALID_CONFIG', '人物紀錄 ID 重複或保留。'); ids.add(recordId);
            const stats = normalizeStats(r.stats);
            if (r.statsSupplied !== undefined && typeof r.statsSupplied !== 'boolean') fail('INVALID_CONFIG', '能力來源標記錯誤。');
            const anchors = r.analysisAnchors === undefined ? [] : r.analysisAnchors;
            if (!Array.isArray(anchors) || anchors.length > 8) fail('INVALID_CONFIG', '每位人物最多選八則原文錨點。');
            const anchorIds = new Set();
            const analysisAnchors = anchors.map(a => { fields(a, ['id', 'label', 'quote', 'sourceField', 'sourceRefs', 'principle', 'interpretation'], '原文錨點'); const id = string(a.id, '錨點 ID', 2048); if (id === 'none' || anchorIds.has(id)) fail('INVALID_CONFIG', '原文錨點 ID 必須唯一。'); anchorIds.add(id); const principle = a.principle === undefined ? 'none' : a.principle; if (!PRINCIPLES.some(p => p.id === principle)) fail('INVALID_CONFIG', '玩家解讀原則不在允許清單。'); return { id, label: string(a.label || '人物館原文摘錄', '錨點標題', 120), quote: string(a.quote, '原文摘錄', 2400), interpretation: string(a.interpretation === undefined ? '' : a.interpretation, '玩家解讀', 1600, true), sourceField: string(a.sourceField || 'deepAnalysis', '原文欄位', 80), sourceRefs: refs(a.sourceRefs), principle }; });
            const suppliedContext = r.sourceContext || {};
            fields(suppliedContext, ['historyPersonId', 'evidenceStatus', 'evidenceLabel', 'role', 'participation'], '事件身份脈絡');
            const nullable = (value, at, max = 160) => value === undefined || value === null ? null : string(value, at, max);
            const sourceContext = { historyPersonId: nullable(suppliedContext.historyPersonId, '歷史人物 ID'), evidenceStatus: string(suppliedContext.evidenceStatus || 'unlinked', '事件身份查證狀態', 120), evidenceLabel: string(suppliedContext.evidenceLabel || '尚未連結事件身份；本局角色屬創作', '事件身份查證說明', 2000), role: nullable(suppliedContext.role, '事件角色', 2000), participation: nullable(suppliedContext.participation, '事件參與狀態', 2000) };
            return { recordId, name: string(r.name, '人物名稱', 160), type: string(r.type || 'unknown', '人物類型', 60), stats: stats.values, statsSupplied: r.statsSupplied === undefined ? stats.supplied : r.statsSupplied, analysisAnchors, sourceContext };
        });
        const hostId = input.hostId === undefined || input.hostId === null ? null : string(input.hostId, '宿主 ID');
        const soulId = input.soulId === undefined || input.soulId === null ? null : string(input.soulId, '穿越者 ID');
        if (input.mode === 'soul' && (!ids.has(hostId) || !ids.has(soulId) || hostId === soulId)) fail('INVALID_CONFIG', '魂穿須指定兩份不同且已選入的人物紀錄。');
        if (input.mode === 'hegemony' && (hostId !== null || soulId !== null)) fail('INVALID_CONFIG', '爭霸不使用魂穿身份欄位。');
        const playerFactionId = input.playerFactionId === undefined || input.playerFactionId === null ? null : string(input.playerFactionId, '本方勢力 ID');
        if (playerFactionId && !setting.factionIds.includes(playerFactionId)) fail('INVALID_CONFIG', '本方勢力必須來自本局參照清單。');
        const config = { mode: input.mode, seed, maxTurns, setting, roster, hostId, soulId, playerFactionId };
        if (JSON.stringify(config).length > 240000) fail('INVALID_CONFIG', '本局人物引用超過 240,000 字元，請選取相關片段；全文仍留在原人物庫。');
        return config;
    }
    function initial(config) {
        const labels = [['heartland', '民生腹地'], ['frontier', '邊境防區'], ['trade', '交通商路']];
        const regions = labels.map(([key, name], i) => { const sourcePlaceId = config.setting.placeIds[i] || null, ref = config.setting.places.find(p => p.id === sourcePlaceId); return { id: 'region:' + key, name: ref ? ref.name + '・' + name : name, kind: key, sourcePlaceId, security: [63, 48, 52][i], supply: [68, 48, 57][i], unrest: [20, 28, 23][i], intelUntil: 0, reformLevel: 0 }; });
        const others = config.setting.factionIds.filter(id => id !== config.playerFactionId);
        const factionSlots = [['player', '本方議事集團', 'player', 55, 0], ['rival', '外部競爭勢力', 'military', 66, 62], ['league', '商路利益聯盟', 'trade', 54, 45], ['estates', '地方權勢集團', 'court', 50, 42]];
        const factions = factionSlots.map(([id, name, strategy, strength, hostility], i) => { const sourceFactionId = i === 0 ? config.playerFactionId : others[i - 1] || null, ref = config.setting.factions.find(f => f.id === sourceFactionId); return { id: 'faction:' + id, name: ref ? ref.name + '（推演席位）' : name, sourceFactionId, player: i === 0, strategy, strength, hostility, relation: i === 0 ? 65 : 40, truceUntil: 0, lastAction: '等待本局第一份政令' }; });
        const actors = config.roster.map(r => ({ recordId: r.recordId, fatigue: 0, loyalty: 55, experience: 0, commissions: 0 }));
        const physical = actors.filter(a => a.recordId !== config.soulId);
        const bonds = physical.flatMap((a, i) => physical.slice(i + 1).map(b => ({ a: a.recordId, b: b.recordId, trust: 45, sharedTurns: 0, brokenPromises: 0 })));
        return { version: VERSION, config: copy(config), configFingerprint: hash(canonical(config)).toString(16).padStart(8, '0'), turn: 0, maxTurns: config.maxTurns, status: 'active', resources: { grain: 76, treasury: 92, welfare: 59, legitimacy: 58, army: 58, administration: 50, knowledge: 15, influence: 56 }, regions, factions, actors, bonds, soul: config.mode === 'soul' ? { hostId: config.hostId, soulId: config.soulId, adaptation: 25, reputation: 52, tension: 20, selfhood: 60 } : null, commitments: [], pending: [], orders: [], log: [], ending: null, scarcityStreak: 0 };
    }
    function createSession(config) { return initial(normalizeConfig(config)); }
    const rosterRecord = (s, id) => s.config.roster.find(r => r.recordId === id);
    const actorState = (s, id) => s.actors.find(r => r.recordId === id);
    const regionState = (s, id) => s.regions.find(r => r.id === id);
    const factionState = (s, id) => s.factions.find(r => r.id === id);
    const dueFor = state => state.commitments.filter(c => c.due <= state.turn + 1);
    const sumCosts = (a, b) => { for (const [k, v] of Object.entries(b || {})) a[k] = (a[k] || 0) + v; return a; };
    const resourcesText = values => Object.entries(values).filter(([, v]) => v).map(([k, v]) => (RESOURCE_LABELS[k] || k) + ' ' + (v > 0 ? '+' : '') + v).join('、') || '資源不變';
    function effectiveAbility(state, recordId, keys, approach) {
        const rec = rosterRecord(state, recordId), actor = actorState(state, recordId);
        let stats = rec.stats, origin = rec.statsSupplied ? '人物館原有評值（遊戲輸入）' : '缺少評值，採全五十的中性遊戲起點';
        if (state.soul && recordId === state.config.hostId && approach !== 'host') {
            const guest = rosterRecord(state, state.config.soulId), adaptation = state.soul.adaptation / 100;
            const weight = approach === 'soul' ? 0.35 + adaptation * 0.5 : adaptation * 0.5;
            stats = Object.fromEntries(STAT_KEYS.map(k => [k, Math.round(rec.stats[k] * (1 - weight) + guest.stats[k] * weight)]));
            origin = '宿主與穿越者評值按適應度混合；穿越者占 ' + Math.round(weight * 100) + '%（遊戲換算）';
        }
        const raw = keys.length ? keys.reduce((n, k) => n + stats[k], 0) / keys.length : 50;
        const penalty = Math.floor(actor.fatigue / 8), learning = Math.min(8, Math.floor(actor.experience / 8));
        const loyalty = actor.loyalty < 35 ? 8 : 0;
        const score = clamp(raw - penalty - loyalty + learning);
        return { recordId, name: rec.name, score, bonus: Math.floor((score - 50) / 10), stats: keys.map(k => ({ key: k, label: STAT_LABELS[k], value: stats[k] })), fatiguePenalty: penalty, loyaltyPenalty: loyalty, learningBonus: learning, origin };
    }
    function bondFor(state, a, b) { return state.bonds.find(v => (v.a === a && v.b === b) || (v.a === b && v.b === a)); }
    function interpretAnchor(state, order, anchor) {
        if (!anchor || anchor.principle === 'none') return null;
        const primary = order.primary, secondary = order.secondary, principle = anchor.principle;
        let aligned = false, conflict = false;
        if (principle === 'care') { aligned = ['harvest', 'relief', 'rest'].includes(primary) || secondary === 'mediation'; conflict = primary === 'campaign' || primary === 'tax' && secondary !== 'compensate'; }
        if (principle === 'order') { aligned = ['fortify', 'reform', 'recruit'].includes(primary) || secondary === 'ledger'; conflict = order.settlement === 'default' || primary === 'tax' && order.stance === 'bold'; }
        if (principle === 'bold') { aligned = ['campaign', 'reform', 'recruit'].includes(primary) || order.stance === 'bold'; conflict = primary === 'rest' && order.stance === 'prudent'; }
        if (principle === 'diplomacy') { aligned = primary === 'diplomacy' || ['mediation', 'bond'].includes(secondary); conflict = primary === 'campaign' || order.settlement === 'default'; }
        if (principle === 'learning') { aligned = ['recon', 'study'].includes(primary) || secondary === 'archives'; conflict = primary === 'campaign' && regionState(state, order.regionId).intelUntil < state.turn + 1; }
        const status = conflict ? 'conflict' : aligned ? 'aligned' : 'neutral';
        const priorPractices = state.log.filter(l => l.order.actorId === order.actorId && l.order.anchorId === anchor.id && l.anchorApplication && l.anchorApplication.status === 'aligned').length;
        const rewarded = status === 'aligned' && priorPractices < 2;
        const effects = { loyalty: rewarded ? 3 : conflict ? -3 : 0, bond: order.supportId === 'none' ? 0 : rewarded ? 2 : conflict ? -1 : 0, adaptation: state.soul && order.actorId === state.config.hostId && rewarded ? 2 : 0, tension: state.soul && order.actorId === state.config.hostId && conflict ? 2 : 0 };
        const meaning = status === 'aligned' ? rewarded ? '符合自己選定的行為約定，取得一次有限的實踐增益' : '符合行為約定；此錨點已達兩次獎勵上限，本次只留下紀錄' : status === 'conflict' ? '與自己選定的行為約定相違，承擔信任與身份張力代價' : '本次措施與這項約定沒有明確相容或衝突';
        return { anchorId: anchor.id, recordId: order.actorId, principle, status, priorPractices, rewarded, effects, interpretation: 'player-selected-not-historical-truth', explanation: PRINCIPLES.find(p => p.id === principle).title + '：' + meaning + '。不評判原文真偽或人物本性。' };
    }
    function makePlan(state, order) {
        if (!record(order) || Object.keys(order).length !== ORDER_FIELDS.length || ORDER_FIELDS.some(k => !own(order, k) || typeof order[k] !== 'string' || order[k].length > (k === 'anchorId' ? 2048 : 160))) fail('INVALID_ORDER', '政令須完整保留十項選擇與精確人物 ID。');
        const p = PRIMARY.find(x => x.id === order.primary), sec = SECONDARY.find(x => x.id === order.secondary);
        if (!p || !sec || !STANCES.some(x => x.id === order.stance) || !SETTLEMENTS.some(x => x.id === order.settlement) || !APPROACHES.some(x => x.id === order.approach)) fail('INVALID_ORDER', '政令包含未支援的選項。');
        const executor = rosterRecord(state, order.actorId), support = rosterRecord(state, order.supportId), region = regionState(state, order.regionId), target = factionState(state, order.targetFactionId);
        if (!executor || !region || (sec.id === 'none' ? order.supportId !== 'none' : !support) || (p.needsTarget ? !target || target.player : order.targetFactionId !== 'none')) fail('INVALID_ORDER', '受命者、地域或目標勢力必須來自本局。');
        if (order.anchorId !== 'none' && !executor.analysisAnchors.some(a => a.id === order.anchorId)) fail('INVALID_ORDER', '原文錨點必須來自本次受命者的確切紀錄。');
        const errors = [], notes = [], cost = sumCosts(copy(p.cost), sec.cost), round = state.turn + 1;
        const due = copy(dueFor(state));
        if (state.status !== 'active') errors.push('本局已結束，請開新局或讀取較早存檔。');
        if (support && support.recordId === executor.recordId) errors.push('主措施與配套須由不同人物負責。');
        if (state.soul && (executor.recordId === state.config.soulId || support && support.recordId === state.config.soulId)) errors.push('穿越者與宿主共用同一身體，不能把穿越者另派為第二位執行者。');
        if (!state.soul && order.approach !== 'host') errors.push('爭霸模式使用人物本人的能力；魂穿方法只適用魂穿局。');
        if (sec.id === 'compensate' && p.id !== 'tax') errors.push('補償憑據只搭配限額徵調。');
        if (p.id === 'reform' && region.reformLevel >= 3) errors.push('此地域已完成三期制度試行，請轉向其他地域。');
        if (due.length && order.settlement === 'none') errors.push('有到期承諾，須選擇付款、延期或公開違約。');
        if (!due.length && order.settlement !== 'none') errors.push('沒有到期承諾，請選本回合無到期義務。');
        if (order.settlement === 'defer' && (round >= state.maxTurns || due.some(c => c.deferred))) errors.push('承諾只能延期一次，且不能延到結局之後。');
        if (order.settlement === 'pay') due.forEach(c => sumCosts(cost, c.cost));
        if (order.stance === 'bold') sumCosts(cost, { grain: 2, treasury: 2 });
        let capacity = p.capacity + sec.capacity + (order.stance === 'bold' ? 1 : 0) + (order.settlement === 'pay' && due.length ? 1 : 0);
        if (actorState(state, order.actorId).fatigue >= 70) { capacity++; notes.push('主要受命者疲勞至少七十，交接多占一份協調。'); }
        if (support && actorState(state, order.supportId).loyalty < 30) { capacity++; notes.push('配套受命者信任過低，需要額外協調。'); }
        const capacityLimit = state.resources.influence < 30 ? 5 : 6;
        if (capacity > capacityLimit) errors.push('本回合需要 ' + capacity + ' 份協調，議政支持只容許 ' + capacityLimit + ' 份。');
        const ability = effectiveAbility(state, order.actorId, p.stats, order.approach), supportAbility = support ? effectiveAbility(state, order.supportId, sec.stats, order.approach) : null;
        const multiplier = order.stance === 'bold' ? 1.15 : order.stance === 'prudent' ? 0.9 : 1;
        const power = value => Math.max(0, Math.round((value + ability.bonus) * multiplier));
        const supportPower = value => value + (supportAbility ? Math.max(-3, supportAbility.bonus) : 0);
        const changes = {}, regionChanges = {}, factionChanges = {}, events = [], obligations = [];
        const add = effects => sumCosts(changes, effects), local = effects => sumCosts(regionChanges, effects);
        const uses = state.orders.filter(o => o.primary === p.id).length;
        function promise(type, title, payment, dueIn, beneficiary) {
            const c = { id: 't' + round + ':' + type, type, title, cost: payment, due: Math.min(state.maxTurns, round + dueIn), sourceTurn: round, ownerId: executor.recordId, beneficiary, deferred: false };
            if (c.due === round) { sumCosts(cost, payment); notes.push('末回合新增「' + title + '」須當場備款，成本已計入。'); events.push({ kind: 'final-commitment', title, cost: copy(payment) }); }
            else obligations.push(c);
        }
        if (p.id === 'harvest') { const fatigue = Math.max(0, 4 - uses); add({ grain: power(14 + fatigue), welfare: -2 }); local({ supply: 8, unrest: 1 }); notes.push('本局農務動員已 ' + uses + ' 次，初期額外存糧依次遞減。'); }
        if (p.id === 'trade') { const loss = Math.max(0, Math.floor((50 - region.security) / 8)); add({ grain: Math.max(3, power(21) - loss), legitimacy: 1 }); local({ supply: 6 }); notes.push('採買從目前選定地域進貨；低防務到貨損失 ' + loss + '。'); }
        if (p.id === 'tax') { add({ treasury: power(Math.max(10, 20 - uses * 2)), welfare: -9, legitimacy: -3 }); local({ unrest: 7, supply: -3 }); notes.push('重複徵調的基礎款項遞減，不會無限抽取同一筆財用。'); }
        if (p.id === 'relief') { add({ welfare: power(15), legitimacy: 5 }); local({ unrest: -10, supply: 8 }); }
        if (p.id === 'fortify') { add({ army: power(5) }); local({ security: power(17), supply: 4 }); promise('garrison', '接續守軍糧餉', { grain: 4, treasury: 4 }, 2, 'army'); }
        if (p.id === 'recon') { local({ intelUntil: Math.min(state.maxTurns, round + 1), security: 2 }); add({ knowledge: power(6) }); notes.push('情報有效至第 ' + Math.min(state.maxTurns, round + 1) + ' 回合結束。'); }
        if (p.id === 'campaign') {
            const intel = region.intelUntil >= round, supplied = region.supply >= 35, advantage = Math.floor((state.resources.army - target.strength) / 15), risk = order.stance === 'prudent' ? 2 : order.stance === 'bold' ? 6 : 4;
            const damage = Math.max(3, power(13) + (intel ? 6 : -4) + (supplied ? 2 : -4) + advantage + jitter(state, 'campaign:' + target.id));
            factionChanges.strength = -damage; factionChanges.hostility = 15; factionChanges.relation = -8;
            add({ army: -risk - (intel ? 0 : 3) - (supplied ? 0 : 3), legitimacy: damage >= 17 ? 3 : -2 }); local({ security: 5, supply: -6, unrest: 4 });
            notes.push((intel ? '有效情報' : '未有有效情報') + '、' + (supplied ? '供給充足' : '供給不足') + '，對目標軍勢造成 ' + damage + ' 遊戲損耗。');
            if (target.truceUntil >= round) { add({ legitimacy: -12, influence: -6 }); factionChanges.hostility += 15; notes.push('攻擊仍在約期內的對象視為毀約，公信另減十二。'); }
        }
        if (p.id === 'diplomacy') { factionChanges.hostility = -power(22); factionChanges.relation = power(15); add({ legitimacy: 3, influence: -2 }); const term = ability.score >= 65 && state.resources.legitimacy >= 40 ? 2 : 1; factionChanges.truceUntil = Math.min(state.maxTurns, round + term - 1); promise('treaty', '盟約約定貢付', { grain: 3, treasury: 5 }, 2, target.id); notes.push('此約只約束 ' + target.name + '，有效至第 ' + factionChanges.truceUntil + ' 回合。'); }
        if (p.id === 'reform') { add({ administration: power(11), influence: -8, legitimacy: 2 }); local({ reformLevel: 1, unrest: 4 }); const dueTurn = Math.min(state.maxTurns, round + 2); events.push({ kind: 'delivery', id: 't' + round + ':reform', title: '制度試行後的交付', due: dueTurn, ownerId: executor.recordId, regionId: region.id, effects: { treasury: power(9), grain: power(7), welfare: 4 } }); notes.push('制度收益在第 ' + dueTurn + ' 回合結算；原政治評值不等於史實政績。'); }
        if (p.id === 'recruit') { add({ army: power(16), welfare: -4 }); local({ security: 4, supply: -4 }); promise('recruits', '新募人員續餉', { grain: 3, treasury: 3 }, 1, 'army'); }
        if (p.id === 'study') { add({ knowledge: power(15), administration: 3 }); local({ unrest: -2 }); notes.push('研習是本局準備程度；不計分引用真偽，也不自動生成史實。'); }
        if (p.id === 'rest') { add({ welfare: 3, army: 3, influence: 2 }); local({ unrest: -2 }); }
        if (sec.id === 'escort') local({ security: supportPower(6), supply: 3 });
        if (sec.id === 'ledger') add({ legitimacy: supportPower(5), influence: 4 });
        if (sec.id === 'compensate') { add({ welfare: 4, legitimacy: 2 }); promise('compensation', '徵調補償尾款', { treasury: 7 }, 1, 'civilians'); }
        if (sec.id === 'mediation') { add({ welfare: supportPower(5), influence: supportPower(6) }); local({ unrest: -6 }); }
        if (sec.id === 'counterintel') local({ intelUntil: Math.min(state.maxTurns, round + 1), unrest: -2 });
        if (sec.id === 'training') { add({ army: supportPower(8) }); local({ security: 3 }); }
        if (sec.id === 'archives') add({ knowledge: supportPower(7), administration: 2 });
        if (sec.id === 'bond') { add({ influence: 2 }); notes.push('合作信任只描述這局的共同經驗，並非聲稱兩位人物歷史上相識。'); }
        if (order.stance === 'bold') add({ influence: -3 });
        for (const [key, amount] of Object.entries(cost)) if (state.resources[key] < amount) errors.push(RESOURCE_LABELS[key] + ' 需先支付 ' + amount + '，目前只有 ' + state.resources[key] + '；不能預支本回合收益。');
        const anchor = order.anchorId === 'none' ? null : copy(executor.analysisAnchors.find(a => a.id === order.anchorId));
        const anchorApplication = interpretAnchor(state, order, anchor);
        if (anchorApplication) notes.push(anchorApplication.explanation);
        else if (anchor) notes.push('原文錨點「' + anchor.label + '」僅保留為受命者的閱讀與判斷脈絡，不提供屬性加分。');
        notes.push(ability.name + ' 的主要能力 ' + ability.score + '，來源：' + ability.origin + '。');
        return { order: copy(order), primary: p, secondary: sec, errors, cost, capacity: { used: capacity, limit: capacityLimit }, ability, supportAbility, notes, changes, regionChanges, factionChanges, events, obligations, due, anchor, anchorApplication };
    }
    function changeResources(state, effects) { const actual = {}; for (const [k, amount] of Object.entries(effects)) { const old = state.resources[k]; state.resources[k] = clamp(old + amount); actual[k] = state.resources[k] - old; } return actual; }
    function changeScale(object, effects) { for (const [k, value] of Object.entries(effects)) { if (['intelUntil', 'truceUntil'].includes(k)) object[k] = Math.max(object[k], value); else if (k === 'reformLevel') object[k] = Math.min(3, object[k] + value); else object[k] = clamp(object[k] + value); } }
    function act(state, log, kind, title, effects, extra) { const actual = changeResources(state, effects || {}); log.events.push({ kind, title, effects: actual, ...extra }); return actual; }
    function alterBond(state, a, b, value, breach = false) { const bond = bondFor(state, a, b); if (bond) { bond.trust = clamp(bond.trust + value); if (breach) bond.brokenPromises++; } }
    function settle(state, plan, log) {
        const ids = new Set(plan.due.map(c => c.id)); state.commitments = state.commitments.filter(c => !ids.has(c.id));
        for (const c of plan.due) {
            const owner = actorState(state, c.ownerId), otherActors = state.actors.filter(a => a.recordId !== c.ownerId && a.recordId !== state.config.soulId);
            if (plan.order.settlement === 'pay') { owner.loyalty = clamp(owner.loyalty + 5); act(state, log, 'promise-paid', '履行：' + c.title, { legitimacy: 3, influence: 2 }, { commitmentId: c.id, ownerId: c.ownerId, cost: c.cost }); otherActors.forEach(a => alterBond(state, c.ownerId, a.recordId, 2)); }
            else if (plan.order.settlement === 'defer') { c.deferred = true; c.due = Math.min(state.maxTurns, state.turn + 2); c.cost.treasury = (c.cost.treasury || 0) + 3; state.commitments.push(c); owner.loyalty = clamp(owner.loyalty - 3); act(state, log, 'promise-deferred', '協商延期：' + c.title, { legitimacy: -4, influence: -2 }, { commitmentId: c.id, ownerId: c.ownerId, nextDue: c.due, cost: c.cost }); }
            else { owner.loyalty = clamp(owner.loyalty - 10); const effects = { legitimacy: -8, influence: -5 }; if (c.beneficiary === 'army') effects.army = -8; if (c.beneficiary === 'civilians') effects.welfare = -8; const partner = factionState(state, c.beneficiary); if (partner) { partner.hostility = clamp(partner.hostility + 18); partner.relation = clamp(partner.relation - 12); partner.truceUntil = 0; } act(state, log, 'promise-broken', '公開違約：' + c.title, effects, { commitmentId: c.id, ownerId: c.ownerId }); otherActors.forEach(a => alterBond(state, c.ownerId, a.recordId, -4, true)); }
        }
    }
    function opponentTurn(state, plan, log) {
        const round = state.turn + 1;
        for (const faction of state.factions.filter(f => !f.player)) {
            let action, title, effects = {}, region = null;
            if (faction.truceUntil >= round) { action = 'truce'; title = faction.name + ' 依約暫停施壓並重整'; faction.strength = clamp(faction.strength + 2); faction.hostility = clamp(faction.hostility - 2); }
            else if (faction.strength <= 22) { action = 'regroup'; title = faction.name + ' 縮回據點補整'; faction.strength = clamp(faction.strength + 7); faction.hostility = clamp(faction.hostility + 3); }
            else if (faction.hostility <= 24 && state.resources.legitimacy >= 45) { action = 'exchange'; title = faction.name + ' 提供有限互惠交換'; effects.treasury = 3; faction.hostility = clamp(faction.hostility + 4); faction.strength = clamp(faction.strength + 1); }
            else if (faction.strategy === 'military') {
                region = [...state.regions].sort((a, b) => (a.security + (a.id === plan.order.regionId && plan.order.secondary === 'escort' ? 10 : 0)) - (b.security + (b.id === plan.order.regionId && plan.order.secondary === 'escort' ? 10 : 0)) || a.id.localeCompare(b.id))[0];
                const seen = region.intelUntil >= round, pressure = Math.max(1, Math.floor((faction.strength + faction.hostility - state.resources.army - region.security) / 16) + 3 + jitter(state, faction.id));
                const loss = Math.max(1, pressure - (seen ? 2 : 0) - (plan.order.secondary === 'counterintel' && plan.order.regionId === region.id ? 1 : 0));
                effects = { army: -loss, grain: -Math.max(0, loss - 2), welfare: region.security < 35 ? -3 : -1 }; region.security = clamp(region.security - loss); region.supply = clamp(region.supply - 2); faction.strength = clamp(faction.strength + 2 - Math.floor(state.resources.army / 30)); action = 'probe'; title = faction.name + ' 轉向防務較薄的 ' + region.name + (seen ? '，有效情報降低損失' : '，守軍臨時應對');
            } else if (faction.strategy === 'trade') {
                region = state.regions.find(r => r.kind === 'trade'); const loss = Math.max(1, Math.floor((faction.hostility + 65 - region.security - state.resources.administration / 3) / 18));
                const guarded = plan.order.secondary === 'escort' && plan.order.regionId === region.id; effects = { treasury: -Math.max(1, loss - (guarded ? 2 : 0)), grain: guarded ? 0 : -1 }; region.supply = clamp(region.supply - (guarded ? 1 : 3)); action = guarded ? 'tolls' : 'blockade'; title = faction.name + (guarded ? ' 改以通行費施壓，護運保住糧隊' : ' 提高商路成本並扣留部分運糧'); faction.strength = clamp(faction.strength + 1);
            } else {
                const cooperation = state.resources.influence >= 65 && state.resources.legitimacy >= 55;
                const shield = plan.order.secondary === 'counterintel' ? 2 : 0;
                if (cooperation) { effects = { treasury: 2, administration: 1 }; action = 'cooperate'; title = faction.name + ' 接受公開分工並協助交付'; faction.hostility = clamp(faction.hostility - 2); }
                else { effects = { influence: -Math.max(1, 3 - shield), legitimacy: state.resources.influence < 35 ? -2 : -1 }; region = state.regions.find(r => r.kind === 'heartland'); region.unrest = clamp(region.unrest + Math.max(0, 3 - shield)); action = 'obstruct'; title = faction.name + ' 要求重新分配授權，地方程序出現阻力'; }
                faction.strength = clamp(faction.strength + (cooperation ? -1 : 1));
            }
            faction.lastAction = title;
            const actual = changeResources(state, effects);
            log.opponents.push({ factionId: faction.id, sourceFactionId: faction.sourceFactionId, action, title, regionId: region ? region.id : null, effects: actual, hypothesis: true });
        }
    }
    function advanceSoul(state, plan, log) {
        if (!state.soul) return;
        const soul = state.soul, o = plan.order, before = copy(soul), host = actorState(state, soul.hostId);
        const style = o.approach === 'host' ? { adaptation: 2, tension: -4, selfhood: -2 } : o.approach === 'soul' ? { adaptation: 6, tension: 8, selfhood: 4 } : { adaptation: 4, tension: 2, selfhood: 1 };
        if (o.primary === 'study') { style.adaptation += 10; style.tension -= 3; }
        if (o.primary === 'rest') style.tension -= 3;
        if (o.secondary === 'bond') { style.tension -= 5; style.reputation = 4; }
        if (o.secondary === 'ledger') { style.tension -= 2; style.reputation = (style.reputation || 0) + 2; }
        if (plan.anchorApplication) { style.adaptation += plan.anchorApplication.effects.adaptation; style.tension += plan.anchorApplication.effects.tension; }
        style.tension += o.stance === 'bold' ? 4 : o.stance === 'prudent' ? -2 : 0;
        if (soul.adaptation >= 65 && o.approach !== 'host') style.tension -= 3;
        style.reputation = (style.reputation || 0) + (state.resources.legitimacy >= 60 ? 2 : state.resources.legitimacy < 35 ? -3 : 0);
        if (o.settlement === 'default') style.reputation -= 7;
        changeScale(soul, style);
        const contacts = state.actors.filter(a => ![soul.hostId, soul.soulId].includes(a.recordId));
        if (o.approach === 'soul' && soul.adaptation < 55) contacts.forEach(a => alterBond(state, soul.hostId, a.recordId, -2));
        if (o.secondary === 'bond') contacts.forEach(a => alterBond(state, soul.hostId, a.recordId, 3));
        if (soul.tension >= 65) { act(state, log, 'identity-pressure', '行事改變引起身邊人疑慮，需要合作與可交代的結果', { influence: -4, legitimacy: -2 }); host.loyalty = clamp(host.loyalty - 2); }
        else if (soul.adaptation >= 60) host.loyalty = clamp(host.loyalty + 1);
        log.soul = { before, after: copy(soul), approach: o.approach, note: '適應、聲望與身份張力都是本局遊戲狀態；不聲稱讀取歷史人物真實心理。' };
    }
    function finish(state) {
        const r = state.resources, contacts = state.bonds.filter(b => b.a === state.config.hostId || b.b === state.config.hostId), bondAverage = contacts.length ? Math.round(contacts.reduce((v, b) => v + b.trust, 0) / contacts.length) : 45;
        const collapsed = r.legitimacy === 0 || r.army === 0 || state.scarcityStreak >= 2 || state.soul && state.soul.tension >= 95 && bondAverage < 35;
        if (!collapsed && state.turn < state.maxTurns) return;
        state.status = collapsed ? 'collapsed' : 'completed';
        let id, title, summary;
        if (collapsed) { id = state.soul && state.soul.tension >= 95 && bondAverage < 35 ? 'identity-rupture' : 'order-collapse'; title = id === 'identity-rupture' ? '身份與關係決裂' : '秩序無法維繫'; summary = '本局的供給、防務、公信或身份關係越過臨界點；請從紀錄檢查累積失約與分配。'; }
        else if (state.soul) {
            if (state.soul.adaptation >= 65 && state.soul.tension < 55 && bondAverage >= 55 && r.legitimacy >= 45) { id = 'dual-concord'; title = '兩個生命，共同承擔'; summary = '新方法逐步適應宿主處境，社交圈也透過共同交付建立信任。'; }
            else if (state.soul.reputation >= 60 && r.knowledge >= 60 && r.administration >= 60) { id = 'situated-reformer'; title = '在處境中留下改革'; summary = '研習與制度改善產生交付，但適應與關係仍留下未解張力。'; }
            else if (state.soul.tension >= 70) { id = 'contested-identity'; title = '留下成果，也留下疑問'; summary = '局勢暫時維持，行事改變使身份與社交關係持續受質疑。'; }
            else { id = 'soul-survivor'; title = '守住新的日常'; summary = '在有限資源與多方壓力下度過這段處境，未形成穩固的新秩序。'; }
        } else {
            const enemies = state.factions.filter(f => !f.player), peaceful = enemies.filter(f => f.hostility <= 30 || f.truceUntil >= state.turn).length;
            if (enemies.filter(f => f.strength <= 35).length >= 2 && r.army >= 50 && r.welfare >= 35) { id = 'bounded-dominion'; title = '有限優勢，仍須治理'; summary = '兩方軍勢受到壓制，防務仍能維持；壓制不等於永久消滅對手。'; }
            else if (peaceful >= 2 && r.legitimacy >= 50 && r.welfare >= 45) { id = 'negotiated-order'; title = '多方共存的秩序'; summary = '至少兩方接受本局形成的利益安排，和平仍以履約與民生為條件。'; }
            else if (r.welfare >= 60 && r.administration >= 60 && r.legitimacy >= 55) { id = 'civil-foundation'; title = '先立民生，再議天下'; summary = '行政與民生建立較穩固的基礎，外部競爭仍存在。'; }
            else { id = 'fragile-balance'; title = '守住局面，留下難題'; summary = '完整走完本局，仍有需要下一階段處理的供給、授權或外部壓力。'; }
        }
        state.ending = { id, title, summary, turn: state.turn, gameOutcome: true, resources: copy(r), bondAverage, unresolved: state.commitments.map(c => c.title), sourceRefs: copy(state.config.setting.sourceRefs), notice: RULE_NOTICE };
    }
    function resolveInternal(state, order, existingPlan) {
        const plan = existingPlan || makePlan(state, order); if (plan.errors.length) fail('ORDER_DISABLED', plan.errors.join('\n'));
        const next = copy(state), round = state.turn + 1;
        const log = { turn: round, timeLabel: '第 ' + round + ' 旬（遊戲時間）', order: copy(order), title: plan.primary.title + '／' + rosterRecord(state, order.actorId).name + (order.secondary === 'none' ? '' : ' ＋ ' + plan.secondary.title + '／' + rosterRecord(state, order.supportId).name), cost: copy(plan.cost), capacity: copy(plan.capacity), abilities: [plan.ability, plan.supportAbility].filter(Boolean), notes: [...plan.notes], events: [], opponents: [], sourceRefs: copy(state.config.setting.sourceRefs), analysisAnchor: plan.anchor ? { recordId: order.actorId, ...plan.anchor, status: 'original-analysis-context-not-verified-fact' } : null, anchorApplication: copy(plan.anchorApplication), evidence: { eventId: state.config.setting.eventId, placeIds: [...state.config.setting.placeIds], factionIds: [...state.config.setting.factionIds], kind: state.config.setting.kind, simulation: true }, soul: null };
        act(next, log, 'payment', '執行前支付及到期款項', Object.fromEntries(Object.entries(plan.cost).map(([k, v]) => [k, -v])));
        settle(next, plan, log);
        act(next, log, 'primary-and-secondary', '主措施與配套交付', plan.changes);
        const region = regionState(next, order.regionId); changeScale(region, plan.regionChanges);
        if (order.targetFactionId !== 'none') changeScale(factionState(next, order.targetFactionId), plan.factionChanges);
        next.commitments.push(...copy(plan.obligations));
        for (const event of plan.events) { if (event.kind === 'delivery') next.pending.push(copy(event)); else act(next, log, 'final-commitment', event.title + '：終局當場履約', { legitimacy: 2 }, { cost: copy(event.cost) }); }
        const dueDeliveries = next.pending.filter(e => e.due <= round); next.pending = next.pending.filter(e => e.due > round);
        for (const delivery of dueDeliveries) { const local = regionState(next, delivery.regionId), impaired = local.security < 25; const effects = Object.fromEntries(Object.entries(delivery.effects).map(([k, v]) => [k, impaired ? Math.floor(v / 2) : v])); act(next, log, 'delivery', delivery.title + (impaired ? '（防務過低，只交付一半）' : ''), effects, { ownerId: delivery.ownerId, regionId: local.id }); }
        const upkeep = { grain: -(7 + (next.resources.army >= 75 ? 2 : 0)), treasury: -3 };
        const yieldEffect = { grain: next.resources.welfare >= 45 ? 4 : 2, treasury: next.resources.administration >= 65 ? 7 : next.resources.administration >= 40 ? 5 : 3 };
        act(next, log, 'upkeep', '例行軍民配給與行政維持', upkeep);
        act(next, log, 'production', '本局常規農務與府庫收入', yieldEffect);
        opponentTurn(next, plan, log);
        if (next.resources.welfare < 35) act(next, log, 'civilian-pressure', '民生低於三十五，徵調配合與公信受損', { legitimacy: -4, administration: -2 });
        if (next.resources.influence < 30) act(next, log, 'court-pressure', '議政支持不足三十，協調及公信受損', { legitimacy: -3 });
        const weakFronts = next.regions.filter(r => r.security < 30);
        if (weakFronts.length) act(next, log, 'frontier-pressure', weakFronts.map(r => r.name).join('、') + ' 防務不足三十，維持成本上升', { army: -2 * weakFronts.length, welfare: -weakFronts.length });
        for (const a of next.actors) {
            if (a.recordId === next.config.soulId) continue;
            const assigned = a.recordId === order.actorId || a.recordId === order.supportId;
            a.fatigue = clamp(a.fatigue + (assigned ? order.primary === 'rest' ? -14 : order.stance === 'bold' ? 18 : 12 : -9));
            if (assigned) { a.experience = clamp(a.experience + 4); a.commissions++; a.loyalty = clamp(a.loyalty + (next.resources.legitimacy >= 45 ? 2 : -2)); }
        }
        if (order.secondary !== 'none') { const bond = bondFor(next, order.actorId, order.supportId); if (bond) { bond.trust = clamp(bond.trust + (order.secondary === 'bond' ? 10 : 3)); bond.sharedTurns++; } }
        if (plan.anchorApplication) { const actor = actorState(next, order.actorId); actor.loyalty = clamp(actor.loyalty + plan.anchorApplication.effects.loyalty); if (order.supportId !== 'none') alterBond(next, order.actorId, order.supportId, plan.anchorApplication.effects.bond); }
        advanceSoul(next, plan, log);
        for (const r of next.regions) { r.supply = clamp(r.supply - 1); if (next.resources.welfare < 35) r.unrest = clamp(r.unrest + 3); if (r.unrest >= 70) { r.security = clamp(r.security - 3); act(next, log, 'local-unrest', r.name + ' 不安累積，交付秩序受損', { treasury: -2 }); } }
        next.scarcityStreak = next.resources.grain === 0 ? next.scarcityStreak + 1 : 0;
        if (next.scarcityStreak) act(next, log, 'scarcity', '糧儲耗盡，軍民承擔本回合缺口', { welfare: -8, army: -6, legitimacy: -4 });
        factionState(next, 'faction:player').strength = next.resources.army;
        log.delta = Object.fromEntries(Object.keys(RESOURCE_LABELS).map(k => [k, next.resources[k] - state.resources[k]]));
        log.after = copy(next.resources);
        next.turn = round; next.orders.push(copy(order)); next.log.push(log); finish(next);
        return next;
    }
    function validateSession(state) {
        try { safeJSON(state); if (!record(state) || state.version !== VERSION || !Array.isArray(state.orders) || state.orders.length > 12) fail('INVALID_SAVE', '存檔格式或版本錯誤。'); const config = normalizeConfig(state.config); let replay = initial(config); for (const order of state.orders) replay = resolveInternal(replay, order); if (canonical(replay) !== canonical(state)) fail('INVALID_SAVE', '資源、人物、來源或紀錄與逐回合重播不一致。'); return { valid: true, errors: [] }; }
        catch (error) { return { valid: false, errors: [error.message || '存檔驗證失敗。'] }; }
    }
    function assertSession(state) { const check = validateSession(state); if (!check.valid) fail('INVALID_SAVE', check.errors.join('\n')); }
    function resolveTurn(state, order) { assertSession(state); return resolveInternal(state, order); }
    function describeActions(state) { if (state) assertSession(state); return copy({ primary: PRIMARY, secondary: SECONDARY, stances: STANCES, settlements: SETTLEMENTS, approaches: state && state.config.mode !== 'soul' ? APPROACHES.slice(0, 1) : APPROACHES, principles: PRINCIPLES, resourceLabels: RESOURCE_LABELS, statLabels: STAT_LABELS, notice: RULE_NOTICE }); }
    function getActionPreview(state, order) {
        assertSession(state);
        let plan; try { plan = makePlan(state, order); } catch (error) { if (error.code !== 'INVALID_ORDER') throw error; return { valid: false, errors: [error.message], cost: {}, capacity: { used: 0, limit: state.resources.influence < 30 ? 5 : 6 }, notes: [], expected: null, consequences: [], abilities: [] }; }
        const result = { valid: plan.errors.length === 0, errors: [...plan.errors], cost: copy(plan.cost), capacity: copy(plan.capacity), notes: [...plan.notes], expected: null, consequences: [], abilities: [plan.ability, plan.supportAbility].filter(Boolean), due: copy(plan.due), newCommitments: copy(plan.obligations), anchorApplication: copy(plan.anchorApplication) };
        if (!result.valid) return result;
        const after = resolveInternal(state, order, plan), latest = after.log[after.log.length - 1];
        result.expected = { resources: copy(latest.delta), after: copy(after.resources), soul: copy(after.soul), factions: copy(after.factions), regions: copy(after.regions), ending: copy(after.ending) };
        result.consequences = [...latest.events.filter(e => !['payment', 'primary-and-secondary'].includes(e.kind)).map(e => e.title + (e.effects ? '：' + resourcesText(e.effects) : '')), ...latest.opponents.map(e => e.title + '：' + resourcesText(e.effects))];
        return result;
    }
    function getScene(state) {
        assertSession(state); const round = Math.min(state.maxTurns, state.turn + 1), due = dueFor(state);
        return { title: state.config.setting.title, mode: state.config.mode, round, total: state.maxTurns, status: state.status, timeLabel: '第 ' + round + ' 旬（遊戲時間，不換算為未經查證的歷史日期）', setting: copy(state.config.setting), resources: copy(state.resources), regions: copy(state.regions), factions: copy(state.factions), roster: state.config.roster.map(r => ({ ...copy(r), ...copy(actorState(state, r.recordId)), embodied: r.recordId !== state.config.soulId, historyUrl: '/history-lab?record=' + encodeURIComponent(r.recordId), archiveUrl: '/source-archive#tab=people&person=' + encodeURIComponent(r.recordId) })), soul: copy(state.soul), due: copy(due), pending: copy(state.pending), pressures: [{ id: 'civilian', title: '民生需求', value: state.resources.welfare, description: '低於三十五使公信與行政受損。' }, { id: 'court', title: '議政支持', value: state.resources.influence, description: '低於三十，協調容量降為五且公信受損。' }, { id: 'frontier', title: '最薄弱防區', value: Math.min(...state.regions.map(r => r.security)), description: '任一地域防務低於三十，軍民維持成本上升。' }], notice: RULE_NOTICE };
    }
    function defaultOrder(state) {
        assertSession(state); const available = state.config.roster.filter(r => r.recordId !== state.config.soulId);
        return { primary: 'rest', secondary: 'none', actorId: state.config.mode === 'soul' ? state.config.hostId : available[0].recordId, supportId: 'none', regionId: state.regions[0].id, targetFactionId: 'none', stance: 'balanced', settlement: dueFor(state).length ? 'pay' : 'none', approach: 'host', anchorId: 'none' };
    }
    function exportSession(state) { assertSession(state); return { format: 'dynasty-world-save', version: VERSION, state: copy(state) }; }
    function importSession(value) { if (typeof value === 'string') { if (value.length > 1600000) fail('INVALID_SAVE', '存檔超過大小限制。'); try { value = JSON.parse(value); } catch (_) { fail('INVALID_SAVE', '不是有效的 JSON 存檔。'); } } safeJSON(value); if (!record(value) || Object.keys(value).length !== 3 || value.format !== 'dynasty-world-save' || value.version !== VERSION || !own(value, 'state')) fail('INVALID_SAVE', '存檔封套格式或版本錯誤。'); assertSession(value.state); return copy(value.state); }
    function reduce(state, action) { if (!record(action) || action.type !== 'turn' || Object.keys(action).some(k => !['type', 'order'].includes(k))) fail('INVALID_ORDER', '只支援 turn 動作。'); return resolveTurn(state, action.order); }
    return freeze({ VERSION, RULE_NOTICE, RESOURCE_LABELS, STAT_LABELS, createSession, validateSession, importSession, exportSession, resolveTurn, reduce, describeActions, getActionPreview, getScene, defaultOrder });
});
