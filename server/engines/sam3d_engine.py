"""Meta SAM 3D Objects: shape and texture of a masked object in a photo.

SAM 3D reconstructs one object from an image plus a mask. For product photos
the mask comes from the image's alpha channel; without one, the background
is removed with rembg if it is installed, else by trimming the plain
(near-white) backdrop that product shots usually have.

Weights: SAM3D_ROOT/checkpoints/hf (the upstream README's download step;
the Hugging Face repo is gated, so accept its license first).
"""

import importlib.util
import os

from base import BaseEngine, free_cuda, open_rgba

MAX_SIDE = 1024  # larger photos only cost memory


class Engine(BaseEngine):
    def load(self) -> None:
        config = self.root / "checkpoints" / "hf" / "pipeline.yaml"
        if not config.is_file():
            raise FileNotFoundError(
                f"{config} is missing. Download the weights as described in the SAM 3D Objects README "
                "(the Hugging Face repo is gated: request access, then `hf auth login`).")
        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        # SAM 3D's sparse attention defaults to plain SDPA with a dense
        # block-diagonal mask, which runs out of memory on detailed objects.
        for backend in ("flash_attn", "xformers"):
            if importlib.util.find_spec(backend):
                os.environ.setdefault("ATTN_BACKEND", backend)
                os.environ.setdefault("SPARSE_ATTN_BACKEND", backend)
                break
        self.add_paths("notebook", ".")
        from inference import Inference  # upstream notebook/inference.py

        self.inference = Inference(str(config), compile=False)

    def generate(self, image_path, output_path, *, texture, seed, progress):
        import numpy as np

        progress("preprocess")
        image = open_rgba(image_path)
        image.thumbnail((MAX_SIDE, MAX_SIDE))
        masked = object_mask(image)
        coverage = (np.array(masked)[..., 3] > 127).mean()
        print(f"Input {masked.size[0]}x{masked.size[1]}, object covers {coverage:.0%} of the image")
        if coverage > 0.95:
            raise ValueError("Couldn't separate the furniture from its background. "
                             "Use a cut-out or plain-background photo, or crop the photo to the item.")
        rgba = np.array(masked)

        progress("shape")
        warning = None
        try:
            outputs = self._run(rgba, seed, bake=True)
        except Exception:  # noqa: BLE001 - texture baking needs extra renderers; vertex colours always work
            import traceback
            traceback.print_exc()
            free_cuda()
            outputs = self._run(rgba, seed, bake=False)
            warning = "texture_failed"

        progress("export")
        mesh = outputs.get("glb")
        if mesh is None:
            raise RuntimeError("SAM 3D did not return a mesh.")
        mesh.export(str(output_path))
        del outputs, mesh
        free_cuda()
        return {"texture_applied": warning is None, "warning_code": warning}

    def _run(self, rgba, seed, *, bake):
        return self.inference._pipeline.run(
            rgba, None, seed,
            stage1_only=False,
            # Upstream only writes vertex colours when post-processing is off too.
            with_mesh_postprocess=bake,
            with_texture_baking=bake,
            with_layout_postprocess=False,
            use_vertex_color=not bake,
            stage1_inference_steps=None,
            pointmap=None,
        )


def object_mask(image):
    """RGBA image whose alpha marks the object."""
    import numpy as np

    alpha = np.array(image)[..., 3]
    if (alpha < 250).mean() > 0.01:
        return image  # already cut out
    try:
        import rembg
        return rembg.remove(image.convert("RGB")).convert("RGBA")
    except ImportError:
        pass
    # Plain backdrop: near-white regions touching the border are background.
    from PIL import Image
    from scipy import ndimage

    rgb = np.asarray(image.convert("RGB"))
    signed = rgb.astype(np.int16)
    backdrop = (signed.min(axis=2) > 235) & (np.ptp(signed, axis=2) < 18)
    labels, _ = ndimage.label(backdrop)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    outside = np.isin(labels, border[border > 0])
    return Image.fromarray(np.dstack([rgb, np.where(outside, 0, 255).astype(np.uint8)]), "RGBA")
