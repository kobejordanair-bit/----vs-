/* Public source catalogue. Content stays in the browser; no model or account API is used. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const DATA_URL = '/static/data/history/web/manifest.json';
  const PACKAGE_URL = '/static/data/history/chuhan-foundation.v1.json';
  const PAGE_SIZE = 24;
  const MODES = ['people', 'sources', 'texts', 'coverage'];
  const TYPE_LABELS = { emperor: '帝王', general: '將領', minister: '文臣' };
  const SOURCE_TYPES = { 'primary-text-index': '史籍全文目錄', 'authority-database': '人物權威資料庫', 'historical-gazetteer': '歷史地名資料', 'institutional-text-database': '機構文獻資料庫', 'museum-archive': '博物館典藏', 'institutional-archive': '機構檔案館', 'library-catalog': '圖書館書目', 'institutional-biography': '機構人物傳記', 'institutional-reference': '機構參考資料', 'primary-text': '史籍篇章' };
  const ACCESS_LABELS = { open: '開放查閱', 'open-metadata-restricted-data': '書目開放，部分資料另有條件', 'open-portal': '開放入口', 'portal-and-subscription': '入口與訂閱內容並存', 'manual-or-authorized-api': '依網站介面或授權 API 查閱' };
  const REUSE_LABELS = { 'public-domain-original-with-platform-terms': '古代原著與平台貢獻須分別看待', 'edition-dependent': '依版本決定', 'restricted-versioned': '有版本與再利用限制', 'not-cleared-for-redistribution': '未確認全文散布權限', 'restricted-access': '存取有限制', 'item-specific': '依單件資料說明', 'link-and-paraphrase-only': '僅保留連結與自寫摘要', 'source-specific': '依各來源規則' };
  const IDENTITY_LABELS = { reviewed: '已核讀身份', candidate: '百科候選線索', ambiguous: '身份尚有歧義', unresolved: '尚待來源線索' };
  const STATUS_LABELS = { downloaded: '已取得全文', complete: '已取得全文', archived: '已取得全文', success: '取得成功', ok: '可用', partial: '部分取得', failed: '取得失敗', error: '取得失敗', 'not-found': '未找到頁面', missing: '尚未取得', unavailable: '目前無法取得', pending: '待取得', listed: '已列書目', candidate: '候選線索', reviewed: '已核對', verified: '已核對', unresolved: '待查', ambiguous: '有歧義', 'metadata-only': '僅有書目', 'not-attempted': '尚未嘗試取得', opened: '書目入口已讀', 'identity-supported': '身份命題有來源支持', 'correction-proposed': '提出名稱修正', 'layer-separation': '史傳與敘事分層', 'unresolved-identity': '身份仍待核', 'limited-claim-reviewed': '限定命題已核讀', incomplete: '轉錄不完整' };
  let data = null;
  let historical = null;
  let historicalPromise = null;
  let maps = {};
  let toastTimer;
  let modalReturn = null;
  let currentModal = null;
  let searchController = null;
  let readerController = null;
  let loadGeneration = 0;
  let documentCatalogPromise = null;
  let searchWorker = null;
  let workerReady = null;
  let workerReadyResolve = null;
  let workerReadyReject = null;
  let searchRequest = 0;
  let workerInitId = 0;
  let searchJob = null;
  let snippetGeneration = 0;
  let snippetController = null;
  let catalogLoaded = false;
  const personCache = new Map();
  const contentCache = new Map();
  const bookCache = new Map();
  const state = { tab: 'people', query: '', type: '', dynasty: '', coverage: '', page: 1, sourceQuery: '', sourceType: '', sourceStatus: '', sourcePage: 1, bookId: '', textQuery: '', allBooks: false, searchResults: null, searchSummary: '', searchRunning: false, searchPage: 1, searchMeta: null };

  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined && text !== null) node.textContent = String(text); return node; }
  function append(parent, ...nodes) { nodes.filter(Boolean).forEach(node => parent.appendChild(node)); return parent; }
  function array(value) { return Array.isArray(value) ? value : []; }
  function str(value) { return value === undefined || value === null ? '' : String(value); }
  function normal(value) { return str(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }
  function count(value) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-Hant') : '0'; }
  function textOf(value) { if (!value) return ''; if (typeof value === 'string') return value; if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('；'); return Object.entries(value).filter(([, item]) => item !== null && item !== '').map(([key, item]) => ['notes', 'note', 'label', 'status', 'mode'].includes(key) ? textOf(item) : `${key}：${textOf(item)}`).join('；'); }
  function link(label, value) { try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol)) return null; const a = el('a', '', label || url.hostname); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; } catch (_) { return null; } }
  function action(label, fn, primary) { const button = el('button', `ar-button${primary ? ' ar-button-primary' : ''}`, label); button.type = 'button'; button.addEventListener('click', fn); return button; }
  function badge(label, tone) { const item = el('span', 'ar-badge', label); if (tone) item.dataset.tone = tone; return item; }
  function identityBadge(status) { return badge(IDENTITY_LABELS[status] || '待查身份', status === 'reviewed' ? 'verified' : status === 'unresolved' ? 'missing' : 'lead'); }
  function statusLabel(status) { return STATUS_LABELS[status] || str(status) || '未提供狀態'; }
  function sourceType(value) { return SOURCE_TYPES[value] || value || '來源類型待核'; }
  function sourceName(id) { return maps.sources.get(id)?.title || id; }
  function bookName(id) { return maps.books.get(id)?.title || id; }
  function notice(message) { return el('p', 'ar-notice', message); }
  function note(message) { return el('p', 'ar-note', message); }
  function heading(title, description) { const outer = el('div', 'ar-section-head'); const block = el('div'); append(block, el('h2', '', title), el('p', '', description)); return append(outer, block); }
  function empty(title, description) { return append(el('div', 'ar-empty'), el('h3', '', title), el('p', '', description)); }
  function toast(message) { clearTimeout(toastTimer); $('archiveToast').textContent = message; $('archiveToast').hidden = false; toastTimer = setTimeout(() => { $('archiveToast').hidden = true; }, 4200); }
  function field(label, control) { const wrapper = el('label', 'ar-field'); append(wrapper, el('span', '', label), control); return wrapper; }
  function select(options, value, label, onChange) { const node = el('select'); node.setAttribute('aria-label', label); options.forEach(([val, text]) => { const option = el('option', '', text); option.value = val; node.appendChild(option); }); node.value = value; node.addEventListener('change', () => onChange(node.value)); return node; }
  function searchInput(value, placeholder, onInput) { const node = el('input'); node.type = 'search'; node.value = value; node.placeholder = placeholder; node.maxLength = 160; node.autocomplete = 'off'; node.addEventListener('input', () => onInput(node.value)); return node; }
  function facts(rows) { const dl = el('dl', 'ar-facts'); rows.forEach(([key, value]) => { if (!value) return; append(dl, el('dt', '', key), value instanceof Node ? append(el('dd'), value) : el('dd', '', value)); }); return dl; }
  function download(name, text, mime) { const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast(`已準備下載 ${name}`); }
  function filename(value) { return str(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 90) || 'archive'; }
  function safeLocalPath(value) { if (typeof value !== 'string' || !/^\/static\/data\/history\/web\/releases\/[a-zA-Z0-9._/-]+\.json$/.test(value) || value.includes('..')) throw new Error('資料位置不在這份檔案館的公開目錄內。'); if (data?.version && !value.startsWith('/static/data/history/web/releases/' + data.version + '/')) throw new Error('資料位置與目前檔案館版本不同，請重新整理。'); return value; }
  async function fetchJSON(url, signal) { const response = await fetch(url, { credentials: 'same-origin', signal }); if (!response.ok) throw new Error(`資料讀取失敗（HTTP ${response.status}）`); return response.json(); }
  function registerDocuments(documents) { array(documents).forEach(doc => { if (doc && typeof doc.id === 'string' && typeof doc.bookId === 'string') maps.documents.set(doc.id, doc); }); }
  function metric(person, key) { const fields = { candidates: 'candidatePageCount', claims: 'claimCount', reviews: 'reviewCount', matches: 'matchCount' }; const value = person[fields[key]]; if (Number.isFinite(value)) return value; return array(person[{ candidates: 'candidatePages', claims: 'claimIds', reviews: 'reviewIds', matches: 'matches' }[key]]).length; }
  function rememberContent(key, value) { contentCache.delete(key); contentCache.set(key, value); const size = () => [...contentCache.values()].reduce((sum, entry) => sum + str(entry.text).length + str(entry.wikitext).length + JSON.stringify(entry.transclusions || []).length, 0); while (contentCache.size > 16 || contentCache.size > 1 && size() > 6000000) contentCache.delete(contentCache.keys().next().value); return value; }
  async function loadPerson(stub, signal) { if (personCache.has(stub.recordId)) return personCache.get(stub.recordId); const person = await fetchJSON(safeLocalPath(stub.detailPath), signal); if (person.recordId !== stub.recordId || person.version !== data.version) throw new Error('人物檔案 ID 或版本與目錄不同。'); registerDocuments(person.matchedDocuments); personCache.set(stub.recordId, person); while (personCache.size > 20) personCache.delete(personCache.keys().next().value); return person; }
  async function loadDocumentCatalog() { if (catalogLoaded) return; if (!documentCatalogPromise) documentCatalogPromise = fetchJSON(safeLocalPath(data.documentCatalogPath)).then(value => { if (value.format !== 'dynasty-source-document-catalog' || value.schemaVersion !== 1 || value.version !== data.version || !Array.isArray(value.documents)) throw new Error('篇章目錄版本不符。'); registerDocuments(value.documents); catalogLoaded = true; }).catch(error => { documentCatalogPromise = null; throw error; }); return documentCatalogPromise; }
  async function loadBookDocuments(book, signal) { if (bookCache.has(book.id)) return bookCache.get(book.id); const value = await fetchJSON(safeLocalPath(book.documentsPath), signal); if (value.bookId !== book.id || value.version !== data.version || !Array.isArray(value.documents)) throw new Error('書目篇章與目前版本不同。'); registerDocuments(value.documents); bookCache.set(book.id, value.documents); return value.documents; }
  async function loadDocumentContent(meta, raw, signal) { const path = safeLocalPath(raw ? meta.wikitextPath : meta.textPath); if (contentCache.has(path)) { const value = contentCache.get(path); contentCache.delete(path); contentCache.set(path, value); return value; } const value = await fetchJSON(path, signal); if (value.id !== meta.id || value.version !== data.version || typeof value[raw ? 'wikitext' : 'text'] !== 'string') throw new Error('篇章內容與來源 ID 或版本不同。'); return rememberContent(path, value); }

  function route(params) { const fields = new URLSearchParams(); fields.set('tab', state.tab); if (params) Object.entries(params).forEach(([key, value]) => { if (value) fields.set(key, value); }); history.replaceState(null, '', `${location.pathname}${location.search}#${fields}`); }
  function routeState() { const params = new URLSearchParams(location.hash.replace(/^#/, '')); if (MODES.includes(params.get('tab'))) state.tab = params.get('tab'); return params; }
  function setTab(tab) { if (!MODES.includes(tab)) return; closeDialog(false); if (searchController && tab !== 'texts') searchController.abort(); state.tab = tab; route(); render(); }
  function render() { if (!data) return; document.querySelectorAll('#archiveTabs [role="tab"]').forEach(button => { const active = button.dataset.tab === state.tab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; }); $('archivePanel').setAttribute('aria-labelledby', `archive-tab-${state.tab}`); $('archivePanel').replaceChildren(); ({ people: renderPeople, sources: renderSources, texts: renderTexts, coverage: renderCoverage }[state.tab])(); }
  function pagination(parent, total, page, update) { const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)); const controls = el('nav', 'ar-pagination'); controls.setAttribute('aria-label', '結果分頁'); const previous = action('上一頁', () => update(page - 1)); previous.disabled = page <= 1; const next = action('下一頁', () => update(page + 1)); next.disabled = page >= pages; append(controls, previous, el('span', '', `${count(page)} / ${count(pages)} 頁`), next); parent.appendChild(controls); }

  function renderMetrics() {
    const rows = [
      [data.dossiers.length, '人物檔案（原庫紀錄）'],
      [data.dossiers.filter(item => item.identityStatus === 'reviewed').length, '已編輯核讀身份的紀錄'],
      [data.summary.downloadedDocuments, '尚未標記缺文的轉錄頁'],
      [data.dossiers.filter(item => metric(item, 'matches') > 0).length, '古籍中有姓名字串的紀錄']
    ];
    $('archiveMetrics').replaceChildren(...rows.map(([value, label]) => append(el('div', 'ar-metric'), el('strong', '', count(value)), el('span', '', label))));
  }

  function renderPeople() {
    const panel = $('archivePanel');
    append(panel, heading('人物的來源檔案', '依原人物庫逐筆建立檔案。同名、別稱與不同身份保留為各自紀錄；姓名出現和百科連結是查找入口，具體主張仍須逐段核對。'));
    const toolbar = el('div', 'ar-toolbar');
    const dynastyOptions = [...new Set(data.dossiers.map(item => item.dynasty).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    const change = (key, value) => { state[key] = value; state.page = 1; results(); };
    append(toolbar,
      field('搜尋人物', searchInput(state.query, '姓名、別稱、原庫標題或紀錄 ID', value => change('query', value))),
      field('原庫分類', select([['', '全部分類'], ...[...new Set(data.dossiers.map(item => item.type))].map(type => [type, TYPE_LABELS[type] || type])], state.type, '原庫分類', value => change('type', value))),
      field('原庫朝代', select([['', '全部朝代'], ...dynastyOptions.map(value => [value, value])], state.dynasty, '原庫朝代', value => change('dynasty', value))),
      field('檔案狀態', select([['', '全部狀態'], ['reviewed', '已核讀身份'], ['candidate', '百科候選線索'], ['ambiguous', '身份尚有歧義'], ['unresolved', '尚待來源線索'], ['corpus', '有古籍姓名字串'], ['no-corpus', '尚無古籍姓名字串'], ['claims', '有已核對主張']], state.coverage, '檔案狀態', value => change('coverage', value)))
    );
    const resultRegion = el('div'); resultRegion.id = 'archivePeopleResults'; append(panel, toolbar, resultRegion);
    function results() {
      const query = normal(state.query); const records = data.dossiers.filter(item => {
        const matchesQuery = !query || normal([item.name, item.title, item.canonicalName, ...array(item.aliases), item.recordId, ...array(item.searchNames), ...array(item.candidatePages).map(page => page.title)].join(' ')).includes(query);
        const coverage = !state.coverage || (state.coverage === 'corpus' ? metric(item, 'matches') > 0 : state.coverage === 'no-corpus' ? !metric(item, 'matches') : state.coverage === 'claims' ? metric(item, 'claims') > 0 : item.identityStatus === state.coverage);
        return matchesQuery && (!state.type || item.type === state.type) && (!state.dynasty || item.dynasty === state.dynasty) && coverage;
      });
      state.page = Math.min(state.page, Math.max(1, Math.ceil(records.length / PAGE_SIZE))); resultRegion.replaceChildren();
      const info = el('div', 'ar-search-info'); const label = el('span', '', `找到 ${count(records.length)} 筆，共 ${count(data.dossiers.length)} 筆人物檔案`); label.setAttribute('role', 'status'); append(info, label, action('重設篩選', () => { Object.assign(state, { query: '', type: '', dynasty: '', coverage: '', page: 1 }); renderPeopleFresh(); })); resultRegion.appendChild(info);
      const grid = el('div', 'ar-results');
      records.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE).forEach(item => {
        const card = el('article', 'ar-card');
        append(card, el('span', 'ar-kicker', [item.dynasty || '朝代待核', TYPE_LABELS[item.type] || item.type].filter(Boolean).join(' · ')), el('h3', '', item.name), item.title && item.title !== item.name ? el('p', 'ar-person-title', item.title) : null, append(el('div', 'ar-badges'), identityBadge(item.identityStatus)), el('p', 'ar-card-rule', `${count(metric(item, 'candidates'))} 個百科入口 · ${count(metric(item, 'claims'))} 條已核主張`), el('p', '', metric(item, 'matches') ? `${count(item.matchCount)} 篇古籍有姓名字串` : '目前尚無古籍姓名字串配對'), append(el('div', 'ar-actions'), action('打開人物檔案', () => openPerson(item.recordId), true)));
        grid.appendChild(card);
      });
      if (!records.length) grid.appendChild(empty('目前條件沒有結果', '試著只輸入名字的一部分，或移除朝代與狀態篩選。原庫朝代欄位尚未全部標準化。'));
      append(resultRegion, grid); pagination(resultRegion, records.length, state.page, page => { state.page = page; results(); resultRegion.scrollIntoView({ block: 'start' }); });
    }
    results();
  }
  function renderPeopleFresh() { $('archivePanel').replaceChildren(); renderPeople(); }

  function renderSources() {
    const panel = $('archivePanel'); append(panel, heading('來源書目與保存位置', '從史籍、數位典藏與百科線索查看可取得的版本。可開啟網頁，並不等於內容已逐段查證；使用條件依原提供者的說明保留。'));
    const toolbar = el('div', 'ar-toolbar ar-two-filters'); const resultRegion = el('div');
    const update = (key, value) => { state[key] = value; state.sourcePage = 1; results(); };
    append(toolbar, field('搜尋書目', searchInput(state.sourceQuery, '書名、提供機構、涵蓋時代', value => update('sourceQuery', value))), field('資料類型', select([['', '全部類型'], ...[...new Set(data.sources.map(item => item.type).filter(Boolean))].map(value => [value, sourceType(value)])], state.sourceType, '資料類型', value => update('sourceType', value))), field('取得狀態', select([['', '全部狀態'], ...[...new Set(data.sources.map(item => item.retrievalStatus).filter(Boolean))].map(value => [value, statusLabel(value)])], state.sourceStatus, '取得狀態', value => update('sourceStatus', value)))); append(panel, toolbar, resultRegion);
    function results() {
      const query = normal(state.sourceQuery); const sources = data.sources.filter(item => (!query || normal([item.title, item.provider, textOf(item.coverage), textOf(item.notes)].join(' ')).includes(query)) && (!state.sourceType || item.type === state.sourceType) && (!state.sourceStatus || item.retrievalStatus === state.sourceStatus));
      state.sourcePage = Math.min(state.sourcePage, Math.max(1, Math.ceil(sources.length / PAGE_SIZE))); resultRegion.replaceChildren();
      const info = el('p', 'ar-search-info', `${count(sources.length)} 筆來源書目`); info.setAttribute('role', 'status'); resultRegion.appendChild(info);
      const grid = el('div', 'ar-results'); sources.slice((state.sourcePage - 1) * PAGE_SIZE, state.sourcePage * PAGE_SIZE).forEach(source => {
        const card = el('article', 'ar-card'); append(card, el('span', 'ar-kicker', source.provider || '來源機構待補'), el('h3', '', source.title), append(el('div', 'ar-badges'), badge(sourceType(source.type)), badge(statusLabel(source.retrievalStatus))), el('p', 'ar-description', textOf(source.coverage) || '尚未列出涵蓋範圍'), append(el('div', 'ar-actions'), action('查看版本與使用方式', () => openSource(source.id), true))); grid.appendChild(card);
      }); if (!sources.length) grid.appendChild(empty('沒有符合的來源', '更換關鍵字或取消篩選，查看所有已保存的書目。')); resultRegion.appendChild(grid); pagination(resultRegion, sources.length, state.sourcePage, page => { state.sourcePage = page; results(); resultRegion.scrollIntoView({ block: 'start' }); });
    }
    results();
  }

  function sourceFacts(source) { return facts([['提供者', source.provider], ['資料類型', sourceType(source.type)], ['涵蓋範圍', textOf(source.coverage)], ['取得狀態', statusLabel(source.retrievalStatus)], ['查閱日期', source.accessedOn], ['讀取方式', [ACCESS_LABELS[source.access?.mode] || source.access?.mode, textOf(source.access?.notes)].filter(Boolean).join('；')], ['再利用說明', [REUSE_LABELS[source.reuse?.status] || source.reuse?.status, textOf(source.reuse?.notes)].filter(Boolean).join('；')], ['來源位置', link('開啟來源網站 ↗', source.url)], ['補充說明', textOf(source.notes)]]); }
  function openSource(id) { const source = maps.sources.get(id); if (!source) return; const body = showDialog(source.title); route({ source: id }); append(body, sourceFacts(source), notice('書目狀態說明此份目錄的取得情形。外部網站可能已更新；請同時核對篇章、版本和主張所指的文字。')); const related = data.dossiers.filter(item => array(item.sourceIds).includes(id)); if (related.length) { append(body, el('h3', '', '人物檔案中使用此來源'), note(`共 ${count(related.length)} 筆。此處顯示前 30 筆。`)); const list = el('div', 'ar-actions'); related.slice(0, 30).forEach(item => list.appendChild(action(item.name, () => openPerson(item.recordId)))); body.appendChild(list); } }

  function showDialog(title, reader) {
    if (readerController) { readerController.abort(); readerController = null; }
    const alreadyOpen = !$('archiveDialog').hidden; if (!alreadyOpen) modalReturn = document.activeElement;
    $('archiveDialog').replaceChildren(); const dialog = el('section', `ar-dialog${reader ? ' ar-reader-dialog' : ''}`); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'archiveDialogTitle'); dialog.tabIndex = -1;
    const titleNode = el('h2', '', title); titleNode.id = 'archiveDialogTitle'; const header = append(el('header', 'ar-dialog-header'), titleNode, action('關閉', () => closeDialog())); const body = el('div', 'ar-dialog-body'); append(dialog, header, body); $('archiveDialog').appendChild(dialog); $('archiveDialog').hidden = false; $('archivePage').setAttribute('aria-hidden', 'true'); $('archivePage').inert = true; document.body.classList.add('ar-modal-open'); currentModal = dialog; header.querySelector('button').focus(); return body;
  }
  function closeDialog(updateRoute = true) { if ($('archiveDialog').hidden) return; if (readerController) readerController.abort(); readerController = null; currentModal = null; $('archiveDialog').hidden = true; $('archiveDialog').replaceChildren(); $('archivePage').removeAttribute('aria-hidden'); $('archivePage').inert = false; document.body.classList.remove('ar-modal-open'); if (updateRoute) route(); if (modalReturn && modalReturn.isConnected) modalReturn.focus(); modalReturn = null; }
  function evidenceCard(evidence) { const card = el('div', 'ar-citation'); append(card, el('h4', '', sourceName(evidence.sourceId) || '查證來源'), evidence.locator ? el('p', '', `位置：${evidence.locator}`) : null, evidence.supportedFact ? el('p', '', evidence.supportedFact) : null, evidence.reviewScope ? note(evidence.reviewScope) : null, append(el('div', 'ar-link-row'), link('核對原文 ↗', evidence.url), evidence.accessedOn ? el('span', '', `查閱 ${evidence.accessedOn}`) : null)); return card; }

  async function openPerson(recordId) {
    const stub = maps.people.get(str(recordId)); if (!stub) return;
    const body = showDialog(stub.name); route({ person: stub.recordId }); const controller = new AbortController(); readerController = controller;
    body.appendChild(note('正在開啟這位人物的來源檔案…')); let person;
    try { person = await loadPerson(stub, controller.signal); if (controller.signal.aborted || !body.isConnected) return; body.replaceChildren(); }
    catch (error) { if (error.name !== 'AbortError' && body.isConnected) body.replaceChildren(notice('人物檔案目前無法開啟：' + error.message), action('重新讀取此人物', () => openPerson(recordId))); return; }
    const original = el('a', 'ar-button', '閱讀這筆原人物分析 ↗'); const originalUrl = new URL('/history-lab', location.href); originalUrl.searchParams.set('record', person.recordId); if (new URLSearchParams(location.search).get('local') === '1') originalUrl.searchParams.set('local', '1'); original.href = originalUrl.pathname + originalUrl.search; original.target = '_blank'; original.rel = 'noopener noreferrer';
    append(body, append(el('div', 'ar-badges'), identityBadge(person.identityStatus), badge(TYPE_LABELS[person.type] || person.type || '分類待核'), person.dynasty ? badge(person.dynasty) : null), facts([['原庫標題', person.title], ['原庫紀錄 ID', person.recordId], ['核讀名稱建議', person.canonicalName], ['查找別稱', array(person.aliases).join('、')], ['古籍姓名字串', `${count(person.matchCount)} 篇 · ${count(array(person.matches).length)} 組姓名查詢命中`]]), append(el('div', 'ar-actions'), original, action('下載此人的來源清單', () => exportCitations(person)), action('複製檔案連結', () => copyLink())));
    const reviews = array(person.reviewIds).map(id => maps.reviews.get(id)).filter(Boolean);
    append(body, el('h3', '', '編輯核讀與待解問題'));
    if (!reviews.length) body.appendChild(notice('這筆人物尚未有編輯核讀記錄。以下百科候選頁與古籍字串出現，請連同原庫朝代、別稱和生平線索核對。'));
    reviews.forEach(review => {
      const block = el('section', 'ar-citation'); append(block, el('h4', '', review.issue || '身份核對紀錄'), badge(statusLabel(review.status), review.status === 'unresolved-identity' ? 'lead' : 'verified'), el('p', '', review.decision || ''), review.notes ? note(textOf(review.notes)) : null); array(review.evidence).forEach(item => block.appendChild(evidenceCard(item))); body.appendChild(block);
    });
    if (array(person.gaps).length || array(person.notes).length) { const list = el('ul'); [...array(person.gaps), ...array(person.notes)].forEach(item => list.appendChild(el('li', '', textOf(item)))); append(body, list); }
    const claimRegion = el('section'); body.appendChild(claimRegion);
    if (array(person.claimIds).length) {
      append(claimRegion, el('h3', '', `逐條核對的歷史主張 · ${count(person.claimIds.length)}`), note('主張使用史論館現有的來源包。核對的範圍是列出的句子與證據，原人物分析的其餘內容仍需另行查證。'));
      const pending = note('正在讀取主張與引文…'); claimRegion.appendChild(pending);
      getHistorical().then(pkg => { if (!claimRegion.isConnected) return; pending.remove(); array(person.claimIds).forEach(id => { const claim = array(pkg.claims).find(item => item.id === id); if (claim) claimRegion.appendChild(claimCard(claim, pkg)); else claimRegion.appendChild(note(`主張 ${id} 未在目前版本找到，請重新核對資料包版本。`)); }); }).catch(error => { if (pending.isConnected) pending.textContent = `已保留 ${person.claimIds.length} 個主張 ID，但來源包暫時無法讀取：${error.message}`; });
    }
    append(body, el('h3', '', '百科候選與身份線索'));
    if (!array(person.candidatePages).length) body.appendChild(note('此輪尚未找到百科候選頁。可從本檔案下方古籍書目繼續查找。'));
    array(person.candidatePages).forEach(page => {
      const card = el('section', 'ar-citation'); card.dataset.tone = 'lead'; append(card, el('h4', '', page.title), append(el('div', 'ar-badges'), badge(page.isDisambiguation ? '消歧義頁 · 需選定人物' : '百科線索 · 非逐條史證', 'lead')), facts([['取得日期', page.retrievedAt], ['固定版本', page.revisionId ? String(page.revisionId) : '未保存版本 ID'], ['資料項目', page.wikidataId]]), append(el('div', 'ar-link-row'), link('開啟候選頁 ↗', page.url), link('保存時的版本 ↗', page.revisionUrl)));
      const bibliography = array(page.bibliography); if (bibliography.length) { const details = el('details'); append(details, el('summary', '', `頁面列出的來源線索（${count(bibliography.length)}）`), note('由百科頁擷取的書目與連結，尚未逐筆確認它支持哪一個人物主張。')); bibliography.forEach(item => { const paragraph = el('p'); append(paragraph, link(item.citationTitle || item.title || item.url, item.url) || el('span', '', item.citationTitle || item.title || '未命名書目'), [item.author, item.publisher, item.date, item.isbn ? `ISBN ${item.isbn}` : ''].filter(Boolean).length ? el('span', '', ` · ${[item.author, item.publisher, item.date, item.isbn ? `ISBN ${item.isbn}` : ''].filter(Boolean).join(' · ')}`) : null, item.url && !link('', item.url) ? el('span', 'ar-break', `（原連結僅作文字保存：${item.url}）`) : null); details.appendChild(paragraph); }); card.appendChild(details); }
      const wikiLinks = array(page.wikisourceLinks); if (wikiLinks.length) { const links = el('div', 'ar-link-row'); wikiLinks.forEach(item => { const url = typeof item === 'string' ? item : item.url; append(links, link(typeof item === 'object' ? item.title || '維基文庫線索 ↗' : '維基文庫線索 ↗', url)); }); card.appendChild(links); } body.appendChild(card);
    });
    append(body, el('h3', '', '古籍中的姓名字串'), notice('下列配對只表示這段整理文字含有姓名文字。同名人物、稱號和一般詞語都可能造成誤配；尚未逐段核對的命中，不能直接當成人物經歷或關係。'));
    const appearances = array(person.matches); if (!appearances.length) body.appendChild(note('目前收存篇章尚未找到配對。沒有命中，不等於史籍沒有記載；古籍可能使用字、號、官名或異體字。'));
    if (appearances.length) {
      const appearanceRegion = el('div'); body.appendChild(appearanceRegion); let appearancePage = 1;
      function renderAppearances() { appearanceRegion.replaceChildren(); appearanceRegion.appendChild(note(`共 ${count(person.matchCount)} 篇、${count(appearances.length)} 組字串命中紀錄，分頁列出。`)); appearances.slice((appearancePage - 1) * PAGE_SIZE, appearancePage * PAGE_SIZE).forEach(match => {
        const doc = maps.documents.get(match.documentId); const block = el('div', 'ar-citation'); block.dataset.tone = 'lead'; append(block, el('h4', '', doc?.title || match.documentId), note(`查找文字「${match.query || person.name}」 · 此篇 ${count(match.count)} 次`), match.excerpt ? el('blockquote', '', match.excerpt) : null, append(el('div', 'ar-actions'), doc ? action('在收存原文中查看', () => openDocument(doc.id, match.query || person.name, match.offset), true) : null, doc ? link('前往原網站 ↗', doc.sourceUrl) : null)); appearanceRegion.appendChild(block);
        if (doc?.status === 'incomplete') block.appendChild(badge('含缺文／字形待核', 'missing'));
      }); pagination(appearanceRegion, appearances.length, appearancePage, page => { appearancePage = page; renderAppearances(); appearanceRegion.scrollIntoView({ block: 'start' }); }); }
      renderAppearances();
    }
    const sources = array(person.sourceIds).map(id => maps.sources.get(id)).filter(Boolean); if (sources.length) { append(body, el('h3', '', '關聯書目')); sources.forEach(source => { const card = el('div', 'ar-citation'); append(card, el('h4', '', source.title), note(textOf(source.coverage)), action('查看來源紀錄', () => openSource(source.id))); body.appendChild(card); }); }
  }

  async function getHistorical() { if (historical) return historical; if (!historicalPromise) historicalPromise = fetchJSON(PACKAGE_URL).then(value => { historical = value; return value; }).catch(error => { historicalPromise = null; throw error; }); return historicalPromise; }
  function claimCard(claim, pkg) {
    const card = el('details', 'ar-citation'); const title = el('summary', '', claim.statement || claim.summary || claim.id); append(card, title, claim.caveat ? note(claim.caveat) : claim.note ? note(claim.note) : null);
    const citations = array(claim.evidence || claim.citations); citations.forEach(item => { const source = array(pkg.sources).find(sourceItem => sourceItem.id === item.sourceId); const citation = el('div', 'ar-citation'); append(citation, el('h4', '', source?.title || item.sourceId || '來源'), item.locator ? note(item.locator) : null, item.excerpt || item.quote ? el('blockquote', '', item.excerpt || item.quote) : null, item.paraphrase ? el('p', '', item.paraphrase) : null, item.note ? note(item.note) : null, link('開啟史料 ↗', item.url || source?.url)); card.appendChild(citation); }); if (!citations.length) card.appendChild(note('此版本的主張未提供可展開的引文，請核對資料包。')); return card;
  }
  async function exportCitations(person) {
    if (array(person.claimIds).length && !historical) { try { await getHistorical(); } catch (_) { toast('來源包暫時無法讀取，清單會保留已核主張 ID，方便之後對照。'); } }
    const lines = [`王侯將相 · ${person.name} 來源檔案`, `檔案館版本：${data.archiveVersion}；建置時間：${data.createdAt}`, `原庫 ID：${person.recordId}`, `身份狀態：${IDENTITY_LABELS[person.identityStatus] || person.identityStatus}`, '', '狀態說明：百科頁為線索；古籍姓名字串需逐段核對；已核主張的範圍以逐條引文為準。', ''];
    array(person.reviewIds).map(id => maps.reviews.get(id)).filter(Boolean).forEach(review => { lines.push(`【限定範圍編輯核讀】${review.issue || review.id}`, review.decision || ''); array(review.evidence).forEach(evidence => lines.push(`${sourceName(evidence.sourceId)}｜${evidence.locator || ''}｜${evidence.url || ''}`, `支持事項：${evidence.supportedFact || ''}；查閱：${evidence.accessedOn || ''}`, evidence.reviewScope ? `核讀範圍：${evidence.reviewScope}` : '')); });
    array(person.candidatePages).forEach(page => { lines.push('', `【百科候選】${page.title}`, page.url || '', `版本：${page.revisionId || '未提供'}；取得：${page.retrievedAt || '未提供'}`); array(page.bibliography).forEach(item => lines.push(`  書目線索：${item.citationTitle || item.title || ''} ${item.url || ''}`)); });
    array(person.matches).forEach(match => { const doc = maps.documents.get(match.documentId); lines.push('', `【姓名字串，待核】${doc?.title || match.documentId}`, `查找：${match.query || person.name}；${match.count || 0} 次`, doc?.revisionUrl || doc?.sourceUrl || '', `保存版本：${doc?.revisionId || '未提供'}；SHA-256：${doc?.sha256 || '未提供'}`, match.excerpt || ''); });
    array(person.claimIds).forEach(id => { const claim = array(historical?.claims).find(item => item.id === id); lines.push('', `【已核主張】${id}`, claim?.statement || '請在史論館共用資料包中讀取完整主張與引文。'); array(claim?.evidence || claim?.citations).forEach(item => { const source = array(historical?.sources).find(sourceItem => sourceItem.id === item.sourceId); lines.push(`${source?.title || item.sourceId}｜${item.locator || ''}｜${item.url || source?.url || ''}`); }); });
    lines.push('', '【待補事項】', ...array(person.gaps).map(textOf), ...array(person.notes).map(textOf)); download(`${filename(person.name)}_${filename(person.recordId)}_來源清單.txt`, lines.join('\n'));
  }
  async function copyLink() { try { await navigator.clipboard.writeText(location.href); toast('已複製目前人物檔案的連結。'); } catch (_) { toast('瀏覽器未允許複製，請直接複製網址列中的完整連結。'); } }

  function occurrence(text, query) { const positions = []; if (!query) return positions; let at = text.indexOf(query); while (at >= 0) { positions.push(at); at = text.indexOf(query, at + Math.max(query.length, 1)); } return positions; }
  function snippet(text, offset, length = 160) { const start = Math.max(0, offset - 55); const end = Math.min(text.length, offset + length); return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`; }
  function readableBooks() { return data.books.filter(book => book.documentsPath && (Number(book.downloadedCount) > 0 || Number(book.acquiredCount) > 0 || Number(book.chapterCount) > 0)); }
  function renderTexts() {
    const panel = $('archivePanel'); append(panel, heading('原文閱覽與字串檢索', '選擇一部已收存古籍，在保存的篇章內找字、讀上下文。搜尋採字面比對，異體字、簡繁與別名需另行查找；每篇保留來源版本及內容指紋。'));
    const available = readableBooks(); if (!state.bookId && available.length) state.bookId = available[0].id;
    const toolbar = el('form', 'ar-toolbar ar-two-filters'); const query = searchInput(state.textQuery, '輸入古籍字面，例如 韓信、淮陰侯', value => { state.textQuery = value; }); query.minLength = 1; query.required = true;
    const books = select([['*', `全部已收存古籍（${count(available.length)} 部）`], ...available.map(book => [book.id, book.title])], state.allBooks ? '*' : state.bookId, '全文範圍', value => { state.allBooks = value === '*'; if (value !== '*') state.bookId = value; }); const submit = el('button', 'ar-button ar-button-primary', '搜尋收存原文'); submit.type = 'submit'; submit.disabled = state.searchRunning || !available.length;
    append(toolbar, field('查找文字（精確字串）', query), field('搜尋範圍', books), append(el('div', 'ar-actions'), submit)); toolbar.addEventListener('submit', event => { event.preventDefault(); searchCorpus(); }); panel.appendChild(toolbar);
    append(panel, note('搜尋只讀取查詢所需的索引；打開篇章才讀取該篇文字。可隨時停止，已有結果會保留並註明查詢範圍。'));
    const searchRegion = el('section'); searchRegion.id = 'archiveTextResults'; panel.appendChild(searchRegion); renderTextResults();
    append(panel, el('h3', '', '收存書架')); const grid = el('div', 'ar-document-list');
    data.books.forEach(book => { const card = el('article', 'ar-card'); append(card, el('span', 'ar-kicker', statusLabel(book.status)), el('h3', '', book.title), el('p', '', `已收存 ${count(book.downloadedCount)} / 目錄 ${count(book.chapterCount)} 篇`), book.notes ? el('p', 'ar-description', textOf(book.notes)) : null, append(el('div', 'ar-actions'), action('查看篇章目錄', () => openBook(book.id), Number(book.downloadedCount) > 0), link('來源目錄 ↗', book.sourceUrl))); grid.appendChild(card); }); if (!data.books.length) grid.appendChild(empty('此版本還沒有古籍收存目錄', '可先從來源書目查看外部典藏與逐條史證。')); append(panel, grid);
  }
  function renderTextResults() {
    const region = $('archiveTextResults'); if (!region) return; const generation = ++snippetGeneration; if (snippetController) snippetController.abort(); snippetController = new AbortController(); const signal = snippetController.signal; region.replaceChildren();
    if (!state.searchResults && !state.searchRunning) return;
    const status = el('p', 'ar-status', state.searchSummary || '正在搜尋…'); status.setAttribute('role', 'status'); if (state.searchRunning) status.appendChild(action('停止搜尋', () => { searchController?.abort(); })); region.appendChild(status);
    const list = array(state.searchResults), meta = state.searchMeta; state.searchPage = Math.min(state.searchPage, Math.max(1, Math.ceil(list.length / PAGE_SIZE)));
    if (meta) {
      const info = el('div', 'ar-search-info');
      append(info, el('span', '', '搜尋範圍 ' + count(meta.bookIds.length) + ' 部 · 已核對字串 ' + count(meta.scannedDocuments) + ' 篇 · 結果 ' + count(list.length) + ' 篇（含 ' + count(list.filter(item => item.documentStatus === 'incomplete').length) + ' 篇缺文／字形待核）· ' + count(meta.occurrences) + ' 次命中'), action('匯出查詢結果 JSON', () => {
        const result = { format: 'dynasty-source-search', schemaVersion: 1, archiveVersion: data.archiveVersion, webVersion: data.version, archiveCreatedAt: data.createdAt, exportedAt: new Date().toISOString(), query: meta.query, matchType: 'exact-string-occurrence', verificationStatus: 'unreviewed', verificationNote: '這是現存整理文字中的精確字串命中，尚未核對人物身份或歷史主張；documentStatus=incomplete 的篇章含缺文或字形待核。', search: { status: meta.status, startedAt: meta.startedAt, finishedAt: meta.finishedAt, requestedBookIds: [...meta.bookIds], completedBooks: meta.completedBooks, scannedDocuments: meta.scannedDocuments, matchedDocuments: list.length, incompleteMatchedDocuments: list.filter(item => item.documentStatus === 'incomplete').length, occurrences: meta.occurrences, scanComplete: meta.status === 'complete', error: meta.error || null, completenessNote: 'scanComplete 只表示選定版本索引完成精確字串檢索，不代表古籍全文完整或史實已查證。' }, results: list.map(item => ({ ...item, excerpt: item.excerpt || null, excerptStatus: item.excerpt ? 'loaded' : 'not-requested' })) };
        download('古籍檢索_' + filename(meta.query) + '_' + result.exportedAt.slice(0, 10) + '.json', JSON.stringify(result, null, 2), 'application/json;charset=utf-8');
      })); region.appendChild(info);
      region.appendChild(note('所有命中位置都會保留，每頁列 24 篇；只為目前這頁讀取上下文。匯出包含全部命中位置與来源版本，尚未開啟的摘錄會標示為未載入。'));
      if (meta.status === 'error') region.appendChild(action('重試這次查詢', () => { state.textQuery = meta.query; state.allBooks = meta.bookIds.length !== 1; if (!state.allBooks) state.bookId = meta.bookIds[0]; searchCorpus(); }));
    }
    const jobs = [];
    list.slice((state.searchPage - 1) * PAGE_SIZE, state.searchPage * PAGE_SIZE).forEach(result => {
      const doc = maps.documents.get(result.documentId), card = el('div', 'ar-citation'), quote = el('blockquote', '', result.excerpt || (state.searchRunning ? '完成或停止搜尋後，會讀取這頁的上下文。' : '正在讀取這篇的命中上下文…'));
      append(card, el('h4', '', result.title), note(bookName(result.bookId) + ' · ' + count(result.count) + ' 處精確字串'), result.documentStatus === 'incomplete' ? badge('含缺文／字形待核', 'missing') : null, quote, append(el('div', 'ar-actions'), action('閱讀上下文', () => openDocument(result.documentId, result.query, result.offset), true), link('來源網站 ↗', result.sourceUrl || doc?.sourceUrl))); region.appendChild(card);
      if (!result.excerpt && doc?.textPath && !state.searchRunning) jobs.push(async () => { try { const text = await loadDocumentContent(doc, false, signal); if (signal.aborted || generation !== snippetGeneration || !quote.isConnected) return; result.excerpt = snippet(text.text, result.offset); quote.textContent = result.excerpt; } catch (error) { if (error.name !== 'AbortError' && generation === snippetGeneration && quote.isConnected) { quote.textContent = '摘錄暫時無法載入；命中位置與來源版本仍已保留。'; card.appendChild(action('重試這篇摘錄', () => renderTextResults())); } } });
    });
    let cursor = 0; Array.from({ length: Math.min(3, jobs.length) }, async () => { while (cursor < jobs.length && !signal.aborted) { const job = jobs[cursor++]; await job(); } });
    if (list.length) pagination(region, list.length, state.searchPage, page => { state.searchPage = page; renderTextResults(); region.scrollIntoView({ block: 'start' }); });
    if (!list.length && !state.searchRunning && meta?.status !== 'error') region.appendChild(empty('這次沒有已確認的字面命中', '改用字、號、官職或異體字再試。若查詢已停止，這不表示未完成的範圍沒有記載。'));
  }
  function ensureSearchWorker() {
    if (workerReady) return workerReady;
    workerReady = new Promise((resolve, reject) => {
      workerReadyResolve = resolve; workerReadyReject = reject;
      try {
        const worker = new Worker('/static/js/source-search-worker.js'); searchWorker = worker; workerInitId = ++searchRequest;
        worker.onmessage = event => { if (worker !== searchWorker) return; const message = event.data || {}; if (message.requestId === workerInitId && message.type === 'ready') { workerReadyResolve?.(); workerReadyResolve = null; workerReadyReject = null; return; } if (message.requestId === workerInitId && message.type === 'error') { workerReadyReject?.(new Error(message.message || '搜尋索引無法啟動。')); workerReady = null; worker.terminate(); searchWorker = null; return; } handleSearchMessage(message); };
        worker.onerror = () => { const error = new Error('搜尋工作暫時中斷，請重試。'); workerReadyReject?.(error); workerReadyReject = null; workerReadyResolve = null; workerReady = null; worker.terminate(); searchWorker = null; if (searchJob && state.searchRunning) finishSearch(searchJob, 'error', error.message); };
        worker.postMessage({ type: 'init', requestId: workerInitId, search: data.search });
      } catch (error) { reject(error); workerReady = null; }
    });
    workerReady = workerReady.catch(error => { workerReady = null; throw error; });
    return workerReady;
  }
  function mapSearchResults(message, job) {
    if (message.exact === false || message.query && message.query !== job.meta.query) throw new Error('搜尋回應與目前查詢不同。');
    return array(message.results || message.partialResults).map(item => {
      const id = item.docId || item.documentId, doc = maps.documents.get(id); if (!doc) throw new Error('搜尋結果篇章不屬於目前目錄版本。');
      const occurrences = Number(item.count), offset = Number(item.firstOffset ?? item.offset); if (!Number.isSafeInteger(occurrences) || occurrences <= 0 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('搜尋結果的命中位置無效。');
      return { documentId: id, bookId: doc.bookId, title: doc.title, count: occurrences, offset, query: job.meta.query, matchType: 'exact-string-occurrence', verificationStatus: 'unreviewed', documentStatus: doc.status, acquisitionStatus: doc.acquisitionStatus || null, sourceUrl: doc.sourceUrl || null, revisionId: doc.revisionId || null, revisionUrl: doc.revisionUrl || null, revisionTimestamp: doc.revisionTimestamp || null, historyUrl: doc.historyUrl || null, retrievedAt: doc.retrievedAt || null, sha256: doc.sha256 || null, textSha256: doc.textSha256 || null };
    });
  }
  function handleSearchMessage(message) {
    const job = searchJob; if (!job || message.requestId !== job.id) return;
    if (message.type === 'cancelled' && job.meta.status === 'cancelled' && array(message.partialResults).length) { try { state.searchResults = mapSearchResults(message, job); state.searchMeta = job.meta; job.hasPartial = true; job.meta.scannedDocuments = Number(message.documentsSearched) || 0; job.meta.occurrences = Number(message.totalMatches) || 0; finishSearch(job, 'cancelled'); } catch (_) { /* Keep the last valid result set. */ } return; }
    if (job.controller.signal.aborted || job.meta.status !== 'running') return;
    try {
      if (message.type === 'progress') { state.searchSummary = '正在比對「' + job.meta.query + '」所需的來源索引' + (Number.isFinite(message.total) ? ' · ' + count(message.completed) + ' / ' + count(message.total) : '') + '；可隨時停止。'; const status = $('archiveTextResults')?.querySelector('.ar-status'); if (status) { status.replaceChildren(document.createTextNode(state.searchSummary), action('停止搜尋', () => job.controller.abort())); } return; }
      if (message.type === 'partial' || message.type === 'result') {
        const previousExcerpts = new Map(array(state.searchResults).map(item => [item.documentId, item.excerpt])); state.searchResults = mapSearchResults(message, job); state.searchResults.forEach(item => { if (previousExcerpts.get(item.documentId)) item.excerpt = previousExcerpts.get(item.documentId); }); job.hasPartial = state.searchResults.length > 0; job.meta.scannedDocuments = Number(message.documentsSearched) || 0; job.meta.occurrences = Number(message.totalMatches) || state.searchResults.reduce((sum, item) => sum + item.count, 0);
        if (message.type === 'result') finishSearch(job, 'complete'); else if (state.tab === 'texts') renderTextResults(); return;
      }
      if (message.type === 'cancelled') { if (array(message.partialResults).length) { state.searchResults = mapSearchResults(message, job); job.hasPartial = true; job.meta.scannedDocuments = Number(message.documentsSearched) || 0; job.meta.occurrences = Number(message.totalMatches) || 0; } finishSearch(job, 'cancelled'); return; }
      if (message.type === 'error') finishSearch(job, 'error', message.message || '索引資料暫時無法讀取。');
    } catch (error) { finishSearch(job, 'error', error.message); }
  }
  function finishSearch(job, status, error) {
    if (searchJob !== job) return; job.meta.status = status; job.meta.finishedAt = new Date().toISOString(); if (error) job.meta.error = error; if (status === 'complete') job.meta.completedBooks = job.meta.bookIds.length; state.searchRunning = false; searchController = null;
    const prefix = status === 'complete' ? '搜尋完成' : status === 'cancelled' ? '已停止' : '搜尋未完成';
    state.searchSummary = prefix + '：查詢「' + job.meta.query + '」，找到 ' + count(job.meta.occurrences) + ' 次，分布於 ' + count(array(state.searchResults).length) + ' 篇。' + (error ? ' ' + error : '');
    if (status === 'cancelled' && !job.hasPartial && job.previousResults?.length) { state.searchResults = job.previousResults; state.searchMeta = job.previousMeta; state.searchSummary += ' 此輪尚未取得命中結果；下方保留前次「' + job.previousMeta.query + '」的結果。'; }
    if (state.tab === 'texts') render();
  }
  async function searchCorpus() {
    const query = state.textQuery.trim(); if (!query) { toast('先輸入要在古籍中查找的文字。'); return; }
    if (searchController) searchController.abort(); const controller = new AbortController(), books = state.allBooks ? readableBooks() : readableBooks().filter(book => book.id === state.bookId);
    const previousResults = state.searchResults, previousMeta = state.searchMeta;
    const meta = { query, bookIds: books.map(book => book.id), startedAt: new Date().toISOString(), finishedAt: null, status: 'running', completedBooks: 0, scannedDocuments: 0, occurrences: 0 };
    const job = { id: ++searchRequest, controller, meta, previousResults, previousMeta, hasPartial: false }; searchJob = job; searchController = controller; state.searchMeta = meta; state.searchRunning = true; state.searchResults = []; state.searchSummary = '正在準備查詢「' + query + '」…'; state.searchPage = 1;
    controller.signal.addEventListener('abort', () => { searchWorker?.postMessage({ type: 'cancel', requestId: job.id }); if (searchJob === job && job.meta.status === 'running') finishSearch(job, 'cancelled'); }, { once: true }); render();
    try { await Promise.all([loadDocumentCatalog(), ensureSearchWorker()]); if (controller.signal.aborted || searchJob !== job) return; searchWorker.postMessage({ type: 'search', requestId: job.id, query, bookIds: meta.bookIds }); }
    catch (error) { if (searchJob === job && !controller.signal.aborted) finishSearch(job, 'error', error.message); }
  }
  async function openBook(id) {
    const book = maps.books.get(id); if (!book) return; const body = showDialog(book.title); route({ book: id });
    append(body, facts([['保存進度', `${count(book.downloadedCount)} / ${count(book.chapterCount)} 篇`], ['取得狀態', statusLabel(book.status)], ['目錄版本', book.indexRevisionId], ['再利用說明', textOf(book.license)], ['補充', textOf(book.notes)], ['來源目錄', link('開啟古籍目錄 ↗', book.sourceUrl)]]));
    const controller = new AbortController(); readerController = controller; const loading = note('正在讀取這部書的篇章目錄…'); body.appendChild(loading); let docs;
    try { docs = await loadBookDocuments(book, controller.signal); if (controller.signal.aborted || !body.isConnected) return; loading.remove(); }
    catch (error) { if (error.name !== 'AbortError' && body.isConnected) append(body, notice(error.message), action('重新讀取篇章目錄', () => openBook(id))); return; }
    const input = searchInput('', '搜尋篇章標題', value => renderChapters(value)); const region = el('div'); append(body, field('篇章搜尋', input), region);
    let page = 1; let lastQuery = '';
    function renderChapters(query) { if (query !== lastQuery) page = 1; lastQuery = query; const chapters = docs.filter(doc => normal(doc.title).includes(normal(query))); region.replaceChildren(); append(region, note(`${count(chapters.length)} 篇目錄紀錄`)); chapters.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).forEach(doc => { const row = el('div', 'ar-citation'); append(row, el('h4', '', doc.title), append(el('div', 'ar-badges'), badge(statusLabel(doc.status), doc.status === 'downloaded' ? 'archived' : 'missing'), badge(`${count(doc.characters)} 字元`)), append(el('div', 'ar-actions'), doc.textPath && doc.characters > 0 ? action('閱讀收存原文', () => openDocument(doc.id), true) : null, link('來源頁面 ↗', doc.sourceUrl))); region.appendChild(row); }); if (!chapters.length) region.appendChild(empty('沒有符合的篇章', '此書目可能尚未取得章節，或目前搜尋文字不在章節標題內。')); pagination(region, chapters.length, page, next => { page = next; renderChapters(lastQuery); }); }
    renderChapters('');
  }
  async function openDocument(id, search, offset) {
    const body = showDialog(maps.documents.get(id)?.title || '開啟篇章', true); route({ doc: id, find: search || '' }); const controller = new AbortController(); readerController = controller;
    let meta = maps.documents.get(id);
    if (!meta) { body.appendChild(note('正在查找這篇文字的來源位置…')); try { await loadDocumentCatalog(); if (controller.signal.aborted || !body.isConnected) return; meta = maps.documents.get(id); if (!meta) throw new Error('目前版本未列出這篇文字。'); body.replaceChildren(); $('archiveDialogTitle').textContent = meta.title; } catch (error) { if (body.isConnected) append(body, notice(error.message), action('重新查找篇章', () => openDocument(id, search, offset))); return; } }
    const book = maps.books.get(meta.bookId);
    append(body, el('p', 'ar-reader-meta', `${book?.title || meta.bookId} · 收存版本 ${meta.revisionId || '未提供'}`), facts([['取得日期', meta.retrievedAt], ['原站版本時間', meta.revisionTimestamp], ['原始維基文字 SHA-256', meta.sha256], ['整理文字 SHA-256', meta.textSha256], ['再利用說明', textOf(book?.license)]]), append(el('div', 'ar-actions'), link('原始頁面 ↗', meta.sourceUrl), link('固定版本 ↗', meta.revisionUrl), action('返回篇章目錄', () => openBook(meta.bookId))));
    if (meta.status !== 'downloaded') body.appendChild(notice('此篇保存狀態是「' + statusLabel(meta.status) + '」。可讀文字可能不完整，請核對原始頁面與固定版本。'));
    if (meta.editionNote) body.appendChild(notice(meta.editionNote));
    array(meta.extractionNotes).forEach(message => body.appendChild(note(message)));
    const qualityReview = array(data.corpusQuality?.entries).find(item => item.requestedTitle === meta.requestedTitle && item.revisionId === meta.revisionId);
    array(qualityReview?.links).forEach(item => append(body, append(el('div', 'ar-citation'), link(item.title + ' ↗', item.url), note(item.coverage))));
    const supplements = [...maps.documents.values()].filter(item => item.supplementsDocumentId === meta.id);
    supplements.forEach(item => body.appendChild(action('另讀異版補篇：' + item.title, () => openDocument(item.id), true)));
    if (meta.supplementsDocumentId && maps.documents.has(meta.supplementsDocumentId)) body.appendChild(action('對照原轉錄的缺文紀錄', () => openDocument(meta.supplementsDocumentId)));
    if (array(meta.transclusions).length) {
      const transclusions = el('details', 'ar-disclosure'); transclusions.appendChild(el('summary', '', '此篇另展開的轉引來源與版本'));
      meta.transclusions.forEach(item => append(transclusions, facts([['轉引篇章', item.title], ['固定版本', link('查閱轉引版本 ↗', item.revisionUrl)], ['原始維基文字 SHA-256', item.sha256]])));
      body.appendChild(transclusions);
    }
    const status = el('p', 'ar-status', '正在開啟收存原文…'); body.appendChild(status);
    try {
      const doc = await loadDocumentContent(meta, false, controller.signal); if (controller.signal.aborted || !body.isConnected) return; status.remove();
      const related = array(doc.metadata?.relatedDocuments); registerDocuments(related);
      related.filter(item => !supplements.some(existing => existing.id === item.id) && item.id !== meta.supplementsDocumentId).forEach(item => body.appendChild(action('對讀相關版本：' + item.title, () => openDocument(item.id))));
      if (meta.supplementsDocumentId && related.some(item => item.id === meta.supplementsDocumentId) && !body.textContent.includes('對照原轉錄的缺文紀錄')) body.appendChild(action('對照原轉錄的缺文紀錄', () => openDocument(meta.supplementsDocumentId)));
      const controls = el('div', 'ar-reader-controls ar-reader-toolbar-sticky'); const input = searchInput(search || '', '此篇查找文字', () => highlight()); const previous = action('上一處', () => nextMatch(-1)); const next = action('下一處', () => nextMatch(1)); const result = el('span', 'ar-reader-meta'); result.setAttribute('role', 'status'); const text = el('div', 'ar-reader-text'); let paragraphs = []; let raw = false; let current = 0; let hits = []; let exactQuery = '';
      const rawStatus = note(''); const mode = action('檢視原始維基文字', async event => { const target = event.currentTarget; if (!raw && typeof doc.wikitext !== 'string') { target.disabled = true; rawStatus.textContent = '正在讀取這篇原始維基文字…'; try { const original = await loadDocumentContent(meta, true, controller.signal); if (controller.signal.aborted || !body.isConnected) return; doc.wikitext = original.wikitext; doc.transclusions = original.transclusions; rawStatus.textContent = ''; } catch (error) { if (body.isConnected) rawStatus.textContent = '原始轉錄暫時無法讀取：' + error.message + '。可再按一次重試；整理文字仍在下方。'; target.disabled = false; return; } } if (!body.isConnected) return; raw = !raw; target.disabled = false; target.textContent = raw ? '返回整理閱讀文字' : '檢視原始維基文字'; text.dataset.raw = String(raw); highlight(); }); mode.disabled = !meta.wikitextPath;
      append(controls, field('篇內字串查找', input), previous, next, result, action('放大字級', event => { const large = text.dataset.large !== 'true'; text.dataset.large = String(large); event.currentTarget.textContent = large ? '標準字級' : '放大字級'; }), mode, action('下載此篇 TXT', () => download(`${filename(meta.title)}${raw ? '_原始維基文字' : '_整理閱讀文字'}.txt`, `${meta.title}\n來源：${meta.sourceUrl || ''}\n固定版本：${meta.revisionUrl || ''}\n修訂歷史與貢獻者：${meta.historyUrl || '請由來源頁面的修訂歷史查閱'}\n署名：中文維基文庫及其貢獻者；古代原著作者依原頁記載。\n取得：${meta.retrievedAt || ''}\n授權：${textOf(book?.license)}\n適用的社群貢獻授權：CC BY-SA 4.0（https://creativecommons.org/licenses/by-sa/4.0/）；古代原著與各項貢獻的適用權利仍以來源說明為準。\n變更說明：${raw ? '原始轉錄維基文字，保存來源版本的標記內容，另加本檔出處與授權標頭。' : '機器整理的閱讀文字，從維基文字轉換；可能省略模板、表格、格式或轉引，未逐段校勘。另加本檔出處與授權標頭。'}\n${raw ? '原始維基文字' : '整理閱讀文字'}指紋：${raw ? meta.sha256 || '' : meta.textSha256 || ''}\n\n${raw ? doc.wikitext : doc.text}`)));
      append(body, controls, rawStatus, note('目前可切換機器整理的閱讀文字與保存的原始維基文字。整理可能省略模板、表格或轉引；重要判讀請一併核對原始維基文字、來源網頁和固定版本。'), text);
      function highlight() {
        exactQuery = input.value.trim(); hits = []; const sourceText = raw ? doc.wikitext : doc.text, positions = occurrence(sourceText, exactQuery); const marks = new Map();
        paragraphs = [...sourceText.matchAll(/[^\r\n]+/g)].filter(match => match[0].trim()).map(match => ({ text: match[0], start: match.index })); text.replaceChildren(); let firstPossible = 0;
        paragraphs.forEach((paragraph, index) => {
          const p = el('div', 'ar-reader-paragraph'); p.dataset.number = String(index + 1); p.dataset.sourceStart = String(paragraph.start); const end = paragraph.start + paragraph.text.length; let cursor = 0;
          while (firstPossible < positions.length && positions[firstPossible] + exactQuery.length <= paragraph.start) firstPossible += 1;
          for (let hitIndex = firstPossible; hitIndex < positions.length && positions[hitIndex] < end; hitIndex += 1) {
            const position = positions[hitIndex], from = Math.max(0, position - paragraph.start), to = Math.min(paragraph.text.length, position + exactQuery.length - paragraph.start); if (to <= from) continue;
            p.appendChild(document.createTextNode(paragraph.text.slice(cursor, from))); const mark = el('mark', '', paragraph.text.slice(from, to)); mark.tabIndex = -1; mark.dataset.sourceOffset = String(position); p.appendChild(mark); if (!marks.has(position)) marks.set(position, { node: mark, paragraph: p, offset: position }); cursor = to;
          }
          p.appendChild(document.createTextNode(paragraph.text.slice(cursor))); text.appendChild(p);
        });
        hits = positions.map(position => marks.get(position)).filter(Boolean); current = 0;
        if (!raw && exactQuery === str(search).trim() && Number.isSafeInteger(offset)) { const exact = hits.findIndex(hit => hit.offset === offset); if (exact >= 0) current = exact; }
        nextMatch(0, false);
      }
      function nextMatch(delta, scroll = true) { text.querySelectorAll('[data-current]').forEach(node => node.removeAttribute('data-current')); previous.disabled = !hits.length; next.disabled = !hits.length; if (!hits.length) { result.textContent = exactQuery ? '此篇沒有相同字串' : `${count(paragraphs.length)} 段文字`; return; } current = (current + delta + hits.length) % hits.length; const hit = hits[current]; hit.paragraph.dataset.current = 'true'; result.textContent = `${current + 1} / ${count(hits.length)} 處`; if (scroll) { hit.paragraph.scrollIntoView({ block: 'center' }); hit.node.focus({ preventScroll: true }); } }
      highlight(); if (search && hits.length) nextMatch(0);
    } catch (error) { if (error.name !== 'AbortError' && body.isConnected) { status.classList.add('ar-error'); status.textContent = `目前無法讀取收存原文：${error.message}。上方的來源位置與保存紀錄仍可查閱。`; body.appendChild(action('重新讀取此篇', () => openDocument(id, search, offset))); } }
  }

  function renderCoverage() {
    const panel = $('archivePanel'); append(panel, heading('涵蓋到哪裡，還缺什麼', '分別計算人物建檔、百科候選、身份核對、古籍收存與逐條主張。資料量不會自動變成每一個人物的生平查證完成率。'));
    const total = data.dossiers.length; const identity = Object.keys(IDENTITY_LABELS).map(status => [IDENTITY_LABELS[status], data.dossiers.filter(item => item.identityStatus === status).length, status]);
    const table = el('table', 'ar-report-table'); append(table, el('caption', '', '人物來源工作進度')); const head = el('thead'); const tr = el('tr'); ['身份檔案狀態', '原庫紀錄數', '閱讀方式'].forEach(label => tr.appendChild(el('th', '', label))); head.appendChild(tr); const tbody = el('tbody'); const descriptions = { reviewed: '有編輯核讀決定與依據；核對範圍以具體記錄為準。', candidate: '有百科候選頁，尚待核對是否符合原庫人物。', ambiguous: '候選不唯一、同名或原庫資訊仍有衝突。', unresolved: '此輪尚未取得足以使用的候選線索。' }; identity.forEach(([label, number, status]) => { const row = el('tr'); append(row, el('td', '', label), el('td', '', count(number)), el('td', '', descriptions[status])); tbody.appendChild(row); }); append(table, head, tbody); panel.appendChild(append(el('div', 'ar-report-table-wrap'), table));
    const withClaims = data.dossiers.filter(person => metric(person, 'claims')).length; const uniqueClaims = data.summary.uniqueClaimCount; const docCount = data.summary.downloadedDocuments; const chars = data.summary.corpusCharacters;
    const grid = el('div', 'ar-report-grid'); const boxes = [
      ['人物檔案', `${count(total)} 筆原庫紀錄，${count(new Set(data.dossiers.map(item => item.name)).size)} 個不同姓名。`, ['不同人物可能同名；同一人物也可能有多個原庫紀錄。', `${count(data.dossiers.filter(item => metric(item, 'candidates')).length)} 筆有百科候選頁；候選頁數不等於查證人數。`]],
      ['史證與文字命中', `${count(withClaims)} 筆紀錄連入已核主張${Number.isFinite(uniqueClaims) ? '，共 ' + count(uniqueClaims) + ' 條不重複主張' : ''}。`, [`${count(data.dossiers.filter(item => metric(item, 'matches')).length)} 筆在收存古籍有姓名字串。`, '同書不同篇、轉抄與後世整理不能直接算成獨立目擊證據。']],
      ['收存古籍庫', `${count(data.books.length)} 部目錄、${count(data.summary.documents)} 篇版本紀錄；${count(docCount)} 篇尚未標記缺文，共 ${count(chars)} 字元。`, [`另有 ${count(data.summary.incompleteDocuments)} 篇含缺表、圖字或其他待核材料，其現有文字也可搜尋。`, '字元數包含標點、編排文字等，不等於原典中文字數。', '沒有標記缺文不代表已逐字校勘；保存版本與史實核對分開看待。']],
      ['限定範圍的編輯核讀', `${count(data.dossiers.filter(person => metric(person, 'reviews') || metric(person, 'claims')).length)} 筆原卡連入編輯核讀或既有歷史主張。`, [`本館保存 ${count(data.reviews.length)} 組核讀記錄，每组列明支持事項、段落、查閱日期與限制。`, '由 Codex 輔助讀取整理，並非人類史學專家審定；同一筆原卡的其他敘述仍須另核。']],
      ['保存與再利用', `建置於 ${data.createdAt || '日期未提供'}；檔案館版本 ${data.archiveVersion || '未提供'}。`, ['保存來源網址、版本與 SHA-256，便於之後辨認內容是否更動。', '古籍原作與數位網站的轉錄、整理、圖像可能適用不同使用條件；依各來源欄位查閱。']]
    ]; boxes.forEach(([title, description, points]) => { const box = el('section', 'ar-report-box'); const ul = el('ul'); points.forEach(point => ul.appendChild(el('li', '', point))); append(box, el('h3', '', title), el('p', '', description), ul); grid.appendChild(box); }); panel.appendChild(grid);
    const types = [...new Set(data.dossiers.map(item => item.type))]; const breakdown = el('table', 'ar-report-table'); append(breakdown, el('caption', '', '原庫分類涵蓋')); const th = el('thead'); const thr = el('tr'); ['分類', '紀錄', '已核身份', '古籍姓名字串', '已核主張'].forEach(label => thr.appendChild(el('th', '', label))); th.appendChild(thr); const tb = el('tbody'); types.forEach(type => { const records = data.dossiers.filter(item => item.type === type); const row = el('tr'); [TYPE_LABELS[type] || type, records.length, records.filter(item => item.identityStatus === 'reviewed').length, records.filter(item => metric(item, 'matches')).length, records.filter(item => metric(item, 'claims')).length].forEach(value => row.appendChild(el('td', '', typeof value === 'number' ? count(value) : value))); tb.appendChild(row); }); append(breakdown, th, tb); panel.appendChild(append(el('div', 'ar-report-table-wrap'), breakdown));
    const failedBox = el('details', 'ar-disclosure'); append(failedBox, el('summary', '', '查看含缺文、待核或取得失敗的篇章'), note('按下按鈕後讀取篇章目錄。收存狀態與史實查證分開記錄。')); const failedList = el('div'); const reviewMissing = action('載入待核篇章目錄', async () => { reviewMissing.disabled = true; try { await loadDocumentCatalog(); if (!failedBox.isConnected) return; const failed = [...maps.documents.values()].filter(doc => doc.status !== 'downloaded'); failedList.replaceChildren(note('共 ' + count(failed.length) + ' 筆；下列先列 100 筆，完整狀態保留在完整來源索引中。')); failed.slice(0, 100).forEach(doc => append(failedList, append(el('p'), el('span', '', doc.title + ' · ' + statusLabel(doc.status) + ' '), link('查看原頁 ↗', doc.sourceUrl)))); reviewMissing.remove(); } catch (error) { failedList.replaceChildren(notice(error.message)); reviewMissing.disabled = false; reviewMissing.textContent = '重新讀取待核目錄'; } }); append(failedBox, reviewMissing, failedList); panel.appendChild(failedBox);
    append(panel, el('h3', '', '本次資料的限制')); const limitations = el('ul'); array(data.limitations).forEach(item => limitations.appendChild(el('li', '', textOf(item)))); panel.appendChild(limitations); if (!data.limitations.length) panel.appendChild(note('來源檔案仍需持續核對同名、年代、版本與逐條史實。'));
  }

  function showHelp() {
    const body = showDialog('如何使用來源檔案館');
    const definitions = [
      ['01 · 人物檔案', '先用原庫人物名字搜尋，查看身份核對記錄，再展開百科候選與古籍姓名字串。原庫分類、朝代與文章標題是找人的線索。'],
      ['02 · 來源書目', '看來源的提供者、版本、取得狀態和再利用說明。保留下來的外部連結仍可能失效，請同時保留篇章定位。'],
      ['03 · 原文閱覽', '選書查精確字串，或進篇章目錄讀全文。可在篇內跳到上一處／下一處、放大字級、下載帶出處的文字。'],
      ['04 · 涵蓋報告', '分開看建檔、候選、核對和全文取得的數量。具體主張的核對不能由百科頁或姓名命中數取代。'],
      ['帶走材料', '完整來源索引是另行下載的大檔，保存書目與人物對應關係；人物可另下載引用清單。平常閱覽只讀所需人物與單篇文字，首頁清單不冒充完整備份。']
    ]; definitions.forEach(([title, description]) => append(body, append(el('div', 'ar-status-definition'), el('strong', '', title), el('p', '', description)))); body.appendChild(notice('瀏覽與搜尋均在本頁完成，沒有呼叫模型。點擊外部來源連結，會由瀏覽器開啟該提供者的網站。'));
  }
  function validate(value) {
    if (!value || value.format !== 'dynasty-source-web' || value.schemaVersion !== 1 || typeof value.version !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(value.version)) throw new Error('檔案館網站格式或版本不符。');
    for (const field of ['dossiers', 'sources', 'books', 'reviews', 'limitations']) if (!Array.isArray(value[field])) throw new Error('檔案館缺少 ' + field + ' 目錄。');
    for (const [list, key] of [['dossiers', 'recordId'], ['sources', 'id'], ['books', 'id'], ['reviews', 'id']]) { const ids = new Set(); value[list].forEach(item => { if (!item || !str(item[key]) || ids.has(str(item[key]))) throw new Error(list + ' 有空白或重複 ID。'); ids.add(str(item[key])); }); }
    if (!value.summary || !value.search || value.search.version !== value.version) throw new Error('檔案館統計或搜尋版本缺失。');
    const prefix = '/static/data/history/web/releases/' + value.version + '/'; const paths = [value.documentCatalogPath, value.search.documentsPath, value.search.bigrams?.pathTemplate?.replace('{shard}', '00'), value.search.unigrams?.pathTemplate?.replace('{shard}', '00')];
    if (paths.some(path => typeof path !== 'string' || !path.startsWith(prefix) || path.includes('..') || !/^\/static\/data\/history\/web\/releases\/[a-zA-Z0-9._/-]+\.json$/.test(path))) throw new Error('檔案館索引位置不在目前版本內。');
    if (value.exportPath !== '/static/data/history/source-archive.v1.json') throw new Error('完整來源索引位置不符。');
    return value;
  }
  async function exportArchive() {
    if (!data) return; const button = $('archiveExport'), label = button.textContent; button.disabled = true; button.textContent = '正在取得完整來源索引…';
    try { const response = await fetch(data.exportPath, { credentials: 'same-origin' }); if (!response.ok) throw new Error('HTTP ' + response.status); const blob = await response.blob(); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'dynasty-source-archive-' + str(data.createdAt).slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('完整來源索引已準備下載；古籍全文仍為各篇獨立檔案。'); }
    catch (error) { toast('完整索引未能下載：' + error.message + '。請重試；沒有以首頁清單代替。'); }
    finally { button.disabled = false; button.textContent = label; }
  }
  async function load() {
    const generation = ++loadGeneration; $('archiveStatus').className = 'ar-status'; $('archiveStatus').textContent = '正在開啟來源目錄…'; $('archivePanel').setAttribute('aria-busy', 'true');
    try {
      const value = validate(await fetchJSON(DATA_URL)); if (generation !== loadGeneration) return; data = value; personCache.clear(); contentCache.clear(); bookCache.clear(); catalogLoaded = false; documentCatalogPromise = null;
      maps = { people: new Map(data.dossiers.map(item => [str(item.recordId), item])), sources: new Map(data.sources.map(item => [item.id, item])), books: new Map(data.books.map(item => [item.id, item])), documents: new Map(), reviews: new Map(data.reviews.map(item => [item.id, item])) };
      $('archiveStatus').textContent = `已開啟 ${count(data.dossiers.length)} 筆人物檔案與 ${count(data.sources.length)} 筆來源書目。建置日期 ${str(data.createdAt).slice(0, 10)}；候選線索、全文命中與已核主張分別標示。`; $('archiveTabs').hidden = false; $('archiveExport').disabled = false; $('archivePanel').setAttribute('aria-busy', 'false'); renderMetrics(); const params = routeState(); render(); if (params.has('person')) openPerson(params.get('person')); else if (params.has('source')) openSource(params.get('source')); else if (params.has('doc')) openDocument(params.get('doc'), params.get('find')); else if (params.has('book')) openBook(params.get('book'));
    } catch (error) { if (generation !== loadGeneration) return; $('archiveStatus').className = 'ar-status ar-error'; $('archiveStatus').replaceChildren(document.createTextNode(`來源目錄暫時無法開啟：${error.message}。`), action('重新讀取', load)); $('archivePanel').setAttribute('aria-busy', 'false'); $('archivePanel').replaceChildren(empty('檔案內容尚未載入', '已保留這個頁面。請確認網路連線，再按「重新讀取」。')); }
  }
  function init() {
    if (new URLSearchParams(location.search).get('local') === '1') $('archiveLabLink').href = '/history-lab.html?local=1';
    $('archiveHelp').addEventListener('click', showHelp); $('archivePrint').addEventListener('click', () => window.print()); $('archiveExport').addEventListener('click', exportArchive);
    $('archiveTabs').addEventListener('click', event => { const tab = event.target.closest('[data-tab]'); if (tab) setTab(tab.dataset.tab); });
    $('archiveTabs').addEventListener('keydown', event => { const tabs = [...$('archiveTabs').querySelectorAll('[role="tab"]')]; const index = tabs.indexOf(document.activeElement); let next = index; if (event.key === 'ArrowRight') next = (index + 1) % tabs.length; else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = tabs.length - 1; else return; event.preventDefault(); tabs[next].focus(); setTab(tabs[next].dataset.tab); });
    $('archiveDialog').addEventListener('click', event => { if (event.target === $('archiveDialog')) closeDialog(); });
    document.addEventListener('keydown', event => { if (!currentModal) return; if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; } if (event.key !== 'Tab') return; const controls = [...currentModal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')].filter(node => !node.hidden && !node.closest('[hidden]') && (!node.closest('details:not([open])') || node.tagName === 'SUMMARY')); if (!controls.length) { event.preventDefault(); currentModal.focus(); return; } const first = controls[0], last = controls[controls.length - 1]; if (event.shiftKey && (document.activeElement === first || !currentModal.contains(document.activeElement))) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && (document.activeElement === last || !currentModal.contains(document.activeElement))) { event.preventDefault(); first.focus(); } });
    window.addEventListener('hashchange', () => { if (!data) return; closeDialog(false); const params = routeState(); render(); if (params.has('person')) openPerson(params.get('person')); else if (params.has('source')) openSource(params.get('source')); else if (params.has('doc')) openDocument(params.get('doc'), params.get('find')); else if (params.has('book')) openBook(params.get('book')); });
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
}());
