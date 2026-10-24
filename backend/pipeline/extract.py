"""
Extraction runner.
Calls moseq2_extract.helpers.wrappers.extract_wrapper directly,
bypassing the CLI. Iterates over all unextracted sessions in base_dir.
"""

import asyncio
from pathlib import Path

from pipeline.capture import capture_to_queue
from pipeline.scanner import read_config, scan


DEPTH_EXTENSIONS = (".dat", ".avi", ".mkv", ".tar.gz")


def _find_depth_file(session_dir: Path) -> Path | None:
    for ext in DEPTH_EXTENSIONS:
        candidates = list(session_dir.glob(f"*{ext}"))
        candidates = [c for c in candidates if 'depth' in candidates] # filter out ir.avi
        if candidates:
            return candidates[0]
    return None


def _do_extract(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from moseq2_extract.helpers.wrappers import extract_wrapper
    from moseq2_extract.util import read_yaml

    base = Path(base_dir)

    # Merge file config with any overrides passed from the UI
    file_config = read_config(base_dir)
    merged = {**file_config, **config}

    # Load per-session config if present
    session_config_path = base / "session_config.yaml"
    session_configs: dict = {}
    if session_config_path.exists():
        session_configs = read_yaml(str(session_config_path)) or {}

    state = scan(base_dir)
    sessions_to_run = [s for s in state["sessions"] if not s["extracted"] and s["has_depth"]]

    if not sessions_to_run:
        queue.put_nowait({"type": "log", "text": "All sessions already extracted."})
        queue.put_nowait({"type": "done", "success": True})
        return

    queue.put_nowait({"type": "log", "text": f"Extracting {len(sessions_to_run)} session(s)..."})

    with capture_to_queue(queue):
        for session in sessions_to_run:
            session_dir = Path(session["path"])
            depth_file = _find_depth_file(session_dir)
            if depth_file is None:
                queue.put_nowait({"type": "log", "text": f"  Skipping {session['name']}: no depth file found"})
                continue

            # Per-session config overrides global config
            session_cfg = {**merged, **session_configs.get(session["name"], {})}

            output_dir = str(session_dir / "proc")

            try:
                extract_wrapper(
                    input_file=str(depth_file),
                    output_dir=output_dir,
                    config_data=session_cfg,
                    skip=False,
                )
                # Write sentinel on successful extraction
                (Path(output_dir) / ".done").touch()
                queue.put_nowait({"type": "log", "text": f"  ✓ {session['name']}"})
            except Exception as e:
                queue.put_nowait({"type": "log", "text": f"  ✗ {session['name']}: {e}"})
                queue.put_nowait({"type": "done", "success": False, "detail": str(e)})
                return

    queue.put_nowait({"type": "done", "success": True})


async def run(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    await asyncio.to_thread(_do_extract, base_dir, config, queue)
