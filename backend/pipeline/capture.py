"""
Redirect stdout/stderr to an asyncio queue so pipeline output
streams to the frontend in real time.
"""

import io
import sys
import asyncio
import contextlib
from typing import Generator


class QueueWriter(io.TextIOBase):
    """Line-buffered writer that puts lines onto an asyncio queue."""

    def __init__(self, queue: asyncio.Queue):
        self._queue = queue
        self._buf = ""

    def write(self, text: str) -> int:
        self._buf += text
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            if line.strip():
                try:
                    self._queue.put_nowait({"type": "log", "text": line})
                except asyncio.QueueFull:
                    pass
        return len(text)

    def flush(self) -> None:
        if self._buf.strip():
            try:
                self._queue.put_nowait({"type": "log", "text": self._buf})
            except asyncio.QueueFull:
                pass
            self._buf = ""


@contextlib.contextmanager
def capture_to_queue(queue: asyncio.Queue) -> Generator:
    """Context manager: redirect stdout + stderr to queue for the duration."""
    writer = QueueWriter(queue)
    with contextlib.redirect_stdout(writer), contextlib.redirect_stderr(writer):
        yield writer
