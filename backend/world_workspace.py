"""Independent world workspace storage; never writes the original user data.

Future envelopes remain readable and block writes from this client version.
Revision checks and a comparison with the observed document protect first-create
races and concurrent updates. No environment variables or clients are loaded here.
"""

import json
import math
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool

FORMAT = "dynasty-world-workspace"
MAX_BYTES = 8 * 1024 * 1024
MAX_REVISION = 9007199254740990
WORKSPACE_FIELDS = {"format", "schemaVersion", "sessions", "activeSessionId", "selection", "notes", "narratives"}
SESSION_FIELDS = {"id", "title", "updatedAt", "save", "narratives"}
NARRATIVE_FIELDS = {"id", "turn", "text", "createdAt", "kind", "contextVersion"}


def invalid(message: str) -> None:
    raise HTTPException(status_code=422, detail=message)


def json_safe(value: Any, depth: int = 0) -> None:
    if depth > 80:
        invalid("世界資料層次過深")
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeError:
            invalid("世界資料含無效 Unicode 字元")
        return
    if type(value) is int and not -(2 ** 53 - 1) <= value <= 2 ** 53 - 1:
        invalid("世界資料數值超出精確範圍")
    if value is None or isinstance(value, (bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            invalid("世界資料含非有限數值")
        return
    if isinstance(value, list):
        for item in value:
            json_safe(item, depth + 1)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or key in {"__proto__", "constructor", "prototype"} or "\x00" in key or key.startswith("$") or "." in key:
                invalid("世界資料含不支援的欄位名稱")
            json_safe(item, depth + 1)
        return
    invalid("世界資料不是有效 JSON")


def text(value: Any, maximum: int, *, empty: bool = False) -> bool:
    return isinstance(value, str) and len(value) <= maximum and (empty or bool(value.strip()))


def date(value: Any) -> bool:
    from datetime import datetime
    if not text(value, 80):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate_narratives(value: Any) -> None:
    if not isinstance(value, list) or len(value) > 500:
        invalid("敘事紀錄超出上限")
    ids = set()
    for item in value:
        if not isinstance(item, dict) or set(item) - NARRATIVE_FIELDS:
            invalid("敘事紀錄包含未支援欄位")
        if not text(item.get("id"), 180) or item["id"] in ids or type(item.get("turn")) is not int or not 0 <= item["turn"] <= 100000 or not text(item.get("text"), 500000, empty=True) or not date(item.get("createdAt")) or not isinstance(item.get("kind"), str) or item["kind"] not in {"ai", "local"}:
            invalid("敘事紀錄格式不正確")
        if "contextVersion" in item and not text(item["contextVersion"], 100):
            invalid("敘事背景版本不正確")
        ids.add(item["id"])


def validate_selection(value: Any) -> None:
    def ids(items, limit):
        return isinstance(items, list) and len(items) <= limit and all(text(item, 180) for item in items) and len(set(items)) == len(items)

    if not isinstance(value, dict) or type(value.get("enabled")) is not bool or not ids(value.get("recordIds"), 12) or not text(value.get("notes"), 500000, empty=True) or not isinstance(value.get("setting"), dict) or not isinstance(value.get("anchors"), list) or len(value["anchors"]) > 40:
        invalid("共用人物背景欄位不完整或超出上限")
    setting = value["setting"]
    if not isinstance(setting.get("kind"), str) or setting["kind"] not in {"free", "historical", "counterfactual"} or "eventId" not in setting or setting["eventId"] is not None and not text(setting["eventId"], 180, empty=True) or not ids(setting.get("placeIds"), 40) or not ids(setting.get("factionIds"), 40):
        invalid("共用時地勢力設定格式不正確")
    for anchor in value["anchors"]:
        if not isinstance(anchor, dict) or not isinstance(anchor.get("kind"), str) or anchor["kind"] not in {"analysis", "claim"}:
            invalid("解讀錨點格式不正確")
        if "interpretation" in anchor and not text(anchor["interpretation"], 20000, empty=True) or "quote" in anchor and not text(anchor["quote"], 2400, empty=True) or "principle" in anchor and (not isinstance(anchor["principle"], str) or anchor["principle"] not in {"none", "care", "order", "bold", "diplomacy", "learning"}):
            invalid("解讀文字或玩家原則格式不正確")
        if anchor["kind"] == "claim":
            if not text(anchor.get("claimId"), 180):
                invalid("史料錨點缺少主張 ID")
        elif not text(anchor.get("recordId"), 180) or anchor["recordId"] not in value["recordIds"] or not isinstance(anchor.get("field"), str) or anchor["field"] not in {"deepAnalysis", "analysis", "soulEssence", "desc"} or type(anchor.get("start")) is not int or type(anchor.get("end")) is not int or not 0 <= anchor["start"] < anchor["end"] <= 10000000 or anchor["end"] - anchor["start"] > 2400:
            invalid("人物原文錨點或字元範圍不正確")


def validate_workspace(value: Any) -> Any:
    if value is None:
        return None
    json_safe(value)
    if not isinstance(value, dict) or set(value) - WORKSPACE_FIELDS or value.get("format") != FORMAT or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
        invalid("不支援的世界資料版本；原始資料仍保留")
    sessions = value.get("sessions")
    if not isinstance(sessions, list) or len(sessions) > 12 or not isinstance(value.get("selection"), dict):
        invalid("世界存檔最多 12 份，且必須包含共用背景")
    validate_selection(value["selection"])
    ids = set()
    for session in sessions:
        if not isinstance(session, dict) or set(session) != SESSION_FIELDS:
            invalid("世界存檔欄位不完整或含未支援欄位")
        if not text(session["id"], 180) or session["id"] in ids or not text(session["title"], 300) or not date(session["updatedAt"]) or not isinstance(session["save"], dict):
            invalid("世界存檔格式不正確")
        save = session["save"]
        if set(save) != {"format", "version", "state"} or save.get("format") != "dynasty-world-save" or type(save.get("version")) is not int or save["version"] != 1 or not isinstance(save.get("state"), dict):
            invalid("不支援的世界引擎存檔版本")
        validate_narratives(session["narratives"])
        ids.add(session["id"])
    if "activeSessionId" not in value or value["activeSessionId"] is not None and (not isinstance(value["activeSessionId"], str) or value["activeSessionId"] not in ids):
        invalid("目前世界存檔不存在")
    if "notes" in value and not text(value["notes"], 500000, empty=True):
        invalid("世界筆記格式不正確")
    if "narratives" in value:
        validate_narratives(value["narratives"])
    if len(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")) > MAX_BYTES - 100:
        raise HTTPException(status_code=413, detail="世界資料超出 8 MiB，請先匯出部分存檔")
    return value


def valid_revision(value: Any) -> bool:
    return type(value) is int and 0 <= value <= MAX_REVISION


def load_workspace(collection) -> dict[str, Any]:
    document = collection.find_one({"_id": "main"})
    if document is None:
        return {"revision": 0, "workspace": None}
    revision = document.get("revision", 0)
    if not valid_revision(revision):
        raise HTTPException(status_code=409, detail="雲端版本號無法辨識，請先保留原資料")
    # Deliberately no normalization: clients can export every future field.
    return {"revision": revision, "workspace": document.get("workspace")}


def save_workspace(collection, body: Any) -> dict[str, Any]:
    if not isinstance(body, dict) or set(body) != {"revision", "workspace"} or not valid_revision(body["revision"]):
        invalid("需要有效 revision 與完整 workspace")
    workspace = validate_workspace(body["workspace"])
    existing = collection.find_one({"_id": "main"})
    if existing is not None:
        try:
            validate_workspace(existing.get("workspace"))
        except HTTPException as error:
            raise HTTPException(status_code=409, detail="雲端含較新或無法驗證的世界資料，已保留原件並停止覆寫") from error
        if not valid_revision(existing.get("revision", 0)):
            raise HTTPException(status_code=409, detail="雲端版本號無法辨識")
    expected = body["revision"]
    query = {"_id": "main", "revision": expected}
    if expected == 0:
        query = {"_id": "main", "$or": [{"revision": 0}, {"revision": {"$exists": False}}]}
    if existing is not None:
        query["workspace"] = existing.get("workspace")
    try:
        result = collection.update_one(query, {"$set": {"workspace": workspace}, "$inc": {"revision": 1}}, upsert=expected == 0 and existing is None)
    except DuplicateKeyError as error:
        raise HTTPException(status_code=409, detail="雲端世界已由另一個視窗建立或更新；兩份進度需先比較") from error
    if result.matched_count == 0 and result.upserted_id is None:
        raise HTTPException(status_code=409, detail="雲端世界版本已更新；本機進度仍保留")
    return {"status": "ok", "revision": expected + 1}


def create_router(collection, verify_token) -> APIRouter:
    router = APIRouter()

    @router.get("/api/world-workspace")
    def get_workspace(x_app_token: Optional[str] = Header(None)):
        verify_token(x_app_token)
        return load_workspace(collection)

    @router.post("/api/world-workspace")
    async def post_workspace(request: Request, x_app_token: Optional[str] = Header(None)):
        verify_token(x_app_token)
        size = 0
        chunks = []
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BYTES:
                raise HTTPException(status_code=413, detail="世界資料超出 8 MiB，請先匯出部分存檔")
            chunks.append(chunk)
        try:
            def bad_number(_):
                raise ValueError("non-finite number")

            def unique_keys(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError("duplicate JSON key")
                    result[key] = value
                return result

            body = json.loads(b"".join(chunks), parse_constant=bad_number, object_pairs_hook=unique_keys)
        except (ValueError, UnicodeError, RecursionError) as error:
            raise HTTPException(status_code=422, detail="世界資料不是有效 JSON") from error
        return await run_in_threadpool(save_workspace, collection, body)

    return router
