(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyCouncil = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const SCENARIO = 'court-grain-v2';
    const RESOURCES = ['grain', 'treasury', 'people', 'defense'];
    const NAMES = { grain: '糧儲', treasury: '國庫', people: '民心', defense: '邊防' };
    const IDS = ['hanXin', 'xiaoHe', 'weiZheng'];
    const ADVISORS = [
        { id: 'hanXin', name: '韓信', role: '地形、軍令與時機', portrait: '/static/game/court/han-xin.png', stance: '遊戲改編：先問敵人看見什麼、糧車何時抵達，再決定出兵或休兵。', lesson: '遊戲改編：授權能打開戰術空間，也把權力與責任交給了具體的人。', profile: { drive: '希望才幹受到承認，也要有足以負責的指揮權。', strength: '以地形、佯動與時間差安排護運；有防線作後盾時也支持休兵談判。', blindSpot: '軍令與臨機處置可能超出朝廷原先承諾的限額。', relationship: '蕭何若替他的護運方案作保，兩人的責任便綁在同一批糧車上。' }, sources: [{ title: '史記卷九十二：淮陰侯列傳', url: 'https://zh.wikisource.org/zh-hant/史記/卷092' }] },
        { id: 'xiaoHe', name: '蕭何', role: '圖籍、運期與用人', portrait: '/static/game/court/xiao-he.png', stance: '遊戲改編：先對戶籍與近遠倉，再把糧車、替補和責任人排進同一份時程。', lesson: '遊戲改編：推薦人才會形成合作，也會讓推薦者承擔可查核的交付責任。', profile: { drive: '把混亂變成可持續交付的供給與制度。', strength: '辨識近倉與遠倉、核對徵糧戶籍、接續軍中補給；可替韓信的方案作保。', blindSpot: '查帳與安排運期需要時間，眼前的急迫可能被制度流程拖住。', relationship: '本局可以建立蕭何與韓信的共同擔保；這是架空情境的選擇，不是永久固定同盟。' }, sources: [{ title: '史記卷五十三：蕭相國世家', url: 'https://zh.wikisource.org/zh-hant/史記/卷053' }] },
        { id: 'weiZheng', name: '魏徵', role: '進諫、理由與履約', portrait: '/static/game/court/wei-zheng.png', stance: '遊戲改編：徵糧可以議，但限額、賞罰與補償要能核對；反對也不等於拒絕盡職。', lesson: '遊戲改編：真實履約能建立合作，採納好聽的主張不能沖銷失約。', profile: { drive: '讓君主面對命令的理由、偏私和已答應的代價。', strength: '指出互相矛盾的命令；在有限額與補償時支持徵糧，把稽核轉成可見的證據。', blindSpot: '公開查核會暴露問題，執行速度也可能慢於軍中需求。', relationship: '他可以批評韓信的授權範圍，仍承認護運的成效；會記住朝廷是否付清補償。' }, sources: [{ title: '諫太宗十思疏', url: 'https://zh.wikisource.org/zh-hant/諫太宗十思疏' }] }
    ];
    const STAKEHOLDERS = [
        { id: 'army', name: '邊軍', concern: '糧餉、護運兵力與續餉是否到位。' },
        { id: 'farmers', name: '農戶', concern: '徵糧限額、農時與到期補償。' },
        { id: 'merchants', name: '商戶', concern: '現款、安全道路與可核對的合約。' },
        { id: 'officials', name: '地方官與倉吏', concern: '運輸人手、戶籍，以及稽核帶來的責任。' },
        { id: 'court', name: '朝廷議政者', concern: '授權範圍、公開程序與軍權集中。' }
    ];
    const PRIMARY = {
        route: { id: 'route', title: '修復糧道、調撥官倉', description: '近倉先開，遠倉另排運期；不同執行者用不同的方法護運。', capacity: 2, cost: { treasury: 14 } },
        market: { id: 'market', title: '採買商糧', description: '現款買糧；商戶合作度改變價格，護運方式改變後批到貨。', capacity: 2, cost: { treasury: 18 } },
        levy: { id: 'levy', title: '限額徵集民糧', description: '可以快速取得糧，但戶籍、限額與補償方式決定負擔落在誰身上。', capacity: 2, cost: {} },
        ration: { id: 'ration', title: '重排既有配給、暫緩非急需發放', description: '不產生新糧，也不是免費賑濟。以現有物資改變軍民配給順位，作為資源不足時的退路。', capacity: 1, cost: {} },
        audit: { id: 'audit', title: '查核漏糧與配給帳', description: '追回已存在的漏糧；查軍帳、戶籍或公開見證會得到不同結果。', capacity: 2, cost: { treasury: 6 } },
        fortify: { id: 'fortify', title: '增援要道、安排接續糧餉', description: '提高防務，同時承諾下一回合支付四糧、四國庫續餉。最後回合須當場備足。', capacity: 3, cost: { grain: 10, treasury: 8 } },
        diplomacy: { id: 'diplomacy', title: '派使議和、爭取運糧時間', description: '使節取得的承諾需要實際後盾；軍威、供給合約或公開條款各有用途。', capacity: 2, cost: { grain: 2, treasury: 8 } }
    };
    const SUPPLEMENTS = [
        { id: 'none', title: '只執行主措施', description: '不占額外人手；不會自動補償或履行到期承諾。', capacity: 0, cost: {} },
        { id: 'relief', title: '小額緊急賑濟', description: '支付六糧、二國庫救急；農戶合作提升，但要占兩份執行人手。', capacity: 2, cost: { grain: 6, treasury: 2 } },
        { id: 'reserve', title: '保留軍糧、安排護衛', description: '支付四糧維持護衛；這批糧不能同時當成賑糧。', capacity: 1, cost: { grain: 4 } },
        { id: 'ledger', title: '公開限額與驗糧帳', description: '支付三國庫，留下可追查的戶籍、運期和配給紀錄。韓信護運時可形成蕭何擔保。', capacity: 1, cost: { treasury: 3 } },
        { id: 'vouchers', title: '徵糧補償憑券', description: '只配限額徵糧。現在付二國庫辦理，下一回合到期再付九國庫；末回合必須當場付清。', capacity: 1, cost: { treasury: 2 } },
        { id: 'settle', title: '付清本回合到期承諾', description: '將到期帳單一併納入本次成本，占一份配套人手。', capacity: 1, cost: {} },
        { id: 'default', title: '公開撤回本回合到期承諾', description: '明確承認失約，承擔民間、軍中與人物信任的後果；不會把欠款當作已付款。', capacity: 0, cost: {} }
    ];
    const AUTHORITIES = [
        { id: 'bounded', title: '限額授權、依核定程序', description: '執行者受配給限額與既定程序約束；韓信的佯動護運空間較小。' },
        { id: 'flexible', title: '臨機處置、事後負責', description: '容許執行者改變時序與方法，也讓朝廷承擔程序與權力集中的代價。與限額補償憑券互斥。' }
    ];
    const SCENES = [
        { id: 'grain-shortage', title: '缺糧朝會', eyebrow: '第一回合 · 糧從何來，誰來負責', description: '連雨阻路，近倉還能開門，遠倉需要護運。韓信、蕭何與魏徵跨越時代進入同一座架空朝堂。所有政策、數值與人物反應都是遊戲改編；不是歷史事件重演。' },
        { id: 'border-report', title: '邊報與到期帳單', eyebrow: '第二回合 · 調整草案，兌現上一道命令', description: '敵方試探糧道，第一批運輸將回報。如果上一回合留下補償或續餉承諾，這次要明確付清或撤回；這會占用配套欄位，主措施、執行者與授權仍可調整。' },
        { id: 'last-council', title: '最後一道政令', eyebrow: '第三回合 · 糧車與承諾全部結算', description: '三次朝會將告一段落。這次新發出的糧車當回合抵達；新開出的補償與續餉須當場支付，不能用局外的未來換取眼前好處。' }
    ];
    function copy(v) { return JSON.parse(JSON.stringify(v)); }
    function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
    function clamp(n) { return Math.max(0, Math.min(100, n)); }
    function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
    function name(id) { return ADVISORS.find(a => a.id === id).name; }
    function add(target, values) { Object.entries(values || {}).forEach(([key, value]) => { target[key] = (target[key] || 0) + value; }); }
    function resourceText(values) { return Object.entries(values).filter(([, n]) => n).map(([k, n]) => NAMES[k] + ' ' + (n > 0 ? '+' : '') + n).join('、') || '無資源變化'; }
    function costText(values) { return Object.entries(values).filter(([, n]) => n).map(([k, n]) => NAMES[k] + ' ' + n).join('、') || '無付款'; }
    function partyText(values) { const parts = Object.entries(values).filter(([, n]) => n).map(([k, n]) => STAKEHOLDERS.find(f => f.id === k).name + '合作 ' + (n > 0 ? '+' : '') + n); return parts.length ? '各方回報：' + parts.join('、') + '。' : ''; }
    function memory() { return { mandate: null, commissions: 0, honored: 0, breached: 0, events: [] }; }
    function createGame() {
        return { version: 2, scenario: SCENARIO, turn: 0, resources: { grain: 42, treasury: 60, people: 55, defense: 52 }, trust: { hanXin: 50, xiaoHe: 50, weiZheng: 50 }, stakeholders: { army: 50, farmers: 50, merchants: 50, officials: 50, court: 50 }, actorMemory: { hanXin: memory(), xiaoHe: memory(), weiZheng: memory() }, relations: { hanXiao: 50, hanWei: 50, xiaoWei: 50 }, log: [], pending: [], commitments: [] };
    }
    function primaryIds(state) { return state.turn === 0 ? ['route', 'market', 'levy', 'ration', 'audit'] : state.turn === 1 ? ['route', 'market', 'levy', 'ration', 'fortify', 'diplomacy'] : state.turn === 2 ? ['route', 'market', 'levy', 'ration', 'audit', 'fortify'] : []; }
    function dueFor(state) { return state.commitments.filter(c => c.due <= state.turn + 1); }
    function legalOrderShape(order) { return record(order) && Object.keys(order).length === 4 && ['primary', 'supplement', 'executor', 'authority'].every(k => Object.prototype.hasOwnProperty.call(order, k) && typeof order[k] === 'string' && order[k].length <= 40); }
    function response(id, position, reason, condition) { return { id, position, reason, condition: condition || '' }; }
    function responsesFor(state, order) {
        const p = order.primary, s = order.supplement, x = order.executor, a = order.authority;
        const han = p === 'diplomacy' ? response('hanXin', state.resources.defense >= 50 ? 'support' : 'conditional', '休兵能讓糧車趕上，但對方必須看見我們還守得住路。', state.resources.defense >= 50 ? '' : '邊防未達五十；目前只有短暫緩和，不承諾可靠停戰。') : p === 'ration' ? response('hanXin', s === 'reserve' ? 'support' : 'conditional', '可以暫緩動員，但重新配給不能憑空補足營中糧。', s === 'reserve' ? '' : '請保留護衛軍糧；否則我仍照令調整，邊軍順位會受影響。') : p === 'route' ? response('hanXin', x === 'hanXin' && a === 'flexible' || s === 'reserve' || s === 'ledger' ? 'support' : 'conditional', '糧隊需要地形與時差；機宜授權可讓佯動護運成形。', x === 'hanXin' && a === 'bounded' ? '限額授權下，我只能依既定路線護運，遠倉批量較小。' : s === 'none' ? '護運兵力與運期要列明；本方案仍有運輸損耗。' : '') : p === 'levy' ? response('hanXin', state.resources.people >= 40 ? 'support' : 'conditional', '兵糧必須趕上，但若民戶已拒絕配合，催糧只會少收。', state.resources.people < 40 ? '民間承受力不足，徵糧後還會出現匿糧。' : '') : p === 'fortify' ? response('hanXin', 'support', '要道可以增援，接續糧餉必須和軍令一起承擔。') : response('hanXin', p === 'audit' ? 'conditional' : 'support', p === 'audit' ? '查軍帳也能發現空額；查戶籍則不能立刻補成重兵。' : '商糧可以買；護衛在商路，其他巡防就會少一部分。', p === 'audit' ? '若我查軍帳，偏重軍中空額；其他查法偏重民間與倉儲。' : '');
        const xiao = p === 'levy' ? response('xiaoHe', s === 'ledger' || s === 'vouchers' || x === 'xiaoHe' && a === 'bounded' ? 'support' : 'conditional', '同樣叫徵糧，按戶籍核對和沿途催收的數量、負擔都不同。', s === 'none' ? '沒有公開帳或憑券，地方官仍可能錯徵；我會先核戶籍。' : '') : p === 'route' ? response('xiaoHe', x === 'xiaoHe' || s === 'ledger' ? 'support' : 'conditional', x === 'hanXin' && s === 'ledger' ? '我願把戶籍與運期交給韓信護運，替這批交付作保。' : '我能分辨近倉與遠倉；路修好不等於糧已經到城內。', x !== 'xiaoHe' && s !== 'ledger' ? '本次沒有我的圖籍協調，請照預告的到貨批量計算。' : '') : p === 'fortify' ? response('xiaoHe', 'conditional', '我可以接續替補與糧餉；增兵之後不能漏掉續餉帳單。', '下回合到期續餉四糧、四國庫；末回合須現付。') : response('xiaoHe', p === 'diplomacy' ? 'conditional' : 'support', p === 'diplomacy' ? '使節換來的時間要用在供給合約，不只停戰文書。' : p === 'ration' ? '重排配給只整理既有庫存；我能對清名冊，但沒有新增糧。' : p === 'audit' ? '圖籍與實倉對照，漏糧才有具體去向。' : '商戶合作決定價格；採買和後批交貨須分開記帳。', p === 'diplomacy' ? '由我執行時改以供給合約換取後批糧，軍威成效較小。' : '');
        const wei = p === 'levy' ? response('weiZheng', s === 'vouchers' && a === 'bounded' ? 'support' : s === 'ledger' && a === 'bounded' ? 'conditional' : 'oppose', s === 'vouchers' ? '有可核對的限額與到期補償，我支持這次徵糧，也會查下一回合是否付款。' : s === 'ledger' ? '公開限額比催收好，但沒有補償，民戶仍在承擔代價。' : '此令缺少可查核的補償與限額；我反對，也會依職責執行。', s === 'vouchers' ? '補償九國庫必須按期付清；採納我的主張不能沖銷失約。' : s === 'ledger' ? '帳簿公開不等於已經付補償。' : '這份反對不會自動扣信任；失約或任意改授權才會留下紀錄。') : p === 'route' ? response('weiZheng', s === 'ledger' || s === 'relief' ? 'support' : 'conditional', '護運可以先行；徵役、運期與配給理由要讓承擔者看見。', s === 'none' ? '本次未另配公開查核或救急，農戶仍承受徵役成本。' : '') : p === 'fortify' ? response('weiZheng', a === 'bounded' && state.resources.people >= 50 ? 'support' : 'conditional', '守住道路有助民戶；我檢查的是糧餉、徵用與軍權的限度。', a === 'flexible' ? '臨機授權的程序代價與續餉仍須承擔。' : state.resources.people < 50 ? '民戶合作不足，守望的效果有限。' : '') : response('weiZheng', a === 'bounded' ? 'support' : 'conditional', p === 'diplomacy' ? '盟約應說清對誰承諾、何時回報；民間支持決定條款可否落實。' : p === 'audit' ? '賞罰與糧帳要能相互核對；我公開見證，不只追求回收數量。' : p === 'ration' ? '重排配給可以說明理由，但請承認它沒有新增糧。' : '商糧可買，不能把商戶價格與採買者責任藏起來。', a === 'flexible' ? '事後負責仍有程序成本；這不是無限授權。' : '');
        return [han, xiao, wei];
    }
    function buildPlan(state, order) {
        if (state.turn >= 3) fail('GAME_COMPLETE', '本局已結束，請重開朝會。');
        if (!legalOrderShape(order) || !primaryIds(state).includes(order.primary) || !SUPPLEMENTS.some(s => s.id === order.supplement) || !IDS.includes(order.executor) || !AUTHORITIES.some(a => a.id === order.authority)) fail('INVALID_ORDER', '政令必須由目前可用的主措施、單一配套、執行者與授權四項組成。');
        const p = PRIMARY[order.primary], s = SUPPLEMENTS.find(item => item.id === order.supplement), x = order.executor, flexible = order.authority === 'flexible';
        const plan = { order: copy(order), title: p.title + ' · ' + s.title + '／' + name(x), description: p.description, cost: copy(p.cost), gains: {}, approval: {}, responses: responsesFor(state, order), notes: [], conditions: [], disabled: [], events: [], inherited: copy(state.pending), newCommitments: [], due: dueFor(state), memoryEvents: [], relations: {} };
        const dueTurn = Math.min(3, state.turn + 2);
        let capacity = p.capacity + s.capacity;
        const limit = state.stakeholders.court < 35 ? 3 : 4;
        if (p.id === 'route' && state.stakeholders.officials < 35) { capacity++; plan.conditions.push('地方官合作低於三十五，修路多占一份協調人手。'); }
        if (flexible && x === 'hanXin' && p.id === 'route') {
            const deliveredGuarantee = state.relations.hanXiao >= 57 && state.log.some(entry => entry.consequences.some(text => text.includes('蕭何擔保的交付核對')));
            if (deliveredGuarantee) plan.conditions.push('蕭何與韓信此前共同交付已核對，合作至少五十七；這次沿用圖籍與護運交接，免去一份重複協調人手。');
            else capacity++;
        }
        if (plan.due.length && !['settle', 'default'].includes(s.id)) plan.disabled.push('本回合有到期承諾，配套必須選「付清」或「公開撤回」。這一份協調人手不能再用在其他配套。');
        if (!plan.due.length && ['settle', 'default'].includes(s.id)) plan.disabled.push('本回合沒有到期承諾。');
        if (s.id === 'vouchers' && p.id !== 'levy') plan.disabled.push('補償憑券只配限額徵糧。');
        if (s.id === 'vouchers' && flexible) plan.disabled.push('憑券承諾核定徵糧限額，與容許超出既定程序的臨機處置互斥。');
        if (p.id === 'levy' && s.id === 'relief' && !state.log.some(entry => entry.order.supplement === 'ledger')) plan.disabled.push('本局尚未建立公開戶籍帳，無法把同批徵糧與賑濟對象分開；先建立糧帳才可混合執行。');
        if (capacity > limit) plan.disabled.push('執行人手需要 ' + capacity + '，目前只能協調 ' + limit + '；需減少配套或改執行方式。');
        add(plan.cost, s.cost);
        const event = (title, effects, approvalEffects, owner, text) => plan.events.push({ id: 't' + (state.turn + 1) + '-event-' + plan.events.length, title, due: dueTurn, effects, approvalEffects: approvalEffects || {}, owner, memory: text, sourceTurn: state.turn + 1 });
        const commitment = (type, title, cost, honorEffects, breachEffects, beneficiary) => {
            if (state.turn === 2) { add(plan.cost, cost); add(plan.gains, honorEffects); add(plan.approval, { [beneficiary]: 7 }); plan.notes.push('最後回合的「' + title + '」當場備款並履約，已納入成本。'); plan.memoryEvents.push({ owner: x, text: '第3回合當場履行「' + title + '」。', honored: true }); }
            else plan.newCommitments.push({ id: 't' + (state.turn + 1) + '-' + type, type, title, owner: x, due: state.turn + 2, cost, honorEffects, breachEffects, sourceTurn: state.turn + 1, beneficiary });
        };
        if (p.id === 'route') {
            add(plan.gains, { grain: 8, people: -2 }); add(plan.approval, { army: -3, farmers: -4, merchants: 4, officials: 1 });
            const tired = state.stakeholders.army < 40 ? 4 : 0;
            if (tired) plan.conditions.push('邊軍合作低於四十，護衛不足使後批少到四糧；條件在頒令當下確定。');
            if (x === 'hanXin') {
                add(plan.cost, { grain: flexible ? 3 : 1, treasury: 2 }); add(plan.gains, { defense: flexible ? -4 : -1 });
                event(flexible ? '佯動護運的遠倉糧隊' : '限額軍令下的既定路線', { grain: (flexible ? 24 : 10) - tired, people: -2 }, { army: 3, merchants: 3 }, x, flexible ? '我按地形布置佯動，糧隊利用時間差抵達；巡防抽調的代價已付。' : '朝廷限額軍令保留了程序，我依既定路線送到較小一批糧。');
                plan.notes.push(flexible ? '韓信：抽調巡防，以佯動與地形掩護大批糧隊；當下邊防減四，軍權集中有朝廷成本。' : '韓信：限額授權保留核准程序，使用既定道路，後批只有十糧。');
                if (s.id === 'ledger') { add(plan.relations, { hanXiao: 7 }); plan.memoryEvents.push({ owner: 'xiaoHe', text: '我核對戶籍與運期，為韓信這次糧隊作保。' }); event('蕭何擔保的交付核對', { grain: 4 }, { officials: 2 }, 'xiaoHe', '我替韓信核對的四糧抵達，這次推薦有可查核的責任。'); }
            } else if (x === 'xiaoHe') { add(plan.cost, { treasury: 2 }); add(plan.gains, { grain: 4 }); event('圖籍排定的遠倉運期', { grain: 16 - tired, people: -3 }, { officials: 4, farmers: -2 }, x, '近倉與遠倉各按名冊交付；我也記下了被徵役的民戶。'); plan.notes.push('蕭何：圖籍辨識近倉，多開四糧；遠倉按批次運期交付，民夫仍付出農時。'); }
            else { add(plan.cost, { treasury: 1 }); add(plan.gains, { people: 3 }); event('公開驗糧後的分批交付', { grain: 12 - tired, people: 4 }, { officials: -3, farmers: 4 }, x, '配給與徵役名冊公開，較慢的一批糧抵達，民戶看得到交付數量。'); plan.notes.push('魏徵：先公開徵役與配給理由，再分批驗糧；運量較小，民戶可核對承諾。'); }
        } else if (p.id === 'market') {
            const price = state.stakeholders.merchants < 45 ? 4 : state.stakeholders.merchants >= 65 ? -2 : 0;
            add(plan.cost, { treasury: price }); add(plan.approval, { merchants: 7, farmers: 2, army: -2, officials: 1 });
            plan.conditions.push('商戶合作 ' + state.stakeholders.merchants + '：採買基本款 ' + (18 + price) + ' 國庫；價格在本次下令確定。');
            if (x === 'hanXin') { add(plan.cost, { grain: 2 }); add(plan.gains, { grain: 10, defense: -3 }); event('軍隊護商糧與巡防缺口', { grain: flexible ? 14 : 12, defense: -3 }, { merchants: 3, army: -2 }, x, '商糧有軍隊護送，巡防缺口則仍留在邊營。'); plan.notes.push('韓信：把護衛集中到商隊；前批較少，後批較大，其他巡防承擔缺口。'); }
            else if (x === 'xiaoHe') { add(plan.cost, { treasury: 1 }); add(plan.gains, { grain: 16 }); event('蕭何核約的後批商糧', { grain: 8 }, { merchants: 4 }, x, '現款與分批合約逐筆核對，後批八糧按約入倉。'); plan.notes.push('蕭何：前批十六糧、後批八糧，逐筆核對付款與實際交付。'); }
            else { add(plan.cost, { treasury: 2 }); add(plan.gains, { grain: 13, people: 3 }); event('公開比價的商糧尾款', { grain: 6, treasury: 2 }, { merchants: 2, officials: -3 }, x, '公開比價使被多列的兩國庫退回；六糧尾批抵達。'); plan.notes.push('魏徵：公開比價與採買責任，前批十三糧；查核後退回兩國庫，運量較小。'); }
        } else if (p.id === 'levy') {
            const hidden = state.stakeholders.farmers < 45 ? 5 : 0;
            add(plan.gains, { grain: 16 - hidden, people: -9, defense: 2 }); add(plan.approval, { farmers: -14, merchants: -3, army: 7, officials: 2 });
            if (hidden) plan.conditions.push('農戶合作低於四十五，藏糧使本次徵收少五糧。');
            if (x === 'hanXin') { add(plan.gains, { grain: 5, people: -3, defense: 3 }); plan.notes.push('韓信：沿要道迅速徵集，多得五糧、邊防多三，民戶額外承受三民心成本。'); }
            else if (x === 'xiaoHe') { add(plan.gains, { grain: 4, people: 3 }); plan.notes.push('蕭何：按戶籍與實倉排除重徵，多得四糧，減少三民心損耗。'); }
            else { add(plan.gains, { grain: -3, people: flexible ? -2 : 5 }); plan.notes.push(flexible ? '魏徵：臨機處置失去可核對的配額，查核沒能保障民戶，仍會留下反對意見。' : '魏徵：逐戶核定限額，少收三糧，減少五民心損耗；支持救急不代表免除補償。'); }
            if (s.id !== 'vouchers') event('未補償徵糧的回聲', { grain: -3, people: -4 }, { farmers: -6 }, x, '沒有補償的徵糧使下一批有三糧被藏起；這是已預告的負擔。');
        } else if (p.id === 'ration') {
            add(plan.approval, { farmers: 3, army: -4 });
            add(plan.gains, x === 'hanXin' ? { people: -3, defense: 2 } : x === 'xiaoHe' ? { people: 2, defense: -2 } : { people: 3, defense: -3 });
            plan.notes.push(x === 'hanXin' ? '韓信：在既有配給中優先護衛與邊營；沒有新增糧，民間順位後移。' : x === 'xiaoHe' ? '蕭何：核對名冊重排現有配給，沒有新增糧，邊營先承受少量順位調整。' : '魏徵：公開配給理由並優先最急民戶，沒有新增糧，邊軍順位後移。');
        } else if (p.id === 'audit') {
            add(plan.gains, { grain: 6, people: 3 }); add(plan.approval, { officials: -8, farmers: 4, merchants: 2, court: 3 });
            if (x === 'hanXin') { add(plan.gains, { grain: 2, defense: 7 }); add(plan.approval, { merchants: -3 }); plan.notes.push('韓信：查軍中空額，多追回兩糧並補齊兵力名冊；不是民戶配給稽核。'); }
            else if (x === 'xiaoHe') { add(plan.gains, { grain: 6, treasury: 4 }); plan.notes.push('蕭何：圖籍與倉儲實數比對，多追回六糧與四國庫；地方官面對查帳責任。'); }
            else { add(plan.gains, { grain: 3, people: 5 }); add(plan.approval, { officials: -7 }); event('稽核見證與退回款項', { treasury: 5 }, { farmers: 4, officials: -2 }, x, '公開見證追出五國庫，民戶看見賞罰與漏帳連在一起。'); plan.notes.push('魏徵：公開見證，多追回三糧，提高配給可信度；後續另追回五國庫。'); }
        } else if (p.id === 'fortify') {
            add(plan.gains, { defense: 14, people: -2 }); add(plan.approval, { army: 8, farmers: -4, merchants: -2 });
            if (x === 'hanXin') { add(plan.cost, { grain: 2 }); add(plan.gains, { defense: flexible ? 6 : 3, people: flexible ? -3 : -1 }); plan.notes.push(flexible ? '韓信：依地形換防與機動增援，立即提高六邊防；徵用與軍權集中成本增加。' : '韓信：依核定要道增援，額外提高三邊防；中央保留調動限制。'); }
            else if (x === 'xiaoHe') { add(plan.gains, { defense: 2 }); event('補給與替補接續', { defense: 6 }, { army: 3 }, x, '替補與餉糧接上，六邊防延後形成；這支軍隊仍要支付續餉。'); plan.notes.push('蕭何：先排供給與替補，立即增加較小，六邊防到交付後才形成。'); }
            else { add(plan.gains, { defense: state.resources.people >= 50 ? 4 : 1, people: 4 }); add(plan.approval, { farmers: 3 }); plan.notes.push('魏徵：公開徵用與守望規則；民心至少五十才能形成四邊防，否則只有一。'); }
            commitment('maintenance', '接續糧餉', { grain: 4, treasury: 4 }, { defense: 3 }, { defense: -10, people: -3 }, 'army');
        } else if (p.id === 'diplomacy') {
            add(plan.gains, { defense: 5, people: 3 }); add(plan.approval, { army: -3, merchants: 5, farmers: 3, court: 2 });
            if (x === 'hanXin') { const credible = state.resources.defense >= 50; event('以守待和的使節回報', { defense: credible ? flexible ? 9 : 6 : -5 }, { army: credible ? 3 : -4 }, x, credible ? '守住要道後按兵議和，對方承認糧隊通行；這次休兵有軍事後盾。' : '防線不足，使節只有短暫緩和；對方再度試探要道。'); plan.notes.push('韓信：有防線時按兵議和；本次邊防 ' + state.resources.defense + '，' + (credible ? '具備軍事後盾。' : '未達五十，已預告盟約失效的防務成本。')); }
            else if (x === 'xiaoHe') { add(plan.cost, { treasury: 2 }); event('議和期間的供給合約', { grain: 8, defense: 2 }, { merchants: 4 }, x, '換得的通行時間用於供給合約，八糧抵達，軍事威懾較小。'); plan.notes.push('蕭何：把停戰時間轉成供給合約，八糧而非大幅軍威提升。'); }
            else { const credible = state.resources.people >= 55; event('公開條款的盟約回報', { defense: credible ? 8 : 2, people: credible ? 3 : -2 }, { farmers: credible ? 3 : -2 }, x, credible ? '民間支持公開條款，盟約由實際合作接住。' : '條款已公開，但民間支持不足，盟約只換得短期緩和。'); plan.notes.push('魏徵：公開盟約理由與期限；民心 ' + state.resources.people + ' 決定是否達到五十五的合作條件。'); }
        }
        if (s.id === 'relief') { add(plan.gains, { people: 8, defense: -1 }); add(plan.approval, { farmers: 9, army: -3 }); plan.notes.push('救急用了六糧與兩國庫；護衛之外再派賑濟人手，邊防承受一點調動。'); }
        if (s.id === 'reserve') { add(plan.gains, { defense: 5 }); add(plan.approval, { army: 6, farmers: -1 }); plan.notes.push('四糧用於護衛與邊營最低糧額，不能再計成民間賑糧。'); }
        if (s.id === 'ledger') { add(plan.gains, { people: 3 }); add(plan.approval, { officials: -4, merchants: 3, farmers: 3 }); event('公開糧帳的漏數核對', { grain: 3 }, { officials: -2, farmers: 2 }, x, '公開限額與糧帳追出三糧；帳簿不是付款憑證。'); }
        if (s.id === 'vouchers') { add(plan.gains, { people: 5 }); add(plan.approval, { farmers: 6 }); commitment('compensation', '徵糧補償憑券', { treasury: 9 }, { people: 5 }, { people: -12 }, 'farmers'); }
        if (s.id === 'settle') { plan.due.forEach(c => add(plan.cost, c.cost)); plan.notes.push('付清到期承諾需要一份協調人手，款項與主措施成本合併檢查；新取得的糧不能倒填付款能力。'); }
        if (s.id === 'default') plan.notes.push('朝廷明確撤回到期承諾；原責任人的失約紀錄與利益方後果仍會結算。');
        plan.due.forEach(c => add(plan.gains, s.id === 'settle' ? c.honorEffects : s.id === 'default' ? c.breachEffects : {}));
        if (flexible) { add(plan.approval, { court: x === 'hanXin' ? -8 : -5 }); add(plan.gains, { people: -2 }); plan.notes.push('臨機授權留下程序與權力集中成本：民心減二、朝廷合作下降。'); }
        if (state.actorMemory[x].mandate === 'flexible' && !flexible) plan.conditions.push('你曾給' + name(x) + '臨機權，本次改限額。若沒有公開糧帳，突然收權會降低該人的信任四。');
        if (state.trust[x] < 40) { capacity++; plan.conditions.push(name(x) + '信任低於四十，要求多一份確認責任的人手；專業方法仍保留。'); if (capacity > limit && !plan.disabled.some(t => t.startsWith('執行人手'))) plan.disabled.push('低信任增加協調成本後，執行人手需要 ' + capacity + '，上限 ' + limit + '。'); }
        plan.capacity = { used: capacity, limit };
        Object.entries(plan.cost).forEach(([key, amount]) => { if (amount > state.resources[key]) plan.disabled.push(NAMES[key] + '需要 ' + amount + '，目前 ' + state.resources[key] + '；不能先花尚未交付的收益。'); });
        plan.effects = {};
        RESOURCES.forEach(key => { plan.effects[key] = clamp(state.resources[key] + (plan.gains[key] || 0) - (plan.cost[key] || 0)) - state.resources[key]; });
        plan.stakeholderResponses = STAKEHOLDERS.map(f => { const delta = plan.approval[f.id] || 0; const debt = plan.due.filter(c => c.beneficiary === f.id); return { id: f.id, position: debt.length && s.id === 'default' || delta < -2 ? 'oppose' : delta > 2 || debt.length && s.id === 'settle' ? 'support' : 'conditional', reason: debt.length ? s.id === 'settle' ? '本次成本包含付清「' + debt.map(c => c.title).join('、') + '」，我們會核對到帳。' : s.id === 'default' ? '朝廷撤回「' + debt.map(c => c.title).join('、') + '」，合作下降並承擔已預告後果。' : '「' + debt.map(c => c.title).join('、') + '」本回合到期，請明確付清或撤回。' : f.concern + ' 本令合作變化 ' + (delta >= 0 ? '+' : '') + delta + '；後續成本與運量會受累積合作影響。' }; });
        return plan;
    }
    function publicPlan(plan, state) {
        const terms = c => '按期付清：' + resourceText(c.honorEffects) + '，責任人信任 +5、魏徵信任 +2、受益方合作 +7；撤回：' + resourceText(c.breachEffects) + '，責任人信任 -8、魏徵信任 -6、受益方合作 -15。若責任人就是魏徵，兩項信任合併結算。';
        const resolved = plan.disabled.length ? null : transition(state, plan.order, plan);
        const worldPreview = ['每回合先執行政令與到期承諾、再接收糧車、最後維持軍民基本供給：耗九糧、兩國庫。第二回合邊境試探減三邊防，第三回合減四。', ...(resolved ? resolved.log.at(-1).consequences.filter(text => text.startsWith('危局推進')) : ['若供給少於九糧，除耗盡現糧，另減六民心、四邊防；國庫少於二，未付日常工資另減二民心。'])];
        return copy({ order: plan.order, title: plan.title, description: plan.description, cost: plan.cost, effects: plan.effects, resolutionEffects: resolved ? resolved.log.at(-1).changes : null, worldPreview, conditions: plan.conditions, disabledReasons: plan.disabled, responses: plan.responses, stakeholderResponses: plan.stakeholderResponses, pendingPreview: [...plan.inherited.map(e => '先前在途：' + e.title + '，第 ' + e.due + ' 回合結束，' + resourceText(e.effects) + '。' + partyText(e.approvalEffects)), ...plan.events.map(e => '本令新派：' + e.title + '，第 ' + e.due + ' 回合結束，' + resourceText(e.effects) + '。' + partyText(e.approvalEffects))], commitmentPreview: [...plan.due.map(c => '本回合到期：「' + c.title + '」，' + costText(c.cost) + '（付款額），選擇' + (plan.order.supplement === 'settle' ? '付清；' : plan.order.supplement === 'default' ? '撤回；' : '尚未決定；') + terms(c)), ...plan.newCommitments.map(c => '新承諾：「' + c.title + '」，第 ' + c.due + ' 回合需支付 ' + costText(c.cost) + '。' + terms(c))], executionNotes: plan.notes, capacity: plan.capacity });
    }
    function applyResource(state, effects, notices) { RESOURCES.forEach(key => { const raw = state.resources[key] + (effects[key] || 0); state.resources[key] = clamp(raw); if (raw !== state.resources[key]) notices.push(NAMES[key] + '觸及' + (raw < 0 ? '下限零' : '上限一百') + '，實際變化按邊界計算。'); }); }
    function appendMemory(state, id, text) { state.actorMemory[id].events.push(text); }
    function transition(state, order, prebuiltPlan) {
        const plan = prebuiltPlan || buildPlan(state, order);
        if (plan.disabled.length) fail('ORDER_DISABLED', plan.disabled.join('；'));
        const next = copy(state), consequences = [], commitmentEvents = [], changes = {}, round = state.turn + 1;
        applyResource(next, plan.effects, consequences);
        Object.entries(plan.approval).forEach(([key, value]) => { next.stakeholders[key] = clamp(next.stakeholders[key] + value); });
        Object.entries(plan.relations).forEach(([key, value]) => { next.relations[key] = clamp(next.relations[key] + value); });
        const actor = next.actorMemory[order.executor];
        if (actor.mandate === 'flexible' && order.authority === 'bounded') { const transparent = order.supplement === 'ledger'; next.trust[order.executor] = clamp(next.trust[order.executor] - (transparent ? 0 : 4)); const text = '第' + round + '回合把我的臨機授權改為限額，' + (transparent ? '公開程序說明了收權。' : '未另公開交接程序，合作條件收緊。'); appendMemory(next, order.executor, text); commitmentEvents.push(name(order.executor) + '記得授權收回：' + text); }
        actor.mandate = order.authority; actor.commissions++;
        appendMemory(next, order.executor, '第' + round + '回合受命執行「' + PRIMARY[order.primary].title + '」，採' + (order.authority === 'flexible' ? '臨機授權' : '限額授權') + '。');
        next.trust[order.executor] = clamp(next.trust[order.executor] + 1);
        plan.memoryEvents.forEach(m => { appendMemory(next, m.owner, m.text); if (m.honored) { next.actorMemory[m.owner].honored++; next.trust[m.owner] = clamp(next.trust[m.owner] + 5); next.trust.weiZheng = clamp(next.trust.weiZheng + 2); commitmentEvents.push(m.text); } });
        plan.due.forEach(c => {
            const honored = order.supplement === 'settle';
            next.stakeholders[c.beneficiary] = clamp(next.stakeholders[c.beneficiary] + (honored ? 7 : -15));
            next.actorMemory[c.owner][honored ? 'honored' : 'breached']++;
            next.trust[c.owner] = clamp(next.trust[c.owner] + (honored ? 5 : -8));
            next.trust.weiZheng = clamp(next.trust.weiZheng + (honored ? 2 : -6));
            const text = '第' + round + '回合' + (honored ? '付清' : '公開撤回') + '「' + c.title + '」；第' + c.sourceTurn + '回合由' + name(c.owner) + '負責，' + (honored ? '按期履約。' : '失約後果已結算。');
            appendMemory(next, c.owner, text); if (c.owner !== 'weiZheng') appendMemory(next, 'weiZheng', text); commitmentEvents.push(text);
            consequences.push(text + ' ' + resourceText(honored ? c.honorEffects : c.breachEffects) + '。');
            const relationKey = c.owner === 'hanXin' ? 'hanWei' : c.owner === 'xiaoHe' ? 'xiaoWei' : 'xiaoWei'; next.relations[relationKey] = clamp(next.relations[relationKey] + (honored ? 4 : -7));
        });
        next.commitments = next.commitments.filter(c => !plan.due.some(d => d.id === c.id));
        plan.newCommitments.forEach(c => { next.commitments.push(copy(c)); appendMemory(next, c.owner, '第' + round + '回合承擔「' + c.title + '」，第' + c.due + '回合到期。'); });
        next.pending.push(...copy(plan.events)); next.turn = round;
        const arrived = next.pending.filter(e => e.due <= round); next.pending = next.pending.filter(e => e.due > round);
        arrived.forEach(e => { applyResource(next, e.effects, consequences); Object.entries(e.approvalEffects).forEach(([key, value]) => { next.stakeholders[key] = clamp(next.stakeholders[key] + value); }); appendMemory(next, e.owner, '第' + round + '回合回報：' + e.memory); consequences.push(e.title + '：' + e.memory + ' ' + resourceText(e.effects) + '。'); });
        const upkeep = { grain: -Math.min(9, next.resources.grain), treasury: -Math.min(2, next.resources.treasury), people: 0, defense: round === 2 ? -3 : round === 3 ? -4 : 0 };
        const shortages = [];
        if (next.resources.grain < 9) { add(upkeep, { people: -6, defense: -4 }); shortages.push('基本供給不足九糧，另減六民心與四邊防'); }
        if (next.resources.treasury < 2) { add(upkeep, { people: -2 }); shortages.push('日常工資未付足兩國庫，另減二民心'); }
        const beforeUpkeep = copy(next.resources); applyResource(next, upkeep, consequences);
        const actualUpkeep = {}; RESOURCES.forEach(key => { actualUpkeep[key] = next.resources[key] - beforeUpkeep[key]; });
        consequences.push('危局推進：本回合糧車到貨後，軍民基本供給與邊境試探結算，' + resourceText(actualUpkeep) + '。' + (shortages.length ? shortages.join('；') + '。' : '九糧與兩國庫供給付足。'));
        RESOURCES.forEach(key => { changes[key] = next.resources[key] - state.resources[key]; });
        const reactions = plan.responses.map(r => { const memoryText = next.actorMemory[r.id].events.filter(e => !e.startsWith('第' + round + '回合受命')).at(-1); return { id: r.id, text: '遊戲改編：' + (r.position === 'oppose' ? '我的反對仍保留，但依職責執行。' : r.position === 'conditional' ? '我按已說明的條件配合。' : '我支持本令的這部分安排。') + r.reason + (memoryText ? ' 本局記憶：' + memoryText : '') }; });
        const stakeholderReactions = plan.stakeholderResponses.map(r => ({ id: r.id, text: r.reason + ' 結算後合作 ' + next.stakeholders[r.id] + '。' }));
        next.log.push({ turn: round, order: copy(order), title: plan.title, changes, reactions, consequences, stakeholderReactions, commitmentEvents, executionNotes: copy(plan.notes) });
        return next;
    }
    function record(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const proto = Object.getPrototypeOf(value); return proto === Object.prototype || proto === null; }
    function same(actual, expected, depth) {
        if (depth > 40 || typeof actual !== typeof expected) return false;
        if (expected === null || typeof expected !== 'object') return actual === expected;
        if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && Object.keys(actual).length === expected.length && expected.every((v, i) => same(actual[i], v, depth + 1));
        if (!record(actual)) return false;
        const keys = Object.keys(expected); return Object.keys(actual).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(actual, k) && same(actual[k], expected[k], depth + 1));
    }
    function validateState(state) {
        try {
            if (!record(state) || state.version !== 2 || state.scenario !== SCENARIO || !Number.isInteger(state.turn) || state.turn < 0 || state.turn > 3 || !Array.isArray(state.log) || state.log.length !== state.turn) return false;
            let expected = createGame();
            for (const entry of state.log) { if (!record(entry) || !legalOrderShape(entry.order)) return false; expected = transition(expected, entry.order); }
            return same(state, expected, 0);
        } catch (_) { return false; }
    }
    function assertState(state) { if (!validateState(state)) fail('INVALID_STATE', '議政存檔與完整政令紀錄不一致，請使用有效存檔或重開。'); }
    function evaluateOrder(state, order) { assertState(state); return publicPlan(buildPlan(state, order), state); }
    function choose(state, order) { assertState(state); return transition(state, order); }
    function recommendations(state) {
        const due = dueFor(state).length;
        const candidates = due ? [
            { title: '優先履約、再重排配給', description: '保留主措施選擇，把已到期的帳單納入預算。', order: { primary: 'ration', supplement: 'settle', executor: 'xiaoHe', authority: 'bounded' } },
            { title: '履約並調撥近遠倉', description: '糧與國庫足夠時，一起調撥官倉。', order: { primary: 'route', supplement: 'settle', executor: 'xiaoHe', authority: 'bounded' } },
            { title: '承認失約、核對徵糧', description: '付不起時仍有退路，但責任與失約後果會留下。', order: { primary: 'levy', supplement: 'default', executor: 'weiZheng', authority: 'bounded' } }
        ] : [
            { title: '圖籍調度＋公開糧帳', description: '蕭何排定近遠倉，三位廷臣都有支持的理由。', order: { primary: 'route', supplement: 'ledger', executor: 'xiaoHe', authority: 'bounded' } },
            { title: '地形佯動＋機宜護運', description: '韓信取得較大戰術空間，朝廷承擔軍權與巡防成本。', order: { primary: 'route', supplement: 'none', executor: 'hanXin', authority: 'flexible' } },
            { title: '限額徵糧＋到期補償', description: '魏徵可支持徵糧；補償需要真實付款。', order: { primary: 'levy', supplement: 'vouchers', executor: 'weiZheng', authority: 'bounded' } },
            { title: '重排配給、保存選擇空間', description: '沒有新增糧，也沒有新欠款；承認當前資源限制。', order: { primary: 'ration', supplement: 'none', executor: 'xiaoHe', authority: 'bounded' } }
        ];
        return candidates.filter(c => primaryIds(state).includes(c.order.primary) && !buildPlan(state, c.order).disabled.length).map(copy);
    }
    function getCatalog(state) {
        assertState(state); if (state.turn >= 3) return { primaries: [], supplements: [], executors: [], authorities: [], recommendations: [] };
        return copy({ primaries: primaryIds(state).map(id => { const { capacity, ...item } = PRIMARY[id]; return { ...item, description: item.description + ' 主措施人手 ' + capacity + '。' }; }), supplements: SUPPLEMENTS.map(({ capacity, ...item }) => ({ ...item, description: item.description + ' 配套人手 ' + capacity + '。' })), executors: ADVISORS.map(a => ({ id: a.id, name: a.name, description: a.profile.strength })), authorities: AUTHORITIES, recommendations: recommendations(state) });
    }
    function getScene(state) {
        assertState(state);
        const scene = state.turn < 3 ? copy(SCENES[state.turn]) : { id: 'council-conclusion', title: '三次朝會的交付與責任', eyebrow: '本局完成', description: '所有糧車與到期帳單已在本局結算。人物的記憶、民間合作與權力代價一起保留。這是跨時代架空遊戲改編。' };
        const last = state.log.at(-1);
        scene.news = last ? ['上一道政令：' + last.title, ...last.consequences, ...last.commitmentEvents] : ['近倉可即時調撥；遠倉需等下一回合。起始糧四十二、國庫六十。'];
        scene.news.push('危局持續：每回合糧車到貨後耗九糧、兩國庫；第二回合敵方試探減三邊防，第三回合減四。少糧另減六民心、四邊防，缺日常工資另減二民心。');
        state.pending.forEach(e => scene.news.push('在途：' + e.title + '，第' + e.due + '回合結束回報。'));
        state.commitments.forEach(c => scene.news.push('承諾：' + c.title + '，第' + c.due + '回合到期支付 ' + resourceText(c.cost) + '。'));
        scene.briefings = ADVISORS.map(a => { const lastMemory = state.actorMemory[a.id].events.at(-1); const text = state.turn === 0 ? a.id === 'hanXin' ? '遊戲改編情報：東谷能做佯動，但要臨機權並抽調巡防；限額護運只能送小批。我也支持以守待和。' : a.id === 'xiaoHe' ? '遊戲改編情報：圖籍上有一座近倉與兩座遠倉，先開近倉能多得四糧。我可替有公開運期的韓信糧隊作保。' : '遊戲改編情報：徵糧若有核定限額與補償憑券，我可以支持；下一回合必須付清，不以表態代替履約。' : '遊戲改編：' + (lastMemory || '本局尚未由我執行主措施，但我會按具體條件議政。') + (state.trust[a.id] < 40 ? ' 我會繼續運用專業，但要求多一份責任確認人手。' : ''); return { advisor: a.id, text }; });
        scene.stakeholderNews = STAKEHOLDERS.map(f => ({ id: f.id, text: f.concern + ' 合作 ' + state.stakeholders[f.id] + (f.id === 'merchants' ? '；低於四十五採買加價四，高於或等於六十五減價二。' : f.id === 'farmers' ? '；低於四十五徵糧少五。' : f.id === 'army' ? '；低於四十遠倉護運少四。' : f.id === 'officials' ? '；低於三十五修路多占一份人手。' : '；低於三十五總協調人手從四降為三。') }));
        return scene;
    }
    function getEnding(state) {
        assertState(state); if (state.turn < 3) return null;
        const r = state.resources, broken = IDS.reduce((n, id) => n + state.actorMemory[id].breached, 0), honored = IDS.reduce((n, id) => n + state.actorMemory[id].honored, 0);
        let ending;
        if (r.grain < 20 || r.people < 35 || r.defense < 35) ending = { id: 'crisis', title: '危局仍有裂縫', summary: '已到貨與已付帳都算清了，糧、民心或防務仍有缺口；人物的責任紀錄不能被帳面改善抹掉。' };
        else if (broken) ending = { id: 'broken', title: '國勢暫穩，承諾失信', summary: '朝廷保住部分局勢，卻明確撤回了' + broken + '項承諾；後果已結算，失約責任仍在人物記憶與民間合作中。' };
        else if (honored && r.people >= 60 && r.grain >= 30) ending = { id: 'accountable', title: '交付有據，承諾有款', summary: '朝廷在救急與防務之間付清到期責任，履約' + honored + '次；可核對的交付讓人物與民間合作有了依據。' };
        else if (r.defense >= 75 && r.grain >= 22) ending = { id: 'frontier', title: '守住要道，權力留有代價', summary: '防線與糧道得到保障，調動、軍權與配給順位的代價仍留在合作紀錄。' };
        else if (r.grain >= 65) ending = { id: 'granary', title: '近遠倉交付，供給恢復', summary: '不同執行方法把糧送入倉；庫存增加的同時，查核、徵役與護衛缺口已逐項結算。' };
        else ending = { id: 'fragile', title: '暫度難關，仍需協調', summary: '三次朝會結束，朝廷尚有基本餘力；人物之間的擔保、授權與各方合作決定下一次危機的起點。' };
        const lessons = ['所有方法與人物反應均為本局架空遊戲改編；史料連結提供設計線索，數值不代表人物史實。', '最終國勢：' + RESOURCES.map(k => NAMES[k] + ' ' + r[k]).join('、') + '。', '本局政令：' + state.log.map(e => e.title).join(' → ') + '。'];
        state.log.flatMap(e => e.commitmentEvents).forEach(text => lessons.push(text));
        IDS.forEach(id => { const m = state.actorMemory[id]; if (m.commissions || m.events.length) lessons.push(name(id) + '：受命' + m.commissions + '次、履約' + m.honored + '次、失約' + m.breached + '次；' + (m.events.at(-1) || '尚無交付回報')); });
        if (state.relations.hanXiao > 50) lessons.push('蕭何曾替韓信的運期作保，兩人的合作從五十提高至' + state.relations.hanXiao + '；由共同責任形成，並非固定同盟。');
        lessons.push('最終各方合作：' + STAKEHOLDERS.map(f => f.name + ' ' + state.stakeholders[f.id]).join('、') + '。');
        lessons.push('到期承諾剩餘 ' + state.commitments.length + '、在途回報剩餘 ' + state.pending.length + '；沒有把應付帳單藏到局外。');
        return { ...ending, lessons };
    }
    function exportReplay(state) { assertState(state); const ending = getEnding(state); return { format: 'dynasty-council-replay', version: 2, scenario: SCENARIO, orders: state.log.map(e => copy(e.order)), ending: ending ? ending.id : null, state: copy(state) }; }
    function importReplay(value) { if (typeof value === 'string') { if (value.length > 120000) fail('INVALID_REPLAY', '議政回放檔過大。'); try { value = JSON.parse(value); } catch (_) { fail('INVALID_REPLAY', '議政回放檔不是有效 JSON。'); } } if (!record(value) || !validateState(value.state) || !same(value, exportReplay(value.state), 0)) fail('INVALID_REPLAY', '議政回放檔與政令紀錄不一致。'); return copy(value.state); }
    return Object.freeze({ ADVISORS: freeze(ADVISORS), STAKEHOLDERS: freeze(STAKEHOLDERS), createGame, getScene, getCatalog, evaluateOrder, choose, getEnding, validateState, exportReplay, importReplay });
});
