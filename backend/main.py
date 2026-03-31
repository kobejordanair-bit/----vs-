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
import openpyxl
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from pymongo import MongoClient

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

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("環境變數 GEMINI_API_KEY 尚未設定！")

client = genai.Client(api_key=GEMINI_API_KEY)
PRIMARY_MODEL = "gemini-2.5-pro"
FALLBACK_MODEL = "gemini-3-flash-preview"
def load_ranking_reference():
    try:
        BASE_DIR = os.path.dirname(os.path.abspath(__file__))
        wb = openpyxl.load_workbook(os.path.join(BASE_DIR, '王侯將相最新版.xlsx'))
        ws = wb.active
        rank_groups = {}
        for row in ws.iter_rows(min_row=2, values_only=True):
            if row[1] and row[2]:
                rank = row[2]
                name = row[1]
                if rank not in rank_groups:
                    rank_groups[rank] = []
                if len(rank_groups[rank]) < 5:
                    rank_groups[rank].append(name)
        result = "【現有人物評級參考表】\n"
        for rank in ['S+', 'S', 'S-', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D']:
            if rank in rank_groups:
                result += f"{rank}：{'、'.join(rank_groups[rank])}\n"
        return result
    except Exception as e:
        print(f"讀取Excel失敗: {e}")
        return ""

RANKING_REFERENCE = load_ranking_reference()

class ChatRequest(BaseModel):
    contents: List[Dict[str, Any]]
    is_json: bool = False

class UserDataRequest(BaseModel):
    customLegends: List[Dict[str, Any]] = []
    modifiedLegends: Dict[str, Any] = {}
    chatHistories: Dict[str, Any] = {}
    simulationHistory: List[Dict[str, Any]] = []

def verify_token(x_app_token: Optional[str] = Header(None)):
    if x_app_token != APP_SECRET:
        raise HTTPException(status_code=403, detail="無效的存取金鑰")

@app.get("/")
def serve_frontend():
    return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html"))

@app.get("/manifest.json")
def serve_manifest():
    return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "manifest.json"))

@app.get("/sw.js")
def serve_sw():
    return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sw.js"))

@app.post("/api/auth")
@limiter.limit("5/minute")
async def auth(request: Request):
    body = await request.json()
    password = body.get("password", "")
    if password == APP_SECRET:
        return {"token": APP_SECRET}
    raise HTTPException(status_code=401, detail="密碼錯誤")

@app.get("/api/ranking-reference")
def get_ranking_reference():
    return {"result": RANKING_REFERENCE}

@app.get("/api/userdata")
async def get_userdata(x_app_token: Optional[str] = Header(None)):
    verify_token(x_app_token)
    doc = userdata_col.find_one({"_id": "main"}, {"_id": 0})
    if not doc:
        return {"customLegends": [], "modifiedLegends": {}, "chatHistories": {}}
    return doc

@app.post("/api/userdata")
async def save_userdata(request: Request, body: UserDataRequest, x_app_token: Optional[str] = Header(None)):
    verify_token(x_app_token)
    userdata_col.replace_one(
        {"_id": "main"},
        {"_id": "main", "customLegends": body.customLegends, "modifiedLegends": body.modifiedLegends, "chatHistories": body.chatHistories, "simulationHistory": body.simulationHistory},
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
            if "503" in str(model_err) or "UNAVAILABLE" in str(model_err):
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
            role = "user" if msg["role"] == "user" else "model"
            text = msg["parts"][0]["text"]
            contents.append({"role": role, "parts": [{"text": text}]})
        if not contents:
            raise HTTPException(status_code=400, detail="對話內容不能為空")
        async def generate():
            used_model = PRIMARY_MODEL
            try:
                chunks = list(client.models.generate_content_stream(
                    model=PRIMARY_MODEL,
                    contents=contents,
                ))
            except Exception as model_err:
                if "503" in str(model_err) or "UNAVAILABLE" in str(model_err):
                    used_model = FALLBACK_MODEL
                    chunks = list(client.models.generate_content_stream(
                        model=FALLBACK_MODEL,
                        contents=contents,
                    ))
                else:
                    raise
            yield f"data: {json.dumps({'model': used_model})}\n\n"
            for chunk in chunks:
                if chunk.text:
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(generate(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))