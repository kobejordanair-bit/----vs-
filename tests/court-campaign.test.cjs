'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../backend/static/js/court-campaign.js');
const clone = value => JSON.parse(JSON.stringify(value));
const order = (primary = 'ration', executor = 'xiaoHe', mission = 'none', commander = 'none', front = 'none', supplement = 'none', authority = 'bounded') => ({ primary, supplement, executor, authority, mission, commander, front });
const fallback = state => order('ration', 'weiZheng', 'none', 'none', 'none', state.commitments.some(c => c.due <= state.turn + 1) ? 'default' : 'none');
function run(orders) { return orders.reduce((state, o) => game.choose(state, o), game.createGame()); }
const balanced = [
    order('diplomacy', 'suQin', 'drill', 'sunWu', 'river'),
    order('route', 'xiaoHe', 'recon', 'zhangLiang', 'pass'),
    order('diplomacy', 'suQin', 'drill', 'sunWu', 'pass'),
    order('market', 'xiaoHe', 'escort', 'hanXin', 'river'),
    order('audit', 'weiZheng', 'drill', 'sunWu', 'granary'),
    order('route', 'xiaoHe', 'envoy', 'suQin', 'river')
];
function assertBounded(state) {
    for (const collection of [state.resources, state.trust, state.stakeholders, state.relations]) for (const value of Object.values(collection)) assert.ok(Number.isInteger(value) && value >= 0 && value <= 100);
    for (const region of Object.values(state.fronts)) for (const key of ['security', 'supply']) assert.ok(region[key] >= 0 && region[key] <= 100);
    for (const enemy of Object.values(state.enemies)) for (const key of ['strength', 'supply', 'cohesion']) assert.ok(enemy[key] >= 0 && enemy[key] <= 100);
}

test('v3 is an isolated six-round campaign with eight source-linked adaptations and five parties', () => {
    const state = game.createGame();
    assert.equal(game.SCENARIO, 'court-grain-v3'); assert.equal(game.TURNS, 6);
    assert.equal(state.version, 3); assert.equal(state.scenario, game.SCENARIO);
    assert.equal(game.ADVISORS.length, 8); assert.equal(game.STAKEHOLDERS.length, 5);
    assert.equal(game.getScene(state).briefings.length, 8); assert.equal(game.getScene(state).stakeholderNews.length, 5);
    assert.equal(game.getFronts(state).length, 3); assert.equal(game.getEnemies(state).length, 2);
    assert.ok(game.ADVISORS.every(a => ['general', 'minister'].includes(a.type) && a.sources.every(s => s.url.startsWith('https://zh.wikisource.org/'))));
    assert.equal(new Set(game.ADVISORS.map(a => a.profile.strength)).size, 8);
    assert.throws(() => { game.ADVISORS[3].profile.strength = 'changed'; }, TypeError);
    assert.equal(require('../backend/static/js/court-council.js').createGame().scenario, 'court-grain-v2');
    assert.equal(require('../backend/static/js/court-engine.js').createGame().scenario, 'court-grain-v1');
});

test('all eight executors materially alter the same audit, independently of their portrait or dialogue', () => {
    const state = game.createGame();
    const fingerprints = game.ADVISORS.map(a => {
        const result = game.choose(state, order('audit', a.id));
        return JSON.stringify([result.resources, result.fronts, result.enemies, result.stakeholders]);
    });
    assert.equal(new Set(fingerprints).size, 8);
    assert.ok(game.evaluateOrder(state, order('audit', 'weiZheng')).effects.people > game.evaluateOrder(state, order('audit', 'shangYang')).effects.people);
    assert.ok(game.evaluateOrder(state, order('audit', 'shangYang')).effects.treasury > game.evaluateOrder(state, order('audit', 'xiaoHe')).effects.treasury);
});

test('every commander has a distinct operational fingerprint across real missions', () => {
    const state = game.createGame();
    const fingerprints = game.ADVISORS.map(a => ['recon', 'escort', 'drill', 'raid', 'envoy'].map(m => {
        const executor = a.id === 'xiaoHe' ? 'weiZheng' : 'xiaoHe';
        const o = order('ration', executor, m, a.id, 'pass');
        const preview = game.evaluateOrder(state, o), next = game.choose(state, o);
        return JSON.stringify([preview.cost, next.resources, next.fronts, next.enemies, next.stakeholders, next.pending]);
    }).join('|'));
    assert.equal(new Set(fingerprints).size, 8);
});

