"""Persistent, private Nvidia vision worker for Lectio.

The worker is deliberately JSON-lines based: it has no HTTP listener, no
account and no provider configuration.  It keeps the fixed Moondream Photon
model resident between crops, which avoids reloading it for every slide.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
except AttributeError:
    pass

MODEL_NAME = "moondream3.1-9B-A2B"


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
        import moondream as md
        from PIL import Image

        if "--check" in sys.argv:
            return

        # Photon selects CUDA on supported Nvidia hardware.  The model name is
        # fixed and versioned by the native installer; no model selector leaks
        # into the student-facing UI.
        model = md.photon(MODEL_NAME)
        print(json.dumps({"ready": True, "model": MODEL_NAME, "device": "nvidia"}), flush=True)
    except Exception as error:
        print(json.dumps({"error": f"Kunde inte starta Nvidia-bildmotorn: {error}"}), flush=True)
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
