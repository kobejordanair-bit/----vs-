(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const MODE_NAMES = { explore: '時空探索', investigate: '史論調查', cast: '人物編排' };
  const TYPE_NAMES = { emperor: '帝王類', general: '將帥類', minister: '謀臣類' };
  const FIELD_NAMES = { analysis: '人物分析', deepAnalysis: '深度分析', soulEssence: '人格精髓' };
  const PARTICIPATION = { present: '記述在場', 'reported-action': '有行動記述，未判定同室', mentioned: '只是提及，未證在場', unknown: '參與方式待考' };
  const EPISTEMIC = { 'source-report': '史籍記述', 'editorial-synthesis': '編輯整理', 'modern-identification': '現代定位' };
  const REVIEW = { 'source-checked': '出處已核讀', 'cross-checked': '跨出處核對', disputed: '保留異說', provisional: '暫定／待核' };
  const CLASSIFICATIONS = [ ['support', '支持我的解釋'], ['challenge', '質疑我的解釋'], ['context', '補充脈絡'], ['unclear', '尚不能判斷'] ];
  const RELATION_NAMES = { serves: '效力於', cooperates: '協作', opposes: '對立', controls: '控制', advises: '建議', recommends: '推薦', kinship: '親屬關係', negotiates: '交涉' };
  const state = {
    index: null, pkg: null, mode: 'explore', library: [], libraryOrigin: '內建人物庫',
    loadSequence: 0, librarySequence: 0, libraryBusy: false, libraryError: '',
    selectedEventId: '', filter: null, questions: [], questionId: '', investigations: new Map(),
    materialSearch: '', includeAllMaterials: false, castEventId: '', cast: new Set(), castSearch: '', castNotes: '',
    dialogPersonId: '', dialogQuestionId: '', dialogReturnFocus: null, dialogPreviousHidden: null, dialogPreviousInert: false
  };
  let H;
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
    const input = el(multiline ? 'textarea' : 'input'); input.id = id; input.value = value;
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
        explore: '選時間區間，再沿人物、古地名與勢力追查事件。年份換算未定的材料保留範圍。',
        investigate: '自選史料與原庫分析段落，排列支持、質疑與脈絡，再留下你的判斷。沒有標準心理答案或 AI 分數。',
        cast: '把人物安排到一件事件，核對各人的當時角色與記述方式。未列入本包不等於不能參與。'
      };
      add(mount, add(el('header', 'lab-mode-heading'), add(el('div'), el('h2', '', MODE_NAMES[state.mode]), el('p', '', descriptions[state.mode])), el('span', 'lab-mode-number', { explore: '壹', investigate: '貳', cast: '參' }[state.mode])));
      if (state.mode === 'explore') renderExplore(mount);
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
    add(mount, stats, coverage);
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
    caption.textContent = state.libraryError || '檔案只在本頁記憶體讀取；不上傳、不寫入人物館或瀏覽器存檔。比較下載只含選擇、筆記與段落索引，不含人物全文。';
  }
  function renderEvidence(claimIds, open) {
    const container = el('div');
    state.index.evidence([...new Set(claimIds)]).forEach(claim => {
      const card = detail(claim.statement, 'lab-evidence'); card.dataset.claimId = claim.id; if (open) card.open = true;
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
    const change = key => value => { state.filter[key] = value; render(); };
    add(fields, selectField('區間起點', 'labYearFrom', years(), state.filter.from, change('from')),
      selectField('區間終點', 'labYearTo', years(), state.filter.to, change('to')),
      selectField('人物（含只是被提及者）', 'labFilterPerson', [['', '全部人物'], ...state.pkg.persons.map(p => [p.id, p.name])], state.filter.personId, change('personId'), true),
      selectField('古地名', 'labFilterPlace', [['', '全部地點'], ...state.pkg.places.map(p => [p.id, p.name])], state.filter.placeId, change('placeId')),
      selectField('事件脈絡中的勢力', 'labFilterFaction', [['', '全部勢力'], ...state.pkg.factions.map(f => [f.id, f.name])], state.filter.factionId, change('factionId')));
    add(filters, fields, checkbox('也列年代未定的事件', 'labIncludeUnknown', state.filter.includeUnknown, value => { state.filter.includeUnknown = value; render(); }), note('區間相交僅表示可能涉及；不把保守年帶改成精確年表。'));
    const events = filteredEvents();
    if (Number(state.filter.from) > Number(state.filter.to)) add(filters, note('起點須早於或等於終點。請調整年份區間。', true));
    const list = el('div', 'lab-event-list'); list.setAttribute('aria-label', '符合篩選的事件');
    if (!events.some(event => event.id === state.selectedEventId)) state.selectedEventId = events[0] ? events[0].id : '';
    add(filters, note(events.length + '件符合目前篩選。'));
    events.forEach(event => {
      const choice = button('', () => { state.selectedEventId = event.id; render(); }, 'lab-event-choice', 'labEvent-' + event.id.replace(/[^a-z0-9-]/gi, '-'));
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
        current.materials.set(claim.id, { kind: 'claim', id: claim.id, classification: 'unclear' }); updateMaterialPool(); updateWorkbench();
      }, 'lab-button', 'labAdd-' + claim.id.replace(/[^a-z0-9-]/gi, '-')));
      card.lastChild.disabled = selected; add(mount, card);
    });
    if (!claims.length) add(mount, note('沒有符合的材料。可清除搜尋或擴大到全包；本頁不會補寫不存在的史料。'));
  }
  function originalKey(recordId, field, paragraphIndex) { return 'original:' + recordId + ':' + field + ':' + paragraphIndex; }
  function paragraphs(text) {
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
        if (material.kind === 'original') { originalCount++; return; }
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
          add(card, chip('原庫作者／AI 解讀 · 未核史實', true), el('p', '', material.recordName + '｜' + TYPE_NAMES[material.recordType] + '｜' + FIELD_NAMES[material.field] + ' 第' + (material.paragraphIndex + 1) + '段'), note('原始 ID：' + material.recordId + '；欄位：' + material.field));
          const quoted = detail('展開選取段落'); add(quoted, el('pre', 'lab-original-text', material.text)); add(card, quoted, note('保留加入時的文字；之後換載人物檔不會默默更換此材料。'));
        }
        const tools = el('div', 'lab-material-tools');
        const label = el('label', '', '我把它視為 '); const select = el('select'); select.id = 'labClassify-' + index; select.setAttribute('aria-label', '第' + (index + 1) + '項材料分類');
        CLASSIFICATIONS.forEach(([value, text]) => { const option = el('option', '', text); option.value = value; add(select, option); }); select.value = material.classification;
        select.addEventListener('change', () => { material.classification = select.value; }); add(label, select);
        add(tools, label, button('移除', () => { current.materials.delete(key); updateMaterialPool(); updateWorkbench(); }, 'lab-button lab-button-quiet')); add(card, tools); add(mount, card);
      });
      add(mount, textField('我的判斷與尚未解決的疑問', 'labConclusion', current.conclusion, value => { current.conclusion = value; }, true),
        selectField('目前判斷狀態（由我標記）', 'labCertainty', [['open', '仍待查證'], ['tentative', '暫有解釋，保留異說'], ['enough-for-now', '目前材料足以支持我的說明']], current.certainty, value => { current.certainty = value; }, true),
        note('下載比較記錄可保留筆記與材料索引。人物段落只記 ID、欄位與段號，不放入原文。'));
    });
  }
  function renderCast(mount) {
    const event = state.index.get(state.castEventId), layout = el('div', 'lab-layout'), left = el('div', 'lab-column'), right = el('div', 'lab-column');
    const selection = panel('安排哪些人物？');
    add(selection, selectField('事件', 'labCastEvent', state.pkg.events.map(item => [item.id, item.title]), state.castEventId, value => { state.castEventId = value; render(); }, true), note(event ? H.formatTime(event.time) : '尚無事件'));
    add(selection, note('可選的是本包人物，並非已把全部人物庫轉換成可編排角色。跨事件保留所選人物，便於比較身份變化。'), textField('搜尋本包人物', 'labCastSearch', state.castSearch, value => { state.castSearch = value; updateRoster(); }));
    const roster = el('div', 'lab-roster'); roster.id = 'labRoster'; add(selection, roster);
    add(selection, button('清空人物選擇', () => { state.cast.clear(); updateRoster(); updateCastResult(); }, 'lab-button lab-button-quiet'), note('你可以嘗試未被本事件記載的人物；頁面會保留這個資料缺口。'));
    add(left, selection);
    const results = panel('編排後的史料核對'); results.id = 'labCastResults'; add(right, results);
    add(right, add(panel('我的編排想法'), textField('想呈現的互動，以及哪些只是我的創作', 'labCastNotes', state.castNotes, value => { state.castNotes = value; }, true), note('本頁核對角色與參與記述，不會自動生成對白、人格或勝負。')));
    add(mount, add(layout, left, right)); updateRoster(); updateCastResult();
  }
  function updateRoster() {
    const mount = $('labRoster'); if (!mount) return; mount.replaceChildren();
    const query = state.castSearch.trim().toLocaleLowerCase();
    const persons = state.pkg.persons.filter(person => !query || (person.name + person.aliases.join(' ')).toLocaleLowerCase().includes(query));
    persons.forEach(person => {
      const label = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = state.cast.has(person.id); input.dataset.castPerson = person.id;
      input.addEventListener('change', () => { if (input.checked) state.cast.add(person.id); else state.cast.delete(person.id); updateCastResult(); });
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
    if ((state.mode === 'investigate' && $('labDialog').hidden) || !state.dialogQuestionId) state.dialogQuestionId = state.questionId || (state.questions[0] ? state.questions[0].id : '');
    const veil = $('labDialog'), page = $('labPage');
    if (veil.hidden) {
      state.dialogReturnFocus = document.activeElement; state.dialogPreviousHidden = page.getAttribute('aria-hidden'); state.dialogPreviousInert = page.inert;
      page.inert = true; page.setAttribute('aria-hidden', 'true'); document.body.classList.add('lab-dialog-open');
    }
    veil.replaceChildren(); veil.hidden = false;
    const person = state.index.get(personId), dialog = el('section', 'lab-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'labPersonTitle');
    const title = el('h2', '', person.name + ' · 人物原文'); title.id = 'labPersonTitle';
    const close = button('關閉', closePerson, 'lab-button lab-button-quiet', 'labDialogClose');
    const body = el('div', 'lab-dialog-body');
    add(dialog, add(el('header', 'lab-dialog-header'), title, close), body); add(veil, dialog);
    add(body, note('原庫作者／AI 解讀與本包史料分開。原文保持原樣，不自動判人格、摘要或核定真偽。', true));
    const event = eventId ? state.index.get(eventId) : null, context = event ? event.contexts.find(item => item.personId === personId) : null;
    if (context) add(body, note('此事件「' + event.title + '」的角色：' + context.role + '｜' + PARTICIPATION[context.participation]));
    if (person.note) add(body, note(person.note));
    const matches = state.index.originalRecords(personId, state.library);
    add(body, note('原庫分類是記錄身份，不代表這位人物在所選事件已任帝王或該官職。多身份記錄分開呈現。'));
    if (state.questions.length) add(body, selectField('把選取段落加入哪個調查？', 'labOriginalQuestion', state.questions.map(question => [question.id, question.title]), state.dialogQuestionId, value => { state.dialogQuestionId = value; openPerson(personId, eventId); }, true));
    if (!matches.length) add(body, note('此人目前只有史料脈絡身份，尚無已核對的原人物庫 ID；不以同名人物自動補連。', true));
    matches.forEach((match, recordIndex) => {
      const card = el('article', 'lab-original-record'); card.dataset.originalId = match.link.recordId;
      add(card, el('h3', '', match.link.name + ' · ' + TYPE_NAMES[match.link.type]), note('原始 ID：' + match.link.recordId), note(match.link.note));
      if (match.status !== 'matched') {
        add(card, note(match.status === 'ambiguous' ? '原庫 ID／姓名／分類出現多筆相符，尚未選定記錄。' : '目前載入的資料未含這個 ID、姓名與分類完全相符的記錄。可讀取完整人物 JSON 補上；本頁不捏造原文。', true));
      } else {
        const record = match.record;
        const metadata = ['title', 'rank', 'tag', 'dynasty', 'desc', 'poem'].filter(field => typeof record[field] === 'string' && record[field].trim());
        if (metadata.length) { const info = detail('原庫簡介與標籤'); info.open = true; metadata.forEach(field => add(info, el('pre', 'lab-original-text', ({ title: '稱號', rank: '階位', tag: '標籤', dynasty: '時代', desc: '簡介', poem: '詩詞' }[field]) + '：' + record[field]))); add(card, info); }
        Object.entries(FIELD_NAMES).forEach(([field, label]) => {
          if (typeof record[field] !== 'string' || !record[field].trim()) { add(card, note(label + '：此記錄未提供此欄文字。')); return; }
          const text = record[field], full = detail(label + ' · 完整原文'); add(full, el('pre', 'lab-original-text', text)); add(card, full);
          const choices = detail('從「' + label + '」選段落作調查材料');
          const blocks = paragraphs(text);
          add(choices, note('按原文空行分段；無空行時按換行分段。只選材料，不改原文。'));
          blocks.forEach((block, paragraphIndex) => {
            const key = originalKey(record.id, field, paragraphIndex), current = state.dialogQuestionId ? investigation(state.dialogQuestionId) : null;
            const row = el('div', 'lab-original-paragraph'); row.dataset.originalField = field; row.dataset.paragraphIndex = String(paragraphIndex);
            const selected = current && current.materials.has(key);
            const pick = button(selected ? '已加入第' + (paragraphIndex + 1) + '段' : '加入第' + (paragraphIndex + 1) + '段', () => {
              const target = investigation(state.dialogQuestionId);
              target.materials.set(key, { kind: 'original', personId, recordId: record.id, recordName: record.name, recordType: record.type, field, paragraphIndex, text: block, classification: 'unclear' });
              pick.disabled = true; pick.textContent = '已加入第' + (paragraphIndex + 1) + '段'; updateWorkbench();
              const feedback = $('labOriginalFeedback'); feedback.textContent = '已加入「' + state.questions.find(question => question.id === state.dialogQuestionId).title + '」的調查桌。';
            }, 'lab-button', 'labParagraph-' + recordIndex + '-' + field + '-' + paragraphIndex);
            pick.disabled = !current || Boolean(selected); add(row, pick, el('pre', 'lab-original-text', block)); add(choices, row);
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
    veil.hidden = true; veil.replaceChildren(); state.dialogPersonId = '';
    const page = $('labPage'); page.inert = state.dialogPreviousInert;
    if (state.dialogPreviousHidden === null) page.removeAttribute('aria-hidden'); else page.setAttribute('aria-hidden', state.dialogPreviousHidden);
    document.body.classList.remove('lab-dialog-open');
    if (state.dialogReturnFocus && state.dialogReturnFocus.isConnected) state.dialogReturnFocus.focus();
    else $('lab-tab-' + state.mode).focus();
  }
  function download() {
    if (!state.index) return;
    const investigations = [...state.investigations].map(([questionId, value]) => ({ questionId, conclusion: value.conclusion, certainty: value.certainty,
      materials: [...value.materials.values()].map(material => material.kind === 'claim' ? { kind: 'claim', claimId: material.id, classification: material.classification } : { kind: 'original-analysis', personId: material.personId, recordId: material.recordId, field: material.field, paragraphIndex: material.paragraphIndex, classification: material.classification }) }));
    const record = { format: 'dynasty-history-comparison', version: 1, packageId: state.pkg.packageId, packageVersion: state.pkg.packageVersion,
      createdOn: new Date().toISOString(), mode: state.mode, filter: { ...state.filter }, selectedEventId: state.selectedEventId,
      investigations, cast: { eventId: state.castEventId, personIds: [...state.cast], note: state.castNotes },
      privacy: '原庫段落僅保存ID、欄位與段號，不保存原文。自行撰寫的筆記會包含在本檔。' };
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob);
    const anchor = el('a'); anchor.href = url; anchor.download = '王侯將相_玩法比較_' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      $('labStatus').textContent = '資料結構與引用已通過驗證 · ' + pkg.packageVersion + '。本包為選定切片；年代與位置未核之處保留缺口。';
      $('labTabs').hidden = false; $('labDownload').disabled = false; renderCoverage(); updateLibraryStatus(); render();
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
      state.library = library; state.libraryOrigin = '本機私人快照（2026-09-30）'; state.libraryError = '';
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
  $('labTabs').addEventListener('click', event => { const tab = event.target.closest('[data-mode]'); if (tab && state.index) { state.mode = tab.dataset.mode; render(); } });
  $('labTabs').addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('#labTabs [role="tab"]')], current = tabs.indexOf(event.target);
    if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    state.mode = tabs[next].dataset.mode; render(); tabs[next].focus();
  });
  $('labLibraryFile').addEventListener('change', event => importLibrary(event.target.files[0]));
  $('labDownload').addEventListener('click', download);
  $('labDialog').addEventListener('click', event => { if (event.target === $('labDialog')) closePerson(); });
  document.addEventListener('keydown', event => {
    if ($('labDialog').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closePerson(); return; }
    if (event.key !== 'Tab') return;
    const veil = $('labDialog'), focusable = [...veil.querySelectorAll('button:not(:disabled),a[href],select,input,textarea,summary')].filter(node => !node.closest('details:not([open])') || node.tagName === 'SUMMARY' && node.parentElement === node.closest('details:not([open])'));
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
