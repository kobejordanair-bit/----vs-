'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM, root, boot, tick, until, click, change, roster, synthetic } = require('./helpers/world-dom.cjs');
const run = (name, fn) => test(name, { skip: !JSDOM && 'Set JSDOM_MODULE for DOM tests' }, fn);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const originalContents = () => [{ role: 'user', parts: [{ text: '原始請求' }] }, { role: 'model', parts: [{ text: '原始回覆' }] }];
const material = contents => { const text = contents[0].parts[0].text; return JSON.parse(text.slice(text.indexOf('\n') + 1)); };
async function selectQuote(ui, start = 0, end = 12) {
  const area = ui.document.querySelector('#w-analysis-text');
  area.setSelectionRange(start, end);
  area.dispatchEvent(new ui.window.Event('select', { bubbles: true }));
  ui.document.querySelector('#w-interpretation').value = '玩家的合成解讀';
  ui.document.querySelector('#w-principle').value = 'care';
  return area.value.slice(start, end);
}

run('shared AI background is opt-in; disabled mode clones history and loads no source package', async () => {
  const ui = await boot(); try {
    const contents = originalContents();
    const result = await ui.window.DynastyWorldUI.prepareContents(contents);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), contents);
    result[0].parts[0].text = 'copy edited';
    assert.equal(contents[0].parts[0].text, '原始請求');
    assert(!ui.requests.some(request => request.url.includes('/history/')));
    assert.equal(ui.narratives.length, 0);
  } finally { ui.close(); }
});

run('structured original analysis is readable in full and exact-ID source links stay distinct', async () => {
  const rows = synthetic.map(record => ({ ...record, name: '同名<img src=x onerror=alert(1)>' }));
  rows[1].analysis = { 開頭: '完整論證甲', 末尾: '完整論證乙'.repeat(8000) };
  const ui = await boot({ records: rows }); try {
    await roster(ui, ['synthetic-alpha', 'synthetic-beta']);
    const area = ui.document.querySelector('#w-analysis-text');
    assert(area.value.includes('完整論證甲'));
    assert(area.value.includes('完整論證乙'.repeat(8000)));
    assert.equal(ui.document.querySelectorAll('#world-workbench img').length, 0);
    assert.match(ui.document.querySelector('#w-content').textContent, /角色與場景關係為創作設定/);
    const links = [...ui.document.querySelectorAll('a[href]')].map(link => link.getAttribute('href'));
    assert(links.includes('/source-archive#tab=people&person=synthetic-beta'));
    await change(ui, '#w-focus-person', 'synthetic-alpha');
    assert.equal(ui.document.querySelector('#w-analysis-text').value, synthetic[0].deepAnalysis);
    assert([...ui.document.querySelectorAll('a[href]')].some(link => link.getAttribute('href') === '/source-archive#tab=people&person=synthetic-alpha'));
  } finally { ui.close(); }
});

run('selected original quote, principle and editable interpretation persist without replacing the article', async () => {
  const ui = await boot(); try {
    await roster(ui, ['synthetic-alpha']);
    const quote = await selectQuote(ui);
    await click(ui, '[data-action="add-anchor"]');
    const anchor = ui.workspace().selection.anchors[0];
    assert.equal(anchor.recordId, 'synthetic-alpha');
    assert.equal(anchor.quote, quote);
    assert.equal(anchor.field, 'deepAnalysis');
    assert.equal(anchor.principle, 'care');
    assert.equal(anchor.interpretation, '玩家的合成解讀');
    assert.equal(ui.document.querySelector('#w-analysis-text').value, synthetic[0].deepAnalysis);
    await change(ui, '#w-context-enabled', true);
    const contents = originalContents(), before = JSON.stringify(contents);
    const prepared = await ui.window.DynastyWorldUI.prepareContents(contents);
    assert.equal(JSON.stringify(contents), before);
    assert.equal(prepared.length, contents.length + 1);
    assert(prepared[0].parts[0].text.length <= 12000);
    assert.equal(material(prepared).anchors[0].quote, quote);
    assert.equal(material(prepared).anchors[0].principle, 'care');
    assert.equal(ui.narratives.length, 0);
  } finally { ui.close(); }
});

