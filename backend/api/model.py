"""Model endpoints — kappa scan results."""

import json
import math
from pathlib import Path
from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/scan/results")
def get_scan_results(base_dir: str):
    results_file = Path(base_dir) / "_model" / "scan" / "scan_results.json"
    if not results_file.exists():
        raise HTTPException(status_code=404, detail="No scan results found. Run a kappa scan first.")
    try:
        data = json.loads(results_file.read_text())
        # Replace NaN (not valid JSON) with None
        def clean(v):
            if isinstance(v, float) and math.isnan(v):
                return None
            return v
        data["median_loglikelihoods"] = [clean(x) for x in data.get("median_loglikelihoods", [])]
        data["mean_durations"] = [clean(x) for x in data.get("mean_durations", [])]
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
