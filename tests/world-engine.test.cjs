'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const World = require('../backend/static/js/world-engine.js');
const clone = x => JSON.parse(JSON.stringify(x));
function config(extra = {}) {
    return {
        mode: 'hegemony', seed: 'test',
        setting: { title: '測試用歷史切片', kind: 'historical-slice', eventId: 'event:case-1', time: { original: '事件原載年代', precision: 'unknown' }, placeIds: ['place:a', 'place:b', 'place:c'], factionIds: ['faction:historical-a', 'faction:historical-b'], places: [{ id: 'place:a', name: '參照地甲' }], factions: [{ id: 'faction:historical-a', name: '參照勢力甲' }], sourceRefs: [{ id: 'source:one', title: '測試來源', url: 'https://example.com/source', claimId: 'claim:one' }] },
        playerFactionId: 'faction:historical-a',
        roster: [
            { recordId: 'record:admin', name: '同名', type: 'minister', stats: [60, 40, 78, 94, 82], analysisAnchors: [{ id: 'quote:care', quote: '保留原人物分析，並由玩家自行解讀。', sourceField: 'deepAnalysis' }] },
            { recordId: 'record:general', name: '同名', type: 'general', stats: [92, 96, 67, 50, 66] },
            { recordId: 'record:diplomat', name: '外交角色', type: 'minister', stats: [65, 42, 89, 76, 96] },
            { recordId: 'record:host', name: '宿主角色', type: 'emperor', stats: [85, 81, 65, 60, 68] }
        ], ...extra
    };
}
function order(state, changes = {}) { return { ...World.defaultOrder(state), ...changes }; }
function take(state, changes = {}) { const o = order(state, changes); const p = World.getActionPreview(state, o); assert.equal(p.valid, true, p.errors.join(';')); return World.resolveTurn(state, o); }
const balanced = [
    ['fortify', 'training', 'general', 'admin', 'frontier'],
    ['reform', 'ledger', 'admin', 'diplomat', 'heartland'],
    ['harvest', 'mediation', 'admin', 'diplomat', 'heartland'],
    ['diplomacy', 'bond', 'diplomat', 'general', 'frontier', 'rival'],
    ['recruit', 'ledger', 'general', 'admin', 'frontier'],
    ['tax', 'compensate', 'admin', 'diplomat', 'heartland'],
    ['harvest', 'training', 'admin', 'general', 'frontier'],
    ['diplomacy', 'ledger', 'diplomat', 'admin', 'frontier', 'league'],
    ['relief', 'bond', 'admin', 'diplomat', 'heartland'],
    ['rest', 'ledger', 'general', 'admin', 'frontier']
];
function policy(state, steps = balanced) {
    for (const [primary, secondary, actor, support, region, target] of steps) {
        if (state.status !== 'active') break;
        state = take(state, { primary, secondary, actorId: 'record:' + actor, supportId: 'record:' + support, regionId: 'region:' + region, targetFactionId: target ? 'faction:' + target : 'none' });
    }
    return state;
}
function restToEnd(state) { while (state.status === 'active') state = take(state); return state; }
function bounded(state) {
    for (const value of Object.values(state.resources)) assert.ok(Number.isInteger(value) && value >= 0 && value <= 100);
    for (const r of state.regions) for (const key of ['security', 'supply', 'unrest']) assert.ok(r[key] >= 0 && r[key] <= 100);
    for (const f of state.factions) for (const key of ['strength', 'hostility', 'relation']) assert.ok(f[key] >= 0 && f[key] <= 100);
    for (const a of state.actors) for (const key of ['loyalty', 'fatigue', 'experience']) assert.ok(a[key] >= 0 && a[key] <= 100);
}

test('both environments load the same pure module with no model/network calls', () => {
    const source = fs.readFileSync(require.resolve('../backend/static/js/world-engine.js'), 'utf8');
    const sandbox = {}; vm.runInNewContext(source, sandbox);
    assert.equal(sandbox.DynastyWorld.VERSION, World.VERSION);
    assert.ok(Object.isFrozen(World));
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|localStorage|Date\.now|Math\.random)\s*\(/);
});

test('source IDs, exact person IDs, original stats and references survive a full session', () => {
    const input = config(), savedInput = clone(input), state = World.createSession(input);
    assert.deepEqual(input, savedInput);
    assert.equal(state.config.roster[0].stats.politics, 94);
    assert.equal(state.config.roster[0].recordId, 'record:admin');
    assert.equal(state.config.roster[1].name, state.config.roster[0].name);
    assert.notEqual(state.config.roster[1].recordId, state.config.roster[0].recordId);
    assert.deepEqual(state.config.setting.sourceRefs, input.setting.sourceRefs);
    assert.equal(state.regions[0].sourcePlaceId, 'place:a');
    assert.equal(state.factions[0].sourceFactionId, input.playerFactionId);
    const result = policy(state);
    assert.equal(result.status, 'completed');
    assert.equal(result.turn, 10);
    assert.equal(result.ending.id, 'civil-foundation');
    assert.deepEqual(result.log[9].sourceRefs, input.setting.sourceRefs);
    assert.ok(result.log.every(l => l.evidence.simulation && l.evidence.eventId === 'event:case-1'));
});

