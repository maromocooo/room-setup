"""The shared room document.

The browser app and the MCP server both edit one JSON document held here, so
an assistant's changes show up live in the open app and the user's edits are
visible to the assistant. The document is saved to GENERATED_DIR/scene.json
and survives restarts (and page reloads).

Shape (all lengths in centimetres; plan x → right, plan y → down/3D z):

    {
      "revision": 7,                 # bumped on every write
      "ceilingHeight": 240,
      "walls": [{"id", "start": {"x", "y"}, "end": {"x", "y"}, "finish": null | {...}}],
      "floor": {"finish": {"preset": "oak"} | {"image": url}, "scale": 1},
      "wall":  {"finish": ..., "scale": 1},
      "openings": [{"id", "kind": "door" | "window", "preset", "style", "wallId",
                    "offset", "width", "height", "sill", "hinge", "side"}],   # see src/core/openings.js
      "lights": [{"id", "preset", "x", "y", "drop" | "height", "lumens", "kelvin", "on", "shadows"}],
      "timeOfDay": "morning" | "day" | "evening" | "night",
      "furniture": [{
        "id", "name", "engine",
        "status": "ready" | "generating" | "failed", "job_id", "error",
        "model_url", "model_layout": "raw" | "container",
        "dimensions": {"width", "depth", "height"},
        "position": {"x", "y", "z"},  # plan x, elevation, plan y
        "facing": 0,                  # degrees; 0 = front faces +y, 90 = faces +x
        "pitch": 0,                   # degrees; a vertical turn about the item's left-right axis
        "thumbnail_url"
      }]
    }

"raw" models are generator output that the browser sizes to `dimensions`;
"container" models were uploaded by the browser with sizing baked in.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import uuid
from pathlib import Path

log = logging.getLogger("room-setup")

EMPTY = {
    "ceilingHeight": 240,
    "walls": [],
    "floor": {"finish": {"preset": "oak"}, "scale": 1},
    "wall": {"finish": {"preset": "standard"}, "scale": 1},
    "furniture": [],
    "openings": [],
    "lights": [],
    "timeOfDay": "day",
}


class Conflict(Exception):
    def __init__(self, current: dict):
        super().__init__("Scene changed since it was read.")
        self.current = current


class Scene:
    def __init__(self, path: Path):
        self.path = path
        self.revision = 0
        self.data = json.loads(json.dumps(EMPTY))
        self.subscribers: set[asyncio.Queue] = set()
        self.renders: dict[str, asyncio.Future] = {}
        with contextlib.suppress(FileNotFoundError, json.JSONDecodeError):
            saved = json.loads(path.read_text())
            self.revision = int(saved.pop("revision", 0))
            self.data = {**self.data, **saved}

    def snapshot(self) -> dict:
        return {"revision": self.revision, **json.loads(json.dumps(self.data))}

    def replace(self, document: dict, *, base_revision: int | None, origin: str) -> dict:
        if base_revision is not None and base_revision != self.revision:
            raise Conflict(self.snapshot())
        document = {k: v for k, v in document.items() if k in EMPTY}
        self.data = {**json.loads(json.dumps(EMPTY)), **document}
        return self._commit(origin)

    def update_item(self, item_id: str, fields: dict, origin: str = "gateway") -> bool:
        for item in self.data["furniture"]:
            if item.get("id") == item_id:
                item.update(fields)
                self._commit(origin)
                return True
        return False

    def _commit(self, origin: str) -> dict:
        self.revision += 1
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"revision": self.revision, **self.data}))
        os.replace(tmp, self.path)
        self.broadcast({"type": "scene", "revision": self.revision, "origin": origin})
        return self.snapshot()

    # ---- live updates ----
    def broadcast(self, event: dict) -> None:
        for queue in list(self.subscribers):
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(event)

    async def events(self):
        """Server-sent events for one browser tab."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self.subscribers.add(queue)
        try:
            yield f"data: {json.dumps({'type': 'hello', 'revision': self.revision})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), 15)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            self.subscribers.discard(queue)

    # ---- screenshots, rendered by a connected browser ----
    async def render(self, view: dict, timeout: float = 30) -> bytes:
        if not self.subscribers:
            raise LookupError("Room Setup is not open in a browser. Open the app, then try again.")
        render_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.renders[render_id] = future
        try:
            self.broadcast({"type": "render", "id": render_id, "view": view})
            return await asyncio.wait_for(future, timeout)
        finally:
            self.renders.pop(render_id, None)

    def deliver_render(self, render_id: str, png: bytes) -> bool:
        future = self.renders.get(render_id)
        if not future or future.done():
            return False
        future.set_result(png)
        return True
