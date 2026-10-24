"""
PCA runner: train PCA, apply PCA scores, compute changepoints.

- Train PCA:      uses dask + initialize_dask (auto-sizes workers to machine RAM/CPU)
- Apply scores:   uses apply_pca_local (pure numpy, per-session tqdm, no cluster overhead)
- Changepoints:   uses get_changepoints_dask (no local alternative exists)
"""

import asyncio
from pathlib import Path
from contextlib import contextmanager

import h5py
import numpy as np

from pipeline.capture import capture_to_queue
from pipeline.scanner import read_config


def _load_h5s(aggregate_dir: Path):
    from moseq2_pca.util import recursive_find_h5s
    h5s, _, yamls = recursive_find_h5s(str(aggregate_dir))
    return h5s, yamls


def _build_dask_array(h5s: list, config: dict):
    import dask.array as da

    h5_path = config.get("h5_path", "/frames")
    chunk_size = config.get("chunk_size", 4000)

    arrays = []
    for h5_path_ in h5s:
        with h5py.File(h5_path_, "r") as f:
            frames = f[h5_path][:]
        arr = da.from_array(frames.astype("float32"), chunks=(chunk_size, *frames.shape[1:]))
        arrays.append(arr)

    return da.concatenate(arrays, axis=0)


def _clean_params(config: dict) -> dict:
    return {
        "gaussfilter_space": config.get("gaussfilter_space", [0, 0]),
        "gaussfilter_time": config.get("gaussfilter_time", 0),
        "medfilter_space": config.get("medfilter_space", [0]),
        "medfilter_time": config.get("medfilter_time", [0]),
        "tailfilter_size": config.get("tail_filter_size", 9),
        "tailfilter_shape": config.get("tail_filter_shape", "ellipse"),
        "tail_filter_iters": config.get("tail_filter_iters", 1),
        "min_height": config.get("min_height", 10),
        "max_height": config.get("max_height", 100),
    }


@contextmanager
def _dask_client(config: dict):
    """
    Start a LocalCluster via initialize_dask (auto-sizes to machine resources),
    yield the client, then shut down cleanly regardless of success or failure.
    """
    from moseq2_pca.util import initialize_dask, close_dask

    client, cluster, workers = initialize_dask(
        cluster_type="local",
        nworkers=config.get("nworkers", 1),
        local_processes=config.get("local_processes", False),
        cache_path=config.get("dask_cache_path", "_pca"),
        dashboard_port=str(config.get("dask_port", "8787")),
        data_size=config.get("data_size"),
    )
    try:
        yield client
    finally:
        close_dask(client, cluster, config.get("timeout", 10))


def _do_pca(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from moseq2_pca.pca.util import train_pca_dask, apply_pca_local, get_changepoints_dask

    file_config = read_config(base_dir)
    merged = {**file_config, **config}

    base = Path(base_dir)
    aggregate_dir = base / "aggregate_results"
    pca_dir = base / "_pca"
    pca_dir.mkdir(exist_ok=True)

    pca_file = pca_dir / "pca.h5"
    scores_file = str(pca_dir / "pca_scores")   # apply_pca_local appends .h5
    changepoints_file = str(pca_dir / "changepoints.h5")

    rank = merged.get("pca_components", 10)
    use_fft = merged.get("use_fft", False)
    clean_params = _clean_params(merged)

    queue.put_nowait({"type": "log", "text": "Loading extraction data..."})
    h5s, yamls = _load_h5s(aggregate_dir)
    queue.put_nowait({"type": "log", "text": f"Found {len(h5s)} session(s)"})

    with capture_to_queue(queue):

        # ── 1. Train PCA ─────────────────────────────────────────────────────
        if not pca_file.exists():
            queue.put_nowait({"type": "log", "text": f"Training PCA (rank={rank})..."})

            with _dask_client(merged) as client:
                dask_array = _build_dask_array(h5s, merged)
                pca_result = train_pca_dask(
                    dask_array=dask_array,
                    clean_params=clean_params,
                    use_fft=use_fft,
                    rank=rank,
                    cluster_type="local",
                    client=client,
                    min_height=merged.get("min_height", 10),
                    max_height=merged.get("max_height", 100),
                )

            with h5py.File(str(pca_file), "w") as f:
                for key, val in pca_result.items():
                    f.create_dataset(key, data=np.array(val))

            queue.put_nowait({"type": "log", "text": "PCA training complete."})
        else:
            queue.put_nowait({"type": "log", "text": "PCA model found, skipping training."})

        # Load components from disk (covers both fresh-trained and pre-existing)
        with h5py.File(str(pca_file), "r") as f:
            pca_components = f["components"][:]

        # ── 2. Apply PCA scores (local — no dask) ────────────────────────────
        if not (pca_dir / "pca_scores.h5").exists():
            queue.put_nowait({"type": "log", "text": f"Applying PCA to {len(h5s)} session(s)..."})

            apply_pca_local(
                pca_components=pca_components,
                h5s=h5s,
                yamls=yamls,
                use_fft=use_fft,
                clean_params=clean_params,
                save_file=scores_file,
                chunk_size=merged.get("chunk_size", 4000),
                mask_params=None,
                missing_data=False,
                fps=merged.get("fps", 30),
                verbose=True,
            )

            queue.put_nowait({"type": "log", "text": "PCA scores complete."})
        else:
            queue.put_nowait({"type": "log", "text": "PCA scores found, skipping."})

        # ── 3. Changepoints (dask — no local alternative) ────────────────────
        if not (pca_dir / "changepoints.h5").exists():
            queue.put_nowait({"type": "log", "text": "Computing changepoints..."})

            changepoint_params = {
                "kappa":          merged.get("changepoint_kappa", 1e6),
                "num_changepoints": merged.get("num_changepoints", 5),
                "sigma":          merged.get("changepoint_sigma", 0.25),
                "peak_height":    merged.get("changepoint_peak_height", 0.3),
                "peak_neighbors": merged.get("changepoint_peak_neighbors", 3),
            }

            with _dask_client(merged) as client:
                get_changepoints_dask(
                    changepoint_params=changepoint_params,
                    pca_components=pca_components,
                    h5s=h5s,
                    yamls=yamls,
                    save_file=changepoints_file,
                    chunk_size=merged.get("chunk_size", 4000),
                    client=client,
                )

            queue.put_nowait({"type": "log", "text": "Changepoints complete."})
        else:
            queue.put_nowait({"type": "log", "text": "Changepoints found, skipping."})

    queue.put_nowait({"type": "done", "success": True})


async def run(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    await asyncio.to_thread(_do_pca, base_dir, config, queue)