run('an equal-length article edit invalidates a stored quote and refreshes cached AI material', async () => {
  const ui = await boot(); try {
    await roster(ui, ['synthetic-alpha']); await selectQuote(ui);
    await click(ui, '[data-action="add-anchor"]'); await change(ui, '#w-context-enabled', true);
    const first = material(await ui.window.DynastyWorldUI.prepareContents(originalContents()));
    assert.equal(first.anchors.length, 1);
    const changed = synthetic.map(record => ({ ...record }));
    changed[0].deepAnalysis = '新的合成論證內容'.repeat(7).slice(0, synthetic[0].deepAnalysis.length);
    ui.setRecords(changed);
    const next = material(await ui.window.DynastyWorldUI.prepareContents(originalContents()));
    assert.equal(next.anchors.length, 0);
    assert.equal(next.profiles[0].analysis[0].excerpt, changed[0].deepAnalysis);
    await ui.window.DynastyWorldUI.open('setup');
    assert.match(ui.document.querySelector('#w-content').textContent, /錨點已失效/);
  } finally { ui.close(); }
});

run('attempting to quote a stale reader or a ninth person anchor leaves existing selections intact', async () => {
  const ui = await boot(); try {
    await roster(ui, ['synthetic-alpha']); await selectQuote(ui);
    const changed = synthetic.map(record => ({ ...record })); changed[0].deepAnalysis = '人物原文剛更新。'; ui.setRecords(changed);
    await click(ui, '[data-action="add-anchor"]');
    assert.equal(ui.workspace().selection.anchors.length, 0);
    assert.match(ui.document.querySelector('#w-notice').textContent, /原人物分析已更新/);
    ui.setRecords(synthetic); await ui.window.DynastyWorldUI.open('setup');
    for (let index = 0; index < 8; index++) { await selectQuote(ui); await click(ui, '[data-action="add-anchor"]'); }
    assert.equal(ui.workspace().selection.anchors.length, 8);
    await selectQuote(ui); await click(ui, '[data-action="add-anchor"]');
    assert.equal(ui.workspace().selection.anchors.length, 8);
    assert.match(ui.document.querySelector('#w-notice').textContent, /每位人物最多.*8/);
  } finally { ui.close(); }
});

run('every original feature card forwards its action and exact selected IDs', async () => {
  const ui = await boot(); try {
    await roster(ui, ['synthetic-alpha', 'synthetic-beta']);
    for (const action of ['analysis', 'chat', 'compare', 'hegemony', 'soul', 'soul-deep', 'saves', 'debate', 'court', 'scenes', 'snapshot', 'chronicle', 'stats', 'add', 'edit']) {
      await ui.window.DynastyWorldUI.open();
      await click(ui, '[data-action="legacy"][data-legacy="' + action + '"]');
      const call = ui.legacy.at(-1);
      assert.equal(call.action, action);
      assert.deepEqual(Array.from(call.ids), ['synthetic-alpha', 'synthetic-beta']);
      assert.equal(ui.document.querySelector('#world-workbench').hidden, true);
    }
    assert.equal(ui.narratives.length, 0);
  } finally { ui.close(); }
});

run('missing imported IDs stay visible and removable, and block world creation and shared AI material', async () => {
  const cloud = require('../backend/static/js/world-storage.js').emptyWorkspace();
  cloud.selection.recordIds = ['missing-on-device', 'synthetic-alpha', 'synthetic-beta'];
  cloud.selection.enabled = true;
  const ui = await boot({ cloud });
  try {
    await ui.window.DynastyWorldUI.open('setup');
    assert.match(ui.document.querySelector('#w-content').textContent, /已選 3 \/ 12 位（可用 2 位）/);
    assert.match(ui.document.querySelector('#w-content').textContent, /本庫未找到 · missing-on-device/);
    assert.equal(ui.document.querySelector('#w-focus-person').value, 'synthetic-alpha');
    assert.equal(ui.document.querySelector('#w-analysis-text').value, synthetic[0].deepAnalysis);
    await click(ui, '[data-action="create"]');
    assert.match(ui.document.querySelector('#w-notice').textContent, /找不到 ID：missing-on-device/);
    assert.equal(ui.workspace().sessions.length, 0);
    await assert.rejects(ui.window.DynastyWorldUI.prepareContents(originalContents()), /找不到 ID：missing-on-device/);
    assert.equal(ui.requests.filter(request => request.url.includes('/history/')).length, 0);
    await click(ui, '[data-action="remove-person"][data-id="missing-on-device"]');
    assert.deepEqual(ui.workspace().selection.recordIds, ['synthetic-alpha', 'synthetic-beta']);
    assert.equal(ui.document.querySelector('[data-action="remove-person"][data-id="missing-on-device"]'), null);
    const context = material(await ui.window.DynastyWorldUI.prepareContents(originalContents()));
    assert.deepEqual(Array.from(context.profiles, profile => profile.recordId), ['synthetic-alpha', 'synthetic-beta']);
    await click(ui, '[data-action="create"]');
    assert.equal(ui.workspace().sessions.length, 1);
  } finally { ui.close(); }
});

