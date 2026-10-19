#!/usr/bin/env python3
"""MCP server that lets an LLM build a room in Room Setup.

The assistant reads the user's photos and floor plan itself (it can see
images) and uses these tools to shape the room, look up products, generate
furniture, place it, and check the result with screenshots. Changes go to the
gateway's shared room document and appear live in any open browser tab.

Run with the gateway's Python:  .venv/bin/python server/mcp_server.py
The gateway (npm run api) must be running; open the app in a browser too if
you want live updates and screenshots.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import mimetypes
import os
import re
import uuid
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin

import httpx
from mcp.server.mcpserver import Context, Image, MCPServer

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/141.0 Safari/537.36",
    "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
    "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8",
}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
FLOOR_PRESETS = ["oak", "hardMaple", "ashClear", "sycamore", "elm", "acacia", "blackCherry", "blackWalnut"]
WALL_PRESETS = ["standard", "woven", "plaster", "greige", "sage", "charcoal"]
# Mirrors OPENING_PRESETS in src/core/openings.js: (kind, style, width, height, sill) in cm.
OPENING_PRESETS = {
    "door-hinged": ("door", "hinged", 80, 200, 0),
    "door-double": ("door", "double", 140, 200, 0),
    "door-sliding": ("door", "sliding", 90, 200, 0),
    "door-opening": ("door", "opening", 90, 200, 0),
    "window-sliding": ("window", "sliding", 165, 110, 90),
    "window-patio": ("window", "sliding", 165, 200, 0),
    "window-tall": ("window", "sliding", 170, 200, 10),
    "window-fixed": ("window", "fixed", 90, 90, 90),
    "window-casement": ("window", "casement", 60, 90, 100),
    "window-high": ("window", "fixed", 120, 30, 180),
}
DOOR_COLORS = ["white", "maple", "oak", "walnut", "grey", "black"]
# Mirrors LIGHT_PRESETS in src/core/lights.js: (mount, drop or height in cm, lumens, kelvin).
LIGHT_PRESETS = {
    "ceiling": ("ceiling", 8, 3800, 5000),
    "pendant": ("ceiling", 70, 810, 2700),
    "downlight": ("ceiling", 2, 600, 3000),
    "spot": ("ceiling", 20, 500, 3000),
    "floor": ("floor", 150, 810, 2700),
    "table": ("floor", 65, 440, 2700),
    "bulb": ("furniture", 0, 810, 2700),
}
TIMES_OF_DAY = ["morning", "day", "evening", "night"]


def load_dotenv(path: Path) -> None:
    """Read KEY=VALUE lines from the project's .env without overriding the environment."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv(PROJECT_ROOT / ".env")
API = os.environ.get("ROOM_SETUP_API", f"http://127.0.0.1:{os.environ.get('API_PORT', '8001')}").rstrip("/")

INSTRUCTIONS = """\
Room Setup tools build a room (walls, finishes, furniture) shown live in the Room Setup web app.

Coordinates: centimetres on the floor plan. x grows to the right, y grows downwards (towards
the viewer of the plan). Put the room's top-left corner near (0, 0). Furniture positions are the
centre of the item's footprint. `facing_deg` is where the item's front points: 0 = down (+y),
90 = right (+x), 180 = up (−y), 270 = left (−x). An item against the top wall facing into the room
therefore has facing 0; against the left wall, facing 90.

Typical workflow for "build my room from photos, a floor plan and product links":
1. Read the floor plan image. Derive the outline in cm (use printed dimensions; tatami/帖 and
   grid hints help) and call set_room_outline. Use add_wall for partitions, and add_opening for
   the doors and windows shown on the plan or in the photos.
2. Look at the photos (usually taken from the room centre towards each corner) to match flooring
   and wallpaper to the closest presets (set_finishes), and to see where each piece of furniture
   stands and which way it faces. Relate each photo to the plan before placing anything.
3. For each product link, call lookup_product to get the product image and its size. Prefer the
   size stated on the page; otherwise estimate from the photos. width = side-to-side as seen from
   the front, depth = front-to-back. For items without a link, crop_photo cuts them out of a photo.
4. Call add_furniture for each item with its image, size, position and facing. Generation runs in
   the background (about 1–3 minutes per item, one at a time); a translucent box stands in
   meanwhile. Call wait_for_furniture, then render_view (mode "top" and "overview", or "custom"
   from the photo's viewpoint) and compare with the photos. Adjust with update_furniture.
5. If asked about lighting, place fixtures with add_light (match the ceiling lights in the photos)
   and check them with set_time_of_day("night") and render_view.
Tell the user what you assumed (room size, item sizes) so they can correct you.
"""

logging.getLogger("httpx").setLevel(logging.WARNING)  # keep request logs out of the client's stderr
mcp = MCPServer("room-setup", instructions=INSTRUCTIONS)
client = httpx.AsyncClient(base_url=API, timeout=httpx.Timeout(60, connect=5))


# ---- helpers ----
async def api(method: str, path: str, **kwargs) -> httpx.Response:
    try:
        response = await client.request(method, path, **kwargs)
    except httpx.ConnectError:
        raise RuntimeError(f"Room Setup API is not running at {API}. Start it with `npm run api`.") from None
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail")
        except ValueError:
            detail = response.text[:300]
        raise RuntimeError(f"{method} {path} failed ({response.status_code}): {detail}")
    return response


