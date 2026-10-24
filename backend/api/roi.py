"""
ROI preview and configuration endpoints.
Returns base64-encoded PNG composites of first_frame + ROI overlay
so the frontend can display them without any file system access.
"""

import base64
import io
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


# ── Image helpers ────────────────────────────────────────────────────────────

def _to_uint8(arr: np.ndarray) -> np.ndarray:
    """Normalise any numeric array to 0-255 uint8."""
    arr = arr.astype(np.float32)
    lo, hi = arr.min(), arr.max()
    if hi > lo:
        arr = (arr - lo) / (hi - lo)
    return (arr * 255).clip(0, 255).astype(np.uint8)


def _composite_png(frame: np.ndarray, roi: np.ndarray) -> str:
    """
    Blend first_frame (grayscale) with ROI mask (green overlay).
    Returns a base64-encoded PNG string.
    """
    from PIL import Image

    gray = _to_uint8(frame)
    h, w = gray.shape

    # RGBA canvas
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, 0] = gray
    rgba[:, :, 1] = gray
    rgba[:, :, 2] = gray
    rgba[:, :, 3] = 255

    # ROI pixels: tint green at 40% opacity
    mask = roi > 0
    rgba[mask, 0] = (gray[mask] * 0.6).astype(np.uint8)
    rgba[mask, 1] = np.clip(gray[mask] * 0.6 + 120, 0, 255).astype(np.uint8)
    rgba[mask, 2] = (gray[mask] * 0.6).astype(np.uint8)

    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _frame_png(frame: np.ndarray) -> str:
    from PIL import Image
    gray = _to_uint8(frame)
    img = Image.fromarray(gray, "L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ── Routes ───────────────────────────────────────────────────────────────────

class ROIPreviewRequest(BaseModel):
    session_path: str
    base_dir: str
    config: dict = {}


class ROISaveRequest(BaseModel):
    base_dir: str
    session_name: str
    config: dict


@router.post("/preview")
def roi_preview(req: ROIPreviewRequest):
    """
    Return first_frame + ROI overlay as base64 PNG.
    If proc/ already has the tiff files, reads them.
    Otherwise runs get_roi_wrapper to compute them.
    """
    from moseq2_extract.io.image import read_image

    session_dir = Path(req.session_path)
    proc_dir = session_dir / "proc"

    first_frame_tiff = proc_dir / "first_frame.tiff"
    bground_tiff = proc_dir / "bground.tiff"
    roi_tiff = proc_dir / "roi_00.tiff"

    if first_frame_tiff.exists() and roi_tiff.exists():
        # Fast path: files already exist from a previous extraction or preview
        first_frame = read_image(str(first_frame_tiff))
        roi = read_image(str(roi_tiff))
        bground = read_image(str(bground_tiff)) if bground_tiff.exists() else first_frame
        detected_depth_range = None
    else:
        # Compute: find depth file, run get_roi_wrapper
        from pipeline.scanner import read_config
        from moseq2_extract.helpers.wrappers import get_roi_wrapper

        depth_extensions = (".dat", ".avi", ".mkv")
        depth_file = None
        for ext in depth_extensions:
            candidates = list(session_dir.glob(f"*{ext}"))
            if candidates:
                depth_file = str(candidates[0])
                break
        # .tar.gz needs special glob
        if depth_file is None:
            candidates = list(session_dir.glob("*.tar.gz"))
            if candidates:
                depth_file = str(candidates[0])

        if depth_file is None:
            raise HTTPException(status_code=404, detail="No depth file found in session directory")

        file_config = read_config(req.base_dir)
        config = {**file_config, **req.config}

        try:
            proc_dir.mkdir(exist_ok=True)
            roi, bground, first_frame = get_roi_wrapper(
                input_file=depth_file,
                config_data=config,
                output_dir=str(proc_dir),
            )
            detected_depth_range = config.get("bg_roi_depth_range")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    composite = _composite_png(first_frame, roi)
    frame_only = _frame_png(first_frame)

    return {
        "composite": composite,      # first_frame + green ROI overlay
        "frame": frame_only,         # raw first frame for reference
        "shape": list(first_frame.shape),
        "detected_depth_range": detected_depth_range,
    }


@router.post("/save")
def roi_save(req: ROISaveRequest):
    """Save per-session ROI config to session_config.yaml."""
    import ruamel.yaml as yaml

    base = Path(req.base_dir)
    session_config_path = base / "session_config.yaml"

    # Load existing or start fresh
    if session_config_path.exists():
        with open(session_config_path) as f:
            existing = yaml.safe_load(f) or {}
    else:
        existing = {}

    existing[req.session_name] = req.config

    with open(session_config_path, "w") as f:
        yaml.safe_dump(existing, f)

    return {"ok": True}


@router.get("/session_config")
def get_session_config(base_dir: str):
    """Return the full session_config.yaml as a dict."""
    import ruamel.yaml as yaml

    path = Path(base_dir) / "session_config.yaml"
    if not path.exists():
        return {}
    with open(path) as f:
        return yaml.safe_load(f) or {}