run('failed legacy navigation keeps the workspace and its error visible', async () => {
  const ui = await boot({ adapters: { launchLegacy: async () => { throw Error('目前尚未載入人物資料'); } } });
  try {
    await click(ui, '[data-action="legacy"][data-legacy="stats"]');
    assert.equal(ui.document.querySelector('#world-workbench').hidden, false);
    assert.equal(ui.document.querySelector('#outside').inert, true);
    assert.match(ui.document.querySelector('#w-notice').textContent, /尚未載入人物資料/);
  } finally { ui.close(); }
});

run('failed main restore handoff preserves the visible workspace import preview', async () => {
  const ui = await boot({ adapters: { restoreMain: async () => { throw Error('目前正在生成，請稍後還原'); } } });
  try {
    await ui.window.DynastyWorldUI.open('backup');
    const input = ui.document.querySelector('#w-vault-file');
    const backup = ui.window.DynastyBackup.createBackup(ui.window.DynastyBackup.emptyData());
    const raw = JSON.stringify(backup);
    Object.defineProperty(input, 'files', { value: [{ name: 'main.json', size: Buffer.byteLength(raw), text: async () => raw }] });
    input.dispatchEvent(new ui.window.Event('change', { bubbles: true }));
    await until(() => !ui.document.querySelector('#world-workbench').hasAttribute('aria-busy'));
    await click(ui, '[data-action="restore-main"]');
    assert.equal(ui.document.querySelector('#world-workbench').hidden, false);
    assert.match(ui.document.querySelector('#w-notice').textContent, /目前正在生成/);
    assert(ui.document.querySelector('[data-action="restore-main"]'));
    assert.equal(ui.requests.filter(request => request.options.method === 'POST').length, 0);
  } finally { ui.close(); }
});

run('two simultaneous legacy AI requests share one resolved source read without stale-result errors', async () => {
  const gate = deferred(); let hold = false;
  const ui = await boot({ fetchHook: async url => { if (hold && url.endsWith('/web/manifest.json')) await gate.promise; } });
  try {
    await roster(ui, ['synthetic-alpha']); await change(ui, '#w-context-enabled', true); hold = true;
    const a = ui.window.DynastyWorldUI.prepareContents(originalContents());
    const b = ui.window.DynastyWorldUI.prepareContents(originalContents());
    await until(() => ui.requests.some(request => request.url.endsWith('/web/manifest.json')));
    gate.resolve();
    const [first, second] = await Promise.all([a, b]);
    assert.equal(first[0].parts[0].text, second[0].parts[0].text);
    assert.equal(ui.requests.filter(request => request.url.endsWith('/web/manifest.json')).length, 1);
  } finally { gate.resolve(); ui.close(); }
});

run('changing selected scene while sources load rejects old AI material', async () => {
  const gate = deferred(); let hold = false;
  const ui = await boot({ fetchHook: async url => { if (hold && url.endsWith('/web/manifest.json')) await gate.promise; } });
  try {
    await roster(ui, ['synthetic-alpha']); await change(ui, '#w-context-enabled', true); hold = true;
    const pending = ui.window.DynastyWorldUI.prepareContents(originalContents());
    const rejected = assert.rejects(pending, /共用選角或原人物資料已更新/);
    await until(() => ui.requests.some(request => request.url.endsWith('/web/manifest.json')));
    await change(ui, '#w-notes', '新的局勢設定');
    gate.resolve(); await rejected;
    const next = material(await ui.window.DynastyWorldUI.prepareContents(originalContents()));
    assert.equal(next.notes, '新的局勢設定');
  } finally { gate.resolve(); ui.close(); }
});

