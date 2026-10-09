import os
import json
import time
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from archive_static import SourceArchiveStaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from google import genai
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from pymongo import MongoClient
from userdata_schema import UserDataRequest, load_userdata, save_userdata_patch
from world_workspace import create_router as create_world_router
import asyncio
import threading
import queue as stdlib_queue
import re
from urllib.parse import urlsplit, urlunsplit
from fastapi.responses import RedirectResponse

load_dotenv()

APP_VERSION = "16.0"
APP_SECRET = os.getenv("APP_SECRET")
if not APP_SECRET:
    raise ValueError("環境變數 APP_SECRET 尚未設定！")

MONGODB_URL = os.getenv("MONGODB_URL")
if not MONGODB_URL:
    raise ValueError("環境變數 MONGODB_URL 尚未設定！")

mongo_client = MongoClient(MONGODB_URL)
db = mongo_client["dynasty"]
userdata_col = db["userdata"]

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="帝王將相名臣評鑑 API", version=APP_VERSION)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://dynasty-ydov.onrender.com").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def migration_origin(value: str) -> str:
    """Accept a deployment origin, never credentials or a redirect URL."""
    if not value:
        return ""
    invalid = "MIGRATION_TARGET_ORIGIN 必須是沒有路徑、帳密或查詢參數的 HTTPS 網域"
    if any(character.isspace() for character in value) or "\\" in value:
        raise ValueError(invalid)
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname or ""
        port = parsed.port
    except ValueError:
        raise ValueError(invalid) from None
    labels = hostname.split(".")
    if (
        parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or port not in {None, 443}
        or len(hostname) > 253
        or len(labels) < 2
        or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels)
        or parsed.netloc.lower() not in {hostname, hostname + ":443"}
    ):
        raise ValueError(invalid)
    return "https://" + hostname


MIGRATION_READ_ONLY = os.getenv("MIGRATION_READ_ONLY", "false").lower().strip()
if MIGRATION_READ_ONLY not in {"true", "false", "1", "0", "yes", "no", "on", "off"}:
    raise ValueError("MIGRATION_READ_ONLY 必須是 true 或 false")
MIGRATION_READ_ONLY = MIGRATION_READ_ONLY in {"true", "1", "yes", "on"}
MIGRATION_TARGET_ORIGIN = migration_origin(os.getenv("MIGRATION_TARGET_ORIGIN", ""))
MIGRATION_PAGE_PATHS = {
    "/": "/",
    "/play": "/play",
    "/index.html": "/play",
    "/history-lab": "/history-lab",
    "/history-lab.html": "/history-lab.html",
    "/source-archive": "/source-archive",
    "/source-archive.html": "/source-archive.html",
}


@app.middleware("http")
async def migration_gate(request: Request, call_next):
    # Old tabs retain their local progress while both cloud collections are frozen.
    path = request.url.path.rstrip("/") or "/"
    if MIGRATION_READ_ONLY and request.method == "POST" and path in {"/api/userdata", "/api/world-workspace"}:
        return JSONResponse(
            status_code=503,
            content={"detail": "網站搬遷中，雲端暫停儲存；本機進度仍保留，請先匯出完整備份，待新站開放後再同步。"},
            headers={"Cache-Control": "no-store", "Retry-After": "300", "X-Dynasty-Migration": "read-only"},
        )
    if MIGRATION_TARGET_ORIGIN and request.method in {"GET", "HEAD"} and path in MIGRATION_PAGE_PATHS:
        # urlunsplit prevents a user-supplied path or query from changing the host.
        target = urlsplit(MIGRATION_TARGET_ORIGIN)
        location = urlunsplit((target.scheme, target.netloc, MIGRATION_PAGE_PATHS[path], request.url.query, ""))
        return RedirectResponse(location, status_code=307, headers={"Cache-Control": "no-store"})
    return await call_next(request)

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise ValueError("環境變數 GOOGLE_API_KEY 尚未設定！")

client = genai.Client(api_key=GOOGLE_API_KEY)

PRIMARY_MODEL = "gemini-2.5-pro"
FALLBACK_MODEL = "gemini-3-flash-preview"


class ChatRequest(BaseModel):
    contents: List[Dict[str, Any]]
    is_json: bool = False

TOKEN_TTL_SECONDS = 7 * 24 * 3600  # 7 天

def create_token() -> str:
    return f"{APP_SECRET}.{int(time.time())}"

def verify_token(x_app_token: Optional[str] = Header(None)):
    if not x_app_token:
        raise HTTPException(status_code=403, detail="無效的存取金鑰")
    parts = x_app_token.split(".")
    # 新格式：secret.timestamp
    if len(parts) == 2 and parts[1].isdigit():
        if parts[0] != APP_SECRET:
            raise HTTPException(status_code=403, detail="無效的存取金鑰")
        issued_at = int(parts[1])
        if time.time() - issued_at > TOKEN_TTL_SECONDS:
            raise HTTPException(status_code=401, detail="登入已過期，請重新登入")
    else:
        # 舊格式或直接密碼：拒絕，強制重新登入
        raise HTTPException(status_code=401, detail="登入已過期，請重新登入")

