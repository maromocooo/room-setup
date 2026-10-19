# Development

[README](../README.md) | [Engines](engines.md)

## Layout

```
index.html                 App shell (all static markup; text comes from i18n keys)
src/
  main.js, app.js          Entry point and top-level wiring (views, tabs, shortcuts, save/open)
  core/
    store.js               App state, change events, wall undo history
    geometry.js            Plan maths (lengths, bounds, snapping, templates, merging collinear walls)
    openings.js            Door/window presets, clamping, re-anchoring after wall edits
    lights.js              Light presets, colour temperature, fixture heights
    tilt.js                Orientation fixes for models generated upside down or on their side
    floor-outline.js       Connected walls → outer floor polygon
    textures.js            Procedural flooring/wallpaper presets (ids are part of the file format)
    i18n.js                Japanese/English strings
  plan/plan-editor.js      2D canvas editor (tools, snapping, pan/zoom, drawing)
  scene/
    room-scene.js          Three.js room, lighting, cutaway, gizmos, plan footprints
    furniture.js           GLB loading, sizing to dimensions, cloning
    wall-builder.js        Wall slabs with openings cut out; door and window fittings
    lighting.js            Time of day (sun, sky) and light fixtures
    furniture-gizmo.js     Move arrows and rotation ring for the selected furniture
    mesh-editor.js         "Adjust shape" dialog
  project/
    format.js              project.json read/write (pure, unit-tested)
    project-io.js          ZIP packing, GLB export/import
  api/client.js            Generation API calls
  sync/scene-sync.js       Two-way sync with the gateway's shared room document; renders screenshots
  ui/                      Sidebar panels, toasts, icons
  styles/app.css           Design tokens (light/dark) and components
server/
  gateway.py               FastAPI app: engine registry, worker lifecycle, job queue, room document
  scene.py                 Shared room document, change events, screenshot requests
  mcp_server.py            MCP server for assistants (see docs/mcp.md)
  engines/worker.py        Runs inside an engine's environment; JSON-lines protocol
  engines/*_engine.py      One module per engine (+ mock_engine.py)
tests/                     node:test unit tests, pytest gateway tests, Puppeteer smoke test
```

Plan coordinates are centimetres with y pointing down the screen; the 3D scene uses metres with plan y mapped to z. Walls are `{ id, start, end, finish? }`. A finish is `{ preset: id }` or `{ image: dataUrl }`. Openings reference a wall by id plus `offset` (cm from the wall's start to the opening's centre); after any wall edit `reanchorOpenings` moves them to whichever wall now runs through the same point, so merges and splits keep doors in place.

Furniture items hold a Three.js container `Group` whose origin is the bottom-centre of the model. Position and rotation live on the container; the generated model inside it carries the scale and centring. Project files store the container (without placement) as GLB, so models round-trip with edits intact.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (proxies `/api` and `/generated` to the gateway) |
| `npm run api` | Gateway, reading `.env` |
| `npm run build` / `npm run preview` | Production build / serve it (the preview server proxies the API too) |
| `npm test` | Unit tests (geometry, floor outline, i18n, project format) |
| `npm run test:api` | Gateway tests with the mock engine (needs `server/requirements-dev.txt` in `.venv`) |
| `npm run test:ui` | Headless Chrome smoke test against running dev server + gateway (`ROOM_SETUP_MOCK_ENGINE=1`); set `CHROME_BIN`, `TEST_BASE_URL`, `SCREENSHOT_DIR` as needed |

Configuration is read from `.env` (see `.env.example`): `API_HOST`, `API_PORT` and `API_URL` for the gateway address, `HOST`/`PORT` for Vite, engine paths, `DEFAULT_ENGINE`, `PRELOAD_ENGINE`, `ENGINE_CPUSET`, `GENERATED_DIR`, `LOG_DIR`, `ENGINE_LOAD_TIMEOUT` and `JOB_TIMEOUT` (seconds), `ALLOWED_HOSTS`.

The gateway has no authentication. To keep other websites from driving it, it only answers requests whose `Host` is localhost, an IP address or listed in `ALLOWED_HOSTS`, and whose `Origin` (when sent) matches that host. Vite's proxy forwards the browser's `Host` unchanged so the app passes this check.

## Gateway API

Interactive docs are at `http://127.0.0.1:8001/docs` while the gateway runs.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness and engine summary |
| GET | `/api/engines` | `{ engines: [{ id, label, texture, configured, state, error }], default, switching }` |
| POST | `/api/engines/{id}/load` | Start loading an engine in the background (202) |
| POST | `/api/engines/{id}/unload` | Stop an engine's worker and free its GPU memory |
| POST | `/api/jobs` | Multipart `file` (image ≤ 20 MB), `engine`, `texture` (bool), `seed`, optional `scene_item` (furniture id to fill in when done) → job (202) |
| GET | `/api/jobs/{id}` | `{ status: queued \| loading \| running \| done \| error, stage, queue_position, model_url, texture_applied, warning_code, error }` |
| DELETE | `/api/models/{id}` | Delete a generated GLB |
| GET | `/generated/<file>` | Generated models and uploads |
| GET | `/api/scene` | Shared room document (see `server/scene.py` for its shape) |
| PUT | `/api/scene` | `{ scene, base_revision, origin }`; 409 with the current document if `base_revision` is stale |
| GET | `/api/scene/events` | Server-sent events: `scene` (changed), `render` (screenshot request) |
| POST | `/api/scene/render` | `{ mode, width, height, eye?, target?, fov? }` → PNG rendered by an open app tab (409 if none) |
| POST | `/api/models` | Upload a GLB (body) → `{ model_url }` |
| POST | `/api/uploads` | Upload a PNG/JPEG/WebP (body) → `{ url }` |

Engine `state` is `stopped`, `starting`, `ready`, `busy`, `stopping` or `error`. Jobs are kept in memory for an hour after they finish; restarting the gateway forgets them. Uploaded images are deleted when their job ends. Generated GLBs stay in `generated/` until you delete them; it is safe to empty that folder at any time, since saved projects contain their own copies.

### Worker protocol

The gateway starts `<engine python> -u server/engines/worker.py <engine> <root>` with the engine root as working directory, and exchanges one JSON object per line:

```
gateway → worker   {"id": "...", "cmd": "generate", "image": "/abs/in.img", "output": "/abs/out.glb", "texture": false, "seed": 42}
                   {"cmd": "shutdown"}
worker → gateway   {"event": "ready"} | {"event": "fatal", "message": "..."}
                   {"event": "progress", "id": "...", "stage": "shape"}
                   {"event": "result", "id": "...", "texture_applied": true, "warning_code": null}
                   {"event": "error", "id": "...", "message": "..."}
```

The worker moves file descriptor 1 to stderr before importing anything, so library output cannot corrupt the protocol; stderr goes to `logs/<engine>.log`.

## Conventions

- Plain ES modules and DOM APIs; no UI framework. Keep modules focused and talk through the store's events.
- Every user-visible string goes through `i18n.js` with both `ja` and `en` entries (a unit test checks they match).
- Colours come from CSS custom properties so both themes work; the canvas and 3D view read them at render time.
- Don't rename texture preset ids or project fields: saved projects depend on them.
