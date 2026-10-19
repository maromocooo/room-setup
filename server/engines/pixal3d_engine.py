"""Tencent ARC Pixal3D: pixel-aligned shape and PBR texture (TRELLIS.2 backbone).

Runs in an environment built on TRELLIS.2's plus Pixal3D's extra packages
(natten, utils3d, MoGe). Camera intrinsics are estimated per image with
MoGe-2, as in the upstream inference script.

PIXAL3D_RESOLUTION: 1024 (default, faster) or 1536.
PIXAL3D_LOW_VRAM: 1 (default) keeps models on the CPU between stages (~10–12 GB
peak); 0 loads everything onto the GPU (faster, needs well over 20 GB).
"""

import os

from base import BaseEngine, choose_attention_backend, free_cuda, open_rgba

DECIMATION_TARGET = 200_000
TEXTURE_SIZE = 2048
SAMPLERS = {  # upstream inference.py defaults
    "sparse_structure_sampler_params": {"steps": 12, "guidance_strength": 7.5, "guidance_rescale": 0.7, "rescale_t": 5.0},
    "shape_slat_sampler_params": {"steps": 12, "guidance_strength": 7.5, "guidance_rescale": 0.5, "rescale_t": 3.0},
    "tex_slat_sampler_params": {"steps": 12, "guidance_strength": 1.0, "guidance_rescale": 0.0, "rescale_t": 3.0},
}


class Engine(BaseEngine):
    def load(self) -> None:
        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        choose_attention_backend()
        if os.environ.get("ATTN_BACKEND") == "xformers":
            os.environ["ATTN_BACKEND"] = "sdpa"  # Pixal3D supports flash_attn or sdpa
        self.add_paths(".")
        import inference as upstream  # Pixal3D's inference.py

        self.upstream = upstream
        self.low_vram = os.environ.get("PIXAL3D_LOW_VRAM", "1") != "0"
        self.resolution = int(os.environ.get("PIXAL3D_RESOLUTION", "1024"))
        self.pipeline = upstream.init_pipeline(low_vram=self.low_vram)
        # MoGe only estimates the camera; keep it off the GPU in between.
        self.moge = upstream.load_moge_model(device="cuda").cpu()
        free_cuda()

    def generate(self, image_path, output_path, *, texture, seed, progress):
        import numpy as np
        import o_voxel
        import torch

        progress("preprocess")
        image = self.pipeline.preprocess_image(open_rgba(image_path))
        scratch = output_path.with_suffix(".preprocessed.png")
        image.save(scratch)
        try:
            self.moge.cuda()
            camera = self.upstream.get_camera_params_wild_moge(str(scratch), self.moge, device="cuda")
        finally:
            scratch.unlink(missing_ok=True)
            self.moge.cpu()
            free_cuda()

        progress("shape")
        torch.manual_seed(seed)
        with torch.no_grad():
            meshes, (_shape, _tex, grid) = self.pipeline.run(
                image, camera_params=camera, seed=seed, preprocess_image=False, return_latent=True,
                pipeline_type=f"{self.resolution}_cascade", max_num_tokens=49152, **SAMPLERS,
            )
        mesh = meshes[0]

        progress("export")
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs,
            coords=mesh.coords, attr_layout=self.pipeline.pbr_attr_layout,
            grid_size=grid, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=DECIMATION_TARGET, texture_size=TEXTURE_SIZE,
            remesh=True, remesh_band=1, remesh_project=0,
        )
        # Same axis change as upstream inference.py (Z-up generation frame → Y-up glTF).
        glb.apply_transform(np.array([[-1, 0, 0, 0], [0, 0, -1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64))
        glb.export(str(output_path), extension_webp=True)
        del meshes, mesh, glb
        free_cuda()
        return {"texture_applied": True, "warning_code": None}
