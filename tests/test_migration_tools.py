"""Exercise complete, private Mongo-to-D1 migration using only local fake data."""
import copy
import importlib.util
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import mongomock
import pytest
from bson import Int64, json_util

SCRIPTS = Path(__file__).resolve().parents[1] / "cloudflare" / "scripts"


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


export = module("test_migration_export", "export-mongo.py")
sql = module("test_migration_sql", "migration-to-sql.py")


@pytest.fixture
def source():
    database = mongomock.MongoClient()["isolated"]
    database.userdata.insert_one({
        "_id": "main", "revision": 12,
        "customLegends": [{"id": "test-person", "name": "測試 ' 人物", "analysis": "完整分析 🐍"}],
        "modifiedLegends": {"test-person": {"deepAnalysis": {"text": "原文", "future": [1, True, None]}}},
        "soulSaves": [{"id": "legacy", "unexpected": {"keep": "原件"}}],
        "unknownFuture": {"nested_id": "preserve", "x": [1, 2, "\u0000"]},
    })
    database.worldworkspaces.insert_one({"_id": "main", "revision": 2, "workspace": {"schemaVersion": 99, "sessions": [{"future": "not-normalized"}]}, "unknownFuture": {"retained": True}})
    return database


def prepared(source, tmp_path):
    directory = tmp_path / "private"
    report = export.export_snapshot(source, directory, source_read_only_confirmed=True, exported_at="2026-10-09T00:00:00Z")
    return directory, report


def test_export_preserves_full_original_bson_unknown_fields_and_revisions(source, tmp_path):
    before = export.read_documents(source)
    directory, report = prepared(source, tmp_path)
    snapshot = json.loads((directory / "snapshot.json").read_bytes())
    original = json_util.loads((directory / "raw-bson.json").read_bytes())
    assert original == before
    assert snapshot["documents"] == {name: {key: value for key, value in document.items() if key != "_id"} for name, document in before.items()}
    assert export.read_documents(source) == before
    assert report["readyForImport"] is True
    assert report["snapshotSha256"] == export.sha256((directory / "snapshot.json").read_bytes())
    assert report["rawBsonSha256"] == export.sha256((directory / "raw-bson.json").read_bytes())
    assert report["collections"]["userdata"]["storedPersonRecords"] == 1
    assert report["collections"]["userdata"]["storedRecordsWithAnalysis"] == 1
    assert (directory / ".gitignore").read_text() == "*\n"


def test_missing_documents_remain_null_instead_of_inventing_defaults(tmp_path):
    database = mongomock.MongoClient()["isolated"]
    directory, report = prepared(database, tmp_path)
    assert json.loads((directory / "snapshot.json").read_bytes())["documents"] == {"userdata": None, "worldworkspaces": None}
    assert report["collections"]["userdata"]["exists"] is False


def test_other_records_are_counted_without_being_replaced_or_exported(source, tmp_path):
    source.userdata.insert_one({"_id": "other", "private": "do not touch"})
    _, report = prepared(source, tmp_path)
    assert report["collections"]["userdata"]["otherDocumentsNotExported"] == 1
    assert source.userdata.find_one({"_id": "other"}) == {"_id": "other", "private": "do not touch"}


def test_source_read_only_confirmation_and_new_directory_are_required(source, tmp_path):
    with pytest.raises(export.ExportError):
        export.export_snapshot(source, tmp_path / "new")
    directory, _ = prepared(source, tmp_path)
    before = (directory / "snapshot.json").read_bytes()
    with pytest.raises(export.ExportError):
        export.export_snapshot(source, directory, source_read_only_confirmed=True)
    assert (directory / "snapshot.json").read_bytes() == before


def test_changing_source_is_detected_without_generating_a_snapshot(source, tmp_path):
    first = export.read_documents(source)
    second = copy.deepcopy(first)
    second["userdata"]["revision"] += 1
    with patch.object(export, "read_documents", side_effect=[first, second]):
        with pytest.raises(export.ExportError):
            export.export_snapshot(source, tmp_path / "changing", source_read_only_confirmed=True)
    assert not (tmp_path / "changing").exists()


@pytest.mark.parametrize("unsupported", [datetime(2026, 10, 9, tzinfo=timezone.utc), float("nan"), 2**54])
def test_unsupported_values_keep_raw_bson_backup_and_block_lossy_import(source, tmp_path, unsupported):
    source.userdata.update_one({"_id": "main"}, {"$set": {"unknownUnsupported": unsupported}})
    directory = tmp_path / "private"
    with pytest.raises(export.ExportError):
        export.export_snapshot(source, directory, source_read_only_confirmed=True)
    assert (directory / "raw-bson.json").exists()
    assert not (directory / "snapshot.json").exists()
    assert json.loads((directory / "report.json").read_bytes())["readyForImport"] is False


