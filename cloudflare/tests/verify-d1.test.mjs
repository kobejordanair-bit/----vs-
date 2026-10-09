import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportAndCompare, CHUNKS_PER_PAGE, CLI_MAX_BUFFER } from '../scripts/verify-d1.mjs';

function fixture(t) {
  const fixtures = fileURLToPath(new URL('../build/verify-tests/', import.meta.url));
  fs.mkdirSync(fixtures, { recursive: true });
  const root = fs.mkdtempSync(path.join(fixtures, 'verify-d1-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    if (path.dirname(resolved) !== fs.realpathSync(fixtures) || !path.basename(resolved).startsWith('verify-d1-')) throw new Error('Unexpected fixture cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { root, output: path.join(root, 'destination.json') };
}

function snapshot(documents) {
  return { format: 'dynasty-migration-snapshot', schemaVersion: 1, exportedAt: '2026-10-09T00:00:00Z', documents };
}

function mockD1(documents, { chunkCount = 1, change } = {}) {
  const statements = [], reads = {}, records = {};
  for (const id of ['userdata', 'worldworkspaces']) {
    if (documents[id] === null) continue;
    const characters = [...(typeof documents[id] === 'string' ? documents[id] : JSON.stringify(documents[id]))];
    const chunks = Array.from({ length: chunkCount }, (_, index) => characters.slice(Math.floor(index * characters.length / chunkCount), Math.floor((index + 1) * characters.length / chunkCount)).join(''));
    records[id] = { metadata: { revision: typeof documents[id] === 'string' ? 2 : documents[id].revision ?? 0, version: `${id}-version-1`, chunks: chunkCount }, chunks };
  }
  const query = async sql => {
    statements.push(sql);
    const metadata = sql.includes('FROM workspace_documents');
    const id = sql.match(metadata ? /WHERE id='([^']+)'/ : /WHERE document_id='([^']+)'/)[1];
    const record = records[id];
    let rows, index = null;
    if (metadata) {
      reads[id] = (reads[id] || 0) + 1;
      rows = record ? [{ ...record.metadata }] : [];
    } else {
      index = Number(sql.match(/chunk_index>=(\d+)/)[1]);
      const end = Number(sql.match(/chunk_index<(\d+)/)[1]);
      rows = record.chunks.slice(index, end).map((content, offset) => ({ chunk_index: index + offset, content }));
    }
    return change ? change({ sql, metadata, id, rows, reads: reads[id], index }) ?? rows : rows;
  };
  return { query, statements };
}

test('reads eight ordered chunks per page and preserves every unknown field before allowing cutover', async t => {
  const site = fixture(t);
  const documents = {
    userdata: { revision: 12, customLegends: [{ id: 'test-person', deepAnalysis: '完整私人原文 🐍'.repeat(100) }], unknownFuture: { nested: [true, null, { untouched: "test's original" }] } },
    worldworkspaces: { revision: 3, workspace: { schemaVersion: 99, future: { original: true } }, unknownTopLevel: 'retained' },
  };
  const d1 = mockD1(documents, { chunkCount: 18 });
  const report = await exportAndCompare({ query: d1.query, expected: snapshot(documents), output: site.output, database: 'test-database' });
  assert.equal(CHUNKS_PER_PAGE, 8);
  assert.equal(CLI_MAX_BUFFER, 24 * 1024 * 1024);
  const pages = d1.statements.filter(sql => sql.includes('FROM workspace_chunks'));
  assert.equal(pages.length, 6); // Three pages each, rather than 36 CLI starts.
  assert.match(pages[0], /chunk_index>=0 AND chunk_index<8 ORDER BY chunk_index$/);
  assert.match(pages[1], /chunk_index>=8 AND chunk_index<16 ORDER BY chunk_index$/);
  assert.match(pages[2], /chunk_index>=16 AND chunk_index<18 ORDER BY chunk_index$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(site.output, 'utf8')).documents, documents);
  assert.equal(report.contentMatchesSource, true);
  assert.equal(report.safeToSwitch, true);
  assert.equal(report.collections.userdata.jsonBytes, Buffer.byteLength(JSON.stringify(documents.userdata)));
  assert.equal(JSON.parse(fs.readFileSync(`${site.output}.report.json`, 'utf8')).safeToSwitch, true);
});

test('any deep mismatch saves complete destination evidence and forbids switching', async t => {
  const site = fixture(t);
  const documents = { userdata: { revision: 12, unknownFuture: { important: 'destination-only' } }, worldworkspaces: null };
  const expected = snapshot({ userdata: { revision: 12, unknownFuture: { important: 'source-only' } }, worldworkspaces: null });
  await assert.rejects(exportAndCompare({ query: mockD1(documents).query, expected, output: site.output, database: 'test-database' }), /禁止切換/);
  assert.deepEqual(JSON.parse(fs.readFileSync(site.output, 'utf8')).documents, documents);
  const report = JSON.parse(fs.readFileSync(`${site.output}.report.json`, 'utf8'));
  assert.equal(report.contentMatchesSource, false);
  assert.equal(report.safeToSwitch, false);
  assert.ok(!JSON.stringify(report).includes('destination-only'));
  assert.ok(!JSON.stringify(report).includes('source-only'));
});

test('export without a source is a backup and does not authorize switching', async t => {
  const site = fixture(t);
  const documents = { userdata: { unknownFuture: ['legacy-without-revision'] }, worldworkspaces: null };
  const report = await exportAndCompare({ query: mockD1(documents).query, output: site.output, database: 'test-database' });
  assert.equal(report.contentMatchesSource, null);
  assert.equal(report.safeToSwitch, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(site.output, 'utf8')).documents, documents);
});

