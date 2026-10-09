"""Generate private D1 import SQL offline; never executes a cloud operation.

First apply migrations/0001_storage.sql to a NEW, EMPTY database, keep the
Worker DATA_READY=false, then import this SQL through Wrangler. Verify complete
documents and hashes before enabling DATA_READY. Never put this SQL in Git.
"""
import argparse
import importlib.util
import json
import sys
import uuid
from pathlib import Path

_spec = importlib.util.spec_from_file_location("dynasty_migration_export", Path(__file__).with_name("export-mongo.py"))
_export = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_export)
CHUNK_BYTES = 40 * 1024  # SQL escaping can double bytes; stay below D1's 100 KB statement cap.
MAX_DOCUMENT_BYTES = 32 * 1024 * 1024


def strict_json(source):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise _export.ExportError("JSON 包含重複欄位；停止匯入。")
            result[key] = value
        return result

    def finite(_value):
        raise _export.ExportError("JSON 包含非有限數值；停止匯入。")

    try:
        return json.loads(source, object_pairs_hook=unique, parse_constant=finite)
    except (ValueError, UnicodeError, RecursionError):
        raise _export.ExportError("快照或報告不是有效 JSON；停止匯入。") from None


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def split_utf8(source):
    chunks, current, size = [], [], 0
    for character in source:
        encoded_size = len(character.encode("utf-8"))
        if current and size + encoded_size > CHUNK_BYTES:
            chunks.append("".join(current))
            current, size = [], 0
        current.append(character)
        size += encoded_size
    if current or not chunks:
        chunks.append("".join(current))
    return chunks


def build_sql(snapshot_bytes, report_bytes):
    snapshot, report = strict_json(snapshot_bytes), strict_json(report_bytes)
    if not isinstance(snapshot, dict) or snapshot.get("format") != _export.SNAPSHOT_FORMAT or type(snapshot.get("schemaVersion")) is not int or snapshot["schemaVersion"] != 1 or not isinstance(snapshot.get("documents"), dict) or set(snapshot["documents"]) != set(_export.COLLECTIONS):
        raise _export.ExportError("不支援的搬遷快照格式；停止匯入。")
    if not isinstance(report, dict) or report.get("format") != "dynasty-migration-report" or report.get("schemaVersion") != 1 or report.get("readyForImport") is not True or report.get("stableDoubleRead") is not True or report.get("sourceReadOnlyConfirmed") is not True or report.get("snapshotSha256") != _export.sha256(snapshot_bytes):
        raise _export.ExportError("快照雜湊或唯讀匯出報告不一致；停止匯入。")
    collections = report.get("collections")
    if not isinstance(collections, dict):
        raise _export.ExportError("匯出報告缺少集合驗證；停止匯入。")
    statements = [
        "-- PRIVATE DATA. Keep DATA_READY=false until complete hash verification.",
        "-- No BEGIN/COMMIT: Wrangler D1 import manages its own transaction.",
        "CREATE TABLE IF NOT EXISTS _dynasty_migration_guard (id INTEGER PRIMARY KEY CHECK (id = 1), ready INTEGER NOT NULL CHECK (ready = 1));",
        "INSERT INTO _dynasty_migration_guard (id, ready) SELECT 1, CASE WHEN (SELECT COUNT(*) FROM workspace_documents) + (SELECT COUNT(*) FROM workspace_chunks) = 0 THEN 1 ELSE 0 END;",
    ]
    imported = {}
    for collection in _export.COLLECTIONS:
        document = snapshot["documents"][collection]
        _export.json_safe(document)
        encoded = _export.canonical_json(document)
        if not isinstance(collections.get(collection), dict) or collections[collection].get("sha256") != _export.sha256(encoded):
            raise _export.ExportError("集合內容雜湊不一致；停止匯入。")
        if document is None:
            imported[collection] = {"exists": False, "sha256": _export.sha256(encoded), "chunks": 0}
            continue
        if not isinstance(document, dict) or "_id" in document:
            raise _export.ExportError("集合快照必須是去除頂層 _id 的完整文件；停止匯入。")
        revision = document.get("revision", 0)
        if not isinstance(revision, int) or isinstance(revision, bool) or not 0 <= revision < _export.MAX_SAFE_INTEGER:
            raise _export.ExportError("快照 revision 無法辨識；停止匯入。")
        if len(encoded) > MAX_DOCUMENT_BYTES:
            raise _export.ExportError("快照文件超出 32 MiB；停止匯入，不會刪減內容。")
        version = str(uuid.uuid4())
        chunks = split_utf8(encoded.decode("utf-8"))
        for index, chunk in enumerate(chunks):
            statements.append("INSERT INTO workspace_chunks (document_id, version, chunk_index, content) VALUES (" + ", ".join((sql_literal(collection), sql_literal(version), str(index), sql_literal(chunk))) + ");")
        moment = snapshot.get("exportedAt")
        if not isinstance(moment, str) or not moment or len(moment) > 100:
            raise _export.ExportError("快照時間格式不正確；停止匯入。")
        statements.append("INSERT INTO workspace_documents (id, revision, version, chunks, updated_at) VALUES (" + ", ".join((sql_literal(collection), str(revision), sql_literal(version), str(len(chunks)), sql_literal(moment))) + ");")
        imported[collection] = {"exists": True, "revision": revision, "sha256": _export.sha256(encoded), "jsonBytes": len(encoded), "chunks": len(chunks), "version": version}
    if any(len(statement.encode("utf-8")) >= 100000 for statement in statements):
        raise _export.ExportError("SQL 超出 D1 陳述式大小限制；停止產生。")
    sql = ("\n".join(statements) + "\n").encode("utf-8")
    verification = {
        "format": "dynasty-d1-import-report", "schemaVersion": 1,
        "snapshotSha256": _export.sha256(snapshot_bytes), "sqlSha256": _export.sha256(sql),
        "sqlBytes": len(sql), "collections": imported,
        "cloudOperationPerformed": False,
        "requires": ["New empty destination database", "DATA_READY=false during import", "Compare both documents to original snapshot before enabling writes"],
    }
    return sql, verification


def main(argv=None):
    parser = argparse.ArgumentParser(description="驗證私人 Mongo 快照並離線產生 D1 分塊 SQL；不執行雲端操作。")
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--report", type=Path, help="預設為 snapshot 同目錄的 report.json")
    parser.add_argument("--output", type=Path, required=True, help="新的私人 .sql 檔案路徑")
    args = parser.parse_args(argv)
    try:
        report_path = args.report or args.snapshot.with_name("report.json")
        sql, verification = build_sql(args.snapshot.read_bytes(), report_path.read_bytes())
        verification_path = args.output.with_suffix(args.output.suffix + ".report.json")
        if args.output.exists() or verification_path.exists():
            raise _export.ExportError("SQL 或驗證報告已存在；不會覆寫既有私人備份。")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        ignore = args.output.parent / ".gitignore"
        if not ignore.exists():
            _export.write_private(ignore, b"*\n")
        _export.write_private(args.output, sql)
        _export.write_private(verification_path, _export.canonical_json(verification))
        print(json.dumps({"status": "prepared", "sqlSha256": verification["sqlSha256"], "collections": verification["collections"], "cloudOperationPerformed": False}, ensure_ascii=False))
        return 0
    except _export.ExportError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        print("SQL 產生失敗；請確認快照、報告與私人目錄。未顯示原始資料。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