run('AI background waits for a persisted enabled selection during initial cloud loading', async () => {
  const gate = deferred(); let earlyWindow;
  const cloud = { format: 'dynasty-world-workspace', schemaVersion: 1, sessions: [], activeSessionId: null, selection: { enabled: true, setting: { kind: 'free', eventId: '', placeIds: [], factionIds: [] }, recordIds: ['synthetic-alpha'], anchors: [], notes: '已保存背景' } };
  const opening = boot({ cloud, fetchHook: async (url, options, window) => { if (url === '/api/world-workspace' && !options.method) { earlyWindow = window; await gate.promise; } } });
  await until(() => earlyWindow);
  let completed = false;
  const prepared = earlyWindow.DynastyWorldUI.prepareContents(originalContents()).then(value => { completed = true; return value; });
  await tick(); assert.equal(completed, false);
  gate.resolve();
  const ui = await opening;
  try { assert.equal(material(await prepared).notes, '已保存背景'); } finally { ui.close(); }
});

run('primary cloud conflict still permits a complete read-only backup through the workspace', async () => {
  const ui = await boot({ adapters: { isReady: () => false, canBackup: () => true } });
  try {
    await ui.window.DynastyWorldUI.open('backup');
    await click(ui, '[data-action="export-all"]');
    assert.equal(ui.downloads.length, 1, ui.document.querySelector('#w-notice').textContent);
    const bundle = JSON.parse(ui.downloads[0].parts[0]);
    assert.equal(bundle.format, 'dynasty-workspace-vault');
  } finally { ui.close(); }
});

run('actual tracked stream wrapper narrates frozen world A without injecting next-world B selection', async () => {
  let ui, sent;
  ui = await boot({ adapters: { narrate: (prompt, onChunk) => ui.window.actualWorldNarrate(prompt, onChunk) } });
  try {
    const w = ui.window;
    const html = fs.readFileSync(path.join(root, 'backend/index.html'), 'utf8');
    const networkSource = html.slice(html.indexOf('async function prepareWorldRequestContents'), html.indexOf('\nfunction openSnapshot()'));
    const persistence = fs.readFileSync(path.join(root, 'backend/static/js/persistence.js'), 'utf8');
    const wrappers = persistence.slice(persistence.indexOf('async function runTrackedAI(action)'));
    w.cloneState = value => w.JSON.parse(w.JSON.stringify(value));
    w.BACKEND_URL = 'http://qa.test'; w.APP_TOKEN = 'qa-only';
    w.restoreLock = false; w.activeAiRequests = 0; w.cloudStore = { getState: () => ({ ready: true, blocked: false }) };
    w.eval(networkSource); w.eval(wrappers);
    const adapter = html.match(/narrate: \(prompt, onChunk\) => ([^\n]+)/)[1];
    w.eval('globalThis.actualWorldNarrate = (prompt,onChunk) => ' + adapter + ';');
    const originalFetch = w.fetch;
    w.fetch = async (url, options = {}) => {
      if (!String(url).endsWith('/api/gemini/stream')) return originalFetch(url, options);
      sent = JSON.parse(options.body);
      assert.equal(w.activeAiRequests, 1);
      let read = false;
      const bytes = new TextEncoder().encode('data: {"text":"僅依凍結世界補寫敘事"}\ndata: [DONE]\n');
      return { ok: true, body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { done: false, value: bytes }) }) } };
    };
    await roster(ui, ['synthetic-alpha', 'synthetic-beta']); await click(ui, '[data-action="create"]'); await click(ui, '#w-resolve');
    await click(ui, '[data-action="goto-setup"]');
    await change(ui, '[data-person="synthetic-alpha"]', false); await change(ui, '[data-person="synthetic-gamma"]', true); await change(ui, '#w-context-enabled', true);
    await click(ui, '[data-view="game"]'); await click(ui, '[data-action="narrate"]');
    assert.equal(sent.contents.length, 1, 'No second global-selection material message');
    assert(sent.contents[0].parts[0].text.includes('synthetic-alpha'));
    assert(!sent.contents[0].parts[0].text.includes('synthetic-gamma'));
    assert.equal(w.activeAiRequests, 0);
    assert.equal(ui.workspace().sessions[0].narratives.at(-1).text, '僅依凍結世界補寫敘事');
  } finally { ui.close(); }
});
