'use strict';
const fs = require('node:fs');
const path = require('node:path');
const history = require('../backend/static/js/history-data.js');
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schemas/history-package.schema.json'), 'utf8'));
const filename = process.argv[2] || path.join(__dirname, '../backend/static/data/history/chuhan-foundation.v1.json');
const result = history.validatePackage(JSON.parse(fs.readFileSync(filename, 'utf8')), schema);
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.valid ? 0 : 1;
