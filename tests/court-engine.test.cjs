'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const court = require('../backend/static/js/court-engine.js');

const clone = value => JSON.parse(JSON.stringify(value));
const play = (...choices) => choices.reduce((state, id) => court.choose(state, id), court.createGame());
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
function allStates() {
    const result = [];
    function visit(state) {
        result.push(state);
        for (const choice of court.getChoices(state)) {
            if (!choice.disabledReason) visit(court.choose(state, choice.id));
        }
    }
    visit(court.createGame());
    return result;
}

test('browser build exposes the same engine without module loading', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(require.resolve('../backend/static/js/court-engine.js'), 'utf8'), context);
    assert.equal(typeof context.DynastyCourt.choose, 'function');
    vm.runInContext('initial = DynastyCourt.createGame(); valid = DynastyCourt.validateState(initial)', context);
    assert.equal(context.valid, true);
    assert.equal(context.initial.scenario, 'court-grain-v1');
});

test('new games and public descriptions cannot share mutable game state', () => {
    const original = court.createGame();
    const other = court.createGame();
    other.resources.grain = 0;
    other.trust.hanXin = 0;
    other.log.push({});
    assert.equal(original.resources.grain, 42);
    assert.equal(original.trust.hanXin, 50);
    assert.equal(original.log.length, 0);
    const choices = court.getChoices(original);
    choices[0].effects.grain = 999;
    assert.equal(court.getChoices(original)[0].effects.grain, 12);
    assert.match(court.getScene(original).description, /架空|不是歷史/);
    court.ADVISORS.forEach(advisor => {
        assert.match(advisor.lesson, /^遊戲改編：/);
        assert.match(advisor.stance, /^遊戲改編：/);
        assert.match(advisor.portrait, /^\/static\/game\/court\/.+\.png$/);
    });
});

test('a decision is immutable and schedules an actual later cost and benefit', () => {
    const initial = freeze(court.createGame());
    const next = court.choose(initial, 'r1-route');
    assert.equal(initial.turn, 0);
    assert.deepEqual(initial.resources, { grain: 42, treasury: 60, people: 55, defense: 52 });
    assert.notEqual(next, initial);
    assert.deepEqual(next.resources, { grain: 54, treasury: 42, people: 55, defense: 52 });
    assert.deepEqual(next.pending.map(event => [event.sourceChoice, event.due]), [['r1-route', 2]]);
    assert.deepEqual(next.log[0].changes, { grain: 12, treasury: -18, people: 0, defense: 0 });
    assert.match(court.getScene(next).news.join(' '), /糧車抵達.*第 2 回合/);

    const later = court.choose(freeze(next), 'r2-garrison');
    assert.deepEqual(later.resources, { grain: 52, treasury: 30, people: 50, defense: 74 });
    assert.deepEqual(later.log[1].changes, { grain: -2, treasury: -12, people: -5, defense: 22 });
    assert.match(later.log[1].consequences.join(' '), /遠倉糧車抵達/);
    assert.deepEqual(later.pending.map(event => [event.sourceChoice, event.due]), [['r2-garrison', 3]]);
});

test('rapid requisition earns grain now and loses civilian support on the following settlement', () => {
    const first = play('r1-requisition');
    assert.equal(first.resources.grain, 64);
    assert.equal(first.resources.people, 43);
    const second = court.choose(first, 'r2-market');
    assert.equal(second.resources.people, 36);
    assert.equal(second.resources.treasury, 32);
    assert.match(second.log[1].consequences.join(' '), /藏起餘糧/);
    assert.equal(second.trust.weiZheng, 38);
});

test('resource requirements disable a reachable unaffordable order without consuming the turn', () => {
    const state = freeze(play('r1-relief', 'r2-garrison'));
    const snapshot = clone(state);
    const choices = court.getChoices(state);
    const military = choices.find(choice => choice.id === 'r3-counter');
    assert.equal(state.resources.grain, 22);
    assert.match(military.disabledReason, /糧儲至少需要 26.*目前 22/);
    assert.equal(choices.filter(choice => !choice.disabledReason).length, 2);
    assert.throws(() => court.choose(state, military.id), { code: 'INSUFFICIENT_RESOURCES' });
    assert.deepEqual(state, snapshot);
    assert.equal(court.choose(state, 'r3-audit').turn, 3);
});

