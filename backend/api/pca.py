"""
PCA inspection endpoints — scree plot data and npcs persistence.
"""

from pathlib import Path
import numpy as np
import h5py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


@router.get("/scree")
def scree_data(base_dir: str):
    """
    Return explained variance data from _pca/pca.h5 for the scree plot.
    """
    pca_file = Path(base_dir) / "_pca" / "pca.h5"
    if not pca_file.exists():
        raise HTTPException(status_code=404, detail="PCA model not found. Run PCA first.")

    with h5py.File(str(pca_file), "r") as f:
        evr = f["explained_variance_ratio"][:].tolist()
        ev  = f["explained_variance"][:].tolist()

    cumulative = float(0)
    cumulative_evr = []
    for v in evr:
        cumulative += v
        cumulative_evr.append(round(cumulative, 6))

    return {
        "explained_variance_ratio": evr,
        "explained_variance": ev,
        "cumulative_variance_ratio": cumulative_evr,
        "n_components": len(evr),
    }


class SetNpcsRequest(BaseModel):
    base_dir: str
    npcs: int


@router.post("/npcs")
def set_npcs(req: SetNpcsRequest):
    """Persist npcs selection into config.yaml."""
    import ruamel.yaml as yaml

    config_path = Path(req.base_dir) / "config.yaml"
    config = {}
    if config_path.exists():
        with open(config_path) as f:
            config = yaml.safe_load(f) or {}

    config["npcs"] = req.npcs

    with open(config_path, "w") as f:
        yaml.safe_dump(config, f)

    return {"ok": True, "npcs": req.npcs}
