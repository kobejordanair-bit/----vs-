'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../backend/static/js/court-council.js');
const order = (primary, supplement = 'none', executor = 'xiaoHe', authority = 'bounded') => ({ primary, supplement, executor, authority });
const clone = value => JSON.parse(JSON.stringify(value));
function candidates(state) {
    const c = game.getCatalog(state), result = [];
    for (const p of c.primaries) for (const s of c.supplements) for (const e of c.executors) for (const a of c.authorities) result.push(order(p.id, s.id, e.id, a.id));
    return result;
}
function fallback(state) { return order('ration', state.commitments.length ? 'default' : 'none', 'weiZheng'); }

test('v2 is isolated, exposes distinct authored character profiles and five interest parties', () => {
    const state = game.createGame();
    assert.equal(state.version, 2); assert.equal(state.scenario, 'court-grain-v2');
    assert.equal(game.STAKEHOLDERS.length, 5);
    assert.equal(new Set(game.ADVISORS.map(a => a.profile.strength)).size, 3);
    assert.ok(game.ADVISORS.every(a => a.sources.length && a.sources.every(s => s.url.startsWith('https://zh.wikisource.org/'))));
    assert.equal(game.getScene(state).briefings.length, 3);
    assert.equal(game.getScene(state).stakeholderNews.length, 5);
    assert.throws(() => { game.ADVISORS[0].profile.drive = 'changed'; }, TypeError);
    assert.throws(() => { game.ADVISORS[0].sources.push({}); }, TypeError);
});

test('all three rounds have several measures and mixes, with legal recommendations', () => {
    let state = game.createGame();
    for (let round = 0; round < 3; round++) {
        const catalog = game.getCatalog(state);
        assert.ok(catalog.primaries.length >= 4); assert.ok(catalog.supplements.length >= 4);
        assert.equal(catalog.executors.length, 3); assert.equal(catalog.authorities.length, 2);
        assert.ok(catalog.recommendations.length);
        catalog.recommendations.forEach(r => assert.equal(game.evaluateOrder(state, r.order).disabledReasons.length, 0));
        state = game.choose(state, catalog.recommendations[0].order);
    }
    assert.deepEqual(game.getCatalog(state).primaries, []);
});

test('one proposal can have three supporters, or two supporters and one sincere dissenter', () => {
    const state = game.createGame();
    const agreement = game.evaluateOrder(state, order('route', 'ledger'));
    assert.deepEqual(agreement.responses.map(r => r.position), ['support', 'support', 'support']);
    const division = game.evaluateOrder(state, order('levy'));
    assert.deepEqual(division.responses.map(r => r.position), ['support', 'support', 'oppose']);
    const next = game.choose(state, order('levy'));
    assert.equal(next.trust.weiZheng, state.trust.weiZheng);
    assert.match(next.log[0].reactions.find(r => r.id === 'weiZheng').text, /反對仍保留.*依職責執行/);
});

test('same measure and complement change operational costs, arrival and methods by executor', () => {
    const state = game.createGame();
    const previews = ['hanXin', 'xiaoHe', 'weiZheng'].map(id => game.evaluateOrder(state, order('route', 'ledger', id)));
    assert.equal(new Set(previews.map(p => JSON.stringify(p.cost))).size, 3);
    assert.equal(new Set(previews.map(p => JSON.stringify(p.effects))).size, 3);
    assert.equal(new Set(previews.map(p => p.executionNotes.join(''))).size, 3);
    assert.equal(new Set(previews.map(p => p.pendingPreview.join(''))).size, 3);
    const limited = game.evaluateOrder(state, order('route', 'none', 'hanXin'));
    const autonomous = game.evaluateOrder(state, order('route', 'none', 'hanXin', 'flexible'));
    assert.match(limited.pendingPreview.join(''), /糧儲 \+10/);
    assert.match(autonomous.pendingPreview.join(''), /糧儲 \+24/);
    assert.ok(autonomous.effects.defense < limited.effects.defense);
    assert.equal(autonomous.capacity.used, limited.capacity.used + 1);
});

test('mixed orders respect capacity, verifiable limits and prior census preparation', () => {
    let state = game.createGame();
    assert.match(game.evaluateOrder(state, order('levy', 'relief')).disabledReasons.join(''), /尚未建立公開戶籍帳/);
    assert.match(game.evaluateOrder(state, order('levy', 'vouchers', 'weiZheng', 'flexible')).disabledReasons.join(''), /互斥/);
    state = game.choose(state, order('route', 'ledger'));
    assert.equal(game.evaluateOrder(state, order('levy', 'relief')).disabledReasons.length, 0);
    assert.match(game.evaluateOrder(state, order('fortify', 'relief')).disabledReasons.join(''), /人手/);
});