test('an order belongs to one turn, cannot be repeated, and cannot run after the ending', () => {
    const first = play('r1-route');
    assert.throws(() => court.choose(first, 'r1-route'), { code: 'INVALID_CHOICE' });
    assert.throws(() => court.choose(first, 'r3-audit'), { code: 'INVALID_CHOICE' });
    assert.throws(() => court.choose(first, '<script>'), { code: 'INVALID_CHOICE' });
    const complete = play('r1-route', 'r2-market', 'r3-audit');
    assert.deepEqual(court.getChoices(complete), []);
    assert.throws(() => court.choose(complete, 'r3-audit'), { code: 'GAME_COMPLETE' });
    assert.equal(complete.pending.length, 0);
    assert.equal(court.getScene(complete).id, 'court-conclusion');
});

test('previous decisions change advisor memory, trust and the later execution bonus', () => {
    const trusted = play('r1-route', 'r2-market');
    const unprepared = play('r1-relief', 'r2-market');
    assert.equal(trusted.trust.xiaoHe, 75);
    assert.equal(unprepared.trust.xiaoHe, 63);
    assert.equal(court.getChoices(trusted).find(choice => choice.id === 'r3-audit').effects.grain, 18);
    assert.equal(court.getChoices(unprepared).find(choice => choice.id === 'r3-audit').effects.grain, 10);
    const memory = trusted.log[1].reactions.find(reaction => reaction.id === 'xiaoHe').text;
    assert.match(memory, /我記得你曾採納「修復糧道，調撥官倉」/);
    assert.match(memory, /我願繼續配合/);
    assert.match(memory, /^遊戲改編：/);
});

test('truce outcome is declared when dispatched and is not retroactively changed by later popularity', () => {
    const supported = play('r1-relief');
    const unsupported = play('r1-route');
    assert.match(court.getChoices(supported).find(choice => choice.id === 'r2-truce').delayedHint, /邊防 \+10/);
    assert.match(court.getChoices(unsupported).find(choice => choice.id === 'r2-truce').delayedHint, /邊防 -8/);
    const dispatched = court.choose(unsupported, 'r2-truce');
    assert.equal(dispatched.resources.people, 60);
    assert.equal(dispatched.pending[0].effects.defense, -8);
    const complete = court.choose(dispatched, 'r3-audit');
    assert.equal(complete.resources.people, 68);
    assert.match(complete.log[2].consequences.join(' '), /盟約風險成真/);
    assert.equal(complete.resources.defense, 56);
});

test('different actual routes lead to distinct complete endings with their remaining costs', () => {
    const routes = [
        [['r1-route', 'r2-garrison', 'r3-counter'], 'frontier'],
        [['r1-relief', 'r2-truce', 'r3-audit'], 'civic'],
        [['r1-requisition', 'r2-market', 'r3-audit'], 'granary'],
        [['r1-requisition', 'r2-garrison', 'r3-counter'], 'crisis'],
        [['r1-route', 'r2-market', 'r3-counter'], 'fragile']
    ];
    for (const [choices, expected] of routes) {
        const state = play(...choices);
        const ending = court.getEnding(state);
        assert.equal(ending.id, expected);
        assert.equal(state.turn, 3);
        assert.equal(state.pending.length, 0);
        assert.match(ending.lessons.join(' '), /架空.*不代表人物史實/);
        assert.match(ending.lessons.join(' '), /先後採納/);
    }
    assert.equal(court.getEnding(play('r1-route')), null);
});

