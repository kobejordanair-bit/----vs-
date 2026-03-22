import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
import google.generativeai as genai
from dotenv import load_dotenv

# 載入環境變數 (.env 檔案裡面的 API Key)
load_dotenv()

# 初始化 FastAPI 應用程式
app = FastAPI(title="帝王將相名臣評鑑 API", version="15.1")

# 設定 CORS (跨來源資源共用)
# 開發階段先允許所有來源 (*)，確保你的本地端 HTML 可以順利打 API 到這台伺服器
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化 Gemini API SDK
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("環境變數 GEMINI_API_KEY 尚未設定，請檢查 .env 檔案！")
genai.configure(api_key=GEMINI_API_KEY)

# 定義前端傳過來的 JSON 資料結構 (Pydantic 嚴格型別驗證)
class ChatRequest(BaseModel):
    contents: List[Dict[str, Any]]
    is_json: bool = False

@app.get("/")
def read_root():
    return {"status": "System Online", "message": "帝王將相名臣評鑑後端已啟動"}

@app.post("/api/gemini")
async def call_gemini(request: ChatRequest):
    """
    接收前端的歷史推演與對話請求，轉發給 Gemini API。
    前端完全不接觸 API Key，杜絕外洩風險。
    """
    try:
        # 建立模型實例 (使用與你前端設定一致的 2.5-pro)
        model = genai.GenerativeModel('gemini-2.5-pro')
        
        # 將前端傳來的資料轉換為 Gemini 官方 SDK 支援的 history 格式
        formatted_history = []
        for msg in request.contents:
            role = "user" if msg["role"] == "user" else "model"
            text = msg["parts"][0]["text"]
            formatted_history.append({"role": role, "parts": [text]})
            
        # 必須至少有一條訊息
        if not formatted_history:
            raise HTTPException(status_code=400, detail="對話內容不能為空")
            
        # 把陣列最後一條抽出來當作本次要發送的 current_message，剩下的作為 context history
        current_msg = formatted_history.pop()
        
        # 設定回傳格式 (針對部分需要回傳 JSON 的歷史推演功能)
        generation_config = genai.types.GenerationConfig(
            temperature=0.7,
            response_mime_type="application/json" if request.is_json else "text/plain"
        )

        # 啟動對話物件並發送請求
        chat = model.start_chat(history=formatted_history)
        response = chat.send_message(
            current_msg["parts"][0],
            generation_config=generation_config
        )
        
        return {"result": response.text}

    except Exception as e:
        # 捕捉任何錯誤 (例如額度用盡、網路斷線) 並以 HTTP 500 回傳給前端
        raise HTTPException(status_code=500, detail=str(e))