"""Test-owned real application with only the optional MP3 stage failing."""

from __future__ import annotations

import asyncio
import json
import socket
import sys
from pathlib import Path

import uvicorn

from backend.app import exports
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.media import ProcessingError


async def serve(working: Path, ready: Path) -> None:
    original = exports.render_optional_export

    def optional(pipeline, job, format_, primary, master, plan):
        if format_ == "mp3":
            raise ProcessingError("Controlled optional MP3 failure.")
        return original(pipeline, job, format_, primary, master, plan)

    exports.render_optional_export = optional
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    app = create_app(Settings(working_root=working))
    server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
    task = asyncio.create_task(server.serve(sockets=[sock]))
    try:
        while not server.started:
            if task.done():
                await task
                raise RuntimeError("Test server exited before readiness.")
            await asyncio.sleep(0.01)
        await asyncio.to_thread(
            ready.write_text,
            json.dumps({"url": f"http://127.0.0.1:{sock.getsockname()[1]}"}),
        )
        await task
    finally:
        server.should_exit = True
        sock.close()
        exports.render_optional_export = original


if __name__ == "__main__":
    asyncio.run(serve(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()))
