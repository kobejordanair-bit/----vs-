'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReader } = require('../backend/static/js/court-library.js');

const advisor = { id: 'hanXin', name: '韓信' };
test('reads the exact original ID and article without changing original or saved content', () => {
    const legends = [{ id: 'original-han-id', name: '韓信', type: 'general', deepAnalysis: '原內文' }];
    const modifications = { 'original-han-id': { deepAnalysis: '# 原文\n完整分析與矛盾。', stats: { leadership: 99 } } };
    const before = JSON.stringify({ legends, modifications });
    const read = createReader({ getLegends: () => legends, getModifications: () => modifications });
    assert.equal(read(advisor).id, 'original-han-id');
    assert.equal(read(advisor).analysis, modifications['original-han-id'].deepAnalysis);
    assert.equal(JSON.stringify({ legends, modifications }), before);
});
test('same name across categories resolves only the intended character', () => {
    const read = createReader({ getLegends: () => [
        { id: 'emperor', name: '韓信', type: 'emperor', deepAnalysis: '其他分類文章' },
        { id: 'general', name: '韓信', type: 'general', deepAnalysis: '將領文章' }
    ], getModifications: () => ({}) });
    assert.equal(read(advisor).analysis, '將領文章');
});
test('ambiguous records do not silently apply one persons article', () => {
    const read = createReader({ getLegends: () => [
        { id: 'one', name: '韓信', type: 'general', deepAnalysis: '一' },
        { id: 'two', name: '韓信', type: 'general', deepAnalysis: '二' }
    ], getModifications: () => ({}) });
    assert.equal(read(advisor).analysis, '');
    assert.match(read(advisor).sourceLabel, /多個同名/);
});
test('article edits or a newly loaded library appear on the next reading', () => {
    let legends = [];
    const modifications = {};
    const read = createReader({ getLegends: () => legends, getModifications: () => modifications });
    assert.equal(read(advisor).analysis, '');
    legends = [{ id: 'id', name: '韓信', type: 'general' }];
    modifications.id = { deepAnalysis: '新載入文章' };
    assert.equal(read(advisor).analysis, '新載入文章');
    modifications.id.deepAnalysis = '更新全文';
    assert.equal(read(advisor).analysis, '更新全文');
});
test('missing or invalid cached article stays absent; never generates content', () => {
    const read = createReader({ getLegends: () => [{ id: 'id', name: '韓信', type: 'general' }],
        getModifications: () => ({ id: { deepAnalysis: { invalid: true } } }) });
    assert.equal(read(advisor).analysis, '');
    assert.match(read(advisor).sourceLabel, /尚未儲存/);
});
