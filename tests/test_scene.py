"""Shared room document endpoints and MCP helpers (no GPU, no browser)."""

import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
from test_gateway import PNG, client, wait_for  # noqa: E402,F401  (fixture reuse)

import mcp_server  # noqa: E402


def put(client, scene, base=None):
    return client.put("/api/scene", json={"scene": scene, "base_revision": base, "origin": "test"})


def test_scene_round_trip_and_conflicts(client):
    first = client.get("/api/scene").json()
    assert first["walls"] == [] and first["revision"] == 0
    wall = {"id": "w1", "start": {"x": 0, "y": 0}, "end": {"x": 300, "y": 0}, "finish": None}
    saved = put(client, {**first, "walls": [wall]}, base=0).json()
    assert saved["revision"] == 1 and saved["walls"] == [wall]
    stale = put(client, {**first, "walls": []}, base=0)
    assert stale.status_code == 409
    assert stale.json()["scene"]["revision"] == 1
    assert put(client, {"walls": [], "junk": 1}).json()["revision"] == 2  # no base: last writer wins


def test_job_fills_in_its_scene_item(client):
    scene = client.get("/api/scene").json()
    item = {"id": "chair", "name": "Chair", "status": "generating", "model_url": None, "model_layout": "raw",
            "dimensions": {"width": 50, "depth": 50, "height": 80}, "position": {"x": 0, "y": 0, "z": 0}, "facing": 0}
    put(client, {**scene, "furniture": [item]})
    job = client.post("/api/jobs", data={"engine": "mock", "scene_item": "chair"},
                      files={"file": ("a.png", PNG, "image/png")}).json()
    assert wait_for(client, job["id"])["status"] == "done"
    deadline = time.time() + 5
    while (chair := client.get("/api/scene").json()["furniture"][0])["status"] == "generating":
        assert time.time() < deadline
        time.sleep(0.05)
    assert chair["status"] == "ready" and chair["model_url"].endswith(".glb")
    assert client.get(chair["model_url"]).status_code == 200


def test_render_needs_an_open_browser(client):
    response = client.post("/api/scene/render", json={"mode": "top"})
    assert response.status_code == 409
    assert "browser" in response.json()["detail"]


def test_uploads_validate_their_type(client):
    assert client.post("/api/models", content=b"not a glb").status_code == 400
    assert client.post("/api/uploads", content=b"x", headers={"content-type": "text/plain"}).status_code == 400
    url = client.post("/api/uploads", content=PNG, headers={"content-type": "image/png"}).json()["url"]
    assert client.get(url).content == PNG


def test_product_page_parsing():
    page = """<html><head><title>fallback</title>
    <meta property="og:image" content="https://shop.example/og.jpg"></head><body>
    <span id="productTitle"> ソファ 2人掛け </span>
    <script>var data = {"hiRes":"https://m.media-amazon.com/images/I/sofa1.jpg","large":"https://m.media-amazon.com/images/I/sofa2.jpg"};</script>
    <table><tr><th>商品寸法</th><td>幅150 x 奥行80 x 高さ85 cm</td></tr><tr><th>色</th><td>グレー</td></tr></table>
    </body></html>"""
    product = mcp_server.parse_product(page, "https://www.amazon.co.jp/dp/X")
    assert product["title"] == "ソファ 2人掛け"
    assert product["image_urls"][0] == "https://m.media-amazon.com/images/I/sofa1.jpg"
    assert "https://shop.example/og.jpg" in product["image_urls"]
    assert any("150" in line and "85" in line for line in product["size_text"])
    assert not any("グレー" in line for line in product["size_text"])


def test_image_sniffing():
    assert mcp_server.image_type(PNG) == "image/png"
    assert mcp_server.image_type(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
    assert mcp_server.image_type(b"GIF89a") is None


def test_opening_helpers_match_the_app_rules():
    wall = {"id": "w", "start": {"x": 0, "y": 0}, "end": {"x": 100, "y": 0}}
    clamped = mcp_server.clamp_opening({"width": 300, "height": 500, "sill": 50, "offset": 0}, wall, 240)
    assert (clamped["width"], clamped["offset"], clamped["height"]) == (90, 50, 185)
    walls = {"walls": [wall, {"id": "v", "start": {"x": 100, "y": 0}, "end": {"x": 100, "y": 200}}]}
    nearest, offset, distance = mcp_server.nearest_wall(walls, 98, 120)
    assert nearest["id"] == "v" and offset == 120 and distance == 2
    described = mcp_server.describe_opening({"id": "o", "kind": "window", "wallId": "v", "offset": 50,
                                            "width": 60, "height": 90, "sill": 100}, walls["walls"])
    assert described["centre_cm"] == {"x": 100, "y": 50}


def test_tilt_port_matches_the_app():
    flip = mcp_server.turn_tilt(None, "x", 180)
    assert abs(abs(flip["x"]) - 180) < 0.01 and abs(flip["y"]) < 0.01 and abs(flip["z"]) < 0.01
    back = mcp_server.turn_tilt(mcp_server.turn_tilt(None, "x", 90), "x", -90)
    assert all(abs(v) < 0.01 for v in back.values())


def test_tape_fields_are_checked():
    assert mcp_server.tape_fields(1, -90, "up") == {"length": 5.0, "rotation": 270.0, "emit": "up"}
    assert mcp_server.tape_fields(99999, None, None) == {"length": 2000.0}
    assert mcp_server.tape_fields(None, None, None) == {}
    with pytest.raises(ValueError):
        mcp_server.tape_fields(None, None, "sideways")
