"""
Mock backend — no moseq2 required.
Returns realistic sample data for every endpoint so the frontend
can be developed and previewed independently.

Run with:
    python3 backend/mock_main.py
Then in another terminal:
    npm run dev
"""

import asyncio
import base64
import io
import math
import time
import argparse

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="MoSeq Desktop — Mock Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _fake_base64_png(width=512, height=424, with_roi=True) -> str:
    """Generate a synthetic depth-like grayscale frame with a circular ROI overlay."""
    from PIL import Image, ImageDraw

    # Simulate a depth image: gradient background with bucket floor
    frame = np.zeros((height, width), dtype=np.uint8)
    cx, cy = width // 2, height // 2
    for y in range(height):
        for x in range(width):
            d = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            frame[y, x] = int(max(0, min(255, 180 - d * 0.25)))

    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rgba[:, :, 0] = frame
    rgba[:, :, 1] = frame
    rgba[:, :, 2] = frame
    rgba[:, :, 3] = 255

    if with_roi:
        roi_r = min(width, height) // 2 - 40
        for y in range(height):
            for x in range(width):
                if math.sqrt((x - cx) ** 2 + (y - cy) ** 2) < roi_r:
                    rgba[y, x, 0] = int(frame[y, x] * 0.6)
                    rgba[y, x, 1] = min(255, int(frame[y, x] * 0.6) + 120)
                    rgba[y, x, 2] = int(frame[y, x] * 0.6)

    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _scree_data(n=10):
    """Realistic exponentially decaying explained variance."""
    raw = np.array([math.exp(-0.5 * i) for i in range(n)], dtype=float)
    raw /= raw.sum()
    cumulative = np.cumsum(raw).tolist()
    return {
        "explained_variance_ratio": raw.tolist(),
        "explained_variance": (raw * 1000).tolist(),
        "cumulative_variance_ratio": cumulative,
        "n_components": n,
    }


MOCK_SESSIONS = [
    {"uuid": "uuid-001", "name": "session_saline_01",   "subject": "mouse_01", "group": "saline",      "extracted": True},
    {"uuid": "uuid-002", "name": "session_saline_02",   "subject": "mouse_02", "group": "saline",      "extracted": True},
    {"uuid": "uuid-003", "name": "session_saline_03",   "subject": "mouse_03", "group": "saline",      "extracted": True},
    {"uuid": "uuid-004", "name": "session_amphet_01",   "subject": "mouse_04", "group": "amphetamine", "extracted": True},
    {"uuid": "uuid-005", "name": "session_amphet_02",   "subject": "mouse_05", "group": "amphetamine", "extracted": True},
    {"uuid": "uuid-006", "name": "session_amphet_03",   "subject": "mouse_06", "group": "amphetamine", "extracted": False},
]

MOCK_SCAN_RESULTS = {
    "kappas":                [10000, 31623, 100000, 316228, 1000000, 3162278, 10000000],
    "median_loglikelihoods": [-2.18, -1.94, -1.72,  -1.54,   -1.63,   -1.81,    -2.03],
    "mean_durations":        [ 0.18,  0.27,  0.41,   0.54,    0.70,    0.91,     1.18],
    "model_paths":           [f"/mock/project/_model/scan/model_kappa{k}.p"
                              for k in [10000, 31623, 100000, 316228, 1000000, 3162278, 10000000]],
    "best_kappa_idx":        3,
    "best_kappa":            316228,
    "changepoint_duration":  0.52,
}

