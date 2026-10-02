(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DynastyInvestigation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const copy = value => JSON.parse(JSON.stringify(value));
  const ORIGINAL_FIELDS = ['analysis', 'deepAnalysis', 'soulEssence', 'desc', 'poem'];
  const CLASSIFICATIONS = ['support', 'challenge', 'context', 'unclear'];
  const TYPES = ['emperor', 'general', 'minister'];
  const MAX_IMPORT_BYTES = 8000000, MAX_SAVE_BYTES = 2000000;
  const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const text = (value, max = 20000) => typeof value === 'string' && value.length <= max;
  const nonempty = (value, max = 20000) => text(value, max) && value.trim().length > 0;
  const unique = values => [...new Set(values)];
  const equalIds = (a, b) => a.length === b.length && a.every(id => b.includes(id));
  function byteLength(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 0x80) bytes++;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }
  function fail(code) { throw new Error(code); }
  function paragraphs(value) {
    if (typeof value !== 'string') return [];
    const normalized = value.replace(/\r\n?/g, '\n');
    const blocks = normalized.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean);
    return blocks.length > 1 ? blocks : normalized.split('\n').map(item => item.trim()).filter(Boolean);
  }
  // Two independently mixed 32-bit hashes detect accidental content changes.
  // This is a revision marker, not cryptographic authentication or an identity proof.
  function fingerprint(value) {
    if (typeof value !== 'string') fail('INVALID_FINGERPRINT_INPUT');
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      a = Math.imul(a ^ code, 0x01000193);
      b = Math.imul(b ^ code, 0x85ebca6b); b ^= b >>> 13;
    }
    return 'text-v1:' + value.length + ':' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  function createOriginalReference(personId, record, field, paragraphIndex) {
    if (personId !== null && !nonempty(personId, 200) || !plain(record) || !nonempty(record.id, 500) || !nonempty(record.name, 200) || !TYPES.includes(record.type) || !ORIGINAL_FIELDS.includes(field) || typeof record[field] !== 'string') fail('INVALID_ORIGINAL_REFERENCE');
    const blocks = paragraphs(record[field]);
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || paragraphIndex >= blocks.length) fail('INVALID_PARAGRAPH_INDEX');
    return { kind: 'original-analysis', personId, recordId: record.id, recordName: record.name, recordType: record.type, field, paragraphIndex,
      fingerprint: fingerprint(blocks[paragraphIndex]), articleFingerprint: fingerprint(record[field]), classification: 'unclear', note: '' };
  }
  function validateOriginalReference(ref, allowLegacy = false) {
    const keys = ['kind', 'personId', 'recordId', 'recordName', 'recordType', 'field', 'paragraphIndex', 'fingerprint', 'articleFingerprint', 'classification', 'note'];
    return plain(ref) && Object.keys(ref).every(key => keys.includes(key)) && ref.kind === 'original-analysis' && (ref.personId === null || nonempty(ref.personId, 200)) && nonempty(ref.recordId, 500) && (nonempty(ref.recordName, 200) || allowLegacy && ref.recordName === null) && (TYPES.includes(ref.recordType) || allowLegacy && ref.recordType === null) && ORIGINAL_FIELDS.includes(ref.field) && Number.isInteger(ref.paragraphIndex) && ref.paragraphIndex >= 0 && ref.paragraphIndex < 100000 && (typeof ref.fingerprint === 'string' && /^text-v1:\d+:[a-f0-9]{16}$/.test(ref.fingerprint) || allowLegacy && ref.fingerprint === null) && (typeof ref.articleFingerprint === 'string' && /^text-v1:\d+:[a-f0-9]{16}$/.test(ref.articleFingerprint) || allowLegacy && ref.articleFingerprint === null) && CLASSIFICATIONS.includes(ref.classification) && text(ref.note, 10000);
  }
  function resolveOriginalReference(ref, library, pkg) {
    if (!validateOriginalReference(ref, true) || !Array.isArray(library)) return { status: 'invalid', text: null, message: '段落引用格式無效。' };
    const person = pkg && Array.isArray(pkg.persons) ? pkg.persons.find(item => item.id === ref.personId) : null;
    const link = person && person.libraryRefs.find(item => item.recordId === ref.recordId && (ref.recordName === null || item.name === ref.recordName) && (ref.recordType === null || item.type === ref.recordType));
    if (pkg && ref.personId !== null && !link) return { status: 'identity-mismatch', text: null, message: '這個人物與原庫記錄的身份連結已不存在，請重新選段。' };
    const matches = library.filter(record => record && record.id === ref.recordId && (ref.recordName === null || record.name === ref.recordName) && (ref.recordType === null || record.type === ref.recordType));
    if (matches.length === 0) return { status: 'missing', text: null, message: '尚未載入對應人物原文；已保留段落引用。' };
    if (matches.length > 1) return { status: 'ambiguous', text: null, message: '有多筆記錄符合此身份，請先確認原庫。' };
    const record = matches[0];
    if (link && (record.name !== link.name || record.type !== link.type)) return { status: 'identity-mismatch', text: null, message: '原庫姓名或分類與人物連結不符。' };
    if (typeof record[ref.field] !== 'string') return { status: 'missing-field', text: null, message: '已載入的記錄缺少此分析欄位。' };
    const blocks = paragraphs(record[ref.field]), block = blocks[ref.paragraphIndex];
    if (block === undefined) return { status: 'stale', text: null, message: '原文章節已變動，原段號不存在，請重新選段。' };
    if (ref.fingerprint === null || ref.articleFingerprint === null) return { status: 'unverified', text: null, message: '舊版引用沒有內容指紋；請核對原文後重新選段。' };
    if (fingerprint(block) !== ref.fingerprint) return { status: 'stale', text: null, message: '此段內容已改動，請重新選段，避免把新文字當作舊證據。' };
    if (fingerprint(record[ref.field]) !== ref.articleFingerprint) return { status: 'article-changed', text: block, message: '此段仍吻合，但全文其他部分已變動。請連同脈絡重新閱讀。' };
    return { status: 'matched', text: block, linked: ref.personId !== null, unlinkedInfo: ref.personId === null ? '此原庫人物尚未連入歷史資料包。' : null, message: ref.personId === null ? '段落內容與選取時一致；此原庫人物尚未連入歷史資料包，請作為原庫解讀材料閱讀。' : '段落內容與選取時一致；原庫解讀仍須與史料分開評估。' };
  }
  function materialKey(material) {
    return material.kind === 'claim' ? 'claim|' + material.claimId : 'original|' + material.personId + '|' + material.recordId + '|' + material.field + '|' + material.paragraphIndex + '|' + (material.fingerprint || 'legacy');
  }
  function validateCases(book, pkg) {
    const errors = [];
    const check = (condition, message) => { if (!condition) errors.push(message); };
    if (!plain(pkg) || !Array.isArray(pkg.claims) || !Array.isArray(pkg.persons) || !Array.isArray(pkg.events)) return { valid: false, errors: ['缺少已驗證的歷史資料包'] };
    const claimIds = new Set(pkg.claims.map(item => item && item.id));
    const personIds = new Set(pkg.persons.map(item => item && item.id));
    const eventIds = new Set(pkg.events.map(item => item && item.id));
    const ids = new Set();
    const id = (value, prefix, at) => { check(typeof value === 'string' && new RegExp('^' + prefix + ':[a-z0-9][a-z0-9-]*$').test(value), at + ': ID 格式錯誤'); check(!ids.has(value), at + ': ID 重複'); ids.add(value); };
    const refs = (values, targets, at, min = 0) => {
      if (!Array.isArray(values)) { errors.push(at + ': 須為引用陣列'); return; }
      check(values.length >= min && values.length <= 500 && unique(values).length === values.length, at + ': 引用數量或重複錯誤');
      values.forEach(value => check(targets.has(value), at + ': 不存在的引用 ' + value));
    };
    const object = (value, keys, at) => {
      if (!plain(value)) { errors.push(at + ': 須為物件'); return false; }
      check(Object.keys(value).every(key => keys.includes(key)), at + ': 不支援的欄位');
      return true;
    };
    if (!object(book, ['format', 'schemaVersion', 'id', 'version', 'title', 'introduction', 'packageId', 'packageVersion', 'cases'], 'casebook')) return { valid: false, errors };
    check(book.format === 'dynasty-history-casebook' && book.schemaVersion === 1, '不支援的案件集格式或版本');
    id(book.id, 'casebook', 'casebook');
    check(nonempty(book.version, 80), '案件集版本錯誤');
    check(book.packageId === pkg.packageId && book.packageVersion === pkg.packageVersion, '案件集與歷史資料包版本不一致');
    ['title', 'introduction'].forEach(key => check(nonempty(book[key], 10000), 'casebook.' + key + ': 缺少文字'));
    if (!Array.isArray(book.cases) || book.cases.length < 1 || book.cases.length > 50) return { valid: false, errors: [...errors, '案件數量須介於 1 至 50'] };
    const orders = new Set();
    for (const item of book.cases) {
      if (!object(item, ['id', 'order', 'title', 'subtitle', 'theme', 'difficulty', 'estimatedMinutes', 'premise', 'inquiry', 'eventIds', 'personIds', 'claimIds', 'chapters', 'tasks', 'perspectives', 'finale'], 'case')) continue;
      id(item.id, 'case', 'case');
      check(Number.isInteger(item.order) && item.order > 0 && !orders.has(item.order), item.id + ': 順序錯誤或重複'); orders.add(item.order);
      ['title', 'subtitle', 'theme', 'premise', 'inquiry'].forEach(key => check(nonempty(item[key], 10000), item.id + '.' + key + ': 缺少文字'));
      check(['入門', '進階'].includes(item.difficulty), item.id + ': 難度錯誤');
      check(Number.isInteger(item.estimatedMinutes) && item.estimatedMinutes > 0 && item.estimatedMinutes <= 240, item.id + ': 時長錯誤');
      refs(item.eventIds, eventIds, item.id + '.eventIds', 1); refs(item.personIds, personIds, item.id + '.personIds', 1); refs(item.claimIds, claimIds, item.id + '.claimIds', 1);
      if (!Array.isArray(item.chapters) || item.chapters.length < 1 || item.chapters.length > 20 || !Array.isArray(item.tasks) || item.tasks.length < 1 || item.tasks.length > 50) { errors.push(item.id + ': 章節／任務數量錯誤'); continue; }
      const chapterIds = new Set(item.chapters.map(chapter => chapter && chapter.id)), taskIds = new Set(item.tasks.map(task => task && task.id));
      const placement = new Map();
      for (const chapter of item.chapters) {
        if (!object(chapter, ['id', 'title', 'intro', 'claimIds', 'taskIds'], item.id + '.chapter')) continue;
        id(chapter.id, 'chapter', item.id + '.chapter');
        check(nonempty(chapter.title, 1000) && nonempty(chapter.intro, 10000), chapter.id + ': 缺少章節文字');
        refs(chapter.claimIds, claimIds, chapter.id + '.claimIds'); refs(chapter.taskIds, taskIds, chapter.id + '.taskIds', 1);
        if (Array.isArray(chapter.taskIds)) chapter.taskIds.forEach(taskId => { check(!placement.has(taskId), chapter.id + ': 任務重複置於不同章節'); placement.set(taskId, chapter.id); });
      }
      for (const task of item.tasks) {
        if (!object(task, ['id', 'chapterId', 'type', 'prompt', 'choices', 'expectedChoiceIds', 'acceptableOrders', 'explanation', 'claimIds', 'hint'], item.id + '.task')) continue;
        id(task.id, 'task', item.id + '.task');
        check(chapterIds.has(task.chapterId) && placement.get(task.id) === task.chapterId, task.id + ': 章節連結不一致');
        check(['single-choice', 'multi-choice', 'sequence'].includes(task.type), task.id + ': 任務類型錯誤');
        ['prompt', 'explanation', 'hint'].forEach(key => check(nonempty(task[key], 10000), task.id + '.' + key + ': 缺少任務文字'));
        refs(task.claimIds, claimIds, task.id + '.claimIds', 1);
        if (!Array.isArray(task.choices) || task.choices.length < 2 || task.choices.length > 20) { errors.push(task.id + ': 選項數量錯誤'); continue; }
        const choiceIds = new Set();
        for (const choice of task.choices) {
          if (!object(choice, ['id', 'label', 'feedback', 'claimIds'], task.id + '.choice')) continue;
          check(nonempty(choice.id, 80) && /^[a-z0-9][a-z0-9-]*$/.test(choice.id) && !choiceIds.has(choice.id), task.id + ': 選項 ID 錯誤或重複'); choiceIds.add(choice.id);
          check(nonempty(choice.label, 2000) && nonempty(choice.feedback, 10000), task.id + ': 選項缺少文字'); refs(choice.claimIds, claimIds, task.id + '.choice.claimIds', 1);
        }
        if (task.type === 'sequence') {
          check(!own(task, 'expectedChoiceIds'), task.id + ': 排序題不能含選擇題答案');
          if (!Array.isArray(task.acceptableOrders) || task.acceptableOrders.length < 1 || task.acceptableOrders.length > 30) errors.push(task.id + ': 缺少可接受順序');
          else task.acceptableOrders.forEach(order => { refs(order, choiceIds, task.id + '.acceptableOrders', choiceIds.size); check(Array.isArray(order) && order.length === choiceIds.size, task.id + ': 順序須列全部選項'); });
        } else {
          check(!own(task, 'acceptableOrders'), task.id + ': 選擇題不能含排序答案'); refs(task.expectedChoiceIds, choiceIds, task.id + '.expectedChoiceIds', 1);
          if (task.type === 'single-choice') check(Array.isArray(task.expectedChoiceIds) && task.expectedChoiceIds.length === 1, task.id + ': 單選題須只有一個答案');
        }
      }
      if (!Array.isArray(item.perspectives) || item.perspectives.length > 30) errors.push(item.id + ': 人物視角格式錯誤');
      else for (const perspective of item.perspectives) {
        if (!object(perspective, ['personId', 'framing', 'claimIds', 'analysisPrompt'], item.id + '.perspective')) continue;
        check(personIds.has(perspective.personId), item.id + ': 人物視角引用錯誤');
        check(nonempty(perspective.framing, 10000) && nonempty(perspective.analysisPrompt, 10000), item.id + ': 視角缺少文字'); refs(perspective.claimIds, claimIds, item.id + '.perspective.claimIds', 1);
      }
      if (object(item.finale, ['prompt', 'reflectionPrompts', 'closingNote', 'minimumClaimMaterials', 'minimumOriginalMaterials', 'minimumThesisLength', 'minimumCounterargumentLength', 'minimumUncertaintyLength'], item.id + '.finale')) {
        check(nonempty(item.finale.prompt, 10000) && nonempty(item.finale.closingNote, 10000), item.id + ': 結案缺少文字');
        check(Array.isArray(item.finale.reflectionPrompts) && item.finale.reflectionPrompts.length <= 20 && item.finale.reflectionPrompts.every(value => nonempty(value, 2000)), item.id + ': 反思提示格式錯誤');
        ['minimumClaimMaterials', 'minimumOriginalMaterials'].forEach(key => check(Number.isInteger(item.finale[key]) && item.finale[key] >= 0 && item.finale[key] <= 50, item.id + '.' + key + ': 材料下限錯誤'));
        ['minimumThesisLength', 'minimumCounterargumentLength', 'minimumUncertaintyLength'].forEach(key => check(Number.isInteger(item.finale[key]) && item.finale[key] >= 0 && item.finale[key] <= 10000, item.id + '.' + key + ': 文字下限錯誤'));
      }
    }
    return { valid: errors.length === 0, errors };
  }

  function createEngine(options) {
    if (!plain(options)) fail('INVALID_ENGINE_OPTIONS');
    const validation = validateCases(options.cases, options.package);
    if (!validation.valid) { const error = new Error('INVALID_CASEBOOK'); error.details = validation.errors; throw error; }
    const pkg = copy(options.package), book = copy(options.cases), casesById = new Map(book.cases.map(item => [item.id, item]));
    const claimsById = new Map(pkg.claims.map(item => [item.id, item])), personsById = new Map(pkg.persons.map(item => [item.id, item]));
    const eventIds = new Set(pkg.events.map(item => item.id)), placeIds = new Set((pkg.places || []).map(item => item.id)), factionIds = new Set((pkg.factions || []).map(item => item.id));
    const listeners = new Set(), previews = new Map();
    const storage = options.storage || null, storageKey = 'dynasty-history-investigation.v1.' + pkg.packageId;
    let observedRaw, sequence = 0, preservedSave = null;
    function stamp() {
      const value = options.now ? options.now() : new Date().toISOString();
      const normalized = value instanceof Date ? value.toISOString() : value;
      if (!validDate(normalized)) fail('INVALID_CLOCK'); return normalized;
    }
    function validDate(value) { return typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
    function freshProgress(caseId) { return { caseId, startedAt: null, updatedAt: null, openedClaimIds: [], answers: [], materials: [], thesis: '', counterargument: '', uncertainty: '', completedAt: null, archive: [] }; }
    const firstEventId = pkg.events[0] ? pkg.events[0].id : '';
    function freshWorkspace() { return { mode: 'cases', selectedEventId: firstEventId, filter: null, cast: { eventId: firstEventId, personIds: [], note: '' }, freeInvestigations: [] }; }
    const initialTime = stamp();
    let state = { format: 'dynasty-history-investigation', schemaVersion: 1, packageId: pkg.packageId, packageVersion: pkg.packageVersion, casebookId: book.id, casebookVersion: book.version,
      createdAt: initialTime, updatedAt: initialTime, activeCaseId: book.cases.slice().sort((a, b) => a.order - b.order)[0].id, cases: book.cases.map(item => freshProgress(item.id)), workspace: freshWorkspace(), recoveries: [] };
    let saveStatus = { status: storage ? 'empty' : 'disabled', message: storage ? '開始操作後會自動保存在此瀏覽器。' : '本次進度保存在記憶體，請下載存檔保留。', savedAt: null, reason: null };
    function knownCase(caseId) { const item = casesById.get(caseId); if (!item) fail('UNKNOWN_CASE'); return item; }
    function progress(caseId) { knownCase(caseId); return state.cases.find(item => item.caseId === caseId); }
    function taskFor(caseId, taskId) { const task = knownCase(caseId).tasks.find(item => item.id === taskId); if (!task) fail('UNKNOWN_TASK'); return task; }
    function ensureIds(value, allowed, max, code) { if (!Array.isArray(value) || value.length > max || unique(value).length !== value.length || value.some(id => !allowed.has(id))) fail(code); return value.slice(); }
    function onlyKeys(value, keys, code) { if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail(code); }
    function cleanMaterial(value, legacy = true) {
      if (plain(value) && value.kind === 'claim') {
        onlyKeys(value, ['kind', 'claimId', 'classification', 'note'], 'INVALID_MATERIAL');
        if (!claimsById.has(value.claimId) || !CLASSIFICATIONS.includes(value.classification) || !text(value.note, 10000)) fail('INVALID_MATERIAL');
        return { kind: 'claim', claimId: value.claimId, classification: value.classification, note: value.note };
      }
      if (!validateOriginalReference(value, legacy)) fail('INVALID_ORIGINAL_REFERENCE');
      const person = personsById.get(value.personId);
      if (value.personId !== null && (!person || !person.libraryRefs.some(link => link.recordId === value.recordId && (value.recordName === null || link.name === value.recordName) && (value.recordType === null || link.type === value.recordType)))) fail('ORIGINAL_IDENTITY_MISMATCH');
      if (value.personId === null) {
        const knownLinks = pkg.persons.flatMap(item => item.libraryRefs).filter(link => link.recordId === value.recordId);
        if (knownLinks.length && !knownLinks.some(link => link.name === value.recordName && link.type === value.recordType)) fail('ORIGINAL_IDENTITY_MISMATCH');
      }
      return copy(value);
    }
    function cleanMaterials(values) {
      if (!Array.isArray(values) || values.length > 150) fail('TOO_MANY_MATERIALS');
      const materials = values.map(value => cleanMaterial(value));
      if (unique(materials.map(materialKey)).length !== materials.length) fail('DUPLICATE_MATERIAL'); return materials;
    }
    function validateAnswer(caseId, answer) {
      onlyKeys(answer, ['taskId', 'choiceIds', 'attempts', 'submittedAt'], 'INVALID_ANSWER');
      const task = taskFor(caseId, answer.taskId);
      ensureIds(answer.choiceIds, new Set(task.choices.map(choice => choice.id)), 20, 'INVALID_CHOICE');
      if (!Number.isInteger(answer.attempts) || answer.attempts < 0 || answer.attempts > 1000000 || answer.submittedAt !== null && !validDate(answer.submittedAt)) fail('INVALID_ANSWER');
      if (answer.submittedAt && (answer.attempts === 0 || task.type === 'single-choice' && answer.choiceIds.length !== 1 || task.type === 'sequence' && answer.choiceIds.length !== task.choices.length || task.type === 'multi-choice' && answer.choiceIds.length === 0)) fail('INVALID_ANSWER');
      return copy(answer);
    }
    function cleanProgress(value, withArchive = true) {
      const keys = ['caseId', 'startedAt', 'updatedAt', 'openedClaimIds', 'answers', 'materials', 'thesis', 'counterargument', 'uncertainty', 'completedAt'];
      if (withArchive) keys.push('archive'); onlyKeys(value, keys, 'INVALID_PROGRESS'); knownCase(value.caseId);
      for (const key of ['startedAt', 'updatedAt', 'completedAt']) if (value[key] !== null && !validDate(value[key])) fail('INVALID_PROGRESS_DATE');
      ensureIds(value.openedClaimIds, new Set(claimsById.keys()), 1000, 'INVALID_VIEWED_EVIDENCE');
      if (!Array.isArray(value.answers) || value.answers.length > knownCase(value.caseId).tasks.length || unique(value.answers.map(answer => answer && answer.taskId)).length !== value.answers.length) fail('INVALID_ANSWERS');
      const result = { caseId: value.caseId, startedAt: value.startedAt, updatedAt: value.updatedAt, openedClaimIds: value.openedClaimIds.slice(), answers: value.answers.map(answer => validateAnswer(value.caseId, answer)), materials: cleanMaterials(value.materials) };
      for (const key of ['thesis', 'counterargument', 'uncertainty']) { if (!text(value[key], 20000)) fail('INVALID_WRITING'); result[key] = value[key]; }
      result.completedAt = value.completedAt;
      if (withArchive) {
        if (!Array.isArray(value.archive) || value.archive.length > 50) fail('INVALID_ARCHIVE');
        const seen = new Set();
        result.archive = value.archive.map(entry => {
          onlyKeys(entry, ['id', 'completedAt', 'packageVersion', 'casebookVersion', 'snapshot'], 'INVALID_ARCHIVE');
          if (!nonempty(entry.id, 300) || seen.has(entry.id) || !validDate(entry.completedAt) || !nonempty(entry.packageVersion, 80) || !nonempty(entry.casebookVersion, 80)) fail('INVALID_ARCHIVE');
          seen.add(entry.id); const snapshot = cleanProgress(entry.snapshot, false); if (snapshot.caseId !== value.caseId) fail('INVALID_ARCHIVE_CASE');
          if (snapshot.completedAt !== entry.completedAt) fail('INVALID_ARCHIVE_COMPLETION');
          return { id: entry.id, completedAt: entry.completedAt, packageVersion: entry.packageVersion, casebookVersion: entry.casebookVersion, snapshot };
        });
      }
      return result;
    }
    function cleanWorkspace(value) {
      onlyKeys(value, ['mode', 'selectedEventId', 'filter', 'cast', 'freeInvestigations'], 'INVALID_WORKSPACE');
      if (!['explore', 'investigate', 'cast', 'cases', 'library'].includes(value.mode) || value.selectedEventId !== '' && !eventIds.has(value.selectedEventId)) fail('INVALID_WORKSPACE');
      let filter = null;
      if (value.filter !== null) {
        onlyKeys(value.filter, ['from', 'to', 'personId', 'placeId', 'factionId', 'includeUnknown'], 'INVALID_FILTER');
        const f = value.filter;
        if (![f.from, f.to].every(year => typeof year === 'string' && /^-?\d{1,5}$/.test(year) && Number(year) >= -9998 && Number(year) <= 9999) || typeof f.includeUnknown !== 'boolean' || f.personId !== '' && !personsById.has(f.personId) || f.placeId !== '' && !placeIds.has(f.placeId) || f.factionId !== '' && !factionIds.has(f.factionId)) fail('INVALID_FILTER');
        filter = copy(f);
      }
      onlyKeys(value.cast, ['eventId', 'personIds', 'note'], 'INVALID_CAST');
      if (value.cast.eventId !== '' && !eventIds.has(value.cast.eventId) || !text(value.cast.note, 20000)) fail('INVALID_CAST');
      ensureIds(value.cast.personIds, new Set(personsById.keys()), 100, 'INVALID_CAST');
      if (!Array.isArray(value.freeInvestigations) || value.freeInvestigations.length > 100) fail('INVALID_FREE_INVESTIGATIONS');
      const seen = new Set();
      const freeInvestigations = value.freeInvestigations.map(item => {
        onlyKeys(item, ['questionId', 'conclusion', 'certainty', 'materials'], 'INVALID_FREE_INVESTIGATION');
        if (!nonempty(item.questionId, 300) || seen.has(item.questionId) || !text(item.conclusion, 20000) || !text(item.certainty, 500)) fail('INVALID_FREE_INVESTIGATION'); seen.add(item.questionId);
        return { questionId: item.questionId, conclusion: item.conclusion, certainty: item.certainty, materials: cleanMaterials(item.materials) };
      });
      return { mode: value.mode, selectedEventId: value.selectedEventId, filter, cast: copy(value.cast), freeInvestigations };
    }
    function snapshotOf(value) { const snapshot = copy(value); delete snapshot.archive; return snapshot; }
    function hasWork(value) { return value.answers.length || value.materials.length || value.openedClaimIds.length || value.thesis || value.counterargument || value.uncertainty || value.archive.length; }
    function resultFor(caseId, taskId, value) {
      const task = taskFor(caseId, taskId), answer = value.answers.find(item => item.taskId === taskId), choiceIds = answer ? answer.choiceIds : [], submitted = Boolean(answer && answer.submittedAt);
      const correct = submitted && (task.type === 'sequence' ? task.acceptableOrders.some(order => order.length === choiceIds.length && order.every((id, index) => id === choiceIds[index])) : equalIds(task.expectedChoiceIds, choiceIds));
      return { taskId, choiceIds: choiceIds.slice(), attempts: answer ? answer.attempts : 0, submitted, correct,
        feedback: submitted ? task.choices.filter(choice => choiceIds.includes(choice.id)).map(choice => ({ choiceId: choice.id, label: choice.label, text: choice.feedback, claimIds: choice.claimIds.slice() })) : [],
        explanation: submitted ? task.explanation : '', claimIds: task.claimIds.slice(), hint: task.hint };
    }
    function readiness(caseId, value) {
      const item = knownCase(caseId), missing = [];
      const incomplete = item.tasks.filter(task => !resultFor(caseId, task.id, value).correct);
      if (incomplete.length) missing.push('尚有 ' + incomplete.length + ' 項材料核對任務未完成。');
      const claims = value.materials.filter(material => material.kind === 'claim'), originals = value.materials.filter(material => material.kind === 'original-analysis' && material.fingerprint && material.articleFingerprint);
      if (claims.length < item.finale.minimumClaimMaterials) missing.push('調查桌至少需要 ' + item.finale.minimumClaimMaterials + ' 條不同的史料主張。');
      if (originals.length < item.finale.minimumOriginalMaterials) missing.push('調查桌至少需要 ' + item.finale.minimumOriginalMaterials + ' 段已建立內容指紋的原庫分析。');
      [['thesis', 'minimumThesisLength', '我的解釋'], ['counterargument', 'minimumCounterargumentLength', '可能的反證'], ['uncertainty', 'minimumUncertaintyLength', '尚未確定之處']].forEach(([field, minimum, label]) => {
        if ([...value[field].trim()].length < item.finale[minimum]) missing.push('「' + label + '」至少填寫 ' + item.finale[minimum] + ' 字。');
      });
      return { ready: missing.length === 0, missing };
    }
    function cleanEnvelope(value) {
      onlyKeys(value, ['format', 'schemaVersion', 'packageId', 'packageVersion', 'casebookId', 'casebookVersion', 'createdAt', 'updatedAt', 'activeCaseId', 'cases', 'workspace', 'recoveries'], 'INVALID_SAVE');
      if (value.format !== 'dynasty-history-investigation' || value.schemaVersion !== 1) fail('UNSUPPORTED_SAVE_VERSION');
      if (value.packageId !== pkg.packageId || value.casebookId !== book.id) fail('SAVE_PACKAGE_MISMATCH');
      if (!nonempty(value.packageVersion, 80) || !nonempty(value.casebookVersion, 80) || !validDate(value.createdAt) || !validDate(value.updatedAt)) fail('INVALID_SAVE_METADATA'); knownCase(value.activeCaseId);
      if (!Array.isArray(value.cases) || value.cases.length > 50 || unique(value.cases.map(item => item && item.caseId)).length !== value.cases.length) fail('INVALID_SAVE_CASES');
      const savedCases = value.cases.map(item => cleanProgress(item));
      if (!Array.isArray(value.recoveries) || value.recoveries.length > 100) fail('INVALID_RECOVERIES');
      const recoveryIds = new Set();
      const recoveries = value.recoveries.map(item => {
        onlyKeys(item, ['id', 'savedAt', 'reason', 'progress'], 'INVALID_RECOVERY');
        if (!nonempty(item.id, 300) || recoveryIds.has(item.id) || !validDate(item.savedAt) || !nonempty(item.reason, 500)) fail('INVALID_RECOVERY'); recoveryIds.add(item.id);
        return { id: item.id, savedAt: item.savedAt, reason: item.reason, progress: cleanProgress(item.progress) };
      });
      const result = { format: value.format, schemaVersion: 1, packageId: value.packageId, packageVersion: value.packageVersion, casebookId: value.casebookId, casebookVersion: value.casebookVersion, createdAt: value.createdAt, updatedAt: value.updatedAt,
        activeCaseId: value.activeCaseId, cases: book.cases.map(item => savedCases.find(saved => saved.caseId === item.id) || freshProgress(item.id)), workspace: cleanWorkspace(value.workspace), recoveries };
      return result;
    }
    function adaptVersions(value, warnings) {
      if (value.packageVersion !== pkg.packageVersion || value.casebookVersion !== book.version) {
        warnings.push('資料包或案件集版本已改變；保留筆記與選項，任務須按目前資料重新提交。既有結案保留為舊版本紀錄。');
        [...value.cases, ...value.recoveries.map(item => item.progress)].forEach(item => { item.answers.forEach(answer => { answer.submittedAt = null; }); item.completedAt = null; });
        value.packageVersion = pkg.packageVersion; value.casebookVersion = book.version;
      }
      value.cases.forEach(item => { if (item.completedAt && (!readiness(item.caseId, item).ready || !item.archive.some(entry => entry.completedAt === item.completedAt))) { item.completedAt = null; warnings.push('有一件案件尚未符合目前結案條件或缺少對應結案紀錄，已恢復為草稿。'); } });
      return value;
    }
    function legacyEnvelope(value) {
      onlyKeys(value, ['format', 'version', 'packageId', 'packageVersion', 'createdOn', 'mode', 'filter', 'selectedEventId', 'investigations', 'cast', 'privacy'], 'INVALID_LEGACY_SAVE');
      if (value.format !== 'dynasty-history-comparison' || value.version !== 1 || value.packageId !== pkg.packageId || !Array.isArray(value.investigations) || value.investigations.length > 100 || !validDate(value.createdOn)) fail('INVALID_LEGACY_SAVE');
      const legacyMaterials = values => {
        if (!Array.isArray(values)) fail('INVALID_LEGACY_MATERIAL');
        return values.map(material => {
          if (material.kind === 'claim') {
            onlyKeys(material, ['kind', 'claimId', 'classification'], 'INVALID_LEGACY_MATERIAL');
            return cleanMaterial({ ...material, note: '' });
          }
          onlyKeys(material, ['kind', 'personId', 'recordId', 'field', 'paragraphIndex', 'classification'], 'INVALID_LEGACY_MATERIAL');
          return cleanMaterial({ ...material, recordName: null, recordType: null, fingerprint: null, articleFingerprint: null, note: '' });
        });
      };
      const workspace = { mode: value.mode, filter: value.filter, selectedEventId: value.selectedEventId, cast: value.cast,
        freeInvestigations: value.investigations.map(item => {
          onlyKeys(item, ['questionId', 'conclusion', 'certainty', 'materials'], 'INVALID_LEGACY_INVESTIGATION');
          return { questionId: item.questionId, conclusion: item.conclusion, certainty: item.certainty, materials: legacyMaterials(item.materials) };
        }) };
      const migrated = { ...copy(state), createdAt: value.createdOn, updatedAt: value.createdOn, cases: book.cases.map(item => freshProgress(item.id)), workspace: cleanWorkspace(workspace), recoveries: [] };
      return migrated;
    }
    function decode(input) {
      if (typeof input !== 'string' || input.length > MAX_IMPORT_BYTES || byteLength(input) > MAX_IMPORT_BYTES) fail('INVALID_IMPORT_SIZE');
      let value; try { value = JSON.parse(input.replace(/^\uFEFF/, '')); } catch (_) { fail('INVALID_IMPORT_JSON'); }
      const warnings = [];
      if (value && value.format === 'dynasty-history-comparison') { value = legacyEnvelope(value); warnings.push('已轉入舊比較頁的自由調查與人物編排。舊段落引用沒有內容指紋，必須重新核對選段。'); }
      else value = cleanEnvelope(value);
      value = adaptVersions(value, warnings);
      if (byteLength(JSON.stringify(value)) > MAX_SAVE_BYTES) fail('SAVE_LIMIT_EXPORT_FIRST');
      return { state: value, warnings };
    }
    function notify() { const payload = { state: copy(state), saveStatus: copy(saveStatus) }; listeners.forEach(listener => { try { listener(copy(payload)); } catch (_) { /* A view listener cannot cancel persistence or other subscribers. */ } }); }
    function save() {
      if (!storage || saveStatus.status === 'blocked') return;
      try {
        const currentRaw = storage.getItem(storageKey);
        if (observedRaw === undefined) {
          if (currentRaw !== null) { saveStatus = { status: 'blocked', message: '偵測到尚未讀取的舊存檔。為保留它，本次工作請先下載。', savedAt: saveStatus.savedAt, reason: 'unread-existing-save' }; return; }
          observedRaw = null;
        }
        if (currentRaw !== observedRaw) { saveStatus = { status: 'blocked', message: '另一個分頁已更新本機存檔。本頁保留目前工作，請下載後再匯入合併。', savedAt: saveStatus.savedAt, reason: 'concurrent-change' }; return; }
        const raw = JSON.stringify(state);
        if (byteLength(raw) > MAX_SAVE_BYTES) fail('SAVE_TOO_LARGE');
        storage.setItem(storageKey, raw); observedRaw = raw;
        saveStatus = { status: 'saved', message: '進度已保存在此瀏覽器。', savedAt: state.updatedAt, reason: null };
      } catch (error) { saveStatus = { status: 'memory-only', message: '瀏覽器未能保存這次修改；目前工作仍在頁面中，請下載存檔。', savedAt: saveStatus.savedAt, reason: error && error.name || 'storage-error' }; }
    }
    function mutate(action) { const previous = state; state = copy(state); try { const result = action(); state.updatedAt = stamp(); if (byteLength(JSON.stringify(state)) > MAX_SAVE_BYTES) fail('SAVE_LIMIT_EXPORT_FIRST'); save(); notify(); return result === undefined ? copy(state) : copy(result); } catch (error) { state = previous; throw error; } }
    function touch(value) { const time = stamp(); value.startedAt = value.startedAt || time; value.updatedAt = time; value.completedAt = null; }
    function freshStoredId(prefix, time) {
      const taken = new Set([...state.recoveries.map(item => item.id), ...state.cases.flatMap(item => item.archive.map(entry => entry.id))]);
      let id; do { id = prefix + ':' + Date.parse(time) + '-' + (++sequence); } while (taken.has(id)); return id;
    }
    function recoveryOf(value, reason) { const time = stamp(); return { id: freshStoredId('recovery', time), savedAt: time, reason, progress: copy(value) }; }
    function addRecovery(value, reason) { if (!hasWork(value)) return; if (state.recoveries.length >= 100) fail('RECOVERY_LIMIT_EXPORT_FIRST'); state.recoveries.push(recoveryOf(value, reason)); }
    function addMaterial(caseId, value) { return mutate(() => { const p = progress(caseId), material = cleanMaterial(value); if (p.materials.some(item => materialKey(item) === materialKey(material))) return p.materials.find(item => materialKey(item) === materialKey(material)); if (p.materials.length >= 150) fail('TOO_MANY_MATERIALS'); touch(p); p.materials.push(material); return material; }); }
    if (storage) {
      try {
        observedRaw = storage.getItem(storageKey);
        if (observedRaw !== null) {
          try { const loaded = decode(observedRaw); state = loaded.state; saveStatus = { status: 'loaded', message: loaded.warnings.length ? loaded.warnings.join(' ') : '已恢復這個瀏覽器的調查進度。', savedAt: state.updatedAt, reason: null }; }
          catch (error) { saveStatus = { status: 'blocked', message: '既有存檔無法安全讀取，已保留原檔且停止自動覆寫。本次工作可另行下載。', savedAt: null, reason: error.message }; }
        }
      } catch (error) { saveStatus = { status: 'memory-only', message: '此瀏覽器目前不允許存取本機存檔，請下載保留進度。', savedAt: null, reason: error.name || 'storage-error' }; }
    }
    return {
      storageKey,
      getState: () => copy(state), getSaveStatus: () => copy(saveStatus),
      subscribe(listener) { if (typeof listener !== 'function') fail('INVALID_LISTENER'); listeners.add(listener); return () => listeners.delete(listener); },
      selectCase(caseId) { knownCase(caseId); return mutate(() => { state.activeCaseId = caseId; const p = progress(caseId); if (!p.startedAt) { p.startedAt = stamp(); p.updatedAt = p.startedAt; } }); },
      getCaseProgress(caseId) { const value = progress(caseId), tasks = knownCase(caseId).tasks.map(task => resultFor(caseId, task.id, value)); return { ...copy(value), tasks, completedTaskCount: tasks.filter(task => task.correct).length, totalTaskCount: tasks.length, readiness: readiness(caseId, value), isCompleted: Boolean(value.completedAt), archiveCount: value.archive.length }; },
      openEvidence(caseId, claimId) { if (!claimsById.has(claimId)) fail('UNKNOWN_CLAIM'); return mutate(() => { const value = progress(caseId); if (!value.openedClaimIds.includes(claimId)) { value.openedClaimIds.push(claimId); value.startedAt = value.startedAt || stamp(); value.updatedAt = stamp(); } }); },
      submitTask(caseId, taskId, choiceIds) {
        const task = taskFor(caseId, taskId); ensureIds(choiceIds, new Set(task.choices.map(choice => choice.id)), 20, 'INVALID_CHOICE');
        if (task.type === 'single-choice' && choiceIds.length !== 1 || task.type === 'multi-choice' && choiceIds.length === 0 || task.type === 'sequence' && choiceIds.length !== task.choices.length) fail('INCOMPLETE_ANSWER');
        return mutate(() => { const p = progress(caseId), old = p.answers.find(item => item.taskId === taskId); if (old && old.attempts >= 1000000) fail('ATTEMPT_LIMIT'); const answer = { taskId, choiceIds: choiceIds.slice(), attempts: old ? old.attempts + 1 : 1, submittedAt: stamp() }; touch(p); if (old) p.answers[p.answers.indexOf(old)] = answer; else p.answers.push(answer); return resultFor(caseId, taskId, p); });
      },
      addClaim(caseId, claimId, classification = 'unclear') { return addMaterial(caseId, { kind: 'claim', claimId, classification, note: '' }); },
      addOriginalReference(caseId, input) {
        onlyKeys(input, ['personId', 'record', 'field', 'paragraphIndex', 'classification'], 'INVALID_ORIGINAL_INPUT');
        const reference = createOriginalReference(input.personId, input.record, input.field, input.paragraphIndex);
        if (input.classification !== undefined) reference.classification = input.classification; return addMaterial(caseId, reference);
      },
      updateMaterial(caseId, key, patch) { onlyKeys(patch, ['classification', 'note'], 'INVALID_MATERIAL_PATCH'); return mutate(() => { const p = progress(caseId), index = p.materials.findIndex(item => materialKey(item) === key); if (index < 0) fail('UNKNOWN_MATERIAL'); p.materials[index] = cleanMaterial({ ...p.materials[index], ...patch }); touch(p); return p.materials[index]; }); },
      removeMaterial(caseId, key) { return mutate(() => { const p = progress(caseId), index = p.materials.findIndex(item => materialKey(item) === key); if (index < 0) fail('UNKNOWN_MATERIAL'); p.materials.splice(index, 1); touch(p); }); },
      setWriting(caseId, patch) { onlyKeys(patch, ['thesis', 'counterargument', 'uncertainty'], 'INVALID_WRITING'); Object.values(patch).forEach(value => { if (!text(value, 20000)) fail('INVALID_WRITING'); }); return mutate(() => { const p = progress(caseId); Object.assign(p, patch); touch(p); }); },
      completeCase(caseId) {
        const p = progress(caseId), ready = readiness(caseId, p);
        if (!ready.ready) return { ok: false, missing: ready.missing };
        if (p.completedAt) return { ok: true, missing: [], entry: copy(p.archive[p.archive.length - 1]) };
        if (p.archive.length >= 50) fail('ARCHIVE_LIMIT_EXPORT_FIRST');
        return mutate(() => { const value = progress(caseId), time = stamp(); value.completedAt = time; value.updatedAt = time;
          const entry = { id: freshStoredId('archive', time), completedAt: time, packageVersion: pkg.packageVersion, casebookVersion: book.version, snapshot: snapshotOf(value) }; value.archive.push(entry); return { ok: true, missing: [], entry }; });
      },
      getArchive(caseId) { return copy(progress(caseId).archive); },
      restoreArchive(caseId, archiveId) { return mutate(() => { const current = progress(caseId), entry = current.archive.find(item => item.id === archiveId); if (!entry) fail('UNKNOWN_ARCHIVE'); addRecovery(current, '還原結案版本前的草稿'); const restored = { ...copy(entry.snapshot), archive: current.archive }; touch(restored); if (entry.packageVersion !== pkg.packageVersion || entry.casebookVersion !== book.version) restored.answers.forEach(answer => { answer.submittedAt = null; }); state.cases[state.cases.indexOf(current)] = restored; return restored; }); },
      getRecoveries: () => copy(state.recoveries),
      restoreRecovery(recoveryId) { return mutate(() => { const entry = state.recoveries.find(item => item.id === recoveryId); if (!entry) fail('UNKNOWN_RECOVERY'); const current = progress(entry.progress.caseId); addRecovery(current, '還原保留草稿前的工作'); const restored = copy(entry.progress); touch(restored); state.cases[state.cases.indexOf(current)] = restored; state.activeCaseId = restored.caseId; return restored; }); },
      setWorkspace(patch) { onlyKeys(patch, ['mode', 'selectedEventId', 'filter', 'cast', 'freeInvestigations'], 'INVALID_WORKSPACE'); return mutate(() => { state.workspace = cleanWorkspace({ ...state.workspace, ...patch }); return state.workspace; }); },
      exportJSON() { return JSON.stringify(state, null, 2); },
      previewImport(input) {
        try { const decoded = decode(input), token = 'preview:' + (++sequence); previews.clear(); previews.set(token, decoded);
          return { ok: true, errors: [], warnings: decoded.warnings.slice(), summary: { casesWithWork: decoded.state.cases.filter(hasWork).length, completedCases: decoded.state.cases.filter(item => item.completedAt).length, freeInvestigations: decoded.state.workspace.freeInvestigations.length, recoveries: decoded.state.recoveries.length }, token };
        } catch (error) { return { ok: false, errors: [error.message], warnings: [], summary: null, token: null }; }
      },
      applyImport(preview, settings = { strategy: 'merge' }) {
        if (!preview || !preview.ok || !previews.has(preview.token)) fail('INVALID_IMPORT_PREVIEW');
        if (!settings || !['merge', 'replace'].includes(settings.strategy)) fail('INVALID_IMPORT_STRATEGY');
        const decoded = previews.get(preview.token), incoming = cleanEnvelope(decoded.state), warnings = decoded.warnings.slice();
        const result = mutate(() => {
          const previous = copy(state), existingRecoveries = copy(state.recoveries);
          if (settings.strategy === 'replace') {
            state = incoming; state.recoveries = existingRecoveries;
            for (const p of previous.cases) if (hasWork(p) && JSON.stringify(p) !== JSON.stringify(state.cases.find(item => item.caseId === p.caseId))) addRecovery(p, '匯入取代前的案件工作');
            // Free investigation work is merged by question ID below even in replace mode.
          } else {
            for (const imported of incoming.cases) {
              const current = progress(imported.caseId);
              if (!hasWork(imported) || JSON.stringify(current) === JSON.stringify(imported)) continue;
              if (!hasWork(current)) state.cases[state.cases.indexOf(current)] = copy(imported);
              else { addRecovery(imported, '匯入的同一案件草稿；目前工作優先保留'); warnings.push('「' + knownCase(imported.caseId).title + '」有兩份工作，匯入版本已保留在草稿復原區。'); }
            }
          }
          for (const entry of incoming.recoveries) {
            const existing = state.recoveries.find(item => item.id === entry.id);
            if (existing && JSON.stringify(existing) === JSON.stringify(entry)) continue;
            if (state.recoveries.length >= 100) fail('RECOVERY_LIMIT_EXPORT_FIRST');
            const preserved = copy(entry);
            if (existing) { do { preserved.id = 'recovery:' + Date.parse(stamp()) + '-' + (++sequence); } while (state.recoveries.some(item => item.id === preserved.id)); warnings.push('匯入草稿的識別碼重複，已另建識別碼保留兩份內容。'); }
            state.recoveries.push(preserved);
          }
          const mergedFree = copy(previous.workspace.freeInvestigations), incomingFree = incoming.workspace.freeInvestigations;
          for (const item of incomingFree) {
            const old = mergedFree.find(value => value.questionId === item.questionId);
            if (!old) mergedFree.push(copy(item));
            else if (JSON.stringify(old) !== JSON.stringify(item)) {
              let suffix = 1, idValue; do { idValue = item.questionId.slice(0, 270) + ':import-' + suffix++; } while (mergedFree.some(value => value.questionId === idValue));
              mergedFree.push({ ...copy(item), questionId: idValue }); warnings.push('同題自由調查已另存匯入副本，保留兩份筆記。');
            }
          }
          if (mergedFree.length > 100) fail('FREE_INVESTIGATION_LIMIT_EXPORT_FIRST');
          const castConflict = previous.workspace.cast.note && incoming.workspace.cast.note && JSON.stringify(previous.workspace.cast) !== JSON.stringify(incoming.workspace.cast);
          if (castConflict) {
            const preservedCast = settings.strategy === 'replace' ? previous.workspace.cast : incoming.workspace.cast;
            if (mergedFree.length >= 100) fail('FREE_INVESTIGATION_LIMIT_EXPORT_FIRST');
            mergedFree.push({ questionId: 'preserved-cast:' + Date.parse(stamp()) + '-' + (++sequence), conclusion: JSON.stringify(preservedCast), certainty: '人物編排匯入前的完整選擇與筆記', materials: [] });
            warnings.push('兩份人物編排不同，另一份已保留為自由調查筆記。');
          }
          if (settings.strategy === 'merge' && !previous.workspace.cast.note && incoming.workspace.cast.note) state.workspace.cast = copy(incoming.workspace.cast);
          state.workspace.freeInvestigations = mergedFree; state.workspace = cleanWorkspace(state.workspace);
          state.packageVersion = pkg.packageVersion; state.casebookVersion = book.version;
          return { ok: true, warnings };
        });
        previews.delete(preview.token); return result;
      },
      retrySave() { save(); notify(); return copy(saveStatus); },
      getPreservedSave() {
        if (preservedSave) return copy(preservedSave);
        if (!storage || saveStatus.status !== 'blocked') return null;
        try { const raw = storage.getItem(storageKey); return raw === null ? null : { raw, key: storageKey, reason: saveStatus.reason }; }
        catch (_) { return typeof observedRaw === 'string' ? { raw: observedRaw, key: storageKey, reason: saveStatus.reason } : null; }
      },
      startNewSaveSlot() {
        if (!storage) return { ok: false, backupKey: null, saveStatus: copy(saveStatus) };
        let backupKey = null;
        try {
          const raw = storage.getItem(storageKey);
          if (raw !== null) {
            do { backupKey = storageKey + '.preserved-' + Date.parse(stamp()) + '-' + (++sequence); } while (storage.getItem(backupKey) !== null);
            // Preserve the byte-for-byte original first. If either write fails,
            // existing saved work remains intact and the current draft stays in memory.
            storage.setItem(backupKey, raw); preservedSave = { raw, key: backupKey, reason: saveStatus.reason || 'manual-new-save' };
          }
          const nextRaw = JSON.stringify(state); if (byteLength(nextRaw) > MAX_SAVE_BYTES) fail('SAVE_TOO_LARGE');
          storage.setItem(storageKey, nextRaw); observedRaw = nextRaw;
          saveStatus = { status: 'saved', message: backupKey ? '已先保留舊存檔原始內容，再啟用目前工作的新存檔。' : '已啟用目前工作的本機存檔。', savedAt: state.updatedAt, reason: null };
          notify(); return { ok: true, backupKey, saveStatus: copy(saveStatus) };
        } catch (error) {
          saveStatus = { status: saveStatus.status === 'blocked' ? 'blocked' : 'memory-only', message: '未能建立新存檔；舊存檔與目前頁面的工作均保留，請下載後再試。', savedAt: saveStatus.savedAt, reason: error.name || error.message || 'storage-error' };
          notify(); return { ok: false, backupKey, saveStatus: copy(saveStatus) };
        }
      }
    };
  }

  return { paragraphs, fingerprint, createOriginalReference, resolveOriginalReference, materialKey, validateCases, createEngine };
});
