const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../backend/static/js/storage.js');
const ack = revision => ({ ok: true, json: async () => ({ status: 'ok', revision }) });
const tick = () => new Promise(resolve => setImmediate(resolve));
test('load gate prevents writes and rejects invalid revision', async () => {
    let calls = 0;
    const storage = create({ capture: () => ({}), post: async () => { calls++; } });
    assert.equal(await storage.save(), false); assert.equal(calls, 0);
    assert.throws(() => storage.initialize(-1)); assert.throws(() => storage.initialize(true));
});
test('debounce coalesces snapshots and all callers await acknowledgment', async () => {
    let data = { soulSession: { text: 'old' } }, bodies = [];
    const storage = create({ capture: () => data, post: async body => { bodies.push(body); return ack(body.revision + 1); }, debounceMs: 10 });
    storage.initialize(4);
    const a = storage.save(); data.soulSession.text = 'new'; const b = storage.save();
    assert.deepEqual(await Promise.all([a, b]), [true, true]);
    assert.equal(bodies.length, 1); assert.equal(bodies[0].soulSession.text, 'new'); assert.equal(storage.getState().revision, 5);
});
test('in-flight changes serialize with next revision and flush waits for latest', async () => {
    let data = { value: 1 }, releases = [], bodies = [];
    const storage = create({ capture: () => data, post: body => { bodies.push(body); return new Promise(resolve => releases.push(() => resolve(ack(body.revision + 1)))); } });
    storage.initialize(0);
    const a = storage.save({ immediate: true });
    data.value = 2; const b = storage.save(); const flushed = storage.flush();
    assert.equal(bodies.length, 1); assert.equal(bodies[0].value, 1);
    releases.shift()(); await tick();
    assert.equal(bodies.length, 2); assert.equal(bodies[1].revision, 1); assert.equal(bodies[1].value, 2);
    releases.shift()(); assert.deepEqual(await Promise.all([a, b, flushed]), [true, true, true]);
});
test('network and 500 failures are visible and explicitly retryable', async () => {
    let attempts = 0, states = [];
    const storage = create({ capture: () => ({}), onStatus: s => states.push(s.state), post: async body => {
        attempts++; if (attempts === 1) throw new Error('offline');
        if (attempts === 2) return { ok: false, status: 500 };
        return ack(body.revision + 1);
    } });
    storage.initialize(0);
    assert.equal(await storage.save({ immediate: true }), false);
    assert.equal(await storage.save({ immediate: true }), false);
    assert.equal(await storage.save({ immediate: true }), true);
    assert.equal(states.filter(s => s === 'error').length, 2);
});
test('409 blocks further writes until a successful reload', async () => {
    let calls = 0;
    const storage = create({ capture: () => ({}), post: async body => { calls++; return calls === 1 ? { ok: false, status: 409 } : ack(body.revision + 1); } });
    storage.initialize(0);
    assert.equal(await storage.save({ immediate: true }), false);
    assert.equal(await storage.save({ immediate: true }), false); assert.equal(calls, 1);
    storage.initialize(3); assert.equal(await storage.save({ immediate: true }), true);
});
test('missing or incorrect acknowledgment never reports success', async () => {
    const storage = create({ capture: () => ({}), post: async () => ({ ok: true, json: async () => ({ status: 'ok' }) }) });
    storage.initialize(0); assert.equal(await storage.save({ immediate: true }), false);
    assert.equal(storage.getState().blocked, true); assert.equal(storage.getState().revision, 0);
});