test('orders need seven exact fields and distinct people for domestic and field assignments', () => {
    const state = game.createGame();
    assert.throws(() => game.choose(state, { primary: 'ration' }), e => e.code === 'INVALID_ORDER');
    assert.throws(() => game.choose(state, { ...order(), extra: 'value' }), e => e.code === 'INVALID_ORDER');
    assert.throws(() => game.choose(state, { ...order(), mission: 'none', commander: 'hanXin' }), e => e.code === 'INVALID_ORDER');
    assert.throws(() => game.choose(state, { ...order(), front: 'moon' }), e => e.code === 'INVALID_ORDER');
    const conflict = game.evaluateOrder(state, order('route', 'hanXin', 'escort', 'hanXin', 'pass'));
    assert.match(conflict.disabledReasons.join(''), /不同人物/); assert.equal(conflict.resolutionEffects, null);
    assert.throws(() => game.choose(state, conflict.order), e => e.code === 'ORDER_DISABLED');
});

test('simultaneous policy, supplement and mission consume the same finite coordination capacity', () => {
    const state = game.createGame();
    assert.equal(game.evaluateOrder(state, order('fortify', 'xiaoHe', 'raid', 'hanXin', 'pass')).capacity.used, 6);
    const tooMuch = game.evaluateOrder(state, order('fortify', 'xiaoHe', 'raid', 'hanXin', 'pass', 'relief'));
    assert.equal(tooMuch.capacity.used, 8); assert.match(tooMuch.disabledReasons.join(''), /人手需要 8/);
    assert.match(game.evaluateOrder(state, order('levy', 'weiZheng', 'none', 'none', 'none', 'vouchers', 'flexible')).disabledReasons.join(''), /互斥/);
});

test('enemy movement reacts to protection and chooses another real front', () => {
    const state = game.createGame(), plain = game.choose(state, order());
    const protectedPass = game.choose(state, order('ration', 'xiaoHe', 'escort', 'hanXin', 'pass'));
    assert.equal(plain.log[0].enemyActions[0].front, 'pass');
    assert.equal(protectedPass.log[0].enemyActions[0].front, 'granary');
    assert.equal(protectedPass.log[0].enemyActions[0].action, 'flank');
    assert.ok(protectedPass.fronts.pass.security > plain.fronts.pass.security);
    assert.ok(protectedPass.resources.people < plain.resources.people, 'protecting one road leaves a real flank tradeoff');
    assert.equal(plain.log[0].enemyActions.length, 2);
});

test('reconnaissance lowers current losses, lasts across rounds, and reveals a public expiry', () => {
    const state = game.createGame(), plain = game.choose(state, order());
    const scouted = game.choose(state, order('ration', 'xiaoHe', 'recon', 'hanXin', 'pass'));
    assert.ok(scouted.log[0].enemyActions[0].effects.defense > plain.log[0].enemyActions[0].effects.defense);
    assert.equal(scouted.fronts.pass.intelUntil, 2);
    assert.match(game.getFronts(scouted).find(f => f.id === 'pass').intelligence, /第2回合/);
    const expired = game.choose(game.choose(scouted, order()), order());
    assert.equal(game.getFronts(expired).find(f => f.id === 'pass').intelligence, '敵情未明');
});

test('Zhang Liang and Sun Wu convert verified intelligence into stronger raids, not just new dialogue', () => {
    for (const commander of ['zhangLiang', 'sunWu']) {
        const unscouted = game.choose(game.createGame(), order('ration', 'xiaoHe', 'raid', commander, 'pass'));
        const prepared = game.choose(game.createGame(), order('ration', 'xiaoHe', 'recon', commander, 'pass'));
        const preview = game.evaluateOrder(prepared, order('ration', 'xiaoHe', 'raid', commander, 'pass'));
        const after = game.choose(prepared, preview.order);
        assert.ok(prepared.enemies.northern.strength - after.enemies.northern.strength > 66 - unscouted.enemies.northern.strength);
        assert.match(preview.executionNotes.join(''), /已有有效情報/);
        assert.ok(preview.effects.defense > game.evaluateOrder(game.createGame(), order('ration', 'xiaoHe', 'raid', commander, 'pass')).effects.defense);
    }
});

