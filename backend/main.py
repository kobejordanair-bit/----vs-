import os
import json
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from google import genai
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from pymongo import MongoClient
import asyncio
import threading
import queue as stdlib_queue

load_dotenv()

APP_VERSION = "15.2"
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://dynasty-ydov.onrender.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import tempfile

GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID")
GCP_KEY_JSON = os.getenv("GCP_KEY_JSON")

if not GCP_PROJECT_ID or not GCP_KEY_JSON:
    raise ValueError("環境變數 GCP_PROJECT_ID 或 GCP_KEY_JSON 尚未設定！")

# 把 JSON 寫入暫存檔，讓 google SDK 讀取
_key_file = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
_key_file.write(GCP_KEY_JSON)
_key_file.close()
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _key_file.name

client = genai.Client(
    vertexai=True,
    project=GCP_PROJECT_ID,
    location="global"
)

PRIMARY_MODEL = "gemini-3.1-pro-preview"
FALLBACK_MODEL = "gemini-3.1-flash-lite-preview"


class ChatRequest(BaseModel):
    contents: List[Dict[str, Any]]
    is_json: bool = False

class UserDataRequest(BaseModel):
    customLegends: List[Dict[str, Any]] = []
    modifiedLegends: Dict[str, Any] = {}
    chatHistories: Dict[str, Any] = {}
    simulationHistory: List[Dict[str, Any]] = []
    discussionHistories: Dict[str, Any] = {}
    soulSaves: List[Dict[str, Any]] = []

def verify_token(x_app_token: Optional[str] = Header(None)):
    if x_app_token != APP_SECRET:
        raise HTTPException(status_code=403, detail="無效的存取金鑰")

@app.get("/")
def serve_frontend():
    return FileResponse(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
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

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")), name="static")

@app.post("/api/auth")
@limiter.limit("5/minute")
async def auth(request: Request):
    body = await request.json()
    password = body.get("password", "")
    if password == APP_SECRET:
        return {"token": APP_SECRET}
    raise HTTPException(status_code=401, detail="密碼錯誤")
@app.get("/api/userdata")
def get_userdata(x_app_token: Optional[str] = Header(None)):
    verify_token(x_app_token)
    doc = userdata_col.find_one({"_id": "main"}, {"_id": 0})
    if not doc:
        return {"customLegends": [], "modifiedLegends": {}, "chatHistories": {}}
    return doc

@app.post("/api/userdata")
def save_userdata(request: Request, body: UserDataRequest, x_app_token: Optional[str] = Header(None)):
    verify_token(x_app_token)
    userdata_col.replace_one(
        {"_id": "main"},
        {"_id": "main", "customLegends": body.customLegends, "modifiedLegends": body.modifiedLegends, "chatHistories": body.chatHistories, "simulationHistory": body.simulationHistory, "discussionHistories": body.discussionHistories, "soulSaves": body.soulSaves},
        upsert=True
    )
    return {"status": "ok"}

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
                elif type_ == 'chunk' and data.text:
                    yield f"data: {json.dumps({'text': data.text})}\n\n"

            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))