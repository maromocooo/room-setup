"""Shared helpers for engine modules. Standard library only at import time."""

import gc
import importlib.util
import os
import sys
from pathlib import Path


class BaseEngine:
    """Interface the worker expects from every engine module."""

    def __init__(self, root: Path):
        self.root = root

    def load(self) -> None:
        raise NotImplementedError

    def generate(self, image_path: Path, output_path: Path, *, texture: bool, seed: int, progress) -> dict:
        """Write a GLB to output_path and return
        {"texture_applied": bool, "warning_code": str | None}."""
        raise NotImplementedError

    def recover(self) -> None:
        """Called after a failed job so the next one starts from a clean GPU."""
        free_cuda()

    def add_paths(self, *relative: str) -> None:
        for path in reversed(relative):
            sys.path.insert(0, str(self.root / path))


def free_cuda() -> None:
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass


def open_rgba(path: Path):
    from PIL import Image
    with Image.open(path) as image:
        return image.convert("RGBA")


def choose_attention_backend() -> None:
    """TRELLIS defaults to flash-attn; fall back to xformers when it is missing."""
    if importlib.util.find_spec("flash_attn") is None:
        os.environ.setdefault("ATTN_BACKEND", "xformers")
        os.environ.setdefault("SPARSE_ATTN_BACKEND", "xformers")