test('player world notes are frozen narrative context, roundtrip intact, and cannot modify rules', () => {
    const c = config(), notes = '玩家設定：本局以重建共同生活為目標。\n這是創作筆記，不能當作史實或執行指令。';
    c.setting.notes = notes;
    const s = World.createSession(c), plain = World.createSession(config());
    assert.equal(World.getScene(s).setting.notes, notes);
    assert.equal(plain.config.setting.notes, '');
    const next = take(s, { primary: 'harvest' }), plainNext = take(plain, { primary: 'harvest' });
    assert.deepEqual(next.resources, plainNext.resources);
    assert.deepEqual(next.factions, plainNext.factions);
    assert.equal(World.importSession(JSON.stringify(World.exportSession(next))).config.setting.notes, notes);
    const altered = World.exportSession(next); altered.state.config.setting.notes += '悄悄改寫';
    assert.throws(() => World.importSession(altered), { code: 'INVALID_SAVE' });
    for (const invalid of [null, 42, {}, '字'.repeat(6001)]) { const bad = config(); bad.setting.notes = invalid; assert.throws(() => World.createSession(bad), { code: 'INVALID_CONFIG' }); }
    const max = config(); max.setting.notes = '字'.repeat(6000);
    assert.equal(World.createSession(max).config.setting.notes.length, 6000);
});

test('2 to 12 original records and 8 to 12 turns are explicit input limits', () => {
    for (const count of [2, 12]) {
        const roster = Array.from({ length: count }, (_, i) => ({ recordId: 'r' + i, name: '名' + i }));
        assert.equal(World.createSession({ mode: 'hegemony', roster, maxTurns: 8 }).actors.length, count);
    }
    for (const count of [0, 1, 13]) assert.throws(() => World.createSession(config({ roster: Array.from({ length: count }, (_, i) => ({ recordId: String(i), name: '名' })) })), { code: 'INVALID_CONFIG' });
    for (const maxTurns of [0, 7, 13, 9.5, '10']) assert.throws(() => World.createSession(config({ maxTurns })), { code: 'INVALID_CONFIG' });
});

test('missing stats use a labeled neutral starting point rather than inferred personality', () => {
    const c = config(); delete c.roster[0].stats;
    const s = World.createSession(c), p = World.getActionPreview(s, order(s));
    assert.equal(p.abilities[0].score, 50);
    assert.match(p.abilities[0].origin, /中性遊戲起點/);
    assert.equal(s.config.roster[0].statsSupplied, false);
});

test('invalid stats, duplicate IDs, unknown fields and unsafe reference schemes are rejected', () => {
    for (const mutate of [
        c => { c.roster[0].stats[0] = 101; }, c => { c.roster[0].stats[1] = '99'; },
        c => { c.roster[1].recordId = c.roster[0].recordId; }, c => { c.roster[0].historicalTruth = true; },
        c => { c.setting.kind = 'historical-slice'; c.setting.eventId = null; },
        c => { c.setting.sourceRefs[0].url = 'javascript:alert(1)'; }, c => { c.setting.places[0].id = 'unknown'; },
        c => { c.playerFactionId = 'unknown'; }, c => { c.roster[0].analysisAnchors[0].principle = 'truth'; }
    ]) { const c = config(); mutate(c); assert.throws(() => World.createSession(c)); }
});

test('the catalog offers compound orders, explicit commitments and six player interpretations', () => {
    const c = World.describeActions();
    assert.equal(c.primary.length, 12); assert.equal(c.secondary.length, 9);
    assert.equal(c.principles.length, 6);
    assert.ok(c.primary.every(a => a.title && a.description && a.stats.length === 2));
    assert.equal(World.describeActions(World.createSession(config())).approaches.length, 1);
    c.primary[0].cost.treasury = 999;
    assert.equal(World.describeActions().primary[0].cost.treasury, 4);
});

test('different selected record abilities materially change the same action without name matching', () => {
    const s = World.createSession(config());
    const admin = World.getActionPreview(s, order(s, { primary: 'fortify', actorId: 'record:admin' }));
    const general = World.getActionPreview(s, order(s, { primary: 'fortify', actorId: 'record:general' }));
    assert.ok(general.abilities[0].score > admin.abilities[0].score);
    assert.ok(general.expected.regions[0].security > admin.expected.regions[0].security);
    assert.equal(admin.abilities[0].name, general.abilities[0].name);
});

