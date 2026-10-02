'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const history = require('../backend/static/js/history-data.js');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schemas/history-package.schema.json'), 'utf8'));
const original = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/static/data/history/chuhan-foundation.v1.json'), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const valid = data => history.validatePackage(data, schema);
function bad(change, expression) {
  const data = copy(original); change(data);
  const result = valid(data);
  assert.equal(result.valid, false);
  if (expression) assert.match(result.errors.join('\n'), expression);
}
test('curated historical packet conforms to the contract with an explicit boundary and sources', () => {
  const result = valid(original);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.ok(result.counts.events >= 20);
  assert.ok(original.coverage.excluded.length > 0);
  assert.equal(original.coverage.completeness, 'curated-slice');
  assert.ok(original.claims.every(c => c.evidence.length));
  assert.ok(original.economy.every(e => e.quantities.length === 0));
});
test('browser and repository schemas are byte-identical and reproducible', () => {
  const repository = fs.readFileSync(path.join(__dirname, '../schemas/history-package.schema.json'), 'utf8');
  const browser = fs.readFileSync(path.join(__dirname, '../backend/static/data/history/schema.v1.json'), 'utf8');
  assert.equal(repository, browser);
});
test('unknown fields and unsupported versions cannot silently enter historical records', () => {
  bad(d => { d.schemaVersion = 2; });
  bad(d => { d.events[0].attackBonus = 90; }, /未知欄位/);
  bad(d => { d.economy[0].quantities = [{ value: 10, unit: '遊戲糧', status: 'game-balance', claimIds: [], note: 'test' }]; });
});
test('duplicate IDs, dangling references and references to the wrong entity class are rejected', () => {
  bad(d => { d.persons[1].id = d.persons[0].id; }, /重複ID/);
  bad(d => { d.events[0].placeIds[0] = 'place:absent'; }, /懸空引用/);
  bad(d => { d.events[0].contexts[0].factionId = d.persons[0].id; }, /引用類型/);
});
test('no calendar year zero, inverted ranges, fake precision or fabricated unknown dates', () => {
  assert.equal(history.yearOrdinal({ era: 'BCE', year: 1 }), 0);
  assert.equal(history.yearOrdinal({ era: 'CE', year: 1 }), 1);
  assert.throws(() => history.yearOrdinal({ era: 'CE', year: 0 }), /INVALID_YEAR/);
  bad(d => { d.events[0].time.earliest.year = 0; });
  bad(d => { d.events[0].time.earliest = { era: 'CE', year: 100 }; }, /日期倒置|跨年/);
  bad(d => { d.events[0].time.precision = 'year'; d.events[0].time.earliest = { era: 'BCE', year: 208 }; d.events[0].time.latest = { era: 'BCE', year: 207 }; }, /跨年/);
  bad(d => { d.events[0].time.precision = 'unknown'; }, /未知時間/);
  bad(d => { d.events[0].time.earliest = null; }, /日期區間不完整/);
});
test('partial chronological order cannot form a cycle or contradict wholly separated dates', () => {
  bad(d => { d.events[0].orderAfter = [d.events[1].id]; d.events[1].orderAfter = [d.events[0].id]; }, /形成環/);
  bad(d => { d.events[0].orderAfter = [d.events.at(-1).id]; }, /完全衝突/);
});
test('cross-check status, conflicts and entity evidence require the promised support', () => {
  bad(d => { d.claims[0].review = 'cross-checked'; d.claims[0].evidence = d.claims[0].evidence.slice(0, 1); }, /第二處不同位置/);
  bad(d => { d.claims[0].review = 'cross-checked'; const evidence = d.claims[0].evidence[0]; d.claims[0].evidence = [evidence, { ...evidence, locator: '  ' + evidence.locator + '  ' }]; }, /第二處不同位置/);
  bad(d => { d.claims[0].review = 'disputed'; d.claims[0].alternatives = []; }, /缺少異說/);
  bad(d => { d.persons[0].claimIds = [d.claims.find(c => c.subjectId !== d.persons[0].id && !c.objectIds.includes(d.persons[0].id)).id]; }, /未連到/);
});
test('event roles require evidence for the current person, event and faction together', () => {
  bad(d => {
    const event = d.events[0], context = event.contexts[0];
    const claim = d.claims.find(c => c.id === context.claimIds[0]);
    claim.objectIds = claim.objectIds.filter(id => id !== event.id);
  }, /角色證據須連到/);
  bad(d => {
    const event = d.events.find(e => e.contexts.some(c => c.factionId)), context = event.contexts.find(c => c.factionId);
    context.factionId = d.factions.find(f => f.id !== context.factionId).id;
  }, /角色證據須連到/);
});
test('event relations cannot be extrapolated to lifelong allegiances', () => {
  const relation = original.relations.find(r => r.scope === 'event');
  assert.ok(relation);
  bad(d => { d.relations.find(r => r.id === relation.id).eventId = null; }, /缺事件/);
  bad(d => { d.relations.find(r => r.id === relation.id).time.note += 'changed'; }, /時間與事件不一致/);
  const d = copy(original), edited = d.relations.find(r => r.id === relation.id);
  edited.time = Object.fromEntries(Object.entries(edited.time).reverse());
  edited.time.earliest = Object.fromEntries(Object.entries(edited.time.earliest).reverse());
  assert.equal(valid(d).valid, true, valid(d).errors.join('\n'));
});
test('source-free geographic precision is rejected and unlocated places stay unlocated', () => {
  assert.ok(original.places.every(p => p.coordinates === null));
  bad(d => { d.places[0].coordinates = { longitude: 110, latitude: 34 }; }, /座標/);
});
test('faction and economic evidence cannot be replaced by unrelated biographies', () => {
  for (const table of ['factions', 'economy']) bad(d => {
    const record = d[table][0];
    record.claimIds = [d.claims.find(c => c.subjectId !== record.id && !c.objectIds.includes(record.id)).id];
  }, /未連到/);
});
test('a long valid event chain validates in either array order without recursion overflow', () => {
  const d = copy(original), time = copy(d.events[0].time), template = copy(d.events[0]);
  const context = template.contexts[0], proof = d.claims.find(c => context.claimIds.includes(c.id) && c.predicate === 'event-role');
  const chain = Array.from({ length: 8000 }, (_, i) => {
    const id = 'event:chain-' + i, claim = { ...copy(proof), id: 'claim:chain-' + i };
    if (claim.subjectId === template.id) claim.subjectId = id;
    claim.objectIds = claim.objectIds.map(objectId => objectId === template.id ? id : objectId);
    d.claims.push(claim);
    return { ...template, id, time, contexts: [{ ...context, claimIds: [claim.id] }], claimIds: [claim.id], orderAfter: i ? ['event:chain-' + (i - 1)] : [] };
  });
  d.events = [...d.events, ...chain];
  let result = valid(d); assert.equal(result.valid, true, result.errors.slice(0, 10).join('\n'));
  d.events.reverse();
  result = valid(d); assert.equal(result.valid, true, result.errors.slice(0, 10).join('\n'));
});
test('year search exposes provisional overlaps and does not turn a range into exact dates', () => {
  const index = history.createIndex(original, schema);
  const range = original.events.find(e => e.time.precision === 'range');
  assert.ok(range);
  assert.equal(history.timeMatch(range.time, range.time.earliest), 'possible');
  assert.ok(index.eventsAt(range.time.earliest).some(e => e.id === range.id && e.yearMatch === 'possible'));
  assert.equal(history.timeMatch(range.time, { era: 'CE', year: 2026 }), 'outside');
  const unknown = { ...range.time, earliest: null, latest: null, precision: 'unknown', normalization: 'not-normalized' };
  assert.equal(history.timeMatch(unknown, { era: 'BCE', year: 206 }), 'unknown');
});
test('filter queries use the same identity, place, faction and event data', () => {
  const index = history.createIndex(original, schema);
  const event = original.events.find(e => e.contexts.some(c => c.factionId));
  const context = event.contexts.find(c => c.factionId);
  const results = index.eventsAt(event.time.earliest, { personId: context.personId, placeId: event.placeIds[0], factionId: context.factionId });
  assert.ok(results.some(e => e.id === event.id));
  assert.ok(results.every(e => e.placeIds.includes(event.placeIds[0]) && e.contexts.some(c => c.personId === context.personId)));
});
test('mention, documented action and absence of a record have different casting results', () => {
  const index = history.createIndex(original, schema);
  const event = original.events.find(e => e.contexts.some(c => c.participation === 'mentioned'));
  assert.ok(event, 'a referenced third party must not be presented as physically present');
  const mentioned = event.contexts.find(c => c.participation === 'mentioned');
  const absent = original.persons.find(p => !event.contexts.some(c => c.personId === p.id));
  const results = index.assessCast(event.id, [mentioned.personId, absent.id]);
  assert.equal(results[0].status, 'mentioned-only');
  assert.equal(results[1].status, 'not-documented');
  assert.match(results[1].message, /不能據此判定不可能/);
});
test('unknown participation never displays a confirmed participation statement', () => {
  const d = copy(original), event = d.events[0];
  event.contexts[0].participation = 'unknown';
  const index = history.createIndex(d, schema);
  const result = index.assessCast(event.id, [event.contexts[0].personId])[0];
  assert.equal(result.status, 'uncertain');
  assert.match(result.message, /尚待確認/);
});
test('original Liu Bang and Gaozu entries attach to one identity without merging their articles', () => {
  const person = original.persons.find(p => p.libraryRefs.some(l => l.name === '劉邦') && p.libraryRefs.some(l => l.name === '漢高祖'));
  assert.ok(person);
  const library = person.libraryRefs.map((l, i) => ({ id: l.recordId, name: l.name, type: l.type, analysis: 'article-' + i }));
  const before = JSON.stringify(library);
  const result = history.createIndex(original, schema).originalRecords(person.id, library);
  assert.equal(result.length, 2);
  assert.ok(result.every(r => r.status === 'matched'));
  assert.notEqual(result[0].record.analysis, result[1].record.analysis);
  assert.equal(JSON.stringify(library), before);
});
test('ambiguous or missing library IDs never silently fall back to a name', () => {
  const person = original.persons.find(p => p.libraryRefs.length), link = person.libraryRefs[0];
  const index = history.createIndex(original, schema);
  assert.equal(index.originalRecords(person.id, [{ id: 'wrong', name: link.name, type: link.type }])[0].status, 'missing');
  const record = { id: link.recordId, name: link.name, type: link.type };
  assert.equal(index.originalRecords(person.id, [record, record])[0].status, 'ambiguous');
});
test('library import reads only supported fields and never creates missing abilities or analyses', () => {
  const raw = [{ id: 'a', name: '名字', type: 'general', desc: '<img src=x onerror=alert(1)>', analysis: '# 原文', stats: [99, 70, 80, 30, 60], cloudCredential: 'not-imported' },
    { id: 'b', name: '同名身份', type: 'minister', stats: 'invented' }];
  const result = history.parseLibrary('\uFEFF' + JSON.stringify(raw));
  assert.equal(result[0].desc, raw[0].desc);
  assert.equal(result[0].analysis, raw[0].analysis);
  assert.equal(Object.hasOwn(result[0], 'cloudCredential'), false);
  assert.equal(Object.hasOwn(result[1], 'stats'), false);
  assert.equal(Object.hasOwn(result[1], 'analysis'), false);
  assert.throws(() => history.parseLibrary(JSON.stringify([raw[0], raw[0]])), /DUPLICATE/);
});
test('legacy export merges exact IDs without mutating the source or original base data', () => {
  const base = [{ type: 'general', name: '韓信', rank: 'S+' }];
  const id = 'general_韓信_306677029';
  const source = { customLegends: [], modifiedLegends: { [id]: { analysis: '已存', stats: [100, 70, 100, 25, 60] } } };
  const before = JSON.stringify({ base, source });
  const imported = history.parseLibrary(JSON.stringify(source), base);
  assert.equal(imported[0].id, id);
  assert.equal(imported[0].analysis, '已存');
  assert.equal(JSON.stringify({ base, source }), before);
});
test('query result edits cannot alter subsequent queries or the original packet', () => {
  const before = JSON.stringify(original), index = history.createIndex(original, schema);
  const event = index.get(original.events[0].id); event.title = 'changed';
  assert.equal(index.get(event.id).title, original.events[0].title);
  assert.equal(JSON.stringify(original), before);
});