test('compensation is a real dated promise, requires explicit payment and occupies the complement', () => {
    const first = game.choose(game.createGame(), order('levy', 'vouchers', 'weiZheng'));
    assert.equal(first.commitments.length, 1);
    assert.equal(first.commitments[0].due, 2); assert.deepEqual(first.commitments[0].cost, { treasury: 9 });
    assert.match(game.evaluateOrder(first, order('ration')).disabledReasons.join(''), /到期承諾/);
    const paidPreview = game.evaluateOrder(first, order('ration', 'settle', 'weiZheng'));
    assert.equal(paidPreview.cost.treasury, 9);
    assert.match(paidPreview.commitmentPreview.join(''), /民心 \+5.*信任 \+5.*信任 \+2/);
    const paid = game.choose(first, order('ration', 'settle', 'weiZheng'));
    assert.equal(paid.commitments.length, 0); assert.equal(paid.actorMemory.weiZheng.honored, 1);
    assert.equal(paid.resources.treasury, first.resources.treasury - 9 - 2);
    assert.ok(paid.trust.weiZheng > first.trust.weiZheng);
    assert.match(paid.log[1].commitmentEvents.join(''), /付清.*第1回合/);
});

test('withdrawing a promise has visible numeric consequences and favored policy cannot wash it away', () => {
    const first = game.choose(game.createGame(), order('levy', 'vouchers', 'weiZheng'));
    const preview = game.evaluateOrder(first, order('ration', 'default', 'weiZheng'));
    assert.equal(preview.responses.find(r => r.id === 'weiZheng').position, 'support');
    assert.match(preview.commitmentPreview.join(''), /民心 -12.*信任 -8.*信任 -6.*合作 -15/);
    const next = game.choose(first, preview.order);
    assert.equal(next.actorMemory.weiZheng.breached, 1);
    assert.ok(next.trust.weiZheng < first.trust.weiZheng);
    assert.equal(next.resources.people, first.resources.people + preview.effects.people);
    assert.equal(next.stakeholders.farmers, first.stakeholders.farmers + 3 - 15);
    assert.match(game.getScene(next).briefings.find(b => b.advisor === 'weiZheng').text, /撤回/);
});

test('final compensation is charged and delivered immediately, never free terminal credit', () => {
    let state = game.choose(game.createGame(), order('ration'));
    state = game.choose(state, order('ration'));
    const preview = game.evaluateOrder(state, order('levy', 'vouchers', 'weiZheng'));
    assert.equal(preview.cost.treasury, 11);
    assert.match(preview.executionNotes.join(''), /當場備款並履約/);
    const final = game.choose(state, preview.order);
    assert.equal(final.resources.treasury, state.resources.treasury - 11 - 2);
    assert.equal(final.actorMemory.weiZheng.honored, 1);
    assert.deepEqual(final.pending, []); assert.deepEqual(final.commitments, []);
});

test('maintenance is paid later or explicitly defaulted; final deployment pre-funds maintenance', () => {
    let state = game.choose(game.createGame(), order('ration'));
    state = game.choose(state, order('fortify', 'none', 'hanXin'));
    assert.equal(state.commitments[0].type, 'maintenance');
    const paidPreview = game.evaluateOrder(state, order('ration', 'settle'));
    assert.deepEqual(paidPreview.cost, { grain: 4, treasury: 4 });
    const defaultPreview = game.evaluateOrder(state, order('ration', 'default'));
    assert.match(defaultPreview.commitmentPreview.join(''), /邊防 -10/);
    const final = game.choose(state, defaultPreview.order);
    assert.equal(final.actorMemory.hanXin.breached, 1); assert.equal(final.commitments.length, 0);
    let funded = game.choose(game.createGame(), order('ration'));
    funded = game.choose(funded, order('ration'));
    const cost = game.evaluateOrder(funded, order('fortify', 'none', 'hanXin')).cost;
    assert.deepEqual(cost, { grain: 16, treasury: 12 });
});