test('every action produces a legal different consequence in a fresh scene', () => {
    const s = World.createSession(config()), fingerprints = [];
    for (const primary of World.describeActions().primary) {
        const o = order(s, { primary: primary.id, targetFactionId: primary.needsTarget ? 'faction:rival' : 'none' });
        const preview = World.getActionPreview(s, o);
        assert.equal(preview.valid, true, primary.id + preview.errors.join());
        fingerprints.push(JSON.stringify([preview.expected.resources, preview.expected.regions, preview.expected.factions, preview.newCommitments]));
    }
    assert.equal(new Set(fingerprints).size, 12);
});

test('preview is the complete deterministic result and does not mutate input or orders', () => {
    const s = World.createSession(config()), o = order(s, { primary: 'reform', secondary: 'ledger', supportId: 'record:general' }), before = clone(s), orderBefore = clone(o);
    const p1 = World.getActionPreview(s, o), p2 = World.getActionPreview(s, o), next = World.resolveTurn(s, o);
    assert.deepEqual(p1, p2); assert.deepEqual(s, before); assert.deepEqual(o, orderBefore);
    assert.deepEqual(p1.expected.after, next.resources);
    assert.deepEqual(p1.expected.resources, next.log[0].delta);
    assert.deepEqual(p1.expected.factions, next.factions);
    assert.deepEqual(p1.expected.regions, next.regions);
    assert.equal(next.log[0].opponents.length, 3);
    assert.equal(World.validateSession(next).valid, true);
});

test('same seed, config and orders replay identically independently of interleaved sessions', () => {
    let a = World.createSession(config()), b = World.createSession(config()), other = World.createSession(config({ seed: 'other' }));
    for (let i = 0; i < 5; i++) { a = take(a, { primary: i % 2 ? 'harvest' : 'rest' }); other = take(other); b = take(b, { primary: i % 2 ? 'harvest' : 'rest' }); }
    assert.deepEqual(a, b); assert.notDeepEqual(a.resources, other.resources);
    const different = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(seed => take(World.createSession(config({ seed }))).resources.army));
    assert.ok(different.size > 1);
});

test('strict order shape, distinct assignments, real target and exact anchor ownership are enforced', () => {
    const s = World.createSession(config());
    for (const bad of [
        { primary: 'rest' }, { ...order(s), extra: true }, order(s, { actorId: '同名' }),
        order(s, { regionId: 'moon' }), order(s, { targetFactionId: 'faction:player' }),
        order(s, { primary: 'campaign', targetFactionId: 'none' }),
        order(s, { primary: 'campaign', targetFactionId: 'faction:player' }),
        order(s, { secondary: 'none', supportId: 'record:general' }),
        order(s, { actorId: 'record:general', anchorId: 'quote:care' })
    ]) { assert.equal(World.getActionPreview(s, bad).valid, false); assert.throws(() => World.resolveTurn(s, bad)); }
    const double = order(s, { secondary: 'ledger', supportId: 'record:admin' });
    assert.match(World.getActionPreview(s, double).errors.join(), /不同人物/);
    assert.throws(() => World.resolveTurn(s, double), { code: 'ORDER_DISABLED' });
});

test('coordination is shared and unsupported action combinations cannot be executed', () => {
    const s = World.createSession(config());
    const tooMuch = order(s, { primary: 'fortify', secondary: 'training', supportId: 'record:general', stance: 'bold' });
    assert.equal(World.getActionPreview(s, tooMuch).capacity.used, 6);
    const c = take(s, { primary: 'recruit' });
    const over = order(c, { primary: 'fortify', secondary: 'training', supportId: 'record:general', stance: 'bold' });
    assert.equal(World.getActionPreview(c, over).valid, false);
    assert.match(World.getActionPreview(c, over).errors.join(), /協調/);
    assert.equal(World.getActionPreview(s, order(s, { secondary: 'compensate', supportId: 'record:general' })).valid, false);
});

test('costs are paid before gains; a tax order cannot borrow its proceeds to buy a costly supplement', () => {
    let s = World.createSession(config());
    while (s.resources.treasury >= 5 && s.status === 'active') {
        let o = order(s, { primary: 'trade', secondary: 'counterintel', supportId: 'record:general' });
        if (!World.getActionPreview(s, o).valid) o = order(s, { primary: 'study' });
        if (!World.getActionPreview(s, o).valid) break;
        s = World.resolveTurn(s, o);
    }
    assert.ok(s.resources.treasury < 5);
    const p = World.getActionPreview(s, order(s, { primary: 'tax', secondary: 'mediation', supportId: 'record:general' }));
    assert.equal(p.valid, false); assert.match(p.errors.join(), /不能預支/);
});

