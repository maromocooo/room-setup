# Generation engines

**English** | [日本語](engines.ja.md) | [README](../README.md)

Room Setup does not ship any model code or weights. You install each engine the way its authors describe, in its own Python environment, and tell the gateway where it is. The gateway then starts that environment's interpreter with a small worker script ([`server/engines/worker.py`](../server/engines/worker.py)) whenever the engine is needed.

## Setting up an engine

1. Follow the upstream installation guide. Use a separate virtualenv or Conda environment per engine; their PyTorch/CUDA requirements differ.
   - Hunyuan3D 2.1: <https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1>
   - TRELLIS.2: <https://github.com/microsoft/TRELLIS.2>
   - TRELLIS: <https://github.com/microsoft/TRELLIS>
   - Pixal3D: <https://github.com/TencentARC/Pixal3D>. It reuses TRELLIS.2's environment, so a copy of that environment (`conda create -n pixal3d --clone trellis2`) plus Pixal3D's `requirements.txt`, `natten` and `utils3d` (see its README) keeps TRELLIS.2 untouched.
   - SAM 3D Objects: <https://github.com/facebookresearch/sam-3d-objects>. The checkpoints are gated: request access on Hugging Face, run `hf auth login`, then download them into `checkpoints/hf` as its README describes.
2. Check that the upstream example script runs in that environment. If it doesn't, the gateway won't be able to load the engine either.
3. Copy `.env.example` to `.env` and set two variables per engine:

   ```bash
   HUNYUAN3D_PYTHON=/path/to/envs/hunyuan3d/bin/python   # interpreter of the engine's environment
   HUNYUAN3D_ROOT=/path/to/Hunyuan3D-2.1                 # upstream repository checkout
   ```

   The prefixes are `HUNYUAN3D_`, `TRELLIS2_`, `TRELLIS_`, `PIXAL3D_` and `SAM3D_`. Leave an engine blank to hide it from use; the app will show it as “not set up”.
4. Start the gateway with `npm run api` (it reads `.env`). The gateway itself only needs FastAPI, Uvicorn and python-multipart (`server/requirements.txt`) and runs in its own small venv (`.venv` by default, or set `GATEWAY_PYTHON`).

The worker scripts need nothing beyond what the upstream engine already uses. Weights are downloaded by the upstream code on first use into the usual Hugging Face cache, so the first load of each engine can take a long time. Once cached, you can set `HF_HUB_OFFLINE=1` in `.env` to stop further network access.

## What each engine does here