MOCK_LOGS = {
    "extract": [
        "Scanning base directory...",
        "Found 6 session(s) to extract.",
        "Processing: session_saline_01/depth.dat",
        "Getting background...",
        "Automatically setting depth range.",
        "Getting roi...",
        "Detected true depth: 693.0",
        "Extracting frames [########--------] 50%",
        "Extracting frames [################] 100%",
        "  ✓ session_saline_01",
        "Processing: session_saline_02/depth.dat",
        "Getting background...",
        "Getting roi...",
        "Detected true depth: 701.0",
        "Extracting frames [################] 100%",
        "  ✓ session_saline_02",
        "All sessions extracted successfully.",
    ],
    "aggregate": [
        "Aggregating extraction results...",
        "Found 5 completed extraction(s).",
        "Copying session_saline_01_results_00.h5...",
        "Copying session_saline_02_results_00.h5...",
        "Copying session_saline_03_results_00.h5...",
        "Copying session_amphet_01_results_00.h5...",
        "Copying session_amphet_02_results_00.h5...",
        "Results successfully aggregated in aggregate_results/",
        "Number of sessions included in index file: 5",
        "Index file path: moseq2-index.yaml",
        "Applied 5 staged group assignment(s) to index.",
    ],
    "pca": [
        "Loading extraction data...",
        "Found 5 session(s)",
        "Access dask dashboard at http://localhost:8787",
        "Dataset size: 1.24GB",
        "Setting number of workers to: 4",
        "Overriding memory per worker to 3.2GB",
        "Training PCA (rank=10)...",
        "[########--------] training SVD  50%",
        "[################] training SVD 100%",
        "PCA training complete.",
        "Applying PCA to 5 session(s)...",
        "Computing scores: 100%|██████████| 5/5",
        "  [uuid-001] shape=(18432, 10), NaN frames=0.2%",
        "  [uuid-002] shape=(17901, 10), NaN frames=0.1%",
        "  [uuid-003] shape=(18100, 10), NaN frames=0.3%",
        "  [uuid-004] shape=(17650, 10), NaN frames=0.1%",
        "  [uuid-005] shape=(18200, 10), NaN frames=0.4%",
        "PCA scores complete.",
        "Computing changepoints...",
        "Changepoints complete.",
    ],
    "model": [
        "Training AR-HMM (K=100, 100 iterations)...",
        "Training ARHMM:   0%|          | 0/100",
        "Training ARHMM:  50%|█████     | 50/100",
        "Training ARHMM: 100%|██████████| 100/100",
        "Model saved: _model/model_k100.p",
    ],
    "model-scan": [
        "Kappa scan: 7 models, range [1e+04, 1e+07], 100 iters each",
        "",
        "[1/7] kappa=10,000",
        "Training ARHMM:   0%|          | 0/100",
        "Training ARHMM: 100%|██████████| 100/100",
        "  median log-lik=-2.1800  mean_dur=0.180s",
        "",
        "[2/7] kappa=31,623",
        "Training ARHMM:   0%|          | 0/100",
        "Training ARHMM: 100%|██████████| 100/100",
        "  median log-lik=-1.9400  mean_dur=0.270s",
        "",
        "[3/7] kappa=100,000",
        "Training ARHMM:   0%|          | 0/100",
        "Training ARHMM: 100%|██████████| 100/100",
        "  median log-lik=-1.7200  mean_dur=0.410s",
        "",
        "[4/7] kappa=316,228",
        "Training ARHMM:   0%|          | 0/100",
        "Training ARHMM: 100%|██████████| 100/100",
        "  median log-lik=-1.5400  mean_dur=0.540s",
        "",
        "[5/7] kappa=1,000,000",
        "Training ARHMM:   0%|          | 0/100",
        "Training ARHMM: 100%|██████████| 100/100",
        "  median log-lik=-1.6300  mean_dur=0.700s",
        "",
        "[6/7] kappa=3,162,278",
        "Training ARHMM:   0%|          | 0/100",
        "Training ARHMM: 100%|██████████| 100/100",
        "  median log-lik=-1.8100  mean_dur=0.910s",
        "",
        "[7/7] kappa=10,000,000",
        "Training ARHMM:   0%|          | 0/100",
        "Training ARHMM: 100%|██████████| 100/100",
        "  median log-lik=-2.0300  mean_dur=1.180s",
        "",
        "Scan complete. Best kappa = 316,228",
    ],
    "model-final": [
        "Training final AR-HMM  kappa=316228  K=100  1000 iterations",
        "Output: _model/model_kappa316228_final.p",
        "Entering modeling training",
        "Training ARHMM:   0%|          | 0/1000",
        "Training ARHMM:  10%|█         | 100/1000",
        "Training ARHMM:  20%|██        | 200/1000",
        "Training ARHMM:  30%|███       | 300/1000",
        "Training ARHMM:  40%|████      | 400/1000",
        "Training ARHMM:  50%|█████     | 500/1000",
        "Training ARHMM:  60%|██████    | 600/1000",
        "Training ARHMM:  70%|███████   | 700/1000",
        "Training ARHMM:  80%|████████  | 800/1000",
        "Training ARHMM:  90%|█████████ | 900/1000",
        "Training ARHMM: 100%|██████████| 1000/1000",
        "Final model saved: _model/model_kappa316228_final.p",
    ],
    "analyze": [
        "Analysis step coming soon.",
    ],
}


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "mock": True}


