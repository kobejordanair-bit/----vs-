"""HTTP behavior of the archive mount, isolated from the production app and secrets."""

import gzip
import sys
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from archive_static import SourceArchiveStaticFiles, accepts_gzip  # noqa: E402


RELEASE = "data/history/web/releases/0123456789abcdef"
JSON_BODY = '{"人物":"韓信","source":"test fixture"}'.encode("utf-8")


@pytest.fixture
def site(tmp_path):
    root = tmp_path / "static"
    assets = {
        "data/history/web/manifest.json": JSON_BODY,
        f"{RELEASE}/people.json": JSON_BODY,
        "data/history/web/releases/not-a-version/people.json": JSON_BODY,
        "data/history/web/releases/0123456789abcdef0/people.json": JSON_BODY,
        "data/history/web/releases/0123456789ABCDEF/people.json": JSON_BODY,
        "data/history/web/without-compression.json": JSON_BODY,
        "data/history/source-archive.v1.json": JSON_BODY,
        "js/source-archive.js": b"window.archiveTest = true;\n",
        "js/source-links.js": b"window.linksTest = true;\n",
        "css/source-archive.css": b"body { color: #123; }\n",
        "js/ordinary.js": b"window.existingFeature = true;\n",
    }
    for relative, body in assets.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        if "without-compression" not in relative:
            Path(str(target) + ".gz").write_bytes(gzip.compress(body, mtime=0))
    (tmp_path / "secret.json").write_text('"outside-root-secret"', encoding="utf-8")
    app = Starlette(routes=[
        Mount("/static", app=SourceArchiveStaticFiles(directory=root)),
        Mount("/baseline", app=StaticFiles(directory=root)),
    ])
    with TestClient(app) as client:
        yield client, root, assets


@pytest.mark.parametrize(("header", "expected"), [
    ("", False), ("identity", False), ("br", False), ("gzip", True),
    ("GZIP; Q=0.5", True), ("gzip;q=0", False), ("*", True),
    ("gzip;q=0, *;q=1", False), ("*;q=1, gzip;q=0", False),
    ("*;q=0, gzip;q=0.5", True), ("gzip;q=invalid, *;q=1", False),
    ("gzip;q=2", False), ("gzip;q=-1", False), ("gzip;q=nan", False),
])
def test_gzip_negotiation(header, expected):
    assert accepts_gzip(header) is expected


@pytest.mark.parametrize(("accept", "encoded"), [
    ("gzip", True), ("identity", False), ("gzip;q=0, *;q=1", False),
    ("*;q=1", True), ("*;q=0", False),
])
def test_manifest_negotiation_mime_and_head(site, accept, encoded):
    client, root, _ = site
    path = "data/history/web/manifest.json"
    response = client.get("/static/" + path, headers={"Accept-Encoding": accept})
    assert response.status_code == 200
    assert response.content == JSON_BODY  # HTTPX decodes Content-Encoding automatically.
    assert response.headers["content-type"].split(";")[0] == "application/json"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["vary"] == "Accept-Encoding"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers.get("content-encoding") == ("gzip" if encoded else None)
    stored_file = root / (path + (".gz" if encoded else ""))
    assert int(response.headers["content-length"]) == stored_file.stat().st_size
    head = client.head("/static/" + path, headers={"Accept-Encoding": accept})
    assert head.status_code == 200
    assert head.content == b""
    for header in ["content-type", "content-length", "content-encoding", "etag", "cache-control", "vary"]:
        assert head.headers.get(header) == response.headers.get(header)


