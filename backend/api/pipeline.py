"""
Pipeline step endpoints.
Each step runs as a background task and streams logs over WebSocket.
Steps write a .done sentinel on completion.
"""

import asyncio
from pathlib import Path
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel

router = APIRouter()

# In-memory job registry: step_name -> asyncio.Task
_running: dict[str, asyncio.Task] = {}
_log_queues: dict[str, asyncio.Queue] = {}


class RunStepRequest(BaseModel):
    base_dir: str
    config: dict = {}


def _emit(queue: asyncio.Queue, line: str) -> None:
    try:
        queue.put_nowait({"type": "log", "text": line})
    except asyncio.QueueFull:
        pass


def _done(queue: asyncio.Queue, success: bool, detail: str = "") -> None:
    queue.put_nowait({"type": "done", "success": success, "detail": detail})


async def _run_extract(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from pipeline import extract
    await extract.run(base_dir, config, queue)


async def _run_aggregate(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from pipeline import aggregate
    await aggregate.run(base_dir, config, queue)


async def _run_pca(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from pipeline import pca
    await pca.run(base_dir, config, queue)


async def _run_model(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from pipeline import model
    await model.run(base_dir, config, queue)


async def _run_analyze(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from pipeline import analyze
    await analyze.run(base_dir, config, queue)


async def _run_model_scan(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from pipeline import model
    await model.run_scan(base_dir, config, queue)


async def _run_model_final(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from pipeline import model
    await model.run_final(base_dir, config, queue)


_STEP_RUNNERS = {
    "extract": _run_extract,
    "aggregate": _run_aggregate,
    "pca": _run_pca,
    "model": _run_model,
    "model-scan": _run_model_scan,
    "model-final": _run_model_final,
    "analyze": _run_analyze,
}


@router.post("/{step}/run")
async def run_step(step: str, req: RunStepRequest):
    if step not in _STEP_RUNNERS:
        raise HTTPException(status_code=404, detail=f"Unknown step: {step}")
    if step in _running and not _running[step].done():
        raise HTTPException(status_code=409, detail=f"{step} is already running")

    queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
    _log_queues[step] = queue

    async def task():
        try:
            await _STEP_RUNNERS[step](req.base_dir, req.config, queue)
        except Exception as e:
            _done(queue, success=False, detail=str(e))

    _running[step] = asyncio.create_task(task())
    return {"ok": True, "step": step}


@router.post("/{step}/cancel")
async def cancel_step(step: str):
    task = _running.get(step)
    if task and not task.done():
        task.cancel()
        return {"ok": True}
    return {"ok": False, "detail": "No running task"}


@router.get("/{step}/status")
def step_status(step: str):
    task = _running.get(step)
    if task is None:
        return {"status": "idle"}
    if not task.done():
        return {"status": "running"}
    if task.cancelled():
        return {"status": "cancelled"}
    if task.exception():
        return {"status": "error", "detail": str(task.exception())}
    return {"status": "done"}


@router.websocket("/{step}/logs")
async def stream_logs(websocket: WebSocket, step: str):
    await websocket.accept()
    queue = _log_queues.get(step)
    if queue is None:
        await websocket.send_json({"type": "error", "text": "No active job for this step"})
        await websocket.close()
        return

    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=30.0)
                await websocket.send_json(msg)
                if msg.get("type") == "done":
                    break
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
