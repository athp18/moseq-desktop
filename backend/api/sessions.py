"""
Session metadata and group assignment endpoints.
Groups live in moseq2-index.yaml under files[*].group.
If the index doesn't exist yet (pre-aggregation), we stage
assignments in group_assignments.yaml and apply them post-aggregation.
"""

from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import ruamel.yaml as yaml

router = APIRouter()


def _load_index(base_dir: str) -> Optional[dict]:
    path = Path(base_dir) / "moseq2-index.yaml"
    if not path.exists():
        return None
    with open(path) as f:
        return yaml.safe_load(f)


def _save_index(base_dir: str, index: dict) -> None:
    path = Path(base_dir) / "moseq2-index.yaml"
    with open(path, "w") as f:
        yaml.safe_dump(index, f)


def _load_staged(base_dir: str) -> dict:
    path = Path(base_dir) / "group_assignments.yaml"
    if not path.exists():
        return {}
    with open(path) as f:
        return yaml.safe_load(f) or {}


def _save_staged(base_dir: str, assignments: dict) -> None:
    path = Path(base_dir) / "group_assignments.yaml"
    with open(path, "w") as f:
        yaml.safe_dump(assignments, f)


def _session_rows(base_dir: str) -> list[dict]:
    """
    Returns a flat list of session dicts with fields:
      uuid, session_name, subject_name, group, has_index
    Sources: moseq2-index.yaml if present, else scans session dirs.
    """
    index = _load_index(base_dir)
    staged = _load_staged(base_dir)

    if index is not None:
        rows = []
        for entry in index.get("files", []):
            uuid = entry.get("uuid", "")
            meta = entry.get("metadata", {})
            rows.append({
                "uuid": uuid,
                "session_name": meta.get("SessionName", uuid),
                "subject_name": meta.get("SubjectName", ""),
                "group": entry.get("group", staged.get(uuid, "default")),
                "has_index": True,
            })
        return rows

    # Pre-aggregation: scan session dirs + metadata.json
    from pipeline.scanner import scan
    import json

    state = scan(base_dir)
    rows = []
    for s in state["sessions"]:
        meta_path = Path(s["path"]) / "metadata.json"
        meta = {}
        if meta_path.exists():
            with open(meta_path) as f:
                meta = json.load(f)

        uuid = meta.get("uuid", s["name"])
        rows.append({
            "uuid": uuid,
            "session_name": meta.get("SessionName", s["name"]),
            "subject_name": meta.get("SubjectName", ""),
            "group": staged.get(uuid, staged.get(s["name"], "default")),
            "has_index": False,
        })
    return rows


# ── Routes ───────────────────────────────────────────────────────────────────

class GroupUpdate(BaseModel):
    base_dir: str
    assignments: dict[str, str]  # uuid -> group label


@router.get("/list")
def list_sessions(base_dir: str):
    try:
        return _session_rows(base_dir)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/groups")
def update_groups(req: GroupUpdate):
    """
    Persist group assignments.
    If moseq2-index.yaml exists, writes directly into it.
    Otherwise stages in group_assignments.yaml for later.
    """
    try:
        index = _load_index(req.base_dir)

        if index is not None:
            for entry in index.get("files", []):
                uuid = entry.get("uuid", "")
                if uuid in req.assignments:
                    entry["group"] = req.assignments[uuid]
            _save_index(req.base_dir, index)
        else:
            # Stage for when aggregation runs
            existing = _load_staged(req.base_dir)
            existing.update(req.assignments)
            _save_staged(req.base_dir, existing)

        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/groups/unique")
def unique_groups(base_dir: str):
    """Return the list of distinct group labels currently in use."""
    try:
        rows = _session_rows(base_dir)
        seen = []
        for r in rows:
            g = r["group"]
            if g not in seen:
                seen.append(g)
        return seen
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
