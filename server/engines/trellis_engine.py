"""Microsoft TRELLIS (image-large): textured GLB baked from Gaussians + mesh."""

import os

from base import BaseEngine, choose_attention_backend, free_cuda, open_rgba

MODEL_ID = "microsoft/TRELLIS-image-large"


class Engine(BaseEngine):
    def load(self) -> None:
        # Skip spconv's start-up benchmark; one-off jobs do not amortize it.
        os.environ.setdefault("SPCONV_ALGO", "native")
        choose_attention_backend()
        self.add_paths(".")
        from trellis.pipelines import TrellisImageTo3DPipeline

        self.pipeline = TrellisImageTo3DPipeline.from_pretrained(MODEL_ID)
        self.pipeline.cuda()

    def generate(self, image_path, output_path, *, texture, seed, progress):
        import torch
        from trellis.utils import postprocessing_utils

        progress("preprocess")
        image = self.pipeline.preprocess_image(open_rgba(image_path))

        progress("shape")
        with torch.no_grad():
            outputs = self.pipeline.run(
                image,
                seed=seed,
                formats=["gaussian", "mesh"],
                preprocess_image=False,
                sparse_structure_sampler_params={"steps": 12, "cfg_strength": 7.5},
                slat_sampler_params={"steps": 12, "cfg_strength": 3.0},
            )

        # TRELLIS always produces color; baking it is part of the export.
        progress("export")
        glb = postprocessing_utils.to_glb(
            outputs["gaussian"][0], outputs["mesh"][0],
            simplify=0.95, texture_size=1024, verbose=False,
        )
        glb.export(str(output_path))
        del outputs
        free_cuda()
        return {"texture_applied": True, "warning_code": None}
