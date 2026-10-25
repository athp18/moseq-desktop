"""
Analysis runner.
Computes moseq_df and stats_df using moseq2_viz functions,
saves them as parquet to _analysis/ for the REST endpoints.
"""

import asyncio
from pathlib import Path


def _do_analyze(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    from moseq2_viz.util import parse_index
    from moseq2_viz.scalars.util import scalars_to_dataframe
    from moseq2_viz.model.util import compute_behavioral_statistics

    base = Path(base_dir)
    index_file = base / "moseq2-index.yaml"
    selected_model_file = base / ".selected_model"
    analysis_dir = base / "_analysis"

    if not index_file.exists():
        queue.put_nowait({"type": "done", "success": False,
                          "detail": "moseq2-index.yaml not found — run Aggregate first"})
        return

    if not selected_model_file.exists():
        # Fallback: find most recent model .p in _model/
        model_files = sorted((base / "_model").glob("*.p"))
        if not model_files:
            queue.put_nowait({"type": "done", "success": False,
                              "detail": "No trained model found — run Model step first"})
            return
        model_path = str(model_files[-1])
    else:
        model_path = selected_model_file.read_text().strip()

    queue.put_nowait({"type": "log", "text": f"Index: {index_file}"})
    queue.put_nowait({"type": "log", "text": f"Model: {model_path}"})

    analysis_dir.mkdir(exist_ok=True)

    # Compute moseq_df
    queue.put_nowait({"type": "log", "text": "Computing moseq_df (scalar + label alignment)..."})
    try:
        _, sorted_index = parse_index(str(index_file))
        moseq_df = scalars_to_dataframe(sorted_index, model_path=model_path)
        queue.put_nowait({"type": "log", "text": f"  moseq_df: {len(moseq_df):,} rows × {len(moseq_df.columns)} columns"})
    except Exception as e:
        queue.put_nowait({"type": "done", "success": False, "detail": f"scalars_to_dataframe failed: {e}"})
        return

    out_moseq = analysis_dir / "moseq_df.parquet"
    moseq_df.to_parquet(out_moseq, index=False)
    queue.put_nowait({"type": "log", "text": f"  Saved → {out_moseq}"})

    # Compute stats_df
    queue.put_nowait({"type": "log", "text": "Computing stats_df (syllable usage statistics)..."})
    try:
        count = config.get("stats_count", "usage")
        syllable_key = config.get("syllable_key", "labels (usage sort)")
        groupby = config.get("groupby", ["group", "uuid"])
        stats_df = compute_behavioral_statistics(
            moseq_df,
            count=count,
            groupby=groupby,
            usage_normalization=True,
            syllable_key=syllable_key,
        )
        queue.put_nowait({"type": "log", "text": f"  stats_df: {len(stats_df):,} rows"})
    except Exception as e:
        queue.put_nowait({"type": "done", "success": False, "detail": f"compute_behavioral_statistics failed: {e}"})
        return

    out_stats = analysis_dir / "stats_df.parquet"
    stats_df.to_parquet(out_stats, index=False)
    queue.put_nowait({"type": "log", "text": f"  Saved → {out_stats}"})

    queue.put_nowait({"type": "log", "text": "Analysis complete."})
    queue.put_nowait({"type": "done", "success": True})


async def run(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    await asyncio.to_thread(_do_analyze, base_dir, config, queue)