def test_bson_int64_revision_is_preserved_exactly(source, tmp_path):
    source.userdata.update_one({"_id": "main"}, {"$set": {"revision": Int64(123)}})
    directory, _ = prepared(source, tmp_path)
    assert json.loads((directory / "snapshot.json").read_bytes())["documents"]["userdata"]["revision"] == 123


def test_sql_import_large_unicode_and_apostrophes_round_trips_every_field(source, tmp_path):
    source.userdata.update_one({"_id": "main"}, {"$set": {"largeUnknownFuture": "測試'🐍" * 230000}})
    directory, _ = prepared(source, tmp_path)
    generated, report = sql.build_sql((directory / "snapshot.json").read_bytes(), (directory / "report.json").read_bytes())
    assert all(len(line) < 100000 for line in generated.splitlines())
    destination = sqlite3.connect(":memory:")
    destination.executescript((SCRIPTS.parent / "migrations" / "0001_storage.sql").read_text())
    destination.executescript(generated.decode("utf-8"))
    snapshot = json.loads((directory / "snapshot.json").read_bytes())
    for name, original in snapshot["documents"].items():
        metadata = destination.execute("SELECT revision, version, chunks FROM workspace_documents WHERE id=?", (name,)).fetchone()
        chunks = destination.execute("SELECT content FROM workspace_chunks WHERE document_id=? AND version=? ORDER BY chunk_index", (name, metadata[1])).fetchall()
        assert len(chunks) == metadata[2]
        restored = json.loads("".join(chunk[0] for chunk in chunks))
        assert restored == original
        assert export.sha256(export.canonical_json(restored)) == report["collections"][name]["sha256"]
        assert metadata[0] == original["revision"]
    assert report["cloudOperationPerformed"] is False
    with pytest.raises(sqlite3.IntegrityError):
        destination.executescript(generated.decode("utf-8"))


def test_sql_refuses_a_nonempty_destination_without_changing_existing_document(source, tmp_path):
    directory, _ = prepared(source, tmp_path)
    generated, _ = sql.build_sql((directory / "snapshot.json").read_bytes(), (directory / "report.json").read_bytes())
    destination = sqlite3.connect(":memory:")
    destination.executescript((SCRIPTS.parent / "migrations" / "0001_storage.sql").read_text())
    destination.execute("INSERT INTO workspace_documents VALUES ('userdata',99,'kept',1,'now')")
    destination.execute("INSERT INTO workspace_chunks VALUES ('userdata','kept',0,'kept-private-content')")
    destination.commit()
    with pytest.raises(sqlite3.IntegrityError):
        destination.executescript(generated.decode("utf-8"))
    assert destination.execute("SELECT * FROM workspace_documents").fetchall() == [("userdata", 99, "kept", 1, "now")]
    assert destination.execute("SELECT * FROM workspace_chunks").fetchall() == [("userdata", "kept", 0, "kept-private-content")]


def test_sql_requires_consistent_hashes_and_read_only_report(source, tmp_path):
    directory, _ = prepared(source, tmp_path)
    snapshot_bytes = (directory / "snapshot.json").read_bytes()
    report_bytes = (directory / "report.json").read_bytes()
    with pytest.raises(sql._export.ExportError):
        sql.build_sql(snapshot_bytes + b" ", report_bytes)
    report = json.loads(report_bytes)
    report["sourceReadOnlyConfirmed"] = False
    with pytest.raises(sql._export.ExportError):
        sql.build_sql(snapshot_bytes, export.canonical_json(report))


def test_cli_avoids_printing_uri_or_driver_exception(source, tmp_path, capsys):
    uri = "mongodb://do-not-print:private-password@example.invalid"
    with patch.dict("os.environ", {"MONGODB_URL": uri}), patch("pymongo.MongoClient", side_effect=RuntimeError(uri)):
        assert export.main(["--confirm-source-read-only", "--output", str(tmp_path / "private")]) == 1
    captured = capsys.readouterr()
    assert uri not in captured.out + captured.err
    assert "private-password" not in captured.out + captured.err


def test_duplicate_json_and_invalid_envelope_are_rejected():
    with pytest.raises(sql._export.ExportError):
        sql.strict_json('{"documents":{},"documents":{}}')
    with pytest.raises(sql._export.ExportError):
        sql.build_sql(b"{}", b"{}")