async def get_scene() -> dict:
    return (await api("GET", "/api/scene")).json()


async def mutate(change) -> object:
    """Read-modify-write the room document, retrying if the user edits it meanwhile."""
    for _ in range(6):
        document = await get_scene()
        revision = document.pop("revision")
        result = change(document)
        response = await client.put("/api/scene", json={"scene": document, "base_revision": revision, "origin": "mcp"})
        if response.status_code == 409:
            await asyncio.sleep(0.2)
            continue
        if response.status_code >= 400:
            raise RuntimeError(f"Saving the room failed: {response.text[:300]}")
        return result
    raise RuntimeError("The room kept changing while saving; try again.")


def image_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def read_image(source: str) -> tuple[bytes, str]:
    """Image bytes from an http(s) URL or a local file path."""
    if re.match(r"^https?://", source):
        async with httpx.AsyncClient(headers=BROWSER_HEADERS, follow_redirects=True, timeout=30) as web:
            response = await web.get(source)
            response.raise_for_status()
            data = response.content
    else:
        path = Path(source).expanduser()
        if not path.is_file():
            raise ValueError(f"No such image file: {source}")
        data = path.read_bytes()
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("The image is larger than 20 MB.")
    kind = image_type(data)
    if not kind:
        raise ValueError("Use a PNG, JPEG or WebP image.")
    return data, kind


async def upload_image(data: bytes, kind: str) -> str:
    return (await api("POST", "/api/uploads", content=data, headers={"content-type": kind})).json()["url"]


def find_item(document: dict, item_id: str) -> dict:
    for item in document["furniture"]:
        if item["id"] == item_id:
            return item
    raise ValueError(f"No furniture with id {item_id!r}. Call get_room to see ids.")


TILT_TURNS = {"flip": ("x", 180), "forward": ("x", 90), "backward": ("x", -90), "left": ("z", 90), "right": ("z", -90)}


def turn_tilt(tilt: dict | None, axis: str, degrees: float) -> dict:
    """Port of turnTilt in src/core/tilt.js: Euler XYZ degrees, turns about room axes."""
    import math
    t = tilt or {}
    x, y, z = (math.radians(t.get(k, 0) or 0) / 2 for k in "xyz")
    c1, c2, c3, s1, s2, s3 = math.cos(x), math.cos(y), math.cos(z), math.sin(x), math.sin(y), math.sin(z)
    q = (s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3)
    half = math.radians(degrees) / 2
    r = [0.0, 0.0, 0.0, math.cos(half)]
    r["xyz".index(axis)] = math.sin(half)
    ax, ay, az, aw = r
    bx, by, bz, bw = q
    qx, qy, qz, qw = (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                      aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)
    m11, m12, m13 = 1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy)
    m22, m23, m32, m33 = 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy)
    ey = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        ex, ez = math.atan2(-m23, m33), math.atan2(-m12, m11)
    else:
        ex, ez = math.atan2(m32, m22), 0.0
    return {k: round(math.degrees(v), 2) + 0.0 for k, v in zip("xyz", (ex, ey, ez))}


def wall_geometry(wall: dict) -> tuple[float, float, float]:
    dx, dy = wall["end"]["x"] - wall["start"]["x"], wall["end"]["y"] - wall["start"]["y"]
    length = (dx * dx + dy * dy) ** 0.5 or 1.0
    return length, dx / length, dy / length


def clamp_opening(opening: dict, wall: dict, ceiling: float) -> dict:
    """Same rules as clampOpening in src/core/openings.js."""
    length, _, _ = wall_geometry(wall)
    width = max(20.0, min(float(opening["width"]), length - 10))
    sill = max(0.0, min(float(opening["sill"]), ceiling - 25))
    height = max(20.0, min(float(opening["height"]), ceiling - 5 - sill))
    half = width / 2
    offset = min(max(float(opening["offset"]), half + 5), max(half + 5, length - half - 5))
    return {**opening, "width": width, "height": height, "sill": sill, "offset": offset}


def nearest_wall(document: dict, x: float, y: float) -> tuple[dict, float, float]:
    """(wall, offset along it, distance) for the wall closest to plan point (x, y)."""
    best = None
    for wall in document["walls"]:
        length, ux, uy = wall_geometry(wall)
        along = max(0.0, min(length, (x - wall["start"]["x"]) * ux + (y - wall["start"]["y"]) * uy))
        px, py = wall["start"]["x"] + ux * along, wall["start"]["y"] + uy * along
        distance = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
        if best is None or distance < best[2]:
            best = (wall, along, distance)
    if best is None:
        raise ValueError("The room has no walls yet.")
    return best


