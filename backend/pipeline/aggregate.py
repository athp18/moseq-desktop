"""
Aggregation runner.
Calls aggregate_extract_results_wrapper to copy proc/ results into
aggregate_results/ and generate moseq2-index.yaml.
"""

import asyncio
from pathlib import Path

from pipeline.capture import capture_to_queue
from pipeline.scanner import read_config


def _do_aggregate(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from moseq2_extract.helpers.wrappers import aggregate_extract_results_wrapper

    file_config = read_config(base_dir)
    merged = {**file_config, **config}

    output_dir = str(Path(base_dir) / "aggregate_results")
    fmt = merged.get("aggregate_format", "{session_name}_{start_time}")

    queue.put_nowait({"type": "log", "text": "Aggregating extraction results..."})

    with capture_to_queue(queue):
        try:
            index_path = aggregate_extract_results_wrapper(
                input_dir=base_dir,
                format=fmt,
                output_dir=output_dir,
            )
            queue.put_nowait({"type": "log", "text": f"Index written to: {index_path}"})
        except Exception as e:
            queue.put_nowait({"type": "done", "success": False, "detail": str(e)})
            return

    # Apply any staged group assignments now that the index exists
    _apply_staged_groups(base_dir, queue)

    queue.put_nowait({"type": "done", "success": True})


def _apply_staged_groups(base_dir: str, queue: asyncio.Queue) -> None:
    staged_path = Path(base_dir) / "group_assignments.yaml"
    index_path = Path(base_dir) / "moseq2-index.yaml"
    if not staged_path.exists() or not index_path.exists():
        return

    import ruamel.yaml as yaml

    with open(staged_path) as f:
        staged = yaml.safe_load(f) or {}
    with open(index_path) as f:
        index = yaml.safe_load(f)

    applied = 0
    for entry in index.get("files", []):
        uuid = entry.get("uuid", "")
        name = entry.get("metadata", {}).get("SessionName", "")
        group = staged.get(uuid) or staged.get(name)
        if group:
            entry["group"] = group
            applied += 1

    if applied:
        with open(index_path, "w") as f:
            yaml.safe_dump(index, f)
        queue.put_nowait({"type": "log", "text": f"Applied {applied} staged group assignment(s) to index."})
        staged_path.unlink()


async def run(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    await asyncio.to_thread(_do_aggregate, base_dir, config, queue)
