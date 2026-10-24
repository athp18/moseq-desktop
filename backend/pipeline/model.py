"""
Model training: kappa scan + final training.

Phase 1 — kappa scan: train N models at different kappa values for ~100 iters,
  compare log-likelihoods, write scan_results.json.
Phase 2 — final train: train the selected kappa for ~1000 iters.
"""

import asyncio
import json
import math
import pickle
from pathlib import Path
from typing import Optional

import numpy as np

from pipeline.capture import capture_to_queue
from pipeline.scanner import read_config


# ── Helpers ───────────────────────────────────────────────────────────────────

def _kappa_values(min_k: float, max_k: float, n: int, scale: str) -> list:
    if scale == "log":
        return [int(round(10 ** x))
                for x in np.linspace(math.log10(min_k), math.log10(max_k), n)]
    return [int(round(x)) for x in np.linspace(min_k, max_k, n)]


def _median_loglik(model_path: str) -> float:
    with open(model_path, "rb") as f:
        obj = pickle.load(f)
    lls = obj.get("log_likelihoods", [])
    if not lls:
        return float("nan")
    tail = lls[max(0, len(lls) - 10):]
    return float(np.median(tail))


def _mean_duration(model_path: str, fps: int = 30) -> float:
    with open(model_path, "rb") as f:
        obj = pickle.load(f)
    labels = obj.get("labels", [])
    if not labels:
        return float("nan")
    durations = []
    for sess in labels:
        arr = np.array(sess)
        changes = np.where(np.diff(arr) != 0)[0]
        runs = np.diff(np.concatenate([[0], changes + 1, [len(arr)]]))
        durations.extend(runs.tolist())
    return float(np.mean(durations) / fps) if durations else float("nan")


def _base_model_cfg(merged: dict, kappa: Optional[int], num_iter: int,
                    index_file: str) -> dict:
    return {
        "var_name": merged.get("var_name", "scores"),
        "npcs": merged.get("npcs", 10),
        "load_groups": True,
        "index": index_file if Path(index_file).exists() else None,
        "default_group": merged.get("default_group", "default"),
        "select_groups": False,
        "hold_out": False,
        "hold_out_seed": 0,
        "percent_split": 0,
        "num_iter": num_iter,
        "num_syllables": merged.get("num_syllables", 100),
        "ncpus": merged.get("ncpus", 1),
        "kappa": kappa,
        "gamma": merged.get("gamma", 1e3),
        "separate_trans": merged.get("separate_trans", False),
        "robust": merged.get("robust", True),
        "checkpoint_freq": -1,
        "use_checkpoint": False,
        "progressbar": True,
        "verbose": False,
        "check_every": merged.get("check_every", 5),
    }


# ── Scan ──────────────────────────────────────────────────────────────────────

def _do_scan(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from moseq2_model.helpers.wrappers import learn_model_wrapper

    file_config = read_config(base_dir)
    merged = {**file_config, **config}

    base = Path(base_dir)
    scores_file = str(base / "_pca" / "pca_scores.h5")
    index_file = str(base / "moseq2-index.yaml")
    scan_dir = base / "_model" / "scan"
    scan_dir.mkdir(parents=True, exist_ok=True)

    min_kappa = float(merged.get("min_kappa", 1e4))
    max_kappa = float(merged.get("max_kappa", 1e7))
    n_models = int(merged.get("n_models", 15))
    scale = merged.get("scan_scale", "log")
    num_iter = int(merged.get("num_iter_scan", 100))
    fps = int(merged.get("fps", 30))

    kappas = _kappa_values(min_kappa, max_kappa, n_models, scale)
    queue.put_nowait({"type": "log", "text": f"Kappa scan: {n_models} models, range [{min_kappa:.0e}, {max_kappa:.0e}], {num_iter} iters each"})

    results: dict = {"kappas": [], "median_loglikelihoods": [], "mean_durations": [], "model_paths": []}

    for i, kappa in enumerate(kappas):
        dest = str(scan_dir / f"model_kappa{kappa}.p")
        queue.put_nowait({"type": "log", "text": f"\n[{i+1}/{n_models}] kappa={kappa:,}  →  {dest}"})

        cfg = _base_model_cfg(merged, kappa, num_iter, index_file)
        with capture_to_queue(queue):
            try:
                learn_model_wrapper(input_file=scores_file, dest_file=dest, config_data=cfg)
            except Exception as e:
                queue.put_nowait({"type": "log", "text": f"  ERROR: {e}"})
                continue

        ll = _median_loglik(dest)
        dur = _mean_duration(dest, fps=fps)
        results["kappas"].append(kappa)
        results["median_loglikelihoods"].append(ll)
        results["mean_durations"].append(dur)
        results["model_paths"].append(dest)
        queue.put_nowait({"type": "log", "text": f"  median log-lik={ll:.4f}  mean_dur={dur:.3f}s"})

    lls = results["median_loglikelihoods"]
    if lls:
        best_idx = int(np.argmax([x for x in lls if not math.isnan(x)] or [0]))
        results["best_kappa_idx"] = best_idx
        results["best_kappa"] = results["kappas"][best_idx]
    else:
        results["best_kappa_idx"] = 0
        results["best_kappa"] = kappas[0] if kappas else None

    (scan_dir / "scan_results.json").write_text(json.dumps(results))
    queue.put_nowait({"type": "log", "text": f"\nScan complete. Best kappa = {results['best_kappa']:,}"})
    queue.put_nowait({"type": "done", "success": True})


async def run_scan(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    await asyncio.to_thread(_do_scan, base_dir, config, queue)


# ── Final training ─────────────────────────────────────────────────────────────

def _do_final(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from moseq2_model.helpers.wrappers import learn_model_wrapper

    file_config = read_config(base_dir)
    merged = {**file_config, **config}

    base = Path(base_dir)
    scores_file = str(base / "_pca" / "pca_scores.h5")
    index_file = str(base / "moseq2-index.yaml")
    model_dir = base / "_model"
    model_dir.mkdir(parents=True, exist_ok=True)

    kappa = config.get("kappa")
    num_iter = int(merged.get("num_iter_final", 1000))
    num_syllables = int(merged.get("num_syllables", 100))
    model_name = f"model_kappa{kappa}_final.p" if kappa else "model_final.p"
    dest = str(model_dir / model_name)

    queue.put_nowait({"type": "log", "text": f"Training final AR-HMM  kappa={kappa}  K={num_syllables}  {num_iter} iterations"})
    queue.put_nowait({"type": "log", "text": f"Output: {dest}"})

    cfg = _base_model_cfg(merged, kappa, num_iter, index_file)
    with capture_to_queue(queue):
        try:
            learn_model_wrapper(input_file=scores_file, dest_file=dest, config_data=cfg)
        except Exception as e:
            queue.put_nowait({"type": "done", "success": False, "detail": str(e)})
            return

    (base / ".selected_model").write_text(dest)
    queue.put_nowait({"type": "log", "text": f"Final model saved: {dest}"})
    queue.put_nowait({"type": "done", "success": True})


async def run_final(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    await asyncio.to_thread(_do_final, base_dir, config, queue)


# ── Legacy single-step entrypoint ─────────────────────────────────────────────

async def run(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    await run_final(base_dir, config, queue)
