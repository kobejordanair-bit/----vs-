"""Scoped HTTP caching and precompressed assets for the public source archive."""
import mimetypes
import re
import stat

import anyio
from starlette.staticfiles import StaticFiles

IMMUTABLE = re.compile(r"^data/history/web/releases/[a-f0-9]{16}/")
ARCHIVE_FILES = {
    "js/source-archive.js", "js/source-search-engine.js", "js/source-search-worker.js",
    "js/source-links.js", "css/source-archive.css", "data/history/source-archive.v1.json",
}


def accepts_gzip(header: str) -> bool:
    """An explicit gzip q=0 takes precedence over a wildcard."""
    values = {}
    for part in header.lower().split(","):
        fields = [field.strip() for field in part.split(";")]
        if not fields[0]:
            continue
        quality = 1.0
        for field in fields[1:]:
            if field.startswith("q="):
                try:
                    quality = float(field[2:])
                except ValueError:
                    quality = 0.0
        values[fields[0]] = quality if 0 <= quality <= 1 else 0.0
    return values.get("gzip", values.get("*", 0)) > 0


class SourceArchiveStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        canonical = path.replace("\\", "/").lstrip("/")
        managed = canonical in ARCHIVE_FILES or canonical.startswith("data/history/web/")
        if not managed:
            return await super().get_response(path, scope)
        selected = path
        encoded = False
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        if canonical.endswith((".json", ".js", ".css")) and accepts_gzip(headers.get(b"accept-encoding", b"").decode("latin1")):
            _, details = await anyio.to_thread.run_sync(self.lookup_path, path + ".gz")
            if details and stat.S_ISREG(details.st_mode):
                selected = path + ".gz"
                encoded = True
        response = await super().get_response(selected, scope)
        if response.status_code in (200, 206, 304):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if IMMUTABLE.match(canonical) else "no-cache"
            response.headers["Vary"] = "Accept-Encoding"
            response.headers["X-Content-Type-Options"] = "nosniff"
            if encoded:
                response.headers["Content-Encoding"] = "gzip"
                response.headers["Content-Type"] = (mimetypes.guess_type(path)[0] or "application/octet-stream") + "; charset=utf-8"
        return response
