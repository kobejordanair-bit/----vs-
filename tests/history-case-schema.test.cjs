'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contractErrors } = require('../backend/static/js/history-data.js');
const { validateCases } = require('../backend/static/js/history-investigation.js');
const read = p => JSON.parse(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const schema = read('schemas/history-casebook.schema.json');
const book = read('backend/static/data/history/chuhan-cases.v1.json');
const pkg = read('backend/static/data/history/chuhan-foundation.v1.json');
const clone = value => JSON.parse(JSON.stringify(value));

test('all authored case tasks satisfy the portable authoring schema and semantic contract', () => {
  assert.deepEqual(contractErrors(book, schema), []);
  assert.deepEqual(validateCases(book, pkg), { valid: true, errors: [] });
});
test('authoring contract rejects private text, missing fields and mixed answer shapes', () => {
  for (const mutate of [
    value => { value.cases[0].deepAnalysis = 'PRIVATE ARTICLE'; },
    value => { delete value.cases[0].finale.minimumThesisLength; },
    value => { value.cases[0].tasks[0].acceptableOrders = [['a', 'b']]; },
    value => { value.cases[0].tasks[0].choices[0].claimIds = []; }
  ]) {
    const copy = clone(book); mutate(copy);
    assert.ok(contractErrors(copy, schema).length > 0);
  }
});
test('structurally valid orphan references are rejected by semantic validation', () => {
  const copy = clone(book); copy.cases[0].tasks[0].choices[0].claimIds = ['claim:does-not-exist'];
  assert.deepEqual(contractErrors(copy, schema), []);
  assert.equal(validateCases(copy, pkg).valid, false);
});
