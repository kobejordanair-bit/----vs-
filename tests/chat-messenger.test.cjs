'use strict';

// Public DOM behavior checks. Supply JSDOM_MODULE when jsdom is not on NODE_PATH.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom')); } catch (_) {}

const app = path.resolve(__dirname, '..');
const htmlPath = path.join(app, 'backend/index.html');
const scriptPath = path.join(app, 'backend/static/js/chat-messenger.js');
const run = (title, fn) => test(title, {
    skip: !JSDOM && 'Install jsdom or set JSDOM_MODULE for DOM integration checks.'
}, fn);
const copy = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function boot(options = {}) {
    // Use the production modal markup so missing controls and incorrect IDs fail here.
    const page = new JSDOM(fs.readFileSync(htmlPath, 'utf8'));
    const container = page.window.document.getElementById('chatContainer');
    assert.ok(container, 'The page must contain its messenger UI.');
    const modal = page.window.document.getElementById('aiModal');
    assert.ok(modal, 'The messenger must belong to the page modal.');
    const shell = modal.cloneNode(false);
    shell.appendChild(container.cloneNode(true));
    const markup = shell.outerHTML;
    page.window.close();
    const dom = new JSDOM(markup, { url: 'http://localhost/', runScripts: 'outside-only' });
    const { window } = dom;
    const { document } = window;
    const state = {
        chatMode: { targetId: null },
        chatHistories: copy(options.histories || {}),
        modifiedLegends: {},
        settings: {}
    };
    const legends = options.legends || [
        { id: 'alpha', name: '韓信', title: '大將軍', dynasty: '漢', type: 'general', tag: '善用兵', desc: '善於審勢與用兵。', rank: 'S' },
        { id: 'beta', name: '張良', title: '留侯', dynasty: '漢', type: 'minister', tag: '善謀', desc: '善於謀略與進言。', rank: 'S' }
    ];
    const requests = [], persisted = [], confirmations = [], modalCalls = [], markdownCalls = [];
    let closes = 0;
    const markdown = text => {
        markdownCalls.push(String(text));
        const span = document.createElement('span');
        span.textContent = String(text);
        return span.innerHTML.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    };
    window.HTMLElement.prototype.scrollIntoView = function () {};
    vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), dom.getInternalVMContext());
    assert.equal(typeof window.DynastyMessenger?.create, 'function');
    let messenger;
    messenger = window.DynastyMessenger.create({
        getState: () => state,
        getLegends: () => legends,
        openModal: (...args) => {
            modalCalls.push(args);
            document.getElementById('aiModal').classList.remove('hidden');
            document.getElementById('chatContainer').classList.remove('hidden');
        },
        closeModal: () => {
            closes += 1;
            document.getElementById('aiModal').classList.add('hidden');
            messenger.closed();
        },
        markdown,
        sanitize: text => text,
        persist: () => { persisted.push(copy(state.chatHistories)); },
        generate: contents => {
            const request = deferred();
            requests.push({ ...request, contents: copy(contents) });
            return request.promise;
        },
        confirm: (message, callback) => { confirmations.push({ message, callback }); },
        showProfile: () => {}
    });
    const input = document.getElementById('chatInput');
    const history = document.getElementById('chatHistory');
    assert.equal(input.tagName, 'TEXTAREA', 'The composer must support multiline messages.');
    return {
        dom, window, document, state, legends, messenger, requests, persisted,
        confirmations, modalCalls, markdownCalls, input, history,
        get closes() { return closes; },
        send(text) { input.value = text; return messenger.send(); },
        close() { window.close(); }
    };
}