app.include_router(create_world_router(db["worldworkspaces"], verify_token))

@app.get("/play")
@app.get("/")
def serve_frontend():
    return FileResponse(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/history-lab")
def serve_history_lab():
    return FileResponse(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "history-lab.html"),
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            "X-Content-Type-Options": "nosniff",
        },
    )

@app.get("/source-archive")
def serve_source_archive():
    return FileResponse(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "source-archive.html"),
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            "X-Content-Type-Options": "nosniff",
        },
    )

@app.get("/manifest.json")
def serve_manifest():
    manifest_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    for icon in manifest.get("icons", []):
        src = icon.get("src", "")
        if "?" not in src:
            icon["src"] = f"{src}?v={APP_VERSION}"
    return JSONResponse(content=manifest, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

@app.get("/static/icon-192.png")
def serve_icon_192():
    return FileResponse(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "icon-192.png"),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
        media_type="image/png"
    )

@app.get("/static/icon-512.png")
def serve_icon_512():
    return FileResponse(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "icon-512.png"),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
        media_type="image/png"
    )

@app.get("/sw.js")
def serve_sw():
    return FileResponse(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "sw.js"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

app.mount("/static", SourceArchiveStaticFiles(directory=os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")), name="static")

@app.post("/api/auth")
@limiter.limit("5/minute")
async def auth(request: Request):
    body = await request.json()
    password = body.get("password", "")
    if password == APP_SECRET:
        return {"token": create_token()}
    raise HTTPException(status_code=401, detail="密碼錯誤")
@app.get("/api/userdata")
def get_userdata(x_app_token: Optional[str] = Header(None)):
    verify_token(x_app_token)
    return load_userdata(userdata_col)

@app.post("/api/userdata")
def save_userdata(request: Request, body: UserDataRequest, x_app_token: Optional[str] = Header(None)):
    verify_token(x_app_token)
    return save_userdata_patch(userdata_col, body)

@app.post("/api/gemini")
@limiter.limit("20/minute")
async def call_gemini(request: Request, body: ChatRequest, x_app_token: Optional[str] = Header(None)):
    verify_token(x_app_token)
    try:
        contents = []
        for msg in body.contents:
            if not msg.get("parts") or not msg["parts"][0].get("text"):
                continue
            role = "user" if msg["role"] == "user" else "model"
            text = msg["parts"][0]["text"]
            contents.append({"role": role, "parts": [{"text": text}]})
        if not contents:
            raise HTTPException(status_code=400, detail="對話內容不能為空")
        config = {}
        if body.is_json:
            config["response_mime_type"] = "application/json"
        used_model = PRIMARY_MODEL
        response = None
        try:
            response = client.models.generate_content(
                model=PRIMARY_MODEL,
                contents=contents,
                config=config if config else None
            )
        except Exception as model_err:
            if "503" in str(model_err) or "UNAVAILABLE" in str(model_err) or "429" in str(model_err) or "RESOURCE_EXHAUSTED" in str(model_err):
                used_model = FALLBACK_MODEL
                response = client.models.generate_content(
                    model=FALLBACK_MODEL,
                    contents=contents,
                    config=config if config else None
                )
            else:
                raise
        if response is None:
            raise HTTPException(status_code=500, detail="模型呼叫失敗")
        return {"result": response.text, "model": used_model}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/gemini/stream")
@limiter.limit("20/minute")
async def call_gemini_stream(request: Request, body: ChatRequest, x_app_token: Optional[str] = Header(None)):
    verify_token(x_app_token)
    try:
        contents = []
        for msg in body.contents:
            if not msg.get("parts") or not msg["parts"][0].get("text"):
                continue
            role = "user" if msg["role"] == "user" else "model"
            text = msg["parts"][0]["text"]
            contents.append({"role": role, "parts": [{"text": text}]})
        if not contents:
            raise HTTPException(status_code=400, detail="對話內容不能為空")

        async def generate():
            used_model = PRIMARY_MODEL
            yield f"data: {json.dumps({'model': used_model})}\n\n"

            q = stdlib_queue.Queue()

            def _producer(model):
                try:
                    for chunk in client.models.generate_content_stream(
                        model=model, contents=contents
                    ):
                        q.put(('chunk', chunk))
                except Exception as e:
                    if "503" in str(e) or "UNAVAILABLE" in str(e) or "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                        q.put(('model', FALLBACK_MODEL))
                        try:
                            for chunk in client.models.generate_content_stream(
                                model=FALLBACK_MODEL, contents=contents
                            ):
                                q.put(('chunk', chunk))
                        except Exception as e2:
                            q.put(('error', e2))
                    else:
                        q.put(('error', e))
                q.put(('done', None))

            threading.Thread(target=_producer, args=(PRIMARY_MODEL,), daemon=True).start()

            while True:
                type_, data = await asyncio.to_thread(q.get)
                if type_ == 'done':
                    break
                elif type_ == 'error':
                    raise data
                elif type_ == 'model':
                    yield f"data: {json.dumps({'model': data})}\n\n"
                elif type_ == 'chunk' and data.text:
                    yield f"data: {json.dumps({'text': data.text})}\n\n"

            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