test('continuous free resting still spends time, supply and defense and eventually collapses', () => {
    const s = restToEnd(World.createSession(config({ maxTurns: 12 })));
    assert.equal(s.status, 'collapsed'); assert.equal(s.ending.id, 'order-collapse');
    assert.ok(s.turn <= 12); assert.ok(s.resources.army === 0 || s.scarcityStreak >= 2);
    assert.throws(() => World.resolveTurn(s, order(s)), { code: 'ORDER_DISABLED' });
});

test('fortification creates a payable future obligation tied to its original executor', () => {
    let s = take(World.createSession(config()), { primary: 'fortify', actorId: 'record:general', regionId: 'region:frontier' });
    assert.equal(s.commitments[0].ownerId, 'record:general'); assert.equal(s.commitments[0].due, 3);
    s = take(s, { primary: 'harvest' });
    assert.equal(World.defaultOrder(s).settlement, 'pay');
    const absent = World.getActionPreview(s, order(s, { settlement: 'none' }));
    assert.equal(absent.valid, false); assert.match(absent.errors.join(), /到期承諾/);
    const paid = take(s, { settlement: 'pay' }), broken = take(s, { settlement: 'default' });
    assert.equal(paid.commitments.length, 0); assert.equal(broken.commitments.length, 0);
    assert.ok(paid.resources.legitimacy > broken.resources.legitimacy);
    assert.ok(paid.actors.find(a => a.recordId === 'record:general').loyalty > broken.actors.find(a => a.recordId === 'record:general').loyalty);
    assert.equal(broken.log.at(-1).events.find(e => e.kind === 'promise-broken').ownerId, 'record:general');
});

test('an obligation can be deferred only once and repayment includes the additional cost', () => {
    let s = take(World.createSession(config()), { primary: 'recruit' });
    s = take(s, { settlement: 'defer', primary: 'harvest' });
    assert.equal(s.commitments[0].deferred, true); assert.equal(s.commitments[0].cost.treasury, 6);
    const again = World.getActionPreview(s, order(s, { settlement: 'defer' }));
    assert.equal(again.valid, false); assert.match(again.errors.join(), /延期一次/);
    assert.equal(World.getActionPreview(s, order(s, { settlement: 'pay' })).cost.treasury, 6);
});

test('future reforms deliver after delay and cannot be harvested without frontloaded investment', () => {
    let s = take(World.createSession(config()), { primary: 'reform' });
    assert.equal(s.pending.length, 1); assert.equal(s.pending[0].due, 3);
    assert.equal(s.regions[0].reformLevel, 1);
    assert.ok(s.log[0].cost.treasury >= 12);
    s = take(s); assert.equal(s.pending.length, 1);
    s = take(s); assert.equal(s.pending.length, 0);
    assert.ok(s.log[2].events.some(e => e.kind === 'delivery' && e.ownerId === 'record:admin'));
});

test('fortifying a front changes where the external military chooses to probe', () => {
    const s = World.createSession(config());
    const plain = take(s), defended = take(s, { primary: 'fortify', regionId: 'region:frontier', actorId: 'record:general' });
    assert.equal(plain.log[0].opponents[0].regionId, 'region:frontier');
    assert.notEqual(defended.log[0].opponents[0].regionId, 'region:frontier');
    assert.ok(defended.regions.find(r => r.id === 'region:frontier').security > plain.regions.find(r => r.id === 'region:frontier').security);
});

test('reconnaissance improves the next campaign but is not permanent knowledge of enemy movement', () => {
    const s = World.createSession(config());
    const prepared = take(s, { primary: 'recon', regionId: 'region:frontier' });
    const raw = World.getActionPreview(s, order(s, { primary: 'campaign', regionId: 'region:frontier', targetFactionId: 'faction:rival', actorId: 'record:general' }));
    const informed = World.getActionPreview(prepared, order(prepared, { primary: 'campaign', regionId: 'region:frontier', targetFactionId: 'faction:rival', actorId: 'record:general' }));
    assert.ok(informed.notes.some(n => /有效情報/.test(n)));
    assert.ok(informed.expected.factions.find(f => f.id === 'faction:rival').strength < raw.expected.factions.find(f => f.id === 'faction:rival').strength);
    const expired = take(take(prepared));
    assert.ok(expired.regions.find(r => r.id === 'region:frontier').intelUntil < expired.turn + 1);
});

