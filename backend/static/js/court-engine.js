(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyCourt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const SCENARIO = 'court-grain-v1';
    const RESOURCE_KEYS = ['grain', 'treasury', 'people', 'defense'];
    const ADVISOR_KEYS = ['hanXin', 'xiaoHe', 'weiZheng'];
    const RESOURCE_NAMES = { grain: '糧儲', treasury: '國庫', people: '民心', defense: '邊防' };
    const ADVISORS = Object.freeze([
        Object.freeze({ id: 'hanXin', name: '韓信', role: '軍務', stance: '遊戲改編：先穩軍心，守住糧道；但軍事優勢也需要民間供給。', lesson: '遊戲改編：把軍事執行力放進糧餉、時機與統治成本一起衡量。', portrait: '/static/game/court/han-xin.png' }),
        Object.freeze({ id: 'xiaoHe', name: '蕭何', role: '糧運', stance: '遊戲改編：帳籍、糧道與供給決定朝廷能走多遠；調度需要時間與國庫。', lesson: '遊戲改編：制度與後勤的價值會延後顯現，不能只看眼前的庫存。', portrait: '/static/game/court/xiao-he.png' }),
        Object.freeze({ id: 'weiZheng', name: '魏徵', role: '民心進諫', stance: '遊戲改編：讓百姓相信承諾，救濟才能變成合作；安民也要留足防務。', lesson: '遊戲改編：進諫讓被忽略的代價浮上檯面，民心能轉成實際的協作。', portrait: '/static/game/court/wei-zheng.png' })
    ]);
    const SCENES = [
        { id: 'grain-shortage', title: '缺糧朝會', eyebrow: '第一回合 · 決定糧從何來', description: '連雨阻斷糧道，城外等著賑糧，邊軍也在催餉。你只有三次朝會可以穩住局面。韓信、蕭何、魏徵跨越時代來到同一座架空朝堂，三人的主張各有代價。這不是歷史事件重演。' },
        { id: 'border-report', title: '邊報入殿', eyebrow: '第二回合 · 邊防與生計', description: '北境傳來試探性侵擾，商路因此漲價。上一道政令尚在執行，眼前的新命令會與它一起產生後果。是先補軍、談停戰，還是趁通路尚未關閉補足糧儲？' },
        { id: 'last-council', title: '最後一道詔令', eyebrow: '第三回合 · 讓承諾落地', description: '糧車、使節與邊軍的回報即將到齊。你還能發布一道命令。廷臣會記得你此前的選擇；累積的信任能讓執行更順利，但不會免除成本。這道詔令之後，朝堂將留下本局的結論。' }
    ];

    function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
    function copy(value) { return JSON.parse(JSON.stringify(value)); }
    function advisorName(id) { return ADVISORS.find(advisor => advisor.id === id).name; }
    function createGame() {
        return { version: 1, scenario: SCENARIO, turn: 0,
            resources: { grain: 42, treasury: 60, people: 55, defense: 52 },
            trust: { hanXin: 50, xiaoHe: 50, weiZheng: 50 }, log: [], pending: [] };
    }

    // The same deterministic reducer powers play and resume validation. No clock, RNG or AI.
    function choicesFor(state) {
        const xiaoReady = state.trust.xiaoHe >= 65;
        const weiReady = state.trust.weiZheng >= 65 && state.resources.people >= 50;
        const hanReady = state.trust.hanXin >= 65;
        let choices;
        if (state.turn === 0) choices = [
            { id: 'r1-route', title: '修復糧道，調撥官倉', advisor: 'xiaoHe', description: '蕭何：先花國庫疏通糧道，再發出分批運糧令。今夜能開一座近倉，遠倉要到第二回合結束才抵達；徵用民夫會損耗少量民心。', cost: { treasury: 18 }, effects: { grain: 12, treasury: -18 }, trustEffects: { xiaoHe: 12, hanXin: -4, weiZheng: 2 }, delayedHint: '第二回合結束：糧儲 +16、民心 -3。', result: '近倉開門，朝廷先取得一批糧。遠倉運輸已啟動，仍需等待。', future: { title: '糧車抵達', effects: { grain: 16, people: -3 }, trustEffects: { xiaoHe: 3 }, news: '蕭何安排的遠倉糧車抵達；徵役的民夫抱怨農時被耽擱。糧儲 +16，民心 -3。' }, reactions: ['兵糧有了著落，但邊境等不起太久。', '帳籍與糧道要一起修；第二回合再看遠倉回報。', '可調度糧，也要記住徵役的民戶。'] },
            { id: 'r1-requisition', title: '徵集民糧，先穩邊軍', advisor: 'hanXin', description: '韓信：立刻徵糧補軍，邊軍可迅速恢復部署。但百姓會承受負擔，第二回合結束將出現匿糧與補償支出。', cost: {}, effects: { grain: 22, people: -12, defense: 8 }, trustEffects: { hanXin: 12, xiaoHe: -3, weiZheng: -10 }, delayedHint: '第二回合結束：民心 -10、國庫 -6。', result: '徵糧令讓庫存與邊軍部署立即改善。民戶已開始記下這次負擔。', future: { title: '徵糧的民間回聲', effects: { people: -10, treasury: -6 }, trustEffects: { weiZheng: -4 }, news: '部分民戶藏起餘糧，朝廷另付補償。先前的徵糧令再付出民心 -10、國庫 -6 的代價。' }, reactions: ['糧到營中，軍令才能落地。之後仍須補上民間供給。', '帳面增加的糧不能當成每回合都會再來。', '徵糧若沒有補償，百姓會把下一次承諾當成空話。'] },
            { id: 'r1-relief', title: '開倉賑濟，公開糧帳', advisor: 'weiZheng', description: '魏徵：先用糧與國庫救急，公開配給規則以換回民心。第二回合結束會有商戶捐糧；眼前的軍務得先承受壓力。', cost: { grain: 10, treasury: 10 }, effects: { grain: -10, treasury: -10, people: 18, defense: -4 }, trustEffects: { weiZheng: 14, xiaoHe: 3, hanXin: -6 }, delayedHint: '第二回合結束：糧儲 +8、國庫 +8、民心 +4。', result: '賑糧送到城外，配給帳公開。民心回升，邊軍知道自己暫時不是第一順位。', future: { title: '商戶回應公開承諾', effects: { grain: 8, treasury: 8, people: 4 }, trustEffects: { weiZheng: 3 }, news: '商戶看見糧帳與配給落實，送來捐糧及款項。糧儲 +8、國庫 +8、民心 +4。' }, reactions: ['救濟能減少動盪，但下一輪要留意邊防。', '公開帳籍讓後續調度有人願意配合。', '承諾要可核對，民心才會成為下一輪的助力。'] }
        ];
        else if (state.turn === 1) {
            const supported = state.resources.people >= 60;
            choices = [
                { id: 'r2-garrison', title: '增援邊營，護住要道', advisor: 'hanXin', description: '韓信：支付糧餉增援要道，立刻提高邊防。駐軍要在第三回合再領一筆餉，沿線徵用也會引來不滿。', cost: { grain: 18, treasury: 12 }, effects: { grain: -18, treasury: -12, people: -2, defense: 22 }, trustEffects: { hanXin: 10, xiaoHe: -3, weiZheng: -2 }, delayedHint: '第三回合結束：國庫 -5、民心 -4。', result: '援軍入營，要道升起新的烽火。此刻防線更穩，續餉已列入下一輪帳單。', future: { title: '駐軍續餉', effects: { treasury: -5, people: -4 }, trustEffects: { hanXin: 2 }, news: '邊營守住要道，但續餉與沿線徵用仍須支付。國庫 -5、民心 -4。' }, reactions: ['守住要道，敵人就不能輕易切斷我們的下一批糧。', '增兵是新支出，不能把續餉漏出帳外。', '軍隊守的是民戶，徵用也必須算進軍事決策。'] },
                { id: 'r2-truce', title: '派出使節，爭取停戰', advisor: 'weiZheng', description: '魏徵：用禮糧換時間，邊境暫時緩和。出使當下民心達 60，民間願為盟約作保；不足 60，使節的承諾將被質疑。成敗在第三回合結束回報。', cost: { grain: 6, treasury: 16 }, effects: { grain: -6, treasury: -16, people: 8, defense: 8 }, trustEffects: { weiZheng: 8, xiaoHe: 4, hanXin: -6 }, delayedHint: supported ? '民心已達 60；第三回合結束：邊防 +10，盟約獲得支持。' : '民心未達 60；第三回合結束：邊防 -8，盟約未能落實。', result: supported ? '使節攜帶禮糧出城。民間願意支持盟約，仍須等待對方履約。' : '使節攜帶禮糧出城。民間對承諾仍有疑慮，廷臣已警告盟約執行風險。', future: { title: supported ? '盟約落實' : '盟約失效', effects: { defense: supported ? 10 : -8 }, trustEffects: { weiZheng: supported ? 3 : -4 }, news: supported ? '民間支持讓盟約得以落實，邊境巡守恢復秩序。邊防 +10。' : '使節的承諾缺少民間支持，對方再次試探要道。先前預告的盟約風險成真，邊防 -8。' }, reactions: ['停戰換來的時間，要用來準備下一次危機。', '禮糧與路費已記帳，現在可以安排下一輪供給。', supported ? '民戶願意支持，這次承諾才有人接得住。' : '民心不足的風險已明說；承諾不能憑使節一人兌現。'] },
                { id: 'r2-market', title: '採買商糧，維持運輸', advisor: 'xiaoHe', description: '蕭何：趁商路尚通，花國庫分批採買。第三回合會再到一批糧；把護衛留給糧隊，邊境巡防就會出現空隙。', cost: { treasury: 22 }, effects: { grain: 18, treasury: -22, people: 3, defense: -3 }, trustEffects: { xiaoHe: 10, hanXin: -5, weiZheng: 2 }, delayedHint: '第三回合結束：糧儲 +8、民心 +2、邊防 -7。', result: '商糧先送抵一批，國庫支付採買款。護衛跟隨後續糧隊，邊防暫時承受缺口。', future: { title: '商糧與護衛缺口', effects: { grain: 8, people: 2, defense: -7 }, trustEffects: { xiaoHe: 3 }, news: '第二批商糧送抵；敵方利用護衛調離，試探邊境。糧儲 +8、民心 +2、邊防 -7。' }, reactions: ['糧隊得到護衛，但邊營的人不會自己變多。', '下一批糧會按約到達，務必留下補防的餘地。', '商戶有款可收，百姓也能看見糧在路上。'] }
            ];
        } else if (state.turn === 2) choices = [
            { id: 'r3-counter', title: '整軍反制，重立邊威', advisor: 'hanXin', description: '韓信：付出最後一筆糧餉，以整軍行動壓住敵方試探。韓信信任達 65，軍令協調更順；軍事動員仍會增加民間負擔。', cost: { grain: 26, treasury: 14 }, effects: { grain: -26, treasury: -14, people: -7, defense: hanReady ? 24 : 20 }, trustEffects: { hanXin: 10, xiaoHe: -3, weiZheng: -6 }, delayedHint: hanReady ? '韓信記得先前的支持：本次邊防額外 +4。並結算上一輪政令。' : '韓信信任未達 65，使用一般整軍效果。並結算上一輪政令。', result: hanReady ? '韓信記得你先前對軍務的支持，將領協調一致，邊防額外提高。動員的民間成本仍照實支付。' : '韓信執行整軍令。邊境更有威懾力，朝廷也付出糧餉與動員的民間成本。', reactions: ['軍令已行，守住的邊境還需要往後每一季的糧餉。', '最後一筆軍費入帳；之後只能憑現有糧儲周轉。', '軍威能保住道路，仍要讓被動員的民戶看見補償。'] },
            { id: 'r3-audit', title: '整頓糧帳，追回漏糧', advisor: 'xiaoHe', description: '蕭何：支付稽核成本，追補漏糧、修正配給並補強要道。蕭何信任達 65，前兩輪建立的合作能再追回 8 糧與 6 國庫；行動無法立刻形成重兵。', cost: { treasury: 8 }, effects: { grain: xiaoReady ? 18 : 10, treasury: xiaoReady ? -2 : -8, people: 8, defense: 4 }, trustEffects: { xiaoHe: 8, weiZheng: 4, hanXin: -3 }, delayedHint: xiaoReady ? '蕭何記得先前的合作：本次另追回糧儲 +8、國庫 +6。並結算上一輪政令。' : '蕭何信任未達 65，使用一般稽核效果。並結算上一輪政令。', result: xiaoReady ? '蕭何憑累積的調度合作追回更多漏糧及款項。公開配給改善民心，但邊防只獲得有限補強。' : '糧帳重新核對，漏糧追回，配給獲得修正。合作尚未累積到額外追補的程度。', reactions: ['糧補回來了，軍中仍會盯緊邊境的空隙。', '你此前的每次調度，都決定今日帳籍能追到哪裡。', '稽核若能讓配給公平，百姓才願意相信下一道糧令。'] },
            { id: 'r3-covenant', title: '定額賑糧，召集民間協作', advisor: 'weiZheng', description: '魏徵：以最後一批賑糧公布可查核的配給承諾，邀請民間共同守望。魏徵信任達 65 且當下民心達 50，協作會多帶來 4 邊防；糧庫也將進一步減少。', cost: { grain: 14, treasury: 8 }, effects: { grain: -14, treasury: -8, people: 18, defense: weiReady ? 10 : 6 }, trustEffects: { weiZheng: 10, xiaoHe: 2, hanXin: -3 }, delayedHint: weiReady ? '魏徵與民戶願意協作：本次邊防額外 +4。並結算上一輪政令。' : '信任或民心尚不足，使用一般協作效果。並結算上一輪政令。', result: weiReady ? '先前的公開承諾獲得信任，民戶加入守望。民心與邊防一起改善，糧儲仍按賑濟量減少。' : '配給承諾再次公告，民心回升，守望得到有限支援。要形成更大的協作，信任與民心仍須累積。', reactions: ['民間守望有助防務，但不能替代營中兵糧。', '配給已列出定額，之後不能隨意追加糧令。', '進諫的成效不只在朝堂文字，也在民戶是否願意一起做事。'] }
        ];
        else return [];
        return choices.map(choice => ({ ...choice, disabledReason: costReason(state, choice.cost) }));
    }

    function costReason(state, cost) {
        const missing = RESOURCE_KEYS.filter(key => cost[key] && state.resources[key] < cost[key]);
        return missing.length ? missing.map(key => RESOURCE_NAMES[key] + '至少需要 ' + cost[key] + '（目前 ' + state.resources[key] + '）').join('；') : null;
    }
    function applyEffects(state, effects, trustEffects, notices) {
        Object.entries(effects || {}).forEach(([key, delta]) => {
            const raw = state.resources[key] + delta;
            state.resources[key] = Math.max(0, Math.min(100, raw));
            if (raw < 0 || raw > 100) notices.push(RESOURCE_NAMES[key] + '達到' + (raw < 0 ? '下限 0' : '上限 100') + '，實際變化已按界限計算。');
        });
        Object.entries(trustEffects || {}).forEach(([key, delta]) => { state.trust[key] = Math.max(0, Math.min(100, state.trust[key] + delta)); });
    }
    function transition(state, choiceId) {
        if (state.turn >= 3) fail('GAME_COMPLETE', '本局已結束，請重開一局。');
        const choice = choicesFor(state).find(item => item.id === choiceId);
        if (!choice) fail('INVALID_CHOICE', '這道選擇不屬於目前回合。');
        if (choice.disabledReason) fail('INSUFFICIENT_RESOURCES', choice.disabledReason);
        const next = copy(state);
        const notices = [choice.result];
        applyEffects(next, choice.effects, choice.trustEffects, notices);
        if (choice.future) next.pending.push({ id: choice.id + '-consequence', sourceChoice: choice.id, due: state.turn + 2, title: choice.future.title, effects: copy(choice.future.effects), trustEffects: copy(choice.future.trustEffects), news: choice.future.news });
        next.turn++;
        const due = next.pending.filter(event => event.due <= next.turn);
        next.pending = next.pending.filter(event => event.due > next.turn);
        due.forEach(event => { notices.push(event.news); applyEffects(next, event.effects, event.trustEffects, notices); });
        const changes = {};
        RESOURCE_KEYS.forEach(key => { changes[key] = next.resources[key] - state.resources[key]; });
        const reactions = ADVISORS.map((advisor, index) => {
            const remembered = state.log.filter(entry => entry.advisor === advisor.id).at(-1);
            const memory = remembered ? '我記得你曾採納「' + remembered.title + '」。' : '';
            const mood = next.trust[advisor.id] >= 65 ? '我願繼續配合這條路。' : next.trust[advisor.id] <= 35 ? '我仍會盡職，但對這條路有所保留。' : '';
            return { id: advisor.id, text: '遊戲改編：' + memory + choice.reactions[index] + mood };
        });
        next.log.push({ turn: next.turn, choiceId: choice.id, title: choice.title, advisor: choice.advisor, changes, reactions, consequences: notices });
        return next;
    }

    function record(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const proto = Object.getPrototypeOf(value); return proto === Object.prototype || proto === null; }
    function same(actual, expected, depth) {
        if (depth > 20 || typeof actual !== typeof expected) return false;
        if (expected === null || typeof expected !== 'object') return actual === expected;
        if (Array.isArray(expected)) {
            if (!Array.isArray(actual) || actual.length !== expected.length || Object.keys(actual).length !== expected.length) return false;
            return expected.every((value, index) => same(actual[index], value, depth + 1));
        }
        if (!record(actual)) return false;
        const keys = Object.keys(expected);
        if (Object.keys(actual).length !== keys.length) return false;
        return keys.every(key => Object.prototype.hasOwnProperty.call(actual, key) && same(actual[key], expected[key], depth + 1));
    }
    function validateState(state) {
        try {
            if (!record(state) || state.version !== 1 || state.scenario !== SCENARIO || !Number.isInteger(state.turn) || state.turn < 0 || state.turn > 3 || !Array.isArray(state.log) || state.log.length !== state.turn) return false;
            if (!record(state.resources) || !record(state.trust) || !Array.isArray(state.pending)) return false;
            if (!RESOURCE_KEYS.every(key => Number.isInteger(state.resources[key]) && state.resources[key] >= 0 && state.resources[key] <= 100) || !ADVISOR_KEYS.every(key => Number.isInteger(state.trust[key]) && state.trust[key] >= 0 && state.trust[key] <= 100)) return false;
            let expected = createGame();
            for (const entry of state.log) {
                if (!record(entry) || typeof entry.choiceId !== 'string' || entry.choiceId.length > 80) return false;
                expected = transition(expected, entry.choiceId);
            }
            return same(state, expected, 0);
        } catch (_) { return false; }
    }
    function assertState(state) { if (!validateState(state)) fail('INVALID_STATE', '朝堂存檔與決策紀錄不一致，請使用有效存檔或重開一局。'); }
    function choose(state, choiceId) { assertState(state); return transition(state, choiceId); }
    function getChoices(state) {
        assertState(state);
        return choicesFor(state).map(({ id, title, description, advisor, cost, effects, trustEffects, delayedHint, disabledReason }) => copy({ id, title, description, advisor, cost, effects, trustEffects, delayedHint, disabledReason }));
    }
    function getScene(state) {
        assertState(state);
        const scene = state.turn < 3 ? copy(SCENES[state.turn]) : { id: 'court-conclusion', title: '朝堂結局', eyebrow: '三回合完成', description: '這份結論只屬於本局架空朝堂，人物的原始資料與評級保持原樣。重開一局可比較另一條路的代價。' };
        const latest = state.log.at(-1);
        scene.news = latest ? ['上一道命令：' + latest.title, ...latest.consequences.slice(1)] : ['糧儲 42、國庫 60、民心 55、邊防 52；三位廷臣的起始信任均為 50。'];
        state.pending.forEach(event => { scene.news.push('尚待回報：' + event.title + '（第 ' + event.due + ' 回合結束結算）。'); });
        return scene;
    }
    function getEnding(state) {
        assertState(state);
        if (state.turn < 3) return null;
        const r = state.resources;
        let ending;
        if (r.grain >= 35 && r.people >= 65 && r.defense >= 40 && r.treasury >= 10) ending = { id: 'civic', title: '民心有糧，朝局再起', summary: '百姓願意合作，庫中也留有糧，邊防得到基本保障。危機過去後，公開承諾仍須照帳履行。' };
        else if (r.defense >= 75 && r.grain >= 22 && r.people >= 35) ending = { id: 'frontier', title: '邊關穩住，內政待補', summary: '防線與要道被守住，糧儲勉強可續。朝廷靠軍事手段爭取了時間，接下來必須補回國庫與民間信任。' };
        else if (r.grain >= 65 && r.treasury >= 18 && r.defense >= 40 && r.people >= 40) ending = { id: 'granary', title: '糧道重開，國用可續', summary: '糧運與帳籍讓庫存重新有了餘裕，國庫仍能運作。朝廷保住了供給，還需要把這份餘裕轉成更可靠的民心與防線。' };
        else if (r.grain < 20 || r.people < 35 || r.defense < 38) ending = { id: 'crisis', title: '一道裂縫，危局未解', summary: '有些帳面改善了，但糧、民心或邊防仍有一處缺口。延後的代價已到期，單靠下一道口頭承諾無法補齊。' };
        else ending = { id: 'fragile', title: '暫度難關，餘力有限', summary: '朝廷撐過這次短期危機，但糧、錢、民心與防務尚未形成足夠的餘裕。下一次波動仍會考驗同一組選擇。' };
        const lessons = [
            '本局是跨時代架空遊戲改編，結局不代表人物史實或原有評級。',
            '你先後採納：' + state.log.map(entry => advisorName(entry.advisor) + '的「' + entry.title + '」').join(' → ') + '。',
            '最終資源：' + RESOURCE_KEYS.map(key => RESOURCE_NAMES[key] + ' ' + r[key]).join('、') + '。'
        ];
        const participants = new Set(state.log.map(entry => entry.advisor));
        ADVISORS.filter(advisor => participants.has(advisor.id)).forEach(advisor => { lessons.push(advisor.name + '的觀點：' + advisor.lesson); });
        if (state.log.some(entry => entry.choiceId === 'r1-requisition')) lessons.push('徵糧的好處當回合可見，匿糧與補償卻在第二回合才付出；完整成本要沿著紀錄回看。');
        if (state.log.some(entry => entry.choiceId === 'r2-truce')) lessons.push('停戰分支在出使當下以民心 60 判定支持條件；後來改善民心不會追溯改寫已送出的承諾。');
        return { ...ending, lessons };
    }
    function exportReplay(state) {
        assertState(state);
        const ending = getEnding(state);
        return { format: 'dynasty-court-replay', version: 1, scenario: SCENARIO, choices: state.log.map(entry => entry.choiceId), ending: ending ? ending.id : null, state: copy(state) };
    }
    function importReplay(value) {
        if (typeof value === 'string') { if (value.length > 40000) fail('INVALID_REPLAY', '回放檔過大。'); try { value = JSON.parse(value); } catch (_) { fail('INVALID_REPLAY', '回放檔不是有效 JSON。'); } }
        if (!record(value) || !validateState(value.state) || !same(value, exportReplay(value.state), 0)) fail('INVALID_REPLAY', '回放檔與決策紀錄不一致。');
        return copy(value.state);
    }
    return Object.freeze({ ADVISORS, createGame, getScene, getChoices, choose, getEnding, validateState, exportReplay, importReplay });
});
