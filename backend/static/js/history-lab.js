(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const MODE_NAMES = { cases: '案卷館', explore: '時空探索', library: '人物原典', investigate: '自由調查', cast: '創作工坊' };
  const TYPE_NAMES = { emperor: '帝王類', general: '將帥類', minister: '謀臣類' };
  const FIELD_NAMES = { analysis: '人物分析', deepAnalysis: '深度分析', soulEssence: '人格精髓' };
  const READER_FIELDS = { ...FIELD_NAMES, desc: '人物簡介', poem: '人物詩文' };
  const PARTICIPATION = { present: '記述在場', 'reported-action': '有行動記述，未判定同室', mentioned: '只是提及，未證在場', unknown: '參與方式待考' };
  const EPISTEMIC = { 'source-report': '史籍記述', 'editorial-synthesis': '編輯整理', 'modern-identification': '現代定位' };
  const REVIEW = { 'source-checked': '出處已核讀', 'cross-checked': '跨出處核對', disputed: '保留異說', provisional: '暫定／待核' };
  const CLASSIFICATIONS = [ ['support', '支持我的解釋'], ['challenge', '質疑我的解釋'], ['context', '補充脈絡'], ['unclear', '尚不能判斷'] ];
  const RELATION_NAMES = { serves: '效力於', cooperates: '協作', opposes: '對立', controls: '控制', advises: '建議', recommends: '推薦', kinship: '親屬關係', negotiates: '交涉' };
  const state = {
    index: null, pkg: null, mode: 'cases', library: [], libraryOrigin: '內建人物庫',
    loadSequence: 0, librarySequence: 0, libraryBusy: false, libraryError: '',
    selectedEventId: '', filter: null, questions: [], questionId: '', investigations: new Map(),
    materialSearch: '', includeAllMaterials: false, castEventId: '', cast: new Set(), castSearch: '', castNotes: '',
    dialogPersonId: '', dialogQuestionId: '', dialogReturnFocus: null, dialogPreviousHidden: null, dialogPreviousInert: false,
    engine: null, casebook: null, activeCaseView: '', chapterViews: new Map(), taskDrafts: new Map(),
    librarySearch: '', libraryType: '', libraryTextFilter: '', libraryPage: 1, compare: new Set(),
    importPreview: null, persistTimer: null, toastTimer: null, archiveView: '', caseError: '', pendingDrafts: new Map()
  };
  let H, I;
  const baseRecords = typeof staticLegendsData !== 'undefined' && Array.isArray(staticLegendsData) ? staticLegendsData : [];
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function add(parent, ...nodes) { nodes.filter(Boolean).forEach(node => parent.appendChild(node)); return parent; }
  function button(label, action, className, id) {
    const node = el('button', className || 'lab-button', label); node.type = 'button';
    if (id) node.id = id;
    node.addEventListener('click', action); return node;
  }
  function detail(title, className) {
    const node = el('details', className); add(node, el('summary', '', title)); return node;
  }
  function note(text, emphasis) { return el('p', emphasis ? 'lab-emphasis' : 'lab-note', text); }
  function chip(text, caution) { return el('span', 'lab-chip' + (caution ? ' lab-chip-caution' : ''), text); }
  function panel(title, className) { return add(el('section', 'lab-panel' + (className ? ' ' + className : '')), el('h3', '', title)); }
  function selectField(title, id, options, value, change, wide) {
    const label = el('label', 'lab-field' + (wide ? ' lab-field-wide' : ''), title);
    const select = el('select'); select.id = id;
    options.forEach(([idValue, text]) => { const option = el('option', '', text); option.value = idValue; add(select, option); });
    select.value = String(value); select.addEventListener('change', () => change(select.value));
    return add(label, select);
  }
  function textField(title, id, value, change, multiline) {
    const label = el('label', 'lab-field lab-field-wide', title);
    const input = el(multiline ? 'textarea' : 'input'); input.id = id; input.value = state.pendingDrafts.has(id) ? state.pendingDrafts.get(id).value : value;
    if (multiline) input.maxLength = 20000;
    if (state.pendingDrafts.has(id)) input.setAttribute('aria-invalid', 'true');
    if (!multiline) input.type = 'search';
    input.addEventListener('input', () => change(input.value)); return add(label, input);
  }
  function checkbox(title, id, checked, action) {
    const label = el('label', 'lab-checkbox'); const input = el('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
    input.addEventListener('change', () => action(input.checked)); return add(label, input, el('span', '', title));
  }
  function entityName(id) { const entity = state.index.get(id); return entity ? entity.name || entity.title : id; }
  function personButton(personId, eventId, label) {
    const node = button(label || entityName(personId), () => openPerson(personId, eventId), 'lab-inline-person');
    node.dataset.personId = personId; return node;
  }
  function yearFromOrdinal(value) { return value < 1 ? { era: 'BCE', year: 1 - value } : { era: 'CE', year: value }; }
  function years() {
    const start = H.yearOrdinal(state.pkg.coverage.window.start), end = H.yearOrdinal(state.pkg.coverage.window.end);
    // The page is an authored historical slice; avoid generating huge controls for an erroneous broad package.
    if (end - start > 200) throw new Error('本頁支援最多二百年的比較切片；目前資料範圍過大。');
    return Array.from({ length: end - start + 1 }, (_, i) => [String(start + i), H.formatYear(yearFromOrdinal(start + i))]);
  }
  function preserveFocus(renderFn) {
    const active = document.activeElement, id = active && active.id;
    const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    renderFn(); const replacement = id ? $(id) : null;
    if (replacement && !replacement.disabled) { replacement.focus(); if (selection && typeof replacement.setSelectionRange === 'function') replacement.setSelectionRange(...selection); }
  }
  function render() {
    if (!state.index) return;
    preserveFocus(() => {
      document.querySelectorAll('#labTabs [role="tab"]').forEach(tab => {
        const selected = tab.dataset.mode === state.mode;
        tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      });
      const mount = $('labModePanel'); mount.replaceChildren(); mount.setAttribute('aria-labelledby', 'lab-tab-' + state.mode);
      const descriptions = {
        cases: '選一份案卷，追查人物的行動與史書的分歧。閱讀材料、核對細節，最後寫下有依據的解釋。',
        library: '搜尋整個人物庫，保留每個身份條目的原文。選取段落放入案卷，也能同時對讀二至三份記錄。',
        explore: '選時間區間，再沿人物、古地名與勢力追查事件。年份換算未定的材料保留範圍。',
        investigate: '自選史料與原庫分析段落，排列支持、質疑與脈絡，再留下你的判斷。沒有標準心理答案或 AI 分數。',
        cast: '把人物安排到一件事件，核對各人的當時角色與記述方式。未列入本包不等於不能參與。'
      };
      add(mount, add(el('header', 'lab-mode-heading'), add(el('div'), el('h2', '', MODE_NAMES[state.mode]), el('p', '', descriptions[state.mode])), el('span', 'lab-mode-number', { cases: '壹', explore: '貳', library: '參', investigate: '肆', cast: '伍' }[state.mode])));
      if (state.mode === 'cases') renderCases(mount);
      else if (state.mode === 'library') renderLibrary(mount);
      else if (state.mode === 'explore') renderExplore(mount);
      else if (state.mode === 'investigate') renderInvestigate(mount);
      else renderCast(mount);
      mount.setAttribute('aria-busy', 'false');
    });
  }
  function renderCoverage() {
    const pkg = state.pkg, mount = $('labPackageSummary'); mount.replaceChildren();
    const stats = el('div', 'lab-stat-grid');
    [[pkg.events.length, '件事件'], [pkg.persons.length, '位人物'], [pkg.places.length, '處古地名'], [pkg.sources.length, '項來源']].forEach(([count, label]) => add(stats, add(el('div', 'lab-stat'), el('strong', '', count), el('span', '', label))));
    const coverage = detail(pkg.title + ' · ' + H.formatYear(pkg.coverage.window.start) + '至' + H.formatYear(pkg.coverage.window.end) + '｜展開範圍與缺漏', 'lab-coverage');
    add(coverage, el('p', '', pkg.coverage.target), el('p', '', '版本：' + pkg.packageVersion + '；選定事件切片，不代表人物庫全體已完成歷史資料化。'));
    [['選取原則', pkg.coverage.selection], ['尚未涵蓋', pkg.coverage.excluded], ['待補資料', pkg.coverage.missing]].forEach(([label, list]) => {
      add(coverage, el('p', '', label)); const ul = el('ul'); list.forEach(text => add(ul, el('li', '', text))); add(coverage, ul);
    });
    [pkg.coverage.datePolicy, pkg.coverage.geographyPolicy, pkg.coverage.economyPolicy, pkg.librarySnapshot.roleIdentityPolicy].forEach(text => add(coverage, el('p', '', text)));
    coverage.insertBefore(stats, coverage.children[1] || null); add(mount, coverage);
  }
  function allArticleFields(record) { return Object.keys(FIELD_NAMES).filter(field => typeof record[field] === 'string' && record[field].trim()); }
  function updateLibraryStatus() {
    if (!H) return;
    const articleCount = state.library.filter(record => allArticleFields(record).length).length;
    let linked = 0, expected = 0;
    if (state.index) state.pkg.persons.forEach(person => { const matches = state.index.originalRecords(person.id, state.library); expected += matches.length; linked += matches.filter(m => m.status === 'matched').length; });
    $('labLibraryStatus').textContent = state.libraryBusy ? '正在本頁讀取人物資料…' : state.libraryOrigin + '：' + state.library.length + '筆，' + articleCount + '筆含分析文字' + (state.index ? '；本包原庫身份連結 ' + linked + '／' + expected + ' 已對上。' : '。');
    const caption = document.querySelector('.lab-library-caption');
    caption.classList.toggle('lab-inline-error', Boolean(state.libraryError));
    caption.textContent = state.libraryError || '人物全文只在本頁記憶體讀取，不上傳。書桌自動存於本機瀏覽器，保存進度、筆記與原文引用位置；不保存人物全文。';
  }
  function renderEvidence(claimIds, open) {
    const container = el('div');
    state.index.evidence([...new Set(claimIds)]).forEach(claim => {
      const card = detail(claim.statement, 'lab-evidence'); card.dataset.claimId = claim.id; if (open) card.open = true;
      card.addEventListener('toggle', () => { if (card.open && state.engine && state.activeCaseView) safeEngine(() => state.engine.openEvidence(state.activeCaseView, claim.id)); });
      add(card, add(el('div', 'lab-meta'), chip(EPISTEMIC[claim.epistemic]), chip(REVIEW[claim.review], claim.review === 'disputed' || claim.review === 'provisional')));
      add(card, el('p', 'lab-evidence-statement', claim.statement), note('原紀年：' + claim.time.original + '｜' + H.formatTime(claim.time)));
      if (claim.time.note) add(card, note(claim.time.note));
      if (claim.caveat) add(card, note(claim.caveat, true));
      claim.alternatives.forEach(text => add(card, el('p', 'lab-evidence-alternative', '異說：' + text)));
      claim.sources.forEach(evidence => {
        const citation = el('div', 'lab-citation'); const source = evidence.source;
        if (source) {
          let safeURL = null; try { const url = new URL(source.url); if (['https:', 'http:'].includes(url.protocol)) safeURL = url.href; } catch (_) { /* Plain text remains available for a malformed source. */ }
          if (safeURL) { const link = el('a', '', source.work + ' · ' + source.section + ' ↗'); link.href = safeURL; link.target = '_blank'; link.rel = 'noopener noreferrer'; add(citation, link); }
          else add(citation, el('span', '', source.work + ' · ' + source.section));
          add(citation, el('p', '', evidence.locator));
          if (evidence.excerpt) add(citation, el('blockquote', '', evidence.excerpt));
          if (source.editionNote || source.limitations) { const sourceNote = detail('版本與引用限制'); add(sourceNote, el('p', '', source.editionNote), el('p', '', source.limitations)); add(citation, sourceNote); }
        } else add(citation, note('此出處未能載入。'));
        add(card, citation);
      });
      add(container, card);
    });
    if (!container.children.length) add(container, note('本項尚無已連結的史料主張。'));
    return container;
  }
  function filteredEvents() {
    const filter = state.filter, start = Number(filter.from), end = Number(filter.to);
    if (start > end) return [];
    const events = new Map();
    for (let year = start; year <= end; year++) {
      state.index.eventsAt(yearFromOrdinal(year), filter).forEach(event => events.set(event.id, event));
    }
    return state.pkg.events.filter(event => events.has(event.id)).map(event => events.get(event.id));
  }
  function renderExplore(mount) {
    const layout = el('div', 'lab-layout'), left = el('div', 'lab-column'), right = el('div', 'lab-column');
    const filters = panel('從哪裡開始？'), fields = el('div', 'lab-fields');
    const change = key => value => { state.filter[key] = value; persistWorkspace(); render(); };
    add(fields, selectField('區間起點', 'labYearFrom', years(), state.filter.from, change('from')),
      selectField('區間終點', 'labYearTo', years(), state.filter.to, change('to')),
      selectField('人物（含只是被提及者）', 'labFilterPerson', [['', '全部人物'], ...state.pkg.persons.map(p => [p.id, p.name])], state.filter.personId, change('personId'), true),
      selectField('古地名', 'labFilterPlace', [['', '全部地點'], ...state.pkg.places.map(p => [p.id, p.name])], state.filter.placeId, change('placeId')),
      selectField('事件脈絡中的勢力', 'labFilterFaction', [['', '全部勢力'], ...state.pkg.factions.map(f => [f.id, f.name])], state.filter.factionId, change('factionId')));
    add(filters, fields, checkbox('也列年代未定的事件', 'labIncludeUnknown', state.filter.includeUnknown, value => { state.filter.includeUnknown = value; persistWorkspace(); render(); }), note('區間相交僅表示可能涉及；不把保守年帶改成精確年表。'));
    const events = filteredEvents();
    if (Number(state.filter.from) > Number(state.filter.to)) add(filters, note('起點須早於或等於終點。請調整年份區間。', true));
    const list = el('div', 'lab-event-list'); list.setAttribute('aria-label', '符合篩選的事件');
    if (!events.some(event => event.id === state.selectedEventId)) state.selectedEventId = events[0] ? events[0].id : '';
    add(filters, note(events.length + '件符合目前篩選。'));
    events.forEach(event => {
      const choice = button('', () => { state.selectedEventId = event.id; persistWorkspace(); render(); }, 'lab-event-choice', 'labEvent-' + event.id.replace(/[^a-z0-9-]/gi, '-'));
      choice.dataset.eventId = event.id; choice.setAttribute('aria-pressed', String(state.selectedEventId === event.id));
      add(choice, el('span', 'lab-time', H.formatTime(event.time)), el('strong', '', event.title), el('small', '', event.yearMatch === 'confirmed' ? '年份已核對' : event.yearMatch === 'unknown' ? '年代未定，另列材料' : '可能涉及所選區間'), el('small', '', event.placeIds.map(entityName).join(' · ')));
      add(list, choice);
    });
    if (!events.length) add(list, note('此篩選沒有記錄；這反映本包覆蓋範圍，不能證明歷史上沒有事件。'));
    add(filters, list); add(left, filters);
    if (state.filter.placeId) add(left, entityDetail(state.filter.placeId));
    if (state.filter.factionId) add(left, entityDetail(state.filter.factionId));
    if (state.selectedEventId) add(right, eventDetail(state.index.get(state.selectedEventId)));
    else add(right, panel('先選一件事件'), note('調整左側篩選，查看原紀年、當時職任、關係與出處。'));
    add(mount, add(layout, left, right));
  }
  function entityDetail(id) {
    const entity = state.index.get(id), section = panel(entity.name);
    if (entity.aliases.length) add(section, note('別名：' + entity.aliases.join('、')));
    if (id.startsWith('place:')) add(section, note(entity.modernIdentification || '尚未完成現代定位。'), note(entity.coordinates ? '本包有附定位資料；本頁不由此推算行軍距離。' : '未提供精確座標；地名不等於可計算的地圖點。'));
    if (entity.time) add(section, note(H.formatTime(entity.time)));
    if (entity.note) add(section, note(entity.note, true));
    add(section, renderEvidence(entity.claimIds)); return section;
  }
  function eventDetail(event) {
    const section = panel(event.title); section.dataset.eventDetail = event.id;
    add(section, el('p', 'lab-time', H.formatTime(event.time)), el('p', 'lab-event-summary', event.summary), note('原紀年：' + event.time.original));
    if (event.time.note) add(section, note(event.time.note, true));
    if (event.orderAfter.length) add(section, note('資料記述的先後：接續 ' + event.orderAfter.map(entityName).join('、') + '；' + event.orderingNote));
    else if (event.orderingNote) add(section, note(event.orderingNote));
    if (event.note) add(section, note(event.note));
    add(section, add(el('div', 'lab-meta'), ...event.placeIds.map(id => chip(entityName(id)))));
    add(section, eventSchematic(event));
    add(section, el('h4', '', '人物在此事件的記述'));
    event.contexts.forEach(context => {
      const row = el('div', 'lab-context');
      add(row, add(el('div', 'lab-context-heading'), personButton(context.personId, event.id), chip(PARTICIPATION[context.participation], ['mentioned', 'unknown'].includes(context.participation))),
        el('p', '', context.role + (context.factionId ? '｜' + entityName(context.factionId) : '｜未指定已核勢力')));
      if (context.note) add(row, note(context.note)); add(section, row);
    });
    add(section, note('同一事件的行動記述不等於人物同處一室；人物名稱可開啟原庫全文。', true));
    add(section, el('div', 'lab-subsection'), el('h4', '', '事件主張與來源'), renderEvidence([...event.claimIds, ...event.contexts.flatMap(context => context.claimIds)]));
    add(section, relatedMaterials(event)); return section;
  }
  function overlaps(a, b) {
    if (a.precision === 'unknown' || b.precision === 'unknown') return false;
    return H.yearOrdinal(a.earliest) <= H.yearOrdinal(b.latest) && H.yearOrdinal(b.earliest) <= H.yearOrdinal(a.latest);
  }
  function relatedMaterials(event) {
    const container = el('div');
    const relations = state.pkg.relations.filter(relation => relation.eventId === event.id);
    if (relations.length) {
      const section = detail('此事件有依據的關係 · ' + relations.length + '項', 'lab-subsection');
      relations.forEach(relation => add(section, el('p', 'lab-relation', entityName(relation.fromId) + ' → ' + RELATION_NAMES[relation.type] + ' → ' + entityName(relation.toId)), note(relation.note), renderEvidence(relation.claimIds)));
      add(container, section);
    }
    const routes = state.pkg.routes.filter(route => route.eventId === event.id);
    if (routes.length) {
      const section = detail('原文記述的移動與輸送', 'lab-subsection');
      routes.forEach(route => add(section, el('p', 'lab-relation', entityName(route.fromPlaceId) + ' → ' + entityName(route.toPlaceId) + '｜' + (route.kind === 'reported-supply' ? '供給路線' : '人物／軍隊移動')), note(route.distanceKm === null ? '距離未核，不計算里程或回合。' : '距離資料：' + route.distanceKm + '公里；須連同來源閱讀。'), note(route.note), renderEvidence(route.claimIds)));
      add(container, section);
    }
    const economy = state.pkg.economy.filter(item => overlaps(item.time, event.time) && item.placeIds.some(id => event.placeIds.includes(id)));
    if (economy.length) {
      const section = detail('同地同時期的供給／行政材料', 'lab-subsection');
      add(section, note('供給機制的定性材料，不代表本事件已有精確庫存或兵力計算。', true));
      economy.forEach(item => add(section, el('h4', '', item.title), note(item.mechanism), note(item.note), ...item.quantities.map(quantity => note('史料數字／估計：' + quantity.value + quantity.unit + '；' + quantity.note)), renderEvidence(item.claimIds)));
      add(container, section);
    }
    return container;
  }
  function createQuestions() {
    const questions = state.pkg.disputes.map(dispute => ({ id: dispute.id, title: dispute.title, claimIds: dispute.claimIds, note: dispute.note, type: '記述分歧' }));
    state.pkg.events.forEach(event => questions.push({ id: 'roles:' + event.id, title: event.title + '：各人的職任與參與如何確認？', claimIds: [...new Set([...event.claimIds, ...event.contexts.flatMap(context => context.claimIds)])], note: '比較行動、被提及與在場記述；不要從人物後來的名號倒推當時身份。', type: '角色與脈絡' }));
    state.investigations.forEach((value, id) => { if (!questions.some(question => question.id === id)) questions.push({ id, title: '保留的自由調查 · ' + id, claimIds: [...value.materials.values()].filter(material => material.kind === 'claim').map(material => material.claimId || material.id), note: '這份筆記來自匯入或先前保留的工作，可繼續編寫。', type: '保留的調查' }); });
    return questions;
  }
  function investigation(questionId) {
    if (!state.investigations.has(questionId)) state.investigations.set(questionId, { materials: new Map(), conclusion: '', certainty: 'open' });
    return state.investigations.get(questionId);
  }
  function renderInvestigate(mount) {
    if (!state.questions.length) { add(mount, note('這份切片尚無可供調查的事件或異說。')); return; }
    const question = state.questions.find(item => item.id === state.questionId) || state.questions[0]; state.questionId = question.id;
    const layout = el('div', 'lab-layout'), left = el('div', 'lab-column'), right = el('div', 'lab-column');
    const selection = panel('選一個問題');
    add(selection, selectField('調查題目', 'labQuestion', state.questions.map(q => [q.id, q.title]), question.id, value => { state.questionId = value; state.materialSearch = ''; render(); }, true), note(question.type + '｜' + question.note, true));
    const reader = el('div', 'lab-fields');
    const firstPerson = state.pkg.persons[0];
    add(reader, selectField('從原人物分析選取段落', 'labInvestigatePerson', state.pkg.persons.map(person => [person.id, person.name]), firstPerson ? firstPerson.id : '', () => {}, true));
    const readButton = button('開啟全文與段落選取', () => { const select = $('labInvestigatePerson'); if (select.value) openPerson(select.value); }, 'lab-button'); readButton.disabled = !firstPerson;
    add(selection, reader, readButton, note('原庫作者／AI 解讀可加入調查，但不能自動當作已核史實；不用答題才能看原文。'));
    add(left, selection);
    const pool = panel('可選史料材料');
    add(pool, checkbox('搜尋整份資料包，尋找反證或其他脈絡', 'labAllMaterials', state.includeAllMaterials, checked => { state.includeAllMaterials = checked; render(); }), textField('搜尋主張文字', 'labMaterialSearch', state.materialSearch, value => { state.materialSearch = value; updateMaterialPool(); }));
    const poolMount = el('div'); poolMount.id = 'labMaterialPool'; add(pool, poolMount); add(left, pool);
    const workbench = panel('我的調查桌', 'lab-workbench'); workbench.id = 'labWorkbench'; add(right, workbench);
    add(mount, add(layout, left, right)); updateMaterialPool(); updateWorkbench();
  }
  function updateMaterialPool() {
    const mount = $('labMaterialPool'); if (!mount) return; mount.replaceChildren();
    const question = state.questions.find(item => item.id === state.questionId), current = investigation(state.questionId);
    const allowed = new Set(question.claimIds), query = state.materialSearch.trim().toLocaleLowerCase();
    const claims = state.pkg.claims.filter(claim => (state.includeAllMaterials || allowed.has(claim.id)) && (!query || (claim.statement + claim.caveat + claim.alternatives.join(' ')).toLocaleLowerCase().includes(query)));
    add(mount, note(claims.length + '項材料；選擇數量不會轉換成答案分數。'));
    claims.forEach(claim => {
      const card = el('article', 'lab-material-card'); card.dataset.materialClaimId = claim.id;
      const selected = current.materials.has(claim.id);
      add(card, renderEvidence([claim.id]), button(selected ? '已在調查桌' : '加入調查桌', () => {
        current.materials.set(claim.id, { kind: 'claim', id: claim.id, classification: 'unclear' }); persistWorkspace(); updateMaterialPool(); updateWorkbench();
      }, 'lab-button', 'labAdd-' + claim.id.replace(/[^a-z0-9-]/gi, '-')));
      card.lastChild.disabled = selected; add(mount, card);
    });
    if (!claims.length) add(mount, note('沒有符合的材料。可清除搜尋或擴大到全包；本頁不會補寫不存在的史料。'));
  }
  function originalKey(recordId, field, paragraphIndex) { return 'original:' + recordId + ':' + field + ':' + paragraphIndex; }
  function paragraphs(text) {
    if (I) return I.paragraphs(text);
    const blocks = text.split(/\r?\n\s*\r?\n/).filter(value => value.trim());
    return blocks.length > 1 ? blocks : text.split(/\r?\n/).filter(value => value.trim());
  }
  function updateWorkbench() {
    const mount = $('labWorkbench'); if (!mount) return; const current = investigation(state.questionId);
    preserveFocus(() => {
      mount.replaceChildren(el('h3', '', '我的調查桌'));
      const materials = [...current.materials.entries()], sourceIds = new Set(), works = new Set();
      let disputed = 0, originalCount = 0;
      materials.forEach(([, material]) => {
        if (material.kind !== 'claim') { originalCount++; return; }
        const claim = state.index.evidence([material.id])[0];
        if (claim.review === 'disputed' || claim.alternatives.length) disputed++;
        claim.sources.forEach(evidence => { sourceIds.add(evidence.sourceId); if (evidence.source) works.add(evidence.source.work); });
      });
      add(mount, el('p', 'lab-source-tally', materials.length + '項材料｜' + sourceIds.size + '項來源／' + works.size + '部著作或報告｜' + disputed + '項保留異說｜' + originalCount + '段原庫解讀'), note('同書的不同章節不一定是獨立來源。材料分類由你決定；完整度與分歧只供觀察，不是答案或人格評分。'));
      if (!materials.length) add(mount, note('從左側史料或人物原分析選取材料，開始建立你的解釋。', true));
      materials.forEach(([key, material], index) => {
        const card = el('article', 'lab-selected-material'); card.dataset.materialKey = key;
        if (material.kind === 'claim') add(card, chip('史料主張'), renderEvidence([material.id]));
        else {
          add(card, chip('原庫作者／AI 解讀 · 未核史實', true), el('p', '', (material.recordName || '原庫人物') + '｜' + (TYPE_NAMES[material.recordType] || '分類待核') + '｜' + READER_FIELDS[material.field] + ' 第' + (material.paragraphIndex + 1) + '段'), note('原始 ID：' + material.recordId + '；欄位：' + material.field));
          const resolved = I ? I.resolveOriginalReference(material, state.library, state.pkg) : { status: 'matched', text: material.text }, quoted = detail('展開選取段落');
          if (resolved.status === 'matched') add(quoted, el('pre', 'lab-original-text', resolved.text)); else add(quoted, note(resolved.message || '請重新載入原人物檔並核對引用。', true));
          add(card, quoted, note('引用記錄原文版本。檔案變更時會提示重新選取，不默默更換材料。'));
        }
        const tools = el('div', 'lab-material-tools');
        const label = el('label', '', '我把它視為 '); const select = el('select'); select.id = 'labClassify-' + index; select.setAttribute('aria-label', '第' + (index + 1) + '項材料分類');
        CLASSIFICATIONS.forEach(([value, text]) => { const option = el('option', '', text); option.value = value; add(select, option); }); select.value = material.classification;
        select.addEventListener('change', () => { material.classification = select.value; persistWorkspace(); }); add(label, select);
        add(tools, label, button('移除', () => { current.materials.delete(key); persistWorkspace(); updateMaterialPool(); updateWorkbench(); }, 'lab-button lab-button-quiet')); add(card, tools); add(mount, card);
      });
      add(mount, textField('我的判斷與尚未解決的疑問', 'labConclusion', current.conclusion, value => { current.conclusion = value; persistWorkspace(); }, true),
        selectField('目前判斷狀態（由我標記）', 'labCertainty', [['open', '仍待查證'], ['tentative', '暫有解釋，保留異說'], ['enough-for-now', '目前材料足以支持我的說明']], current.certainty, value => { current.certainty = value; persistWorkspace(); }, true),
        note('下載比較記錄可保留筆記與材料索引。人物段落只記 ID、欄位與段號，不放入原文。'));
    });
  }
  function renderCast(mount) {
    const event = state.index.get(state.castEventId), layout = el('div', 'lab-layout'), left = el('div', 'lab-column'), right = el('div', 'lab-column');
    const selection = panel('安排哪些人物？');
    add(selection, selectField('事件', 'labCastEvent', state.pkg.events.map(item => [item.id, item.title]), state.castEventId, value => { state.castEventId = value; persistWorkspace(); render(); }, true), note(event ? H.formatTime(event.time) : '尚無事件'));
    add(selection, note('可選的是本包人物，並非已把全部人物庫轉換成可編排角色。跨事件保留所選人物，便於比較身份變化。'), textField('搜尋本包人物', 'labCastSearch', state.castSearch, value => { state.castSearch = value; updateRoster(); }));
    const roster = el('div', 'lab-roster'); roster.id = 'labRoster'; add(selection, roster);
    add(selection, button('清空人物選擇', () => { state.cast.clear(); persistWorkspace(); updateRoster(); updateCastResult(); }, 'lab-button lab-button-quiet'), note('你可以嘗試未被本事件記載的人物；頁面會保留這個資料缺口。'));
    add(left, selection);
    const results = panel('編排後的史料核對'); results.id = 'labCastResults'; add(right, results);
    add(right, add(panel('我的編排想法'), textField('想呈現的互動，以及哪些只是我的創作', 'labCastNotes', state.castNotes, value => { state.castNotes = value; persistWorkspace(); }, true), note('本頁核對角色與參與記述，不會自動生成對白、人格或勝負。')));
    add(mount, add(layout, left, right)); updateRoster(); updateCastResult();
  }
  function updateRoster() {
    const mount = $('labRoster'); if (!mount) return; mount.replaceChildren();
    const query = state.castSearch.trim().toLocaleLowerCase();
    const persons = state.pkg.persons.filter(person => !query || (person.name + person.aliases.join(' ')).toLocaleLowerCase().includes(query));
    persons.forEach(person => {
      const label = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = state.cast.has(person.id); input.dataset.castPerson = person.id;
      input.addEventListener('change', () => { if (input.checked) state.cast.add(person.id); else state.cast.delete(person.id); persistWorkspace(); updateCastResult(); });
      const matches = state.index.originalRecords(person.id, state.library), matched = matches.filter(item => item.status === 'matched').length;
      add(label, input, add(el('span'), el('strong', '', person.name), el('small', '', matches.length ? '原庫身份：' + matched + '／' + matches.length + '已載入' : '史料脈絡人物，無原庫連結'))); add(mount, label);
    });
    if (!persons.length) add(mount, note('沒有符合的人物。'));
  }
  function updateCastResult() {
    const mount = $('labCastResults'); if (!mount) return; mount.replaceChildren(el('h3', '', '編排後的史料核對'));
    const event = state.index.get(state.castEventId);
    if (!event) { add(mount, note('此資料包尚無可選事件。')); return; }
    add(mount, el('p', 'lab-event-summary', event.title), note('同一事件 ≠ 同一房間。未記載 ≠ 不可能；人物庫分類 ≠ 當時官爵。', true));
    if (!state.cast.size) { add(mount, note('選人物後，逐人查看在場、行動、提及或資料缺口。')); return; }
    state.index.assessCast(event.id, [...state.cast]).forEach(result => {
      const card = el('article', 'lab-cast-card'); card.dataset.status = result.status; card.dataset.castPersonId = result.person.id;
      const statusLabel = result.status === 'outside-recorded-lifespan' ? '與本包生卒記錄不相容，須標架空' : result.context ? PARTICIPATION[result.context.participation] : '本包未記載，不能判不可能';
      add(card, el('h4', '', result.person.name), chip(statusLabel, result.status !== 'documented-participation'));
      if (result.context) add(card, el('p', '', '本事件角色：' + result.context.role + (result.context.factionId ? '｜' + entityName(result.context.factionId) : '')), note(result.context.note));
      add(card, note(result.message), personButton(result.person.id, event.id, '看原庫全文與身份'), renderEvidence(result.context ? result.context.claimIds : [])); add(mount, card);
    });
    add(mount, relatedMaterials(event));
  }
  function openPerson(personId, eventId) {
    if (!state.index) return;
    state.dialogPersonId = personId;
    if (state.mode === 'cases' && state.activeCaseView && $('labDialog').hidden) state.dialogQuestionId = 'case:' + state.activeCaseView;
    else if ((state.mode === 'investigate' && $('labDialog').hidden) || !state.dialogQuestionId) state.dialogQuestionId = state.questionId || (state.questions[0] ? state.questions[0].id : '');
    const veil = $('labDialog'), page = $('labPage');
    if (veil.hidden) {
      state.dialogReturnFocus = document.activeElement; state.dialogPreviousHidden = page.getAttribute('aria-hidden'); state.dialogPreviousInert = page.inert;
      page.inert = true; page.setAttribute('aria-hidden', 'true'); document.body.classList.add('lab-dialog-open');
    }
    veil.replaceChildren(); veil.hidden = false;
    const directRecord = personId.startsWith('record:') ? state.library.find(record => record.id === personId.slice(7)) : null;
    const linkedPerson = directRecord ? state.pkg.persons.find(person => person.libraryRefs.some(ref => ref.recordId === directRecord.id && ref.name === directRecord.name && ref.type === directRecord.type)) : null;
    const person = directRecord ? linkedPerson || { id: null, name: directRecord.name, note: '此條目尚未與楚漢事件建立已核身份連結；仍可閱讀、對讀，並作跨人物的解讀材料。', claimIds: [] } : state.index.get(personId);
    if (!person) { closePerson(); toast('這筆人物記錄目前未載入。'); return; }
    const dialog = el('section', 'lab-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'labPersonTitle');
    const title = el('h2', '', person.name + ' · 人物原文'); title.id = 'labPersonTitle';
    const close = button('關閉', closePerson, 'lab-button lab-button-quiet', 'labDialogClose');
    const body = el('div', 'lab-dialog-body');
    add(dialog, add(el('header', 'lab-dialog-header'), title, close), body); add(veil, dialog);
    add(body, note('原庫作者／AI 解讀與本包史料分開。原文保持原樣，不自動判人格、摘要或核定真偽。', true));
    const event = eventId ? state.index.get(eventId) : null, context = event ? event.contexts.find(item => item.personId === personId) : null;
    if (context) add(body, note('此事件「' + event.title + '」的角色：' + context.role + '｜' + PARTICIPATION[context.participation]));
    if (person.note) add(body, note(person.note));
    const matches = directRecord ? [{ status: 'matched', record: directRecord, link: { recordId: directRecord.id, name: directRecord.name, type: directRecord.type, note: '保留這個原庫身份條目，不與同名記錄混併。' } }] : state.index.originalRecords(personId, state.library);
    add(body, note('原庫分類是記錄身份，不代表這位人物在所選事件已任帝王或該官職。多身份記錄分開呈現。'));
    const targets = [...(state.casebook ? state.casebook.cases.map(item => ['case:' + item.id, '案卷｜' + item.title]) : []), ...state.questions.map(question => [question.id, '自由調查｜' + question.title])];
    if (targets.length) add(body, add(el('div', 'lab-reader-target'), selectField('選取段落要放入哪份案卷？', 'labOriginalQuestion', targets, state.dialogQuestionId, value => { state.dialogQuestionId = value; openPerson(personId, eventId); }, true)));
    const readingActions = el('div', 'lab-reader-actions');
    add(readingActions, button('字體放大', () => { dialog.classList.toggle('lab-reader-large'); }, 'lab-button lab-button-quiet'), button('專注閱讀', () => { dialog.classList.toggle('lab-reader-focus'); }, 'lab-button lab-button-quiet'));
    add(body, readingActions);
    if (!matches.length) add(body, note('此人目前只有史料脈絡身份，尚無已核對的原人物庫 ID；不以同名人物自動補連。', true));
    matches.forEach((match, recordIndex) => {
      const card = el('article', 'lab-original-record'); card.dataset.originalId = match.link.recordId;
      add(card, el('h3', '', match.link.name + ' · ' + TYPE_NAMES[match.link.type]), note('原始 ID：' + match.link.recordId), note(match.link.note));
      if (match.status !== 'matched') {
        add(card, note(match.status === 'ambiguous' ? '原庫 ID／姓名／分類出現多筆相符，尚未選定記錄。' : '目前載入的資料未含這個 ID、姓名與分類完全相符的記錄。可讀取完整人物 JSON 補上；本頁不捏造原文。', true));
      } else {
        const record = match.record;
        add(card, renderStats(record));
        const metadata = ['title', 'rank', 'tag', 'dynasty', 'desc', 'poem'].filter(field => typeof record[field] === 'string' && record[field].trim());
        if (metadata.length) { const info = detail('原庫簡介與標籤'); info.open = true; metadata.forEach(field => add(info, el('pre', 'lab-original-text', ({ title: '稱號', rank: '階位', tag: '標籤', dynasty: '時代', desc: '簡介', poem: '詩詞' }[field]) + '：' + record[field]))); add(card, info); }
        Object.entries(READER_FIELDS).forEach(([field, label]) => {
          if (typeof record[field] !== 'string' || !record[field].trim()) { add(card, note(label + '：此記錄未提供此欄文字。')); return; }
          const text = record[field], full = detail(label + ' · 完整原文'); add(full, el('pre', 'lab-original-text', text)); add(card, full);
          const choices = detail('從「' + label + '」選段落作調查材料');
          const blocks = paragraphs(text);
          add(choices, note('按原文空行分段；無空行時按換行分段。只選材料，不改原文。'));
          blocks.forEach((block, paragraphIndex) => {
            const key = originalKey(record.id, field, paragraphIndex), current = state.dialogQuestionId && !state.dialogQuestionId.startsWith('case:') ? investigation(state.dialogQuestionId) : null;
            const row = el('div', 'lab-original-paragraph'); row.dataset.originalField = field; row.dataset.paragraphIndex = String(paragraphIndex);
            const selected = current && current.materials.has(key);
            const pick = button(selected ? '已加入第' + (paragraphIndex + 1) + '段' : '加入第' + (paragraphIndex + 1) + '段', () => {
              const targetCaseId = state.dialogQuestionId.startsWith('case:') ? state.dialogQuestionId.slice(5) : '';
              if (targetCaseId) {
                if (!safeEngine(() => state.engine.addOriginalReference(targetCaseId, { personId: person.id, record, field, paragraphIndex, classification: 'unclear' }))) return;
              } else {
                const target = investigation(state.dialogQuestionId);
                const ref = I ? I.createOriginalReference(person.id, record, field, paragraphIndex) : {};
                target.materials.set(key, { ...ref, classification: 'unclear' });
                persistWorkspace();
              }
              pick.disabled = true; pick.textContent = '已加入第' + (paragraphIndex + 1) + '段'; updateWorkbench();
              const targetName = targetCaseId ? state.casebook.cases.find(item => item.id === targetCaseId).title : state.questions.find(question => question.id === state.dialogQuestionId).title;
              const feedback = $('labOriginalFeedback'); feedback.textContent = '已加入「' + targetName + '」的調查桌。';
            }, 'lab-button', 'labParagraph-' + recordIndex + '-' + field + '-' + paragraphIndex);
            pick.disabled = !state.dialogQuestionId || Boolean(selected); add(row, pick, el('pre', 'lab-original-text', block)); add(choices, row);
          });
          add(card, choices);
        });
      }
      add(body, card);
    });
    const feedback = el('p', 'lab-note'); feedback.id = 'labOriginalFeedback'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); add(body, feedback);
    if (person.claimIds.length) { const sources = detail('此人物在共用層的史料身份', 'lab-subsection'); add(sources, renderEvidence(person.claimIds)); add(body, sources); }
    close.focus();
  }
  function closePerson() {
    const veil = $('labDialog'); if (veil.hidden) return;
    const returnTarget = state.dialogReturnFocus, returnId = returnTarget && returnTarget.id, returnPersonId = returnTarget && returnTarget.dataset && returnTarget.dataset.personId, returnLabel = returnTarget && returnTarget.textContent;
    veil.hidden = true; veil.replaceChildren(); state.dialogPersonId = '';
    const page = $('labPage'); page.inert = state.dialogPreviousInert;
    if (state.dialogPreviousHidden === null) page.removeAttribute('aria-hidden'); else page.setAttribute('aria-hidden', state.dialogPreviousHidden);
    document.body.classList.remove('lab-dialog-open');
    if (state.mode === 'cases' && state.engine && state.activeCaseView) render();
    const replacement = returnTarget && returnTarget.isConnected ? returnTarget : returnId && $(returnId) || returnPersonId && [...document.querySelectorAll('[data-person-id]')].find(node => node.dataset.personId === returnPersonId) || returnLabel && [...document.querySelectorAll('#labModePanel button')].find(node => node.textContent === returnLabel);
    if (replacement && !replacement.disabled) replacement.focus(); else $('lab-tab-' + state.mode).focus();
  }
  function download() {
    if (!state.index) return;
    if (state.engine) { const flushed = flushWorkspace(); if (!flushed || state.pendingDrafts.size) { showUnstoredDrafts(); return; } downloadText(state.engine.exportJSON(), '王侯將相_史論館書桌_' + localDate() + '.json'); toast('備份已準備；檔案含你的筆記與引用位置，不含人物全文。'); return; }
    const investigations = [...state.investigations].map(([questionId, value]) => ({ questionId, conclusion: value.conclusion, certainty: value.certainty,
      materials: [...value.materials.values()].map(material => material.kind === 'claim' ? { kind: 'claim', claimId: material.id, classification: material.classification } : { kind: 'original-analysis', personId: material.personId, recordId: material.recordId, field: material.field, paragraphIndex: material.paragraphIndex, classification: material.classification }) }));
    const record = { format: 'dynasty-history-comparison', version: 1, packageId: state.pkg.packageId, packageVersion: state.pkg.packageVersion,
      createdOn: new Date().toISOString(), mode: state.mode, filter: { ...state.filter }, selectedEventId: state.selectedEventId,
      investigations, cast: { eventId: state.castEventId, personIds: [...state.cast], note: state.castNotes },
      privacy: '原庫段落僅保存ID、欄位與段號，不保存原文。自行撰寫的筆記會包含在本檔。' };
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob);
    const anchor = el('a'); anchor.href = url; anchor.download = '王侯將相_玩法比較_' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function localDate(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? '日期未記錄' : date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  }
  function toast(message) { const mount = $('labToast'); clearTimeout(state.toastTimer); mount.textContent = message; mount.hidden = false; state.toastTimer = setTimeout(() => { mount.hidden = true; }, 4500); }
  function safeEngine(action) {
    try { const value = action(); return value === undefined ? true : value; }
    catch (error) { toast('這次操作未完成：' + friendlyError(error.message)); return false; }
  }
  function friendlyError(code) {
    if (['ARCHIVE_LIMIT_EXPORT_FIRST', 'RECOVERY_LIMIT_EXPORT_FIRST', 'FREE_INVESTIGATION_LIMIT_EXPORT_FIRST', 'SAVE_LIMIT_EXPORT_FIRST'].includes(code)) return '保留紀錄已達上限，請先下載完整存檔；目前工作仍保留。';
    return ({ INVALID_REFERENCE: '原文引用資訊不完整，請重新選取段落。', INVALID_ORIGINAL_REFERENCE: '原文引用資訊不完整，請重新選取段落。', ORIGINAL_IDENTITY_MISMATCH: '這筆原文的姓名或分類與已核身份不同，請重新讀取正確的記錄。', INVALID_CASE_ID: '案卷已變更，請返回案卷館。', UNKNOWN_CASE: '這份案卷目前不存在，請返回案卷館。', UNKNOWN_TASK: '核對題目已變更，請重新開啟章節。', INCOMPLETE_ANSWER: '選項還未填齊，請完成選擇或排列。', INVALID_CHOICE: '請重新選擇題目選項。', STORAGE_BLOCKED: '本機存檔待處理，請先匯出目前書桌。', INVALID_JSON: '檔案不是完整的 JSON。', UNSUPPORTED_SAVE_VERSION: '這份備份的版本目前不支援。', SAVE_PACKAGE_MISMATCH: '這份備份屬於另一個資料包。' })[code] || code;
  }
  function downloadText(text, filename) {
    const blob = new Blob([text], { type: filename.endsWith('.txt') ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = el('a');
    anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function updateSaveStatus() {
    if (!state.engine) { $('labSaveStatus').textContent = '尚未啟用案卷存檔'; return; }
    const status = state.engine.getSaveStatus(), node = $('labSaveStatus');
    const text = { disabled: '僅留在本頁 · 請匯出備份', empty: '書桌已準備 · 自動保存', loaded: '已接回本機書桌', saved: '已自動存於這個瀏覽器', 'memory-only': '僅留在本頁 · 請匯出', blocked: '存檔需處理 · 請先備份' };
    const message = state.pendingDrafts.size ? '有文字尚未加入存檔 · 請處理' : text[status.status] || status.message; if (node.textContent !== message) node.textContent = message;
    node.dataset.error = String(state.pendingDrafts.size > 0 || ['blocked', 'memory-only'].includes(status.status)); node.title = status.message;
    $('labClearSession').disabled = false;
  }
  function updateDraftStatus() {
    const banner = $('labDraftStatus'); banner.hidden = state.pendingDrafts.size === 0; banner.replaceChildren();
    if (state.pendingDrafts.size) add(banner, el('p', '', '有 ' + state.pendingDrafts.size + ' 項最新內容尚未加入存檔。文字仍保留在本頁，請縮短內容後再試；先下載未保存草稿可保留全文。'), button('檢視並備份未保存草稿', showUnstoredDrafts, 'lab-button'));
    updateSaveStatus();
  }
  function writeDraft(id, label, value, action, caseId) {
    const result = safeEngine(action);
    if (result) state.pendingDrafts.delete(id); else state.pendingDrafts.set(id, { label, value, caseId: caseId || null });
    const input = $(id); if (input) input.setAttribute('aria-invalid', String(!result)); updateDraftStatus(); return result;
  }
  function showUnstoredDrafts() {
    const body = el('div'); add(body, el('p', 'lab-event-summary', '這些最新文字還沒進入正常書桌備份。'), note('請先保留未保存草稿，再縮短內容或處理存檔上限。下方「已保存版本」只含上次成功加入書桌的內容。', true));
    state.pendingDrafts.forEach(draft => { const block = detail(draft.label); add(block, el('pre', 'lab-original-text', draft.value)); add(body, block); });
    add(body, add(el('div', 'lab-material-tools'), button('下載未保存草稿文字', () => { const text = [...state.pendingDrafts.values()].map(draft => draft.label + '\n\n' + draft.value).join('\n\n──────\n\n'); downloadText(text, '王侯將相_未保存草稿_' + localDate() + '.txt'); }, 'lab-button lab-button-primary'), button('另下載已保存版本', () => downloadText(state.engine.exportJSON(), '王侯將相_上次有效書桌_' + localDate() + '.json'), 'lab-button'))); showDialog('保留未保存的草稿', body);
  }
  function persistWorkspace() { clearTimeout(state.persistTimer); state.persistTimer = setTimeout(flushWorkspace, 250); }
  function flushWorkspace() {
    clearTimeout(state.persistTimer); if (!state.engine || !state.index) return false;
    const freeInvestigations = [...state.investigations].map(([questionId, item]) => ({ questionId, conclusion: item.conclusion, certainty: item.certainty, materials: [...item.materials.values()].map(material => {
      if (material.kind === 'claim') return { kind: 'claim', claimId: material.claimId || material.id, classification: material.classification, note: material.note || '' };
      const { text, id, ...reference } = material; return reference;
    }) }));
    const patch = { mode: state.mode, selectedEventId: state.selectedEventId, filter: { ...state.filter }, cast: { eventId: state.castEventId, personIds: [...state.cast], note: state.castNotes }, freeInvestigations };
    const result = safeEngine(() => state.engine.setWorkspace(patch));
    if (result) state.pendingDrafts.delete('workspace'); else state.pendingDrafts.set('workspace', { label: '自由調查與創作工坊的最新工作', value: JSON.stringify(patch, null, 2), caseId: null });
    updateDraftStatus(); return Boolean(result);
  }
  function hydrateWorkspace() {
    if (!state.engine) return;
    const saved = state.engine.getState(), workspace = saved.workspace || {};
    if (MODE_NAMES[workspace.mode]) state.mode = workspace.mode;
    if (workspace.filter) state.filter = { ...state.filter, ...workspace.filter };
    if (state.index.get(workspace.selectedEventId)) state.selectedEventId = workspace.selectedEventId;
    if (workspace.cast) { if (state.index.get(workspace.cast.eventId)) state.castEventId = workspace.cast.eventId; state.cast = new Set(workspace.cast.personIds || []); state.castNotes = workspace.cast.note || ''; }
    state.investigations = new Map((workspace.freeInvestigations || []).map(item => [item.questionId, { conclusion: item.conclusion || '', certainty: item.certainty || 'open', materials: new Map((item.materials || []).map(material => {
      const value = material.kind === 'claim' ? { ...material, id: material.claimId } : material;
      return [material.kind === 'claim' ? material.claimId : originalKey(material.recordId, material.field, material.paragraphIndex), value];
    })) }]));
    updateSaveStatus();
  }
  function showDialog(titleText, content, className) {
    const veil = $('labDialog'), page = $('labPage');
    if (veil.hidden) { state.dialogReturnFocus = document.activeElement; state.dialogPreviousHidden = page.getAttribute('aria-hidden'); state.dialogPreviousInert = page.inert; page.inert = true; page.setAttribute('aria-hidden', 'true'); document.body.classList.add('lab-dialog-open'); }
    veil.hidden = false; veil.replaceChildren();
    const dialog = el('section', 'lab-dialog' + (className ? ' ' + className : '')); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'labPersonTitle');
    const title = el('h2', '', titleText); title.id = 'labPersonTitle'; const close = button('關閉', closePerson, 'lab-button lab-button-quiet', 'labDialogClose');
    add(dialog, add(el('header', 'lab-dialog-header'), title, close), add(el('div', 'lab-dialog-body'), content)); add(veil, dialog); close.focus(); return dialog;
  }
  function showGuide() {
    const body = el('div'); add(body, el('p', 'lab-event-summary', '把人物原文與歷史記述放在一起，完成一份屬於你的歷史解釋。'));
    const steps = el('div', 'lab-guide-steps');
    [['選一份案卷', '從館內的楚漢案卷出發。每案沿一個疑問安排史料、核對題與最後評議；所有案卷都能直接進入。'], ['先讀史料，再對讀人物', '展開材料可看原紀年、短引文、章節與來源。人物原典收錄目前載入的全部記錄，深度分析與同名不同身份各自保留。'], ['留下支持，也留下疑問', '把史料或原分析段落放入調查桌，標記支持、質疑與脈絡。原庫解讀是分析材料，歷史主張仍可回查來源。'], ['寫出你的評議', '核對題針對材料中的細節；最後的歷史解釋由你撰寫。完成後收藏案卷，往後仍可修訂並保留舊版。']].forEach(([title, text]) => add(steps, add(el('div', 'lab-guide-step'), add(el('div'), el('h3', '', title), el('p', '', text)))));
    add(body, steps, note('本機自動存檔只保存進度、筆記與引用位置；人物全文需在下次重新讀取同一份 JSON。可隨時匯出書桌備份。', true)); showDialog('入館指南', body);
  }
  function renderStats(record) {
    const mount = el('div'); if (!Array.isArray(record.stats) || record.stats.length !== 5) return mount;
    add(mount, note('原庫能力數值（原作者評定，非史料量測）'));
    const grid = el('div', 'lab-stats'); ['統率', '武力', '智謀', '政治', '魅力'].forEach((label, index) => add(grid, add(el('div', 'lab-stat-item'), el('span', '', label), el('strong', '', record.stats[index])))); add(mount, grid); return mount;
  }
  function linkedPersonFor(record) { return state.pkg.persons.find(person => person.libraryRefs.some(ref => ref.recordId === record.id && ref.name === record.name && ref.type === record.type)); }
  function renderLibrary(mount) {
    const toolbar = el('div', 'lab-library-toolbar');
    add(toolbar, textField('搜尋姓名、時代、稱號或原文', 'labLibrarySearch', state.librarySearch, value => { state.librarySearch = value; state.libraryPage = 1; updateLibraryResults(); }),
      selectField('人物分類', 'labLibraryType', [['', '全部分類'], ...Object.entries(TYPE_NAMES)], state.libraryType, value => { state.libraryType = value; state.libraryPage = 1; updateLibraryResults(); }),
      selectField('閱讀範圍', 'labLibraryTextFilter', [['', '全部人物'], ['long', '含深度／人物分析'], ['linked', '已連楚漢史料'], ['basic', '簡介與詩文']], state.libraryTextFilter, value => { state.libraryTextFilter = value; state.libraryPage = 1; updateLibraryResults(); }));
    add(mount, toolbar, note('搜尋目前載入的每一筆人物記錄。相同人物的帝王、將帥、謀臣條目保留各自文章，點「加入對讀」可同看二至三筆。'));
    const results = el('div'); results.id = 'labLibraryResults'; const compare = el('div'); compare.id = 'labCompareTray'; add(mount, results, compare); updateLibraryResults(); updateCompareTray();
  }
  function updateLibraryResults() {
    const mount = $('labLibraryResults'); if (!mount) return; mount.replaceChildren();
    const query = state.librarySearch.trim().toLocaleLowerCase(), records = state.library.filter(record => {
      if (state.libraryType && record.type !== state.libraryType) return false;
      if (state.libraryTextFilter === 'long' && !allArticleFields(record).length) return false;
      if (state.libraryTextFilter === 'basic' && allArticleFields(record).length) return false;
      if (state.libraryTextFilter === 'linked' && !linkedPersonFor(record)) return false;
      return !query || ['name', 'title', 'dynasty', 'tag', 'desc', 'poem', ...Object.keys(FIELD_NAMES)].some(field => typeof record[field] === 'string' && record[field].toLocaleLowerCase().includes(query));
    });
    const pageSize = 24, pages = Math.max(1, Math.ceil(records.length / pageSize)); state.libraryPage = Math.min(state.libraryPage, pages);
    add(mount, add(el('div', 'lab-catalogue-heading'), el('h3', '', '找到 ' + records.length + ' 筆人物原典'), el('p', '', '第 ' + state.libraryPage + '／' + pages + ' 頁')));
    const grid = el('div', 'lab-library-results');
    records.slice((state.libraryPage - 1) * pageSize, state.libraryPage * pageSize).forEach(record => {
      const card = el('article', 'lab-library-card'); card.dataset.libraryRecord = record.id;
      add(card, el('h3', '', record.name), el('p', 'lab-card-title', record.title || record.dynasty || TYPE_NAMES[record.type]), el('p', '', record.desc || record.poem || '這筆記錄尚無簡介，可開啟查看已提供的欄位。'), add(el('div', 'lab-meta'), chip(TYPE_NAMES[record.type]), chip(record.dynasty || '時代未填'), chip(allArticleFields(record).length ? '含分析原文' : '簡介與詩文')));
      add(card, add(el('div', 'lab-material-tools'), button('閱讀原典', () => openPerson('record:' + record.id), 'lab-button'), button(state.compare.has(record.id) ? '移出對讀' : '加入對讀', () => { toggleCompare(record.id); updateLibraryResults(); }, 'lab-button lab-button-quiet'))); add(grid, card);
    });
    if (!records.length) add(grid, add(el('div', 'lab-empty'), el('h3', '', '換個線索試試'), el('p', '', '目前人物庫沒有符合這些條件的記錄。可清除搜尋，或在「我的人物庫與書桌」讀入完整 JSON。'), button('清除篩選', () => { state.librarySearch = ''; state.libraryType = ''; state.libraryTextFilter = ''; render(); }, 'lab-button')));
    add(mount, grid);
    const pagination = el('div', 'lab-pagination'), previous = button('← 上一頁', () => { state.libraryPage--; updateLibraryResults(); $('labLibraryResults').scrollIntoView({ block: 'start' }); }, 'lab-button'), next = button('下一頁 →', () => { state.libraryPage++; updateLibraryResults(); $('labLibraryResults').scrollIntoView({ block: 'start' }); }, 'lab-button');
    previous.disabled = state.libraryPage === 1; next.disabled = state.libraryPage === pages; add(pagination, previous, el('span', '', state.libraryPage + ' / ' + pages), next); add(mount, pagination);
  }
  function toggleCompare(recordId) { if (state.compare.has(recordId)) state.compare.delete(recordId); else if (state.compare.size < 3) state.compare.add(recordId); else { toast('一次可對讀最多三筆；先移除其中一筆即可更換。'); return; } updateCompareTray(); }
  function updateCompareTray() {
    const mount = $('labCompareTray'); if (!mount) return; mount.replaceChildren(); mount.className = state.compare.size ? 'lab-compare-tray' : ''; if (!state.compare.size) return;
    const selected = [...state.compare].map(id => state.library.find(record => record.id === id)).filter(Boolean), read = button('開始對讀（' + selected.length + '）', openComparison, 'lab-button'); read.disabled = selected.length < 2;
    add(mount, el('p', '', selected.map(record => record.name + '・' + TYPE_NAMES[record.type]).join('　／　')), add(el('div', 'lab-material-tools'), read, button('清空', () => { state.compare.clear(); updateLibraryResults(); updateCompareTray(); }, 'lab-button lab-button-quiet')));
  }
  function openComparison() {
    const records = [...state.compare].map(id => state.library.find(record => record.id === id)).filter(Boolean), body = el('div'); if (records.length < 2) return;
    add(body, note('以下保留各筆原文；能力數值與人物分析均屬原庫作者／AI 解讀，不能用數值判定歷史勝負。', true));
    const columns = el('div', 'lab-compare-columns'); columns.dataset.columns = String(records.length);
    records.forEach(record => {
      const column = el('article', 'lab-compare-column'); add(column, el('h3', '', record.name), chip(TYPE_NAMES[record.type]), el('p', 'lab-card-title', record.title || ''), el('p', 'lab-record-id', record.id), renderStats(record));
      [['dynasty', '時代'], ['desc', '簡介'], ['poem', '詩詞'], ...Object.entries(FIELD_NAMES)].forEach(([field, label]) => { if (!record[field]) return; const block = detail(label); if (['desc', 'poem'].includes(field)) block.open = true; add(block, el('pre', 'lab-original-text', record[field])); add(column, block); });
      add(column, button('開啟此人，選取段落', () => openPerson('record:' + record.id), 'lab-button')); add(columns, column);
    }); add(body, columns); showDialog('人物原典 · 並卷對讀', body, 'lab-compare-dialog');
  }
  function eventSchematic(event) {
    const routes = state.pkg.routes.filter(route => route.eventId === event.id), relations = state.pkg.relations.filter(relation => relation.eventId === event.id); if (!routes.length && !relations.length) return null;
    const card = el('section', 'lab-schematic'); add(card, el('h4', '', '事件關係簡圖'), note('連線表示本包有來源的關係或移動方向；位置不代表地理座標，線長不代表距離。'));
    relations.forEach(relation => add(card, add(el('div', 'lab-schematic-row'), el('span', 'lab-schematic-node', entityName(relation.fromId)), el('span', 'lab-schematic-arrow', '── ' + RELATION_NAMES[relation.type] + ' →'), el('span', 'lab-schematic-node', entityName(relation.toId)))));
    routes.forEach(route => add(card, add(el('div', 'lab-schematic-row'), el('span', 'lab-schematic-node', entityName(route.fromPlaceId)), el('span', 'lab-schematic-arrow', route.kind === 'reported-supply' ? '── 輸送記述 →' : '── 移動記述 →'), el('span', 'lab-schematic-node', entityName(route.toPlaceId))))); return card;
  }
  function enterCase(caseId) {
    if (!state.engine || !safeEngine(() => state.engine.selectCase(caseId))) return;
    state.activeCaseView = caseId; state.mode = 'cases'; state.archiveView = ''; persistWorkspace(); render();
    $('labModePanel').focus();
  }
  function renderCases(mount) {
    if (!state.engine || !state.casebook) { add(mount, add(el('div', 'lab-empty'), el('h3', '', '案卷尚未載入'), el('p', '', state.caseError || '人物與史料仍可從其他入口閱讀。'), button('重新載入案卷', loadCases, 'lab-button'))); return; }
    if (state.activeCaseView) { renderCaseJourney(mount); return; }
    const saved = state.engine.getState(), active = state.casebook.cases.find(item => item.id === saved.activeCaseId);
    if (active && state.engine.getCaseProgress(active.id).startedAt) {
      const progress = state.engine.getCaseProgress(active.id), banner = el('section', 'lab-case-continue');
      add(banner, add(el('div'), el('p', 'lab-overline', progress.isCompleted ? '已收藏的案卷' : '接續你的書桌'), el('h3', '', active.title), el('p', '', progress.completedTaskCount + '／' + progress.totalTaskCount + ' 項史料核對完成 · ' + progress.materials.length + ' 份材料')), button(progress.isCompleted ? '回看與修訂 →' : '繼續調查 →', () => enterCase(active.id), 'lab-button')); add(mount, banner);
    } else {
      const first = state.casebook.cases[0], welcome = el('section', 'lab-case-continue');
      add(welcome, add(el('div'), el('p', 'lab-overline', '第一次來到史論館'), el('h3', '', '從一個人物的選擇，讀出整個時局'), el('p', '', '先選一案。讀短材料、核對細節，再用原人物分析形成自己的解釋。')), button('從第一案開始 →', () => enterCase(first.id), 'lab-button')); add(mount, welcome);
    }
    const completeCount = state.casebook.cases.filter(item => state.engine.getCaseProgress(item.id).isCompleted).length;
    add(mount, add(el('div', 'lab-catalogue-heading'), el('h3', '', '楚漢案卷 · 全部開放'), el('p', '', '已收藏 ' + completeCount + '／' + state.casebook.cases.length + ' 案')));
    const grid = el('div', 'lab-case-grid');
    state.casebook.cases.forEach((item, index) => {
      const progress = state.engine.getCaseProgress(item.id), card = el('article', 'lab-case-card'); card.dataset.caseId = item.id;
      const bar = el('div', 'lab-case-progress'), fill = el('span'); fill.style.width = (progress.totalTaskCount ? 100 * progress.completedTaskCount / progress.totalTaskCount : 0) + '%'; add(bar, fill);
      add(card, el('p', 'lab-case-number', '案 ' + String(index + 1).padStart(2, '0') + '　' + item.theme), el('h3', '', item.title), el('p', 'lab-case-description', item.subtitle || item.inquiry), add(el('div', 'lab-meta'), chip(item.difficulty || '史料調查'), chip((item.estimatedMinutes || '15–25') + ' 分鐘'), chip(progress.isCompleted ? '已完成評議' : progress.startedAt ? '調查中' : '可開始', Boolean(progress.startedAt && !progress.isCompleted))), bar, el('small', '', progress.completedTaskCount + '／' + progress.totalTaskCount + ' 項核對 · ' + progress.archiveCount + ' 份已收藏評議'), button(progress.isCompleted ? '回看案卷 →' : progress.startedAt ? '繼續調查 →' : '打開案卷 →', () => enterCase(item.id), 'lab-button')); add(grid, card);
    }); add(mount, grid);
    const recovered = state.engine.getRecoveries(); if (recovered.length) add(mount, add(panel('保留的書桌版本', 'lab-subsection'), note('有 ' + recovered.length + ' 份匯入或衝突時保留的草稿，可在存檔管理檢視。'), button('開啟存檔管理', showStorage, 'lab-button')));
  }
  function caseView(item, progress) {
    if (state.chapterViews.has(item.id)) return state.chapterViews.get(item.id);
    if (progress.isCompleted) return 'finale';
    const firstIncomplete = item.chapters.find(chapter => chapter.taskIds.some(id => !progress.tasks.find(task => task.taskId === id && task.correct)));
    return firstIncomplete ? firstIncomplete.id : item.chapters[0].id;
  }
  function changeChapter(caseId, chapterId) { state.chapterViews.set(caseId, chapterId); render(); $('labModePanel').focus(); }
  function renderCaseJourney(mount) {
    const item = state.casebook.cases.find(entry => entry.id === state.activeCaseView); if (!item) { state.activeCaseView = ''; renderCases(mount); return; }
    const progress = state.engine.getCaseProgress(item.id), currentView = caseView(item, progress), layout = el('div', 'lab-journey-layout'), sidebar = el('aside', 'lab-journey-sidebar'), main = el('div', 'lab-journey-main');
    add(sidebar, button('← 全部案卷', () => { state.activeCaseView = ''; render(); }, 'lab-button lab-button-quiet'), el('h3', '', item.title), note(progress.completedTaskCount + '／' + progress.totalTaskCount + ' 項核對完成'));
    const stages = el('ol', 'lab-stage-list'); stages.setAttribute('aria-label', '案卷章節');
    item.chapters.forEach((chapter, index) => {
      const completed = chapter.taskIds.every(id => progress.tasks.some(task => task.taskId === id && task.correct)), control = button('', () => changeChapter(item.id, chapter.id), 'lab-stage-button');
      control.dataset.chapterId = chapter.id; if (currentView === chapter.id) control.setAttribute('aria-current', 'step');
      add(control, el('span', '', completed ? '✓' : String(index + 1).padStart(2, '0')), el('strong', '', chapter.title)); if (completed) control.setAttribute('aria-label', chapter.title + '，核對已完成'); add(stages, add(el('li'), control));
    });
    [['notebook', '調查桌'], ['finale', '我的評議'], ['archive', '已收藏評議']].forEach(([id, title]) => { const control = button('', () => changeChapter(item.id, id), 'lab-stage-button'); if (id === currentView) control.setAttribute('aria-current', 'step'); add(control, el('span', '', id === 'notebook' ? '筆' : id === 'finale' ? '議' : '藏'), el('strong', '', title + (id === 'notebook' ? ' · ' + progress.materials.length : id === 'archive' ? ' · ' + progress.archiveCount : ''))); add(stages, add(el('li'), control)); });
    add(sidebar, stages, note('章節可自由往返。史料核對與你的解釋分開：評議不判定唯一立場。'));
    if (currentView === 'notebook') renderCaseNotebook(main, item, progress);
    else if (currentView === 'finale') renderFinale(main, item, progress);
    else if (currentView === 'archive') renderArchive(main, item);
    else {
      const chapter = item.chapters.find(entry => entry.id === currentView) || item.chapters[0], chapterIndex = item.chapters.indexOf(chapter), heading = el('header', 'lab-stage-intro');
      add(heading, el('p', 'lab-overline', '案卷 ' + String(item.order).padStart(2, '0') + ' · 第 ' + (chapterIndex + 1) + ' 章'), el('h3', '', chapter.title), el('p', '', chapter.intro));
      if (chapterIndex === 0) add(heading, note(item.premise, true), el('p', '', '本案追問：' + item.inquiry)); add(main, heading);
      const pool = panel('本章材料'); add(pool, note('展開閱讀出處。值得保留的材料可放入調查桌，最後用來支持或質疑你的評議。'));
      const cards = el('div', 'lab-case-materials');
      chapter.claimIds.forEach(claimId => { const selected = progress.materials.some(material => material.kind === 'claim' && material.claimId === claimId), card = el('article', 'lab-material-card'); add(card, renderEvidence([claimId]), button(selected ? '已在調查桌' : '放入調查桌', () => { if (safeEngine(() => state.engine.addClaim(item.id, claimId))) { toast('材料已加入本案調查桌。'); render(); } }, 'lab-button')); card.lastChild.disabled = selected; add(cards, card); });
      add(pool, cards); add(main, pool);
      chapter.taskIds.forEach(taskId => { const task = item.tasks.find(entry => entry.id === taskId); if (task) add(main, renderCaseTask(item, task, progress)); });
      if (chapterIndex === 0 || chapterIndex === item.chapters.length - 1) add(main, renderPerspectives(item));
      const nav = el('div', 'lab-stage-navigation'); if (chapterIndex) add(nav, button('← 上一章', () => changeChapter(item.id, item.chapters[chapterIndex - 1].id), 'lab-button'));
      add(nav, button(chapterIndex < item.chapters.length - 1 ? '前往下一章 →' : '整理調查桌 →', () => changeChapter(item.id, chapterIndex < item.chapters.length - 1 ? item.chapters[chapterIndex + 1].id : 'notebook'), 'lab-button lab-button-primary')); add(main, nav);
    }
    add(mount, add(layout, sidebar, main));
  }
  function renderCaseTask(item, task, progress) {
    const card = el('section', 'lab-stage-task'); card.dataset.taskId = task.id;
    const result = progress.tasks.find(entry => entry.taskId === task.id), draftKey = item.id + ':' + task.id;
    if (!state.taskDrafts.has(draftKey)) { const previous = result && result.choiceIds.length ? result.choiceIds : []; state.taskDrafts.set(draftKey, previous.length ? [...previous] : task.type === 'sequence' ? [...task.choices.slice(1).map(choice => choice.id), task.choices[0].id] : []); }
    const selected = state.taskDrafts.get(draftKey); add(card, el('h4', '', task.prompt), el('p', '', task.type === 'sequence' ? '依材料排列先後；可用上下按鈕調整，再提交核對。' : task.type === 'multi-choice' ? '選出所有符合材料的項目，再提交核對。' : '選一項，再查看每個選項的說明。'));
    const options = el('div', 'lab-task-options'); options.setAttribute('role', task.type === 'single-choice' ? 'radiogroup' : 'group'); options.setAttribute('aria-label', task.prompt);
    if (task.type === 'sequence') selected.forEach((id, index) => {
      const choice = task.choices.find(entry => entry.id === id), row = el('div', 'lab-task-option'), up = button('↑', () => { [selected[index - 1], selected[index]] = [selected[index], selected[index - 1]]; render(); }, 'lab-button lab-button-quiet', 'labOrderUp-' + task.id + '-' + id), down = button('↓', () => { [selected[index], selected[index + 1]] = [selected[index + 1], selected[index]]; render(); }, 'lab-button lab-button-quiet', 'labOrderDown-' + task.id + '-' + id);
      up.disabled = index === 0; down.disabled = index === selected.length - 1; up.setAttribute('aria-label', '向前移動「' + choice.label + '」'); down.setAttribute('aria-label', '向後移動「' + choice.label + '」'); add(row, el('span', '', String(index + 1) + '. ' + choice.label), add(el('div', 'lab-material-tools'), up, down)); add(options, row);
    });
    else task.choices.forEach(choice => {
      const label = el('label', 'lab-task-option'), input = el('input'); input.type = task.type === 'single-choice' ? 'radio' : 'checkbox'; input.name = 'task-' + task.id; input.value = choice.id; input.checked = selected.includes(choice.id);
      input.addEventListener('change', () => { if (task.type === 'single-choice') state.taskDrafts.set(draftKey, [choice.id]); else { const next = new Set(state.taskDrafts.get(draftKey)); if (input.checked) next.add(choice.id); else next.delete(choice.id); state.taskDrafts.set(draftKey, [...next]); } }); add(label, input, el('span', '', choice.label)); add(options, label);
    }); add(card, options);
    const submit = button(result && result.submitted ? '再次核對' : '提交核對', () => { const answers = state.taskDrafts.get(draftKey); if (!answers.length) { toast('先選擇一個選項，再提交核對。'); return; } if (safeEngine(() => state.engine.submitTask(item.id, task.id, answers))) { render(); const refreshed = document.querySelector('[data-task-id="' + task.id + '"]'); if (refreshed) refreshed.scrollIntoView({ block: 'nearest' }); } }, 'lab-button', 'labTaskSubmit-' + task.id); add(card, add(el('div', 'lab-material-tools'), submit));
    if (result && result.submitted) {
      const feedback = el('div', 'lab-task-feedback'); feedback.dataset.pass = String(result.correct); feedback.setAttribute('role', 'status');
      add(feedback, el('strong', '', result.correct ? '核對完成' : '再回到材料看一次'), el('p', '', result.explanation || task.explanation));
      (result.feedback || []).forEach(entry => add(feedback, el('p', '', entry.label + '：' + entry.text))); if (!result.correct && result.hint) add(feedback, note('線索：' + result.hint)); add(card, feedback);
    } else if (task.hint) { const hint = detail('需要一點閱讀方向？'); add(hint, note(task.hint)); add(card, hint); }
    return card;
  }
  function renderPerspectives(item) {
    const section = panel('回到人物原典'); add(section, note('把本案史料與你原有的人物分析對讀。原文不必與案卷採同一種解釋；差異本身就是調查線索。'));
    item.perspectives.forEach(perspective => { const row = el('article', 'lab-context'); add(row, personButton(perspective.personId, null), el('p', '', perspective.framing), note(perspective.analysisPrompt)); add(section, row); });
    add(section, button('搜尋全部人物，尋找另一個對照', () => { state.mode = 'library'; state.dialogQuestionId = 'case:' + item.id; render(); persistWorkspace(); }, 'lab-button lab-button-quiet'), note('沒有長篇分析也能完成本案；可從簡介、詩文與已核史料開始。')); return section;
  }
  function renderCaseNotebook(mount, item, progress) {
    add(mount, add(el('header', 'lab-stage-intro'), el('p', 'lab-overline', item.title), el('h3', '', '整理你的調查桌'), el('p', '', '每一份材料可以支持一個解釋，也可能提醒你它的限度。分類由你決定。')));
    const section = panel('已選材料 · ' + progress.materials.length, 'lab-case-notebook');
    if (!progress.materials.length) add(section, el('p', 'lab-notebook-empty', '書桌還是空的。回到章節，選擇至少兩條史料；也可從人物原典加入分析段落。'));
    progress.materials.forEach((material, index) => {
      const card = el('article', 'lab-notebook-entry'), key = I.materialKey(material); card.dataset.notebookKey = key;
      if (material.kind === 'claim') add(card, chip('史料主張'), renderEvidence([material.claimId]));
      else { const resolved = I.resolveOriginalReference(material, state.library, state.pkg); add(card, chip('原庫作者／AI 解讀', true), el('h4', '', material.recordName + ' · ' + TYPE_NAMES[material.recordType]), note((READER_FIELDS[material.field] || material.field) + ' 第 ' + (material.paragraphIndex + 1) + ' 段 · ' + material.recordId)); if (resolved.status === 'matched') { const quote = detail('展開已選原文段落'); add(quote, el('pre', 'lab-original-text', resolved.text)); add(card, quote); if (resolved.linked === false) add(card, note('此人物原文尚未連到本包事件；用作跨人物比較材料。')); } else add(card, note(resolved.message || '原文尚未對上，請重新讀取原人物檔或選取新段落。', true)); add(card, button('閱讀這筆人物原典', () => openPerson('record:' + material.recordId), 'lab-button lab-button-quiet')); }
      const noteId = 'labCaseMaterialNote-' + item.id + '-' + key;
      const materialNote = textField('對這份材料的筆記', noteId, material.note || '', value => writeDraft(noteId, item.title + ' · 材料筆記', value, () => state.engine.updateMaterial(item.id, key, { note: value }), item.id), true); materialNote.lastChild.maxLength = 10000;
      add(card, selectField('這份材料在我的解釋中', 'labCaseClassify-' + index, CLASSIFICATIONS, material.classification, value => safeEngine(() => state.engine.updateMaterial(item.id, key, { classification: value })), true), materialNote, button('移出此案', () => { if (state.pendingDrafts.has(noteId)) { showUnstoredDrafts(); return; } if (safeEngine(() => state.engine.removeMaterial(item.id, key))) render(); }, 'lab-button lab-button-quiet')); add(section, card);
    });
    add(mount, section, renderPerspectives(item), add(el('div', 'lab-stage-navigation'), button('← 返回章節', () => changeChapter(item.id, item.chapters[0].id), 'lab-button'), button('寫下我的評議 →', () => changeChapter(item.id, 'finale'), 'lab-button lab-button-primary')));
  }
  function renderFinale(mount, item, progress) {
    add(mount, add(el('header', 'lab-stage-intro'), el('p', 'lab-overline', item.title + (progress.isCompleted ? ' · 已收藏' : ' · 最後評議')), el('h3', '', '讓材料成為你的解釋'), el('p', '', item.finale.prompt)));
    if (progress.isCompleted) add(mount, note('這份評議已收藏。繼續修改會建立新的草稿，舊評議可在「已收藏評議」回看。', true));
    const section = panel('我的評議');
    const prompts = item.finale.reflectionPrompts || [];
    [['thesis', '我的主要解釋', prompts[0] || '我認為人物為何如此選擇？哪些材料支持它？'], ['counterargument', '另一種可能的解釋', prompts[1] || '若有人提出不同看法，最有力的理由是什麼？'], ['uncertainty', '仍未解決的部分', prompts[2] || '材料尚未告訴我什麼？哪些細節仍待查證？']].forEach(([key, label, prompt]) => {
      const fieldId = 'labWriting-' + key, pendingId = fieldId + ':' + item.id;
      const field = textField(label, fieldId, state.pendingDrafts.has(pendingId) ? state.pendingDrafts.get(pendingId).value : progress[key] || '', value => { writeDraft(pendingId, item.title + ' · ' + label, value, () => state.engine.setWriting(item.id, { [key]: value }), item.id); field.lastChild.setAttribute('aria-invalid', String(state.pendingDrafts.has(pendingId))); updateFinaleReadiness(item.id); }, true); field.lastChild.placeholder = prompt; if (state.pendingDrafts.has(pendingId)) field.lastChild.setAttribute('aria-invalid', 'true'); add(section, field, note(prompt));
    });
    const readiness = el('div'); readiness.id = 'labFinaleReadiness'; add(section, readiness);
    add(section, button('收藏這份評議', () => { if ([...state.pendingDrafts.values()].some(draft => draft.caseId === item.id)) { showUnstoredDrafts(); return; } const result = safeEngine(() => state.engine.completeCase(item.id)); if (!result) return; if (!result.ok) { toast('還有幾項待完成，已列在評議下方。'); updateFinaleReadiness(item.id); return; } toast('評議已收藏。你的立場不會被評為唯一正解。'); state.chapterViews.set(item.id, 'archive'); render(); }, 'lab-button lab-button-primary', 'labCompleteCase'), note(item.finale.closingNote)); add(mount, section);
    setTimeout(() => updateFinaleReadiness(item.id), 0);
  }
  function updateFinaleReadiness(caseId) {
    const mount = $('labFinaleReadiness'); if (!mount || !state.engine || state.activeCaseView !== caseId) return; const progress = state.engine.getCaseProgress(caseId); mount.replaceChildren();
    const claimCount = progress.materials.filter(material => material.kind === 'claim').length, originals = progress.materials.filter(material => material.kind !== 'claim').length;
    const grid = el('div', 'lab-appraisal-grid');
    [['史料核對', progress.completedTaskCount + '／' + progress.totalTaskCount + ' 項已完成', progress.completedTaskCount === progress.totalTaskCount], ['調查材料', claimCount + ' 條史料 · ' + originals + ' 段原庫解讀', claimCount >= 2]].forEach(([title, text, met]) => { const card = el('div', 'lab-appraisal-item'); card.dataset.met = String(met); add(card, el('h4', '', title), el('p', '', text)); add(grid, card); }); add(mount, grid);
    if ([...state.pendingDrafts.values()].some(draft => draft.caseId === caseId)) add(mount, note('本案有最新文字尚未加入存檔，處理完成後才能收藏這次評議。', true));
    else if (progress.readiness.ready) add(mount, note('可以收藏了。這裡核對的是引用與論述是否備齊，不替你的歷史立場評分。', true));
    else { const list = el('ul', 'lab-warning-list'); progress.readiness.missing.forEach(message => add(list, el('li', '', message))); add(mount, list); }
  }
  function renderArchive(mount, item) {
    const archive = state.engine.getArchive(item.id); add(mount, add(el('header', 'lab-stage-intro'), el('p', 'lab-overline', item.title), el('h3', '', '已收藏的評議'), el('p', '', '每一版都保留當時的材料與解釋。新的想法可以繼續修訂。')));
    if (!archive.length) { add(mount, add(el('div', 'lab-empty'), el('h3', '', '這份案卷還沒有評議'), el('p', '', '讀完材料、核對題目，再把你的論點與疑問留下來。'), button('前往我的評議', () => changeChapter(item.id, 'finale'), 'lab-button'))); return; }
    archive.slice().reverse().forEach((entry, index) => {
      const card = el('article', 'lab-archive-entry'), snapshot = entry.snapshot || entry;
      add(card, el('h3', '', '評議第 ' + (archive.length - index) + ' 版'), note(localDate(entry.completedAt || entry.createdAt || entry.savedAt || snapshot.completedAt)), el('p', 'lab-conclusion', snapshot.thesis || ''), el('h4', '', '另一種解釋'), el('p', 'lab-original-text', snapshot.counterargument || ''), el('h4', '', '仍未解決'), el('p', 'lab-original-text', snapshot.uncertainty || ''));
      const materials = snapshot.materials || []; add(card, add(el('div', 'lab-meta'), chip(materials.filter(material => material.kind === 'claim').length + ' 條史料'), chip(materials.filter(material => material.kind !== 'claim').length + ' 段原庫解讀')));
      const materialDetail = detail('回看當時選取的材料'); materials.forEach(material => { if (material.kind === 'claim') add(materialDetail, renderEvidence([material.claimId])); else { const resolved = I.resolveOriginalReference(material, state.library, state.pkg); add(materialDetail, el('h4', '', material.recordName + ' · ' + (FIELD_NAMES[material.field] || material.field)), resolved.status === 'matched' ? el('pre', 'lab-original-text', resolved.text) : note(resolved.message, true)); } }); add(card, materialDetail);
      add(card, button('以這一版繼續修訂', () => { if ([...state.pendingDrafts.values()].some(draft => draft.caseId === item.id)) { showUnstoredDrafts(); return; } if (safeEngine(() => state.engine.restoreArchive(item.id, entry.id || entry.archiveId))) { state.chapterViews.set(item.id, 'finale'); render(); } }, 'lab-button')); add(mount, card);
    });
    const next = state.casebook.cases.find(nextCase => nextCase.order > item.order), nav = el('div', 'lab-stage-navigation'); add(nav, button('回案卷館', () => { state.activeCaseView = ''; render(); }, 'lab-button')); if (next) add(nav, button('打開下一案：' + next.title + ' →', () => enterCase(next.id), 'lab-button lab-button-primary')); add(mount, nav);
  }
  function showStorage() {
    if (!state.engine) return; flushWorkspace(); const body = el('div'), status = state.engine.getSaveStatus();
    add(body, el('p', 'lab-event-summary', status.message), note('自動保存只屬於這個網址、這個瀏覽器。更換瀏覽器或清除網站資料前，請先匯出書桌備份。'), button('匯出目前書桌', download, 'lab-button lab-button-primary'));
    if (['memory-only', 'disabled'].includes(status.status)) add(body, button('重試本機保存', () => { safeEngine(() => state.engine.retrySave()); showStorage(); }, 'lab-button'));
    const preserved = state.engine.getPreservedSave ? state.engine.getPreservedSave() : null;
    if (preserved) add(body, add(el('div', 'lab-export-info'), el('p', '', '先前的存檔已保留。你可以下載原檔，再建立新的保存位置，接續目前頁面的工作。'), button('下載保留的原存檔', () => downloadText(preserved.raw, '王侯將相_保留原存檔_' + localDate() + '.json'), 'lab-button'), button('保留原存檔，繼續保存目前書桌', () => { const result = safeEngine(() => state.engine.startNewSaveSlot()); if (result && result.ok) toast('先前原檔已另存保留，目前書桌已恢復自動保存。'); showStorage(); }, 'lab-button')));
    const recoveries = state.engine.getRecoveries(); add(body, el('h3', '', '保留的草稿 · ' + recoveries.length));
    if (!recoveries.length) add(body, note('目前沒有匯入衝突或還原前的草稿。'));
    recoveries.slice().reverse().forEach(entry => { const item = state.casebook.cases.find(candidate => candidate.id === entry.progress.caseId), card = el('article', 'lab-archive-entry');
      add(card, el('h4', '', item ? item.title : entry.progress.caseId), note(localDate(entry.savedAt) + ' · ' + entry.reason), el('p', 'lab-original-text', entry.progress.thesis || '這份草稿尚未寫評議。'), note((entry.progress.materials || []).length + ' 份材料'));
      add(card, button('把這份草稿接回書桌', () => { if (state.pendingDrafts.size) { showUnstoredDrafts(); return; } const result = safeEngine(() => state.engine.restoreRecovery(entry.id)); if (result) { state.activeCaseView = entry.progress.caseId; state.mode = 'cases'; state.chapterViews.set(entry.progress.caseId, 'finale'); closePerson(); render(); toast('已接回草稿；剛才的工作也已保留。'); } }, 'lab-button')); add(body, card);
    }); showDialog('本機書桌與草稿管理', body);
  }
  async function importSession(file) {
    if (!file || !state.engine) return; const sequence = (state.sessionImportSequence || 0) + 1; state.sessionImportSequence = sequence;
    try {
      if (file.size > 8_000_000) throw new Error('備份超過 8MB 讀取上限。');
      const text = await file.text(); if (sequence !== state.sessionImportSequence) return; if (!flushWorkspace() || state.pendingDrafts.size) { showUnstoredDrafts(); return; }
      const preview = state.engine.previewImport(text); if (!preview.ok) throw new Error(preview.errors.map(friendlyError).join('、'));
      state.importPreview = preview; const body = el('div'), summary = preview.summary;
      add(body, el('p', 'lab-event-summary', '將讀入「' + file.name + '」'), note(summary.casesWithWork + ' 案有進度 · ' + summary.completedCases + ' 案已完成 · ' + summary.freeInvestigations + ' 份自由調查 · ' + summary.recoveries + ' 份保留草稿'));
      preview.warnings.forEach(warning => add(body, note(warning, true)));
      add(body, el('p', 'lab-export-info', '「合併」會保留目前工作；同案的不同版本放入草稿管理。「接續匯入版本」會保留目前案卷，再以匯入版本為工作草稿。人物全文仍需另行讀取。'));
      const apply = strategy => { clearTimeout(state.persistTimer); const result = safeEngine(() => state.engine.applyImport(preview, { strategy })); if (!result || !result.ok) return; state.taskDrafts.clear(); state.chapterViews.clear(); state.activeCaseView = ''; hydrateWorkspace(); state.questions = createQuestions(); closePerson(); render(); toast(result.warnings.length ? '已匯入；不同版本保留在草稿管理與自由調查。' : '已接回書桌備份。'); };
      add(body, add(el('div', 'lab-material-tools'), button('合併到目前書桌', () => apply('merge'), 'lab-button lab-button-primary'), button('接續匯入版本', () => apply('replace'), 'lab-button'), button('取消', closePerson, 'lab-button lab-button-quiet'))); showDialog('匯入前先看內容', body);
    } catch (error) { toast('備份未匯入：' + error.message + ' 目前工作仍保留。'); }
    finally { $('labSessionFile').value = ''; }
  }
  async function loadCases() {
    state.caseError = '';
    try {
      if (!globalThis.DynastyInvestigation) throw new Error('案卷程式未能載入，請重新整理。'); I = globalThis.DynastyInvestigation;
      const book = await readJSON('/static/data/history/chuhan-cases.v1.json'); let storage;
      try { storage = globalThis.localStorage; } catch (_) { storage = null; }
      state.engine = I.createEngine({ package: state.pkg, cases: book, storage }); state.casebook = book;
      state.engine.subscribe(updateSaveStatus); hydrateWorkspace(); state.questions = createQuestions(); updateSaveStatus(); render();
    } catch (error) { state.caseError = '案卷目前無法開啟：' + friendlyError(error.message); state.engine = null; state.casebook = null; updateSaveStatus(); if (state.index) render(); }
  }
  async function readJSON(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('資料讀取失敗（HTTP ' + response.status + '）。');
    return response.json();
  }
  async function loadPackage() {
    const sequence = ++state.loadSequence; $('labStatus').className = 'lab-status'; $('labStatus').textContent = '正在載入並驗證歷史資料…';
    try {
      if (!globalThis.DynastyHistory) throw new Error('共用資料程式未能載入。'); H = globalThis.DynastyHistory;
      const [pkg, schema] = await Promise.all([readJSON('/static/data/history/chuhan-foundation.v1.json'), readJSON('/static/data/history/schema.v1.json')]);
      if (sequence !== state.loadSequence) return;
      const index = H.createIndex(pkg, schema); state.index = index; state.pkg = index.package;
      state.filter = { from: String(H.yearOrdinal(pkg.coverage.window.start)), to: String(H.yearOrdinal(pkg.coverage.window.end)), personId: '', placeId: '', factionId: '', includeUnknown: false };
      years(); state.questions = createQuestions(); state.questionId = state.questions[0] ? state.questions[0].id : '';
      state.selectedEventId = pkg.events[0] ? pkg.events[0].id : ''; state.castEventId = state.selectedEventId;
      state.cast = new Set(pkg.events[0] ? pkg.events[0].contexts.slice(0, 2).map(context => context.personId) : []);
      $('labStatus').textContent = '楚漢史料已就緒。展開材料可追溯原紀年、原文與出處；未定之處保留異說。';
      $('labTabs').hidden = false; $('labDownload').disabled = false; renderCoverage(); updateLibraryStatus(); render(); await loadCases();
    } catch (error) {
      if (sequence !== state.loadSequence) return;
      state.index = null; state.pkg = null; $('labTabs').hidden = true; $('labDownload').disabled = true;
      $('labModePanel').replaceChildren(); $('labModePanel').setAttribute('aria-busy', 'false'); $('labPackageSummary').replaceChildren();
      const status = $('labStatus'); status.className = 'lab-status lab-status-error'; status.replaceChildren(el('p', '', '歷史資料尚未就緒：' + error.message), note('人物原檔不會因本頁載入失敗而被修改。'), button('重新載入資料', loadPackage, 'lab-button'));
    }
  }
  async function loadPrivateLibrary() {
    const query = new URLSearchParams(location.search);
    if (query.get('local') !== '1' || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return;
    const sequence = state.librarySequence; state.libraryBusy = true; updateLibraryStatus();
    try {
      const response = await fetch('/private-library.json', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('私人預覽人物快照未能讀取（HTTP ' + response.status + '）。');
      const text = await response.text(); if (sequence !== state.librarySequence) return;
      const library = H.parseLibrary(text, baseRecords); if (sequence !== state.librarySequence) return;
      const snapshotDate = response.headers && response.headers.get('X-Library-Snapshot-Date');
      state.library = library; state.libraryOrigin = '本機私人快照（' + (/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate || '') ? snapshotDate : '日期未標示') + '）'; state.libraryError = '';
    } catch (error) {
      if (sequence !== state.librarySequence) return;
      state.libraryError = error.message + ' 已保留內建資料；可自行讀取完整人物 JSON。';
    } finally {
      if (sequence === state.librarySequence) { state.libraryBusy = false; updateLibraryStatus(); if (state.index) render(); }
    }
  }
  async function importLibrary(file) {
    if (!file) return;
    const sequence = ++state.librarySequence; state.libraryBusy = true; state.libraryError = ''; updateLibraryStatus();
    try {
      if (file.size > 30_000_000) throw new Error('檔案超過本頁的30MB讀取上限。');
      const text = await file.text(); if (sequence !== state.librarySequence) return;
      const library = H.parseLibrary(text, baseRecords); if (sequence !== state.librarySequence) return;
      state.library = library; state.libraryOrigin = '本機檔案「' + file.name + '」';
    } catch (error) {
      if (sequence !== state.librarySequence) return;
      const errors = { INVALID_LIBRARY_JSON: 'JSON 格式不完整', UNSUPPORTED_LIBRARY_FORMAT: '不支援此人物檔格式', INVALID_LIBRARY_RECORD: '人物記錄缺少有效 ID、姓名或分類', DUPLICATE_LIBRARY_ID: '人物 ID 重複', INVALID_LIBRARY_SIZE: '人物資料超過讀取限制' };
      state.libraryError = '未載入：' + (errors[error.message] || error.message) + '。已保留先前人物資料與調查筆記。';
    } finally {
      if (sequence === state.librarySequence) { state.libraryBusy = false; $('labLibraryFile').value = ''; updateLibraryStatus(); if (state.index) render(); }
    }
  }
  $('labTabs').addEventListener('click', event => { const tab = event.target.closest('[data-mode]'); if (tab && state.index) { state.mode = tab.dataset.mode; persistWorkspace(); render(); } });
  $('labTabs').addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('#labTabs [role="tab"]')], current = tabs.indexOf(event.target);
    if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    state.mode = tabs[next].dataset.mode; persistWorkspace(); render(); tabs[next].focus();
  });
  $('labLibraryFile').addEventListener('change', event => importLibrary(event.target.files[0]));
  $('labDownload').addEventListener('click', download);
  $('labHelp').addEventListener('click', showGuide);
  $('labClearSession').addEventListener('click', showStorage);
  $('labSessionFile').addEventListener('change', event => importSession(event.target.files[0]));
  globalThis.addEventListener('pagehide', flushWorkspace);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushWorkspace(); });
  $('labDialog').addEventListener('click', event => { if (event.target === $('labDialog')) closePerson(); });
  document.addEventListener('keydown', event => {
    if ($('labDialog').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closePerson(); return; }
    if (event.key !== 'Tab') return;
    const veil = $('labDialog'), focusable = [...veil.querySelectorAll('button:not(:disabled),a[href],select,input,textarea,summary')].filter(node => {
      for (let parent = node.parentElement; parent && parent !== veil; parent = parent.parentElement) {
        if (parent.hidden) return false;
        if (parent.tagName === 'DETAILS' && !parent.open) { const summary = parent.querySelector(':scope > summary'); if (!summary || !summary.contains(node)) return false; }
      }
      return true;
    });
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !veil.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !veil.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
  H = globalThis.DynastyHistory;
  if (new URLSearchParams(location.search).get('local') === '1' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    const back = document.querySelector('.lab-back'); back.textContent = '資料包首頁 ↗'; back.href = '/history-lab';
    const brand = document.querySelector('.lab-brand'); brand.href = '/history-lab'; brand.setAttribute('aria-label', '返回史料與人物資料包首頁');
  }
  if (H) {
    try { state.library = H.parseLibrary(JSON.stringify({ customLegends: [], modifiedLegends: {} }), baseRecords); }
    catch (_) { state.libraryError = '內建人物庫未能解析；可自行讀取完整人物 JSON。'; }
    updateLibraryStatus(); loadPrivateLibrary();
  } else $('labLibraryFile').disabled = true;
  loadPackage();
})();