test('changing a concrete mandate records the event, not a generic adoption penalty', () => {
    const first = game.choose(game.createGame(), order('route', 'none', 'hanXin', 'flexible'));
    const bounded = game.choose(first, order('ration', 'none', 'hanXin'));
    assert.equal(bounded.trust.hanXin, first.trust.hanXin - 4 + 1);
    assert.match(bounded.actorMemory.hanXin.events.join(''), /臨機授權改為限額/);
    const disclosed = game.choose(first, order('ration', 'ledger', 'hanXin'));
    assert.equal(disclosed.trust.hanXin, first.trust.hanXin + 1);
    assert.match(disclosed.actorMemory.hanXin.events.join(''), /公開程序說明/);
});

test('Han supports diplomacy with a defensive basis, using restraint instead of a fixed attack personality', () => {
    const first = game.choose(game.createGame(), order('ration', 'none', 'hanXin'));
    const preview = game.evaluateOrder(first, order('diplomacy', 'none', 'hanXin'));
    assert.equal(preview.responses.find(r => r.id === 'hanXin').position, 'support');
    assert.match(preview.executionNotes.join(''), /按兵議和/);
    const next = game.choose(first, preview.order);
    assert.ok(next.pending.some(e => e.owner === 'hanXin' && e.effects.defense > 0));
});

test('sponsorship must actually deliver before it reduces a later operational handoff', () => {
    let sponsored = game.choose(game.createGame(), order('route', 'ledger', 'hanXin', 'flexible'));
    assert.equal(sponsored.relations.hanXiao, 57);
    assert.equal(game.evaluateOrder(sponsored, order('route', 'none', 'hanXin', 'flexible')).capacity.used, 3);
    sponsored = game.choose(sponsored, order('ration', 'none', 'hanXin', 'flexible'));
    const reused = game.evaluateOrder(sponsored, order('route', 'ledger', 'hanXin', 'flexible'));
    assert.equal(reused.capacity.used, 3); assert.equal(reused.disabledReasons.length, 0);
    assert.match(reused.conditions.join(''), /共同交付已核對/);
    let independent = game.choose(game.createGame(), order('route', 'none', 'hanXin', 'flexible'));
    independent = game.choose(independent, order('ration', 'none', 'hanXin', 'flexible'));
    assert.match(game.evaluateOrder(independent, order('route', 'ledger', 'hanXin', 'flexible')).disabledReasons.join(''), /人手/);
});

test('farmers, merchants and local officials change yields, prices and real coordination capacity', () => {
    const initial = game.createGame();
    const taxed = game.choose(initial, order('levy', 'none', 'hanXin'));
    const secondLevy = game.evaluateOrder(taxed, order('levy', 'none', 'weiZheng'));
    assert.equal(secondLevy.effects.grain, game.evaluateOrder(initial, order('levy', 'none', 'weiZheng')).effects.grain - 5);
    assert.match(secondLevy.conditions.join(''), /藏糧/);
    let market = game.choose(initial, order('market', 'ledger'));
    market = game.choose(market, order('market', 'ledger'));
    assert.ok(game.evaluateOrder(market, order('market')).cost.treasury < game.evaluateOrder(initial, order('market')).cost.treasury);
    const examined = game.choose(initial, order('audit', 'ledger', 'weiZheng'));
    assert.match(game.evaluateOrder(examined, order('route')).conditions.join(''), /地方官合作.*人手/);
});

test('affordability uses existing resources, never grain or treasury that will arrive later', () => {
    let state = game.choose(game.createGame(), order('market', 'ledger'));
    state = game.choose(state, order('market', 'ledger'));
    assert.ok(state.pending.length);
    const tooMuch = game.evaluateOrder(state, order('market', 'ledger'));
    assert.match(tooMuch.disabledReasons.join(''), /國庫.*不能先花/);
    assert.equal(tooMuch.resolutionEffects, null);
    assert.throws(() => game.choose(state, tooMuch.order), { code: 'ORDER_DISABLED' });
});

test('preview shows both inherited and new transit, with exact whole-round resolution', () => {
    const first = game.choose(game.createGame(), order('route', 'ledger', 'hanXin', 'flexible'));
    const preview = game.evaluateOrder(first, order('route', 'none', 'weiZheng'));
    assert.ok(preview.pendingPreview.some(text => text.startsWith('先前在途：') && text.includes('糧儲 +24')));
    assert.ok(preview.pendingPreview.some(text => text.startsWith('本令新派：')));
    const next = game.choose(first, preview.order);
    assert.deepEqual(preview.resolutionEffects, next.log.at(-1).changes);
    assert.match(preview.worldPreview.join(''), /先執行政令.*再接收糧車.*九糧/);
    assert.match(next.log.at(-1).consequences.join(''), /危局推進/);
});

