(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function create({ capture, post, onStatus = () => {}, debounceMs = 500 }) {
        let ready = false, blocked = false, revision = null, timer = null;
        let running = false, dirty = false, sequence = 0, waiters = [];
        function status(state, message = '') { onStatus({ state, message, revision }); }
        function settle(upTo, ok) {
            const done = waiters.filter(w => w.sequence <= upTo);
            waiters = waiters.filter(w => w.sequence > upTo);
            done.forEach(w => w.resolve(ok));
        }
        async function drain() {
            clearTimeout(timer); timer = null;
            if (running || !dirty || !ready || blocked) return;
            running = true;
            while (dirty && ready && !blocked) {
                const target = sequence;
                dirty = false;
                status('saving');
                try {
                    // Clone before sending: later UI changes cannot change an in-flight body.
                    const payload = JSON.parse(JSON.stringify(capture()));
                    const response = await post({ ...payload, revision });
                    if (!response.ok) {
                        const error = new Error(response.status === 409 ? '雲端資料已更新，請先備份本機內容再重新載入。' : `儲存失敗（HTTP ${response.status}），請重試。`);
                        error.conflict = response.status === 409;
                        throw error;
                    }
                    const ack = await response.json();
                    if (ack.status !== 'ok' || ack.revision !== revision + 1) {
                        const error = new Error('無法確認雲端儲存結果，請先備份本機內容再重新載入。');
                        error.conflict = true;
                        throw error;
                    }
                    revision = ack.revision;
                    settle(target, true);
                    if (!dirty) status('saved');
                } catch (error) {
                    dirty = true;
                    blocked = Boolean(error.conflict);
                    settle(sequence, false);
                    status(blocked ? 'conflict' : 'error', error.message || '網路連線失敗，請重試儲存。');
                    break; // A retry is explicit; never spin on a failing connection.
                }
            }
            running = false;
        }
        function save({ immediate = false } = {}) {
            if (!ready || blocked) {
                status(blocked ? 'conflict' : 'unloaded', blocked ? '請先備份本機內容再重新載入雲端資料。' : '尚未成功載入雲端資料，暫停儲存。');
                return Promise.resolve(false);
            }
            dirty = true;
            const promise = new Promise(resolve => waiters.push({ sequence: ++sequence, resolve }));
            clearTimeout(timer);
            if (immediate) void drain();
            else timer = setTimeout(drain, debounceMs);
            return promise;
        }
        return {
            save,
            flush() { return dirty || running ? save({ immediate: true }) : Promise.resolve(ready && !blocked); },
            invalidate() {
                ready = false; clearTimeout(timer); timer = null;
                settle(sequence, false);
                status('unloaded');
            },
            initialize(value) {
                if (running) throw new Error('Cannot initialize while a save is running');
                if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid cloud revision');
                clearTimeout(timer); timer = null;
                settle(sequence, false); dirty = false; blocked = false; ready = true; revision = value;
                status('loaded');
            },
            getState() { return { ready, blocked, revision, running, dirty }; }
        };
    }
    return { create };
});
