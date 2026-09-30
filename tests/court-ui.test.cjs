'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../backend/static/js/court-engine.js');
const ui = require('../backend/static/js/court-ui.js');
const council = require('../backend/static/js/court-council.js');

function save(state = engine.createGame(), presentOutcome = false) {
    return { format: 'dynasty-court-save', version: 1, scenario: 'court-grain-v1', state, presentOutcome };
}
function firstDecision(state = engine.createGame()) {
    return engine.choose(state, engine.getChoices(state).find(choice => !choice.disabledReason).id);
}

test('a downloaded decision keeps its outcome screen and can resume the next scene', () => {
    const state = firstDecision();
    const restored = ui.parseSave(JSON.parse(JSON.stringify(save(state, true))), engine);
    assert.equal(restored.presentOutcome, true);
    assert.deepEqual(restored.state, state);
    assert.ok(engine.getScene(restored.state).title);
    assert.ok(engine.getChoices(restored.state).length);
    restored.state.resources.grain = -1;
    assert.notEqual(state.resources.grain, -1);
});

test('a complete three-round save keeps the same ending and full causal history', () => {
    let state = engine.createGame();
    while (!engine.getEnding(state)) state = firstDecision(state);
    const restored = ui.parseSave(save(state, true), engine);
    assert.equal(restored.state.log.length, 3);
    assert.deepEqual(engine.getEnding(restored.state), engine.getEnding(state));
});

test('import rejects an edited resource or history instead of rewriting a valid save', () => {
    const original = save(firstDecision(), true);
    const altered = JSON.parse(JSON.stringify(original));
    altered.state.resources.grain += 1;
    assert.throws(() => ui.parseSave(altered, engine));
    altered.state = JSON.parse(JSON.stringify(original.state));
    altered.state.log[0].title = '假造詔令';
    assert.throws(() => ui.parseSave(altered, engine));
    assert.ok(engine.validateState(original.state));
});

test('import rejects unrelated backups, unknown envelope fields and unsupported versions', () => {
    for (const value of [null, {}, [], { ...save(), version: 2 }, { ...save(), token: 'should-not-enter-game-save' }, { ...save(), format: 'dynasty-backup' }, { ...save(), presentOutcome: 'false' }]) {
        assert.throws(() => ui.parseSave(value, engine));
    }
});

test('an outcome screen requires a real decision in the verified history', () => {
    assert.throws(() => ui.parseSave(save(engine.createGame(), true), engine));
    assert.equal(ui.parseSave(save(), engine).presentOutcome, false);
});

function councilSave(state = council.createGame(), presentOutcome = false) {
    return { format: 'dynasty-court-save', version: 2, scenario: 'court-grain-v2', state, presentOutcome };
}
function councilDecision(state = council.createGame()) {
    const proposal = council.getCatalog(state).recommendations.find(item => !council.evaluateOrder(state, item.order).disabledReasons.length);
    assert.ok(proposal, 'the council must offer at least one legal draft');
    return council.choose(state, proposal.order);
}

test('v2 download preserves the complete compound order, promises and actor memory', () => {
    const state = councilDecision();
    const restored = ui.parseSave(JSON.parse(JSON.stringify(councilSave(state, true))), council);
    assert.equal(restored.version, 2);
    assert.equal(restored.presentOutcome, true);
    assert.deepEqual(restored.state, state);
    assert.equal(Object.keys(restored.state.log[0].order).length, 4);
    restored.state.actorMemory.hanXin.events.push('changed copy');
    assert.notDeepEqual(restored.state.actorMemory, state.actorMemory);
});

test('v2 completed save restores its ending and causal ledger', () => {
    let state = council.createGame();
    while (!council.getEnding(state)) state = councilDecision(state);
    const restored = ui.parseSave(councilSave(state, true), council);
    assert.equal(restored.state.log.length, 3);
    assert.deepEqual(council.getEnding(restored.state), council.getEnding(state));
});

test('each save version routes to its matching engine by default', t => {
    const priorCourt = global.DynastyCourt, priorCouncil = global.DynastyCouncil;
    global.DynastyCourt = engine; global.DynastyCouncil = council;
    t.after(() => {
        if (priorCourt === undefined) delete global.DynastyCourt; else global.DynastyCourt = priorCourt;
        if (priorCouncil === undefined) delete global.DynastyCouncil; else global.DynastyCouncil = priorCouncil;
    });
    assert.deepEqual(ui.parseSave(save(firstDecision(), true)).state, firstDecision());
    const state = councilDecision();
    assert.deepEqual(ui.parseSave(councilSave(state, true)).state, state);
    assert.throws(() => ui.parseSave(councilSave(), engine));
    assert.throws(() => ui.parseSave(save(), council));
});

test('v2 import rejects mixed markers, unknown fields, forged memory and orders', () => {
    const original = councilSave(councilDecision(), true);
    for (const value of [
        { ...original, version: 1 }, { ...original, scenario: 'court-grain-v1' },
        { ...original, scenario: 'toString' }, { ...original, scenario: '__proto__' },
        { ...original, token: 'unrelated-private-field' }, { ...original, presentOutcome: 'true' },
        { ...original, state: { ...original.state, scenario: 'court-grain-v1' } },
        { ...original, state: { ...original.state, version: 1 } }
    ]) assert.throws(() => ui.parseSave(value, council));
    const memoryEdit = JSON.parse(JSON.stringify(original));
    memoryEdit.state.actorMemory.hanXin.events.push('invented promise');
    assert.throws(() => ui.parseSave(memoryEdit, council));
    const orderEdit = JSON.parse(JSON.stringify(original));
    orderEdit.state.log[0].order.executor = orderEdit.state.log[0].order.executor === 'hanXin' ? 'xiaoHe' : 'hanXin';
    assert.throws(() => ui.parseSave(orderEdit, council));
    assert.throws(() => ui.parseSave(councilSave(council.createGame(), true), council));
    assert.ok(council.validateState(original.state));
});
