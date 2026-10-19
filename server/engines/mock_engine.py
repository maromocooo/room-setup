"""Stand-in engine for UI work and tests: writes a box GLB, no GPU needed.

Enable it with ROOM_SETUP_MOCK_ENGINE=1. It uses only the standard library,
so it runs under the gateway's own Python.
"""

import json
import os
import struct
import time

from base import BaseEngine

# Unit cube centred on the origin: 6 faces x 4 vertices.
_FACES = [
    ((1, 0, 0), [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)]),
    ((-1, 0, 0), [(-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, -1, -1)]),
    ((0, 1, 0), [(-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)]),
    ((0, -1, 0), [(-1, -1, 1), (-1, -1, -1), (1, -1, -1), (1, -1, 1)]),
    ((0, 0, 1), [(1, -1, 1), (1, 1, 1), (-1, 1, 1), (-1, -1, 1)]),
    ((0, 0, -1), [(-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1)]),
]


def box_glb(color=(0.62, 0.55, 0.47)) -> bytes:
    positions, normals, indices = [], [], []
    for normal, corners in _FACES:
        base = len(positions)
        positions += [tuple(c * 0.5 for c in corner) for corner in corners]
        normals += [normal] * 4
        indices += [base, base + 1, base + 2, base, base + 2, base + 3]

    pos_bytes = b"".join(struct.pack("<3f", *p) for p in positions)
    nrm_bytes = b"".join(struct.pack("<3f", *n) for n in normals)
    idx_bytes = b"".join(struct.pack("<H", i) for i in indices)
    idx_bytes += b"\0" * (-len(idx_bytes) % 4)
    binary = pos_bytes + nrm_bytes + idx_bytes

    gltf = {
        "asset": {"version": "2.0", "generator": "room-setup mock engine"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [*color, 1], "metallicFactor": 0, "roughnessFactor": 0.8}}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bytes), "byteLength": len(nrm_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bytes) + len(nrm_bytes), "byteLength": len(indices) * 2, "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(positions), "type": "VEC3",
             "min": [-0.5, -0.5, -0.5], "max": [0.5, 0.5, 0.5]},
            {"bufferView": 1, "componentType": 5126, "count": len(normals), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
        ],
    }
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    return b"".join([
        struct.pack("<4sII", b"glTF", 2, total),
        struct.pack("<I4s", len(json_bytes), b"JSON"), json_bytes,
        struct.pack("<I4s", len(binary), b"BIN\0"), binary,
    ])


class Engine(BaseEngine):
    delay = float(os.environ.get("ROOM_SETUP_MOCK_DELAY", "0.6"))

    def load(self) -> None:
        time.sleep(self.delay)

    def generate(self, image_path, output_path, *, texture, seed, progress):
        for stage in ("preprocess", "shape", "export"):
            progress(stage)
            time.sleep(self.delay)
        output_path.write_bytes(box_glb())
        return {"texture_applied": False, "warning_code": "texture_unavailable" if texture else None}
