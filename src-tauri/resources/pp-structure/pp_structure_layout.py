"""Persistent PP-StructureV3 sidecar for Lectio slide layout detection.

One process keeps the layout model in memory while a lecture is indexed. This
matters more than micro-optimising individual inferences: starting Paddle and
loading a model for every slide made GPU acceleration nearly invisible.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from paddleocr import LayoutDetection, PaddleOCR

# Windows inherits a legacy console encoding surprisingly often. This worker
# speaks JSON-lines to Rust, so the pipe must always be UTF-8; slide OCR can
# legitimately contain Romanian, Swedish and other non-CP1252 characters.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
except AttributeError:
    pass


MODEL_NAME = "PP-DocLayout_plus-L"


def configured_device() -> str:
    """Use CUDA only when the installed Paddle wheel can actually initialise it."""
    requested = os.environ.get("LECTIO_PADDLE_DEVICE", "cpu").lower()
    if requested.startswith("gpu"):
        try:
            import paddle

            if paddle.device.is_compiled_with_cuda():
                return "gpu:0"
        except Exception:
            # A CPU fallback is intentional: image indexing must never make the
            # library unusable simply because an NVIDIA runtime is incomplete.
            pass
    return "cpu"


def build_pipeline() -> tuple[LayoutDetection, PaddleOCR, str]:
    device = configured_device()
    pipeline = LayoutDetection(
        # PP-DocLayout_plus-L is the high-precision model trained on PPT and
        # multi-layout material. PP-DocLayout-S favours speed, which is not the
        # right trade-off for automatic medical slide crops.
        model_name=MODEL_NAME,
        device=device,
        # oneDNN has been unstable on some Windows CPU configurations. CUDA
        # ignores this setting, while the CPU fallback remains deterministic.
        enable_mkldnn=False,
    )
    # OCR runs once on the original full-resolution slide. Its text boxes are
    # later matched to each detected image/chart crop in the TypeScript layer,
    # which is both sharper and more accurate than OCR'ing small PNG crops.
    # English is the supported Latin-script recognition package in PaddleOCR
    # 3.x; it reads Swedish slide labels reasonably while preserving symbols.
    ocr = PaddleOCR(
        lang="en",
        device=device,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
    )
    return pipeline, ocr, device


def as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    for attribute in ("json", "to_json"):
        candidate = getattr(value, attribute, None)
        if candidate is None:
            continue
        candidate = candidate() if callable(candidate) else candidate
        if isinstance(candidate, str):
            return json.loads(candidate)
        if isinstance(candidate, dict):
            return candidate
    return {}


def ocr_text_boxes(ocr: PaddleOCR, input_path: str) -> list[dict[str, Any]]:
    result = next(iter(ocr.predict(input_path)))
    payload = as_dict(result)
    root = payload.get("res", payload)
    texts = root.get("rec_texts", [])
    scores = root.get("rec_scores", [])
    boxes = root.get("rec_boxes", [])
    output = []
    for text, score, coordinate in zip(texts, scores, boxes):
        if not isinstance(text, str) or not text.strip() or len(coordinate) != 4:
            continue
        left, top, right, bottom = (float(value) for value in coordinate)
        if right <= left or bottom <= top:
            continue
        output.append(
            {
                "text": text.strip(),
                "score": float(score),
                "left": left,
                "top": top,
                "right": right,
                "bottom": bottom,
            }
        )
    return output


def detect(pipeline: LayoutDetection, ocr: PaddleOCR, input_path: str) -> dict[str, Any]:
    results = pipeline.predict(input_path, batch_size=1, layout_nms=True)
    result = next(iter(results))
    payload = as_dict(result)
    root = payload.get("res", payload)
    boxes = []
    for box in root.get("boxes", []):
        label = str(box.get("label", "")).lower()
        coordinate = box.get("coordinate", [])
        # Text fragments, titles, equations and lines are not useful visual
        # flashcard candidates. PP-StructureV3 has first-class labels for the
        # two remaining types we want.
        if label not in {"image", "chart"} or len(coordinate) != 4:
            continue
        left, top, right, bottom = (float(value) for value in coordinate)
        if right <= left or bottom <= top:
            continue
        boxes.append(
            {
                "label": label,
                "score": float(box.get("score", 0)),
                "left": left,
                "top": top,
                "right": right,
                "bottom": bottom,
            }
        )
    return {"boxes": boxes, "textBoxes": ocr_text_boxes(ocr, input_path)}


def main() -> None:
    serve = len(sys.argv) == 2 and sys.argv[1] == "--serve"
    if not serve and len(sys.argv) != 2:
        raise SystemExit("Expected one PNG input path or --serve")

    pipeline, ocr, device = build_pipeline()
    if not serve:
        print(json.dumps(detect(pipeline, ocr, sys.argv[1]), ensure_ascii=False))
        return

    # JSON-lines gives Rust a small, auditable local IPC protocol with no HTTP
    # listener, ports or lecture data leaving this computer.
    print(json.dumps({"ready": True, "device": device, "model": MODEL_NAME}), flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            input_path = request.get("inputPath")
            if not isinstance(input_path, str) or not input_path:
                raise ValueError("inputPath saknas")
            print(json.dumps(detect(pipeline, ocr, input_path), ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