def describe(document: dict) -> dict:
    walls = document["walls"]
    xs = [p[k] for w in walls for p in (w["start"], w["end"]) for k in ("x",)]
    ys = [p[k] for w in walls for p in (w["start"], w["end"]) for k in ("y",)]
    return {
        "revision": document.get("revision"),
        "ceiling_height_cm": document["ceilingHeight"],
        "bounds_cm": {"min_x": min(xs), "max_x": max(xs), "min_y": min(ys), "max_y": max(ys)} if walls else None,
        "walls": [{
            "id": w["id"], "start": w["start"], "end": w["end"],
            "length_cm": round(((w["end"]["x"] - w["start"]["x"]) ** 2 + (w["end"]["y"] - w["start"]["y"]) ** 2) ** 0.5, 1),
            **({"finish": w["finish"]} if w.get("finish") else {}),
        } for w in walls],
        "floor": document["floor"],
        "wall": document["wall"],
        "openings": [describe_opening(o, walls) for o in document.get("openings", [])],
        "time_of_day": document.get("timeOfDay", "day"),
        "lights": [{
            "id": l["id"], "preset": l["preset"],
            **({"in_furniture": l["attach"]["furnitureId"], "offset_x_cm": l["attach"].get("dx", 0),
                "offset_front_cm": l["attach"].get("dz", 0), "height_above_item_base_cm": l["attach"].get("dy")}
               if l.get("attach") else {"x_cm": l["x"], "y_cm": l["y"]}),
            **({"below_ceiling_cm": l.get("drop")} if LIGHT_PRESETS.get(l["preset"], ("ceiling",))[0] == "ceiling"
               else {"height_cm": l.get("height")} if not l.get("attach") else {}),
            "lumens": l["lumens"], "kelvin": l["kelvin"], "on": l.get("on", True), "shadows": l.get("shadows", True),
        } for l in document.get("lights", [])],
        "furniture": [{
            "id": f["id"], "name": f.get("name"), "status": f.get("status", "ready"),
            **({"error": f["error"]} if f.get("error") else {}),
            "engine": f.get("engine"), "size_cm": f.get("dimensions"),
            "x_cm": f["position"]["x"], "y_cm": f["position"]["z"], "elevation_cm": f["position"]["y"],
            "facing_deg": f.get("facing", 0),
        } for f in document["furniture"]],
        "presets": {"floor": FLOOR_PRESETS, "wall": WALL_PRESETS, "openings": list(OPENING_PRESETS)},
    }


def describe_opening(opening: dict, walls: list[dict]) -> dict:
    wall = next((w for w in walls if w["id"] == opening.get("wallId")), None)
    centre = None
    if wall:
        _, ux, uy = wall_geometry(wall)
        centre = {"x": round(wall["start"]["x"] + ux * opening["offset"], 1),
                  "y": round(wall["start"]["y"] + uy * opening["offset"], 1)}
    return {
        "id": opening["id"], "kind": opening["kind"], "preset": opening.get("preset"), "style": opening.get("style"),
        "wall_id": opening.get("wallId"), "centre_cm": centre, "width_cm": opening["width"],
        "height_cm": opening["height"], "sill_cm": opening["sill"],
        **({"hinge": opening.get("hinge"), "opens_to_side": opening.get("side"), "color": opening.get("color", "white"),
            "open_percent": opening.get("open", 25)}
           if opening["kind"] == "door" else {}),
    }


# ---- room ----
@mcp.tool()
async def get_room() -> dict:
    """Current walls, finishes and furniture (ids, sizes, positions, generation status)."""
    return describe(await get_scene())


@mcp.tool()
async def set_room_outline(points: list[dict], ceiling_height_cm: float | None = None) -> dict:
    """Replace all walls with a closed outline.

    points: corners in order, e.g. [{"x":0,"y":0},{"x":360,"y":0},{"x":360,"y":270},{"x":0,"y":270}].
    The last corner connects back to the first. Furniture is kept; doors and windows are removed
    (add them again with add_opening).
    """
    if len(points) < 3:
        raise ValueError("An outline needs at least three corners.")
    corners = [{"x": float(p["x"]), "y": float(p["y"])} for p in points]

    def change(document):
        document["walls"] = [{"id": f"w{uuid.uuid4().hex[:8]}", "start": a, "end": corners[(i + 1) % len(corners)],
                              "finish": None} for i, a in enumerate(corners)]
        document["openings"] = []  # they belonged to the old walls
        if ceiling_height_cm:
            document["ceilingHeight"] = float(ceiling_height_cm)
    await mutate(change)
    return describe(await get_scene())


@mcp.tool()
async def add_wall(x1_cm: float, y1_cm: float, x2_cm: float, y2_cm: float) -> dict:
    """Add one wall segment (e.g. a partition). End points on existing walls join them."""
    def change(document):
        document["walls"].append({"id": f"w{uuid.uuid4().hex[:8]}", "start": {"x": x1_cm, "y": y1_cm},
                                  "end": {"x": x2_cm, "y": y2_cm}, "finish": None})
    await mutate(change)
    return describe(await get_scene())


@mcp.tool()
async def remove_wall(wall_id: str) -> dict:
    """Delete a wall by id."""
    def change(document):
        before = len(document["walls"])
        document["walls"] = [w for w in document["walls"] if w["id"] != wall_id]
        if len(document["walls"]) == before:
            raise ValueError(f"No wall with id {wall_id!r}.")
        document["openings"] = [o for o in document.get("openings", []) if o.get("wallId") != wall_id]
    await mutate(change)
    return describe(await get_scene())


@mcp.tool()
async def set_ceiling_height(height_cm: float) -> str:
    """Set the ceiling height (typical Japanese homes: 240 cm)."""
    await mutate(lambda d: d.update(ceilingHeight=float(height_cm)))
    return f"Ceiling height set to {height_cm} cm."


