"""Microsoft TRELLIS.2 (4B): high-resolution shape with PBR materials."""

import os

from base import BaseEngine, choose_attention_backend, free_cuda, open_rgba

MODEL_ID = "microsoft/TRELLIS.2-4B"

# Furniture is viewed at room scale in a browser, so trade the upstream
# 1M-face / 4K defaults for something that loads quickly.
DECIMATION_TARGET = 200_000
TEXTURE_SIZE = 2048


class Engine(BaseEngine):
    def load(self) -> None:
        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        choose_attention_backend()
        self.add_paths(".")
        from trellis2.pipelines import Trellis2ImageTo3DPipeline

        self.pipeline = Trellis2ImageTo3DPipeline.from_pretrained(MODEL_ID)
        self.pipeline.cuda()

    def generate(self, image_path, output_path, *, texture, seed, progress):
        import o_voxel
        import torch

        progress("shape")
        with torch.no_grad():
            mesh = self.pipeline.run(open_rgba(image_path), seed=seed)[0]
        mesh.simplify(16_777_216)  # nvdiffrast limit

        progress("export")
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs,
            coords=mesh.coords, attr_layout=mesh.layout, voxel_size=mesh.voxel_size,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=DECIMATION_TARGET, texture_size=TEXTURE_SIZE,
            remesh=True, remesh_band=1, remesh_project=0, verbose=False,
        )
        glb.export(str(output_path), extension_webp=True)
        del mesh, glb
        free_cuda()
        return {"texture_applied": True, "warning_code": None}
