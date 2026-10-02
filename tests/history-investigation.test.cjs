'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../backend/static/js/history-investigation.js');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/static/data/history/chuhan-foundation.v1.json'), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const [claimA, claimB, claimC] = pkg.claims.map(item => item.id);
const linkedPerson = pkg.persons.find(person => person.libraryRefs.length);
const link = linkedPerson.libraryRefs[0];
const original = { id: link.recordId, name: link.name, type: link.type, analysis: '私人解讀第一段，不能自動成為史實。\n\n私人解讀第二段，必須連同脈絡閱讀。', desc: '原庫簡介文字。', poem: '人物詩詞。' };
const choices = () => [
  { id: 'a', label: '選項甲', feedback: '甲的理由請核對主張一。', claimIds: [claimA] },
  { id: 'b', label: '選項乙', feedback: '乙的理由請核對主張二。', claimIds: [claimB] },
  { id: 'c', label: '選項丙', feedback: '丙的理由請核對主張三。', claimIds: [claimC] }
];
function makeBook() {
  return { format: 'dynasty-history-casebook', schemaVersion: 1, id: 'casebook:test', version: '1.0.0', title: '引擎材料核對測試', introduction: '僅測試機制，不增造史實。', packageId: pkg.packageId, packageVersion: pkg.packageVersion,
    cases: [{ id: 'case:sample', order: 1, title: '材料核對案件', subtitle: '分清材料', theme: '查證', difficulty: '入門', estimatedMinutes: 15, premise: '讀取來源。', inquiry: '材料可以支持到哪一步？', eventIds: [pkg.events[0].id], personIds: [linkedPerson.id], claimIds: [claimA, claimB, claimC],
      chapters: [{ id: 'chapter:sample', title: '第一章', intro: '核對。', claimIds: [claimA], taskIds: ['task:single', 'task:multi', 'task:sequence'] }],
      tasks: [
        { id: 'task:single', chapterId: 'chapter:sample', type: 'single-choice', prompt: '選一個。', choices: choices(), expectedChoiceIds: ['a'], explanation: '這是材料核對，不評價人格。', claimIds: [claimA], hint: '看材料一。' },
        { id: 'task:multi', chapterId: 'chapter:sample', type: 'multi-choice', prompt: '選兩個。', choices: choices(), expectedChoiceIds: ['a', 'b'], explanation: '須考慮兩份材料。', claimIds: [claimA, claimB], hint: '看兩份材料。' },
        { id: 'task:sequence', chapterId: 'chapter:sample', type: 'sequence', prompt: '按指定關係排。', choices: choices(), acceptableOrders: [['b', 'a', 'c'], ['b', 'c', 'a']], explanation: '可接受的不只一種完整排序。', claimIds: [claimB], hint: '乙先於另外兩項。' }
      ], perspectives: [{ personId: linkedPerson.id, framing: '從原庫解讀出發。', claimIds: [claimA], analysisPrompt: '把人物解讀放回材料。' }],
      finale: { prompt: '提出解釋。', reflectionPrompts: ['還缺什麼？'], closingNote: '保留不確定性。', minimumClaimMaterials: 2, minimumOriginalMaterials: 0, minimumThesisLength: 12, minimumCounterargumentLength: 8, minimumUncertaintyLength: 6 }
    }] };
}
function engine(settings = {}) { let ms = Date.parse('2026-10-02T00:00:00.000Z'); return I.createEngine({ package: pkg, cases: makeBook(), now: () => new Date(ms += 1000).toISOString(), ...settings }); }
function memoryStorage() {
  const values = new Map();
  return { values, failRead: false, failWrite: false, setCount: 0,
    getItem(key) { if (this.failRead) throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (this.failWrite) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); this.setCount++; values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}
function finishTasks(e) { e.submitTask('case:sample', 'task:single', ['a']); e.submitTask('case:sample', 'task:multi', ['b', 'a']); e.submitTask('case:sample', 'task:sequence', ['b', 'c', 'a']); }
function ready(e) {
  finishTasks(e); e.addClaim('case:sample', claimA, 'support'); e.addClaim('case:sample', claimB, 'challenge');
  e.setWriting('case:sample', { thesis: '我的解釋保留資料可以支持的範圍，也列出不同觀點。', counterargument: '另一項材料可能質疑此解釋，需要持續比較。', uncertainty: '有關年代與原文出處仍然有未解問題。' });
}
test('casebook contract rejects unsupported data, broken citations and misassigned chapters', () => {
  assert.equal(I.validateCases(makeBook(), pkg).valid, true);
  for (const edit of [book => book.cases[0].tasks[0].claimIds.push('claim:missing'), book => book.cases[0].tasks[0].chapterId = 'chapter:missing', book => book.cases[0].tasks[0].score = 99, book => book.cases[0].tasks[0].expectedChoiceIds = ['a', 'b'], book => book.cases[0].tasks[2].acceptableOrders = [['a', 'b']], book => book.packageVersion = 'wrong']) {
    const book = makeBook(); edit(book); assert.equal(I.validateCases(book, pkg).valid, false); assert.throws(() => engine({ cases: book }), /INVALID_CASEBOOK/);
  }
});
test('choice and partial-order tasks give deterministic sourced feedback without opinion scoring', () => {
  const e = engine();
  const wrong = e.submitTask('case:sample', 'task:single', ['b']);
  assert.equal(wrong.correct, false); assert.equal(wrong.attempts, 1); assert.deepEqual(wrong.feedback[0].claimIds, [claimB]);
  const right = e.submitTask('case:sample', 'task:single', ['a']); assert.equal(right.correct, true); assert.equal(right.attempts, 2);
  assert.equal(e.submitTask('case:sample', 'task:multi', ['b', 'a']).correct, true);
  assert.equal(e.submitTask('case:sample', 'task:multi', ['a', 'b', 'c']).correct, false);
  assert.equal(e.submitTask('case:sample', 'task:sequence', ['a', 'b', 'c']).correct, false);
  assert.equal(e.submitTask('case:sample', 'task:sequence', ['b', 'c', 'a']).correct, true);
  const prior = e.exportJSON();
  assert.throws(() => e.submitTask('case:sample', 'task:multi', ['a', 'a']), /INVALID_CHOICE/);
  assert.throws(() => e.submitTask('case:sample', 'task:sequence', ['a']), /INCOMPLETE_ANSWER/);
  assert.throws(() => e.submitTask('case:sample', 'task:single', ['x']), /INVALID_CHOICE/);
  assert.equal(e.exportJSON(), prior); assert.equal('score' in right, false);
});
test('completion requires objective tasks, distinct claims and all three reflection fields', () => {
  const e = engine(); assert.equal(e.completeCase('case:sample').ok, false); finishTasks(e);
  e.addClaim('case:sample', claimA); e.addClaim('case:sample', claimA);
  e.setWriting('case:sample', { thesis: '此处已有足夠長的解釋，可是欠缺反證與不確定性。' });
  const p = e.getCaseProgress('case:sample'); assert.equal(p.materials.length, 1); assert.equal(p.completedTaskCount, 3); assert.equal(p.readiness.ready, false);
  ready(e); const result = e.completeCase('case:sample'); assert.equal(result.ok, true); assert.equal(result.entry.snapshot.thesis, e.getCaseProgress('case:sample').thesis);
  assert.equal(e.completeCase('case:sample').entry.id, result.entry.id); assert.equal(e.getArchive('case:sample').length, 1);
});
test('editing after completion preserves the old archive and restores a draft', () => {
  const e = engine(); ready(e); e.completeCase('case:sample'); const archive = e.getArchive('case:sample')[0];
  e.setWriting('case:sample', { thesis: '新解釋需要更多材料，我先保留舊結案與完整工作。' });
  assert.equal(e.getCaseProgress('case:sample').isCompleted, false); assert.equal(e.getArchive('case:sample')[0].snapshot.thesis, archive.snapshot.thesis);
  e.restoreArchive('case:sample', archive.id); assert.equal(e.getCaseProgress('case:sample').thesis, archive.snapshot.thesis); assert.equal(e.getCaseProgress('case:sample').isCompleted, false);
  assert.equal(e.getRecoveries().length, 1); assert.match(e.getRecoveries()[0].progress.thesis, /新解釋/);
});
test('original paragraphs persist only identity, position and revision markers', () => {
  const storage = memoryStorage(), e = engine({ storage });
  const ref = e.addOriginalReference('case:sample', { personId: linkedPerson.id, record: original, field: 'analysis', paragraphIndex: 1 });
  assert.equal(I.resolveOriginalReference(ref, [original], pkg).status, 'matched');
  assert.equal(I.resolveOriginalReference(ref, [original], pkg).text, I.paragraphs(original.analysis)[1]);
  assert.equal(e.exportJSON().includes(original.analysis.split('\n')[0]), false);
  assert.equal(storage.getItem(e.storageKey).includes('私人解讀'), false);
  assert.equal('text' in ref, false); assert.equal('record' in ref, false);
  const copyRef = copy(ref); copyRef.text = original.analysis;
  assert.throws(() => e.setWorkspace({ freeInvestigations: [{ questionId: 'free:test', conclusion: '', certainty: '', materials: [copyRef] }] }), /INVALID_ORIGINAL_REFERENCE/);
});
test('all library records can be used without pretending they are connected to the historical slice', () => {
  const e = engine(), record = { id: 'minister:outside-original', name: '原庫其他人物', type: 'minister', desc: '原庫基本簡介，並非本資料包已核定的人物傳記。', poem: '原庫詩句。' };
  for (const field of ['desc', 'poem']) {
    const ref = e.addOriginalReference('case:sample', { personId: null, record, field, paragraphIndex: 0 });
    const resolved = I.resolveOriginalReference(ref, [record], pkg);
    assert.equal(resolved.status, 'matched'); assert.equal(resolved.linked, false); assert.ok(resolved.unlinkedInfo); assert.equal(resolved.text, record[field]);
  }
  assert.throws(() => e.addOriginalReference('case:sample', { personId: null, record: { ...original, name: '錯誤姓名' }, field: 'desc', paragraphIndex: 0 }), /ORIGINAL_IDENTITY_MISMATCH/);
  e.setWorkspace({ mode: 'library' }); assert.equal(e.getState().workspace.mode, 'library');
});
test('stale, shifted, missing and ambiguous original references do not silently use changed text', () => {
  const ref = I.createOriginalReference(linkedPerson.id, original, 'analysis', 0);
  assert.equal(I.resolveOriginalReference(ref, [], pkg).status, 'missing');
  assert.equal(I.resolveOriginalReference(ref, [original, original], pkg).status, 'ambiguous');
  assert.equal(I.resolveOriginalReference(ref, [{ ...original, analysis: '新文字。' }], pkg).status, 'stale');
  assert.equal(I.resolveOriginalReference(ref, [{ ...original, analysis: '插入一段。\n\n' + original.analysis }], pkg).text, null);
  const unchangedParagraph = { ...original, analysis: original.analysis + '\n\n追加脈絡。' };
  assert.equal(I.resolveOriginalReference(ref, [unchangedParagraph], pkg).status, 'article-changed');
  const missing = { ...original }; delete missing.analysis; assert.equal(I.resolveOriginalReference(ref, [missing], pkg).status, 'missing-field');
  assert.equal(I.resolveOriginalReference({ ...ref, personId: 'person:missing' }, [original], pkg).status, 'identity-mismatch');
});
test('paragraph references normalize line endings and fingerprint all article context', () => {
  assert.deepEqual(I.paragraphs(' 第一行\r\n第二行\r\n\r\n 第二段 '), ['第一行\n第二行', '第二段']);
  assert.deepEqual(I.paragraphs('一\n二'), ['一', '二']); assert.deepEqual(I.paragraphs(' \n\n '), []);
  assert.equal(I.fingerprint('同一段'), I.fingerprint('同一段')); assert.notEqual(I.fingerprint('同一段'), I.fingerprint('另一段'));
  assert.throws(() => I.createOriginalReference(linkedPerson.id, original, 'analysis', 999), /INVALID_PARAGRAPH_INDEX/);
});
test('notebook classification and notes are editable; duplicate citations are not extra evidence', () => {
  const e = engine(), m = e.addClaim('case:sample', claimA); e.addClaim('case:sample', claimA);
  e.updateMaterial('case:sample', I.materialKey(m), { classification: 'challenge', note: '需要找相反記述。' });
  assert.equal(e.getCaseProgress('case:sample').materials.length, 1); assert.equal(e.getCaseProgress('case:sample').materials[0].classification, 'challenge');
  const prior = e.exportJSON(); assert.throws(() => e.updateMaterial('case:sample', I.materialKey(m), { note: 'a'.repeat(10001) }), /INVALID_MATERIAL/); assert.equal(e.exportJSON(), prior);
  e.removeMaterial('case:sample', I.materialKey(m)); assert.equal(e.getCaseProgress('case:sample').materials.length, 0);
});
test('getters, input records and subscribers cannot mutate live state', () => {
  const book = makeBook(), e = engine({ cases: book }); book.cases[0].tasks[0].expectedChoiceIds = ['c'];
  assert.equal(e.submitTask('case:sample', 'task:single', ['a']).correct, true);
  const state = e.getState(); state.cases[0].thesis = 'pollution'; assert.equal(e.getCaseProgress('case:sample').thesis, '');
  let calls = 0; const remove = e.subscribe(payload => { calls++; payload.state.cases[0].thesis = 'pollution'; throw new Error('view failure'); });
  e.setWriting('case:sample', { thesis: '合法編輯' }); assert.equal(e.getCaseProgress('case:sample').thesis, '合法編輯'); assert.equal(calls, 1);
  remove(); e.setWriting('case:sample', { thesis: '另一次編輯' }); assert.equal(calls, 1);
});
test('autosave restores valid progress and a completed archive', () => {
  const storage = memoryStorage(), first = engine({ storage }); ready(first); first.completeCase('case:sample');
  assert.equal(first.getSaveStatus().status, 'saved');
  const next = engine({ storage }); assert.equal(next.getSaveStatus().status, 'loaded'); assert.equal(next.getCaseProgress('case:sample').isCompleted, true);
  assert.equal(next.getCaseProgress('case:sample').thesis, first.getCaseProgress('case:sample').thesis); assert.equal(next.getArchive('case:sample').length, 1);
});
test('quota failures preserve previous storage bytes, current work and an export path', () => {
  const storage = memoryStorage(), e = engine({ storage }); e.setWriting('case:sample', { thesis: '先前已儲存的草稿' }); const prior = storage.getItem(e.storageKey);
  storage.failWrite = true; e.setWriting('case:sample', { thesis: '新修改仍留在記憶體，可下載。' });
  assert.equal(e.getSaveStatus().status, 'memory-only'); assert.equal(storage.getItem(e.storageKey), prior); assert.match(e.exportJSON(), /新修改/);
  storage.failWrite = false; assert.equal(e.retrySave().status, 'saved'); assert.match(storage.getItem(e.storageKey), /新修改/);
});
test('storage security exceptions degrade to memory and do not overwrite unseen saved work later', () => {
  const storage = memoryStorage(); storage.failRead = true; const e = engine({ storage });
  e.setWriting('case:sample', { thesis: '記憶體中的工作' }); assert.equal(e.getSaveStatus().status, 'memory-only');
  storage.failRead = false; storage.values.set(e.storageKey, 'unread existing file');
  assert.equal(e.retrySave().status, 'blocked'); assert.equal(storage.getItem(e.storageKey), 'unread existing file');
});
test('corrupt saved bytes are not overwritten; explicit new save preserves exact original first', () => {
  const storage = memoryStorage(), key = engine().storageKey, raw = '{broken original'; storage.values.set(key, raw);
  const e = engine({ storage }); assert.equal(e.getSaveStatus().status, 'blocked'); e.setWriting('case:sample', { thesis: '新的工作' }); assert.equal(storage.getItem(key), raw);
  assert.equal(e.getPreservedSave().raw, raw); const result = e.startNewSaveSlot(); assert.equal(result.ok, true); assert.equal(storage.getItem(result.backupKey), raw); assert.equal(e.getPreservedSave().raw, raw);
  assert.match(storage.getItem(key), /新的工作/); assert.equal(engine({ storage }).getSaveStatus().status, 'loaded');
});
test('new save recovery cannot erase corrupt bytes when backup creation fails', () => {
  const storage = memoryStorage(), key = engine().storageKey; storage.values.set(key, 'corrupt bytes'); const e = engine({ storage }); storage.failWrite = true;
  const result = e.startNewSaveSlot(); assert.equal(result.ok, false); assert.equal(storage.getItem(key), 'corrupt bytes'); assert.equal(e.getSaveStatus().status, 'blocked');
});
test('two open engines detect concurrent edits rather than silently overwriting each other', () => {
  const storage = memoryStorage(), a = engine({ storage }), b = engine({ storage }); a.setWriting('case:sample', { thesis: '分頁甲的修改' });
  b.setWriting('case:sample', { thesis: '分頁乙的修改' }); assert.equal(b.getSaveStatus().reason, 'concurrent-change'); assert.match(storage.getItem(a.storageKey), /分頁甲/); assert.match(b.exportJSON(), /分頁乙/);
  const recovery = b.startNewSaveSlot(); assert.equal(recovery.ok, true); assert.match(storage.getItem(recovery.backupKey), /分頁甲/); assert.match(storage.getItem(b.storageKey), /分頁乙/);
});
test('invalid imports are transactional and cannot smuggle private plaintext or new schema fields', () => {
  const e = engine(); e.setWriting('case:sample', { thesis: '既有工作' }); const prior = e.exportJSON();
  assert.equal(e.previewImport('{oops').ok, false); assert.equal(e.previewImport('a'.repeat(2000001)).ok, false);
  for (const edit of [s => s.schemaVersion = 9, s => s.packageId = 'history:other', s => s.cases[0].thesis = {}, s => s.cases[0].materials = [{ kind: 'claim', claimId: claimA, classification: 'support', note: '', privateText: original.analysis }], s => s.cases[0].answers = [{ taskId: 'task:single', choiceIds: ['unknown'], attempts: 1, submittedAt: s.createdAt }], s => s.workspace.cast.personIds = ['person:missing']]) {
    const data = JSON.parse(prior); edit(data); assert.equal(e.previewImport(JSON.stringify(data)).ok, false);
  }
  assert.throws(() => e.applyImport({ ok: true, token: 'made-up' }), /INVALID_IMPORT_PREVIEW/); assert.equal(e.exportJSON(), prior);
});
test('import preview is read-only; merge preserves both conflicting drafts and can restore the imported one', () => {
  const current = engine(), incoming = engine(); current.setWriting('case:sample', { thesis: '目前版本草稿' }); incoming.setWriting('case:sample', { thesis: '匯入版本草稿' });
  const before = current.exportJSON(), preview = current.previewImport('\uFEFF' + incoming.exportJSON()); assert.equal(preview.ok, true); assert.equal(current.exportJSON(), before);
  const applied = current.applyImport(preview); assert.equal(applied.ok, true); assert.equal(current.getCaseProgress('case:sample').thesis, '目前版本草稿');
  const imported = current.getRecoveries().find(item => item.progress.thesis === '匯入版本草稿'); assert.ok(imported); current.restoreRecovery(imported.id);
  assert.equal(current.getCaseProgress('case:sample').thesis, '匯入版本草稿'); assert.ok(current.getRecoveries().some(item => item.progress.thesis === '目前版本草稿'));
  assert.throws(() => current.applyImport(preview), /INVALID_IMPORT_PREVIEW/);
});
test('replace import keeps former working draft in recoveries', () => {
  const current = engine(), incoming = engine(); current.setWriting('case:sample', { thesis: '原來工作' }); incoming.setWriting('case:sample', { thesis: '取代工作' });
  current.applyImport(current.previewImport(incoming.exportJSON()), { strategy: 'replace' });
  assert.equal(current.getCaseProgress('case:sample').thesis, '取代工作'); assert.ok(current.getRecoveries().some(item => item.progress.thesis === '原來工作'));
});
test('version changes retain written work and evidence but require tasks to be rechecked', () => {
  const e = engine(); ready(e); e.completeCase('case:sample'); const changed = JSON.parse(e.exportJSON()); changed.casebookVersion = '0.9.0'; changed.packageVersion = '0.9.0';
  const next = engine(), preview = next.previewImport(JSON.stringify(changed)); assert.equal(preview.ok, true); assert.ok(preview.warnings.length);
  next.applyImport(preview); const p = next.getCaseProgress('case:sample'); assert.equal(p.completedTaskCount, 0); assert.equal(p.isCompleted, false); assert.equal(p.materials.length, 2); assert.equal(p.thesis, e.getCaseProgress('case:sample').thesis); assert.equal(p.archive.length, 1);
});
test('a completion flag without its archive becomes a draft and inconsistent archived times are rejected', () => {
  const e = engine(); ready(e); e.completeCase('case:sample'); const raw = JSON.parse(e.exportJSON()); raw.cases[0].archive = [];
  const next = engine(), preview = next.previewImport(JSON.stringify(raw)); assert.equal(preview.ok, true); assert.ok(preview.warnings.length); next.applyImport(preview); assert.equal(next.getCaseProgress('case:sample').isCompleted, false);
  const badArchive = JSON.parse(e.exportJSON()); badArchive.cases[0].archive[0].snapshot.completedAt = null; assert.equal(next.previewImport(JSON.stringify(badArchive)).ok, false);
});
test('recoveries with colliding IDs and different content are both preserved', () => {
  const a = engine(), b = engine(); ready(a); const archive = a.completeCase('case:sample').entry; a.setWriting('case:sample', { thesis: '第一份需要保存的草稿' }); a.restoreArchive('case:sample', archive.id);
  const incoming = JSON.parse(a.exportJSON()); incoming.recoveries[0].progress.thesis = '第二份同ID不同內容草稿'; b.applyImport(b.previewImport(a.exportJSON()));
  b.applyImport(b.previewImport(JSON.stringify(incoming))); const drafts = b.getRecoveries(); assert.ok(drafts.some(item => item.progress.thesis === '第一份需要保存的草稿')); assert.ok(drafts.some(item => item.progress.thesis === '第二份同ID不同內容草稿')); assert.equal(new Set(drafts.map(item => item.id)).size, drafts.length);
});
test('legacy comparison exports migrate without pretending unverified paragraph indices are trustworthy', () => {
  const e = engine();
  const legacy = { format: 'dynasty-history-comparison', version: 1, packageId: pkg.packageId, packageVersion: '1.0.0', createdOn: '2026-10-01T00:00:00.000Z', mode: 'investigate', filter: null, selectedEventId: pkg.events[0].id,
    investigations: [{ questionId: 'roles:' + pkg.events[0].id, conclusion: '我原先的解釋', certainty: '還要比較', materials: [{ kind: 'claim', claimId: claimA, classification: 'support' }, { kind: 'original-analysis', personId: linkedPerson.id, recordId: link.recordId, field: 'analysis', paragraphIndex: 0, classification: 'context' }] }], cast: { eventId: pkg.events[0].id, personIds: [linkedPerson.id], note: '當時的編排想法' }, privacy: '不含全文' };
  const preview = e.previewImport(JSON.stringify(legacy)); assert.equal(preview.ok, true); assert.ok(preview.warnings.length); e.applyImport(preview);
  const item = e.getState().workspace.freeInvestigations[0]; assert.equal(item.conclusion, '我原先的解釋'); assert.equal(item.materials.length, 2);
  const ref = item.materials[1]; assert.equal(ref.fingerprint, null); assert.equal(I.resolveOriginalReference(ref, [original], pkg).status, 'unverified'); assert.equal(I.resolveOriginalReference(ref, [original], pkg).text, null); assert.equal(e.exportJSON().includes('私人解讀'), false);
});
test('conflicting free investigations preserve both notes instead of overwriting a question', () => {
  const a = engine(), b = engine();
  a.setWorkspace({ freeInvestigations: [{ questionId: 'free:question', conclusion: '先前的解釋', certainty: '待考', materials: [] }] });
  b.setWorkspace({ freeInvestigations: [{ questionId: 'free:question', conclusion: '後來的解釋', certainty: '待考', materials: [] }] });
  a.applyImport(a.previewImport(b.exportJSON()), { strategy: 'replace' }); const notes = a.getState().workspace.freeInvestigations; assert.equal(notes.length, 2); assert.equal(new Set(notes.map(item => item.questionId)).size, 2); assert.ok(notes.some(item => item.conclusion === '先前的解釋')); assert.ok(notes.some(item => item.conclusion === '後來的解釋'));
});
test('malformed authored ordering data is reported as validation errors rather than crashing', () => {
  const book = makeBook(); book.cases[0].tasks[2].acceptableOrders = [null];
  assert.equal(I.validateCases(book, pkg).valid, false); assert.equal(I.validateCases(makeBook(), { claims: {} }).valid, false);
});
test('every authored case can be completed, archived, exported and restored with its cited materials', () => {
  const casebook = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/static/data/history/chuhan-cases.v1.json'), 'utf8'));
  assert.equal(I.validateCases(casebook, pkg).valid, true); const e = engine({ cases: casebook });
  for (const item of casebook.cases) {
    assert.equal(e.completeCase(item.id).ok, false);
    item.tasks.forEach(task => {
      const answer = task.type === 'sequence' ? task.acceptableOrders[0] : task.expectedChoiceIds;
      const result = e.submitTask(item.id, task.id, answer); assert.equal(result.correct, true); assert.ok(result.claimIds.length); assert.ok(result.feedback.length);
    });
    item.claimIds.slice(0, item.finale.minimumClaimMaterials).forEach(claimId => e.addClaim(item.id, claimId));
    e.setWriting(item.id, { thesis: '這份調查需要從各項材料的記述範圍提出解釋，也保留原庫作者解讀的性質。'.repeat(3), counterargument: '與此解釋相反的材料仍需閱讀，主張的年代或所指人物可能不同。'.repeat(3), uncertainty: '資料仍有未確定的細節，結論要清楚標示未能查證之處。'.repeat(3) });
    const finished = e.completeCase(item.id); assert.equal(finished.ok, true, JSON.stringify(finished)); assert.equal(e.getArchive(item.id).length, 1);
  }
  const restored = engine({ cases: casebook }), preview = restored.previewImport(e.exportJSON()); assert.equal(preview.ok, true); restored.applyImport(preview);
  assert.equal(restored.getState().cases.filter(item => item.completedAt).length, casebook.cases.length);
});
test('archive identifiers stay unique across reloads even with a frozen clock', () => {
  const storage = memoryStorage(), now = () => '2026-10-02T00:00:00.000Z', first = engine({ storage, now }); ready(first); first.completeCase('case:sample');
  const second = engine({ storage, now }); second.setWriting('case:sample', { thesis: '重新讀取後再編輯，仍然保留舊結案版本與不同識別碼。' }); second.completeCase('case:sample');
  const archives = second.getArchive('case:sample'); assert.equal(archives.length, 2); assert.notEqual(archives[0].id, archives[1].id); assert.equal(engine({ storage, now }).getSaveStatus().status, 'loaded');
});
test('archive limit rejects further completion without discarding prior archive or current draft', () => {
  const e = engine(); ready(e);
  for (let i = 0; i < 50; i++) { e.setWriting('case:sample', { thesis: '第 ' + i + ' 次調整我的解釋，保留材料所能支持的範圍。' }); assert.equal(e.completeCase('case:sample').ok, true); }
  e.setWriting('case:sample', { thesis: '這是超過結案數量後仍須保留的目前草稿。' }); const prior = e.exportJSON();
  assert.throws(() => e.completeCase('case:sample'), /ARCHIVE_LIMIT_EXPORT_FIRST/); assert.equal(e.exportJSON(), prior); assert.equal(e.getArchive('case:sample').length, 50);
});
test('large Chinese notes round-trip within the byte budget and oversized edits preserve prior work', () => {
  const e = engine(), drafts = Array.from({ length: 30 }, (_, i) => ({ questionId: 'free:large-' + i, conclusion: '漢'.repeat(20000), certainty: '待考', materials: [] }));
  e.setWorkspace({ freeInvestigations: drafts }); const prior = e.exportJSON(); assert.ok(Buffer.byteLength(prior, 'utf8') > 1800000);
  const next = engine(), preview = next.previewImport(prior); assert.equal(preview.ok, true); next.applyImport(preview); assert.equal(next.getState().workspace.freeInvestigations.length, 30);
  assert.throws(() => e.setWorkspace({ freeInvestigations: [...drafts, ...Array.from({ length: 5 }, (_, i) => ({ questionId: 'free:excess-' + i, conclusion: '漢'.repeat(20000), certainty: '待考', materials: [] }))] }), /SAVE_LIMIT_EXPORT_FIRST/); assert.equal(e.exportJSON(), prior);
  assert.equal(e.previewImport(' '.repeat(8000001)).errors[0], 'INVALID_IMPORT_SIZE');
});