for (const field of ['version', 'revision', 'chunks']) {
  test(`a concurrent metadata ${field} change prevents a verified snapshot`, async t => {
    const site = fixture(t);
    const documents = { userdata: { revision: 2, unknownFuture: 'private-original' }, worldworkspaces: null };
    const d1 = mockD1(documents, { change({ metadata, id, reads, rows }) {
      if (metadata && id === 'userdata' && reads === 2) rows[0][field] = field === 'version' ? 'new-version' : 9;
      return rows;
    } });
    await assert.rejects(exportAndCompare({ query: d1.query, expected: snapshot(documents), output: site.output, database: 'test-database' }), /已更新/);
    assert.equal(fs.existsSync(site.output), false);
    assert.equal(fs.existsSync(`${site.output}.report.json`), false);
  });
}

for (const problem of ['missing', 'duplicate', 'out-of-order', 'null-content']) {
  test(`${problem} chunks cannot pass the migration gate`, async t => {
    const site = fixture(t);
    const documents = { userdata: { revision: 2, unknownFuture: 'private-original'.repeat(100) }, worldworkspaces: null };
    const d1 = mockD1(documents, { chunkCount: 9, change({ metadata, rows, index }) {
      if (!metadata && index === 0) {
        if (problem === 'missing') rows.pop();
        if (problem === 'duplicate') rows[1].chunk_index = rows[0].chunk_index;
        if (problem === 'out-of-order') rows.reverse();
        if (problem === 'null-content') rows[0].content = null;
      }
      return rows;
    } });
    await assert.rejects(exportAndCompare({ query: d1.query, expected: snapshot(documents), output: site.output, database: 'test-database' }), /分塊/);
    assert.equal(fs.existsSync(site.output), false);
  });
}

test('a missing document created during verification is treated as concurrent writing', async t => {
  const site = fixture(t);
  const documents = { userdata: null, worldworkspaces: null };
  const d1 = mockD1(documents, { change({ metadata, id, reads, rows }) {
    if (metadata && id === 'userdata' && reads === 2) return [{ version: 'created-during-verification', revision: 1, chunks: 1 }];
    return rows;
  } });
  await assert.rejects(exportAndCompare({ query: d1.query, expected: snapshot(documents), output: site.output, database: 'test-database' }), /已建立文件/);
  assert.equal(fs.existsSync(site.output), false);
});

for (const raw of ['{"revision":2,"revision":2,"private":"never-log"}', '{"revision":2.0,"private":"never-log"}', '{"revision":3,"private":"never-log"}', 'null']) {
  test(`malformed JSON or mismatched revision is rejected without exposing its content: case ${raw.length}`, async t => {
    const site = fixture(t);
    const d1 = mockD1({ userdata: raw, worldworkspaces: null });
    await assert.rejects(exportAndCompare({ query: d1.query, output: site.output, database: 'test-database' }), error => !error.message.includes('never-log'));
    assert.equal(fs.existsSync(site.output), false);
  });
}

test('an incomplete source envelope cannot authorize cutover', async t => {
  const site = fixture(t);
  let calls = 0;
  const query = async () => { calls++; return []; };
  await assert.rejects(exportAndCompare({ query, expected: snapshot({ userdata: null }), output: site.output, database: 'test-database' }), /來源快照格式/);
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(site.output), false);
});

test('the CLI failure message prints neither source contents nor parser excerpts', t => {
  const site = fixture(t);
  const source = path.join(site.root, 'invalid-private-source.json');
  const marker = 'PRIVATE-CONTENT-DO-NOT-PRINT';
  fs.writeFileSync(source, `{"format":"${marker}"`);
  const command = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/verify-d1.mjs', import.meta.url)), '--database', 'test-database', '--source', source, '--output', site.output], { encoding: 'utf8', windowsHide: true });
  assert.equal(command.status, 1);
  assert.equal(command.stdout, '');
  assert.ok(command.stderr.includes('未顯示私人內容'));
  assert.ok(!command.stderr.includes(marker));
  assert.equal(fs.existsSync(site.output), false);
});
