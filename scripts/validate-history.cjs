'use strict';
const fs = require('node:fs');
const path = require('node:path');
const history = require('../backend/static/js/history-data.js');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schemas/history-package.schema.json'), 'utf8'));
const filename = process.argv[2] || path.join(__dirname, '../backend/static/data/history/chuhan-foundation.v1.json');
const pkg = JSON.parse(fs.readFileSync(filename, 'utf8'));
const result = history.validatePackage(pkg, schema);
if (!process.argv[2] && result.valid) {
  const investigation = require('../backend/static/js/history-investigation.js');
  const casebook = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/static/data/history/chuhan-cases.v1.json'), 'utf8'));
  const caseSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schemas/history-casebook.schema.json'), 'utf8'));
  result.casebook = investigation.validateCases(casebook, pkg);
  result.casebook.errors.push(...history.contractErrors(casebook, caseSchema));
  result.casebook.valid = result.casebook.errors.length === 0;
  result.casebook.cases = casebook.cases.length;
  result.casebook.tasks = casebook.cases.reduce((count, item) => count + item.tasks.length, 0);
  result.valid = result.valid && result.casebook.valid;
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.valid ? 0 : 1;
