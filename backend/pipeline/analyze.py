"""
Analysis runner — placeholder.
Will call moseq-toolkit functions for crowd movies, syllable stats,
group comparisons. Stubbed until the analysis UI is built.
"""

import asyncio


async def run(base_dir: str, config: dict, queue: asyncio.Queue) -> None:
    queue.put_nowait({"type": "log", "text": "Analysis step coming soon."})
    queue.put_nowait({"type": "done", "success": True})
