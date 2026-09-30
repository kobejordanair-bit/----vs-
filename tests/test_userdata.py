"""Exercise the production data contract without credentials or network I/O."""

import copy
import sys
from pathlib import Path

import mongomock
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from userdata_schema import (  # noqa: E402
    PERSISTED_FIELDS,
    UserDataRequest,
    load_userdata,
    save_userdata_patch,
)


@pytest.fixture
def storage():
    collection = mongomock.MongoClient()["isolated_test"]["userdata"]
    # main.py delegates its authenticated endpoints to these same helpers. This
    # isolated app deliberately avoids importing main.py or reading any .env.
    app = FastAPI()

    @app.get("/api/userdata")
    def get_data():
        return load_userdata(collection)

    @app.post("/api/userdata")
    def post_data(body: UserDataRequest):
        return save_userdata_patch(collection, body)

    with TestClient(app) as client:
        yield collection, client


@pytest.fixture
def all_fields():
    return {
        "customLegends": [{"id": "general_test", "name": "測試人物", "deepAnalysis": {"body": "長篇分析", "future": {"x": [1, True, None]}}}],
        "modifiedLegends": {"general_test": {"stats": {"leadership": 92}, "unrecognized": ["保留", {"a": None}]}},
        "chatHistories": {"general_test": [{"role": "user", "parts": [{"text": "對話"}]}]},
        "simulationHistory": [{"title": "史冊", "fullResult": "完整內容", "extra": {"timeline": ["甲", "乙"]}}],
        "discussionHistories": {"general_test": {"rounds": [{"content": "討論"}]}},
        "soulSaves": [{"id": "save_test", "snapshot": {"chapters": [{"content": "已存章節", "extra": 1}]}}],
        "hegemonySavedSim": {"factions": [{"name": "測試國"}], "setup": {"scenario": "empire"}, "phases": [{"content": "第一紀"}]},
        "scenes": [{"id": "scene_test", "title": "場景", "unknown": {"q": "值"}}],
        "sceneEdits": {"scene_test": {"desc": "修訂場景"}},
        "soulSession": {"phase": "chapters", "chapters": [{"content": "當前章節"}], "futureState": {"relationship": [1, 2]}},
    }


def test_empty_database_has_all_fields_and_revision_zero(storage):
    collection, client = storage
    response = client.get("/api/userdata")
    assert response.status_code == 200
    assert set(response.json()) == set(PERSISTED_FIELDS) | {"revision"}
    assert response.json()["revision"] == 0
    assert response.json()["soulSession"] is None
    assert response.json()["soulSaves"] == []
    assert collection.count_documents({}) == 0


def test_full_ten_field_round_trip_preserves_nested_unknown_values(storage, all_fields):
    collection, client = storage
    response = client.post("/api/userdata", json={"revision": 0, **all_fields})
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "revision": 1}
    assert client.get("/api/userdata").json() == {**all_fields, "revision": 1}
    assert collection.find_one({"_id": "main"}) == {"_id": "main", **all_fields, "revision": 1}


def test_partial_patch_preserves_soul_and_other_omitted_fields(storage, all_fields):
    _, client = storage
    assert client.post("/api/userdata", json={"revision": 0, **all_fields}).status_code == 200
    response = client.post("/api/userdata", json={"revision": 1, "scenes": []})
    assert response.status_code == 200
    assert response.json()["revision"] == 2
    expected = {**all_fields, "scenes": [], "revision": 2}
    assert client.get("/api/userdata").json() == expected


def test_explicit_null_clears_nullable_states_and_empty_array_clears_saves(storage, all_fields):
    _, client = storage
    client.post("/api/userdata", json={"revision": 0, **all_fields})
    response = client.post("/api/userdata", json={"revision": 1, "soulSession": None, "hegemonySavedSim": None, "soulSaves": []})
    assert response.status_code == 200
    current = client.get("/api/userdata").json()
    assert current["soulSession"] is None
    assert current["hegemonySavedSim"] is None
    assert current["soulSaves"] == []
    assert current["customLegends"] == all_fields["customLegends"]


