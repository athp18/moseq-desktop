"""
Scans a moseq base directory and infers pipeline state from file existence.
No progress.yaml required — state is derived entirely from the directory layout.
"""

from pathlib import Path
from typing import TypedDict, Literal, Optional
import json
import yaml

StepStatus = Literal["not_started", "incomplete", "complete", "running"]


class SessionState(TypedDict):
    name: str
    path: str
    has_depth: bool
    extracted: bool
    extraction_path: Optional[str]


class PipelineState(TypedDict):
    base_dir: str
    sessions: list[SessionState]
    aggregated: bool
    pca_trained: bool
    pca_applied: bool
    changepoints_computed: bool
    model_trained: bool
    model_applied: bool
    selected_model: Optional[str]


def _sentinel(path: Path) -> bool:
    return (path / ".done").exists()


def _session_state(session_dir: Path) -> SessionState:
    proc = session_dir / "proc"
    extracted = _sentinel(proc) if proc.exists() else False

    return SessionState(
        name=session_dir.name,
        path=str(session_dir),
        has_depth=(session_dir / "depth.dat").exists()
            or any(session_dir.glob("*.avi"))
            or any(session_dir.glob("*.mkv"))
            or any(session_dir.glob("*.tar.gz")),
        extracted=extracted,
        extraction_path=str(proc) if extracted else None,
    )


def scan(base_dir: str) -> PipelineState:
    base = Path(base_dir)

    # Sessions: subdirs that contain depth data or a proc/ folder
    sessions = []
    for d in sorted(base.iterdir()):
        if not d.is_dir():
            continue
        if d.name.startswith(("_", ".", "aggregate_results")):
            continue
        state = _session_state(d)
        if state["has_depth"] or state["extracted"]:
            sessions.append(state)

    aggregate = base / "aggregate_results"
    pca_dir = base / "_pca"

    # Find selected model
    selected_model_file = base / ".selected_model"
    selected_model = selected_model_file.read_text().strip() if selected_model_file.exists() else None

    # Infer model training: any model.p anywhere under base
    model_trained = bool(list(base.rglob("model*.p")))

    return PipelineState(
        base_dir=str(base),
        sessions=sessions,
        aggregated=aggregate.exists() and any(aggregate.glob("*.h5")),
        pca_trained=(pca_dir / "pca.h5").exists(),
        pca_applied=(pca_dir / "pca_scores.h5").exists(),
        changepoints_computed=(pca_dir / "changepoints.h5").exists(),
        model_trained=model_trained,
        model_applied=bool(selected_model),
        selected_model=selected_model,
    )


def read_config(base_dir: str) -> dict:
    config_path = Path(base_dir) / "config.yaml"
    if not config_path.exists():
        return {}
    with open(config_path) as f:
        return yaml.safe_load(f) or {}


def write_config(base_dir: str, config: dict) -> None:
    config_path = Path(base_dir) / "config.yaml"
    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False)


def read_session_metadata(session_path: str) -> dict:
    meta_path = Path(session_path) / "metadata.json"
    if not meta_path.exists():
        return {}
    with open(meta_path) as f:
        return json.load(f)


def write_session_metadata(session_path: str, metadata: dict) -> None:
    meta_path = Path(session_path) / "metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
