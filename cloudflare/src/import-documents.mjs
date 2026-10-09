// Private offline migration helper. Intentionally not routed by the Worker.
import { HttpError, record } from './contracts.mjs';
export async function importDocument(store, collection, document) {
  if (!['userdata', 'worldworkspaces'].includes(collection) || !record(document)) throw new HttpError(422, '匯入集合或文件格式不正確');
  const observed = await store.read(collection);
  if (observed.document !== null) throw new HttpError(409, '目的資料庫已有文件；停止匯入，請先比較完整備份');
  // No schema normalization: all future fields, the existing revision and the
  // original _id remain available after a migration.
  if (!await store.compareAndSwap(collection, observed, document)) throw new HttpError(409, '目的資料庫已由另一個程序寫入；停止匯入');
  return { collection, revision: document.revision ?? 0 };
}
