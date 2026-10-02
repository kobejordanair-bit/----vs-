'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const links = require('../backend/static/js/source-links.js');
const html = fs.readFileSync(path.join(__dirname, '../backend/index.html'), 'utf8');
const moduleSource = fs.readFileSync(path.join(__dirname, '../backend/static/js/source-links.js'), 'utf8');

function createDocument() {
    const nodes = new Map();
    // Use the shipped modal elements, so a renamed/missing integration point fails.
    for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
        const classes = new Set((match[0].match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/));
        const attributes = new Map();
        nodes.set(match[1], {
            classList: { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)), contains: value => classes.has(value) },
            setAttribute: (name, value) => attributes.set(name, String(value)),
            getAttribute: name => attributes.get(name) ?? null,
            removeAttribute: name => attributes.delete(name),
            textContent: '', innerHTML: ''
        });
    }
    return {
        getElementById: id => nodes.get(id) || null,
        querySelectorAll: selector => selector === '.eval-tab' ? [...nodes.values()].filter(node => node.classList.contains('eval-tab')) : []
    };
}

function parsedLink(id) { return new URL(links.hrefForRecordId(id), 'https://dynasty.example'); }

test('record IDs cannot change origin, path, tab or inject another hash parameter', () => {
    for (const id of ['漢#&tab=texts&person=other', '../private-library.json', 'https://evil.example/', '\"><script>alert(1)</script>', '姓名 / + ? %', ' x ', '鄭克𡒉']) {
        const url = parsedLink(id);
        assert.equal(url.origin, 'https://dynasty.example');
        assert.equal(url.pathname, '/source-archive');
        assert.equal(url.search, '');
        const params = new URLSearchParams(url.hash.slice(1));
        assert.equal(params.get('tab'), 'people');
        assert.deepEqual([...params.keys()], ['tab', 'person']);
        assert.equal(params.get('person'), id);
    }
    for (const id of [null, undefined, {}, [], 123, '', ' ', 'record\nnext']) assert.equal(links.hrefForRecordId(id), null);
});

test('all 962 source records retain their original IDs, including duplicate names', () => {
    const harvest = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/source-archive/harvest-person-sources.json'), 'utf8'));
    assert.equal(harvest.records.length, 962);
    const urls = new Set();
    for (const record of harvest.records) {
        const url = parsedLink(record.recordId);
        assert.equal(new URLSearchParams(url.hash.slice(1)).get('person'), record.recordId);
        urls.add(url.href);
    }
    assert.equal(urls.size, 962);
});

test('the source link uses DOM attributes and clears a prior person on invalid input', () => {
    const document = createDocument();
    const record = { id: 'cloud-record&person=wrong', name: '<img src=x onerror=alert(1)>', deepAnalysis: 'private analysis' };
    const before = JSON.stringify(record);
    assert.equal(links.setPerson(record, document), true);
    const anchor = document.getElementById('personSourceLink');
    assert.equal(anchor.getAttribute('href'), links.hrefForRecordId(record.id));
    assert.equal(anchor.textContent, '查看史料 ↗');
    assert.equal(anchor.innerHTML, '');
    assert.equal(anchor.getAttribute('target'), '_blank');
    assert.equal(anchor.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(document.getElementById('personSourceBar').classList.contains('hidden'), false);
    assert.equal(JSON.stringify(record), before);
    assert.equal(links.setPerson({ name: record.name }, document), false);
    assert.equal(anchor.getAttribute('href'), null);
    assert.equal(anchor.getAttribute('data-record-id'), null);
    assert.equal(document.getElementById('personSourceBar').classList.contains('hidden'), true);
});

test('the shipped evaluation modal opens exact-ID sources and keeps existing content flows', () => {
    assert.match(html, /<script src="\/static\/js\/source-links\.js\?v=16\.0"><\/script>/);
    const document = createDocument();
    const calls = [];
    const legends = [{ id: 'base-one', name: '同名人物' }, { id: 'cloud-other', name: '同名人物', deepAnalysis: 'private text' }];
    const before = JSON.stringify(legends);
    const context = vm.createContext({
        document, URLSearchParams, legendsData: legends, currentAnalysisId: null,
        currentEvalTab: 'review', pendingReactionLegendId: null, appState: { chatMode: { targetId: null } },
        el: id => document.getElementById(id),
        _loadReviewContent: id => calls.push(['review', id]),
        _loadCalibrationContent: id => calls.push(['calibrate', id])
    });
    context.window = context;
    vm.runInContext(moduleSource, context);
    for (const name of ['openModal', 'closeModal', 'openEvalModal']) {
        const definition = html.match(new RegExp('        function ' + name + '\\([^]*?\\n        }'));
        assert.ok(definition, name + ' must exist in the original site');
        vm.runInContext(definition[0], context);
    }
    context.openEvalModal('base-one');
    assert.equal(document.getElementById('personSourceLink').getAttribute('href'), links.hrefForRecordId('base-one'));
    context.openEvalModal('cloud-other', 'calibrate');
    assert.equal(document.getElementById('personSourceLink').getAttribute('href'), links.hrefForRecordId('cloud-other'));
    assert.deepEqual(calls, [['review', 'base-one'], ['calibrate', 'cloud-other']]);
    assert.equal(context.currentAnalysisId, 'cloud-other');
    assert.equal(context.currentEvalTab, 'calibrate');
    context.closeModal();
    assert.equal(document.getElementById('personSourceLink').getAttribute('href'), null);
    assert.equal(context.currentAnalysisId, null);
    context.openEvalModal('base-one');
    context.openModal('其他推演', 'chat');
    assert.equal(document.getElementById('personSourceBar').classList.contains('hidden'), true);
    assert.equal(document.getElementById('personSourceLink').getAttribute('href'), null);
    assert.equal(JSON.stringify(legends), before);
});

test('a source module outage does not block the original evaluation entry point', () => {
    const document = createDocument();
    let reviewed = null;
    const context = vm.createContext({ window: {}, document, legendsData: [{ id: 'a', name: '甲' }], el: id => document.getElementById(id), openModal: () => {}, _loadReviewContent: id => { reviewed = id; } });
    vm.runInContext(html.match(/        function openEvalModal\([^]*?\n        }/)[0], context);
    assert.doesNotThrow(() => context.openEvalModal('a'));
    assert.equal(reviewed, 'a');
});