@mcp.tool()
async def set_finishes(
    floor_preset: str | None = None,
    floor_image: str | None = None,
    floor_scale: float | None = None,
    wall_preset: str | None = None,
    wall_image: str | None = None,
    wall_scale: float | None = None,
    wall_id: str | None = None,
) -> dict:
    """Choose flooring and wallpaper.

    Presets — floor: oak, hardMaple, ashClear, sycamore, elm, acacia, blackCherry, blackWalnut;
    wall: standard (white vinyl), woven, plaster, greige, sage, charcoal.
    *_image: a URL or local path of a tileable texture photo instead of a preset.
    *_scale: pattern size multiplier (1 = one texture tile per metre; larger = denser).
    wall_id: apply the wallpaper to one wall only (an accent wall).
    """
    floor = {"preset": floor_preset} if floor_preset else None
    wall = {"preset": wall_preset} if wall_preset else None
    if floor_preset and floor_preset not in FLOOR_PRESETS:
        raise ValueError(f"Unknown floor preset. Use one of {FLOOR_PRESETS}.")
    if wall_preset and wall_preset not in WALL_PRESETS:
        raise ValueError(f"Unknown wall preset. Use one of {WALL_PRESETS}.")
    if floor_image:
        floor = {"image": await upload_image(*await read_image(floor_image))}
    if wall_image:
        wall = {"image": await upload_image(*await read_image(wall_image))}

    def change(document):
        if floor:
            document["floor"]["finish"] = floor
        if floor_scale:
            document["floor"]["scale"] = float(floor_scale)
        if wall_scale:
            document["wall"]["scale"] = float(wall_scale)
        if wall and wall_id:
            target = next((w for w in document["walls"] if w["id"] == wall_id), None)
            if not target:
                raise ValueError(f"No wall with id {wall_id!r}.")
            target["finish"] = wall
        elif wall:
            document["wall"]["finish"] = wall
    await mutate(change)
    room = describe(await get_scene())
    return {"floor": room["floor"], "wall": room["wall"]}


@mcp.tool()
async def clear_room(keep_finishes: bool = True) -> str:
    """Remove all walls and furniture (and reset finishes unless keep_finishes)."""
    def change(document):
        document["walls"] = []
        document["openings"] = []
        document["lights"] = []
        document["furniture"] = []
        if not keep_finishes:
            document["floor"] = {"finish": {"preset": "oak"}, "scale": 1}
            document["wall"] = {"finish": {"preset": "standard"}, "scale": 1}
    await mutate(change)
    return "The room is empty."


# ---- doors & windows ----
@mcp.tool()
async def add_opening(
    preset: str,
    x_cm: float,
    y_cm: float,
    width_cm: float | None = None,
    height_cm: float | None = None,
    sill_cm: float | None = None,
    wall_id: str | None = None,
    color: str = "white",
    open_percent: float = 25,
) -> dict:
    """Put a door or window in a wall.

    preset: door-hinged, door-double, door-sliding, door-opening (doorway without a door),
    window-sliding (引き違い), window-patio (floor-level sliding, 掃き出し), window-fixed (FIX),
    window-tall (large sliding window 10 cm above the floor, 200 cm high), window-casement
    (縦すべり出し), window-high (high slit). Sizes default to the preset's.
    color (doors): white, maple, oak, walnut, grey or black.
    open_percent (doors): how far open the door is drawn in 3D, 0 (closed) to 100 (hinged: 90°).
    x_cm, y_cm: the opening's centre; it snaps onto the nearest wall (or wall_id).
    sill_cm: height of the bottom edge above the floor (windows; doors are 0).
    """
    if preset not in OPENING_PRESETS:
        raise ValueError(f"Unknown preset. Use one of {list(OPENING_PRESETS)}.")
    if color not in DOOR_COLORS:
        raise ValueError(f"Unknown door color. Use one of {DOOR_COLORS}.")
    kind, style, width, height, sill = OPENING_PRESETS[preset]

    def change(document):
        if wall_id:
            wall = next((w for w in document["walls"] if w["id"] == wall_id), None)
            if not wall:
                raise ValueError(f"No wall with id {wall_id!r}.")
            length, ux, uy = wall_geometry(wall)
            offset = (x_cm - wall["start"]["x"]) * ux + (y_cm - wall["start"]["y"]) * uy
        else:
            wall, offset, distance = nearest_wall(document, x_cm, y_cm)
            if distance > 60:
                raise ValueError(f"({x_cm}, {y_cm}) is {distance:.0f} cm from the nearest wall; give a point on a wall.")
        # Doors open into the room: towards the centre of the walls' bounding box.
        _, ux, uy = wall_geometry(wall)
        xs = [p["x"] for w in document["walls"] for p in (w["start"], w["end"])]
        ys = [p["y"] for w in document["walls"] for p in (w["start"], w["end"])]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        side = 1 if (cx - x_cm) * -uy + (cy - y_cm) * ux >= 0 else -1
        opening = clamp_opening({
            "id": f"o{uuid.uuid4().hex[:10]}", "kind": kind, "preset": preset, "style": style, "wallId": wall["id"],
            "offset": offset, "width": width_cm or width, "height": height_cm or height,
            "sill": 0 if kind == "door" else (sill if sill_cm is None else sill_cm), "hinge": "start", "side": side,
            **({"color": color, "open": max(0.0, min(100.0, float(open_percent)))} if kind == "door" else {}),
        }, wall, document["ceilingHeight"])
        document.setdefault("openings", []).append(opening)
        return describe_opening(opening, document["walls"])
    return await mutate(change)


