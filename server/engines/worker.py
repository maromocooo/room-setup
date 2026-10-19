#!/usr/bin/env python3
"""Generation worker that runs inside one engine's own Python environment.

The gateway starts one worker per active engine and talks to it with JSON
lines. Requests arrive on stdin; events go to the original stdout. Anything
the model libraries print is redirected to stderr so it cannot corrupt the
protocol stream.

    -> {"id": "...", "cmd": "generate", "image": "/abs/in.png",
        "output": "/abs/out.glb", "texture": true, "seed": 42}
    -> {"cmd": "shutdown"}
    <- {"event": "ready"}
    <- {"event": "progress", "id": "...", "stage": "shape"}
    <- {"event": "result", "id": "...", "texture_applied": true, "warning_code": null}
    <- {"event": "error", "id": "...", "message": "..."}
    <- {"event": "fatal", "message": "..."}

Only the standard library is imported here; engine modules import their own
heavy dependencies lazily.
"""

import importlib
import json
import os
import sys
import threading
import traceback
from pathlib import Path

ENGINE_MODULES = {
    "hunyuan3d": "hunyuan3d_engine",
    "trellis": "trellis_engine",
    "trellis2": "trellis2_engine",
    "pixal3d": "pixal3d_engine",
    "sam3d": "sam3d_engine",
    "mock": "mock_engine",
}


def parse_cpuset(text: str) -> set[int]:
    """'16-31,4' -> {4, 16, 17, ..., 31}"""
    cpus = set()
    for part in filter(None, (p.strip() for p in text.split(","))):
        first, _, last = part.partition("-")
        cpus.update(range(int(first), int(last or first) + 1))
    return cpus


def main() -> int:
    cpuset = os.environ.get("ENGINE_CPUSET")
    if cpuset and hasattr(os, "sched_setaffinity"):
        # Some systems (notably certain 13th/14th-gen Intel desktops) crash
        # model code at random; pinning the worker to a subset of cores is a
        # known workaround. Applied before any heavy import.
        os.sched_setaffinity(0, parse_cpuset(cpuset))

    if len(sys.argv) != 3 or sys.argv[1] not in ENGINE_MODULES:
        print(f"usage: worker.py <{'|'.join(ENGINE_MODULES)}> <engine-root>", file=sys.stderr)
        return 2

    # Keep a private handle on stdout for the protocol, then point fd 1 at
    # stderr so prints from native code and libraries end up in the log.
    protocol = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    lock = threading.Lock()

    def send(event: dict) -> None:
        with lock:
            protocol.write(json.dumps(event) + "\n")
            protocol.flush()

    root = Path(sys.argv[2]).expanduser().resolve()
    try:
        module = importlib.import_module(ENGINE_MODULES[sys.argv[1]])
        engine = module.Engine(root)
        engine.load()
    except Exception as error:  # noqa: BLE001 - reported to the gateway
        traceback.print_exc()
        send({"event": "fatal", "message": f"{type(error).__name__}: {error}"})
        return 1

    send({"event": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            print(f"Ignoring malformed request: {line!r}", file=sys.stderr)
            continue
        if request.get("cmd") == "shutdown":
            break
        if request.get("cmd") != "generate":
            continue

        job_id = request.get("id")
        try:
            result = engine.generate(
                Path(request["image"]),
                Path(request["output"]),
                texture=bool(request.get("texture")),
                seed=int(request.get("seed", 42)),
                progress=lambda stage: send({"event": "progress", "id": job_id, "stage": stage}),
            )
            send({"event": "result", "id": job_id, **result})
        except Exception as error:  # noqa: BLE001 - reported to the gateway
            traceback.print_exc()
            send({"event": "error", "id": job_id, "message": f"{type(error).__name__}: {error}"})
            engine.recover()
    return 0


if __name__ == "__main__":
    sys.exit(main())
