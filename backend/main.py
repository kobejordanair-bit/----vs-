import os
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
import json
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
from google import genai
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="帝王將相名臣評鑑 API", version="15.2")

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

# 移到這裡，只建立一次
client = genai.Client(api_key=GEMINI_API_KEY)

class ChatRequest(BaseModel):
    contents: List[Dict[str, Any]]
    is_json: bool = False

@app.get("/")
def read_root():
    return {"status": "System Online", "message": "帝王將相名臣評鑑後端已啟動"}

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
            model="gemini-3.1-pro-preview",
            contents=contents,
            config=config if config else None
        )

        return {"result": response.text}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    from fastapi.responses import StreamingResponse
import json

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
                model="gemini-3.1-pro-preview",
                contents=contents,
            ):
                if chunk.text:
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))