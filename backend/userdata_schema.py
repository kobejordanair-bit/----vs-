"""Persisted user data and atomic, revision-checked updates.

This module has no environment or network initialization so the storage contract
can be tested independently from authentication and AI providers.
"""

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pymongo.errors import DuplicateKeyError


class UserDataState(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    customLegends: list[dict[str, Any]] = Field(default_factory=list)
    modifiedLegends: dict[str, Any] = Field(default_factory=dict)
    chatHistories: dict[str, Any] = Field(default_factory=dict)
    simulationHistory: list[dict[str, Any]] = Field(default_factory=list)
    discussionHistories: dict[str, Any] = Field(default_factory=dict)
    soulSaves: list[dict[str, Any]] = Field(default_factory=list)
    hegemonySavedSim: dict[str, Any] | None = None
    scenes: list[dict[str, Any]] = Field(default_factory=list)
    sceneEdits: dict[str, Any] = Field(default_factory=dict)
    soulSession: dict[str, Any] | None = None


PERSISTED_FIELDS = tuple(UserDataState.model_fields)


class UserDataSnapshot(UserDataState):
    revision: int = Field(default=0, ge=0, strict=True)


class UserDataRequest(UserDataState):
    revision: int = Field(ge=0, strict=True)

    @model_validator(mode="after")
    def require_data_patch(self):
        if not self.model_fields_set.intersection(PERSISTED_FIELDS):
            raise ValueError("至少提供一個資料欄位；revision 本身不能作為儲存內容")
        return self


def load_userdata(collection) -> dict[str, Any]:
    """Return every persisted field, including defaults for legacy documents."""
    document = collection.find_one({"_id": "main"}, {"_id": 0}) or {}
    known = {key: document[key] for key in PERSISTED_FIELDS if key in document}
    known["revision"] = document.get("revision", 0)
    snapshot = UserDataSnapshot.model_validate(known).model_dump()
    # Future/legacy fields remain visible for backup and are never removed by a
    # write from a client that only understands the ten current fields.
    return {**document, **snapshot}


def save_userdata_patch(collection, body: UserDataRequest) -> dict[str, Any]:
    """Patch only supplied fields, atomically checking the loaded revision."""
    patch = body.model_dump(exclude_unset=True, exclude={"revision"})
    expected_revision = body.revision
    query: dict[str, Any] = {"_id": "main"}
    if expected_revision == 0:
        query["$or"] = [
            {"revision": 0},
            {"revision": {"$exists": False}},
        ]
    else:
        query["revision"] = expected_revision

    # Defaults are added only for a genuinely new document. Existing documents
    # retain both omitted fields and any unknown stored fields.
    initial = {
        key: value
        for key, value in UserDataState().model_dump().items()
        if key not in patch
    }
    try:
        result = collection.update_one(
            query,
            {"$set": patch, "$inc": {"revision": 1}, "$setOnInsert": initial},
            upsert=expected_revision == 0,
        )
    except DuplicateKeyError as error:
        # A newer document with _id=main already exists, including when another
        # tab wins the race to create the first document.
        raise HTTPException(
            status_code=409,
            detail="雲端資料已被其他視窗更新，請先備份本機內容並重新載入雲端資料。",
        ) from error

    if result.matched_count == 0 and result.upserted_id is None:
        raise HTTPException(
            status_code=409,
            detail="雲端資料版本已變更，請先備份本機內容並重新載入雲端資料。",
        )
    return {"status": "ok", "revision": expected_revision + 1}
