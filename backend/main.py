import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
from google import genai
from dotenv import load_dotenv
import openpyxl

load_dotenv()

APP_VERSION = "15.2"

app = FastAPI(title="帝王將相名臣評鑑 API", version=APP_VERSION)

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

@app.get("/")
def serve_frontend():
    return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html"))

@app.get("/manifest.json")
def serve_manifest():
    return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "manifest.json"))

@app.get("/sw.js")
def serve_sw():
    return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sw.js"))

@app.get("/api/ranking-reference")
def get_ranking_reference():
    return {"result": RANKING_REFERENCE}

@app.post("/api/gemini")
async def call_gemini(request: ChatRequest):
    try:
        contents = []
        for msg in request.contents:
            role = "user" if msg["role"] == "user" else "model"
            text = msg["parts"][0]["text"]
            contents.append({"role": role, "parts": [{"text": text}]})
        if not contents:
            raise HTTPException(status_code=400, detail="對話內容不能為空")
        config = {}
        if request.is_json:
            config["response_mime_type"] = "application/json"
        response = client.models.generate_content(
            model="gemini-2.5-pro",
            contents=contents,
            config=config if config else None
        )
        return {"result": response.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/gemini/stream")
async def call_gemini_stream(request: ChatRequest):
    try:
        contents = []
        for msg in request.contents:
            role = "user" if msg["role"] == "user" else "model"
            text = msg["parts"][0]["text"]
            contents.append({"role": role, "parts": [{"text": text}]})
        if not contents:
            raise HTTPException(status_code=400, detail="對話內容不能為空")
        def generate():
            for chunk in client.models.generate_content_stream(
                model="gemini-2.5-pro",
                contents=contents,
            ):
                if chunk.text:
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(generate(), media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))