test('doing nothing does not solve the crisis: ongoing consumption is visible in every round', () => {
    let state = game.createGame();
    for (let i = 0; i < 3; i++) {
        const preview = game.evaluateOrder(state, order('ration'));
        assert.equal(preview.effects.grain, 0);
        state = game.choose(state, preview.order);
        assert.deepEqual(preview.resolutionEffects, state.log.at(-1).changes);
    }
    assert.equal(state.resources.grain, 15); assert.equal(state.resources.treasury, 54);
    assert.equal(game.getEnding(state).id, 'crisis');
});

test('short supply consumes available grain and reports the additional penalty instead of unpaid clamping', () => {
    let state = game.choose(game.createGame(), order('ration', 'relief'));
    state = game.choose(state, order('fortify', 'none', 'hanXin'));
    const preview = game.evaluateOrder(state, order('ration', 'default'));
    assert.match(preview.worldPreview.join(''), /基本供給不足九糧.*六民心.*四邊防/);
    const final = game.choose(state, preview.order);
    assert.equal(final.resources.grain, 0);
    assert.deepEqual(preview.resolutionEffects, final.log.at(-1).changes);
});

test('deterministic immutable replay checks all resources, articles, memory, factions and unknown keys', () => {
    const first = game.createGame(), original = clone(first);
    const next = game.choose(first, order('route', 'ledger'));
    assert.deepEqual(first, original); assert.ok(game.validateState(next));
    assert.deepEqual(game.choose(first, order('route', 'ledger')), next);
    const replay = game.exportReplay(next); assert.deepEqual(game.importReplay(JSON.stringify(replay)), next);
    for (const mutate of [s => s.resources.grain++, s => s.trust.hanXin++, s => s.stakeholders.farmers++, s => s.actorMemory.xiaoHe.events.push('forged'), s => s.pending[0].effects.grain++, s => s.log[0].reactions[0].text = 'forged', s => s.relations.hanXiao++, s => s.extra = 1]) { const bad = clone(next); mutate(bad); assert.equal(game.validateState(bad), false); }
    const tampered = clone(replay); tampered.orders[0].supplement = 'none'; assert.throws(() => game.importReplay(tampered), { code: 'INVALID_REPLAY' });
    assert.throws(() => game.choose(first, { ...order('ration'), extra: 1 }), { code: 'INVALID_ORDER' });
    assert.equal(game.validateState(require('../backend/static/js/court-engine.js').createGame()), false);
});

test('all first-round orders and diverse second-round branches retain an affordable last-resort order', () => {
    const initial = game.createGame(), firstStates = [];
    for (const o of candidates(initial)) { const p = game.evaluateOrder(initial, o); if (!p.disabledReasons.length) { const state = game.choose(initial, o); firstStates.push(state); assert.equal(game.evaluateOrder(state, fallback(state)).disabledReasons.length, 0); } }
    assert.ok(firstStates.length > 70);
    const diverse = [], signatures = new Set();
    for (const state of firstStates) { const e = state.log[0].order, key = e.primary + ':' + e.executor; if (!signatures.has(key)) { signatures.add(key); diverse.push(state); } }
    let secondBranches = 0;
    for (const first of diverse) for (const o of candidates(first)) { if (game.evaluateOrder(first, o).disabledReasons.length) continue; const second = game.choose(first, o); secondBranches++; const safe = fallback(second); assert.equal(game.evaluateOrder(second, safe).disabledReasons.length, 0); const final = game.choose(second, safe); assert.equal(final.turn, 3); assert.deepEqual(final.commitments, []); assert.deepEqual(final.pending, []); assert.ok(game.validateState(final)); }
    assert.ok(secondBranches > 500);
});

test('the ending retains individual responsibility and political/faction results', () => {
    let state = game.choose(game.createGame(), order('levy', 'vouchers', 'weiZheng'));
    state = game.choose(state, order('route', 'default'));
    state = game.choose(state, order('ration'));
    const ending = game.getEnding(state);
    assert.match(ending.lessons.join(''), /公開撤回.*補償/);
    assert.match(ending.lessons.join(''), /魏徵：.*失約1次/);
    assert.match(ending.lessons.join(''), /最終各方合作/);
    assert.match(ending.lessons.join(''), /到期承諾剩餘 0、在途回報剩餘 0/);
    assert.throws(() => game.choose(state, order('ration')), { code: 'GAME_COMPLETE' });
});
