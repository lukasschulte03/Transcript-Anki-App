"""Persistent, private Nvidia vision worker for Lectio.

The worker is deliberately JSON-lines based: it has no HTTP listener, no
account and no provider configuration.  It keeps the fixed Moondream Photon
model resident between crops, which avoids reloading it for every slide.
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any
from tqdm.auto import tqdm

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
except AttributeError:
    pass

MODEL_NAME = "moondream3.1-9B-A2B"


class JsonProgress(tqdm):
    """tqdm-compatible progress bar that streams machine-readable byte counts."""

    file_label = "model"

    def __init__(self, *args: Any, **kwargs: Any):
        kwargs["file"] = sys.stderr
        self._last_reported = -1
        self._last_emit_at = 0.0
        super().__init__(*args, **kwargs)
        self._report(force=True)

    def update(self, n: int = 1):
        updated = super().update(n)
        self._report()
        return updated

    def _report(self, force: bool = False) -> None:
        total = self.total
        current = int(self.n)
        percent = int(current * 100 / total) if total else -1
        now = time.monotonic()
        if not force and percent == self._last_reported and now - self._last_emit_at < 1:
            return
        self._last_reported = percent
        self._last_emit_at = now
        print(json.dumps({
            "event": "download_progress",
            "file": self.file_label,
            "current": current,
            "total": int(total) if total else None,
        }), flush=True)

    def display(self, msg: str | None = None, pos: int | None = None) -> None:
        # Progress is streamed as JSON on stdout; suppress tqdm's terminal UI.
        return None


def model_files_ready() -> bool:
    from huggingface_hub import hf_hub_download
    from kestrel.models import get_spec

    spec = get_spec(MODEL_NAME)
    try:
        hf_hub_download(
            spec.repo_id,
            filename=spec.filename,
            revision=spec.revision,
            local_files_only=True,
        )
        hf_hub_download(
            spec.tokenizer_id,
            filename="tokenizer.json",
            local_files_only=True,
        )
        return True
    except Exception:
        return False


def download_model_files() -> None:
    from huggingface_hub import hf_hub_download
    from kestrel.models import get_spec

    spec = get_spec(MODEL_NAME)
    # This is the same Hub cache and exact file mapping Kestrel uses at runtime,
    # so model initialization will not trigger a hidden second download.
    JsonProgress.file_label = "model"
    hf_hub_download(
        spec.repo_id,
        filename=spec.filename,
        revision=spec.revision,
        tqdm_class=JsonProgress,
    )
    JsonProgress.file_label = "tokenizer"
    hf_hub_download(
        spec.tokenizer_id,
        filename="tokenizer.json",
        tqdm_class=JsonProgress,
    )
    print(json.dumps({"event": "download_complete"}), flush=True)


def value_of(result: Any) -> str:
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, dict):
        for key in ("answer", "caption", "text", "description"):
            value = result.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return str(result).strip()


def keywords(description: str) -> list[str]:
    seen: set[str] = set()
    for word in description.replace("/", " ").replace(",", " ").split():
        word = word.strip(".():;!?[]{}\"'").lower()
        if len(word) > 3 and word not in seen:
            seen.add(word)
        if len(seen) == 10:
            break
    return list(seen)


def main() -> None:
    try:
        if "--weights-status" in sys.argv:
            print(json.dumps({"modelWeightsReady": model_files_ready()}), flush=True)
            return

        if "--download-model" in sys.argv:
            download_model_files()
            return

        import moondream as md
        from PIL import Image
        import torch

        if "--check" in sys.argv:
            if not torch.cuda.is_available():
                raise RuntimeError(
                    "CUDA saknas i Lectios Python-miljö (PyTorch är CPU-only eller CUDA-runtime kunde inte initieras)."
                )
            print(
                json.dumps({"ready": True, "device": torch.cuda.get_device_name(0)}),
                flush=True,
            )
            return

        # Photon selects CUDA on supported Nvidia hardware.  The model name is
        # fixed and versioned by the native installer; no model selector leaks
        # into the student-facing UI.
        model = md.photon(MODEL_NAME)
        print(json.dumps({"ready": True, "model": MODEL_NAME, "device": "nvidia"}), flush=True)
    except Exception as error:
        if "--download-model" in sys.argv:
            print(json.dumps({"event": "error", "error": f"Moondream kunde inte hämtas: {error}"}), flush=True)
        else:
            print(json.dumps({"error": f"Kunde inte starta Nvidia-bildmotorn: {error}"}), flush=True)
        if "--check" in sys.argv or "--download-model" in sys.argv:
            raise SystemExit(1)
        return

    for line in sys.stdin:
        try:
            request = json.loads(line)
            input_path = request.get("inputPath")
            if not isinstance(input_path, str) or not input_path:
                raise ValueError("inputPath saknas")
            with Image.open(input_path) as image:
                image = image.convert("RGB")
                answer = value_of(model.query(
                    image,
                    "Describe this educational image in one concise sentence. Include readable labels, arrows, anatomy or chart meaning when visible.",
                ))
            if not answer:
                raise ValueError("Modellen gav ingen bildbeskrivning")
            print(json.dumps({"description": answer, "keywords": keywords(answer)}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