@pytest.mark.parametrize("accept", ["gzip", "identity"])
@pytest.mark.parametrize("path", ["data/history/web/manifest.json", f"{RELEASE}/people.json"])
def test_etag_revalidation_retains_cache_policy_and_representation(site, accept, path):
    client, _, _ = site
    response = client.get("/static/" + path, headers={"Accept-Encoding": accept})
    cached = client.get("/static/" + path, headers={"Accept-Encoding": accept, "If-None-Match": response.headers["etag"]})
    assert cached.status_code == 304
    assert cached.content == b""
    for header in ["cache-control", "etag", "vary", "content-encoding"]:
        assert cached.headers.get(header) == response.headers.get(header)
    other_encoding = "identity" if accept == "gzip" else "gzip"
    different = client.get("/static/" + path, headers={"Accept-Encoding": other_encoding, "If-None-Match": response.headers["etag"]})
    assert different.status_code == 200
    assert different.content == JSON_BODY
    assert different.headers["etag"] != response.headers["etag"]


@pytest.mark.parametrize(("path", "immutable"), [
    (f"{RELEASE}/people.json", True),
    ("data/history/web/manifest.json", False),
    ("data/history/web/releases/not-a-version/people.json", False),
    ("data/history/web/releases/0123456789abcdef0/people.json", False),
    ("data/history/web/releases/0123456789ABCDEF/people.json", False),
    ("data/history/source-archive.v1.json", False),
])
def test_only_exact_lowercase_16_character_hash_release_paths_are_immutable(site, path, immutable):
    client, _, _ = site
    response = client.get("/static/" + path)
    assert response.status_code == 200
    expected = "public, max-age=31536000, immutable" if immutable else "no-cache"
    assert response.headers["cache-control"] == expected


@pytest.mark.parametrize("accept", ["gzip", "identity"])
@pytest.mark.parametrize("path", ["js/source-archive.js", "js/source-links.js", "css/source-archive.css"])
def test_code_assets_keep_original_mime_and_body(site, accept, path):
    client, _, assets = site
    response = client.get("/static/" + path, headers={"Accept-Encoding": accept})
    baseline = client.get("/baseline/" + path, headers={"Accept-Encoding": "identity"})
    assert response.status_code == 200
    assert response.content == assets[path]
    assert response.headers["content-type"].split(";")[0] == baseline.headers["content-type"].split(";")[0]
    assert response.headers["vary"] == "Accept-Encoding"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers.get("content-encoding") == ("gzip" if accept == "gzip" else None)


def test_missing_gzip_variant_falls_back_without_inventing_an_encoding(site):
    client, _, _ = site
    response = client.get("/static/data/history/web/without-compression.json", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.content == JSON_BODY
    assert "content-encoding" not in response.headers
    assert response.headers["vary"] == "Accept-Encoding"


def test_existing_nonarchive_files_match_the_unmodified_staticfiles_mount(site):
    client, _, _ = site
    for method in ["GET", "HEAD"]:
        options = {"headers": {"Accept-Encoding": "gzip"}}
        response = client.request(method, "/static/js/ordinary.js", **options)
        baseline = client.request(method, "/baseline/js/ordinary.js", **options)
        assert response.status_code == baseline.status_code == 200
        assert response.content == baseline.content
        assert dict(response.headers) == dict(baseline.headers)
        assert "content-encoding" not in response.headers
        assert "cache-control" not in response.headers


@pytest.mark.parametrize("path", [
    "missing.json", "data/history/web/missing.json",
    "%2e%2e/secret.json", "data/history/web/%2e%2e/%2e%2e/%2e%2e/%2e%2e/secret.json",
    "data/history/web/..%5c..%5c..%5c..%5csecret.json",
    "data/history/web/%252e%252e/%252e%252e/secret.json",
])
def test_missing_assets_and_encoded_traversal_do_not_expose_files(site, path):
    client, _, _ = site
    response = client.get("/static/" + path, headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 404
    assert "outside-root-secret" not in response.text
    assert "immutable" not in response.headers.get("cache-control", "")


def test_post_cannot_write_static_archive(site):
    client, root, _ = site
    response = client.post("/static/data/history/web/manifest.json", content=b"changed")
    assert response.status_code == 405
    assert (root / "data/history/web/manifest.json").read_bytes() == JSON_BODY
