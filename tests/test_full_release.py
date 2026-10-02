"""Use production route wiring with only isolated dependencies, never live secrets or AI."""
import importlib
import sys
from pathlib import Path
from unittest.mock import patch

import mongomock
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def api():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    sys.modules.pop("main", None)
    with patch.dict("os.environ", {"APP_SECRET": "release-test-only", "MONGODB_URL": "mongodb://localhost/isolated", "GOOGLE_API_KEY": "not-a-real-key"}), patch("dotenv.load_dotenv", return_value=False), patch("pymongo.MongoClient", mongomock.MongoClient), patch("google.genai.Client", return_value=object()):
        main = importlib.import_module("main")
        with TestClient(main.app) as client:
            yield main, client
    sys.modules.pop("main", None)


def test_production_routes_and_versions(api):
    _, client = api
    page = client.get("/")
    assert page.status_code == 200
    assert client.get("/play").content == page.content
    assert "world-ui.js?v=16.0" in page.text
    assert client.get("/openapi.json").json()["info"]["version"] == "16.0"
    for route in ["/history-lab", "/source-archive", "/static/js/world-engine.js", "/static/css/world.css"]:
        assert client.get(route).status_code == 200


def test_production_auth_and_separate_revisioned_world_collection(api):
    main, client = api
    assert client.get("/api/userdata").status_code == 403
    assert client.get("/api/world-workspace").status_code == 403
    token = client.post("/api/auth", json={"password": "release-test-only"}).json()["token"]
    headers = {"x-app-token": token}
    main.userdata_col.insert_one({"_id": "main", "revision": 7, "customLegends": [], "modifiedLegends": {"kept": {"analysis": "original"}}})
    before = main.userdata_col.find_one()
    workspace = {"format": "dynasty-world-workspace", "schemaVersion": 1, "sessions": [], "activeSessionId": None, "selection": {"enabled": False, "recordIds": [], "setting": {"kind": "free", "eventId": "", "placeIds": [], "factionIds": []}, "anchors": [], "notes": ""}}
    assert client.get("/api/world-workspace", headers=headers).json() == {"revision": 0, "workspace": None}
    result = client.post("/api/world-workspace", headers=headers, json={"revision": 0, "workspace": workspace})
    assert result.json() == {"status": "ok", "revision": 1}
    assert main.userdata_col.find_one() == before
    assert client.post("/api/world-workspace", headers=headers, json={"revision": 0, "workspace": workspace}).status_code == 409
    assert client.get("/api/world-workspace", headers=headers).json()["workspace"] == workspace