test('a truce constrains one faction while two other opponents retain their own actions', () => {
    const s = take(World.createSession(config()), { primary: 'diplomacy', actorId: 'record:diplomat', targetFactionId: 'faction:rival' });
    assert.equal(s.log[0].opponents.find(o => o.factionId === 'faction:rival').action, 'truce');
    assert.equal(s.log[0].opponents.filter(o => o.action !== 'truce').length, 2);
    const attacked = take(s, { primary: 'campaign', actorId: 'record:general', targetFactionId: 'faction:rival' });
    assert.match(attacked.log[1].notes.join(), /毀約/);
    assert.ok(attacked.resources.legitimacy < s.resources.legitimacy);
});

test('civilian, court and frontier pressures are separately visible with clear thresholds', () => {
    const scene = World.getScene(World.createSession(config()));
    assert.deepEqual(scene.pressures.map(p => p.id), ['civilian', 'court', 'frontier']);
    assert.ok(scene.pressures.every(p => Number.isInteger(p.value) && p.description));
    assert.equal(scene.factions.filter(f => !f.player).length, 3);
    assert.match(scene.notice, /遊戲規則/);
});

test('source reading links remain exact-ID links even when names contain punctuation', () => {
    const c = config(); c.roster[0].recordId = 'record:甲?x=1#same';
    const person = World.getScene(World.createSession(c)).roster[0];
    assert.equal(new URL(person.historyUrl, 'https://example.com').searchParams.get('record'), c.roster[0].recordId);
    assert.ok(person.archiveUrl.endsWith(encodeURIComponent(c.roster[0].recordId)));
});

test('scene-specific identity context is frozen, labeled and cannot grant an unsupported mechanical bonus', () => {
    const c = config(); c.roster[0].sourceContext = { historyPersonId: 'person:one', evidenceStatus: 'scoped-source', evidenceLabel: '僅限此事件角色記述', role: '所選切片中的角色記述', participation: 'possible' };
    const linked = World.createSession(c), unlinked = World.createSession(config());
    assert.deepEqual(World.getScene(linked).roster[0].sourceContext, c.roster[0].sourceContext);
    assert.match(World.getScene(unlinked).roster[0].sourceContext.evidenceLabel, /創作/);
    assert.deepEqual(take(linked).resources, take(unlinked).resources);
    const exported = World.exportSession(take(linked)); exported.state.config.roster[0].sourceContext.role = '悄悄改寫';
    assert.throws(() => World.importSession(exported), { code: 'INVALID_SAVE' });
    c.roster[0].sourceContext.role = {};
    assert.throws(() => World.createSession(c), { code: 'INVALID_CONFIG' });
});

test('URL-encoded analysis citation IDs preserve long non-ASCII record identity without truncation', () => {
    const c = config(), id = '人物'.repeat(40), citation = 'A:' + encodeURIComponent(id) + ':deepAnalysis:0-20';
    c.roster[0].recordId = id; c.roster[0].analysisAnchors[0].id = citation; c.roster[0].analysisAnchors[0].sourceRefs = [citation];
    const s = take(World.createSession(c), { actorId: id, anchorId: citation });
    assert.equal(s.log[0].analysisAnchor.id, citation);
    assert.deepEqual(World.importSession(World.exportSession(s)), s);
});

test('a plain original analysis quote is preserved verbatim without a numeric truth score', () => {
    const s = World.createSession(config()), quoted = take(s, { primary: 'study', anchorId: 'quote:care' }), plain = take(s, { primary: 'study' });
    assert.deepEqual(quoted.resources, plain.resources); assert.deepEqual(quoted.actors, plain.actors);
    assert.equal(quoted.log[0].analysisAnchor.quote, config().roster[0].analysisAnchors[0].quote);
    assert.equal(quoted.log[0].analysisAnchor.status, 'original-analysis-context-not-verified-fact');
    assert.equal(quoted.log[0].anchorApplication, null);
});

test('player-selected principles produce bounded practices and distinguish original text from interpretation', () => {
    const c = config(); c.roster[0].analysisAnchors[0].principle = 'care';
    let s = World.createSession(c);
    for (let i = 0; i < 3; i++) {
        const p = World.getActionPreview(s, order(s, { primary: 'harvest', anchorId: 'quote:care' }));
        assert.equal(p.anchorApplication.priorPractices, i);
        assert.equal(p.anchorApplication.status, 'aligned');
        assert.equal(p.anchorApplication.rewarded, i < 2);
        assert.equal(p.anchorApplication.effects.loyalty, i < 2 ? 3 : 0);
        s = take(s, { primary: 'harvest', anchorId: 'quote:care' });
    }
    assert.equal(s.log[0].anchorApplication.interpretation, 'player-selected-not-historical-truth');
    const conflict = World.getActionPreview(s, order(s, { primary: 'tax', anchorId: 'quote:care' }));
    assert.equal(conflict.anchorApplication.status, 'conflict');
    assert.equal(conflict.anchorApplication.effects.loyalty, -3);
    const compensated = World.getActionPreview(s, order(s, { primary: 'tax', secondary: 'compensate', supportId: 'record:general', anchorId: 'quote:care' }));
    assert.equal(compensated.anchorApplication.status, 'neutral');
});