run('switching contacts saves each pending reply to its originating thread and keeps the visible thread intact', async () => {
    const ui = boot();
    try {
        ui.messenger.open('alpha');
        assert.equal(ui.state.chatHistories.alpha.length, 1);
        assert.equal(ui.state.chatHistories.alpha[0].role, 'model');
        assert.ok(ui.persisted.length, 'The initial greeting is saved.');
        const first = ui.send('甲的問題');
        assert.equal(ui.requests.length, 1);
        assert.equal(ui.state.chatHistories.alpha.at(-1).content, '甲的問題');

        ui.messenger.open('beta');
        const second = ui.send('乙的問題');
        assert.equal(ui.requests.length, 2, 'A different contact can send while the first is waiting.');
        assert.doesNotMatch(ui.history.textContent, /甲的問題/);

        ui.requests[0].resolve('甲的回覆');
        await first;
        await flush();
        assert.equal(ui.state.chatHistories.alpha.at(-1).content, '甲的回覆');
        assert.equal(ui.persisted.at(-1).alpha.at(-1).content, '甲的回覆');
        assert.doesNotMatch(ui.history.textContent, /甲的回覆/);
        assert.equal(ui.document.getElementById('messengerThreadName').textContent, '張良');
        assert.equal(ui.document.getElementById('messengerSend').disabled, true,
            'Completing another contact must not clear this contact\'s pending state.');

        ui.requests[1].resolve('乙的回覆');
        await second;
        assert.equal(ui.state.chatHistories.beta.at(-1).content, '乙的回覆');
        assert.match(ui.history.textContent, /乙的回覆/);
        ui.messenger.open('alpha');
        assert.match(ui.history.textContent, /甲的回覆/);
        assert.doesNotMatch(ui.history.textContent, /乙的回覆/);
    } finally { ui.close(); }
});

run('a reply completed after closing is saved and restored without changing the closed view', async () => {
    const ui = boot();
    try {
        ui.messenger.open('alpha');
        const pending = ui.send('關閉前的問題');
        ui.document.getElementById('messengerClose').click();
        assert.equal(ui.closes, 1);
        const closedMarkup = ui.history.innerHTML;
        ui.requests[0].resolve('關閉後收到的回覆');
        await pending;
        await flush();
        assert.equal(ui.state.chatHistories.alpha.at(-1).content, '關閉後收到的回覆');
        assert.equal(ui.persisted.at(-1).alpha.at(-1).content, '關閉後收到的回覆');
        assert.equal(ui.history.innerHTML, closedMarkup);
        ui.messenger.open('alpha');
        assert.match(ui.history.textContent, /關閉後收到的回覆/);
    } finally { ui.close(); }
});

run('repeated sends to a waiting contact create only one request and one saved user message', async () => {
    const ui = boot();
    try {
        ui.messenger.open('alpha');
        const first = ui.send('第一則訊息');
        const repeated = ui.send('尚未送出的草稿');
        assert.equal(ui.requests.length, 1);
        assert.deepEqual(copy(ui.state.chatHistories.alpha.filter(message => message.role === 'user').map(message => message.content)), ['第一則訊息']);
        ui.requests[0].resolve('回覆第一則');
        await Promise.all([first, repeated]);
        assert.equal(ui.state.chatHistories.alpha.filter(message => message.content === '回覆第一則').length, 1);
        assert.equal(ui.document.getElementById('messengerSend').disabled, false);
    } finally { ui.close(); }
});

run('resetting memory invalidates a pending reply and allows a fresh message before it finishes', async () => {
    const ui = boot();
    try {
        ui.messenger.open('alpha');
        const stale = ui.send('將被重置的問題');
        ui.messenger.clear();
        assert.equal(ui.confirmations.length, 1);
        assert.ok(ui.state.chatHistories.alpha.some(message => message.content === '將被重置的問題'),
            'Opening the confirmation must leave history intact.');
        ui.confirmations[0].callback();
        assert.ok(!(ui.state.chatHistories.alpha || []).some(message => message.content === '將被重置的問題'));
        assert.doesNotMatch(ui.history.textContent, /將被重置的問題/);

        const fresh = ui.send('重置後的新問題');
        assert.equal(ui.requests.length, 2, 'A discarded request cannot lock the new conversation.');
        ui.requests[0].resolve('不應復活的舊回覆');
        await stale;
        await flush();
        assert.ok(!(ui.state.chatHistories.alpha || []).some(message => message.content === '不應復活的舊回覆'));
        assert.doesNotMatch(ui.history.textContent, /不應復活的舊回覆/);
        assert.equal(ui.document.getElementById('messengerSend').disabled, true,
            'The stale completion cannot release the new request.');

        ui.requests[1].resolve('新回覆');
        await fresh;
        assert.match(ui.history.textContent, /新回覆/);
        assert.equal(ui.state.chatHistories.alpha.at(-1).content, '新回覆');
    } finally { ui.close(); }
});

