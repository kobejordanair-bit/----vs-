#!/usr/bin/env node
// Read a D1 snapshot without exposing private SQL results in terminal output.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { strictJsonParse, record, validRevision, strictInteger } from '../src/contracts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const CHUNKS_PER_PAGE = 8;
export const CLI_MAX_BUFFER = 24 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
function validateSource(expected) {
  if (!record(expected) || expected.format !== 'dynasty-migration-snapshot' || expected.schemaVersion !== 1 || !record(expected.documents)
      || Object.keys(expected.documents).length !== 2 || !Object.hasOwn(expected.documents, 'userdata') || !Object.hasOwn(expected.documents, 'worldworkspaces')
      || Object.values(expected.documents).some(document => document !== null && !record(document))) throw new Error('來源快照格式不正確');
  if (Object.values(expected.documents).some(document => document !== null && Object.hasOwn(document, 'revision') && (!strictInteger(document, 'revision') || !validRevision(document.revision)))) throw new Error('來源快照 revision 無法辨識；禁止切換');
}
export async function exportAndCompare({ query, expected, output, database }) {
  if (expected !== null && expected !== undefined) validateSource(expected);
  const documents = {}, checks = {};
  for (const id of ['userdata', 'worldworkspaces']) {
    const rows = await query(`SELECT revision, version, chunks FROM workspace_documents WHERE id='${id}'`);
    if (rows.length > 1) throw new Error('目的資料庫 metadata 不唯一');
    if (!rows.length) {
      const confirmed = await query(`SELECT revision, version, chunks FROM workspace_documents WHERE id='${id}'`);
      if (confirmed.length) throw new Error('驗證中目的資料庫已建立文件，請暫停寫入後重試');
      documents[id] = null; checks[id] = { exists: false }; continue;
    }
    const metadata = rows[0];
    if (typeof metadata.version !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(metadata.version) || !Number.isSafeInteger(metadata.chunks) || metadata.chunks < 1 || metadata.chunks > 10000 || !validRevision(metadata.revision)) throw new Error('目的資料庫 metadata 無法辨識');
    // Eight chunks per CLI call reduces repeated Wrangler starts. The response
    // stays bounded for 1 MiB chunks, including JSON escaping overhead.
    const chunks = [];
    let jsonBytes = 0;
    for (let index = 0; index < metadata.chunks; index += CHUNKS_PER_PAGE) {
      const end = Math.min(index + CHUNKS_PER_PAGE, metadata.chunks);
      const page = await query(`SELECT chunk_index, content FROM workspace_chunks WHERE document_id='${id}' AND version='${metadata.version}' AND chunk_index>=${index} AND chunk_index<${end} ORDER BY chunk_index`);
      if (page.length !== end - index || page.some((chunk, offset) => !record(chunk) || chunk.chunk_index !== index + offset || typeof chunk.content !== 'string')) throw new Error('目的資料庫分塊缺漏、重複或順序不正確');
      for (const chunk of page) {
        jsonBytes += Buffer.byteLength(chunk.content);
        if (jsonBytes > MAX_DOCUMENT_BYTES) throw new Error('目的文件超出 32 MiB；已停止驗證，禁止切換');
        chunks.push(chunk.content);
      }
    }
    const confirmed = await query(`SELECT revision, version, chunks FROM workspace_documents WHERE id='${id}'`);
    if (confirmed.length !== 1 || confirmed[0].version !== metadata.version || confirmed[0].revision !== metadata.revision || confirmed[0].chunks !== metadata.chunks) throw new Error('驗證中目的資料庫已更新，請暫停寫入後重試');
    const raw = chunks.join('');
    try { documents[id] = strictJsonParse(raw); } catch { throw new Error('目的完整文件不是有效 JSON；已停止驗證，禁止切換'); }
    if (!record(documents[id]) || (Object.hasOwn(documents[id], 'revision') && (!strictInteger(documents[id], 'revision') || !validRevision(documents[id].revision)))) throw new Error('目的完整文件或 revision 無法辨識；禁止切換');
    if ((documents[id].revision ?? 0) !== metadata.revision) throw new Error('內容 revision 與 metadata 不一致');
    checks[id] = { exists: true, revision: metadata.revision, chunks: metadata.chunks, jsonBytes, storedJsonSha256: sha256(raw) };
  }
  const matching = expected ? isDeepStrictEqual(documents, expected.documents) : null;
  const snapshot = { format: 'dynasty-migration-snapshot', schemaVersion: 1, exportedAt: new Date().toISOString(), documents };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
  const report = { format: 'dynasty-d1-verification', schemaVersion: 1, verifiedAt: snapshot.exportedAt, database, contentMatchesSource: matching, safeToSwitch: matching === true, collections: checks };
  await fs.writeFile(`${output}.report.json`, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  if (matching === false) throw new Error('目的完整文件與來源不一致；已保存目的原件，禁止切換');
  return report;
}

async function main() {
  const args = process.argv.slice(2), values = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--local') { values.local = true; continue; }
    if (!['--source', '--output', '--database'].includes(args[index]) || !args[index + 1]) throw new Error('需要 --output 和 --database，可選 --source 或 --local');
    values[args[index].slice(2)] = args[++index];
  }
  if (!values.output || !/^[a-zA-Z0-9_-]+$/.test(values.database || '')) throw new Error('需要有效 --database 及新 --output 檔案');
  const expected = values.source ? strictJsonParse(await fs.readFile(values.source, 'utf8')) : null;
  if (expected !== null) validateSource(expected);
  const query = async sql => {
    const { stdout } = await execute(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', values.database, values.local ? '--local' : '--remote', '--command', sql, '--json'], {
      cwd: root, maxBuffer: CLI_MAX_BUFFER, windowsHide: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(root, 'build/logs') },
    });
    const results = JSON.parse(stdout);
    if (!Array.isArray(results) || results.some(result => !result.success || !Array.isArray(result.results))) throw new Error('D1 查詢未成功');
    return results.flatMap(result => result.results);
  };
  console.log(JSON.stringify(await exportAndCompare({ query, expected, output: path.resolve(values.output), database: values.database }), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('D1 驗證失敗：請檢查授權、metadata、分塊、來源一致性及輸出目錄；未顯示私人內容。'); process.exitCode = 1; });
}