test('the principle reward cap is bound to exact record and anchor IDs and survives save/import', () => {
    const c = config(); c.roster[0].analysisAnchors[0].principle = 'learning';
    let s = World.createSession(c);
    for (let i = 0; i < 2; i++) s = take(s, { primary: 'study', anchorId: 'quote:care' });
    s = World.importSession(World.exportSession(s));
    const p = World.getActionPreview(s, order(s, { primary: 'study', anchorId: 'quote:care' }));
    assert.equal(p.anchorApplication.rewarded, false);
    assert.equal(p.anchorApplication.priorPractices, 2);
    assert.equal(World.getActionPreview(s, order(s, { primary: 'study', actorId: 'record:general', anchorId: 'quote:care' })).valid, false);
});

test('all five principles expose a consequential conflict rather than a generic quote badge', () => {
    const cases = [ ['care', { primary: 'tax' }], ['order', { primary: 'tax', stance: 'bold' }], ['bold', { primary: 'rest', stance: 'prudent' }], ['diplomacy', { primary: 'campaign', targetFactionId: 'faction:rival' }], ['learning', { primary: 'campaign', targetFactionId: 'faction:rival' }] ];
    for (const [principle, changes] of cases) { const c = config(); c.roster[0].analysisAnchors[0].principle = principle; const s = World.createSession(c); const p = World.getActionPreview(s, order(s, { ...changes, anchorId: 'quote:care' })); assert.equal(p.valid, true); assert.equal(p.anchorApplication.status, 'conflict', principle); }
});

test('soul mode requires distinct host and guest records and cannot assign two bodies to one person', () => {
    for (const changes of [{ hostId: null, soulId: 'record:diplomat' }, { hostId: 'record:host', soulId: 'record:host' }, { hostId: 'missing', soulId: 'record:diplomat' }]) assert.throws(() => World.createSession(config({ mode: 'soul', ...changes })), { code: 'INVALID_CONFIG' });
    const s = World.createSession(config({ mode: 'soul', hostId: 'record:host', soulId: 'record:diplomat' }));
    assert.equal(World.getScene(s).roster.find(r => r.recordId === 'record:diplomat').embodied, false);
    for (const changes of [{ actorId: 'record:diplomat' }, { secondary: 'bond', supportId: 'record:diplomat' }]) { const p = World.getActionPreview(s, order(s, changes)); assert.equal(p.valid, false); assert.match(p.errors.join(), /同一身體/); }
});

test('host, soul and blended approaches have different effective abilities and identity consequences', () => {
    const s = World.createSession(config({ mode: 'soul', hostId: 'record:host', soulId: 'record:diplomat' }));
    const previews = ['host', 'blend', 'soul'].map(approach => World.getActionPreview(s, order(s, { primary: 'diplomacy', targetFactionId: 'faction:rival', approach })));
    assert.ok(previews[0].abilities[0].score < previews[1].abilities[0].score);
    assert.ok(previews[1].abilities[0].score < previews[2].abilities[0].score);
    assert.ok(previews[0].expected.soul.tension < previews[1].expected.soul.tension);
    assert.ok(previews[1].expected.soul.tension < previews[2].expected.soul.tension);
    assert.ok(previews[0].expected.soul.adaptation < previews[2].expected.soul.adaptation);
});

test('learning and cooperation provide real ways to adapt and maintain social bonds', () => {
    const s = World.createSession(config({ mode: 'soul', hostId: 'record:host', soulId: 'record:diplomat' }));
    const alone = take(s, { primary: 'study', approach: 'soul' });
    const together = take(s, { primary: 'study', approach: 'soul', secondary: 'bond', supportId: 'record:general' });
    assert.ok(together.soul.adaptation > s.soul.adaptation);
    assert.ok(together.soul.tension < alone.soul.tension);
    const bond = value => value.bonds.find(b => [b.a, b.b].includes('record:host') && [b.a, b.b].includes('record:general')).trust;
    assert.ok(bond(together) > bond(alone));
});

