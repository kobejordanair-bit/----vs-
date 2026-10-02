"""Exercise the real world routes without environment keys, AI, or Mongo I/O."""

import copy
import json
import sys
from pathlib import Path

import mongomock
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from world_workspace import MAX_BYTES, create_router, load_workspace, save_workspace  # noqa: E402


def workspace():
    return {"format": "dynasty-world-workspace", "schemaVersion": 1, "sessions": [], "activeSessionId": None,
            "selection": {"enabled": False, "setting": {"kind": "free", "eventId": "", "placeIds": [], "factionIds": []}, "recordIds": [], "anchors": [], "notes": "完整原文與選段"}}


def session():
    return {"id": "world-one", "title": "楚漢", "updatedAt": "2026-10-02T12:00:00.000Z", "save": {"format": "dynasty-world-save", "version": 1, "state": {"config": {"recordIds": ["精確-ID"]}, "orders": [], "futureInterpretation": {"verbatim": "原段落"}}},
            "narratives": [{"id": "n-one", "turn": 0, "text": "人物說明", "createdAt": "2026-10-02T12:00:00.000Z", "kind": "local", "contextVersion": "1"}]}


@pytest.fixture
def api():
    database = mongomock.MongoClient()["world_isolated"]
    collection = database["worldworkspaces"]
    app = FastAPI()

    def verify(token):
        if token != "test-only-token":
            raise HTTPException(status_code=403, detail="登入失敗")

    app.include_router(create_router(collection, verify))
    with TestClient(app, headers={"x-app-token": "test-only-token"}) as client:
        yield collection, client, database


def test_empty_cloud_is_null_without_creating_any_document(api):
    collection, client, _ = api
    assert client.get("/api/world-workspace").json() == {"revision": 0, "workspace": None}
    assert collection.count_documents({}) == 0


def test_authenticated_full_roundtrip_with_original_text_and_selection_extensions(api):
    collection, client, database = api
    value = workspace()
    value["sessions"] = [session()]
    value["activeSessionId"] = "world-one"
    value["selection"]["futureCognition"] = {"memory": ["必須保留", {"nested": True}]}
    value["selection"]["recordIds"] = ["人物-ID"]
    value["selection"]["anchors"] = [{"kind": "analysis", "recordId": "人物-ID", "field": "deepAnalysis", "start": 0, "end": 4, "quote": "完整原段", "principle": "care"}]
    value["notes"] = "共用筆記"
    response = client.post("/api/world-workspace", json={"revision": 0, "workspace": value})
    assert response.json() == {"status": "ok", "revision": 1}
    assert client.get("/api/world-workspace").json() == {"revision": 1, "workspace": value}
    assert collection.find_one()["workspace"] == value
    assert database["userdata"].count_documents({}) == 0


def test_old_cloud_fields_survive_workspace_update(api):
    collection, client, _ = api
    collection.insert_one({"_id": "main", "revision": 8, "workspace": workspace(), "futureEnvelope": {"original": True}})
    replacement = workspace()
    replacement["selection"]["notes"] = "新工作"
    assert client.post("/api/world-workspace", json={"revision": 8, "workspace": replacement}).json() == {"status": "ok", "revision": 9}
    assert collection.find_one()["futureEnvelope"] == {"original": True}


def test_revision_conflict_never_mutates_existing_cloud(api):
    collection, client, _ = api
    first = workspace()
    assert client.post("/api/world-workspace", json={"revision": 0, "workspace": first}).status_code == 200
    before = collection.find_one()
    for revision in [0, 2, 999]:
        assert client.post("/api/world-workspace", json={"revision": revision, "workspace": None}).status_code == 409
        assert collection.find_one() == before


def test_missing_or_wrong_token_blocks_read_and_write_without_touching_collection(api):
    collection, client, _ = api
    for token in ["", "wrong"]:
        assert client.get("/api/world-workspace", headers={"x-app-token": token}).status_code == 403
        assert client.post("/api/world-workspace", json={"revision": 0, "workspace": workspace()}, headers={"x-app-token": token}).status_code == 403
    assert collection.count_documents({}) == 0


@pytest.mark.parametrize("future", [
    {**workspace(), "schemaVersion": 2, "futureValue": {"original": "保留"}},
    {**workspace(), "unknownCurrentField": ["保留"]},
    {"not": "a recognized workspace"},
])
def test_future_cloud_is_readable_but_never_overwritten(api, future):
    collection, client, _ = api
    collection.insert_one({"_id": "main", "revision": 4, "workspace": future})
    assert client.get("/api/world-workspace").json() == {"revision": 4, "workspace": future}
    for incoming in [None, workspace()]:
        assert client.post("/api/world-workspace", json={"revision": 4, "workspace": incoming}).status_code == 409
        assert collection.find_one()["workspace"] == future


@pytest.mark.parametrize("patch", [
    {"schemaVersion": True}, {"schemaVersion": 2}, {"selection": []}, {"activeSessionId": []}, {"activeSessionId": "missing"},
    {"sessions": [session(), session()]}, {"sessions": [session()] * 13}, {"unsupported": True}, {"notes": {}},
])
def test_invalid_workspace_rejected_without_mutation(api, patch):
    collection, client, _ = api
    value = workspace()
    value.update(patch)
    assert client.post("/api/world-workspace", json={"revision": 0, "workspace": value}).status_code == 422
    assert collection.count_documents({}) == 0


