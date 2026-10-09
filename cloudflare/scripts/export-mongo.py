"""Read-only Mongo export. This script never changes source data or prints it.

Supply MONGODB_URL through the process environment, never a command argument.
Run after the old service has MIGRATION_READ_ONLY=true, with:
  python export-mongo.py --confirm-source-read-only --output PRIVATE_DIRECTORY
The output directory is excluded from Git with its own .gitignore. Keep it private.
"""
import argparse
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

COLLECTIONS = ("userdata", "worldworkspaces")
SNAPSHOT_FORMAT = "dynasty-migration-snapshot"
MAX_SAFE_INTEGER = 9007199254740991


class ExportError(Exception):
    """Messages contain only generic diagnostics, never source values."""


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def json_safe(value, depth=0):
    if depth > 100:
        raise ExportError("資料巢狀層次超出安全匯入範圍；原始 BSON 備份仍保留。")
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeError:
            raise ExportError("資料包含無效 Unicode；原始 BSON 備份仍保留。") from None
        return
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise ExportError("資料包含 JavaScript 無法精確表示的整數；原始 BSON 備份仍保留。")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ExportError("資料包含非有限數值；原始 BSON 備份仍保留。")
        return
    if isinstance(value, list):
        for item in value:
            json_safe(item, depth + 1)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ExportError("資料包含非文字鍵值；原始 BSON 備份仍保留。")
            json_safe(key, depth + 1)
            json_safe(item, depth + 1)
        return
    raise ExportError("資料包含非 JSON 的 BSON 類型；不會自動改寫，原始 BSON 備份仍保留。")


def read_documents(database):
    return {name: database[name].find_one({"_id": "main"}) for name in COLLECTIONS}


def document_counts(document):
    if document is None:
        return {"exists": False, "revision": None}
    result = {"exists": True, "revision": document.get("revision", 0), "topLevelFields": len(document)}
    for key in ("customLegends", "modifiedLegends", "chatHistories", "simulationHistory", "discussionHistories", "soulSaves", "scenes", "sceneEdits"):
        value = document.get(key)
        result[key] = len(value) if isinstance(value, (list, dict)) else None
    records = {}
    for index, item in enumerate(document.get("customLegends", []) if isinstance(document.get("customLegends"), list) else []):
        if isinstance(item, dict):
            record_id = item.get("id")
            key = record_id if isinstance(record_id, str) else "custom-index:" + str(index)
            records[key] = item
    modified = document.get("modifiedLegends")
    if isinstance(modified, dict):
        for key, item in modified.items():
            if isinstance(item, dict):
                records[key] = {**records.get(key, {}), **item}
    result["storedPersonRecords"] = len(records)
    result["storedRecordsWithAnalysis"] = sum(any(bool(item.get(field)) for field in ("deepAnalysis", "analysis", "soulEssence")) for item in records.values())
    workspace = document.get("workspace")
    result["worldSessions"] = len(workspace.get("sessions", [])) if isinstance(workspace, dict) and isinstance(workspace.get("sessions", []), list) else None
    return result


def write_private(path, content):
    with path.open("xb") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())


def export_snapshot(database, output, *, source_read_only_confirmed=False, exported_at=None):
    if not source_read_only_confirmed:
        raise ExportError("請先將舊站設為 MIGRATION_READ_ONLY=true，再確認來源已停止寫入。")
    output = Path(output)
    if output.exists() and any(output.iterdir()):
        raise ExportError("備份目錄已有內容，請使用新的空目錄；不會覆寫既有備份。")
    from bson import json_util

    first = read_documents(database)
    original_bytes = json_util.dumps(first, json_options=json_util.CANONICAL_JSON_OPTIONS, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    second = read_documents(database)
    second_bytes = json_util.dumps(second, json_options=json_util.CANONICAL_JSON_OPTIONS, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if original_bytes != second_bytes:
        raise ExportError("兩次讀取結果不同；來源仍在變動，已停止匯出，請確認舊站停止寫入。")
    counts = {name: database[name].count_documents({}) for name in COLLECTIONS}
    output.mkdir(parents=True, exist_ok=True)
    write_private(output / ".gitignore", b"*\n")
    write_private(output / "raw-bson.json", original_bytes)
    moment = exported_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    report = {
        "format": "dynasty-migration-report", "schemaVersion": 1, "exportedAt": moment,
        "sourceReadOnlyConfirmed": True, "stableDoubleRead": True, "database": "dynasty",
        "rawBsonSha256": sha256(original_bytes), "rawBsonBytes": len(original_bytes),
        "readyForImport": False, "collections": {},
        "scope": "Only _id=main in userdata/worldworkspaces. Other documents are counted and preserved in Mongo, not exported.",
    }
    try:
        documents = {name: None if document is None else {key: value for key, value in document.items() if key != "_id"} for name, document in first.items()}
        for name, document in documents.items():
            json_safe(document)
            revision = document.get("revision", 0) if isinstance(document, dict) else 0
            if document is not None and (not isinstance(revision, int) or isinstance(revision, bool) or not 0 <= revision < MAX_SAFE_INTEGER):
                raise ExportError("資料 revision 無法精確辨識；原始 BSON 備份仍保留。")
            encoded = canonical_json(document)
            report["collections"][name] = {
                **document_counts(document), "sha256": sha256(encoded), "jsonBytes": len(encoded),
                "collectionDocuments": counts[name], "otherDocumentsNotExported": max(0, counts[name] - (document is not None)),
            }
        snapshot = {"format": SNAPSHOT_FORMAT, "schemaVersion": 1, "exportedAt": moment, "documents": documents}
        snapshot_bytes = canonical_json(snapshot)
        write_private(output / "snapshot.json", snapshot_bytes)
        report.update({"readyForImport": True, "snapshotSha256": sha256(snapshot_bytes), "snapshotBytes": len(snapshot_bytes)})
    except ExportError as error:
        report["error"] = str(error)
        write_private(output / "report.json", canonical_json(report))
        raise
    write_private(output / "report.json", canonical_json(report))
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="唯讀匯出 Mongo 的完整私人存檔，不會顯示連線字串或人物內容。")
    parser.add_argument("--output", type=Path, required=True, help="新的空白私人備份目錄")
    parser.add_argument("--confirm-source-read-only", action="store_true", help="確認舊服務已啟用 MIGRATION_READ_ONLY=true")
    args = parser.parse_args(argv)
    if not args.confirm_source_read_only:
        print("請先停止舊站雲端寫入，再加 --confirm-source-read-only。", file=sys.stderr)
        return 2
    uri = os.environ.get("MONGODB_URL")
    if not uri:
        print("環境變數 MONGODB_URL 尚未設定；請勿把連線字串放在命令列。", file=sys.stderr)
        return 2
    try:
        from pymongo import MongoClient
        with MongoClient(uri, serverSelectionTimeoutMS=15000, connectTimeoutMS=15000, socketTimeoutMS=30000) as client:
            report = export_snapshot(client["dynasty"], args.output, source_read_only_confirmed=True)
        summary = {"status": "exported", "readyForImport": report["readyForImport"], "snapshotSha256": report["snapshotSha256"], "collections": report["collections"]}
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    except ExportError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        # Driver exceptions can contain the full URI or private source values.
        print("匯出失敗；請確認資料庫連線、唯讀來源與私人目錄。未顯示連線資訊或原始資料。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