run('a delayed reset confirmation clears the contact that requested it, even after switching targets', async () => {
    const ui = boot({ histories: { beta: [{ role: 'model', content: '乙原本的記憶' }] } });
    try {
        ui.messenger.open('alpha');
        const stale = ui.send('甲待重置的問題');
        ui.messenger.clear();
        ui.messenger.open('beta');
        const betaBefore = copy(ui.state.chatHistories.beta);
        const visibleBefore = ui.history.innerHTML;
        ui.confirmations[0].callback();
        assert.deepEqual(copy(ui.state.chatHistories.beta), betaBefore);
        assert.equal(ui.history.innerHTML, visibleBefore);
        assert.ok(!(ui.state.chatHistories.alpha || []).some(message => message.content === '甲待重置的問題'));
        assert.equal(ui.document.getElementById('messengerThreadName').textContent, '張良');

        ui.requests[0].resolve('已重置的甲回覆');
        await stale;
        assert.deepEqual(copy(ui.state.chatHistories.beta), betaBefore);
        assert.ok(!(ui.state.chatHistories.alpha || []).some(message => message.content === '已重置的甲回覆'));
        assert.doesNotMatch(ui.history.textContent, /已重置的甲回覆/);
    } finally { ui.close(); }
});

run('opening legacy history without timestamps preserves every message and does not add another greeting', () => {
    const history = [
        { role: 'model', content: '舊的問候' },
        { role: 'user', content: '舊的問題' },
        { role: 'model', content: '**舊的回覆**' }
    ];
    const ui = boot({ histories: { alpha: history } });
    try {
        ui.messenger.open('alpha');
        ui.messenger.open('beta');
        ui.messenger.open('alpha');
        assert.deepEqual(copy(ui.state.chatHistories.alpha), history);
        for (const message of history) assert.ok(ui.history.textContent.includes(message.content.replace(/\*\*/g, '')));
        assert.ok([...ui.history.querySelectorAll('strong')].some(node => node.textContent === '舊的回覆'));
    } finally { ui.close(); }
});

run('names and user text stay literal while model replies use the supplied safe markdown renderer', async () => {
    const name = '<img data-xss="name" src=x onerror=alert(1)>';
    const userText = '<img data-xss="user" src=x onerror=alert(1)> **文字** &';
    const ui = boot({ legends: [{ id: 'alpha', name, title: '將軍', dynasty: '漢', type: 'general', tag: '沉著', desc: '人物簡介' }] });
    try {
        ui.messenger.open('alpha');
        assert.equal(ui.document.getElementById('messengerThreadName').textContent, name);
        assert.ok(ui.document.getElementById('messengerContacts').textContent.includes(name));
        const pending = ui.send(userText);
        assert.ok(ui.history.textContent.includes(userText));
        assert.ok(!ui.markdownCalls.includes(userText), 'User text must not be interpreted as markdown.');
        assert.equal(ui.document.querySelector('[data-xss]'), null);
        ui.requests[0].resolve('**可格式化的模型回覆**');
        await pending;
        assert.ok(ui.markdownCalls.includes('**可格式化的模型回覆**'));
        assert.ok([...ui.history.querySelectorAll('strong')].some(node => node.textContent === '可格式化的模型回覆'));
        assert.equal(ui.document.querySelector('[data-xss]'), null);
    } finally { ui.close(); }
});

run('Enter respects IME composition and Shift while ordinary Enter sends once', async () => {
    const ui = boot();
    try {
        ui.messenger.open('alpha');
        ui.input.value = '輸入法選字中的訊息';
        const key = options => ui.input.dispatchEvent(new ui.window.KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true, cancelable: true, ...options
        }));
        key({ isComposing: true });
        key({ keyCode: 229 });
        key({ shiftKey: true });
        assert.equal(ui.requests.length, 0);
        assert.equal(ui.input.value, '輸入法選字中的訊息');

        const enter = new ui.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        ui.input.dispatchEvent(enter);
        assert.equal(enter.defaultPrevented, true);
        assert.equal(ui.requests.length, 1);
        assert.equal(ui.state.chatHistories.alpha.at(-1).content, '輸入法選字中的訊息');
        ui.requests[0].resolve('鍵盤送出的回覆');
        await flush();
        assert.match(ui.history.textContent, /鍵盤送出的回覆/);
    } finally { ui.close(); }
});