@mcp.tool()
async def update_opening(
    opening_id: str,
    width_cm: float | None = None,
    height_cm: float | None = None,
    sill_cm: float | None = None,
    x_cm: float | None = None,
    y_cm: float | None = None,
    style: str | None = None,
    color: str | None = None,
    open_percent: float | None = None,
    flip_hinge: bool = False,
    flip_side: bool = False,
) -> dict:
    """Resize or move a door/window (x/y move its centre along/onto a wall), change its style
    (doors: hinged, double, sliding, opening; windows: sliding, fixed, casement), set a door's color
    (white, maple, oak, walnut, grey, black) or how far it is open in 3D (open_percent 0–100), or flip a
    door's hinge side (for sliding doors: the direction it slides) or the side it opens to."""
    def change(document):
        openings = document.get("openings", [])
        opening = next((o for o in openings if o["id"] == opening_id), None)
        if not opening:
            raise ValueError(f"No opening with id {opening_id!r}. Call get_room to see ids.")
        wall = next(w for w in document["walls"] if w["id"] == opening["wallId"])
        if x_cm is not None and y_cm is not None:
            wall, opening["offset"], _ = nearest_wall(document, x_cm, y_cm)
            opening["wallId"] = wall["id"]
        for key, value in (("width", width_cm), ("height", height_cm), ("sill", sill_cm)):
            if value is not None:
                opening[key] = float(value)
        if style:
            opening["style"] = style
        if color:
            if color not in DOOR_COLORS:
                raise ValueError(f"Unknown door color. Use one of {DOOR_COLORS}.")
            opening["color"] = color
        if open_percent is not None:
            opening["open"] = max(0.0, min(100.0, float(open_percent)))
        if flip_hinge:
            opening["hinge"] = "start" if opening.get("hinge") == "end" else "end"
        if flip_side:
            opening["side"] = -(opening.get("side") or 1)
        updated = clamp_opening(opening, wall, document["ceilingHeight"])
        openings[openings.index(opening)] = updated
        return describe_opening(updated, document["walls"])
    return await mutate(change)


@mcp.tool()
async def remove_opening(opening_id: str) -> str:
    """Delete a door or window."""
    def change(document):
        before = len(document.get("openings", []))
        document["openings"] = [o for o in document.get("openings", []) if o["id"] != opening_id]
        if len(document["openings"]) == before:
            raise ValueError(f"No opening with id {opening_id!r}.")
    await mutate(change)
    return f"Removed {opening_id}."


# ---- lighting ----
@mcp.tool()
async def set_time_of_day(time: str) -> str:
    """Daylight setting for the 3D view: morning, day, evening or night. By day the sun comes in
    through the windows; at night only the placed lights are on."""
    if time not in TIMES_OF_DAY:
        raise ValueError(f"Use one of {TIMES_OF_DAY}.")
    await mutate(lambda d: d.update(timeOfDay=time))
    return f"Time of day: {time}."


@mcp.tool()
async def add_light(
    preset: str,
    x_cm: float = 0,
    y_cm: float = 0,
    lumens: float | None = None,
    kelvin: float | None = None,
    below_ceiling_cm: float | None = None,
    height_cm: float | None = None,
    on: bool = True,
    shadows: bool = True,
    attach_to_furniture_id: str | None = None,
    offset_x_cm: float = 0,
    offset_front_cm: float = 0,
) -> dict:
    """Place a light fixture, or put a light source inside a piece of furniture.

    To make a generated lamp glow, pass attach_to_furniture_id (the lamp's id) instead of a
    position: the light moves with the item. height_cm is then the height above the item's base
    (default: 85% of its height), offset_x_cm / offset_front_cm shift it within the item. Shadows
    default to off for these, since a closed lamp mesh would block its own light.

    preset: ceiling (シーリング, 3800 lm 5000 K), pendant (810 lm 2700 K, hangs 70 cm), downlight
    (600 lm, recessed), spot (500 lm), floor (floor lamp, 150 cm), table (table lamp, 65 cm).
    kelvin: 2700 電球色 (warm), 3500 温白色, 5000 昼白色, 6500 昼光色 (cool).
    Ceiling-mounted lights take below_ceiling_cm (how far they hang); lamps take height_cm.
    At most four lights cast shadows at once.
    """
    if attach_to_furniture_id:
        document = await get_scene()
        item = next((f for f in document["furniture"] if f["id"] == attach_to_furniture_id), None)
        if not item:
            raise ValueError(f"No furniture with id {attach_to_furniture_id!r}.")
        light = {
            "id": f"l{uuid.uuid4().hex[:10]}", "preset": "bulb", "x": 0.0, "y": 0.0,
            "attach": {"furnitureId": attach_to_furniture_id, "dx": float(offset_x_cm), "dz": float(offset_front_cm),
                       "dy": float(height_cm if height_cm is not None else round(item["dimensions"]["height"] * 0.85))},
            "lumens": float(lumens or 810), "kelvin": float(kelvin or 2700), "on": on, "shadows": False,
        }
        await mutate(lambda d: d.setdefault("lights", []).append(light))
        return light
    if preset not in LIGHT_PRESETS or preset == "bulb":
        raise ValueError(f"Unknown preset. Use one of {[p for p in LIGHT_PRESETS if p != 'bulb']}.")
    mount, offset, default_lumens, default_kelvin = LIGHT_PRESETS[preset]
    light = {
        "id": f"l{uuid.uuid4().hex[:10]}", "preset": preset, "x": float(x_cm), "y": float(y_cm),
        **({"drop": float(below_ceiling_cm if below_ceiling_cm is not None else offset)} if mount == "ceiling"
           else {"height": float(height_cm if height_cm is not None else offset)}),
        "lumens": float(lumens or default_lumens), "kelvin": float(kelvin or default_kelvin), "on": on, "shadows": shadows,
    }
    await mutate(lambda d: d.setdefault("lights", []).append(light))
    return light