# Project
@app.post("/project/open")
def open_project(req: dict):
    return {
        "state": {
            "base_dir": req.get("path", "/mock/project"),
            "sessions": [
                {
                    "name": s["name"],
                    "path": f"/mock/project/{s['name']}",
                    "has_depth": True,
                    "extracted": s["extracted"],
                    "extraction_path": f"/mock/project/{s['name']}/proc" if s["extracted"] else None,
                }
                for s in MOCK_SESSIONS
            ],
            "aggregated": True,
            "pca_trained": True,
            "pca_applied": True,
            "changepoints_computed": True,
            "model_trained": False,
            "model_applied": False,
            "selected_model": None,
        },
        "config": {
            "pca_components": 10,
            "npcs": 7,
            "num_syllables": 100,
            "num_iter": 100,
            "fps": 30,
            "min_height": 10,
            "max_height": 100,
        }
    }


@app.get("/project/scan")
def scan_project(path: str):
    return (app.routes[0].endpoint)({"path": path})["state"]


@app.get("/project/sessions")
def get_sessions(path: str):
    return [
        {
            "name": s["name"],
            "path": f"{path}/{s['name']}",
            "has_depth": True,
            "extracted": s["extracted"],
            "extraction_path": f"{path}/{s['name']}/proc" if s["extracted"] else None,
            "metadata": {"SessionName": s["name"], "SubjectName": s["subject"]},
        }
        for s in MOCK_SESSIONS
    ]


@app.post("/project/config")
def update_config(req: dict):
    return {"ok": True}


# Sessions / groups
@app.get("/sessions/list")
def list_sessions(base_dir: str):
    return [
        {
            "uuid": s["uuid"],
            "session_name": s["name"],
            "subject_name": s["subject"],
            "group": s["group"],
            "has_index": True,
        }
        for s in MOCK_SESSIONS
    ]


@app.post("/sessions/groups")
def update_groups(req: dict):
    return {"ok": True}


@app.get("/sessions/groups/unique")
def unique_groups(base_dir: str):
    return ["saline", "amphetamine"]


# ROI
@app.post("/roi/preview")
def roi_preview(req: dict):
    return {
        "composite": _fake_base64_png(with_roi=True),
        "frame": _fake_base64_png(with_roi=False),
        "shape": [424, 512],
        "detected_depth_range": [650, 750],
    }


@app.post("/roi/save")
def roi_save(req: dict):
    return {"ok": True}


@app.get("/roi/session_config")
def get_session_config(base_dir: str):
    return {
        "session_saline_01": {"bg_roi_depth_range": [650, 750]},
        "session_amphet_01": {"bg_roi_depth_range": [660, 760]},
    }


# PCA
@app.get("/pca/scree")
def scree(base_dir: str):
    return _scree_data(n=10)


@app.post("/pca/npcs")
def set_npcs(req: dict):
    return {"ok": True, "npcs": req.get("npcs", 10)}


# Model
@app.get("/model/scan/results")
def model_scan_results(base_dir: str):
    return MOCK_SCAN_RESULTS


# Pipeline — run / cancel / status
@app.post("/pipeline/{step}/run")
def run_step(step: str, req: dict):
    return {"ok": True, "step": step}


@app.post("/pipeline/{step}/cancel")
def cancel_step(step: str):
    return {"ok": True}


@app.get("/pipeline/{step}/status")
def step_status(step: str):
    return {"status": "idle"}


# Pipeline — WebSocket log streaming
@app.websocket("/pipeline/{step}/logs")
async def stream_logs(websocket: WebSocket, step: str):
    await websocket.accept()
    lines = MOCK_LOGS.get(step, [f"Running {step}..."])
    try:
        for line in lines:
            await asyncio.sleep(0.25)
            await websocket.send_json({"type": "log", "text": line})
        await asyncio.sleep(0.3)
        await websocket.send_json({"type": "done", "success": True})
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    print(f"Mock backend running on http://localhost:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
