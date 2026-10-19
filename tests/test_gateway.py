"""Gateway tests using the mock engine (real worker subprocess, no GPU)."""

import importlib
import struct
import sys
import time
from pathlib import Path

import warnings

import pytest

with warnings.catch_warnings():
    # Starlette's TestClient warns about its httpx dependency; not our concern.
    warnings.simplefilter("ignore")
    from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ROOM_SETUP_MOCK_ENGINE", "1")
    monkeypatch.setenv("ROOM_SETUP_MOCK_DELAY", "0.05")
    monkeypatch.setenv("GENERATED_DIR", str(tmp_path / "generated"))
    monkeypatch.setenv("LOG_DIR", str(tmp_path / "logs"))
    monkeypatch.setenv("ALLOWED_HOSTS", "testserver")
    for prefix in ("HUNYUAN3D", "TRELLIS", "TRELLIS2"):
        monkeypatch.delenv(f"{prefix}_PYTHON", raising=False)
    gateway = importlib.reload(importlib.import_module("gateway"))
    with TestClient(gateway.create_app()) as test_client:
        yield test_client


def wait_for(client, job_id, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_lists_engines_and_marks_unconfigured(client):
    engines = {e["id"]: e for e in client.get("/api/engines").json()["engines"]}
    assert engines["mock"]["configured"] is True
    assert engines["hunyuan3d"]["configured"] is False
    assert engines["trellis2"]["texture"] == "always"


def test_generates_a_valid_glb(client):
    response = client.post("/api/jobs", data={"engine": "mock", "texture": "false"},
                           files={"file": ("chair.png", PNG, "image/png")})
    assert response.status_code == 202
    job = wait_for(client, response.json()["id"])
    assert job["status"] == "done", job
    glb = client.get(job["model_url"])
    assert glb.status_code == 200
    magic, version, length = struct.unpack("<4sII", glb.content[:12])
    assert (magic, version, length) == (b"glTF", 2, len(glb.content))
    states = {e["id"]: e["state"] for e in client.get("/api/engines").json()["engines"]}
    assert states["mock"] == "ready"


def test_unconfigured_engine_is_rejected(client):
    response = client.post("/api/jobs", data={"engine": "hunyuan3d"},
                           files={"file": ("chair.png", PNG, "image/png")})
    assert response.status_code == 409
    assert "HUNYUAN3D_PYTHON" in response.json()["detail"]


def test_rejects_non_images_and_bad_ids(client):
    response = client.post("/api/jobs", data={"engine": "mock"},
                           files={"file": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 400
    assert client.delete("/api/models/..%2Fsecret").status_code in (400, 404)
    assert client.delete("/api/models/not-a-model").status_code == 400


def test_delete_and_unload(client):
    job = wait_for(client, client.post("/api/jobs", data={"engine": "mock"},
                                       files={"file": ("a.png", PNG, "image/png")}).json()["id"])
    assert client.delete(f"/api/models/{job['model_id']}").status_code == 200
    assert client.get(job["model_url"]).status_code == 404
    engines = client.post("/api/engines/mock/unload").json()["engines"]
    assert {e["id"]: e["state"] for e in engines}["mock"] == "stopped"


def test_rejects_other_sites_and_rebinding_hosts(client):
    assert client.get("/api/engines", headers={"origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/engines", headers={"host": "evil.example"}).status_code == 403
    same = client.get("/api/engines", headers={"host": "127.0.0.1:5173", "origin": "http://127.0.0.1:5173"})
    assert same.status_code == 200


def test_rejects_oversized_uploads_before_reading(client):
    response = client.post("/api/jobs", data={"engine": "mock"},
                           files={"file": ("big.png", b"0" * (21 * 1024 * 1024), "image/png")})
    assert response.status_code == 413


def test_unload_recovers_a_busy_engine(client, monkeypatch):
    monkeypatch.setenv("ROOM_SETUP_MOCK_DELAY", "5")
    job = client.post("/api/jobs", data={"engine": "mock"}, files={"file": ("a.png", PNG, "image/png")}).json()
    deadline = time.time() + 20
    while client.get(f"/api/jobs/{job['id']}").json()["status"] != "running":
        assert time.time() < deadline
        time.sleep(0.05)
    client.post("/api/engines/mock/unload")
    assert wait_for(client, job["id"])["status"] == "error"
    states = {e["id"]: e["state"] for e in client.get("/api/engines").json()["engines"]}
    assert states["mock"] == "stopped"
