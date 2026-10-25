"""
Analysis endpoints.
Reads _analysis/moseq_df.parquet and _analysis/stats_df.parquet
computed by the analyze pipeline step.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

ANALYSIS_DIR = "_analysis"


def _analysis_dir(base_dir: str) -> Path:
    return Path(base_dir) / ANALYSIS_DIR


def _load_parquet(base_dir: str, name: str) -> pd.DataFrame:
    p = _analysis_dir(base_dir) / f"{name}.parquet"
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"{name}.parquet not found — run Compute Analysis first")
    return pd.read_parquet(p)


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
def analyze_status(base_dir: str):
    d = _analysis_dir(base_dir)
    return {
        "moseq_df": (d / "moseq_df.parquet").exists(),
        "stats_df": (d / "stats_df.parquet").exists(),
        "groups": _load_groups(base_dir),
    }


def _load_groups(base_dir: str) -> list:
    try:
        stats = _load_parquet(base_dir, "stats_df")
        if "group" in stats.columns:
            return sorted(stats["group"].dropna().unique().tolist())
    except Exception:
        pass
    return []


# ── Syllable usage ─────────────────────────────────────────────────────────────

@router.get("/syllable_usage")
def syllable_usage(base_dir: str, n_syllables: int = 20):
    stats = _load_parquet(base_dir, "stats_df")

    if "usage" not in stats.columns:
        raise HTTPException(status_code=400, detail="stats_df has no 'usage' column")

    label_col = "syllable" if "syllable" in stats.columns else stats.columns[0]
    group_col = "group" if "group" in stats.columns else None

    # Mean usage per syllable per group
    by = [label_col] + ([group_col] if group_col else [])
    agg = stats.groupby(by)["usage"].mean().reset_index()

    # Pick top N by overall mean usage
    top_syls = (
        agg.groupby(label_col)["usage"].mean()
        .nlargest(n_syllables).index.tolist()
    )
    agg = agg[agg[label_col].isin(top_syls)]
    agg = agg.sort_values(label_col)

    groups = agg[group_col].unique().tolist() if group_col else ["all"]
    result: dict = {"syllables": [int(s) for s in top_syls], "groups": {}}

    for g in groups:
        subset = agg[agg[group_col] == g] if group_col else agg
        vals = []
        for s in top_syls:
            row = subset[subset[label_col] == s]
            vals.append(float(row["usage"].iloc[0]) if len(row) else 0.0)
        result["groups"][str(g)] = vals

    return result


# ── Scalars ───────────────────────────────────────────────────────────────────

SCALAR_COLS = [
    "velocity_2d_mm", "velocity_3d_mm", "height_ave_mm",
    "width_mm", "length_mm", "area_mm",
]

@router.get("/scalars")
def scalar_summary(base_dir: str):
    df = _load_parquet(base_dir, "moseq_df")

    available = [c for c in SCALAR_COLS if c in df.columns]
    if not available:
        raise HTTPException(status_code=400, detail="No scalar columns found in moseq_df")

    group_col = "group" if "group" in df.columns else None
    result: dict = {"scalars": available, "groups": {}}

    groups = df[group_col].dropna().unique().tolist() if group_col else ["all"]
    for g in groups:
        subset = df[df[group_col] == g] if group_col else df
        result["groups"][str(g)] = {
            col: {
                "mean": float(subset[col].mean()),
                "sem": float(subset[col].sem()),
            }
            for col in available
        }

    return result


# ── Transition matrices ───────────────────────────────────────────────────────

@router.get("/transitions")
def transition_matrix(base_dir: str, n_syllables: int = 30):
    df = _load_parquet(base_dir, "moseq_df")

    label_col = next(
        (c for c in ["labels (usage sort)", "labels", "syllable"] if c in df.columns),
        None
    )
    if label_col is None:
        raise HTTPException(status_code=400, detail="No label column found in moseq_df")

    group_col = "group" if "group" in df.columns else None
    uuid_col = "uuid" if "uuid" in df.columns else None
    groups = df[group_col].dropna().unique().tolist() if group_col else ["all"]

    result: dict = {"n_syllables": n_syllables, "groups": {}}

    for g in groups:
        subset = df[df[group_col] == g] if group_col else df
        mat = np.zeros((n_syllables, n_syllables), dtype=float)

        sessions = subset[uuid_col].unique() if uuid_col else [None]
        for sess in sessions:
            s_df = subset[subset[uuid_col] == sess] if uuid_col else subset
            labels = s_df[label_col].values
            valid = (labels >= 0) & (labels < n_syllables)
            labels = labels[valid]
            if len(labels) < 2:
                continue
            for a, b in zip(labels[:-1], labels[1:]):
                mat[int(a), int(b)] += 1

        # Row-normalise
        row_sums = mat.sum(axis=1, keepdims=True)
        row_sums[row_sums == 0] = 1
        mat = mat / row_sums

        result["groups"][str(g)] = mat.tolist()

    return result