@pytest.mark.parametrize("revision", [True, -1, 1.5, "0", None, 9007199254740991])
def test_invalid_revision_rejected(api, revision):
    collection, client, _ = api
    assert client.post("/api/world-workspace", json={"revision": revision, "workspace": workspace()}).status_code == 422
    assert collection.count_documents({}) == 0


@pytest.mark.parametrize("mutate", [
    lambda item: item.update(extra="newer"),
    lambda item: item["save"].update(version=2),
    lambda item: item["save"].update(version=True),
    lambda item: item["narratives"][0].update(kind=[]),
    lambda item: item["narratives"][0].update(turn=True),
    lambda item: item["narratives"][0].update(unknown="future"),
    lambda item: item.update(updatedAt="invalid"),
])
def test_invalid_sessions_or_narratives_return_422_not_server_error(api, mutate):
    collection, client, _ = api
    item = session()
    mutate(item)
    value = workspace()
    value.update(sessions=[item], activeSessionId="world-one")
    assert client.post("/api/world-workspace", json={"revision": 0, "workspace": value}).status_code == 422
    assert collection.count_documents({}) == 0


def test_explicit_clear_uses_revision_and_does_not_touch_classic_userdata(api):
    collection, client, database = api
    database["userdata"].insert_one({"_id": "main", "revision": 99, "soulSession": {"chapters": ["原章節"]}})
    original = database["userdata"].find_one()
    client.post("/api/world-workspace", json={"revision": 0, "workspace": workspace()})
    assert client.post("/api/world-workspace", json={"revision": 1, "workspace": None}).json() == {"status": "ok", "revision": 2}
    assert collection.find_one()["workspace"] is None
    assert database["userdata"].find_one() == original


def test_streamed_body_size_limit_and_invalid_json(api):
    collection, client, _ = api
    oversized = b'"' + b"x" * MAX_BYTES + b'"'
    assert client.post("/api/world-workspace", content=oversized).status_code == 413
    assert client.post("/api/world-workspace", content=b'{broken').status_code == 422
    assert client.post("/api/world-workspace", content=b'{"revision":0,"workspace":NaN}').status_code == 422
    assert client.post("/api/world-workspace", content=b'{"revision":0,"revision":1,"workspace":null}').status_code == 422
    assert collection.count_documents({}) == 0


@pytest.mark.parametrize("key", ["__proto__", "constructor", "$set", "a.b", "bad\0key"])
def test_unsafe_nested_keys_cannot_reach_mongo(api, key):
    collection, client, _ = api
    value = workspace()
    value["selection"][key] = "unsafe"
    assert client.post("/api/world-workspace", json={"revision": 0, "workspace": value}).status_code == 422
    assert collection.count_documents({}) == 0


def test_non_finite_huge_integer_and_lone_surrogate_do_not_reach_mongo(api):
    collection, client, _ = api
    for raw_value in ["1" + "0" * 100, '"\\ud800"', "Infinity"]:
        body = '{"revision":0,"workspace":{"format":"dynasty-world-workspace","schemaVersion":1,"sessions":[],"activeSessionId":null,"selection":{"value":' + raw_value + '}}}'
        assert client.post("/api/world-workspace", content=body).status_code == 422
    assert collection.count_documents({}) == 0


def test_first_insert_duplicate_race_returns_conflict():
    class RacingCollection:
        def find_one(self, query):
            return None

        def update_one(self, *args, **kwargs):
            raise DuplicateKeyError("another tab won")

    with pytest.raises(HTTPException) as exc:
        save_workspace(RacingCollection(), {"revision": 0, "workspace": workspace()})
    assert exc.value.status_code == 409


def test_invalid_stored_revision_does_not_allow_reset(api):
    collection, client, _ = api
    collection.insert_one({"_id": "main", "revision": True, "workspace": workspace()})
    assert client.get("/api/world-workspace").status_code == 409
    assert client.post("/api/world-workspace", json={"revision": 0, "workspace": workspace()}).status_code == 409
    assert collection.find_one()["revision"] is True


@pytest.mark.parametrize("selection", [
    {}, {**workspace()["selection"], "enabled": "yes"}, {**workspace()["selection"], "recordIds": ["duplicate", "duplicate"]},
    {**workspace()["selection"], "recordIds": [f"id-{i}" for i in range(13)]},
    {**workspace()["selection"], "setting": {"kind": "free"}}, {**workspace()["selection"], "notes": {}},
    {**workspace()["selection"], "anchors": [{"kind": "analysis", "recordId": "orphan", "field": "analysis", "start": 0, "end": 1}]},
    {**workspace()["selection"], "anchors": [{"kind": "claim", "claimId": "known", "principle": []}]},
])
def test_malformed_shared_selection_rejected_without_losing_cloud(api, selection):
    collection, client, _ = api
    client.post("/api/world-workspace", json={"revision": 0, "workspace": workspace()})
    before = collection.find_one()
    value = workspace()
    value["selection"] = selection
    assert client.post("/api/world-workspace", json={"revision": 1, "workspace": value}).status_code == 422
    assert collection.find_one() == before


def test_selection_unknown_identity_is_preserved_without_name_matching(api):
    _, client, _ = api
    value = workspace()
    value["selection"]["recordIds"] = ["missing-from-current-library"]
    value["selection"]["anchors"] = [{"kind": "analysis", "recordId": "missing-from-current-library", "field": "soulEssence", "start": 10, "end": 20, "quote": "原始人物分析", "principle": "care"}]
    assert client.post("/api/world-workspace", json={"revision": 0, "workspace": value}).status_code == 200
    assert client.get("/api/world-workspace").json()["workspace"]["selection"] == value["selection"]