test('every reachable path stays valid, has a way forward, settles pending events and reports actual deltas', () => {
    const states = allStates();
    const final = states.filter(state => state.turn === 3);
    assert.equal(final.length, 26);
    assert.deepEqual([...new Set(final.map(state => court.getEnding(state).id))].sort(), ['civic', 'crisis', 'fragile', 'frontier', 'granary']);
    for (const state of states) {
        assert.equal(court.validateState(state), true);
        assert.equal(court.validateState(clone(state)), true);
        assert.ok(Object.values(state.resources).every(value => Number.isInteger(value) && value >= 0 && value <= 100));
        assert.ok(Object.values(state.trust).every(value => Number.isInteger(value) && value >= 0 && value <= 100));
        if (state.turn < 3) assert.ok(court.getChoices(state).some(choice => !choice.disabledReason));
        if (state.turn === 3) assert.equal(state.pending.length, 0);
        for (const choice of court.getChoices(state).filter(choice => !choice.disabledReason)) {
            const next = court.choose(state, choice.id);
            for (const key of Object.keys(state.resources)) assert.equal(next.log.at(-1).changes[key], next.resources[key] - state.resources[key]);
        }
    }
});

test('resource caps report the actual improvement instead of advertising impossible stock', () => {
    const state = play('r1-route', 'r2-market');
    assert.equal(state.resources.grain, 88);
    const complete = court.choose(state, 'r3-audit');
    assert.equal(complete.resources.grain, 100);
    assert.equal(complete.log[2].changes.grain, 12);
    assert.match(complete.log[2].consequences.join(' '), /糧儲達到上限 100/);
});

test('resume validation checks the entire deterministic history and rejects tampered derived values', () => {
    const valid = play('r1-route', 'r2-market');
    const mutations = [
        state => { state.resources.grain++; },
        state => { state.trust.xiaoHe = 100; },
        state => { state.pending[0].due = 2; },
        state => { state.pending[0].effects.grain = 100; },
        state => { state.log[0].choiceId = 'r1-relief'; },
        state => { state.log[0].reactions[0].text = '偽造人物分析'; },
        state => { state.log[1].changes.people = 99; },
        state => { state.log[1].consequences = []; },
        state => { state.turn = 0; },
        state => { state.version = 2; },
        state => { state.scenario = 'unknown'; },
        state => { state.resources.grain = NaN; },
        state => { state.resources.futureResource = 1; },
        state => { state.unrecognized = {}; },
        state => { state.log.push(state.log[1]); }
    ];
    for (const mutate of mutations) {
        const changed = clone(valid);
        mutate(changed);
        assert.equal(court.validateState(changed), false);
        assert.throws(() => court.choose(changed, 'r3-audit'), { code: 'INVALID_STATE' });
    }
    assert.equal(court.validateState(null), false);
    assert.equal(court.validateState([]), false);
    assert.equal(court.validateState('court'), false);
    const reordered = Object.fromEntries(Object.entries(clone(valid)).reverse());
    reordered.resources = Object.fromEntries(Object.entries(reordered.resources).reverse());
    assert.equal(court.validateState(reordered), true);
});

test('a legitimate unfinished replay resumes exactly and a completed replay reproduces the same ending', () => {
    for (const state of [court.createGame(), play('r1-route'), play('r1-route', 'r2-market'), play('r1-route', 'r2-market', 'r3-audit')]) {
        const replay = court.exportReplay(state);
        const resumed = court.importReplay(JSON.stringify(replay));
        assert.deepEqual(resumed, state);
        assert.notEqual(resumed, state);
        if (state.turn < 3) {
            const choice = court.getChoices(state).find(item => !item.disabledReason);
            assert.deepEqual(court.choose(resumed, choice.id), court.choose(state, choice.id));
        } else assert.deepEqual(court.getEnding(resumed), court.getEnding(state));
    }
});

test('invalid replay wrappers, forged endings and malformed or oversized files fail without changing the current game', () => {
    const state = freeze(play('r1-route'));
    const snapshot = clone(state);
    const replay = court.exportReplay(state);
    const forged = clone(replay);
    forged.choices = ['r1-relief'];
    assert.throws(() => court.importReplay(forged), { code: 'INVALID_REPLAY' });
    forged.choices = replay.choices;
    forged.ending = 'civic';
    assert.throws(() => court.importReplay(forged), { code: 'INVALID_REPLAY' });
    for (const value of ['{', ' '.repeat(40001), null, {}, JSON.parse('{"__proto__":{},"state":null}')]) {
        assert.throws(() => court.importReplay(value), { code: 'INVALID_REPLAY' });
    }
    assert.deepEqual(state, snapshot);
});
