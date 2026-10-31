# From a room photo to a furnished room

[Room Setup](../README.md) · [itemsmith](https://github.com/maromocooo/itemsmith) · [glbsmith](https://github.com/maromocooo/glbsmith)

This is an optional workflow across three independent projects:

```text
Room photo + product hints
    → itemsmith: identify, research and confirm products
    → glbsmith: model reviewed photos and dimensions in Blender
    → download GLB files
    → Room Setup: manually import, position and save
```

Use only the stages you need. itemsmith can stop at product research; glbsmith accepts your own photos and dimensions through its web app, CLI or MCP server; Room Setup can arrange existing GLBs without either companion. Room Setup's Hunyuan3D, TRELLIS.2, TRELLIS and other [generation engines](engines.md) remain separate options.

The steps below are checked against the repositories' UI labels, handlers and documented commands. They are not a live end-to-end generation benchmark. Identification, reference collection and modelling can fail or need corrections; review the handoffs instead of treating this as automatic reconstruction of a room.

## 1. Set up the stages you need

Keep separate checkouts and Python environments. Run each server in its own terminal. The default addresses below do not conflict; using itemsmith's built frontend also avoids competing Vite development servers on port 5173.

- **itemsmith:** [setup](https://github.com/maromocooo/itemsmith#quick-start), [日本語](https://github.com/maromocooo/itemsmith/blob/main/README.ja.md). Its backend declares Python 3.12; use uv and Node.js/npm, with a supported agent CLI signed in. Its UI is currently Japanese.
- **glbsmith:** [setup and requirements](https://github.com/maromocooo/glbsmith#quick-start). It requires Linux, uv, Python 3.11+, Node.js 22+, Blender and a configured agent. Follow its Blender and sandbox setup before building.
- **Room Setup:** [quick start](../README.md#quick-start). The browser app requires Node.js 22.12+ and a WebGL-capable desktop browser. Importing an existing GLB in the UI does not require the Python gateway or an image-to-3D engine.

### itemsmith: product research

From your itemsmith checkout:

```bash
cd frontend
npm install
npm run build
cd ../backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open [itemsmith](http://127.0.0.1:8000). Initial detection downloads the SAM 2.1 model if it is not already available. glbsmith does not need to be running for product research.

### glbsmith: optional model generation

From your glbsmith checkout, after installing Blender and configuring your chosen agent:

```bash
uv sync
npm ci
npm run build
export BLENDER_BIN=/path/to/blender
uv run python -m glbsmith.app
```

Replace the Blender path with your executable. Open [glbsmith](http://127.0.0.1:8021) to check its setup. itemsmith connects to this address by default. If you change the address, set `GLBSMITH_URL` in the environment of the itemsmith backend before starting it.

### Room Setup: import and placement

From your Room Setup checkout:

```bash
npm ci
npm run dev
```

Open [Room Setup](http://127.0.0.1:5173). For the UI import route, an API-offline notice in the generation panel does not prevent **Import GLB**.

## 2. Identify products and review the references in itemsmith

1. Choose a detection agent and upload your room photo with **写真を選択、またはドロップ** (select or drop a photo).
2. Review the detected objects and add hints such as manufacturer, model name or distinctive features. Correct grouping where needed: a desk's top and legs may form one product, while unrelated objects should be researched separately.
3. Start product research. On the results page, use **合っている** (correct) or **間違っている** (wrong). For a wrong match, search again with more detail or confirm the name you enter.
4. Open **サイズ取得と 3D 作成へ** (sizes and 3D creation), select confirmed products and choose **サイズを調べる** (look up sizes).
5. Review the source page, whether the size is sourced or estimated, and all three dimensions. Fields are **幅 / 奥行き / 高さ** — **width / depth / height, in centimetres**. Do not copy a W × H × D specification into W × D × H fields without reordering it. Correct the values to match the photographed configuration, such as with or without a stand.
6. Review the collected product photos and click their thumbnails to select or deselect them for generation. Check that they show the right product and variant. A failed download or an agent's image check does not establish that a reference is correct; supply your own suitable photos through glbsmith if the collected references are insufficient.

You can stop here and use the research on its own. There is no need to start a build to keep the session's research data.

## 3. Generate and review GLBs with glbsmith

### Existing handoff from itemsmith

Keep the glbsmith web server running. In itemsmith's **サイズ取得と 3D 作成** page, review the selected products, dimensions and build agent, then choose **3D モデルを作成** (create 3D models).

For grouped objects, check **部品を合わせて 1 つ** (combine parts into one) versus **同じ物が複数(1 つ分を作る)** (identical objects; build one). The latter creates one model, not all of its copies in the room.

itemsmith sends the real-photo crops and masks, selected product photos, and dimensions to glbsmith's `POST /api/jobs`. glbsmith's queue controls concurrency. Finished GLBs and preview images are copied into itemsmith's session data under `data/<session>/models/` by default.

Check the preview and warnings. In particular, a model may be smaller than the requested bounding box or may have been exported without passing the photo overlay check. Use **GLB をダウンロード** (download GLB) for each finished item. Inspect the actual model in glbsmith or Room Setup before relying on its shape or fit.

### Using glbsmith independently

If you already have suitable local product photos and dimensions, use glbsmith's web app: add photos, enter width/depth/height in cm, optionally paint the intended item, and choose **Create object**. Review the result, use **Make changes** if needed, and download the GLB.

Its existing CLI is another option. From the glbsmith checkout, with Blender and the chosen agent configured:

```bash
uv run python -m glbsmith.run photo.png --width 35 --depth 35 --height 155 --agent claude
```

These dimensions are an example; replace them and the image path with your own. The CLI prints the job directory; a successful job writes `model.glb` there. It does not import the model into Room Setup.

The requested dimensions are a bounding box, not a promise that every axis will equal the input. Review glbsmith's [size checks and GLB conventions](https://github.com/maromocooo/glbsmith#what-the-glb-guarantees). A successful export is not proof of an exact product replica.

## 4. Import, place and save in Room Setup

This handoff is manual in the current UI workflow. Downloading a GLB in itemsmith or glbsmith does not add it to Room Setup automatically.

1. In **Room** (**部屋**), draw your room outline or choose a template. Set its dimensions, ceiling height, doors and windows from measurements or a floor plan. The GLB handoff does not transfer the room's walls or infer furniture positions.
2. Open **Furniture → Import GLB** (**家具 → GLB を読み込む**) and select a downloaded `.glb` file. Repeat for each model.
3. Room Setup reads the size stored in the file, treating **1 unit as 1 metre**, and displays furniture dimensions in centimetres. The import uses the model's actual bounds, not the values left in the photo-generation form. Check the displayed dimensions against the reviewed product size.
4. Move furniture in the plan or with the 3D gizmo. Use the inspector to adjust position and rotation; check the front direction and floor height. Duplicate a model when you need several identical items.
5. Choose **Save** (**保存**) to download `room-project.zip`, which includes the room and models. **Open** (**開く**) restores the project. Without the API, there is no automatic save, so save before closing the tab.

A GLB contains geometry and materials, not verified product identity, room coordinates or a guarantee of physical clearance. Check the arrangement and dimensions yourself.

## Optional: work with an assistant over MCP

- **glbsmith** exposes [MCP tools and setup](https://github.com/maromocooo/glbsmith#use-it-from-any-ai-agent-mcp). In standalone MCP mode, your connected assistant uses `start_model`, the modelling/checking tools and `finalize`; `list_models` reports output paths. The glbsmith web app does not need to run for that mode. This differs from itemsmith's batch flow, which requires the glbsmith HTTP server.
- **Room Setup** exposes [MCP tools and setup](mcp.md) ([日本語](mcp.ja.md)). Start its Python gateway and keep the browser app open. After importing a GLB through the UI and letting it sync, an assistant can use `get_room` to find the furniture ID and `update_furniture` to adjust placement, then `render_view` to inspect it.
- There is currently **no dedicated GLB-import tool in Room Setup's MCP server**. `add_furniture` starts image-to-3D generation; it is not a GLB import operation. Use the UI import step above before asking an assistant to arrange an existing model.
- itemsmith's product-research agents are not an MCP orchestrator for all three apps. The current connection to glbsmith is its HTTP job API.

MCP arrangement of imported models needs the Room Setup gateway, but not a generation engine. Keep the default on-demand engine behaviour; generating new furniture through `add_furniture` requires a configured engine.

## Expectations, privacy and licences

The apps run locally, but the selected agents use external services and product research accesses the web. Review each project's privacy and agent-permission notes before supplying room photos. Agent access, usage limits and any API billing depend on your configuration; this workflow does not promise a fixed cost, generation time, success rate or common hardware requirement.

Each project's own code has an MIT licence: [Room Setup](../LICENSE), [itemsmith](https://github.com/maromocooo/itemsmith/blob/main/LICENSE), [glbsmith](https://github.com/maromocooo/glbsmith/blob/main/LICENSE). That does not grant rights to product photos, Blender, model weights or other third-party material. Follow the projects' [image-use guidance](../README.md#using-images-responsibly), [itemsmith image rights](https://github.com/maromocooo/itemsmith#image-rights), [glbsmith image/licence notes](https://github.com/maromocooo/glbsmith#images-and-licences) and [Room Setup third-party notices](../THIRD_PARTY_NOTICES.md). Do not publish private room photos or third-party product images as part of sharing your setup.