test('cutting supply changes the enemy from invasion to foraging, and reduces its actual forces', () => {
    const plain = game.choose(game.createGame(), order('audit'));
    const raided = game.choose(game.createGame(), order('audit', 'xiaoHe', 'raid', 'hanXin', 'pass'));
    assert.equal(plain.log[0].enemyActions[0].action, 'assault');
    assert.equal(raided.log[0].enemyActions[0].action, 'forage');
    assert.ok(raided.enemies.northern.strength < plain.enemies.northern.strength);
    assert.ok(raided.enemies.northern.supply < plain.enemies.northern.supply);
    assert.ok(raided.log[0].enemyActions[0].effects.grain < 0, 'a hungry enemy still has an active counterplay');
});

test('Su Qin can negotiate one faction into a dated truce while the other still attacks', () => {
    const next = game.choose(game.createGame(), order('ration', 'xiaoHe', 'envoy', 'suQin', 'river'));
    assert.equal(next.log[0].enemyActions[0].action, 'assault');
    assert.equal(next.log[0].enemyActions[1].action, 'truce');
    assert.equal(next.enemies.riverLeague.truceUntil, 2);
    assert.equal(next.enemies.riverLeague.supply, 62, 'rest replenishes enemy supply instead of removing it');
    assert.match(game.getEnemies(next).find(e => e.id === 'riverLeague').intent, /第2回合/);
    const second = game.choose(next, order());
    assert.equal(second.log[1].enemyActions[1].action, 'truce');
    const third = game.choose(second, order());
    assert.notEqual(third.log[2].enemyActions[1].action, 'truce');
});

test('cohesion attacks produce withdrawal and rebuilding rather than an invisible fixed penalty', () => {
    let state = game.choose(game.createGame(), order('diplomacy', 'zhangLiang', 'envoy', 'chenPing', 'river'));
    assert.equal(state.log[0].enemyActions[1].action, 'truce');
    assert.ok(state.enemies.riverLeague.cohesion <= 24);
    const before = clone(state.enemies.riverLeague);
    state = game.choose(state, order());
    assert.equal(state.log[1].enemyActions[1].action, 'withdraw');
    assert.equal(state.enemies.riverLeague.supply, before.supply + 3);
    assert.equal(state.enemies.riverLeague.strength, before.strength + 1);
});

test('both roles record the common mandate and an abrupt withdrawal of field authority loses trust', () => {
    const first = game.choose(game.createGame(), order('ration', 'xiaoHe', 'recon', 'hanXin', 'pass', 'none', 'flexible'));
    assert.equal(first.actorMemory.xiaoHe.mandate, 'flexible'); assert.equal(first.actorMemory.hanXin.mandate, 'flexible');
    const preview = game.evaluateOrder(first, order('ration', 'xiaoHe', 'recon', 'hanXin', 'pass'));
    assert.ok(preview.conditions.some(t => /蕭何.*信任減四.*另加一/.test(t)));
    assert.ok(preview.conditions.some(t => /韓信.*信任減四.*另加一/.test(t)));
    const second = game.choose(first, order('ration', 'xiaoHe', 'recon', 'hanXin', 'pass'));
    assert.equal(second.trust.xiaoHe, first.trust.xiaoHe - 3); assert.equal(second.trust.hanXin, first.trust.hanXin - 3);
    assert.equal(second.actorMemory.hanXin.mandate, 'bounded');
    assert.ok(second.log[1].commitmentEvents.some(t => /韓信.*收回臨機權/.test(t)));
    const explained = game.choose(first, order('ration', 'xiaoHe', 'recon', 'hanXin', 'pass', 'ledger'));
    assert.ok(game.evaluateOrder(first, order('ration', 'xiaoHe', 'recon', 'hanXin', 'pass', 'ledger')).conditions.some(t => /韓信.*免扣收權信任/.test(t)));
    assert.equal(explained.trust.hanXin, first.trust.hanXin + 1);
});

