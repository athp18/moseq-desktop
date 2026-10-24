from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pipeline.scanner import (
    scan, read_config, write_config,
    read_session_metadata, write_session_metadata
)

router = APIRouter()


class OpenProjectRequest(BaseModel):
    path: str


class UpdateConfigRequest(BaseModel):
    path: str
    config: dict


class UpdateSessionMetaRequest(BaseModel):
    session_path: str
    metadata: dict


@router.post("/open")
def open_project(req: OpenProjectRequest):
    try:
        state = scan(req.path)
        config = read_config(req.path)
        return {"state": state, "config": config}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/scan")
def scan_project(path: str):
    try:
        return scan(path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/config")
def update_config(req: UpdateConfigRequest):
    try:
        write_config(req.path, req.config)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/sessions")
def get_sessions(path: str):
    try:
        state = scan(path)
        sessions = []
        for s in state["sessions"]:
            meta = read_session_metadata(s["path"])
            sessions.append({**s, "metadata": meta})
        return sessions
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sessions/metadata")
def update_session_metadata(req: UpdateSessionMetaRequest):
    try:
        write_session_metadata(req.session_path, req.metadata)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