test('a selected host interpretation affects adaptation or tension without changing historical claims', () => {
    const c = config({ mode: 'soul', hostId: 'record:host', soulId: 'record:diplomat' });
    c.roster[3].analysisAnchors = [{ id: 'host:quote', quote: '宿主的原分析', principle: 'learning' }];
    const s = World.createSession(c);
    const interpreted = take(s, { primary: 'study', approach: 'blend', anchorId: 'host:quote' }), plain = take(s, { primary: 'study', approach: 'blend' });
    assert.equal(interpreted.soul.adaptation - plain.soul.adaptation, 2);
    assert.deepEqual(interpreted.config.setting.sourceRefs, plain.config.setting.sourceRefs);
    const conflict = World.getActionPreview(s, order(s, { primary: 'campaign', targetFactionId: 'faction:rival', anchorId: 'host:quote' }));
    assert.equal(conflict.anchorApplication.effects.tension, 2);
});

test('all completed paths settle final obligations immediately and cannot hide debt after ending', () => {
    let s = World.createSession(config({ maxTurns: 8 }));
    for (let i = 0; i < 7; i++) s = take(s, { primary: i % 3 === 0 ? 'harvest' : 'rest' });
    const p = World.getActionPreview(s, order(s, { primary: 'fortify' }));
    assert.equal(p.valid, true); assert.equal(p.cost.grain, 11); assert.equal(p.cost.treasury, 13);
    s = World.resolveTurn(s, order(s, { primary: 'fortify' }));
    assert.equal(s.status, 'completed'); assert.equal(s.commitments.length, 0);
    assert.ok(s.log.at(-1).events.some(e => e.kind === 'final-commitment'));
});

test('complete loops produce distinct endings depending on decisions, not just mode label', () => {
    const strong = policy(World.createSession(config())), passive = restToEnd(World.createSession(config()));
    assert.equal(strong.ending.id, 'civil-foundation'); assert.equal(passive.ending.id, 'fragile-balance');
    assert.ok(strong.resources.army > passive.resources.army);
    assert.ok(strong.resources.legitimacy > passive.resources.legitimacy);
    bounded(strong); bounded(passive);
});

test('a deliberate closing diplomatic sequence can establish a negotiated order', () => {
    const steps = balanced.slice(0, 6).concat([
        ['diplomacy', 'ledger', 'diplomat', 'admin', 'frontier', 'rival'],
        ['diplomacy', 'ledger', 'diplomat', 'admin', 'trade', 'league']
    ]);
    const s = policy(World.createSession(config({ maxTurns: 8 })), steps);
    assert.equal(s.ending.id, 'negotiated-order');
    assert.equal(s.commitments.length, 0);
    assert.ok(s.factions.filter(f => !f.player && f.truceUntil >= s.turn).length >= 2);
});

test('a full soul campaign combines resource choices, interpretation, adaptation and original social bonds', () => {
    let s = World.createSession({ mode: 'soul', seed: 'test', hostId: 'host', soulId: 'guest', roster: [
        { recordId: 'host', name: '宿主', stats: [70, 70, 65, 70, 65] },
        { recordId: 'guest', name: '靈魂', stats: [60, 30, 95, 90, 90] },
        { recordId: 'general', name: '將', stats: [92, 95, 80, 70, 85] },
        { recordId: 'admin', name: '政', stats: [70, 50, 80, 95, 85] }
    ] });
    const steps = [
        ['study', 'bond', 'host', 'general', 'heartland'], ['fortify', 'ledger', 'general', 'admin', 'frontier'],
        ['harvest', 'bond', 'host', 'general', 'heartland'], ['reform', 'bond', 'admin', 'host', 'heartland'],
        ['study', 'ledger', 'host', 'admin', 'heartland'], ['harvest', 'bond', 'host', 'general', 'frontier'],
        ['tax', 'compensate', 'admin', 'host', 'heartland'], ['rest', 'bond', 'host', 'general', 'frontier'],
        ['relief', 'ledger', 'admin', 'host', 'heartland'], ['rest', 'bond', 'host', 'general', 'frontier']
    ];
    for (const [primary, secondary, actorId, supportId, region] of steps) s = take(s, { primary, secondary, actorId, supportId, regionId: 'region:' + region, approach: 'blend' });
    assert.equal(s.turn, 10); assert.equal(s.ending.id, 'dual-concord');
    assert.ok(s.soul.adaptation >= 65 && s.soul.tension < 55 && s.ending.bondAverage >= 55);
    assert.ok(s.resources.army < 20, 'building internal agreement still leaves a real external defense cost');
    assert.deepEqual(World.importSession(World.exportSession(s)), s);
});

