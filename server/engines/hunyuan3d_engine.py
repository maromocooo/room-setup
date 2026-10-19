"""Tencent Hunyuan3D 2.1: shape generation with optional PBR texture painting.

The paint pipeline does not fit next to the shape pipeline on a 24 GB GPU,
so it is loaded only for textured jobs: shape moves to the CPU, paint runs,
paint is released and shape returns to the GPU.
"""

import os
import shutil
import traceback
from pathlib import Path

from base import BaseEngine, free_cuda, open_rgba

MODEL_ID = "tencent/Hunyuan3D-2.1"


class Engine(BaseEngine):
    def load(self) -> None:
        os.environ.setdefault("NUMBA_DISABLE_JIT", "1")
        self.add_paths("hy3dshape", "hy3dpaint", ".")
        try:
            from torchvision_fix import apply_fix
            apply_fix()
        except ImportError:
            pass

        import rembg
        from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

        self.shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(MODEL_ID)
        self.rembg = rembg.new_session()
        try:
            from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline
            self._paint_classes = (Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline)
        except ImportError as error:
            print(f"Texture painting unavailable: {error}")
            self._paint_classes = None

    def generate(self, image_path, output_path, *, texture, seed, progress):
        import rembg
        import torch

        progress("preprocess")
        image = rembg.remove(open_rgba(image_path), session=self.rembg)

        progress("shape")
        with torch.no_grad():
            mesh = self.shape(image=image, generator=torch.manual_seed(seed))[0]

        if not texture:
            progress("export")
            mesh.export(str(output_path))
            return {"texture_applied": False, "warning_code": None}
        if self._paint_classes is None:
            mesh.export(str(output_path))
            return {"texture_applied": False, "warning_code": "texture_unavailable"}

        work = output_path.with_name(output_path.stem + "_work")
        work.mkdir(exist_ok=True)
        try:
            shape_path = work / "shape.glb"
            mesh.export(str(shape_path))
            image_copy = work / "input.png"
            image.save(image_copy)
            progress("texture")
            self._paint(shape_path, image_copy, work / "textured.obj", output_path)
            return {"texture_applied": True, "warning_code": None}
        except Exception:  # noqa: BLE001 - fall back to the untextured shape
            traceback.print_exc()
            shutil.copyfile(work / "shape.glb", output_path)
            return {"texture_applied": False, "warning_code": "texture_failed"}
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def _paint(self, shape_path: Path, image_path: Path, obj_path: Path, output_path: Path) -> None:
        config_class, pipeline_class = self._paint_classes
        paint_root = self.root / "hy3dpaint"
        self.shape.to("cpu")
        free_cuda()
        previous_cwd = os.getcwd()
        paint = None
        try:
            # The upstream paint code resolves several assets relative to cwd.
            os.chdir(paint_root)
            config = config_class(6, 512)  # six views at 512 px fit in 24 GB
            config.realesrgan_ckpt_path = str(paint_root / "ckpt" / "RealESRGAN_x4plus.pth")
            config.multiview_cfg_path = str(paint_root / "cfgs" / "hunyuan-paint-pbr.yaml")
            config.custom_pipeline = str(paint_root / "hunyuanpaintpbr")
            paint = pipeline_class(config)
            result = paint(mesh_path=str(shape_path), image_path=str(image_path),
                           output_mesh_path=str(obj_path), save_glb=True)
            glb = obj_path.with_suffix(".glb")
            if glb.exists():
                shutil.move(str(glb), str(output_path))
            else:
                import trimesh
                trimesh.load(result, force="scene").export(str(output_path), file_type="glb")
        finally:
            os.chdir(previous_cwd)
            del paint
            free_cuda()
            self.shape.to("cuda")

    def recover(self) -> None:
        free_cuda()
        try:
            self.shape.to("cuda")
        except Exception:  # noqa: BLE001
            traceback.print_exc()