@mcp.tool()
async def update_light(
    light_id: str,
    x_cm: float | None = None,
    y_cm: float | None = None,
    lumens: float | None = None,
    kelvin: float | None = None,
    below_ceiling_cm: float | None = None,
    height_cm: float | None = None,
    on: bool | None = None,
    shadows: bool | None = None,
) -> dict:
    """Move a light, change its brightness or colour temperature, or switch it on/off."""
    def change(document):
        light = next((l for l in document.get("lights", []) if l["id"] == light_id), None)
        if not light:
            raise ValueError(f"No light with id {light_id!r}. Call get_room to see ids.")
        if light.get("attach"):
            # Lights in furniture: x/y shift within the item, height is above its base.
            for key, value in (("dx", x_cm), ("dz", y_cm), ("dy", height_cm)):
                if value is not None:
                    light["attach"][key] = float(value)
            x, y, h = None, None, None
        else:
            x, y, h = x_cm, y_cm, height_cm
        for key, value in (("x", x), ("y", y), ("lumens", lumens), ("kelvin", kelvin),
                           ("drop", below_ceiling_cm), ("height", h)):
            if value is not None:
                light[key] = float(value)
        if on is not None:
            light["on"] = on
        if shadows is not None:
            light["shadows"] = shadows
        return light
    return await mutate(change)


@mcp.tool()
async def remove_light(light_id: str) -> str:
    """Delete a light fixture."""
    def change(document):
        before = len(document.get("lights", []))
        document["lights"] = [l for l in document.get("lights", []) if l["id"] != light_id]
        if len(document["lights"]) == before:
            raise ValueError(f"No light with id {light_id!r}.")
    await mutate(change)
    return f"Removed {light_id}."


# ---- products ----
def page_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style|noscript|svg)\b.*?</\1>", " ", markup)
    markup = re.sub(r"(?i)</t[hd]>", " : ", markup)
    markup = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d|dt|dd|span)>", "\n", markup)
    text = html.unescape(re.sub(r"<[^>]+>", " ", markup))
    lines = (re.sub(r"[ \t　‎‏]+", " ", line).strip(" :") for line in text.splitlines())
    return "\n".join(line for line in lines if line)


DIMENSION_WORDS = re.compile(r"寸法|サイズ|外形|幅|奥行|高さ|dimension|size|width|depth|height", re.I)
DIMENSION_NUMBERS = re.compile(r"\d+(?:\.\d+)?\s*(?:cm|mm|センチ|ミリ|inch|inches|in\b|″|\")", re.I)


