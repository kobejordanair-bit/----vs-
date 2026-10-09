"""Migration gates use production middleware without real credentials or I/O."""
import importlib
import sys
from pathlib import Path
from unittest.mock import patch

import mongomock
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def migrated_api():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    sys.modules.pop("main", None)
    environment = {
        "APP_SECRET": "migration-test-only",
        "MONGODB_URL": "mongodb://localhost/isolated",
        "GOOGLE_API_KEY": "not-a-real-key",
        "MIGRATION_READ_ONLY": "true",
        "MIGRATION_TARGET_ORIGIN": "https://dynasty.example.com",
    }
    with patch.dict("os.environ", environment), patch("dotenv.load_dotenv", return_value=False), patch("pymongo.MongoClient", mongomock.MongoClient), patch("google.genai.Client", return_value=object()):
        main = importlib.import_module("main")
        with TestClient(main.app, follow_redirects=False) as client:
            yield main, client
    sys.modules.pop("main", None)


@pytest.mark.parametrize("route", ["/api/userdata", "/api/world-workspace", "/api/userdata/", "/api/world-workspace/"])
def test_read_only_blocks_writes_before_auth_or_payload_parsing(migrated_api, route):
    main, client = migrated_api
    main.userdata_col.insert_one({"_id": "main", "revision": 9, "future": {"preserve": True}})
    response = client.post(route, content=b"not-json")
    assert response.status_code == 503
    assert "本機進度仍保留" in response.json()["detail"]
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-dynasty-migration"] == "read-only"
    assert main.userdata_col.find_one() == {"_id": "main", "revision": 9, "future": {"preserve": True}}
    assert main.db["worldworkspaces"].count_documents({}) == 0


def test_read_only_preserves_authenticated_reads_and_auth(migrated_api):
    main, client = migrated_api
    token = client.post("/api/auth", json={"password": "migration-test-only"}).json()["token"]
    main.userdata_col.insert_one({"_id": "main", "revision": 7, "unknownFuture": "retained"})
    response = client.get("/api/userdata", headers={"x-app-token": token})
    assert response.status_code == 200
    assert response.json()["unknownFuture"] == "retained"
    assert response.json()["revision"] == 7
    assert client.get("/api/world-workspace", headers={"x-app-token": token}).json() == {"revision": 0, "workspace": None}
    assert client.get("/api/userdata").status_code == 403


@pytest.mark.parametrize("route,target", [
    ("/", "/"), ("/play", "/play"), ("/index.html", "/play"),
    ("/history-lab", "/history-lab"), ("/history-lab.html", "/history-lab.html"),
    ("/source-archive", "/source-archive"), ("/source-archive.html", "/source-archive.html"),
])
def test_known_page_redirects_preserve_deep_link_queries(migrated_api, route, target):
    _, client = migrated_api
    response = client.get(route + "?person=test&return=https%3A%2F%2Fevil.example")
    assert response.status_code == 307
    assert response.headers["location"] == "https://dynasty.example.com" + target + "?person=test&return=https%3A%2F%2Fevil.example"
    assert response.headers["cache-control"] == "no-store"


def test_redirect_does_not_capture_apis_static_or_unknown_html(migrated_api):
    _, client = migrated_api
    for path in ["/api/userdata", "/api/world-workspace", "/static/js/world-engine.js", "/unrecognized.html"]:
        response = client.get(path)
        assert response.status_code != 307
        assert "location" not in response.headers


def test_disabled_gates_restore_normal_routes_and_writes(migrated_api):
    main, client = migrated_api
    main.MIGRATION_READ_ONLY = False
    main.MIGRATION_TARGET_ORIGIN = ""
    assert client.get("/play").status_code == 200
    token = client.post("/api/auth", json={"password": "migration-test-only"}).json()["token"]
    response = client.post("/api/userdata", json={"revision": 0, "scenes": []}, headers={"x-app-token": token})
    assert response.json() == {"status": "ok", "revision": 1}


@pytest.mark.parametrize("origin", [
    "http://dynasty.example.com", "//evil.example", "https://safe.example@evil.example",
    "https://safe.example/path", "https://safe.example?next=evil", "https://safe.example#fragment",
    "https://safe.example:8443", "https://safe.example\\@evil.example", "https://safe.example\n",
    "https://safe.example:bad", "https://-bad.example", "https://localhost", "https://safe.example%2fevil",
])
def test_unsafe_deployment_origins_fail_without_echoing_value(migrated_api, origin):
    main, _ = migrated_api
    with pytest.raises(ValueError) as error:
        main.migration_origin(origin)
    assert origin not in str(error.value)


def test_origin_normalization(migrated_api):
    main, _ = migrated_api
    assert main.migration_origin("") == ""
    assert main.migration_origin("https://Dynasty.Example.com:443/") == "https://dynasty.example.com"