test('double appointment alone grants no partnership; delivered protected convoys earn cooperation', () => {
    const key = ['hanXin', 'xiaoHe'].sort().join(':');
    const unrelated = game.choose(game.createGame(), order('audit', 'xiaoHe', 'recon', 'hanXin', 'pass'));
    assert.equal(unrelated.relations[key], 50); assert.equal(unrelated.log[0].jointDeliveries.length, 0);
    const extraConvoy = game.choose(game.choose(game.createGame(), order('audit', 'weiZheng', 'escort', 'xiaoHe', 'river')), order());
    assert.equal(extraConvoy.relations[['weiZheng', 'xiaoHe'].sort().join(':')], 50, 'an unrelated domestic audit does not become a partner in the commander own convoy');
    const convoyOrder = order('route', 'xiaoHe', 'escort', 'hanXin', 'pass');
    let state = game.choose(game.createGame(), convoyOrder);
    assert.equal(state.relations[key], 50);
    state = game.choose(state, convoyOrder); assert.equal(state.relations[key], 55);
    state = game.choose(state, convoyOrder); assert.equal(state.relations[key], 60);
    assert.equal(state.log[2].jointDeliveries[0].front, 'pass');
    assert.ok(state.log[2].jointDeliveries[0].grain > 0);
    const preview = game.evaluateOrder(state, convoyOrder);
    assert.match(preview.executionNotes.join(''), /已有共同官道交付/);
    assert.match(preview.pendingPreview.join(''), /糧儲 \+19/);
});

test('vouchers create a real bill; payment uses current resources and remembers the original owner', () => {
    const first = game.choose(game.createGame(), order('levy', 'weiZheng', 'none', 'none', 'none', 'vouchers'));
    assert.deepEqual(first.commitments[0].cost, { treasury: 8 }); assert.equal(first.commitments[0].due, 2);
    assert.match(game.evaluateOrder(first, order()).disabledReasons.join(''), /到期承諾/);
    const paidPreview = game.evaluateOrder(first, order('ration', 'xiaoHe', 'none', 'none', 'none', 'settle'));
    assert.equal(paidPreview.cost.treasury, 8);
    const paid = game.choose(first, paidPreview.order), broken = game.choose(first, order('ration', 'xiaoHe', 'none', 'none', 'none', 'default'));
    assert.equal(paid.actorMemory.weiZheng.honored, 1); assert.equal(broken.actorMemory.weiZheng.breached, 1);
    assert.equal(paid.commitments.length, 0); assert.equal(broken.commitments.length, 0);
    assert.ok(paid.stakeholders.farmers > broken.stakeholders.farmers);
    assert.match(broken.log[1].commitmentEvents.join(''), /魏徵負責.*失約/);
});

test('every legal order checks payment before its immediate or delayed gains', () => {
    let state = game.createGame();
    for (let turn = 0; turn < 4; turn++) state = game.choose(state, order('route', 'xiaoHe', 'escort', 'hanXin', 'pass'));
    state = game.choose(state, order('diplomacy', 'chenPing', 'recon', 'sunWu', 'pass'));
    assert.equal(state.resources.treasury, 0);
    const audit = game.evaluateOrder(state, order('audit', 'chenPing'));
    assert.ok(audit.effects.treasury > 0, 'this audit would recover more money than its cost');
    assert.match(audit.disabledReasons.join(''), /尚未到手的收益不能支付成本/);
    assert.throws(() => game.choose(state, audit.order), e => e.code === 'ORDER_DISABLED');
    assert.equal(game.evaluateOrder(state, fallback(state)).disabledReasons.length, 0);
});

test('the no-cost fallback remains legal through collapsing resources and unpaid promises', () => {
    let state = game.choose(game.createGame(), order('fortify', 'hanXin', 'raid', 'shangYang', 'river'));
    while (state.turn < game.TURNS) {
        const o = fallback(state), preview = game.evaluateOrder(state, o);
        assert.equal(preview.disabledReasons.length, 0); assert.deepEqual(preview.cost, {});
        state = game.choose(state, o); assertBounded(state);
    }
    assert.equal(game.getEnding(state).id, 'crisis');
    assert.equal(state.pending.length, 0); assert.equal(state.commitments.length, 0);
});