def parse_product(markup: str, url: str) -> dict:
    def meta(name):
        match = re.search(rf'<meta[^>]+(?:property|name)=["\']{name}["\'][^>]+content=["\']([^"\']+)', markup, re.I) \
            or re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{name}["\']', markup, re.I)
        return html.unescape(match.group(1)) if match else None

    title_match = re.search(r'id=["\']productTitle["\'][^>]*>(.*?)</', markup, re.S)
    title = (html.unescape(title_match.group(1)).strip() if title_match else None) or meta("og:title")
    if not title:
        tag = re.search(r"<title[^>]*>(.*?)</title>", markup, re.S | re.I)
        title = html.unescape(tag.group(1)).strip() if tag else None

    images: list[str] = []
    patterns = [
        r'"hiRes"\s*:\s*"(https?://[^"]+)"',         # Amazon gallery
        r'data-old-hires=["\'](https?://[^"\']+)',   # Amazon main image
        r'"large"\s*:\s*"(https?://[^"]+)"',
    ]
    for pattern in patterns:
        images += re.findall(pattern, markup)
    for block in re.findall(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>', markup):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        for node in data if isinstance(data, list) else [data]:
            image = node.get("image") if isinstance(node, dict) else None
            images += [image] if isinstance(image, str) else [i for i in image or [] if isinstance(i, str)]
    images += [m for m in (meta("og:image"), meta("twitter:image")) if m]
    images = list(dict.fromkeys(urljoin(url, i) for i in images))[:8]

    text = page_text(markup)
    size_lines = []
    for line in text.splitlines():
        if len(line) < 200 and DIMENSION_NUMBERS.search(line) and (DIMENSION_WORDS.search(line) or re.search(r"[x×*]", line)):
            size_lines.append(line)
    return {"title": title, "image_urls": images, "size_text": list(dict.fromkeys(size_lines))[:15]}


@mcp.tool()
async def lookup_product(url: str) -> list:
    """Fetch a product page (Amazon, IKEA, Nitori, Rakuten, …) and return its title, size text
    and image URLs, plus the main product image so you can check it is the right item.

    Product photos on a plain background work best for generation; pass one of image_urls to
    add_furniture. Some shops block automated access — if this fails, ask the user for the
    product image and size instead.
    """
    async with httpx.AsyncClient(headers=BROWSER_HEADERS, follow_redirects=True, timeout=30) as web:
        response = await web.get(url)
    markup = response.text
    if response.status_code >= 400 or re.search(r"captcha|automated access|robot check", markup[:20000], re.I):
        raise RuntimeError(f"The shop refused automated access (HTTP {response.status_code}). "
                           "Ask the user for the product image and dimensions.")
    product = parse_product(markup, str(response.url))
    result: list = [json.dumps(product, ensure_ascii=False, indent=2)]
    for image_url in product["image_urls"][:1]:
        try:
            data, kind = await read_image(image_url)
            result.append(Image(data=data, format=kind.split("/")[1]))
        except Exception as error:  # noqa: BLE001 - the text result is still useful
            result.append(f"(Could not download the main image: {error})")
    return result


@mcp.tool()
async def crop_photo(path: str, left: float, top: float, right: float, bottom: float) -> list:
    """Cut one piece of furniture out of a room photo, to use as add_furniture's image when
    there is no product link. Coordinates are fractions of the photo (0–1, origin top-left).
    Keep the whole item in the box with a little margin. Returns the saved file path and a preview.
    """
    from PIL import Image as PILImage, ImageOps

    source = Path(path).expanduser()
    if not source.is_file():
        raise ValueError(f"No such file: {path}")
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        raise ValueError("Use fractions with 0 <= left < right <= 1 and 0 <= top < bottom <= 1.")
    with PILImage.open(source) as photo:
        photo = ImageOps.exif_transpose(photo).convert("RGB")
        w, h = photo.size
        crop = photo.crop((round(left * w), round(top * h), round(right * w), round(bottom * h)))
    crops = Path(os.environ.get("GENERATED_DIR", PROJECT_ROOT / "generated")).expanduser() / "crops"
    crops.mkdir(parents=True, exist_ok=True)
    target = crops / f"{source.stem}-{uuid.uuid4().hex[:6]}.png"
    crop.save(target)
    preview = crop.copy()
    preview.thumbnail((512, 512))
    buffer = BytesIO()
    preview.save(buffer, format="PNG")
    return [f"Saved crop to {target}", Image(data=buffer.getvalue(), format="png")]


# ---- furniture ----
@mcp.tool()
async def list_engines() -> dict:
    """Generation engines, whether they are set up, and which one is the default."""
    data = (await api("GET", "/api/engines")).json()
    return {"default": data.get("default"), "engines": [
        {k: e[k] for k in ("id", "label", "configured", "state", "texture")} for e in data["engines"]]}


@mcp.tool()
async def add_furniture(
    name: str,
    image: str,
    width_cm: float,
    depth_cm: float,
    height_cm: float,
    x_cm: float,
    y_cm: float,
    facing_deg: float = 0,
    elevation_cm: float = 0,
    engine: str | None = None,
    texture: bool = False,
) -> dict:
    """Generate a 3D model from a product image and place it in the room.

    image: URL or local path (a clean product shot works best).
    width/depth/height: the real size; the model is scaled to it.
    x_cm, y_cm: footprint centre on the plan. facing_deg: 0 = front faces +y (down on the plan),
    90 = +x, 180 = −y, 270 = −x. elevation_cm: height above the floor (wall shelves etc.).
    engine: hunyuan3d / trellis2 / trellis / pixal3d / sam3d (default: the app's default engine).
    pixal3d follows the photo closely; sam3d copes best with cluttered real-world photos.
    texture: Hunyuan3D only — paint textures (slower); other engines are always coloured.
    Returns immediately; the item shows as a translucent box until generation finishes.
    """
    data, kind = await read_image(image)
    if not engine:
        engines = (await api("GET", "/api/engines")).json()
        usable = [e["id"] for e in engines["engines"] if e["configured"] and e["id"] != "mock"]
        engine = engines.get("default") if engines.get("default") in usable else (usable[0] if usable else "mock")
    thumbnail = await upload_image(data, kind)
    item_id = uuid.uuid4().hex
    entry = {
        "id": item_id, "name": name, "engine": engine, "status": "generating", "job_id": None, "error": None,
        "model_url": None, "model_layout": "raw",
        "dimensions": {"width": float(width_cm), "depth": float(depth_cm), "height": float(height_cm)},
        "position": {"x": float(x_cm), "y": float(elevation_cm), "z": float(y_cm)},
        "facing": float(facing_deg) % 360, "thumbnail_url": thumbnail,
    }
    await mutate(lambda d: d["furniture"].append(entry))
    extension = mimetypes.guess_extension(kind) or ".png"
    try:
        job = (await api("POST", "/api/jobs", data={
            "engine": engine, "texture": str(bool(texture)).lower(), "scene_item": item_id,
        }, files={"file": (f"product{extension}", data, kind)})).json()
    except Exception as error:
        await mutate(lambda d: find_item(d, item_id).update(status="failed", error=str(error)))
        raise
    await mutate(lambda d: find_item(d, item_id).update(job_id=job["id"]))
    return {"id": item_id, "job_id": job["id"], "engine": engine, "status": "generating",
            "queue_position": job.get("queue_position")}


@mcp.tool()
async def update_furniture(
    furniture_id: str,
    x_cm: float | None = None,
    y_cm: float | None = None,
    facing_deg: float | None = None,
    elevation_cm: float | None = None,
    name: str | None = None,
    width_cm: float | None = None,
    depth_cm: float | None = None,
    height_cm: float | None = None,
    flip_upside_down: bool = False,
    tip: str | None = None,
) -> dict:
    """Move, turn, rename or resize a piece of furniture. Omitted values stay as they are.

    If a generated model came out upside down or lying on its side (check with render_view),
    fix it with flip_upside_down=True, or tip="forward" | "backward" | "left" | "right" (90°,
    about the room's axes before facing is applied). The size is kept and it stays on the floor.
    """
    def change(document):
        item = find_item(document, furniture_id)
        if x_cm is not None:
            item["position"]["x"] = float(x_cm)
        if y_cm is not None:
            item["position"]["z"] = float(y_cm)
        if elevation_cm is not None:
            item["position"]["y"] = float(elevation_cm)
        if facing_deg is not None:
            item["facing"] = float(facing_deg) % 360
        if name:
            item["name"] = name
        for key, value in (("width", width_cm), ("depth", depth_cm), ("height", height_cm)):
            if value is not None:
                item["dimensions"][key] = float(value)
        if tip and tip not in ("forward", "backward", "left", "right"):
            raise ValueError("tip must be forward, backward, left or right.")
        for turn in (["flip"] if flip_upside_down else []) + ([tip] if tip else []):
            item["tilt"] = turn_tilt(item.get("tilt"), *TILT_TURNS[turn])
        return item
    await mutate(change)
    return next(f for f in describe(await get_scene())["furniture"] if f["id"] == furniture_id)


@mcp.tool()
async def remove_furniture(furniture_id: str) -> str:
    """Delete a piece of furniture."""
    def change(document):
        find_item(document, furniture_id)
        document["furniture"] = [f for f in document["furniture"] if f["id"] != furniture_id]
    await mutate(change)
    return f"Removed {furniture_id}."


@mcp.tool()
async def wait_for_furniture(ctx: Context, timeout_s: float = 900) -> dict:
    """Wait until no furniture is still generating (or the timeout passes) and report results."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_s
    total = None
    while True:
        document = await get_scene()
        pending = [f for f in document["furniture"] if f.get("status") == "generating"]
        total = max(total or 0, len(pending))
        if not pending or loop.time() > deadline:
            break
        stages = []
        for item in pending[:3]:
            if item.get("job_id"):
                try:
                    job = (await api("GET", f"/api/jobs/{item['job_id']}")).json()
                    stages.append(f"{item['name']}: {job['status']}{'/' + job['stage'] if job.get('stage') else ''}")
                except RuntimeError:
                    pass
        await ctx.report_progress(total - len(pending), total, "; ".join(stages) or None)
        await asyncio.sleep(3)
    room = describe(document)
    return {
        "still_generating": [f["name"] for f in room["furniture"] if f["status"] == "generating"],
        "failed": [{"name": f["name"], "error": f.get("error")} for f in room["furniture"] if f["status"] == "failed"],
        "furniture": room["furniture"],
    }


# ---- looking at the result ----
@mcp.tool()
async def render_view(
    mode: str = "overview",
    eye_x_cm: float | None = None,
    eye_y_cm: float | None = None,
    eye_height_cm: float = 150,
    look_x_cm: float | None = None,
    look_y_cm: float | None = None,
    look_height_cm: float = 100,
    fov_deg: float = 65,
    width: int = 1280,
    height: int = 800,
) -> Image:
    """Screenshot of the room from the open Room Setup app.

    mode: "overview" (3D from above at an angle), "top" (3D straight down), "plan" (2D floor
    plan with furniture footprints) or "custom" (3D from eye_* towards look_*; use this to
    reproduce one of the user's photos, e.g. from the room centre towards a corner).
    """
    view: dict = {"mode": mode, "width": width, "height": height}
    if mode == "custom":
        if None in (eye_x_cm, eye_y_cm, look_x_cm, look_y_cm):
            raise ValueError("custom mode needs eye_x_cm, eye_y_cm, look_x_cm and look_y_cm.")
        view.update(eye={"x": eye_x_cm, "y": eye_height_cm, "z": eye_y_cm},
                    target={"x": look_x_cm, "y": look_height_cm, "z": look_y_cm}, fov=fov_deg)
    response = await api("POST", "/api/scene/render", json=view)
    return Image(data=response.content, format="png")


@mcp.prompt()
def furnish_room(photos: str, floor_plan: str = "", product_urls: str = "") -> str:
    """Build the user's room in Room Setup from photos, a floor plan and product links."""
    return f"""Recreate my room in Room Setup using the room-setup tools.

Photos (taken from the middle of the room towards each corner): {photos}
Floor plan: {floor_plan or "(none — estimate the shape and size from the photos)"}
Furniture product links: {product_urls or "(none — use crop_photo to cut items out of the photos)"}

Look at every image first. Then: set the outline and ceiling height from the plan, choose the
closest flooring and wallpaper presets, look up each product, add each item at its position
and facing as seen in the photos, wait for generation, and check with render_view (top and
custom views from the photo positions). Fix anything that doesn't match, then summarise what
you built and which sizes you assumed."""


def main() -> None:
    mcp.run("stdio")


if __name__ == "__main__":
    main()
