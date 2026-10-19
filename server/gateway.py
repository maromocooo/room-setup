#!/usr/bin/env python3
"""Room Setup generation API.

A small FastAPI app that the browser talks to. It does not import any model
code itself: each engine runs as a worker process inside that engine's own
Python environment (see engines/worker.py). Only one engine holds the GPU at
a time; asking for a different engine stops the current worker first, so
switching between Hunyuan3D and TRELLIS is just a matter of picking one.
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import logging
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from scene import Conflict, Scene

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORKER = Path(__file__).resolve().parent / "engines" / "worker.py"
GENERATED_DIR = Path(os.environ.get("GENERATED_DIR", PROJECT_ROOT / "generated")).expanduser().resolve()
LOG_DIR = Path(os.environ.get("LOG_DIR", PROJECT_ROOT / "logs")).expanduser().resolve()
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_MODEL_BYTES = 200 * 1024 * 1024  # edited models uploaded by the browser
MAX_SCENE_BYTES = 40 * 1024 * 1024   # custom textures may be inlined as data URLs
IMAGE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
LOAD_TIMEOUT_S = float(os.environ.get("ENGINE_LOAD_TIMEOUT", 1800))  # first run may download weights
JOB_TIMEOUT_S = float(os.environ.get("JOB_TIMEOUT", 1800))
MAX_QUEUED_JOBS = 20
EVENT_LINE_LIMIT = 4 * 1024 * 1024
JOB_RETENTION_S = 3600
MODEL_ID = re.compile(r"^[0-9a-f]{32}$")

log = logging.getLogger("room-setup")

# Keep references so fire-and-forget tasks are not garbage-collected.
_background: set[asyncio.Task] = set()


def spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)
    return task


@dataclass(frozen=True)
class EngineSpec:
    id: str
    label: str
    env_prefix: str
    texture: str  # "optional": user can toggle; "always": colour is part of the output
    description: str


ENGINE_SPECS = [
    EngineSpec("hunyuan3d", "Hunyuan3D 2.1", "HUNYUAN3D", "optional",
               "Clean shapes; PBR texture painting is optional and slower."),
    EngineSpec("trellis2", "TRELLIS.2", "TRELLIS2", "always",
               "Detailed geometry with PBR materials."),
    EngineSpec("trellis", "TRELLIS", "TRELLIS", "always",
               "Fast, coloured results."),
    EngineSpec("pixal3d", "Pixal3D", "PIXAL3D", "always",
               "Pixel-aligned shapes that follow the photo closely, with PBR textures."),
    EngineSpec("sam3d", "SAM 3D Objects", "SAM3D", "always",
               "Robust on real-world photos with clutter and occlusion."),
]
MOCK_SPEC = EngineSpec("mock", "Mock (no GPU)", "MOCK", "always", "Box placeholder for trying the UI.")


def engine_paths(spec: EngineSpec) -> tuple[Path, Path] | None:
    """(python, root) if the engine is configured and both paths exist."""
    if spec.id == "mock":
        return Path(sys.executable), PROJECT_ROOT
    python = os.environ.get(f"{spec.env_prefix}_PYTHON")
    root = os.environ.get(f"{spec.env_prefix}_ROOT")
    if not python or not root:
        return None
    python_path, root_path = Path(python).expanduser(), Path(root).expanduser()
    if not python_path.is_file() or not root_path.is_dir():
        return None
    return python_path, root_path


def worker_env(python: Path) -> dict[str, str]:
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONFAULTHANDLER": "1"}
    # Some upstream code expects an activated Conda environment.
    env_dir = python.parent.parent
    if (env_dir / "conda-meta").is_dir():
        env["CONDA_PREFIX"] = str(env_dir)
    # Compiled extensions (rasterizers, spconv, ...) expect PyTorch's bundled
    # shared libraries on the loader path. Do not resolve symlinks: a venv's
    # python links to the base interpreter, not to the env's site-packages.
    torch_libs = sorted((python.parent.parent / "lib").glob("python3*/site-packages/torch/lib"))
    if torch_libs:
        env["LD_LIBRARY_PATH"] = os.pathsep.join(
            [str(torch_libs[-1])] + ([env["LD_LIBRARY_PATH"]] if env.get("LD_LIBRARY_PATH") else []))
    return env


class WorkerError(RuntimeError):
    pass


class Worker:
    """One engine process and its JSON-lines protocol."""

    def __init__(self, spec: EngineSpec, python: Path, root: Path):
        self.spec, self.python, self.root = spec, python, root
        self.process: asyncio.subprocess.Process | None = None
        self.state = "stopped"  # stopped | starting | ready | busy | error
        self.error: str | None = None
        self._ready: asyncio.Future | None = None
        self._pending: dict[str, tuple[asyncio.Future, callable]] = {}
        self._reader: asyncio.Task | None = None

    @property
    def log_path(self) -> Path:
        return LOG_DIR / f"{self.spec.id}.log"

    async def start(self) -> None:
        if self.state in ("ready", "busy"):
            return
        if self.state == "starting" and self._ready:
            return await self._wait_ready()
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        self.state, self.error = "starting", None
        self._ready = asyncio.get_running_loop().create_future()
        with open(self.log_path, "ab") as log_file:
            log_file.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} starting {self.spec.id} ===\n".encode())
            log_file.flush()
            self.process = await asyncio.create_subprocess_exec(
                str(self.python), "-u", str(WORKER), self.spec.id, str(self.root),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=log_file,
                cwd=str(self.root), env=worker_env(self.python), limit=EVENT_LINE_LIMIT,
            )
        log.info("Started %s worker (pid %s); log: %s", self.spec.id, self.process.pid, self.log_path)
        self._reader = asyncio.create_task(self._read_events(self.process))
        await self._wait_ready()

    async def _wait_ready(self) -> None:
        try:
            await asyncio.wait_for(asyncio.shield(self._ready), LOAD_TIMEOUT_S)
        except asyncio.TimeoutError:
            await self.stop()
            self.state, self.error = "error", "Timed out while loading the model."
            raise WorkerError(self.error)

    async def _read_events(self, process: asyncio.subprocess.Process) -> None:
        try:
            await self._dispatch_events(process)
        except Exception:  # noqa: BLE001 - a broken stream must not strand jobs
            log.exception("Lost the event stream from %s; stopping it", self.spec.id)
            self.error = "Lost contact with the engine process."
            with contextlib.suppress(ProcessLookupError):
                process.kill()
        await self._on_exit(process)

    async def _dispatch_events(self, process: asyncio.subprocess.Process) -> None:
        assert process.stdout
        while line := await process.stdout.readline():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            kind = event.get("event")
            if kind == "ready":
                self.state = "ready"
                if not self._ready.done():
                    self._ready.set_result(None)
            elif kind == "fatal":
                self.error = event.get("message") or "The engine failed to load."
            elif kind in ("progress", "result", "error"):
                entry = self._pending.get(event.get("id"))
                if not entry:
                    continue
                future, on_progress = entry
                if kind == "progress":
                    on_progress(event.get("stage"))
                elif not future.done():
                    if kind == "result":
                        future.set_result(event)
                    else:
                        future.set_exception(WorkerError(event.get("message") or "Generation failed."))

    async def _on_exit(self, process: asyncio.subprocess.Process) -> None:
        code = await process.wait()
        if process is not self.process:
            return  # an older process we already replaced
        expected = self.state == "stopping"
        self.process = None
        message = self.error or f"Engine process exited with code {code}. See logs/{self.spec.id}.log."
        self.state = "stopped" if expected else "error"
        if not expected:
            self.error = message
        exc = WorkerError(message)
        if self._ready and not self._ready.done():
            self._ready.set_exception(exc)
            self._ready.exception()  # mark retrieved; callers see it via _wait_ready
        for future, _ in self._pending.values():
            if not future.done():
                future.set_exception(exc)
        self._pending.clear()

    async def generate(self, job_id: str, image: Path, output: Path, texture: bool, seed: int, on_progress) -> dict:
        if self.state != "ready" or not self.process or not self.process.stdin:
            raise WorkerError("Engine is not ready.")
        future = asyncio.get_running_loop().create_future()
        self._pending[job_id] = (future, on_progress)
        self.state = "busy"
        try:
            request = {"id": job_id, "cmd": "generate", "image": str(image), "output": str(output),
                       "texture": texture, "seed": seed}
            self.process.stdin.write((json.dumps(request) + "\n").encode())
            await self.process.stdin.drain()
            try:
                return await asyncio.wait_for(asyncio.shield(future), JOB_TIMEOUT_S)
            except asyncio.TimeoutError:
                self.error = f"Generation took longer than {int(JOB_TIMEOUT_S)} s; the engine was stopped."
                self.kill()
                raise WorkerError(self.error) from None
        finally:
            self._pending.pop(job_id, None)
            if self.state == "busy":
                self.state = "ready"

    def kill(self) -> None:
        """Terminate immediately; the event reader fails any pending job."""
        if self.process:
            self.state = "stopping"
            with contextlib.suppress(ProcessLookupError):
                self.process.kill()

    async def stop(self) -> None:
        process = self.process
        if not process:
            self.state = "stopped" if self.state != "error" else self.state
            return
        self.state = "stopping"
        with contextlib.suppress(Exception):
            process.stdin.write(b'{"cmd": "shutdown"}\n')
            await process.stdin.drain()
            process.stdin.close()
        try:
            await asyncio.wait_for(process.wait(), 15)
        except asyncio.TimeoutError:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 10)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
        if self._reader:
            with contextlib.suppress(Exception):
                await self._reader
        self.process, self.state = None, "stopped"
        log.info("Stopped %s worker", self.spec.id)


@dataclass
class Job:
    id: str
    engine: str
    texture: bool
    seed: int
    image: Path
    status: str = "queued"  # queued | loading | running | done | error
    stage: str | None = None
    created: float = field(default_factory=time.time)
    finished: float | None = None
    result: dict | None = None
    error: str | None = None
    scene_item: str | None = None  # furniture entry to fill in when done

    def public(self, queue_position: int | None = None) -> dict:
        data = {"id": self.id, "engine": self.engine, "status": self.status, "stage": self.stage,
                "created": self.created, "error": self.error}
        if self.result:
            data.update(self.result)
        if queue_position is not None:
            data["queue_position"] = queue_position
        return data


class Gateway:
    def __init__(self, specs: list[EngineSpec], scene: Scene):
        self.scene = scene
        self.specs = {spec.id: spec for spec in specs}
        self.workers: dict[str, Worker] = {}
        self.jobs: dict[str, Job] = {}
        self.queue: list[str] = []
        self.gpu = asyncio.Lock()  # one engine on the GPU, one job at a time
        self.switching: str | None = None

    def worker(self, engine_id: str) -> Worker:
        spec = self.specs.get(engine_id)
        if not spec:
            raise HTTPException(404, f"Unknown engine: {engine_id}")
        paths = engine_paths(spec)
        if not paths:
            raise HTTPException(409, f"{spec.label} is not configured. Set {spec.env_prefix}_PYTHON and "
                                     f"{spec.env_prefix}_ROOT in .env.")
        if engine_id not in self.workers:
            self.workers[engine_id] = Worker(spec, *paths)
        return self.workers[engine_id]

    async def activate(self, engine_id: str) -> Worker:
        """Make engine_id the resident engine. Caller must hold self.gpu."""
        target = self.worker(engine_id)
        for other in list(self.workers.values()):  # dict can grow while we await
            if other is not target and other.process:
                self.switching = engine_id
                await other.stop()
        self.switching = engine_id
        try:
            await target.start()
        finally:
            self.switching = None
        return target

    def engines(self) -> list[dict]:
        listing = []
        for spec in self.specs.values():
            worker = self.workers.get(spec.id)
            listing.append({
                "id": spec.id, "label": spec.label, "texture": spec.texture, "description": spec.description,
                "configured": engine_paths(spec) is not None,
                "state": worker.state if worker else "stopped",
                "error": worker.error if worker else None,
            })
        return listing

    def submit(self, job: Job) -> None:
        self.jobs[job.id] = job
        self.queue.append(job.id)
        spawn(self._run(job))
        self._prune()

    async def _run(self, job: Job) -> None:
        try:
            async with self.gpu:
                self.queue.remove(job.id)
                job.status = "loading"
                worker = await self.activate(job.engine)
                job.status, job.stage = "running", None
                output = GENERATED_DIR / f"model_{job.id}.glb"

                def on_progress(stage):
                    job.stage = stage

                result = await worker.generate(job.id, job.image, output, job.texture, job.seed, on_progress)
                job.result = {
                    "model_id": job.id,
                    "model_url": f"/generated/{output.name}",
                    "texture_applied": bool(result.get("texture_applied")),
                    "warning_code": result.get("warning_code"),
                }
                job.status = "done"
                if job.scene_item:
                    self.scene.update_item(job.scene_item, {
                        "status": "ready", "model_url": job.result["model_url"], "model_layout": "raw",
                        "texture_applied": job.result["texture_applied"], "error": None,
                    })
        except (WorkerError, HTTPException) as error:
            job.status, job.error = "error", getattr(error, "detail", None) or str(error)
        except Exception as error:  # noqa: BLE001
            log.exception("Job %s failed", job.id)
            job.status, job.error = "error", str(error)
        finally:
            if job.status == "error" and job.scene_item:
                self.scene.update_item(job.scene_item, {"status": "failed", "error": job.error})
            if job.id in self.queue:
                self.queue.remove(job.id)
            job.finished = time.time()
            with contextlib.suppress(OSError):
                job.image.unlink()

    def _prune(self) -> None:
        cutoff = time.time() - JOB_RETENTION_S
        for job_id in [j.id for j in self.jobs.values() if j.finished and j.finished < cutoff]:
            del self.jobs[job_id]

    async def shutdown(self) -> None:
        await asyncio.gather(*(w.stop() for w in self.workers.values()), return_exceptions=True)


def create_app() -> FastAPI:
    specs = ENGINE_SPECS + ([MOCK_SPEC] if os.environ.get("ROOM_SETUP_MOCK_ENGINE") == "1" else [])
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    for sub in ("inputs", "uploads"):
        (GENERATED_DIR / sub).mkdir(exist_ok=True)
    scene = Scene(GENERATED_DIR / "scene.json")
    gateway = Gateway(specs, scene)

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        preload = os.environ.get("PRELOAD_ENGINE")
        if preload:
            async def warm():
                async with gateway.gpu:
                    with contextlib.suppress(Exception):
                        await gateway.activate(preload)
            spawn(warm())
        yield
        await gateway.shutdown()

    app = FastAPI(title="Room Setup API", version="1.0.0", lifespan=lifespan)
    app.state.gateway = gateway
    allowed_hosts = {h.strip().lower() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip()}

    @app.middleware("http")
    async def guard(request: Request, call_next):
        # The API has no authentication. Only answer requests addressed to a
        # local/IP host (blocks DNS rebinding) whose Origin, if any, is that
        # same host (blocks other websites), and cap upload size up front.
        host = request.headers.get("host", "")
        if not host_allowed(host, allowed_hosts):
            return JSONResponse({"detail": "Host not allowed."}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin != "null" and urlsplit(origin).netloc.lower() != host.lower():
            return JSONResponse({"detail": "Cross-origin requests are not allowed."}, status_code=403)
        path = request.url.path
        limit = MAX_MODEL_BYTES if path == "/api/models" else MAX_SCENE_BYTES if path == "/api/scene" \
            else MAX_UPLOAD_BYTES + 64 * 1024
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > limit:
            return JSONResponse({"detail": "The upload is too large."}, status_code=413)
        return await call_next(request)

    @app.get("/api/health")
    async def health():
        return {"ok": True, "engines": gateway.engines()}

    @app.get("/api/engines")
    async def list_engines():
        default = os.environ.get("DEFAULT_ENGINE")
        return {"engines": gateway.engines(), "default": default, "switching": gateway.switching}

    @app.post("/api/engines/{engine_id}/load", status_code=202)
    async def load_engine(engine_id: str):
        gateway.worker(engine_id)  # validate before scheduling

        async def load():
            async with gateway.gpu:
                with contextlib.suppress(WorkerError):
                    await gateway.activate(engine_id)
        spawn(load())
        return {"engines": gateway.engines()}

    @app.post("/api/engines/{engine_id}/unload")
    async def unload_engine(engine_id: str):
        worker = gateway.workers.get(engine_id)
        process = worker.process if worker else None
        if process:
            # Don't wait for the GPU lock: this is also how a stuck engine is
            # recovered. Killing the process fails its running job, if any.
            worker.kill()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(process.wait(), 15)
            if worker._reader:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(worker._reader, 5)
        if worker:
            worker.error = None
        return {"engines": gateway.engines()}

    @app.post("/api/jobs", status_code=202)
    async def create_job(
        request: Request,
        file: UploadFile = File(...),
        engine: str = Form(...),
        texture: bool = Form(False),
        seed: int = Form(42),
        scene_item: str | None = Form(None),
    ):
        gateway.worker(engine)
        if len(gateway.queue) >= MAX_QUEUED_JOBS:
            raise HTTPException(429, "Too many jobs are waiting. Try again later.")
        if not (file.content_type or "").startswith("image/"):
            raise HTTPException(400, "The upload must be an image.")
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "The image is larger than 20 MB.")
        job_id = uuid.uuid4().hex
        image = GENERATED_DIR / "inputs" / f"{job_id}.img"
        image.write_bytes(data)
        job = Job(job_id, engine, texture, seed, image, scene_item=scene_item)
        gateway.submit(job)
        return job.public(queue_position=len(gateway.queue) - 1)

    @app.get("/api/jobs/{job_id}")
    async def get_job(job_id: str):
        job = gateway.jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found.")
        position = gateway.queue.index(job_id) if job_id in gateway.queue else None
        return job.public(queue_position=position)

    @app.delete("/api/models/{model_id}")
    async def delete_model(model_id: str):
        if not MODEL_ID.match(model_id):
            raise HTTPException(400, "Invalid model id.")
        path = GENERATED_DIR / f"model_{model_id}.glb"
        if not path.exists():
            raise HTTPException(404, "Model not found.")
        path.unlink()
        return {"deleted": model_id}

    # ---- shared room document (browser ⇄ MCP) ----
    @app.get("/api/scene")
    async def get_scene():
        return scene.snapshot()

    @app.put("/api/scene")
    async def put_scene(request: Request):
        body = await request.json()
        if not isinstance(body, dict) or not isinstance(body.get("scene"), dict):
            raise HTTPException(400, "Expected {scene, base_revision, origin}.")
        try:
            return scene.replace(body["scene"], base_revision=body.get("base_revision"),
                                 origin=str(body.get("origin") or "unknown"))
        except Conflict as conflict:
            return JSONResponse({"detail": str(conflict), "scene": conflict.current}, status_code=409)

    @app.get("/api/scene/events")
    async def scene_events():
        return StreamingResponse(scene.events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/api/scene/render")
    async def render_scene(request: Request):
        view = await request.json()
        try:
            png = await scene.render(view if isinstance(view, dict) else {})
        except LookupError as error:
            raise HTTPException(409, str(error))
        except asyncio.TimeoutError:
            raise HTTPException(504, "The browser did not answer in time.")
        return Response(png, media_type="image/png")

    @app.post("/api/scene/render/{render_id}")
    async def deliver_render(render_id: str, request: Request):
        if not scene.deliver_render(render_id, await request.body()):
            raise HTTPException(404, "No such render request.")
        return {"ok": True}

    @app.post("/api/models", status_code=201)
    async def upload_model(request: Request):
        data = await request.body()
        if len(data) > MAX_MODEL_BYTES or data[:4] != b"glTF":
            raise HTTPException(400, "Expected a binary glTF (.glb) body.")
        model_id = uuid.uuid4().hex
        (GENERATED_DIR / f"model_{model_id}.glb").write_bytes(data)
        return {"model_id": model_id, "model_url": f"/generated/model_{model_id}.glb"}

    @app.post("/api/uploads", status_code=201)
    async def upload_image(request: Request):
        extension = IMAGE_TYPES.get(request.headers.get("content-type", "").split(";")[0].strip())
        if not extension:
            raise HTTPException(400, "Expected a PNG, JPEG or WebP body.")
        data = await request.body()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "The image is larger than 20 MB.")
        name = f"{uuid.uuid4().hex}.{extension}"
        (GENERATED_DIR / "uploads" / name).write_bytes(data)
        return {"url": f"/generated/uploads/{name}"}

    app.mount("/generated", StaticFiles(directory=str(GENERATED_DIR)), name="generated")
    return app


def host_allowed(host: str, extra: set[str]) -> bool:
    name = urlsplit(f"//{host}").hostname or ""
    if name in ("localhost", *extra):
        return True
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        return False


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # Open event streams (browser tabs) would otherwise hold up shutdown forever,
    # and the engine workers are only stopped once shutdown gets that far.
    uvicorn.run(create_app(), host=os.environ.get("API_HOST", "127.0.0.1"),
                port=int(os.environ.get("API_PORT", "8001")), log_level="info", timeout_graceful_shutdown=3)


if __name__ == "__main__":
    main()