def test_stale_tab_cannot_overwrite_first_tab(storage, all_fields):
    collection, client = storage
    client.post("/api/userdata", json={"revision": 0, **all_fields})
    first_tab_revision = client.get("/api/userdata").json()["revision"]
    second_tab_revision = client.get("/api/userdata").json()["revision"]
    assert first_tab_revision == second_tab_revision == 1
    assert client.post("/api/userdata", json={"revision": first_tab_revision, "sceneEdits": {"winner": "第一頁"}}).status_code == 200
    before = copy.deepcopy(collection.find_one({"_id": "main"}))
    response = client.post("/api/userdata", json={"revision": second_tab_revision, "sceneEdits": {"loser": "第二頁"}})
    assert response.status_code == 409
    assert collection.find_one({"_id": "main"}) == before


def test_stale_revision_zero_does_not_upsert_over_existing_record(storage):
    collection, client = storage
    client.post("/api/userdata", json={"revision": 0, "scenes": [{"id": "winner"}]})
    before = copy.deepcopy(collection.find_one({"_id": "main"}))
    assert client.post("/api/userdata", json={"revision": 0, "scenes": []}).status_code == 409
    assert collection.find_one({"_id": "main"}) == before
    assert collection.count_documents({}) == 1


def test_nonzero_revision_cannot_create_missing_record(storage):
    collection, client = storage
    assert client.post("/api/userdata", json={"revision": 8, "scenes": []}).status_code == 409
    assert collection.count_documents({}) == 0


def test_legacy_document_without_revision_starts_at_zero_and_preserves_unknown(storage):
    collection, client = storage
    unknown = {"futureStory": {"neverDelete": [1, {"name": "保留"}]}}
    collection.insert_one({"_id": "main", "soulSaves": [{"id": "legacy_save"}], **unknown})
    current = client.get("/api/userdata").json()
    assert current["revision"] == 0
    assert set(PERSISTED_FIELDS).issubset(current)
    assert current["futureStory"] == unknown["futureStory"]
    response = client.post("/api/userdata", json={"revision": 0, "modifiedLegends": {"old_id": {"text": "分析"}}})
    assert response.status_code == 200
    assert response.json()["revision"] == 1
    document = collection.find_one({"_id": "main"})
    assert document["futureStory"] == unknown["futureStory"]
    assert document["soulSaves"] == [{"id": "legacy_save"}]


@pytest.mark.parametrize("invalid", [
    {},
    {"scenes": []},
    {"revision": 0},
    {"revision": -1, "scenes": []},
    {"revision": "0", "scenes": []},
    {"revision": True, "scenes": []},
    {"revision": 0.0, "scenes": []},
    {"revision": 0, "customLegends": {}},
    {"revision": 0, "customLegends": ["bad"]},
    {"revision": 0, "modifiedLegends": []},
    {"revision": 0, "chatHistories": []},
    {"revision": 0, "discussionHistories": []},
    {"revision": 0, "simulationHistory": {}},
    {"revision": 0, "soulSaves": None},
    {"revision": 0, "soulSaves": [1]},
    {"revision": 0, "soulSession": []},
    {"revision": 0, "hegemonySavedSim": "bad"},
    {"revision": 0, "scenes": None},
    {"revision": 0, "sceneEdits": []},
    {"revision": 0, "unknownField": {"bad": 1}},
])
def test_invalid_payload_never_mutates_database(storage, all_fields, invalid):
    collection, client = storage
    collection.insert_one({"_id": "main", **all_fields, "revision": 0, "futureField": "保留"})
    before = copy.deepcopy(collection.find_one({"_id": "main"}))
    response = client.post("/api/userdata", json=invalid)
    assert response.status_code == 422
    assert collection.find_one({"_id": "main"}) == before


def test_missing_revision_error_identifies_revision(storage):
    _, client = storage
    response = client.post("/api/userdata", json={"scenes": []})
    assert response.status_code == 422
    assert any(error["loc"] == ["body", "revision"] for error in response.json()["detail"])


def test_competing_first_insert_duplicate_key_becomes_conflict():
    class FirstInsertLost:
        def update_one(self, query, update, upsert):
            assert query["_id"] == "main"
            assert upsert is True
            raise DuplicateKeyError("another writer created main")

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as captured:
        save_userdata_patch(FirstInsertLost(), UserDataRequest(revision=0, scenes=[]))
    assert captured.value.status_code == 409
