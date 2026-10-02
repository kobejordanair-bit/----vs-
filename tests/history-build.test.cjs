'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPackage, readInputs } = require('../scripts/build-chuhan-package.cjs');

test('the sourced research and investigation additions rebuild the checked-in packet exactly', () => {
  const generated = buildPackage(readInputs());
  const stored = fs.readFileSync(path.join(__dirname, '../backend/static/data/history/chuhan-foundation.v1.json'), 'utf8');
  assert.equal(JSON.stringify(generated, null, 2) + '\n', stored);
  assert.equal(generated.packageVersion, '1.1.0');
  assert.ok(generated.claims.some(claim => claim.id === 'claim:case-jingxing-scout-report'));
});

test('the builder rejects private article fields before serializing research input', () => {
  const inputs = readInputs();
  inputs.investigation.claims[0].deepAnalysis = 'private text';
  assert.throws(() => buildPackage(inputs), /Private library field/);
});

test('new evidence requires an explicit reviewed source and matching public URL', () => {
  const missing = readInputs(); missing.investigation.sourceNotes = [];
  assert.throws(() => buildPackage(missing), /not reviewed/);
  const mismatch = readInputs(); mismatch.investigation.sourceNotes[0].url = 'https://example.org/unread';
  assert.throws(() => buildPackage(mismatch), /mismatched supplement source/);
  const unread = readInputs(); unread.investigation.claims[0].evidence[0].locator = '同篇未核讀的其他段落';
  assert.throws(() => buildPackage(unread), /passage was not reviewed/);
});

test('unattached additions and evidence attached to an unrelated entity are rejected', () => {
  const orphan = readInputs(); orphan.investigation.attachments[0].claimIds.pop();
  assert.throws(() => buildPackage(orphan), /Every supplement claim/);
  const wrong = readInputs(); wrong.investigation.attachments[0].entityId = 'faction:qi';
  assert.throws(() => buildPackage(wrong), /證據未連到/);
});
