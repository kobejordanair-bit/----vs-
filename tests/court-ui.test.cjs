'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../backend/static/js/court-engine.js');
const ui = require('../backend/static/js/court-ui.js');

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