| Engine | Pipeline | Output written | Texture toggle |
|---|---|---|---|
| `hunyuan3d` | rembg background removal → Hunyuan3D-DiT shape → (optional) Hunyuan3D-Paint PBR | GLB | Yes. Paint runs with 6 views at 512 px. If painting fails, the shape-only model is returned with a warning. |
| `trellis2` | TRELLIS.2-4B image-to-3D → O-Voxel GLB export, decimated to 200k faces with 2048 px textures | GLB with WebP textures | Always textured |
| `trellis` | TRELLIS-image-large → Gaussian + mesh → baked GLB (1024 px texture) | GLB | Always textured |
| `pixal3d` | Background removal → MoGe-2 camera estimate → Pixal3D cascade (1024 by default; `PIXAL3D_RESOLUTION=1536` for more detail) → O-Voxel GLB, 200k faces, 2048 px | GLB with WebP textures | Always textured |
| `sam3d` | Object mask (the photo's alpha, else background removal) → SAM 3D Objects → mesh with baked texture (vertex colours if baking fails) | GLB | Always textured |

**Licenses differ per engine.** TRELLIS, TRELLIS.2 and Pixal3D are MIT, but Pixal3D also downloads Meta's DINOv3 weights (DINOv3 License). Hunyuan3D 2.1 uses Tencent's community license with territorial limits. SAM 3D Objects uses Meta's SAM License. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before using generated models commercially.

The browser scales every result to the width, depth and height you enter, so the engines' own units don't matter.

## Switching and GPU memory

- Only one engine is resident at a time. When a job asks for a different engine, the gateway asks the current worker to exit, waits for it, then starts the new one. Switching costs one model load (typically tens of seconds once weights are cached).
- Jobs run one at a time in the order submitted. You can queue jobs for different engines; each switch happens automatically.
- `PRELOAD_ENGINE=hunyuan3d` loads an engine as soon as the gateway starts, so the first job doesn't wait.
- Hunyuan3D texturing temporarily moves the shape model to the CPU, loads the paint model, and releases it afterwards. Expect noticeably higher memory use and longer jobs with texturing on. A 24 GB GPU is comfortable for all three engines; smaller cards may manage shape-only Hunyuan3D or TRELLIS.

## Troubleshooting

Each worker writes its output to `logs/<engine>.log`. Start there.

- **“Not set up” in the app**: `*_PYTHON` must point at an existing interpreter and `*_ROOT` at an existing directory. Restart the gateway after editing `.env`.
- **Engine shows “Error”**: the message appears under the engine's name; the full traceback is in the log. Selecting the engine and generating again retries the load.
- **TRELLIS and `flash_attn`**: TRELLIS defaults to flash-attention. If the environment doesn't have `flash_attn`, the worker switches to `xformers` automatically. You can force a backend with `ATTN_BACKEND` / `SPARSE_ATTN_BACKEND` in `.env`.
- **Random segmentation faults or impossible Python errors** (e.g. `UnboundLocalError` inside the standard library) while loading models: this has been seen on some 13th/14th-generation Intel desktop CPUs. Pinning the workers to a subset of cores, for example only the efficiency cores, made loads reliable there. Inspect your topology with `lscpu -e=CPU,CORE,MAXMHZ`, then set e.g. `ENGINE_CPUSET=16-31` in `.env`. Also check your BIOS/microcode is current. This is a workaround, not a fix.
- **First load is very slow**: weights are being downloaded. Watch the log.
- **Pixal3D setup notes** (seen on an RTX 4090 with CUDA 12.4):
  - Install MoGe with `pip install --no-deps git+https://github.com/microsoft/MoGe.git`, then its pinned helpers `utils3d-moge` and `pipeline` (listed in MoGe's metadata). Its full requirements clash with Pixal3D's pins.
  - Pixal3D's `utils3d` wheel has the same version number as TRELLIS.2's, so a cloned environment needs `pip install --force-reinstall --no-deps <wheel>`.
  - `natten` needs CMake and a host compiler CUDA supports. With GCC 13 and CUDA 12.4, build with `CC=gcc-12 CXX=g++-12 CUDAHOSTCXX=g++-12`.
  - Out-of-memory errors: the worker defaults to Pixal3D's low-VRAM mode. Make sure no other process holds the GPU.
- **SAM 3D Objects setup notes**:
  - `lightning` imports `pkg_resources`, so use `setuptools<81`.
  - `Cuda error: 209` from nvdiffrast means it wasn't built for your GPU. Rebuild it with `TORCH_CUDA_ARCH_LIST=<your arch>`.
  - Texture baking needs the mip-splatting `diff-gaussian-rasterization` (it takes a `kernel_size` argument). Without it, the worker falls back to vertex colours.
- **Generation succeeds but the model looks wrong in the room**: use clear photos of a single object on a plain background, and check the width/depth/height you entered. “Adjust shape” in the inspector can fix proportions afterwards.

## Adding another engine

1. Create `server/engines/<name>_engine.py` with a class `Engine(BaseEngine)` implementing:
   - `load(self)`: import the upstream code (use `self.add_paths(...)` for paths inside `self.root`) and load weights.
   - `generate(self, image_path, output_path, *, texture, seed, progress) -> dict`: write a GLB to `output_path`, call `progress("shape")` etc. as you go (`preprocess`, `shape`, `texture`, `export` have UI labels), and return `{"texture_applied": bool, "warning_code": None | "texture_failed" | "texture_unavailable"}`.
   - optionally `recover(self)`, called after a failed job.
2. Register the module name in `ENGINE_MODULES` in `worker.py`.
3. Add an `EngineSpec` in `server/gateway.py` (id, label, env prefix, `"optional"` or `"always"` texture), and `engine.desc.<id>` strings in `src/core/i18n.js`.

Keep engine modules free of top-level heavy imports, so the worker can report a clean error if something is missing. [`mock_engine.py`](../server/engines/mock_engine.py) is the smallest working example.
