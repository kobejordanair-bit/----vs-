(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyCourtUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';
    const SAVE_TYPES = Object.freeze({
        'court-grain-v1': { version: 1, key: 'dynasty_court_grain_v1', engine: 'DynastyCourt', label: '初版朝會' },
        'court-grain-v2': { version: 2, key: 'dynasty_court_grain_v2', engine: 'DynastyCouncil', label: '多方議政' },
        'court-grain-v3': { version: 3, key: 'dynasty_court_grain_v3', engine: 'DynastyCampaign', label: '邊境六旬' }
    });
    const FORMAT = 'dynasty-court-save';
    const LABELS = { grain: '糧食', treasury: '國庫', people: '民心', defense: '邊防' };
    const GLYPHS = { grain: '穀', treasury: '金', people: '民', defense: '戍' };
    let host, engine, options = {}, state = null, presentOutcome = false, saved = null;
    let opened = false, storageIssue = '', corruptRaw = '', modal = null, returnFocus = null;
    let bodyOverflow = '', bodyHadClass = false, blocked = [], readGeneration = 0, importGeneration = 0;
    const DEFAULT_SCENARIO = 'court-grain-v3';
    let activeScenario = DEFAULT_SCENARIO, savedByScenario = {}, corruptByScenario = {}, issuesByScenario = {}, draft = null;

    function parseSave(value, game) {
        const type = value && Object.hasOwn(SAVE_TYPES, value.scenario) ? SAVE_TYPES[value.scenario] : null;
        const validator = game || (type && root[type.engine]);
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            value.format !== FORMAT || !type || value.version !== type.version ||
            typeof value.presentOutcome !== 'boolean' || Object.keys(value).sort().join(',') !== 'format,presentOutcome,scenario,state,version' ||
            !value.state || value.state.scenario !== value.scenario || value.state.version !== type.version ||
            !validator || typeof validator.validateState !== 'function' || !validator.validateState(value.state)) {
            throw new Error('此檔案不是有效的「缺糧朝會」存檔，或內容與決策紀錄不一致。');
        }
        if (value.presentOutcome && !value.state.log.length) throw new Error('存檔的回合紀錄不完整。');
        return JSON.parse(JSON.stringify(value));
    }

    function envelope() { return { format: FORMAT, version: SAVE_TYPES[activeScenario].version, scenario: activeScenario, state, presentOutcome }; }
    function isCouncil() { return activeScenario === 'court-grain-v2' || isCampaign(); }
    function isCampaign() { return activeScenario === 'court-grain-v3'; }
    function roundLimit(scenario = activeScenario) { return scenario === 'court-grain-v3' ? 6 : 3; }
    function selectScenario(scenario) {
        activeScenario = scenario; engine = root[SAVE_TYPES[scenario].engine];
        if (!engine) throw new Error('此版本的朝堂劇本尚未載入，請重新整理後再試。');
        saved = savedByScenario[scenario] || null; corruptRaw = corruptByScenario[scenario] || ''; storageIssue = issuesByScenario[scenario] || '';
        draft = null;
    }
    function el(tag, cls, content) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (content !== undefined) node.textContent = String(content);
        return node;
    }
    function add(parent, ...children) { children.filter(Boolean).forEach(child => parent.appendChild(child)); return parent; }
    function button(text, cls, action) {
        const node = el('button', 'court-button ' + (cls || ''), text);
        node.type = 'button'; node.addEventListener('click', action); return node;
    }
    function focusHeading() {
        const heading = host.querySelector('[data-court-focus]');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
        host.scrollTop = 0;
    }
    function loadSaved() {
        savedByScenario = {}; corruptByScenario = {}; issuesByScenario = {};
        for (const [scenario, type] of Object.entries(SAVE_TYPES)) {
            try {
                const raw = root.localStorage.getItem(type.key);
                if (!raw) continue;
                try { savedByScenario[scenario] = parseSave(JSON.parse(raw), root[type.engine]); }
                catch (_) { corruptByScenario[scenario] = raw; issuesByScenario[scenario] = type.label + '的本機存檔無法驗證。原檔仍保留，可先下載保留。'; }
            } catch (_) { issuesByScenario[scenario] = '此瀏覽器無法讀取本機存檔。你仍可遊玩，離開前請下載存檔。'; }
        }
        selectScenario(DEFAULT_SCENARIO);
    }
    function save() {
        saved = envelope(); savedByScenario[activeScenario] = saved;
        try { root.localStorage.setItem(SAVE_TYPES[activeScenario].key, JSON.stringify(saved)); storageIssue = ''; delete corruptByScenario[activeScenario]; delete issuesByScenario[activeScenario]; }
        catch (_) { storageIssue = '本局尚未寫入瀏覽器，可能是儲存空間不足。請下載存檔保留進度。'; }
    }
    function download(value, prefix = '朝堂危局_缺糧朝會') {
        const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = el('a'); anchor.href = url;
        anchor.download = prefix + '_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        root.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function messageStrip(parent) {
        if (storageIssue) {
            const banner = el('div', 'court-storage-alert'); banner.setAttribute('role', 'alert');
            add(banner, el('p', '', storageIssue));
            if (corruptRaw || state || saved) add(banner, button('下載保留', 'court-button-small', () => download(corruptRaw || (state ? envelope() : saved), '朝堂存檔保留')));
            parent.appendChild(banner);
        }
    }
    function shell() {
        host.replaceChildren();
        const nav = el('header', 'court-nav');
        const brand = el('div', 'court-brand');
        add(brand, el('span', 'court-seal', '策'), add(el('div'), el('span', 'court-brand-overline', '王侯將相 · 互動劇場'), el('strong', '', '朝堂危局')));
        add(nav, brand, button('← 回人物館', 'court-button-quiet', close));
        const main = el('main', 'court-content');
        add(host, nav, main);
        return main;
    }
    function footer(parent) {
        const footerNode = el('footer', 'court-footer');
        add(footerNode, el('span', '', '本局保存在此瀏覽器；換裝置前請下載朝堂存檔。'), el('span', '', '朝堂存檔使用本畫面的下載／匯入；三版進度分開保留。'));
        parent.appendChild(footerNode);
    }
    function title(text, level = 'h1') {
        const node = el(level, 'court-title', text); node.setAttribute('data-court-focus', ''); return node;
    }
    function advisorsStrip(parent, compact = false, briefings = [], folded = false) {
        const grid = el('div', (compact ? 'court-advisors court-advisors-compact' : 'court-advisors') + (folded ? ' court-advisors-folded' : ''));
        for (const advisor of engine.ADVISORS) {
            const card = el(folded ? 'details' : 'article', 'court-advisor' + (folded ? ' court-advisor-folded' : ''));
            card.dataset.advisor = advisor.id;
            const image = el('img', 'court-portrait'); image.src = advisor.portrait; image.alt = advisor.name + '角色插畫';
            image.loading = folded || !compact ? 'lazy' : 'eager';
            const text = el('div', 'court-advisor-copy');
            if (folded) {
                const summary = el('summary', 'court-advisor-summary');
                add(summary, image, add(el('div'), el('span', 'court-overline', advisor.role), el('h3', '', advisor.name)), el('span', 'court-advisor-toggle', '議'));
                card.appendChild(summary);
                card.open = !!(state && draft && [draft.executor, draft.commander].includes(advisor.id));
            } else add(text, el('span', 'court-overline', advisor.role), el('h3', '', advisor.name));
            add(text, el('p', 'court-advisor-stance', advisor.stance));
            const briefing = briefings.find(item => (item.advisor || item.id) === advisor.id);
            if (briefing) add(text, el('p', 'court-advisor-briefing', briefing.text));
            if (state) {
                const trust = state.trust[advisor.id];
                add(text, el('span', 'court-trust ' + (trust < 40 ? 'court-trust-low' : ''), '信任 ' + trust + ' / 100'));
            }
            if (advisor.profile) {
                const profile = el('details', 'court-profile');
                add(profile, el('summary', '', '他如何判斷局勢'));
                const labels = { drive: '在意', strength: '能做', blindSpot: '盲點', relationship: '人際' };
                for (const [key, label] of Object.entries(labels)) if (advisor.profile[key]) add(profile, add(el('p'), el('strong', '', label + ' · '), el('span', '', advisor.profile[key])));
                const memory = state && state.actorMemory && state.actorMemory[advisor.id];
                if (memory && memory.events.length) {
                    add(profile, el('strong', 'court-memory-heading', '他記得你的決定'));
                    for (const event of memory.events.slice(-3)) add(profile, el('p', 'court-memory-event', event));
                }
                text.appendChild(profile);
            }
            add(text, button('讀人物分析 ↗', 'court-analysis-button', () => showAnalysis(advisor)));
            add(card, folded ? null : image, text); grid.appendChild(card);
        }
        parent.appendChild(grid);
    }
    function renderIntro() {
        const main = shell(); messageStrip(main);
        const hero = el('section', 'court-hero');
        const copy = el('div', 'court-hero-copy');
        add(copy, el('p', 'court-overline', '六回合戰役 · 八人朝議 · 兩方來敵'), title('邊境六旬'),
            el('p', 'court-lead', '糧道、關隘、河運，三處要地同時承受壓力。敵方正在觀察你的部署。'),
            el('p', 'court-hero-note', '任命一人主持政令，再派另一人外勤。籌糧、護送、偵察、交涉，必須一同考慮。'));
        const actions = el('div', 'court-hero-actions');
        if (saved) {
            const completed = !!engine.getEnding(saved.state);
            add(actions, button(completed ? '查看上局結局 →' : '續上次戰役 →', 'court-button-primary', () => resume(DEFAULT_SCENARIO)), button('另開新局', 'court-button-outline', requestNew));
            add(copy, el('p', 'court-save-summary', '上次進度：' + (completed ? '已完成六回合' : '已完成 ' + saved.state.log.length + ' / 6 回合')));
        } else add(actions, button('入殿議政 →', 'court-button-primary', corruptRaw ? requestNew : start), button('匯入存檔', 'court-button-outline', pickImport));
        add(copy, actions);
        const placard = el('aside', 'court-hero-placard');
        add(placard, el('span', 'court-overline', '一旬，十日'), el('p', '', '六旬守境'), el('div', 'court-four-pillars', '先穩後方\n再解敵勢'), el('span', 'court-placard-note', '敵方也會部署\n每回合都會推進戰況'));
        add(hero, copy, placard); main.appendChild(hero);
        const overview = el('section', 'court-intro-resources');
        add(overview, el('div', 'court-section-heading', saved ? saved.state.turn === 0 ? '本局國勢 · 待下第一道詔令' : '上局國勢 · 續局時將從此處開始' : '入殿之前 · 國勢四柱'));
        resources(overview, saved ? saved.state : engine.createGame()); main.appendChild(overview);
        renderCampaignTheatre(main, saved ? saved.state : engine.createGame(), true);
        const intro = el('section', 'court-intro-section court-campaign-roster');
        add(intro, el('div', 'court-section-heading', '八位人物 · 點開情報、長處與盲點'));
        advisorsStrip(intro, true, [], true); main.appendChild(intro);
        const tools = el('div', 'court-intro-tools');
        add(tools, el('p', '', '跨朝代人物與敵方勢力均為架空遊戲改編。政令、外勤與敵方行動由規則結算，遊玩不呼叫 AI，也不消耗 token。'));
        if (saved) add(tools, button('下載上次存檔', 'court-button-small', () => download(saved)), button('匯入存檔', 'court-button-small', pickImport));
        add(main, tools);
        for (const scenario of ['court-grain-v2', 'court-grain-v1']) {
            const type = SAVE_TYPES[scenario], legacy = savedByScenario[scenario], legacyRaw = corruptByScenario[scenario];
            if (!legacy && !legacyRaw) continue;
            const archive = el('section', 'court-legacy-save');
            add(archive, el('h2', 'court-section-heading', type.label + ' · 原進度仍保留'), el('p', '', scenario === 'court-grain-v1' ? '初版沿用三選一、三回合規則。可以各自續玩與下載。' : '保留三位人物的三回合議政規則。可以各自續玩與下載。'));
            if (legacy) add(archive, button('查看／續玩' + type.label, 'court-button-small', () => resume(scenario)), button('下載' + type.label + '存檔', 'court-button-small', () => download(legacy, type.label + '存檔')));
            if (legacyRaw) add(archive, el('p', 'court-legacy-warning', issuesByScenario[scenario]), button('下載' + type.label + '原檔', 'court-button-small', () => download(legacyRaw, type.label + '原檔')));
            main.appendChild(archive);
        }
        footer(main); focusHeading();
    }
    function start() { selectScenario(DEFAULT_SCENARIO); state = engine.createGame(); presentOutcome = false; corruptRaw = ''; save(); renderGame(); }
    function resume(scenario = DEFAULT_SCENARIO) { selectScenario(scenario); state = JSON.parse(JSON.stringify(saved.state)); presentOutcome = saved.presentOutcome; renderGame(); }
    function requestNew() {
        const target = savedByScenario[DEFAULT_SCENARIO];
        const raw = corruptByScenario[DEFAULT_SCENARIO];
        const text = target || raw ? '新局會取代此瀏覽器的「邊境六旬」進度。可先下載保留；前兩版進度仍另存。' : '即將開始六回合戰役。內政與外勤共同影響三處戰線，前兩版進度仍另存。';
        confirm('另開一場邊境戰役？', text, '開始新局', start,
            target || raw ? () => download(raw || target, '朝堂新版舊局') : null);
    }
    function resources(parent, currentState = state) {
        const grid = el('section', 'court-resources'); grid.setAttribute('aria-label', '目前國勢');
        for (const [key, label] of Object.entries(LABELS)) {
            const value = currentState.resources[key];
            const cell = el('div', 'court-resource ' + (value <= 25 ? 'court-resource-low' : ''));
            add(cell, el('span', 'court-resource-symbol', GLYPHS[key]), el('span', 'court-resource-label', label), el('strong', 'court-resource-value', value), el('span', 'court-resource-max', '/ 100'));
            const meter = el('div', 'court-resource-meter');
            meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', label); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100'); meter.setAttribute('aria-valuenow', value);
            const fill = el('span'); fill.style.width = Math.max(0, Math.min(100, value)) + '%'; meter.appendChild(fill); cell.appendChild(meter); grid.appendChild(cell);
        }
        parent.appendChild(grid);
    }
    function smallMeter(label, value, cls = '') {
        const metric = el('div', 'court-theatre-metric ' + cls);
        add(metric, el('span', '', label), el('strong', '', value + ' / 100'));
        const meter = el('div', 'court-theatre-meter');
        meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', label);
        meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100'); meter.setAttribute('aria-valuenow', value);
        const fill = el('span'); fill.style.width = Math.max(0, Math.min(100, value)) + '%'; meter.appendChild(fill); metric.appendChild(meter);
        return metric;
    }
    function renderCampaignTheatre(parent, currentState = state, introduction = false) {
        if (!isCampaign() || !engine.getFronts || !engine.getEnemies) return;
        const theatre = el('section', 'court-campaign-theatre'); theatre.setAttribute('aria-label', '邊境戰況');
        const heading = el('div', 'court-theatre-heading');
        add(heading, add(el('div'), el('p', 'court-overline', '戰役態勢'), el('h2', 'court-section-heading', introduction ? '三處要地 · 兩方壓力' : '邊境戰況 · 已結算 ' + currentState.turn + ' / 6 回合')),
            el('p', 'court-theatre-caption', '架空戰區示意 · 連線表示補給關係'));
        theatre.appendChild(heading);
        if (!introduction) {
            const progress = el('ol', 'court-campaign-progress'); progress.setAttribute('aria-label', '六回合戰役進度');
            ['一', '二', '三', '四', '五', '六'].forEach((label, index) => {
                const item = el('li', index < currentState.turn ? 'court-turn-done' : index === currentState.turn ? 'court-turn-current' : '', label + '旬');
                if (index === currentState.turn) item.setAttribute('aria-current', 'step');
                add(item, el('span', '', index < currentState.turn ? '已結算' : index === currentState.turn ? '待決策' : '未至')); progress.appendChild(item);
            });
            theatre.appendChild(progress);
        }
        const fronts = el('div', 'court-campaign-fronts');
        const glyphs = { granary: '倉', pass: '關', river: '河' };
        for (const front of engine.getFronts(currentState)) {
            const card = el('article', 'court-front ' + (front.security < 40 || front.supply < 35 ? 'court-front-threatened' : ''));
            card.dataset.front = front.id;
            add(card, add(el('header'), el('span', 'court-front-glyph', glyphs[front.id] || '域'), el('h3', '', front.name)),
                el('p', 'court-front-description', front.description),
                add(el('p', 'court-front-intelligence'), el('strong', '', '情報 · '), el('span', '', front.intelligence || '敵情未明')),
                smallMeter('安全', front.security, front.security < 40 ? 'court-metric-low' : ''),
                smallMeter('供給', front.supply, front.supply < 35 ? 'court-metric-low' : ''));
            fronts.appendChild(card);
        }
        theatre.appendChild(fronts);
        const enemies = el('div', 'court-enemies');
        const actionLabels = { truce: '守約休戰', withdraw: '撤圍重整', forage: '掠取補給', flank: '轉向弱路', probe: '試探守備', blockade: '封鎖河運', assault: '試攻關隘' };
        for (const enemy of engine.getEnemies(currentState)) {
            const card = el('article', 'court-enemy'); card.dataset.enemy = enemy.id;
            const activeTruce = enemy.truceUntil >= currentState.turn + 1 && currentState.turn < roundLimit();
            const truceText = currentState.turn >= roundLimit() && enemy.truceUntil > 0 ? '本段戰役已結算；協議期限至第 ' + enemy.truceUntil + ' 回合' : activeTruce ? '停戰有效至第 ' + enemy.truceUntil + ' 回合' : enemy.truceUntil > 0 ? '第 ' + enemy.truceUntil + ' 回合停戰已屆期' : '尚無停戰協議';
            add(card, add(el('header'), el('span', 'court-enemy-mark', '敵'), el('h3', '', enemy.name)),
                el('p', 'court-enemy-description', enemy.description),
                add(el('p', 'court-enemy-intent'), el('strong', '', '目前動向 · '), el('span', '', enemy.intent)),
                add(el('div', 'court-enemy-status'), el('span', 'court-enemy-truce' + (activeTruce ? ' court-truce-active' : ''), truceText), el('span', '', '最近行動 · ' + (actionLabels[enemy.lastAction] || enemy.lastAction || '尚未接戰'))),
                add(el('div', 'court-enemy-metrics'), smallMeter('兵力', enemy.strength), smallMeter('補給', enemy.supply), smallMeter('凝聚', enemy.cohesion)));
            enemies.appendChild(card);
        }
        add(theatre, enemies, el('p', 'court-theatre-caption', '敵勢與要地的狀態會跨回合保留；選擇政令與外勤後，可在預覽中查看本回合敵方的應對。'));
        parent.appendChild(theatre);
    }
    function toolbar(main) {
        const tools = el('div', 'court-game-tools');
        add(tools, button('因果紀錄', 'court-button-small', showJournal), button('下載存檔', 'court-button-small', () => download(envelope())), button('匯入', 'court-button-small', pickImport), button('重開', 'court-button-small', requestNew));
        if (!isCampaign()) add(tools, button('邊境戰役首頁', 'court-button-small', () => { state = null; presentOutcome = false; selectScenario(DEFAULT_SCENARIO); renderIntro(); }));
        main.appendChild(tools);
    }
    function renderGame() {
        const main = shell(); messageStrip(main); resources(main);
        renderCampaignTheatre(main);
        if (!isCampaign()) add(main, el('p', 'court-version-note', '你正在續玩' + SAVE_TYPES[activeScenario].label + '（三回合）。「重開」會另開邊境戰役，此版本進度仍保留。'));
        if (presentOutcome) renderOutcome(main);
        else if (engine.getEnding(state)) renderEnding(main);
        else if (isCouncil()) renderCouncilScene(main);
        else renderScene(main);
        toolbar(main); footer(main); focusHeading();
    }
    function resourceText(values, showZero = false) {
        return Object.entries(values || {}).filter(([key, value]) => LABELS[key] && (showZero || value !== 0))
            .map(([key, value]) => LABELS[key] + ' ' + value).join(' ／ ');
    }
    function appendLines(parent, heading, values, cls = '') {
        if (!values || !values.length) return;
        const section = el('section', 'court-order-notes ' + cls);
        add(section, el('h4', '', heading));
        for (const value of values) add(section, el('p', '', typeof value === 'string' ? value : value.text || value.title || '已記入執行紀錄。'));
        parent.appendChild(section);
    }
    function commitmentList(parent) {
        if (!state.commitments || !state.commitments.length) return;
        const section = el('section', 'court-commitments');
        add(section, el('h3', 'court-section-heading', '未完成的承諾'));
        for (const item of state.commitments) {
            const dueNow = item.due <= state.turn + 1 && !engine.getEnding(state);
            const owner = engine.ADVISORS.find(person => person.id === item.owner);
            add(section, add(el('article', dueNow ? 'court-commitment-due' : ''),
                el('strong', '', item.title),
                el('p', '', (owner ? owner.name + '負責 · ' : '') + '第 ' + item.due + ' 回合到期' + (dueNow ? ' · 本回合須明確履約或違約' : '')),
                el('p', 'court-commitment-cost', '履約需 ' + (resourceText(item.cost) || '按承諾執行'))));
        }
        parent.appendChild(section);
    }
    function renderCouncilScene(main) {
        const scene = engine.getScene(state), catalog = engine.getCatalog(state);
        const layout = el('div', 'court-play-layout court-council-layout' + (isCampaign() ? ' court-campaign-layout' : ''));
        const paper = el('section', 'court-paper court-council-paper');
        add(paper, el('p', 'court-overline', scene.eyebrow || '第 ' + (state.turn + 1) + ' 回合'), title(scene.title, 'h2'), el('p', 'court-narrative', scene.description));
        const news = el('div', 'court-news');
        for (const item of scene.news || []) add(news, el('p', '', item));
        if (news.childElementCount) paper.appendChild(news);
        if (scene.stakeholderNews && scene.stakeholderNews.length) {
            const dispatches = el('details', 'court-dispatches');
            add(dispatches, el('summary', '', '殿外傳報 · 五方各有難處'));
            for (const item of scene.stakeholderNews) {
                const party = engine.STAKEHOLDERS.find(value => value.id === item.id);
                add(dispatches, add(el('p'), el('strong', '', (party ? party.name : item.id) + ' · '), el('span', '', item.text)));
            }
            paper.appendChild(dispatches);
        }
        commitmentList(paper);
        if (state.pending.length) {
            const pending = el('details', 'court-dispatches');
            add(pending, el('summary', '', '尚待回響 · ' + state.pending.length + ' 件'));
            for (const item of state.pending) add(pending, el('p', '', item.title + ' · 第 ' + item.due + ' 回合結算'));
            paper.appendChild(pending);
        }
        const recommendations = catalog.recommendations || [];
        draft = draft || JSON.parse(JSON.stringify(recommendations[0] ? recommendations[0].order : {
            primary: catalog.primaries[0].id, supplement: catalog.supplements[0].id,
            executor: catalog.executors[0].id, authority: catalog.authorities[0].id,
            ...(isCampaign() ? { mission: 'none', commander: 'none', front: 'none' } : {})
        }));
        add(paper, el('h3', 'court-section-heading', isCampaign() ? '內政與外勤 · 擬定本旬部署' : '先擬一份政令'), el('p', 'court-decision-note', isCampaign() ? '點草案只會填入預覽。兩個職責由不同人物執行，確認後才推進十日；也可以只下政令。' : '點草案只會填入預覽。可修改配套與授權，確認後才正式頒布。'));
        const drafts = el('div', 'court-recommendations');
        const selectors = {}, descriptions = {}, preview = el('section', 'court-order-preview');
        preview.setAttribute('aria-label', '政令預覽');
        const composer = el('details', 'court-composer');
        composer.open = isCampaign();
        const catalogFields = { primary: catalog.primaries, supplement: catalog.supplements, executor: catalog.executors, authority: catalog.authorities,
            mission: catalog.missions, commander: catalog.commanders, front: catalog.fronts };
        const update = () => {
            for (const [key, node] of Object.entries(selectors)) {
                node.value = draft[key];
                node.disabled = isCampaign() && draft.mission === 'none' && ['commander', 'front'].includes(key);
            }
            for (const [key, node] of Object.entries(descriptions)) {
                const list = catalogFields[key] || [];
                const selected = list.find(item => item.id === draft[key]);
                node.textContent = selected ? (isCampaign() && key === 'authority' ? '此設定同時適用於政令與外勤。' : '') + (selected.description || '') : '';
            }
            for (const card of drafts.children) card.setAttribute('aria-pressed', String(card.dataset.order === JSON.stringify(draft)));
            if (isCampaign()) {
                for (const card of host.querySelectorAll('.court-front')) card.classList.toggle('court-front-assigned', card.dataset.front === draft.front);
                for (const card of advisors.querySelectorAll('[data-advisor]')) {
                    const duty = card.dataset.advisor === draft.executor ? '政令' : card.dataset.advisor === draft.commander ? '外勤' : '議';
                    card.classList.toggle('court-advisor-assigned', duty !== '議');
                    card.querySelector('.court-advisor-toggle').textContent = duty;
                }
            }
            renderOrderPreview(preview);
        };
        for (const item of recommendations) {
            const card = button('', 'court-recommendation', () => { draft = JSON.parse(JSON.stringify(item.order)); update(); });
            card.dataset.order = JSON.stringify(item.order);
            add(card, el('strong', '', item.title), el('span', '', item.description)); drafts.appendChild(card);
        }
        if (drafts.childElementCount) paper.appendChild(drafts);
        add(composer, el('summary', '', isCampaign() ? '部署詳情 · 一份政令、一項外勤' : '修改政令 · 主措施、配套、執行者與授權'));
        const fields = el('div', 'court-order-fields');
        const missionFields = isCampaign() ? el('div', 'court-order-fields court-mission-fields') : null;
        const fieldDefinitions = [['primary', '主措施'], ['supplement', '配套'], ['executor', isCampaign() ? '主持政令' : '執行者'], ['authority', isCampaign() ? '本旬授權（政令與外勤共用）' : '授權方式']];
        if (isCampaign()) fieldDefinitions.push(['mission', '外勤任務'], ['commander', '外勤負責人'], ['front', '前往要地']);
        for (const [key, label] of fieldDefinitions) {
            const list = catalogFields[key] || [];
            const field = el('div', 'court-order-field'), labelNode = el('label', '', label), select = el('select');
            select.id = 'court-order-' + key; select.name = key; select.dataset.orderField = key; labelNode.htmlFor = select.id;
            for (const item of list) {
                const option = el('option', '', item.title || item.name); option.value = item.id;
                select.appendChild(option);
            }
            selectors[key] = select; descriptions[key] = el('p', 'court-field-description');
            select.addEventListener('change', () => {
                draft[key] = select.value;
                if (isCampaign() && key === 'mission') {
                    if (draft.mission === 'none') { draft.commander = 'none'; draft.front = 'none'; }
                    else {
                        if (draft.commander === 'none') draft.commander = (catalog.commanders.find(person => person.id !== 'none' && person.id !== draft.executor) || {}).id || 'none';
                        if (draft.front === 'none') draft.front = (catalog.fronts.find(front => front.id === 'pass') || catalog.fronts.find(front => front.id !== 'none') || {}).id || 'none';
                    }
                }
                update();
            });
            add(field, labelNode, select, descriptions[key]);
            (isCampaign() && ['mission', 'commander', 'front'].includes(key) ? missionFields : fields).appendChild(field);
        }
        if (isCampaign()) add(composer, el('h4', 'court-assignment-heading', '朝堂政令'));
        add(composer, fields);
        if (isCampaign()) add(composer, el('h4', 'court-assignment-heading', '外勤部署'), el('p', 'court-mission-note', '外勤另派一人，與主持政令的人選分開。選「不派外勤」時，不占用人物與要地。'), missionFields);
        add(paper, composer, preview);
        const advisors = el('aside', 'court-advisor-rail court-council-advisors' + (isCampaign() ? ' court-campaign-advisors' : ''));
        add(advisors, el('div', 'court-section-heading', isCampaign() ? '八人情報 · 點開聽取意見' : '先聽情報 · 再決定誰執行'));
        advisorsStrip(advisors, false, scene.briefings || [], isCampaign());
        add(advisors, el('p', 'court-fiction-caption', '人物言行為史料線索與既有分析的遊戲改編。原文與史料可由人物分析查看。'));
        add(layout, paper, advisors); main.appendChild(layout); update();
    }
    function renderOrderPreview(parent) {
        parent.replaceChildren();
        let evaluation;
        try { evaluation = engine.evaluateOrder(state, draft); }
        catch (error) { add(parent, el('p', 'court-order-invalid', error.message || '請完成政令與部署的設定。')); return; }
        add(parent, el('p', 'court-overline', '待頒草案'), el('h3', 'court-order-title', evaluation.title), el('p', 'court-order-description', evaluation.description));
        const cost = el('div', 'court-order-cost');
        add(cost, el('strong', '', '本回合需支出'), el('span', '', resourceText(evaluation.cost) || '無額外資源支出'));
        if (evaluation.capacity) add(cost, el('span', evaluation.capacity.used > evaluation.capacity.limit ? 'court-order-invalid' : '', '行政負荷 ' + evaluation.capacity.used + ' / ' + evaluation.capacity.limit));
        parent.appendChild(cost);
        const effects = el('div', 'court-effects court-order-effects');
        for (const [key, delta] of Object.entries(evaluation.effects || {})) if (LABELS[key] && delta) effects.appendChild(el('span', delta > 0 ? 'court-delta-positive' : 'court-delta-negative', LABELS[key] + ' ' + signed(delta)));
        add(parent, el('p', 'court-decision-note', isCampaign() ? '政令、外勤與到期承諾變化（已含上方支出；敵方與回合耗用另列）' : '政令與到期承諾變化（已含上方支出；在途回報與回合耗用另列）'), effects);
        if (evaluation.resolutionEffects) {
            const resolution = el('div', 'court-effects court-order-effects');
            for (const [key, delta] of Object.entries(evaluation.resolutionEffects)) if (LABELS[key]) resolution.appendChild(el('span', delta > 0 ? 'court-delta-positive' : delta < 0 ? 'court-delta-negative' : '', LABELS[key] + ' ' + signed(delta)));
            add(parent, el('p', 'court-decision-note', isCampaign() ? '本旬結算預估（包含到貨、承諾、外勤、敵方行動與耗用）' : '本回合結算預估（包含到貨、承諾與危局耗用）'), resolution);
        }
        const responses = el('div', 'court-order-responses');
        add(responses, el('h4', '', isCampaign() ? '受命人物的判斷' : '三位臣子對這份政令的意見'));
        const positionLabels = { support: '支持', conditional: '附條件', oppose: '反對' };
        const otherResponses = isCampaign() ? el('details', 'court-other-responses') : null;
        if (otherResponses) add(otherResponses, el('summary', '', '其餘群臣 · 查看支持與反對的理由'));
        for (const item of evaluation.responses || []) {
            const advisor = engine.ADVISORS.find(person => person.id === item.id);
            const reaction = el('article', 'court-position-' + item.position);
            add(reaction, el('strong', '', advisor ? advisor.name : item.id), el('span', 'court-position', positionLabels[item.position] || '意見'), el('p', '', item.reason));
            if (item.condition) add(reaction, el('p', 'court-response-condition', '條件 · ' + item.condition));
            (isCampaign() && ![draft.executor, draft.commander].includes(item.id) ? otherResponses : responses).appendChild(reaction);
        }
        if (otherResponses && otherResponses.childElementCount > 1) responses.appendChild(otherResponses);
        parent.appendChild(responses);
        const stakeholderSection = el('details', 'court-interest-responses');
        add(stakeholderSection, el('summary', '', '五方利益 · 誰受惠、誰承擔'));
        for (const item of evaluation.stakeholderResponses || []) {
            const party = engine.STAKEHOLDERS.find(value => value.id === item.id);
            const approval = state.stakeholders && state.stakeholders[item.id];
            add(stakeholderSection, add(el('article', 'court-interest-response'),
                el('strong', '', party ? party.name : item.id),
                el('span', 'court-position', positionLabels[item.position] || '意見'),
                el('p', '', item.reason),
                approval === undefined ? null : el('span', 'court-interest-approval', '目前支持 ' + approval + ' / 100')));
        }
        parent.appendChild(stakeholderSection);
        appendLines(parent, '執行條件', evaluation.conditions);
        appendLines(parent, '如何執行', evaluation.executionNotes);
        appendLines(parent, '承諾與期限', evaluation.commitmentPreview, 'court-promise-preview');
        appendLines(parent, '後續將至', evaluation.pendingPreview);
        appendLines(parent, '要地將如何變動', evaluation.frontPreview, 'court-front-preview');
        appendLines(parent, '敵方將如何應對', evaluation.enemyPreview, 'court-enemy-preview');
        appendLines(parent, '危局仍在推進', evaluation.worldPreview);
        const invalid = evaluation.disabledReasons || [];
        if (invalid.length) {
            const warnings = el('div', 'court-order-invalid'); warnings.setAttribute('role', 'status');
            add(warnings, el('strong', '', '目前無法頒布'));
            for (const reason of invalid) add(warnings, el('p', '', reason));
            parent.appendChild(warnings);
        }
        const publish = button('頒布這份政令 →', 'court-button-primary court-publish', () => enact(JSON.parse(JSON.stringify(draft))));
        publish.disabled = invalid.length > 0;
        add(parent, el('p', 'court-decision-note', isCampaign() ? '頒布後，政令、外勤與兩方敵軍一起結算。人物反對不會禁止執行；仍須滿足資源、分工與到期承諾。' : '有人反對也能下詔；必須滿足資源、行政負荷與到期承諾的規則。'), publish);
    }
    function renderScene(main) {
        const scene = engine.getScene(state);
        const layout = el('div', 'court-play-layout');
        const paper = el('section', 'court-paper');
        add(paper, el('p', 'court-overline', scene.eyebrow || '第 ' + state.turn + ' 回合'), title(scene.title, 'h2'), el('p', 'court-narrative', scene.description));
        const news = el('div', 'court-news');
        for (const item of scene.news || []) add(news, el('p', '', item));
        if (news.childElementCount) paper.appendChild(news);
        const choiceHeading = el('h3', 'court-section-heading', '請下詔令');
        add(paper, choiceHeading, el('p', 'court-decision-note', '即時變化會先顯示；人物信任與延後影響也會留下紀錄。'));
        const choices = el('div', 'court-choices');
        for (const choice of engine.getChoices(state)) {
            const advisor = engine.ADVISORS.find(item => item.id === choice.advisor);
            const node = el('button', 'court-choice'); node.type = 'button'; node.disabled = !!choice.disabledReason;
            add(node, el('span', 'court-choice-advisor', advisor ? advisor.name + '的主張' : '朝議'), el('strong', 'court-choice-title', choice.title), el('span', 'court-choice-description', choice.description));
            const effects = el('span', 'court-effects');
            for (const [key, delta] of Object.entries(choice.effects)) if (delta) effects.appendChild(el('span', delta > 0 ? 'court-delta-positive' : 'court-delta-negative', LABELS[key] + ' ' + signed(delta)));
            if (Object.keys(choice.cost).length) {
                const costs = Object.entries(choice.cost).filter(([, number]) => number > 0).map(([key, number]) => LABELS[key] + ' ' + number).join('、');
                add(node, el('span', 'court-choice-cost', '需支出 ' + costs + '（已計入下方變化）'));
            }
            add(node, effects, el('span', 'court-delayed-hint', '後續 · ' + choice.delayedHint));
            if (choice.disabledReason) add(node, el('span', 'court-choice-disabled', choice.disabledReason));
            node.addEventListener('click', () => enact(choice.id)); choices.appendChild(node);
        }
        paper.appendChild(choices);
        const advisors = el('aside', 'court-advisor-rail');
        add(advisors, el('div', 'court-section-heading', '殿上群臣')); advisorsStrip(advisors);
        add(layout, paper, advisors); main.appendChild(layout);
        if (state.pending.length) {
            const pending = el('details', 'court-pending');
            add(pending, el('summary', '', '尚待回響 · ' + state.pending.length + ' 件'));
            for (const item of state.pending) add(pending, el('p', '', '第 ' + item.due + ' 回合 · ' + item.title));
            main.appendChild(pending);
        }
    }
    function signed(number) { return number > 0 ? '+' + number : String(number); }
    function enact(id) {
        try { state = engine.choose(state, id); presentOutcome = true; draft = null; save(); renderGame(); }
        catch (error) { showNotice('此詔令未能下達', error.message || '請重新選擇可執行的決策。'); }
    }
    function orderResponsibility(record) {
        if (!record.order || !isCouncil()) return null;
        const advisor = engine.ADVISORS.find(person => person.id === record.order.executor);
        const catalog = engine.getCatalog(engine.createGame());
        const authority = catalog.authorities.find(item => item.id === record.order.authority);
        let text = '執行者 · ' + (advisor ? advisor.name : record.order.executor) + (isCampaign() ? ' ／ 本旬共同授權 · ' : ' ／ 授權 · ') + (authority ? authority.title : record.order.authority);
        if (isCampaign()) {
            const commander = engine.ADVISORS.find(person => person.id === record.order.commander);
            const mission = catalog.missions.find(item => item.id === record.order.mission);
            const front = catalog.fronts.find(item => item.id === record.order.front);
            text += record.order.mission === 'none' ? '\n外勤 · 本旬未派遣' : '\n外勤 · ' + (commander ? commander.name : record.order.commander) + ' ／ ' + (mission ? mission.title : record.order.mission) + ' ／ ' + (front ? front.name || front.title : record.order.front);
        }
        return el('p', 'court-order-assignment', text);
    }
    function enemyActionResults(parent, record) {
        if (!isCampaign()) return;
        const section = el('section', 'court-enemy-results');
        add(section, el('h3', '', '敵方也採取了行動'));
        for (const action of record.enemyActions || []) {
            const card = el('article', 'court-enemy-action'); card.dataset.enemyAction = action.action;
            const front = engine.getFronts(state).find(item => item.id === action.front);
            add(card, add(el('header'), el('strong', '', action.name), front ? el('span', '', front.name) : null), el('p', '', action.text));
            const effects = Object.entries(action.effects || {}).filter(([key, value]) => LABELS[key] && value).map(([key, value]) => LABELS[key] + ' ' + signed(value)).join(' ／ ');
            if (effects) add(card, el('p', 'court-enemy-action-effects', effects));
            section.appendChild(card);
        }
        if (section.childElementCount > 1) parent.appendChild(section);
        if (record.missionSummary) appendLines(parent, '外勤回報', [record.missionSummary], 'court-mission-results');
        appendLines(parent, '戰線變化', record.frontConsequences, 'court-front-results');
    }
    function renderOutcome(main) {
        const record = state.log[state.log.length - 1];
        const paper = el('section', 'court-paper court-result');
        add(paper, el('p', 'court-overline', '第 ' + record.turn + ' 回合 · 詔令已下'), title(record.title, 'h2'), el('p', 'court-narrative', '殿外傳來新的消息。這一道詔令的代價與回響，已經寫入國勢。'));
        add(paper, orderResponsibility(record));
        const changes = el('div', 'court-result-changes');
        for (const [key, delta] of Object.entries(record.changes)) add(changes, add(el('div'), el('span', '', LABELS[key]), el('strong', delta >= 0 ? 'court-delta-positive' : 'court-delta-negative', signed(delta))));
        paper.appendChild(changes);
        add(paper, el('p', 'court-result-tally', isCampaign() ? '本旬合計，包含政令、外勤、到期事件、敵方行動與常規耗用。' : '本回合合計，包含到期的延後事件。'));
        enemyActionResults(paper, record);
        const consequence = el('div', 'court-consequences');
        add(consequence, el('h3', '', '此刻的回響'));
        for (const item of record.consequences) add(consequence, el('p', '', item));
        if (!record.consequences.length) add(consequence, el('p', '', '命令已開始執行，後續變化仍在路上。'));
        paper.appendChild(consequence);
        const reactions = el('div', 'court-reactions' + (isCampaign() ? ' court-campaign-reactions' : ''));
        const otherReactions = isCampaign() ? el('details', 'court-other-reactions') : null;
        if (otherReactions) add(otherReactions, el('summary', '', '其餘群臣的回應'));
        for (const reaction of record.reactions) {
            const advisor = engine.ADVISORS.find(item => item.id === reaction.id);
            add(isCampaign() && ![record.order.executor, record.order.commander].includes(reaction.id) ? otherReactions : reactions,
                add(el('article'), el('strong', '', advisor ? advisor.name : reaction.id), el('p', '', reaction.text), el('span', 'court-trust', '目前信任 ' + state.trust[reaction.id] + ' / 100')));
        }
        if (otherReactions && otherReactions.childElementCount > 1) reactions.appendChild(otherReactions);
        paper.appendChild(reactions);
        appendLines(paper, '執行現場', record.executionNotes);
        appendLines(paper, '承諾的兌現與失約', record.commitmentEvents, 'court-promise-results');
        if (record.stakeholderReactions && record.stakeholderReactions.length) {
            const stakeholders = el('details', 'court-interest-responses');
            add(stakeholders, el('summary', '', '殿外的回應 · 五方利益'));
            for (const reaction of record.stakeholderReactions) {
                const party = engine.STAKEHOLDERS.find(item => item.id === reaction.id);
                add(stakeholders, add(el('p'), el('strong', '', (party ? party.name : reaction.id) + ' · '), el('span', '', reaction.text)));
            }
            paper.appendChild(stakeholders);
        }
        commitmentList(paper);
        if (state.pending.length) {
            const pending = el('div', 'court-result-pending');
            add(pending, el('strong', '', '有些後果尚未到來'));
            for (const item of state.pending) add(pending, el('p', '', item.title + ' · 第 ' + item.due + ' 回合結算'));
            paper.appendChild(pending);
        }
        add(paper, button(engine.getEnding(state) ? '查看這一局的結局 →' : '下一回合 →', 'court-button-primary', () => { presentOutcome = false; save(); renderGame(); }));
        main.appendChild(paper);
    }
    function renderEnding(main) {
        const ending = engine.getEnding(state);
        const paper = el('section', 'court-paper court-ending');
        add(paper, el('span', 'court-ending-seal', '終局'), el('p', 'court-overline', isCampaign() ? '六旬已過 · 守境的代價' : '三道詔令 · 一局國勢'), title(ending.title, 'h2'), el('p', 'court-narrative', ending.summary));
        const lessons = el('div', 'court-ending-lessons');
        add(lessons, el('h3', '', '從這局帶走的判斷'));
        for (const lesson of ending.lessons) add(lessons, el('p', '', lesson));
        paper.appendChild(lessons);
        const actions = el('div', 'court-ending-actions');
        add(actions, button('回看每一步因果', 'court-button-primary', showJournal), button('再議一局', 'court-button-outline', requestNew));
        add(paper, actions); main.appendChild(paper);
        commitmentList(paper);
        advisorsStrip(main, true, [], isCampaign());
    }
    function makeModal(heading, wide = false) {
        if (modal) dismissModal();
        const prior = document.activeElement;
        const veil = el('div', 'court-modal-veil');
        const dialog = el('section', 'court-dialog' + (wide ? ' court-dialog-wide' : ''));
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
        const header = el('header', 'court-dialog-header');
        const h = el('h2', '', heading); h.id = 'court-dialog-heading'; h.tabIndex = -1;
        dialog.setAttribute('aria-labelledby', h.id);
        const closeButton = button('關閉 ×', 'court-button-quiet', dismissModal);
        add(header, h, closeButton); dialog.appendChild(header);
        const body = el('div', 'court-dialog-body'); dialog.appendChild(body);
        veil.appendChild(dialog); host.appendChild(veil);
        const behind = Array.from(host.children).filter(node => node !== veil).map(node => ({ node, inert: node.inert, ariaHidden: node.getAttribute('aria-hidden') }));
        for (const item of behind) { item.node.inert = true; item.node.setAttribute('aria-hidden', 'true'); }
        modal = { veil, dialog, body, prior, behind }; h.focus();
        return body;
    }
    function dismissModal() {
        if (!modal) return;
        readGeneration += 1;
        const prior = modal.prior;
        for (const item of modal.behind) {
            item.node.inert = item.inert;
            if (item.ariaHidden === null) item.node.removeAttribute('aria-hidden'); else item.node.setAttribute('aria-hidden', item.ariaHidden);
        }
        modal.veil.remove(); modal = null;
        if (prior && prior.isConnected) prior.focus({ preventScroll: true });
    }
    function confirm(heading, text, acceptLabel, accept, preserve) {
        const body = makeModal(heading); add(body, el('p', '', text));
        const actions = el('div', 'court-dialog-actions');
        if (preserve) add(actions, button('先下載舊局', 'court-button-outline', preserve));
        add(actions, button('取消', 'court-button-outline', dismissModal), button(acceptLabel, 'court-button-primary', () => { dismissModal(); accept(); }));
        body.appendChild(actions);
    }
    function showNotice(heading, text) { const body = makeModal(heading); add(body, el('p', '', text)); }
    function renderAnalysisText(content, text) {
        if (root.marked && typeof root.marked.parse === 'function' && root.DOMPurify && typeof root.DOMPurify.sanitize === 'function') {
            content.innerHTML = root.DOMPurify.sanitize(root.marked.parse(text), {
                ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'del'],
                ALLOWED_ATTR: ['href', 'title'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
            });
            content.classList.add('court-analysis-markdown');
            for (const link of content.querySelectorAll('a')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        } else content.textContent = text;
    }
    async function showAnalysis(advisor) {
        const body = makeModal(advisor.name + ' · 人物分析', true);
        add(body, el('p', 'court-overline', '從人物判斷，走進你的決策'));
        const lesson = el('section', 'court-analysis-lesson');
        add(lesson, el('h3', '', '本劇的轉譯'), el('p', '', advisor.lesson), el('p', 'court-analysis-fiction', '此處是架空劇本的性格改編；遊戲數值不代表歷史人物的真實評分。'));
        if (advisor.profile) {
            for (const [key, label] of Object.entries({ drive: '在意', strength: '能力', blindSpot: '盲點', relationship: '關係' })) if (advisor.profile[key]) add(lesson, add(el('p', 'court-profile-analysis'), el('strong', '', label + ' · '), el('span', '', advisor.profile[key])));
        }
        if (advisor.sources && advisor.sources.length) {
            const sources = el('details', 'court-historical-sources');
            add(sources, el('summary', '', '史料線索 · 遊戲改編的依據'));
            for (const source of advisor.sources) {
                try {
                    const url = new URL(source.url);
                    if (url.protocol !== 'https:') continue;
                    const link = el('a', '', source.title); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
                    add(sources, add(el('p'), link));
                } catch (_) { /* Ignore an unusable source link. */ }
            }
            lesson.appendChild(sources);
        }
        body.appendChild(lesson);
        const article = el('section', 'court-original-analysis');
        add(article, el('h3', '', '人物庫原分析'));
        const content = el('div', 'court-analysis-text', '正在讀取人物庫…'); article.appendChild(content); body.appendChild(article);
        const generation = ++readGeneration;
        try {
            const value = typeof options.getLegend === 'function' ? await options.getLegend(advisor) : null;
            if (!modal || generation !== readGeneration || !content.isConnected) return;
            const text = typeof value === 'string' ? value : value && typeof value.analysis === 'string' ? value.analysis : null;
            if (text && text.trim()) {
                renderAnalysisText(content, text);
                if (value && typeof value === 'object' && value.sourceLabel) add(article, el('p', 'court-analysis-source', value.sourceLabel));
            } else content.textContent = '此人物尚未有可讀的原分析。可回人物館查看或補充資料，再進入朝會。';
            if (value && typeof value === 'object' && Array.isArray(value.sections)) {
                for (const section of value.sections) {
                    if (!section || typeof section.text !== 'string' || !section.text.trim() || section.text === text) continue;
                    const detail = el('details', 'court-original-section');
                    add(detail, el('summary', '', section.title || '人物庫補充分析'), el('p', 'court-analysis-fiction', '以下是人物庫保存的作者解讀；性格與動機解讀不等同可考證的史實。'));
                    const sectionContent = el('div', 'court-analysis-text'); renderAnalysisText(sectionContent, section.text); detail.appendChild(sectionContent); article.appendChild(detail);
                }
            }
        } catch (_) {
            if (modal && generation === readGeneration && content.isConnected) content.textContent = '原分析暫時無法讀取。劇本仍可繼續，請稍後回人物館查看。';
        }
    }
    function showJournal() {
        const body = makeModal('你的詔令 · 因果紀錄', true);
        if (!state.log.length) { add(body, el('p', '', '尚未下詔。第一個決策會在這裡留下紀錄。')); return; }
        for (const record of state.log) {
            const item = el('article', 'court-journal-item');
            add(item, el('span', 'court-overline', '第 ' + record.turn + ' 回合'), el('h3', '', record.title));
            add(item, orderResponsibility(record));
            const changes = Object.entries(record.changes).map(([key, delta]) => LABELS[key] + ' ' + signed(delta)).join(' ／ ');
            add(item, el('p', 'court-journal-changes', changes));
            enemyActionResults(item, record);
            for (const line of record.consequences) add(item, el('p', '', line));
            for (const reaction of record.reactions) {
                const advisor = engine.ADVISORS.find(person => person.id === reaction.id);
                add(item, el('p', 'court-journal-reaction', (advisor ? advisor.name : reaction.id) + '：' + reaction.text));
            }
            appendLines(item, '執行現場', record.executionNotes);
            appendLines(item, '履約與失約', record.commitmentEvents, 'court-promise-results');
            for (const reaction of record.stakeholderReactions || []) {
                const party = engine.STAKEHOLDERS.find(value => value.id === reaction.id);
                add(item, el('p', 'court-journal-reaction', (party ? party.name : reaction.id) + '：' + reaction.text));
            }
            body.appendChild(item);
        }
    }
    function pickImport() {
        const importingSession = ++importGeneration;
        const input = el('input'); input.type = 'file'; input.accept = 'application/json,.json'; input.hidden = true;
        input.addEventListener('cancel', () => input.remove());
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0]; input.remove(); if (!file) return;
            try {
                if (file.size > 512 * 1024) throw new Error('劇本存檔上限為 512 KB，請確認選的是朝堂劇本存檔。');
                const imported = parseSave(JSON.parse(await file.text()));
                if (!opened || importingSession !== importGeneration) return;
                const progress = imported.state.log.length;
                const scenario = imported.scenario, target = savedByScenario[scenario], raw = corruptByScenario[scenario];
                confirm('匯入' + SAVE_TYPES[scenario].label + '？', '已驗證決策紀錄，完成 ' + progress + ' / ' + roundLimit(scenario) + ' 回合。匯入會取代此版本的本機進度，其他版本進度仍保留。', '匯入並續局', () => {
                    selectScenario(scenario); state = imported.state; presentOutcome = imported.presentOutcome; corruptRaw = ''; save(); renderGame();
                }, target || raw ? () => download(raw || target, '朝堂匯入前舊局') : null);
            } catch (error) { if (opened && importingSession === importGeneration) showNotice('存檔未匯入', error.message || '無法讀取此檔案，目前進度仍保留。'); }
        });
        host.appendChild(input); input.click();
    }
    function keyHandler(event) {
        if (!opened) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); modal ? dismissModal() : close(); return; }
        if (event.key !== 'Tab') return;
        const scope = modal ? modal.dialog : host;
        const targets = Array.from(scope.querySelectorAll('button:not(:disabled), a[href], input:not([hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')).filter(node => node.getClientRects().length);
        if (!targets.length) { event.preventDefault(); scope.focus(); return; }
        const first = targets[0], last = targets[targets.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && (current === first || !targets.includes(current))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (current === last || !targets.includes(current))) { event.preventDefault(); first.focus(); }
    }
    function open(config = {}) {
        if (opened) return;
        engine = root.DynastyCampaign;
        if (!engine) throw new Error('朝堂劇本尚未載入，請重新整理後再試。');
        host = document.getElementById('courtGameRoot');
        if (!host) throw new Error('找不到朝堂劇場容器。');
        options = config; returnFocus = document.activeElement; bodyOverflow = document.body.style.overflow; bodyHadClass = document.body.classList.contains('court-open');
        blocked = Array.from(document.body.children).filter(node => node !== host && !node.contains(host) && !['SCRIPT', 'LINK', 'STYLE'].includes(node.tagName)).map(node => ({ node, inert: node.inert, ariaHidden: node.getAttribute('aria-hidden') }));
        for (const item of blocked) { item.node.inert = true; item.node.setAttribute('aria-hidden', 'true'); }
        document.body.classList.add('court-open');
        document.body.style.overflow = 'hidden';
        host.hidden = false; host.className = 'court-game'; host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true'); host.setAttribute('aria-label', '朝堂危局：邊境六旬'); host.tabIndex = -1;
        opened = true; state = null; presentOutcome = false;
        document.addEventListener('keydown', keyHandler, true); loadSaved(); renderIntro();
    }
    function close() {
        if (!opened) return;
        dismissModal(); opened = false; readGeneration += 1; importGeneration += 1;
        document.removeEventListener('keydown', keyHandler, true);
        host.hidden = true; host.replaceChildren(); document.body.style.overflow = bodyOverflow;
        for (const item of blocked) {
            item.node.inert = item.inert;
            if (item.ariaHidden === null) item.node.removeAttribute('aria-hidden'); else item.node.setAttribute('aria-hidden', item.ariaHidden);
        }
        if (!bodyHadClass) document.body.classList.remove('court-open');
        blocked = [];
        if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    }
    return Object.freeze({ open, close, parseSave });
});
