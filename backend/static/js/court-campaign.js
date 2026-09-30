(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyCampaign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const SCENARIO = 'court-grain-v3', TURNS = 6;
    const RESOURCES = ['grain', 'treasury', 'people', 'defense'];
    const NAMES = { grain: '糧儲', treasury: '國庫', people: '民心', defense: '邊防' };
    const source = (chapter, title) => [{ title, url: 'https://zh.wikisource.org/zh-hant/史記/卷' + chapter }];
    const ADVISORS = [
        { id: 'hanXin', type: 'general', name: '韓信', role: '佯動、地形與指揮權', portrait: '/static/game/court/han-xin.png', stance: '先辨敵人的視野與糧隊時序，再決定在哪裡交戰。', lesson: '臨機授權增加護運與奇襲威力，也有抽調巡防的成本。', profile: { drive: '取得能對戰果負責的指揮權。', strength: '臨機調糧多送遠倉；護運與奇襲利用地形，偵察後更有效。', blindSpot: '集中兵力會留下巡防缺口，強徵也損害民間。', relationship: '與蕭何共同交付後可形成供給與護運的合作。' }, sources: source('092', '史記卷九十二：淮陰侯列傳') },
        { id: 'xiaoHe', type: 'minister', name: '蕭何', role: '圖籍、倉儲與接續供給', portrait: '/static/game/court/xiao-he.png', stance: '先核對倉與人，再讓每一批交付有明確運期。', lesson: '近倉與遠倉不同；部署軍隊也要安排接續糧。', profile: { drive: '讓人員與物資持續交付。', strength: '近倉即時多開、採買減價；外勤護運可接續額外糧隊。', blindSpot: '善於供給，突擊戰力較小；徵役仍有農時代價。', relationship: '替具體糧隊作保會累積共同責任，不是永久同盟。' }, sources: source('053', '史記卷五十三：蕭相國世家') },
        { id: 'weiZheng', type: 'minister', name: '魏徵', role: '進諫、查核與履約', portrait: '/static/game/court/wei-zheng.png', stance: '限額與補償必須能核對；反對仍可依職責執行。', lesson: '公開帳簿與實際付款是兩件事。', profile: { drive: '使朝廷正視理由、偏私與已答應的代價。', strength: '限額徵糧減少傷害，公開稽核與可信盟約增進民間合作。', blindSpot: '查核減慢收取；奇襲不以掠奪民戶增加戰果。', relationship: '記住誰負責失約，也承認別人的具體交付。' }, sources: [{ title: '諫太宗十思疏', url: 'https://zh.wikisource.org/zh-hant/諫太宗十思疏' }] },
        { id: 'zhangLiang', type: 'minister', name: '張良', role: '時機、情報與分散敵勢', portrait: '/static/game/court/zhang-liang.png', stance: '不急著押上主力；先使敵人的判斷與部署出現縫隙。', lesson: '情報準備能改變一次奇襲的代價與效果。', profile: { drive: '用局勢與時序打開可行的選擇。', strength: '偵察延長情報，已知敵情時奇襲加強；外交削弱敵方凝聚。', blindSpot: '未經偵察的計策收益有限，內政直接徵取較少。', relationship: '與將領共事可把情報轉為行動，須共同交付才累積合作。' }, sources: source('055', '史記卷五十五：留侯世家') },
        { id: 'chenPing', type: 'minister', name: '陳平', role: '離間、財用與暗線', portrait: '/static/game/court/chen-ping.png', stance: '聯盟有各自的得失；打開暗線要付費，也要承擔程序代價。', lesson: '離間能降凝聚，不能自動取代守路與供給。', profile: { drive: '找出僵局中的利益裂縫。', strength: '採買議價、追出隱帳；外勤離間削弱敵方凝聚並延長情報。', blindSpot: '秘密經費與暗線降低朝廷、地方官的合作。', relationship: '與公開查核者合作有張力；共同命令仍可形成實績。' }, sources: source('056', '史記卷五十六：陳丞相世家') },
        { id: 'sunWu', type: 'general', name: '孫武', role: '練兵、情報與節制交戰', portrait: '/static/game/court/sun-wu.png', stance: '先算補給與地形；不知敵情時，不把奇襲當作必勝。', lesson: '整訓與偵察能降低損失，拒絕無準備的衝動。', profile: { drive: '使準備與代價先於交戰。', strength: '整訓顯著提高地域安全；有情報時奇襲更強，護運節省損耗。', blindSpot: '無情報的奇襲效能反而較低；徵糧優先軍需損民心。', relationship: '情報與制度的合作者能補足軍中準備，沒有固定搭配。' }, sources: source('065', '史記卷六十五：孫子吳起列傳') },
        { id: 'shangYang', type: 'minister', name: '商鞅', role: '編戶、執法與動員', portrait: '/static/game/court/shang-yang.png', stance: '標明責任與賞罰，動員才有可執行的規則。', lesson: '徵取與整訓強度提高，也會增加民戶承受的代價。', profile: { drive: '建立可執行、責任清楚的制度。', strength: '徵糧量大、稽核追款、整訓提高安全；戶籍供給改善地方運作。', blindSpot: '嚴厲執法損民間與官吏合作；外交彈性小。', relationship: '嚴格規則能與補償共存，但兌現承諾仍須真實付款。' }, sources: source('068', '史記卷六十八：商君列傳') },
        { id: 'suQin', type: 'minister', name: '蘇秦', role: '盟約、商路與聯盟裂縫', portrait: '/static/game/court/su-qin.png', stance: '看清各方要保住什麼，再讓盟約有互相牽制的條件。', lesson: '停戰有期限；一方議和不能保證另一方停止行動。', profile: { drive: '以利益安排改變強弱關係。', strength: '採買議價、出使削弱聯盟凝聚，容易取得兩回合休戰。', blindSpot: '直接奇襲威力小，失信會迅速侵蝕盟約條件。', relationship: '能把商戶與軍中合作轉為外交籌碼，仍需守約。' }, sources: source('069', '史記卷六十九：蘇秦列傳') }
    ];
    const IDS = ADVISORS.map(a => a.id);
    const STAKEHOLDERS = [
        { id: 'army', name: '邊軍', concern: '護運兵力、續餉與軍糧順位。' },
        { id: 'farmers', name: '農戶', concern: '徵取限額、農時與補償到帳。' },
        { id: 'merchants', name: '商戶', concern: '價格、合約與商路安全。' },
        { id: 'officials', name: '地方官與倉吏', concern: '戶籍、人手與查核責任。' },
        { id: 'court', name: '朝廷議政者', concern: '授權範圍、暗線經費與公開程序。' }
    ];
    const FRONT_INFO = [
        { id: 'granary', name: '腹地糧倉', description: '核心庫存與民戶所在；失守會直接損糧與民心。' },
        { id: 'pass', name: '北境關隘', description: '北騎的主要進路；安全影響官倉運輸與北境防禦。' },
        { id: 'river', name: '河道商路', description: '商糧與渡口所在；河盟可封航，也可能轉攻腹地。' }
    ];
    const ENEMY_INFO = [
        { id: 'northern', name: '朔原騎軍', fronts: ['pass', 'granary'], description: '架空北境勢力：尋找薄弱關隘與缺糧地區，糧乏時掠糧，守備強時轉向試探。' },
        { id: 'riverLeague', name: '赤汀河盟', fronts: ['river', 'granary'], description: '架空渡口聯盟：封鎖商路牟利，凝聚低時撤圍重整；可離間與議和。' }
    ];
    const PRIMARY = [
        { id: 'route', title: '修復糧道、調撥官倉', description: '先開近倉，再由北境官道送遠倉；地域安全影響後批交付。', capacity: 2, cost: { treasury: 10 } },
        { id: 'market', title: '採買商糧', description: '商戶合作影響價格，河道安全影響後批商糧。', capacity: 2, cost: { treasury: 14 } },
        { id: 'levy', title: '限額徵集民糧', description: '快速補庫；徵取方式與補償改變民戶合作。', capacity: 2, cost: {} },
        { id: 'ration', title: '重排既有配給', description: '不產生新糧。資源不足仍可暫緩非急需發放，承擔軍民順位的代價。', capacity: 1, cost: {} },
        { id: 'audit', title: '查核倉儲與漏帳', description: '追出既有漏糧與款項；每次稽核可追回的基礎數量遞減。', capacity: 2, cost: { treasury: 4 } },
        { id: 'fortify', title: '增援關隘、接續糧餉', description: '提高關隘安全與邊防，下一回合須明確支付三糧、三國庫續餉。', capacity: 3, cost: { grain: 6, treasury: 6 } },
        { id: 'diplomacy', title: '分別議和、爭取運糧', description: '削弱兩方凝聚；有防務或可信條款才能使短期停戰成立。', capacity: 2, cost: { grain: 1, treasury: 6 } }
    ];
    const SUPPLEMENTS = [
        { id: 'none', title: '不加配套', description: '保留人手；不自動履行到期承諾。', capacity: 0, cost: {} },
        { id: 'relief', title: '民戶緊急賑濟', description: '支付五糧、兩國庫，減輕農戶負擔。', capacity: 2, cost: { grain: 5, treasury: 2 } },
        { id: 'reserve', title: '保留護衛軍糧', description: '支付三糧，提高邊防與兩條運路安全。', capacity: 1, cost: { grain: 3 } },
        { id: 'ledger', title: '公開糧帳與限額', description: '支付兩國庫，留下交付與配給紀錄；不代替補償付款。', capacity: 1, cost: { treasury: 2 } },
        { id: 'vouchers', title: '開立徵糧補償憑券', description: '限額徵糧專用，現在付一國庫，下回合到期支付八國庫。', capacity: 1, cost: { treasury: 1 } },
        { id: 'settle', title: '付清到期承諾', description: '本回合成本包含全部到期帳單，占一份人手。', capacity: 1, cost: {} },
        { id: 'default', title: '公開撤回到期承諾', description: '資源不足時的退路；失約責任與民間後果會結算。', capacity: 0, cost: {} }
    ];
    const AUTHORITIES = [
        { id: 'bounded', title: '本回合共同限額授權', description: '內政執行者與外勤統領共同遵守核定限額與既定程序；兩人均記錄授權與收權。' },
        { id: 'flexible', title: '本回合共同臨機授權', description: '內政與外勤共同容許調整時序，付出程序與權力集中的代價；不能同時開立限額補償憑券。' }
    ];
    const MISSIONS = [
        { id: 'none', title: '暫不派外勤', description: '不付外勤成本，統領與地域均須選無。', capacity: 0, cost: {} },
        { id: 'recon', title: '偵察敵情', description: '一國庫，查明目標地域敵情兩回合；情報降低遇襲損失並加強奇襲。', capacity: 1, cost: { treasury: 1 } },
        { id: 'escort', title: '護送糧隊', description: '三糧、兩國庫，提高路線安全與供給；敵方可能轉向另一條弱路。', capacity: 2, cost: { grain: 3, treasury: 2 } },
        { id: 'drill', title: '整訓與守望', description: '兩糧、三國庫，建立持續地域安全；需要維持供給才有完整效果。', capacity: 2, cost: { grain: 2, treasury: 3 } },
        { id: 'raid', title: '截斷敵方補給', description: '四糧、四國庫，削弱目標敵方的軍力與供給；未知敵情增加損失。', capacity: 3, cost: { grain: 4, treasury: 4 } },
        { id: 'envoy', title: '出使與拆解聯盟', description: '三國庫，削弱敵方凝聚；外交能力、守備與民心決定休戰。', capacity: 2, cost: { treasury: 3 } }
    ];
    const TITLES = ['雨中急報', '糧道分兵', '兩面試探', '盟約與裂縫', '守路與反擊', '最後的交付'];
    const DESCRIPTIONS = ['連雨阻斷供給，兩方敵勢各自逼近。八位跨時代人物參與同一架空朝堂；本局不是歷史事件重演。', '昨日糧隊開始回報，敵方重新選擇薄弱進路。內政與外勤須由不同人物負責。', '兩條戰線各有利益，守住一處可能讓敵方轉向腹地。情報和地域供給會改變交戰損失。', '敵方聯盟未必團結，停戰有期限；到期帳單也不能被一紙盟約抹去。', '前三地的安全與供給已累積不同結果。可以進攻、護運或議和，也要為軍民留足餘糧。', '本回合新運輸當場交付，新承諾須當場備款；六次議政的責任與戰線一併結算。'];
    function copy(v) { return JSON.parse(JSON.stringify(v)); }
    function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
    function clamp(n) { return Math.max(0, Math.min(100, n)); }
    function add(target, effects) { Object.entries(effects || {}).forEach(([k, v]) => { target[k] = (target[k] || 0) + v; }); }
    function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
    function name(id) { return ADVISORS.find(a => a.id === id).name; }
    function text(values) { return Object.entries(values).filter(([, n]) => n).map(([k, n]) => NAMES[k] + ' ' + (n > 0 ? '+' : '') + n).join('、') || '無資源變化'; }
    function costText(values) { return Object.entries(values).filter(([, n]) => n).map(([k, n]) => NAMES[k] + ' ' + n).join('、') || '無付款'; }
    function pair(a, b) { return [a, b].sort().join(':'); }
    function memory() { return { mandate: null, commissions: 0, missions: 0, honored: 0, breached: 0, events: [] }; }
    function createGame() {
        const trust = {}, actorMemory = {}, relations = {};
        IDS.forEach(id => { trust[id] = 50; actorMemory[id] = memory(); });
        IDS.forEach((id, i) => IDS.slice(i + 1).forEach(other => { relations[pair(id, other)] = 50; }));
        return { version: 3, scenario: SCENARIO, turn: 0, resources: { grain: 48, treasury: 78, people: 56, defense: 52 }, trust,
            stakeholders: { army: 50, farmers: 50, merchants: 50, officials: 50, court: 50 }, actorMemory, relations,
            fronts: { granary: { security: 62, supply: 64, intelUntil: 0 }, pass: { security: 48, supply: 42, intelUntil: 0 }, river: { security: 44, supply: 58, intelUntil: 0 } },
            enemies: { northern: { strength: 66, supply: 48, cohesion: 64, truceUntil: 0, lastAction: '尚未接戰' }, riverLeague: { strength: 54, supply: 58, cohesion: 56, truceUntil: 0, lastAction: '尚未接戰' } },
            log: [], pending: [], commitments: [] };
    }
    function dueFor(state) { return state.commitments.filter(c => c.due <= state.turn + 1); }
    function primary(id) { return PRIMARY.find(p => p.id === id); }
    function frontName(id) { return FRONT_INFO.find(f => f.id === id).name; }
    function enemyForFront(id) { return id === 'river' ? 'riverLeague' : 'northern'; }
    function frontAdd(plan, id, effects) { if (!plan.frontEffects[id]) plan.frontEffects[id] = {}; add(plan.frontEffects[id], effects); }
    function enemyAdd(plan, id, effects) { if (!plan.enemyEffects[id]) plan.enemyEffects[id] = {}; add(plan.enemyEffects[id], effects); }
    function record(v) { if (!v || typeof v !== 'object' || Array.isArray(v)) return false; const proto = Object.getPrototypeOf(v); return proto === Object.prototype || proto === null; }
    const FIELDS = ['primary', 'supplement', 'executor', 'authority', 'mission', 'commander', 'front'];
    function legalOrderShape(order) { return record(order) && Object.keys(order).length === FIELDS.length && FIELDS.every(k => Object.prototype.hasOwnProperty.call(order, k) && typeof order[k] === 'string' && order[k].length <= 40); }
    function knownOrder(order) { return legalOrderShape(order) && PRIMARY.some(p => p.id === order.primary) && SUPPLEMENTS.some(s => s.id === order.supplement) && IDS.includes(order.executor) && AUTHORITIES.some(a => a.id === order.authority) && MISSIONS.some(m => m.id === order.mission) && (order.mission === 'none' ? order.commander === 'none' && order.front === 'none' : IDS.includes(order.commander) && FRONT_INFO.some(f => f.id === order.front)); }
    function responsesFor(state, o) {
        return ADVISORS.map(a => {
            let position = 'conditional', reason = a.stance, condition = '';
            if (a.id === 'hanXin') { position = ['route', 'fortify'].includes(o.primary) || ['escort', 'raid'].includes(o.mission) ? 'support' : 'conditional'; condition = o.mission === 'raid' && state.fronts[o.front].intelUntil < state.turn + 1 ? '未知敵情的奇襲會增加損失。' : '軍糧與護衛不能重複使用。'; }
            if (a.id === 'xiaoHe') { position = ['route', 'market', 'audit'].includes(o.primary) || o.mission === 'escort' ? 'support' : 'conditional'; condition = '先付款、再收糧；在途交付不能倒填本次預算。'; }
            if (a.id === 'weiZheng') { position = o.supplement === 'default' || o.primary === 'levy' && o.supplement !== 'vouchers' ? 'oppose' : o.authority === 'bounded' ? 'support' : 'conditional'; condition = o.supplement === 'default' ? '失約紀錄會留在原責任人，不因這次換人而消失。' : '公開帳簿不是補償到帳。'; }
            if (a.id === 'zhangLiang') { position = ['recon', 'envoy'].includes(o.mission) || o.primary === 'diplomacy' ? 'support' : 'conditional'; condition = '偵察的有效期與敵方凝聚決定計策的窗口。'; }
            if (a.id === 'chenPing') { position = o.mission === 'envoy' || o.primary === 'audit' ? 'support' : 'conditional'; condition = '暗線需要經費，並降低程序相關的合作。'; }
            if (a.id === 'sunWu') { const unknown = o.mission === 'raid' && state.fronts[o.front].intelUntil < state.turn + 1; position = unknown ? 'oppose' : ['recon', 'drill', 'escort'].includes(o.mission) ? 'support' : 'conditional'; condition = unknown ? '不知敵情就突擊，損失較高、我的戰果較少。' : '地域供給不足三十，整訓效果減弱。'; }
            if (a.id === 'shangYang') { position = ['levy', 'fortify', 'audit'].includes(o.primary) || o.mission === 'drill' ? 'support' : 'conditional'; condition = '提高徵取與動員強度，也會付出民間合作的代價。'; }
            if (a.id === 'suQin') { position = o.primary === 'diplomacy' || o.mission === 'envoy' || o.primary === 'market' ? 'support' : 'conditional'; condition = '分別計算兩方休戰；一方承諾不約束另一方。'; }
            return { id: a.id, position, reason: '遊戲改編：' + reason, condition };
        });
    }
    function buildPlan(state, o) {
        if (state.turn >= TURNS) fail('GAME_COMPLETE', '六回合戰役已完成。');
        if (!knownOrder(o)) fail('INVALID_ORDER', '政令須完整包含七項：主措施、配套、執行者、授權、外勤、統領與地域；無外勤時統領與地域均為無。');
        const p = primary(o.primary), s = SUPPLEMENTS.find(a => a.id === o.supplement), m = MISSIONS.find(a => a.id === o.mission), round = state.turn + 1;
        const plan = { order: copy(o), title: p.title + '／' + name(o.executor) + (m.id === 'none' ? ' · 不派外勤' : ' ＋ ' + m.title + '／' + name(o.commander) + ' · ' + frontName(o.front)), description: p.description,
            cost: copy(p.cost), gains: {}, approval: {}, frontEffects: {}, enemyEffects: {}, truce: {}, intel: {}, protection: {}, notes: [], conditions: [], disabled: [], events: [], newCommitments: [], finalCommitments: [], due: copy(dueFor(state)), responses: responsesFor(state, o) };
        add(plan.cost, s.cost); add(plan.cost, m.cost);
        let capacity = p.capacity + s.capacity + m.capacity;
        const limit = state.stakeholders.court < 30 ? 5 : 6;
        if (m.id !== 'none' && o.executor === o.commander) plan.disabled.push('內政執行者與外勤統領須由不同人物負責，不能同時在朝堂與前線執行兩份職務。');
        if (plan.due.length && !['settle', 'default'].includes(s.id)) plan.disabled.push('本回合有到期承諾，配套須選付清或公開撤回。');
        if (!plan.due.length && ['settle', 'default'].includes(s.id)) plan.disabled.push('本回合沒有到期承諾。');
        if (s.id === 'vouchers' && p.id !== 'levy') plan.disabled.push('補償憑券只配徵糧。');
        if (s.id === 'vouchers' && o.authority !== 'bounded') plan.disabled.push('核定限額的補償憑券與臨機授權互斥。');
        if (state.trust[o.executor] < 35) { capacity++; plan.conditions.push('執行者信任低於三十五，多占一份責任確認人手。'); }
        if (m.id !== 'none' && state.trust[o.commander] < 35) { capacity++; plan.conditions.push('統領信任低於三十五，多占一份外勤確認人手。'); }
        const assigned = m.id === 'none' ? [o.executor] : [...new Set([o.executor, o.commander])];
        assigned.forEach(id => { if (state.actorMemory[id].mandate === 'flexible' && o.authority === 'bounded') plan.conditions.push(name(id) + '曾獲臨機權，本次收回為限額；' + (s.id === 'ledger' ? '公開交接免扣收權信任，本次任命信任另加一。' : '未公開交接，收權信任減四；本次任命信任另加一。')); });
        if (p.id === 'route' && state.stakeholders.officials < 30) { capacity++; plan.conditions.push('地方官合作低於三十，修路多占一份人手。'); }
        const event = (title, effects, owner, front, protectedConvoy) => plan.events.push({ id: 't' + round + '-e' + plan.events.length, title, due: Math.min(TURNS, round + 1), effects, owner, front: front || 'none', protected: !!protectedConvoy, partners: protectedConvoy && owner === o.executor && o.mission === 'escort' && o.front === front && o.executor !== o.commander ? [o.executor, o.commander] : [], sourceTurn: round });
        const commitment = (type, title, cost, honorEffects, breachEffects, beneficiary) => { const c = { id: 't' + round + '-' + type, type, title, cost, honorEffects, breachEffects, owner: o.executor, beneficiary, sourceTurn: round, due: Math.min(TURNS, round + 1) }; if (round === TURNS) { add(plan.cost, cost); add(plan.gains, honorEffects); add(plan.approval, { [beneficiary]: 7 }); plan.finalCommitments.push(c); plan.notes.push('末回合「' + title + '」須當場備款並履約，付款已納入成本。'); } else plan.newCommitments.push(c); };
        if (p.id === 'route') { add(plan.gains, { grain: 14, people: -2 }); add(plan.approval, { merchants: 4, farmers: -3, officials: 2 }); frontAdd(plan, 'pass', { security: 4, supply: 5 }); event('北境官道的遠倉糧隊', { grain: 12 }, o.executor, 'pass', o.mission === 'escort' && o.front === 'pass'); }
        if (p.id === 'market') { const price = state.stakeholders.merchants < 40 ? 4 : state.stakeholders.merchants >= 65 ? -3 : 0; add(plan.cost, { treasury: price }); add(plan.gains, { grain: 20 }); add(plan.approval, { merchants: 7, farmers: 2 }); frontAdd(plan, 'river', { supply: 4 }); event('河道合約的後批商糧', { grain: 6 }, o.executor, 'river', o.mission === 'escort' && o.front === 'river'); plan.conditions.push('商戶合作 ' + state.stakeholders.merchants + '，基本採買款 ' + (14 + price) + ' 國庫，再按執行者調整。'); }
        if (p.id === 'levy') { const hidden = state.stakeholders.farmers < 35 ? 6 : 0; add(plan.gains, { grain: 22 - hidden, people: -9, defense: 2 }); add(plan.approval, { farmers: -12, army: 5 }); frontAdd(plan, 'granary', { supply: -6 }); if (hidden) plan.conditions.push('農戶合作低於三十五，藏糧使徵取少六糧。'); if (s.id !== 'vouchers') event('未補償徵糧的回聲', { grain: -2, people: -3 }, o.executor); }
        if (p.id === 'ration') { add(plan.approval, { farmers: 2, army: -3 }); plan.notes.push('重排配給沒有新增糧；每回合基本耗糧仍會結算。'); }
        if (p.id === 'audit') { const count = state.log.filter(e => e.order.primary === 'audit').length; const recovered = Math.max(0, 8 - count * 2); add(plan.gains, { grain: recovered, treasury: Math.max(2, 10 - count * 2), people: 2 }); add(plan.approval, { officials: -6, farmers: 3 }); frontAdd(plan, 'granary', { supply: 4 }); plan.conditions.push('此前已稽核 ' + count + ' 次，本次基礎追回 ' + recovered + ' 糧，不能無限追回同一批漏糧。'); }
        if (p.id === 'fortify') { add(plan.gains, { defense: 10 }); add(plan.approval, { army: 7, farmers: -2 }); frontAdd(plan, 'pass', { security: 10, supply: 8 }); commitment('maintenance', '關隘接續糧餉', { grain: 3, treasury: 3 }, { defense: 3 }, { defense: -9, people: -3 }, 'army'); }
        if (p.id === 'diplomacy') { ENEMY_INFO.forEach(e => enemyAdd(plan, e.id, { cohesion: -5 })); add(plan.approval, { merchants: 3, court: 2 }); if (state.resources.defense >= 60 && state.resources.people >= 45) { ENEMY_INFO.forEach(e => { plan.truce[e.id] = round; }); plan.notes.push('守備至少六十且民心至少四十五，兩方接受本回合短暫停戰；下回合可能再動。'); } else plan.conditions.push('基本議和需邊防六十、民心四十五才有可靠的一回合休戰；目前只削弱敵方凝聚。'); }
        domesticMethod(state, o, plan, event);
        if (s.id === 'relief') { add(plan.gains, { people: 8 }); add(plan.approval, { farmers: 9, army: -2 }); frontAdd(plan, 'granary', { supply: 5 }); }
        if (s.id === 'reserve') { add(plan.gains, { defense: 4 }); add(plan.approval, { army: 5 }); frontAdd(plan, 'pass', { security: 3 }); frontAdd(plan, 'river', { security: 3 }); }
        if (s.id === 'ledger') { add(plan.gains, { people: 3 }); add(plan.approval, { court: 4, farmers: 3, officials: -3 }); plan.notes.push('公開交付與徵取限額；帳簿不是補償到帳。'); }
        if (s.id === 'vouchers') { add(plan.gains, { people: 4 }); add(plan.approval, { farmers: 6 }); commitment('compensation', '徵糧補償憑券', { treasury: 8 }, { people: 5 }, { people: -11 }, 'farmers'); }
        if (s.id === 'settle') plan.due.forEach(c => add(plan.cost, c.cost));
        plan.due.forEach(c => add(plan.gains, s.id === 'settle' ? c.honorEffects : s.id === 'default' ? c.breachEffects : {}));
        if (o.authority === 'flexible') { add(plan.gains, { people: -2 }); add(plan.approval, { court: o.executor === 'hanXin' ? -6 : -4 }); plan.notes.push('臨機授權：民心減二、朝廷合作下降，責任仍記在執行者。'); if (o.executor === 'hanXin' && p.id === 'route') capacity++; }
        if (m.id !== 'none') missionMethod(state, o, plan, event);
        const priorDelivery = state.log.some(entry => entry.jointDeliveries.some(delivery => delivery.front === 'pass' && delivery.title === '北境官道的遠倉糧隊' && delivery.partners.includes(o.executor) && delivery.partners.includes(o.commander)));
        if (m.id !== 'none' && p.id === 'route' && m.id === 'escort' && o.front === 'pass' && state.relations[pair(o.executor, o.commander)] >= 56 && priorDelivery) { plan.events[0].effects.grain += 3; plan.notes.push('兩位任命者已有共同官道交付且合作至少五十六，沿用交接名冊，官道糧隊多三糧。'); }
        plan.capacity = { used: capacity, limit };
        if (capacity > limit) plan.disabled.push('人手需要 ' + capacity + '，目前協調上限 ' + limit + '；請減少配套或外勤。');
        Object.entries(plan.cost).forEach(([k, n]) => { if (n < 0) plan.cost[k] = 0; else if (n > state.resources[k]) plan.disabled.push(NAMES[k] + '需支付 ' + n + '，現有 ' + state.resources[k] + '；尚未到手的收益不能支付成本。'); });
        plan.effects = Object.fromEntries(RESOURCES.map(k => [k, clamp(state.resources[k] + (plan.gains[k] || 0) - (plan.cost[k] || 0)) - state.resources[k]]));
        plan.stakeholderResponses = STAKEHOLDERS.map(f => { const debt = plan.due.some(c => c.beneficiary === f.id), change = plan.approval[f.id] || 0; return { id: f.id, position: debt && s.id === 'default' || change < -2 ? 'oppose' : debt && s.id === 'settle' || change > 2 ? 'support' : 'conditional', reason: f.concern + ' 本令即時合作 ' + (change >= 0 ? '+' : '') + change + (debt ? '；到期帳單將' + (s.id === 'settle' ? '付款' : s.id === 'default' ? '撤回並失信' : '等待明確決定') : '') + '。' }; });
        return plan;
    }
    function domesticMethod(state, o, plan, event) {
        const p = o.primary, id = o.executor, flexible = o.authority === 'flexible';
        const notes = [];
        const distant = amount => { if (plan.events[0]) plan.events[0].effects.grain += amount; };
        if (id === 'hanXin') {
            if (p === 'route') { add(plan.cost, { grain: flexible ? 2 : 1 }); distant(flexible ? 12 : 4); frontAdd(plan, 'pass', { security: flexible ? -4 : -1 }); notes.push(flexible ? '利用地形佯動，遠倉多十二糧；抽調巡防使關隘安全少四，另占一份人手。' : '按核定路線護運，遠倉多四糧，抽調巡防使安全少一。'); }
            if (p === 'market') { add(plan.cost, { grain: 1 }); distant(4); add(plan.gains, { defense: -2 }); notes.push('集中軍隊護商糧，後批多四，其他巡防少二邊防。'); }
            if (p === 'levy') { add(plan.gains, { grain: 5, defense: 3, people: -3 }); notes.push('沿軍道迅速徵集，多五糧、三邊防，民心另減三。'); }
            if (p === 'ration') { add(plan.gains, { defense: 3, people: -2 }); notes.push('在既有配給中優先護衛，無新增糧，民間順位後移。'); }
            if (p === 'audit') { add(plan.gains, { grain: 5 }); add(plan.approval, { army: -3 }); notes.push('查軍中轉運帳，多追回五糧，軍中合作減三。'); }
            if (p === 'fortify') { add(plan.gains, { defense: 7 }); frontAdd(plan, 'pass', { security: 4 }); notes.push('按地形安排增援，多七邊防、四關隘安全。'); }
            if (p === 'diplomacy') { if (state.resources.defense >= 50) ENEMY_INFO.forEach(e => enemyAdd(plan, e.id, { cohesion: -6 })); notes.push('以現有守備作後盾；邊防達五十，兩方凝聚再減六，未達則沒有額外威勢。'); }
        }
        if (id === 'xiaoHe') {
            if (p === 'route') { add(plan.gains, { grain: 5 }); distant(4); notes.push('圖籍分辨近遠倉，近倉多五糧，遠倉多四糧；民夫農時仍有代價。'); }
            if (p === 'market') { add(plan.cost, { treasury: -4 }); distant(2); notes.push('核對分批合約，採買少付四國庫，後批多二糧。'); }
            if (p === 'levy') { add(plan.gains, { grain: 4, people: 2 }); notes.push('按戶籍排除重徵，多四糧，減少二民心損耗。'); }
            if (p === 'ration') { add(plan.gains, { people: 2, defense: -1 }); notes.push('核對名冊優先最急民戶；沒有新增糧，邊營順位稍後。'); }
            if (p === 'audit') { add(plan.gains, { grain: 5, treasury: 3 }); notes.push('戶籍與實倉交叉核對，多追回五糧、三國庫。'); }
            if (p === 'fortify') { add(plan.cost, { grain: -2 }); frontAdd(plan, 'pass', { supply: 6 }); notes.push('以接續運期節省二糧，關隘地方供給多六。'); }
            if (p === 'diplomacy') { event('供給合約換來的糧隊', { grain: 8 }, id, 'river', false); notes.push('與商路使節核對供給合約，派出下一批八糧；不額外承諾停戰。'); }
        }
        if (id === 'weiZheng') {
            if (p === 'route') { add(plan.gains, { people: 3 }); notes.push('公開徵役與配給理由，民心多三，運量依原案。'); }
            if (p === 'market') { add(plan.cost, { treasury: -1 }); add(plan.gains, { people: 3 }); notes.push('公開比價，節省一國庫，民心多三。'); }
            if (p === 'levy') { add(plan.gains, { grain: -3, people: flexible ? -2 : 5 }); notes.push(flexible ? '臨機徵取失去可核對限額，少三糧仍另損二民心。' : '逐戶核定限額，少收三糧，減少五民心損耗；補償仍須付款。'); }
            if (p === 'ration') { add(plan.gains, { people: 4, defense: -2 }); notes.push('說明配給理由，優先急迫民戶；無新增糧，邊防少二。'); }
            if (p === 'audit') { add(plan.gains, { people: 7, treasury: 4 }); notes.push('公開見證賞罰與實帳，多追回四國庫並提高七民心。'); }
            if (p === 'fortify') { add(plan.gains, { people: 2 }); notes.push('公開徵用與續餉責任，民心多二，糧餉承諾仍要兌現。'); }
            if (p === 'diplomacy') { if (state.resources.people >= 55) { ENEMY_INFO.forEach(e => { enemyAdd(plan, e.id, { cohesion: -5 }); plan.truce[e.id] = state.turn + 1; }); } notes.push('民心達五十五時，公開可信條款使兩方本回合休戰、凝聚再減五；未達則只有基本議和效果。'); }
        }
        if (id === 'zhangLiang') {
            if (p === 'route') { distant(4); plan.intel.pass = state.turn + 2; notes.push('改換運期並辨明關隘敵情，遠倉多四糧、情報有效至下回合。'); }
            if (p === 'market') { distant(4); notes.push('利用商隊時差安排後批，遠批多四糧，價格仍依商戶合作。'); }
            if (p === 'levy') { add(plan.gains, { grain: -1, people: 3 }); notes.push('先分批避開農忙，少收一糧、減少三民心損耗。'); }
            if (p === 'ration') { plan.intel.granary = state.turn + 2; add(plan.gains, { people: 1 }); notes.push('重排配給同時查清腹地敵探，情報至下回合；沒有新增糧。'); }
            if (p === 'audit') { add(plan.gains, { treasury: 5 }); notes.push('核對中轉時序追出隱藏轉付，多五國庫。'); }
            if (p === 'fortify') { frontAdd(plan, 'river', { security: 5 }); notes.push('防備敵方轉向，河道安全也提高五。'); }
            if (p === 'diplomacy') { ENEMY_INFO.forEach(e => enemyAdd(plan, e.id, { cohesion: -8 })); notes.push('分別指出兩方的利益衝突，兩方凝聚再減八；凝聚低可能撤圍。'); }
        }
        if (id === 'chenPing') {
            add(plan.approval, { court: -4, officials: -3 });
            if (p === 'route') { distant(3); enemyAdd(plan, 'northern', { cohesion: -4 }); notes.push('用暗線避開盤查，遠批多三糧、北騎凝聚少四。'); }
            if (p === 'market') { add(plan.cost, { treasury: -3 }); notes.push('分別與中間商議價，採買少付三國庫。'); }
            if (p === 'levy') { add(plan.gains, { grain: 5, people: -1 }); notes.push('核出藏糧，多收五糧，民心另減一。'); }
            if (p === 'ration') { add(plan.gains, { treasury: 2, people: -1 }); notes.push('取消非急需支出收回二國庫；無新增糧，民心少一。'); }
            if (p === 'audit') { add(plan.gains, { treasury: 7 }); notes.push('追出中轉暗帳，多七國庫，暗線程序仍有合作代價。'); }
            if (p === 'fortify') { enemyAdd(plan, 'northern', { cohesion: -6 }); notes.push('收買敵方聯絡者，北騎凝聚少六，守備本身依原案。'); }
            if (p === 'diplomacy') { ENEMY_INFO.forEach(e => enemyAdd(plan, e.id, { cohesion: -10 })); notes.push('暗線離間，兩方凝聚再減十；降低朝廷與官吏合作。'); }
            notes.push('暗線使朝廷合作減四、地方官合作減三，不隱藏在收益外。');
        }
        if (id === 'sunWu') {
            if (p === 'route') { distant(3); frontAdd(plan, 'pass', { security: 5 }); notes.push('先整護運軍紀，遠批多三糧，關隘安全多五。'); }
            if (p === 'market') { frontAdd(plan, 'river', { security: 3 }); notes.push('核定商隊警戒，使河道安全多三。'); }
            if (p === 'levy') { add(plan.gains, { defense: 6, people: -3 }); notes.push('軍需動員多六邊防，民心另減三。'); }
            if (p === 'ration') { add(plan.gains, { defense: 4, people: -1 }); notes.push('保留最低守備糧額，邊防多四，無新增糧，民心少一。'); }
            if (p === 'audit') { add(plan.gains, { grain: 3, defense: 3 }); notes.push('查軍糧耗損，多追回三糧、恢復三邊防。'); }
            if (p === 'fortify') { add(plan.gains, { defense: 6 }); frontAdd(plan, 'pass', { security: 3 }); notes.push('整編警戒與戰備，多六邊防、三關隘安全。'); }
            if (p === 'diplomacy') { if (state.fronts.pass.security >= 60) plan.truce.northern = state.turn + 1; notes.push('關隘安全達六十，北騎見難以速勝，本回合休戰；河盟另算。'); }
        }
        if (id === 'shangYang') {
            add(plan.approval, { farmers: -4, officials: -5 });
            if (p === 'route') { frontAdd(plan, 'pass', { supply: 6 }); distant(5); add(plan.gains, { people: -2 }); notes.push('按責任戶分配徵役，遠批多五糧、關隘供給多六，民心少二。'); }
            if (p === 'market') { add(plan.cost, { treasury: -2 }); add(plan.gains, { people: -1 }); notes.push('統一契約與履約罰則，節省二國庫，民心少一。'); }
            if (p === 'levy') { add(plan.gains, { grain: 8, people: -4 }); notes.push('嚴格編戶動員，多收八糧，民心另減四；有憑券也須按時付款。'); }
            if (p === 'ration') { add(plan.gains, { treasury: 3, people: -4 }); notes.push('停發非急需官俸收回三國庫，無新增糧，民心減四。'); }
            if (p === 'audit') { add(plan.gains, { treasury: 8, people: -4 }); notes.push('追究倉吏責任多收回八國庫，民心少四。'); }
            if (p === 'fortify') { frontAdd(plan, 'pass', { security: 8 }); add(plan.gains, { people: -3 }); notes.push('明確軍戶賞罰，使關隘安全多八，民心少三。'); }
            if (p === 'diplomacy') { ENEMY_INFO.forEach(e => enemyAdd(plan, e.id, { cohesion: 2 })); add(plan.gains, { treasury: 4 }); notes.push('堅持核定條款省下四國庫，但兩方凝聚反增二，外交彈性較小。'); }
            notes.push('嚴格執法使農戶合作減四、地方官減五。');
        }
        if (id === 'suQin') {
            if (p === 'route') { distant(3); add(plan.approval, { merchants: 5 }); notes.push('協商民間轉運，遠批多三糧，商戶合作多五。'); }
            if (p === 'market') { add(plan.cost, { treasury: -5 }); add(plan.approval, { merchants: 3 }); notes.push('以商路互保談價，少付五國庫，商戶合作另多三。'); }
            if (p === 'levy') { add(plan.gains, { grain: -2, people: 2 }); notes.push('協商分擔負擔，少收二糧，減少二民心損耗。'); }
            if (p === 'ration') { add(plan.gains, { people: 3 }); add(plan.approval, { merchants: 4 }); notes.push('說服商戶接受延後非急需配給，民心多三、商戶合作多四，無新增糧。'); }
            if (p === 'audit') { add(plan.gains, { treasury: 2, people: 3 }); notes.push('協商公開商帳，多追二國庫，民心多三。'); }
            if (p === 'fortify') { add(plan.cost, { treasury: -2 }); enemyAdd(plan, 'riverLeague', { cohesion: -4 }); notes.push('談妥渡口互保，少付二國庫，河盟凝聚少四。'); }
            if (p === 'diplomacy') { ENEMY_INFO.forEach(e => { enemyAdd(plan, e.id, { cohesion: -14 }); if (state.resources.people >= 45 && state.resources.defense >= 40) plan.truce[e.id] = state.turn + 2; }); notes.push('分別重組利益承諾，兩方凝聚再減十四；民心四十五、邊防四十以上時休戰至下一回合。'); }
        }
        plan.notes.push(name(id) + '內政：' + notes.join(' '));
    }
    function missionMethod(state, o, plan, event) {
        const id = o.commander, m = o.mission, f = o.front, enemy = enemyForFront(f), round = state.turn + 1;
        const intel = state.fronts[f].intelUntil >= round || (plan.intel[f] || 0) >= round;
        const notes = [];
        let guard = 0, secure = 0, supply = 0, raidPower = 15, envoyPower = 9, extraCohesion = 0;
        if (m === 'recon') { plan.intel[f] = Math.max(plan.intel[f] || 0, round + 1); notes.push('敵情查明至第' + (round + 1) + '回合，敵襲損失降低；可為下次奇襲準備。'); }
        if (m === 'escort') { secure = 7; supply = 6; guard = 10; add(plan.approval, { army: 2, merchants: f === 'river' ? 4 : 1 }); }
        if (m === 'drill') { secure = state.fronts[f].supply < 30 ? 6 : 12; supply = 2; add(plan.gains, { defense: 3 }); if (state.fronts[f].supply < 30) notes.push('地域供給低於三十，基礎整訓安全增量減半為六。'); }
        if (m === 'raid') { raidPower += intel ? 5 : 0; notes.push(intel ? '已有有效情報，突擊基礎戰果提高、我方損失較低。' : '未知敵情，突擊仍可執行，會另損四邊防、二民心。'); }
        if (m === 'envoy') envoyPower += state.resources.people >= 55 ? 4 : -2;
        if (id === 'hanXin') {
            if (m === 'recon') { secure += 2; notes.push('以地形辨明敵探，同時提高二地域安全。'); }
            if (m === 'escort') { guard += 8; secure += 3; notes.push('地形佯動增加八護衛抗襲與三安全。'); }
            if (m === 'drill') { secure += 5; notes.push('調整陣地與軍令，地域安全另多五。'); }
            if (m === 'raid') { raidPower += o.authority === 'flexible' ? 10 : 4; notes.push(o.authority === 'flexible' ? '臨機戰術增加十奇襲戰果。' : '按核定戰術增加四奇襲戰果。'); }
            if (m === 'envoy') { envoyPower += state.resources.defense >= 60 ? 7 : 0; notes.push('邊防達六十時，軍威使談判效能多七。'); }
        }
        if (id === 'xiaoHe') {
            if (m === 'recon') { supply += 6; notes.push('偵察兼核對倉點，地域供給多六。'); }
            if (m === 'escort') { supply += 5; event('蕭何外勤接續的糧隊', { grain: 8 }, id, f, true); notes.push('接續運期使供給另多五，下一批另送八糧。'); }
            if (m === 'drill') { supply += 10; notes.push('編入替補與運期，地域供給另多十。'); }
            if (m === 'raid') { raidPower -= 4; event('蕭何核對敵倉追回糧', { grain: 6 }, id, f, false); notes.push('直接突擊戰果少四；核對敵倉另追回六糧，下回合到。'); }
            if (m === 'envoy') { envoyPower += 2; event('出使核定的商糧合約', { grain: 6 }, id, f, false); notes.push('談判效能多二，另簽六糧供給合約；不保證立即停戰。'); }
        }
        if (id === 'weiZheng') {
            if (m === 'recon') { secure += 3; add(plan.approval, { officials: -3 }); notes.push('公開見證敵情報告，安全多三、地方官合作少三。'); }
            if (m === 'escort') { guard += 2; add(plan.gains, { people: 3 }); notes.push('公開徵役責任，護衛抗襲多二、民心多三。'); }
            if (m === 'drill') { secure += 3; add(plan.gains, { people: 3 }); notes.push('核對軍戶負擔，安全另多三、民心多三。'); }
            if (m === 'raid') { raidPower -= 6; add(plan.gains, { people: 4 }); notes.push('拒絕掠取民戶，戰果少六、民心多四。'); }
            if (m === 'envoy') { envoyPower += state.resources.people >= 55 ? 8 : -3; notes.push('民心至少五十五，公開可信條款增加八效能；不足則效能少三。'); }
        }
        if (id === 'zhangLiang') {
            if (m === 'recon') { plan.intel[f] = round + 2; notes.push('對照敵方部署，情報延長至第' + (round + 2) + '回合。'); }
            if (m === 'escort') { guard += 4; extraCohesion = 3; notes.push('改換時序，抗襲多四、目標敵方凝聚少三。'); }
            if (m === 'drill') { FRONT_INFO.filter(item => item.id !== f).forEach(item => frontAdd(plan, item.id, { security: 2 })); notes.push('準備敵方轉向，另兩地域各多二安全。'); }
            if (m === 'raid') { raidPower += intel ? 12 : 2; notes.push(intel ? '順有效情報擊敵空隙，戰果另多十二。' : '尚無情報，時機計策只增加二戰果。'); }
            if (m === 'envoy') { envoyPower += 5; extraCohesion = 6; notes.push('分散敵方利益，外交效能多五、凝聚另少六。'); }
        }
        if (id === 'chenPing') {
            add(plan.approval, { court: -4 });
            if (m === 'recon') { add(plan.cost, { treasury: 2 }); plan.intel[f] = round + 2; notes.push('付兩國庫打通暗線，情報延長至第' + (round + 2) + '回合。'); }
            if (m === 'escort') { add(plan.cost, { treasury: 2 }); guard += 6; notes.push('付兩國庫給暗線，護衛抗襲多六。'); }
            if (m === 'drill') { extraCohesion = 5; notes.push('整訓同時散布離間，敵方凝聚少五。'); }
            if (m === 'raid') { raidPower += 5; extraCohesion = 8; notes.push('內應協助突擊，戰果多五、凝聚另少八。'); }
            if (m === 'envoy') { envoyPower += 5; extraCohesion = 10; notes.push('分別談妥暗線利益，效能多五、凝聚另少十。'); }
            notes.push('外勤暗線使朝廷合作少四。');
        }
        if (id === 'sunWu') {
            if (m === 'recon') { plan.intel[f] = round + 2; notes.push('交叉查明地形與敵情，情報延長至第' + (round + 2) + '回合。'); }
            if (m === 'escort') { add(plan.cost, { grain: 1 }); guard += 8; notes.push('付一糧準備輪替，護衛抗襲多八。'); }
            if (m === 'drill') { secure += state.fronts[f].supply < 30 ? 6 : 12; add(plan.gains, { defense: 4 }); notes.push('整訓安全再增十二（供給不足時六），邊防另多四。'); }
            if (m === 'raid') { raidPower += intel ? 9 : -5; notes.push(intel ? '知敵後集中兵力，戰果另多九。' : '未查清敵情，節制投入，戰果少五。'); }
            if (m === 'envoy') { envoyPower += state.fronts[f].security >= 60 ? 6 : 0; notes.push('地域安全達六十，守勢後盾使效能多六。'); }
        }
        if (id === 'shangYang') {
            add(plan.approval, { farmers: -2, officials: -3 });
            if (m === 'recon') { add(plan.gains, { treasury: 3, people: -2 }); notes.push('核對驛站責任追回三國庫，民心少二。'); }
            if (m === 'escort') { supply += 8; add(plan.gains, { people: -2 }); notes.push('編戶徵役使供給另多八，民心少二。'); }
            if (m === 'drill') { add(plan.cost, { treasury: 2 }); secure += 9; add(plan.gains, { people: -3 }); notes.push('付兩國庫嚴格賞罰，安全另多九，民心少三。'); }
            if (m === 'raid') { raidPower += 7; add(plan.gains, { people: -4 }); notes.push('強度動員多七戰果，民心少四。'); }
            if (m === 'envoy') { envoyPower -= 3; add(plan.gains, { treasury: 5 }); notes.push('堅持核定條款追回五國庫，談判效能少三。'); }
        }
        if (id === 'suQin') {
            if (m === 'recon') { extraCohesion = 7; notes.push('刺探各方利害，敵方凝聚少七。'); }
            if (m === 'escort') { guard += 2; add(plan.approval, { merchants: 5 }); notes.push('商隊互保抗襲多二、商戶合作多五。'); }
            if (m === 'drill') { extraCohesion = 7; notes.push('交涉相互牽制條款，敵方凝聚少七。'); }
            if (m === 'raid') { raidPower -= 3; extraCohesion = 10; notes.push('直接戰果少三，分裂敵盟使凝聚另少十。'); }
            if (m === 'envoy') { envoyPower += 14; secure += 3; notes.push('重組利益承諾，外交效能多十四、地域安全多三；成功可休戰兩回合。'); }
        }
        if (secure || supply) frontAdd(plan, f, { security: secure, supply });
        if (guard) plan.protection[f] = guard;
        if (extraCohesion) enemyAdd(plan, enemy, { cohesion: -extraCohesion });
        if (m === 'raid') { const weakness = state.enemies[enemy].supply < 35 ? 4 : 0; const strike = Math.max(4, raidPower + weakness); enemyAdd(plan, enemy, { strength: -Math.round(strike * 0.65), supply: -strike, cohesion: -Math.round(strike * 0.3) }); frontAdd(plan, f, { security: 4, supply: -2 }); add(plan.gains, { defense: intel ? -1 : -4, people: intel ? 0 : -2 }); notes.push('截斷' + ENEMY_INFO.find(e => e.id === enemy).name + '補給：軍力減' + Math.round(strike * 0.65) + '、供給減' + strike + '、凝聚減' + Math.round(strike * 0.3) + '；敵方下一步依剩餘供給與守備重判。'); }
        if (m === 'envoy') { const pressure = Math.max(3, envoyPower); enemyAdd(plan, enemy, { cohesion: -pressure }); const credible = pressure + Math.floor(state.fronts[f].security / 8) + Math.floor(state.resources.defense / 12) >= 22 && state.resources.people >= 40; if (credible) { plan.truce[enemy] = round + (id === 'suQin' ? 1 : 0); notes.push('對方接受休戰至第' + plan.truce[enemy] + '回合；另一勢力仍會獨立行動。'); } else notes.push('目前籌碼未達停戰門檻，只削弱凝聚，不承諾敵方停手。'); }
        plan.notes.push(name(id) + '外勤：' + notes.join(' '));
    }
    function applyResource(state, effects, notices) {
        RESOURCES.forEach(k => { const before = state.resources[k], raw = before + (effects[k] || 0); state.resources[k] = clamp(raw); if (raw !== state.resources[k]) notices.push(NAMES[k] + '觸及' + (raw < 0 ? '零' : '一百') + '，以實際餘額結算。'); });
    }
    function applyFront(state, id, effects) { Object.entries(effects).forEach(([k, v]) => { state.fronts[id][k] = clamp(state.fronts[id][k] + v); }); }
    function applyEnemy(state, id, effects) { Object.entries(effects).forEach(([k, v]) => { state.enemies[id][k] = clamp(state.enemies[id][k] + v); }); }
    function remember(state, id, message) { state.actorMemory[id].events.push(message); }
    function enemyAction(state, info, plan, round, notices) {
        const e = state.enemies[info.id], beforeEnemy = copy(e), beforeResources = copy(state.resources);
        const targetScore = id => state.fronts[id].security + state.fronts[id].supply * 0.35 + (plan.protection[id] || 0) * 2;
        const targets = info.fronts.slice().sort((a, b) => targetScore(a) - targetScore(b) || info.fronts.indexOf(a) - info.fronts.indexOf(b));
        let front = targets[0], action, message, effects = {}, regional = {}, enemy = {};
        const beforeFront = copy(state.fronts[front]);
        if (e.truceUntil >= round) { action = 'truce'; message = '依約休戰至第' + e.truceUntil + '回合，補充四供給；停戰沒有消滅這股勢力。'; enemy = { supply: 4 }; }
        else if (e.strength <= 25 || e.cohesion <= 24) { action = 'withdraw'; message = e.strength <= 25 ? '軍力不足二十六，撤出接觸線重整。' : '凝聚低於二十五，各部撤圍重整。'; enemy = { strength: 1, supply: 3, cohesion: 2 }; regional = { security: 2 }; }
        else {
            const protectedTarget = info.fronts[0], shifted = front !== protectedTarget;
            const f = state.fronts[front], known = f.intelUntil >= round;
            const attackPower = Math.round(e.strength * 0.28 + e.cohesion * 0.16 + e.supply * 0.10);
            const guard = Math.round(f.security * 0.30 + state.resources.defense * 0.13 + (plan.protection[front] || 0) + (known ? 6 : 0));
            const damage = Math.max(0, Math.min(12, Math.ceil((attackPower - guard) / 2)));
            if (e.supply < 30) {
                action = 'forage'; message = '自軍供給低於三十，改向' + frontName(front) + '掠糧；' + (known ? '我方已查清進路，損失受抑。' : '我方尚未掌握進路。');
                effects = { grain: -(damage + (damage ? 2 : 0)), people: damage ? -Math.ceil(damage / 3) : 0, defense: damage ? -1 : 0 };
                regional = { security: damage ? -4 : 0, supply: damage ? -Math.ceil(damage / 2) : 0 };
                enemy = { supply: damage ? 6 + damage : -2, cohesion: damage ? 1 : -4, strength: damage ? -1 : -3 };
            } else {
                action = shifted ? 'flank' : damage === 0 ? 'probe' : info.id === 'riverLeague' ? 'blockade' : 'assault';
                message = shifted ? '發現原進路守備與護衛較強，轉向較弱的' + frontName(front) + '。' : info.id === 'riverLeague' ? '沿' + frontName(front) + '封航試探，按守備與供給結算。' : '試攻' + frontName(front) + '，按守備與供給結算。';
                if (front === 'granary') effects = { grain: -Math.ceil(damage * 1.4), people: -Math.ceil(damage / 2), defense: -Math.ceil(damage / 3) };
                if (front === 'pass') effects = { grain: -Math.ceil(damage / 2), defense: -damage, people: damage >= 8 ? -2 : 0 };
                if (front === 'river') effects = { grain: -Math.ceil(damage / 2), treasury: -Math.ceil(damage / 2), defense: -Math.ceil(damage / 3) };
                regional = { security: damage ? -(3 + Math.ceil(damage / 2)) : 0, supply: damage ? -Math.ceil(damage / 2) : 0 };
                enemy = { supply: -6, strength: damage ? -1 : -3, cohesion: damage ? 1 : -4 };
            }
            message += ' 敵方攻勢' + attackPower + '、我方抵抗' + guard + '，損害級別' + damage + '。' + (damage === 0 ? '守住進路，敵方無法取得物資。' : '這是依本次部署與戰線計算的損失。');
        }
        applyResource(state, effects, notices); applyFront(state, front, regional); applyEnemy(state, info.id, enemy);
        e.lastAction = action;
        const actual = Object.fromEntries(RESOURCES.map(k => [k, state.resources[k] - beforeResources[k]]));
        const actualFront = { security: state.fronts[front].security - beforeFront.security, supply: state.fronts[front].supply - beforeFront.supply };
        const actualEnemy = { strength: e.strength - beforeEnemy.strength, supply: e.supply - beforeEnemy.supply, cohesion: e.cohesion - beforeEnemy.cohesion };
        return { id: info.id, name: info.name, action, text: info.name + '：' + message + ' ' + text(actual) + '。', front, effects: actual, frontEffects: actualFront, enemyEffects: actualEnemy };
    }
    function transition(state, o, prebuiltPlan) {
        const plan = prebuiltPlan || buildPlan(state, o);
        if (plan.disabled.length) fail('ORDER_DISABLED', plan.disabled.join('；'));
        const next = copy(state), round = state.turn + 1, consequences = [], commitmentEvents = [], frontConsequences = [], jointDeliveries = [];
        applyResource(next, plan.effects, consequences);
        Object.entries(plan.approval).forEach(([k, v]) => { next.stakeholders[k] = clamp(next.stakeholders[k] + v); });
        Object.entries(plan.frontEffects).forEach(([id, effects]) => applyFront(next, id, effects));
        Object.entries(plan.enemyEffects).forEach(([id, effects]) => applyEnemy(next, id, effects));
        Object.entries(plan.intel).forEach(([id, until]) => { next.fronts[id].intelUntil = Math.max(next.fronts[id].intelUntil, until); });
        Object.entries(plan.truce).forEach(([id, until]) => { next.enemies[id].truceUntil = Math.max(next.enemies[id].truceUntil, until); });
        const assignMandate = id => { const actor = next.actorMemory[id]; if (actor.mandate === 'flexible' && o.authority === 'bounded') { const transparent = o.supplement === 'ledger'; next.trust[id] = clamp(next.trust[id] - (transparent ? 0 : 4)); const message = name(id) + '第' + round + '回合收回臨機權，' + (transparent ? '公開交接不扣信任。' : '未公開交接，信任減四。'); remember(next, id, message); commitmentEvents.push(message); } actor.mandate = o.authority; };
        assignMandate(o.executor);
        const actor = next.actorMemory[o.executor]; actor.commissions++;
        next.trust[o.executor] = clamp(next.trust[o.executor] + 1);
        remember(next, o.executor, '第' + round + '回合受命「' + primary(o.primary).title + '」，' + (o.authority === 'bounded' ? '限額' : '臨機') + '授權。');
        if (o.mission !== 'none') { assignMandate(o.commander); next.actorMemory[o.commander].missions++; next.trust[o.commander] = clamp(next.trust[o.commander] + 1); remember(next, o.commander, '第' + round + '回合在' + frontName(o.front) + '受命「' + MISSIONS.find(m => m.id === o.mission).title + '」，採本回合共同' + (o.authority === 'bounded' ? '限額' : '臨機') + '授權。'); }
        const settleCommitment = (c, honored, final) => {
            if (!final) next.stakeholders[c.beneficiary] = clamp(next.stakeholders[c.beneficiary] + (honored ? 7 : -15));
            next.actorMemory[c.owner][honored ? 'honored' : 'breached']++;
            next.trust[c.owner] = clamp(next.trust[c.owner] + (honored ? 5 : -8));
            next.trust.weiZheng = clamp(next.trust.weiZheng + (honored ? 2 : -6));
            const message = '第' + round + '回合' + (honored ? '付清' : '公開撤回') + '「' + c.title + '」，第' + c.sourceTurn + '回合由' + name(c.owner) + '負責；' + (honored ? '已付款並履約。' : '失約後果與責任已結算。');
            commitmentEvents.push(message); remember(next, c.owner, message); if (c.owner !== 'weiZheng') remember(next, 'weiZheng', message); consequences.push(message);
        };
        plan.due.forEach(c => settleCommitment(c, o.supplement === 'settle', false));
        plan.finalCommitments.forEach(c => settleCommitment(c, true, true));
        next.commitments = next.commitments.filter(c => !plan.due.some(d => d.id === c.id));
        plan.newCommitments.forEach(c => { next.commitments.push(copy(c)); remember(next, c.owner, '第' + round + '回合承擔「' + c.title + '」，第' + c.due + '回合到期。'); });
        next.pending.push(...copy(plan.events)); next.turn = round;
        const arrivals = next.pending.filter(e => e.due <= round); next.pending = next.pending.filter(e => e.due > round);
        arrivals.forEach(e => {
            const effects = copy(e.effects), risky = e.front !== 'none' && next.fronts[e.front].security < 35 && !e.protected;
            if (risky && effects.grain > 0) { effects.grain = Math.max(0, effects.grain - 4); consequences.push(e.title + '途經安全低於三十五且未安排護運，交付少四糧。'); }
            const grainBefore = next.resources.grain;
            applyResource(next, effects, consequences); remember(next, e.owner, '第' + round + '回合交付「' + e.title + '」，' + text(effects) + '。'); consequences.push(e.title + '：' + text(effects) + '。');
            if (e.partners.length === 2 && next.resources.grain > grainBefore) { const [a, b] = e.partners; next.relations[pair(a, b)] = clamp(next.relations[pair(a, b)] + 5); const message = name(a) + '與' + name(b) + '共同護運的「' + e.title + '」實際入倉，合作加五至' + next.relations[pair(a, b)] + '。'; consequences.push(message); e.partners.forEach(id => remember(next, id, '第' + round + '回合' + message)); jointDeliveries.push({ title: e.title, front: e.front, partners: copy(e.partners), grain: next.resources.grain - grainBefore }); }
        });
        const upkeep = { grain: -Math.min(8, next.resources.grain), treasury: -Math.min(2, next.resources.treasury) }, shortages = [];
        if (next.resources.grain < 8) { add(upkeep, { people: -6, defense: -4 }); shortages.push('不足八糧，另損六民心、四邊防'); }
        if (next.resources.treasury < 2) { add(upkeep, { people: -2 }); shortages.push('日常工資不足兩國庫，另損二民心'); }
        applyResource(next, upkeep, consequences);
        FRONT_INFO.forEach(f => applyFront(next, f.id, { supply: -2 }));
        consequences.push('軍民基本供給：' + text(upkeep) + '；三地地方供給各耗二。' + (shortages.length ? shortages.join('；') + '。' : '八糧與兩國庫付足。'));
        const enemyActions = ENEMY_INFO.map(info => enemyAction(next, info, plan, round, consequences));
        enemyActions.forEach(action => consequences.push(action.text));
        FRONT_INFO.forEach(f => { const before = state.fronts[f.id], after = next.fronts[f.id]; const message = f.name + '：安全 ' + before.security + '→' + after.security + '、地方供給 ' + before.supply + '→' + after.supply + (after.intelUntil >= round + 1 ? '；情報有效至第' + after.intelUntil + '回合。' : '；下回合敵情未明。'); frontConsequences.push(message); });
        const changes = Object.fromEntries(RESOURCES.map(k => [k, next.resources[k] - state.resources[k]]));
        const reactions = plan.responses.map(r => ({ id: r.id, text: (r.position === 'oppose' ? '反對仍保留，依職責配合執行。' : r.position === 'support' ? '支持本令的這部分安排。' : '按已說明的條件配合。') + r.reason + ' 本局記憶：' + (next.actorMemory[r.id].events.at(-1) || '尚未任命我執行，但意見仍可提出。') }));
        const stakeholderReactions = plan.stakeholderResponses.map(r => ({ id: r.id, text: r.reason + ' 結算後合作 ' + next.stakeholders[r.id] + '。' }));
        const missionSummary = o.mission === 'none' ? '本回合未派外勤，敵方依現有守備自行選擇行動。' : name(o.commander) + '前往' + frontName(o.front) + '「' + MISSIONS.find(m => m.id === o.mission).title + '」；' + plan.notes.filter(n => n.startsWith(name(o.commander) + '外勤：')).join(' ');
        next.log.push({ turn: round, order: copy(o), title: plan.title, changes, reactions, consequences, stakeholderReactions, commitmentEvents, executionNotes: copy(plan.notes), missionSummary, enemyActions, frontConsequences, jointDeliveries });
        return next;
    }
    function same(actual, expected, depth) {
        if (depth > 50 || typeof actual !== typeof expected) return false;
        if (expected === null || typeof expected !== 'object') return actual === expected;
        if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && Object.keys(actual).length === expected.length && expected.every((v, i) => same(actual[i], v, depth + 1));
        if (!record(actual)) return false;
        const keys = Object.keys(expected); return Object.keys(actual).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(actual, k) && same(actual[k], expected[k], depth + 1));
    }
    function validateState(state) {
        try { if (!record(state) || state.version !== 3 || state.scenario !== SCENARIO || !Number.isInteger(state.turn) || state.turn < 0 || state.turn > TURNS || !Array.isArray(state.log) || state.log.length !== state.turn) return false; let expected = createGame(); for (const entry of state.log) { if (!record(entry) || !knownOrder(entry.order)) return false; expected = transition(expected, entry.order); } return same(state, expected, 0); } catch (_) { return false; }
    }
    function assertState(state) { if (!validateState(state)) fail('INVALID_STATE', '戰役存檔與完整政令、敵軍、地域紀錄不一致。'); }
    function publicPlan(state, plan) {
        const resolved = plan.disabled.length ? null : transition(state, plan.order, plan), last = resolved ? resolved.log.at(-1) : null;
        const terms = c => '付清：' + text(c.honorEffects) + '，責任人信任+5、魏徵信任+2、受益方合作+7；撤回：' + text(c.breachEffects) + '，責任人信任-8、魏徵信任-6、受益方合作-15。';
        return copy({ order: plan.order, title: plan.title, description: plan.description, cost: plan.cost, effects: plan.effects, resolutionEffects: last ? last.changes : null, conditions: plan.conditions, disabledReasons: plan.disabled,
            responses: plan.responses, stakeholderResponses: plan.stakeholderResponses, executionNotes: plan.notes, capacity: plan.capacity,
            pendingPreview: [...state.pending.map(e => '在途：「' + e.title + '」，第' + e.due + '回合到，' + text(e.effects) + '。'), ...plan.events.map(e => '新派：「' + e.title + '」，第' + e.due + '回合到，' + text(e.effects) + '。' + (e.front === 'none' ? '' : frontName(e.front) + '安全低於三十五且未護運時，正糧交付少四。'))],
            commitmentPreview: [...plan.due.map(c => '本回合到期：「' + c.title + '」需' + costText(c.cost) + '，' + terms(c)), ...plan.newCommitments.map(c => '新承諾：「' + c.title + '」第' + c.due + '回合需' + costText(c.cost) + '，' + terms(c)), ...plan.finalCommitments.map(c => '末回合當場付清：「' + c.title + '」需' + costText(c.cost) + '，' + terms(c))],
            worldPreview: ['順序：政令與外勤→到期承諾→糧隊到貨→基本供給八糧、兩國庫與三地供給各二→朔原騎軍→赤汀河盟。少糧另減六民心、四邊防；欠日常工資另減二民心。', ...(last ? last.consequences.filter(t => t.startsWith('軍民基本供給')) : [])],
            enemyPreview: last ? last.enemyActions.map(e => '依本令推演：' + e.text) : ENEMY_INFO.map(e => e.name + '會依剩餘軍力、供給、凝聚與三地部署選擇攻擊、掠糧、轉向、休戰或撤圍。'),
            frontPreview: last ? last.frontConsequences : Object.entries(plan.frontEffects).map(([id, effects]) => frontName(id) + '：安全' + ((effects.security || 0) >= 0 ? '+' : '') + (effects.security || 0) + '、地方供給' + ((effects.supply || 0) >= 0 ? '+' : '') + (effects.supply || 0)) });
    }
    function evaluateOrder(state, order) { assertState(state); return publicPlan(state, buildPlan(state, order)); }
    function choose(state, order) { assertState(state); return transition(state, order); }
    function recommendationOrder(p, s, x, m, c, f, a) { return { primary: p, supplement: s, executor: x, authority: a || 'bounded', mission: m || 'none', commander: c || 'none', front: f || 'none' }; }
    function recommendations(state) {
        const due = dueFor(state).length, s = due ? 'settle' : 'none';
        const candidates = [
            { title: '調糧與護運分工', description: '蕭何核對官倉，韓信護衛北境運路；合作能逐次累積。', order: recommendationOrder('route', s, 'xiaoHe', 'escort', 'hanXin', 'pass') },
            { title: '查帳與河道整訓', description: '魏徵公開查核，孫武建立河道守備，為後批商糧保路。', order: recommendationOrder('audit', s, 'weiZheng', 'drill', 'sunWu', 'river') },
            { title: '採買與情報準備', description: '蘇秦協商商糧，張良查明關隘敵情；下一回合可轉為奇襲。', order: recommendationOrder('market', s, 'suQin', 'recon', 'zhangLiang', 'pass') },
            { title: '限額徵糧、離間敵盟', description: '商鞅強度動員，陳平削弱河盟；民間與程序代價需要承擔。', order: recommendationOrder('levy', due ? 'settle' : 'vouchers', 'shangYang', 'envoy', 'chenPing', 'river') },
            { title: '分別议和、守住弱路', description: '蘇秦分別議和，孫武守望目前最弱的運路；停戰期限有限。', order: recommendationOrder('diplomacy', s, 'suQin', 'drill', 'sunWu', state.fronts.pass.security <= state.fronts.river.security ? 'pass' : 'river') },
            { title: '按情報截斷敵糧', description: '蕭何查核供給，張良依敵情打擊關隘敵軍；未知敵情也有真實損失。', order: recommendationOrder('audit', s, 'xiaoHe', 'raid', 'zhangLiang', 'pass') },
            { title: '保留人手、重排配給', description: '沒有新增糧；先明確履約，保留選擇空間。', order: recommendationOrder('ration', s, 'weiZheng') },
            { title: '資源不足時公開撤回', description: '不付不起的款、不新增糧；失約後果仍留下，戰役可以繼續。', order: recommendationOrder('ration', due ? 'default' : 'none', 'weiZheng') }
        ];
        return candidates.filter(c => !buildPlan(state, c.order).disabled.length).map(copy);
    }
    function getCatalog(state) {
        assertState(state);
        if (state.turn >= TURNS) return { primaries: [], supplements: [], executors: [], authorities: [], missions: [], commanders: [], fronts: [], recommendations: [] };
        const advisors = ADVISORS.map(a => ({ id: a.id, name: a.name, description: a.profile.strength }));
        const publicItem = ({ capacity, ...item }) => ({ ...item, description: item.description + ' 人手' + capacity + '。' });
        return copy({ primaries: PRIMARY.map(publicItem), supplements: SUPPLEMENTS.map(publicItem), executors: advisors, authorities: AUTHORITIES, missions: MISSIONS.map(publicItem), commanders: [{ id: 'none', name: '不派統領', description: '無外勤專用。' }, ...advisors], fronts: [{ id: 'none', name: '不選地域', description: '無外勤專用。' }, ...FRONT_INFO], recommendations: recommendations(state) });
    }
    function frontsPublic(state) { return FRONT_INFO.map(f => ({ ...f, security: state.fronts[f.id].security, supply: state.fronts[f.id].supply, intelligence: state.fronts[f.id].intelUntil >= state.turn + 1 ? '有效至第' + state.fronts[f.id].intelUntil + '回合' : '敵情未明', intelUntil: state.fronts[f.id].intelUntil })); }
    function enemiesPublic(state) { return ENEMY_INFO.map(info => { const e = state.enemies[info.id]; const intent = state.turn >= TURNS ? '戰役已結算' : e.truceUntil >= state.turn + 1 ? '休戰至第' + e.truceUntil + '回合，期間補給' : e.strength <= 25 || e.cohesion <= 24 ? '軍力或凝聚不足，可能撤圍重整' : e.supply < 30 ? '自軍缺糧，準備尋弱點掠糧' : '尋找守備與供給最弱的進路，護運可能令其轉向'; return { id: info.id, name: info.name, description: info.description, strength: e.strength, supply: e.supply, cohesion: e.cohesion, truceUntil: e.truceUntil, intent, lastAction: e.lastAction }; }); }
    function getFronts(state) { assertState(state); return copy(frontsPublic(state)); }
    function getEnemies(state) { assertState(state); return copy(enemiesPublic(state)); }
    function getScene(state) {
        assertState(state);
        const scene = state.turn >= TURNS ? { id: 'campaign-conclusion', title: '六回合戰役回報', eyebrow: '本局完成', description: '所有新派糧隊與到期承諾已結算；敵方、三地與人物責任一併留下。這是跨時代架空遊戲改編。' } : { id: 'campaign-turn-' + (state.turn + 1), title: TITLES[state.turn], eyebrow: '第' + (state.turn + 1) + '回合／共六回合 · 內政與外勤分工', description: DESCRIPTIONS[state.turn] };
        const last = state.log.at(-1);
        scene.news = last ? ['上一道政令：' + last.title, ...last.enemyActions.map(e => e.text), ...last.frontConsequences, ...last.commitmentEvents] : ['起始糧四十八、國庫七十八；三地安全、供給不同，兩敵方各有軍力、供給與凝聚。', '每回合可任命一位內政執行者及另一位外勤統領；八人皆可任命，方法各有實際成本與效果。'];
        scene.news.push('每回合到貨後基本耗八糧、兩國庫，三地地方供給各二；敵方依部署重新選擇行動，不固定扣除邊防。');
        state.pending.forEach(e => scene.news.push('在途：「' + e.title + '」第' + e.due + '回合交付，' + text(e.effects) + '。'));
        state.commitments.forEach(c => scene.news.push('承諾：「' + c.title + '」第' + c.due + '回合支付' + costText(c.cost) + '。'));
        scene.briefings = ADVISORS.map(a => ({ advisor: a.id, text: '遊戲改編：' + (state.actorMemory[a.id].events.at(-1) || a.stance + ' ' + a.profile.strength) + (state.trust[a.id] < 35 ? ' 信任低於三十五，任命我需多一份責任確認人手。' : '') }));
        scene.stakeholderNews = STAKEHOLDERS.map(f => ({ id: f.id, text: f.concern + ' 合作 ' + state.stakeholders[f.id] + (f.id === 'merchants' ? '；低於四十採買加四國庫，達六十五減三。' : f.id === 'farmers' ? '；低於三十五徵糧少六。' : f.id === 'officials' ? '；低於三十修路多占一人手。' : f.id === 'court' ? '；低於三十總人手上限由六降為五。' : '') }));
        return scene;
    }
    function getEnding(state) {
        assertState(state); if (state.turn < TURNS) return null;
        const r = state.resources, broken = IDS.reduce((n, id) => n + state.actorMemory[id].breached, 0), honored = IDS.reduce((n, id) => n + state.actorMemory[id].honored, 0);
        const weakFronts = FRONT_INFO.filter(f => state.fronts[f.id].security < 30), disrupted = ENEMY_INFO.filter(e => state.enemies[e.id].strength <= 25 || state.enemies[e.id].cohesion <= 24);
        let ending;
        if (r.grain < 12 || r.people < 30 || r.defense < 25 || weakFronts.length >= 2) ending = { id: 'crisis', title: '危局失衡，戰線仍有缺口', summary: '供給、民心或多條戰線未能接住六回合壓力；敵方會尋薄弱處，單一高數值不足以補足全局。' };
        else if (broken) ending = { id: 'broken', title: '守住部分局勢，留下失信', summary: '六回合保持餘力，但公開撤回' + broken + '項承諾；人物與民間留下了具體責任。' };
        else if (disrupted.length === 2 && r.grain >= 20) ending = { id: 'counteroffensive', title: '兩敵受阻，供給接續', summary: '兩方軍力或凝聚已降至撤圍門檻，朝廷仍有餘糧；現有休戰期間仍會整補，各回合行動可逐輪追查。' };
        else if (honored && r.people >= 55 && r.grain >= 20) ending = { id: 'accountable', title: '交付有據，守約成局', summary: '供給與防務保留餘力，付清' + honored + '次承諾；人物分工與民間合作支撐了局勢。' };
        else if (FRONT_INFO.every(f => state.fronts[f.id].security >= 55) && r.grain >= 20) ending = { id: 'frontier', title: '三地守穩，兩面有備', summary: '三地有可持續的守備，敵方難以僅靠轉向突破；軍民供給仍須繼續維持。' };
        else ending = { id: 'fragile', title: '暫度危局，敵勢仍存', summary: '朝廷保留基本餘力；休戰、離間與護運改變了敵方行動，六回合後仍有下一步取捨。' };
        const lessons = ['人物方法、對話、數值與兩股敵勢均為架空遊戲改編；史料連結是設計線索，並非歷史同場或人物能力評分。', '最終國勢：' + RESOURCES.map(k => NAMES[k] + ' ' + r[k]).join('、') + '。', ...frontsPublic(state).map(f => f.name + '：安全' + f.security + '、地方供給' + f.supply + '。'), ...enemiesPublic(state).map(e => e.name + '：軍力' + e.strength + '、供給' + e.supply + '、凝聚' + e.cohesion + '。')];
        IDS.forEach(id => { const m = state.actorMemory[id]; if (m.commissions || m.missions || m.events.length) lessons.push(name(id) + '：內政' + m.commissions + '次、外勤' + m.missions + '次、履約' + m.honored + '次、失約' + m.breached + '次；' + (m.events.at(-1) || '尚無交付回報')); });
        lessons.push('到期承諾剩餘' + state.commitments.length + '、在途回報剩餘' + state.pending.length + '；末回合新運輸與新帳單已當場結算。');
        return { ...ending, lessons };
    }
    function exportReplay(state) { assertState(state); const ending = getEnding(state); return { format: 'dynasty-campaign-replay', version: 3, scenario: SCENARIO, orders: state.log.map(e => copy(e.order)), ending: ending ? ending.id : null, state: copy(state) }; }
    function importReplay(value) { if (typeof value === 'string') { if (value.length > 400000) fail('INVALID_REPLAY', '戰役回放檔過大。'); try { value = JSON.parse(value); } catch (_) { fail('INVALID_REPLAY', '戰役回放不是有效 JSON。'); } } if (!record(value) || !validateState(value.state) || !same(value, exportReplay(value.state), 0)) fail('INVALID_REPLAY', '戰役回放與完整政令、敵軍、地域紀錄不一致。'); return copy(value.state); }
    return Object.freeze({ SCENARIO, TURNS, ADVISORS: freeze(ADVISORS), STAKEHOLDERS: freeze(STAKEHOLDERS), createGame, getScene, getCatalog, getFronts, getEnemies, evaluateOrder, choose, getEnding, validateState, exportReplay, importReplay });
});
