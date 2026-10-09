import { HttpError } from './contracts.mjs';

// D1 limits a row to 2 MB. Chunking keeps complete multi-MiB documents intact
// while the metadata version gates every write in one atomic D1 batch.
export const CHUNK_BYTES = 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
function splitEncodedUtf8(bytes, maximum) {
  if (!Number.isInteger(maximum) || maximum < 4) throw new RangeError('UTF-8 chunk size must be at least four bytes');
  const chunks = [], decoder = new TextDecoder('utf-8', { fatal: true });
  for (let position = 0; position < bytes.length;) {
    let end = Math.min(position + maximum, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(decoder.decode(bytes.subarray(position, end))); position = end;
  }
  return chunks.length ? chunks : [''];
}
export function splitUtf8(source, maximum = CHUNK_BYTES) { return splitEncodedUtf8(new TextEncoder().encode(source), maximum); }
export class D1DocumentStore {
  constructor(database) { if (!database) throw new HttpError(503, '雲端儲存尚未完成設定'); this.database = database; }
  async read(id) {
    for (let retry = 0; retry < 4; retry++) {
      const metadata = await this.database.prepare('SELECT revision, version, chunks FROM workspace_documents WHERE id = ?').bind(id).first();
      if (!metadata) return { document: null, version: null };
      const result = await this.database.prepare('SELECT chunk_index, content FROM workspace_chunks WHERE document_id = ? AND version = ? ORDER BY chunk_index').bind(id, metadata.version).all();
      const confirm = await this.database.prepare('SELECT version FROM workspace_documents WHERE id = ?').bind(id).first();
      if (!confirm || confirm.version !== metadata.version) continue;
      if (result.results.length !== metadata.chunks || result.results.some((chunk, index) => chunk.chunk_index !== index)) throw new HttpError(503, '雲端資料不完整，請先保留原資料並聯絡管理者');
      let document;
      // Stored chunks came from JSON.stringify after request validation or a
      // private migration. Native parsing avoids rescanning multi-MiB prose on
      // every authenticated load; raw incoming requests still use the strict
      // parser before any write.
      try { document = JSON.parse(result.results.map(chunk => chunk.content).join('')); } catch { throw new HttpError(503, '雲端資料無法讀取，請先保留原資料並聯絡管理者'); }
      return { document, version: metadata.version };
    }
    throw new HttpError(409, '雲端資料正由其他視窗更新，請稍後重新載入');
  }
  async compareAndSwap(id, observed, next) {
    const source = JSON.stringify(next);
    const bytes = new TextEncoder().encode(source);
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new HttpError(413, '雲端資料超出 32 MiB，請先匯出部分內容');
    const chunks = splitEncodedUtf8(bytes, CHUNK_BYTES);
    const version = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    // Metadata is an index, not a replacement for the raw stored revision.
    // Preserve malformed legacy envelopes for export while binding only a
    // SQLite-safe integer; API contract validation blocks their writes.
    const revision = Number.isSafeInteger(next.revision) && next.revision >= 0 ? next.revision : 0;
    const queries = [observed.version === null
      ? this.database.prepare('INSERT INTO workspace_documents (id, revision, version, chunks, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(id, revision, version, chunks.length, timestamp)
      : this.database.prepare('UPDATE workspace_documents SET revision = ?, version = ?, chunks = ?, updated_at = ? WHERE id = ? AND version = ?').bind(revision, version, chunks.length, timestamp, id, observed.version)];
    for (const [index, chunk] of chunks.entries()) queries.push(this.database.prepare('INSERT INTO workspace_chunks (document_id, version, chunk_index, content) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspace_documents WHERE id = ? AND version = ?)').bind(id, version, index, chunk, id, version));
    queries.push(this.database.prepare('DELETE FROM workspace_chunks WHERE document_id = ? AND version <> ? AND EXISTS (SELECT 1 FROM workspace_documents WHERE id = ? AND version = ?)').bind(id, version, id, version));
    const results = await this.database.batch(queries);
    return results[0].meta.changes === 1;
  }
  async rateLimit(key, limit, now = Date.now()) {
    const minute = Math.floor(now / 60000), expires = minute + 2;
    const result = await this.database.batch([
      this.database.prepare('INSERT INTO request_rate_limits (key, window, count, expires) VALUES (?, ?, 1, ?) ON CONFLICT(key, window) DO UPDATE SET count = count + 1 RETURNING count').bind(key, minute, expires),
      this.database.prepare('DELETE FROM request_rate_limits WHERE expires < ?').bind(minute),
    ]);
    return result[0].results[0].count <= limit;
  }
}