test('exact resolution previews include arrivals, supply, both opponents and all clamping', () => {
    let state = game.createGame();
    for (const o of balanced) {
        const before = clone(state), preview = game.evaluateOrder(state, o);
        const next = game.choose(state, o), expected = Object.fromEntries(Object.keys(state.resources).map(k => [k, next.resources[k] - state.resources[k]]));
        assert.deepEqual(preview.resolutionEffects, expected);
        assert.deepEqual(preview.enemyPreview.map(t => t.replace('依本令推演：', '')), next.log.at(-1).enemyActions.map(e => e.text));
        assert.deepEqual(preview.frontPreview, next.log.at(-1).frontConsequences);
        assert.deepEqual(state, before, 'evaluation and execution leave the input state unchanged');
        assertBounded(next); state = next;
    }
    assert.equal(game.getEnding(state).id, 'counteroffensive');
    assert.equal(state.pending.length, 0); assert.equal(state.commitments.length, 0);
    assert.ok(game.validateState(state));
});

test('last-round transport arrives immediately, and fresh maintenance is prepaid within the campaign', () => {
    let state = run(balanced.slice(0, 5));
    const last = order('fortify', 'xiaoHe', 'none', 'none', 'none');
    const preview = game.evaluateOrder(state, last);
    assert.equal(preview.cost.grain, 7); assert.equal(preview.cost.treasury, 9);
    assert.match(preview.commitmentPreview.join(''), /末回合當場付清/);
    state = game.choose(state, last);
    assert.equal(state.actorMemory.xiaoHe.honored, 1); assert.equal(state.commitments.length, 0); assert.equal(state.pending.length, 0);
    const transported = game.choose(run(balanced.slice(0, 5)), balanced[5]);
    assert.ok(transported.log[5].consequences.some(t => /^北境官道的遠倉糧隊：/.test(t)));
    assert.equal(game.getCatalog(state).primaries.length, 0); assert.equal(game.getEnding(state) !== null, true);
    assert.throws(() => game.choose(state, order()), e => e.code === 'GAME_COMPLETE');
});

test('each round offers valid varied recommendations, including an affordable fallback', () => {
    let state = game.createGame();
    for (let round = 0; round < game.TURNS; round++) {
        const catalog = game.getCatalog(state);
        assert.equal(catalog.executors.length, 8); assert.equal(catalog.commanders.length, 9);
        assert.equal(catalog.missions.length, 6); assert.equal(catalog.fronts.length, 4);
        assert.ok(catalog.recommendations.length > 0);
        catalog.recommendations.forEach(r => { assert.equal(Object.keys(r.order).length, 7); assert.equal(game.evaluateOrder(state, r.order).disabledReasons.length, 0); });
        state = game.choose(state, fallback(state));
    }
});

test('the full replay rejects tampered resources, armies, regions, expiry, dialogue, cooperation and unknown fields', () => {
    const state = run(balanced);
    const mutations = [
        s => { s.resources.grain++; }, s => { s.enemies.northern.strength++; }, s => { s.fronts.river.security++; },
        s => { s.fronts.pass.intelUntil++; }, s => { s.enemies.riverLeague.truceUntil++; },
        s => { s.log[0].enemyActions[0].text = '偽造'; }, s => { s.log[1].executionNotes.push('偽造'); },
        s => { s.relations['hanXin:xiaoHe']++; }, s => { s.actorMemory.sunWu.missions++; },
        s => { s.extra = true; }, s => { s.log[0].order.mission = 'raid'; }
    ];
    assert.ok(game.validateState(state));
    for (const mutate of mutations) { const changed = clone(state); mutate(changed); assert.equal(game.validateState(changed), false); assert.throws(() => game.getEnemies(changed), e => e.code === 'INVALID_STATE'); }
});

test('export/import verifies the whole snapshot and rejects oversized, malformed and mismatched wrappers', () => {
    const state = run(balanced), replay = game.exportReplay(state);
    assert.deepEqual(game.importReplay(JSON.stringify(replay)), state);
    assert.throws(() => game.importReplay('{'), e => e.code === 'INVALID_REPLAY');
    assert.throws(() => game.importReplay(' '.repeat(400001)), e => e.code === 'INVALID_REPLAY');
    for (const mutate of [r => { r.version = 2; }, r => { r.orders[0].front = 'pass'; }, r => { r.ending = 'crisis'; }, r => { r.extra = true; }]) { const changed = clone(replay); mutate(changed); assert.throws(() => game.importReplay(changed), e => e.code === 'INVALID_REPLAY'); }
    const copyState = game.importReplay(replay); copyState.resources.grain = 0; assert.notEqual(state.resources.grain, 0);
});