test('long player interpretations and source statements are preserved separately from a short label', () => {
    const c = config(), interpretation = '這是玩家自己選定而不是模型替人物推斷的解讀。'.repeat(50);
    c.roster[0].analysisAnchors[0].interpretation = interpretation;
    c.setting.sourceRefs[0].title = '範圍限定的來源主張。'.repeat(80);
    const s = take(World.createSession(c), { primary: 'study', anchorId: 'quote:care' });
    assert.equal(s.log[0].analysisAnchor.interpretation, interpretation);
    assert.equal(s.log[0].sourceRefs[0].title, c.setting.sourceRefs[0].title);
    assert.deepEqual(World.importSession(World.exportSession(s)), s);
});

test('accepted reference budgets leave room for the complete replay instead of filling a save at creation', () => {
    const c = config(); c.setting.sourceRefs = Array.from({ length: 5 }, (_, i) => ({ id: 's' + i, title: '文'.repeat(6000) }));
    assert.throws(() => World.createSession(c), /24,000/);
});

test('each log resource delta is explainable by actual bounded effects of actions, upkeep and opponents', () => {
    const result = policy(World.createSession(config()));
    for (const log of result.log) {
        const sum = Object.fromEntries(Object.keys(World.RESOURCE_LABELS).map(k => [k, 0]));
        for (const entry of [...log.events, ...log.opponents]) for (const [key, delta] of Object.entries(entry.effects || {})) sum[key] += delta;
        assert.deepEqual(sum, log.delta, 'turn ' + log.turn);
    }
});

test('replay validation rejects edited resources, actors, relationships, sources, orders and log text', () => {
    const s = policy(World.createSession(config()));
    for (const mutate of [
        x => { x.resources.grain++; }, x => { x.actors[0].loyalty++; }, x => { x.bonds[0].trust++; },
        x => { x.config.setting.sourceRefs[0].title = '改寫來源'; }, x => { x.orders[0].actorId = 'record:admin'; },
        x => { x.log[0].title = '改寫敘事'; }, x => { x.ending.id = 'victory'; }, x => { x.extra = 1; },
        x => { x.version = 2; }, x => { x.regions[0].intelUntil = 999; }, x => { x.factions[1].hostility = 0; }
    ]) { const bad = clone(s); mutate(bad); assert.equal(World.validateSession(bad).valid, false); assert.throws(() => World.importSession({ format: 'dynasty-world-save', version: 1, state: bad }), { code: 'INVALID_SAVE' }); }
});

test('strict export/import is independent, JSON-safe and rejects malformed, oversized or polluted saves', () => {
    const s = take(World.createSession(config()), { primary: 'study', anchorId: 'quote:care' });
    const restored = World.importSession(JSON.stringify(World.exportSession(s)));
    assert.deepEqual(restored, s); restored.resources.army = 0; assert.notEqual(s.resources.army, 0);
    for (const bad of ['{', ' '.repeat(1600001), {}, { ...World.exportSession(s), extra: true }, JSON.parse('{"__proto__":{"x":1}}'), { format: 'dynasty-world-save', version: 1, state: { ...s, bad: () => 1 } }]) assert.throws(() => World.importSession(bad));
    assert.equal({}.x, undefined);
    const sorted = JSON.parse(JSON.stringify(s), (key, value) => value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse()) : value);
    assert.equal(World.validateSession(sorted).valid, true);
});

test('actor exhaustion, practice and delegation are carried across rounds rather than reset each turn', () => {
    let s = World.createSession(config());
    for (let i = 0; i < 5; i++) s = take(s, { primary: 'harvest', stance: 'bold' });
    const actor = s.actors.find(a => a.recordId === 'record:admin');
    assert.ok(actor.fatigue >= 70); assert.equal(actor.commissions, 5); assert.ok(actor.experience > 0);
    const p = World.getActionPreview(s, order(s, { primary: 'harvest' }));
    assert.ok(p.abilities[0].fatiguePenalty > 0); assert.equal(p.capacity.used, 3);
    const after = take(s, { actorId: 'record:general' });
    assert.ok(after.actors.find(a => a.recordId === 'record:admin').fatigue < actor.fatigue);
});

test('reducer supports only a complete turn and every output remains a valid replayable save', () => {
    const s = World.createSession(config()), o = order(s);
    assert.deepEqual(World.reduce(s, { type: 'turn', order: o }), World.resolveTurn(s, o));
    assert.throws(() => World.reduce(s, { type: 'cheat', resources: { grain: 100 } }));
    const all = [policy(World.createSession(config())), restToEnd(World.createSession(config({ maxTurns: 12 }))), restToEnd(World.createSession(config({ mode: 'soul', hostId: 'record:host', soulId: 'record:diplomat' })))];
    for (const state of all) { bounded(state); assert.equal(World.validateSession(state).valid, true); assert.deepEqual(World.importSession(World.exportSession(state)), state); }
});
