#!/usr/bin/env python3
import json
import sys


def emit(payload, code=0):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.write("\n")
    return code


def unavailable():
    return emit({
        "ok": False,
        "code": "ocr_unavailable",
        "message": "Python OCR is not installed. From the project directory run: npm run py:sync",
    }, 1)


def main(argv):
    if len(argv) == 2 and argv[1] == "--check":
        try:
            import rapidocr_onnxruntime  # noqa: F401
        except Exception as error:
            detail = str(error).replace("\n", " ").strip()[:240]
            if not detail:
                return unavailable()
            return emit({
                "ok": False,
                "code": "ocr_unavailable",
                "message": f"Python OCR failed to load: {detail}",
            }, 1)
        return emit({"ok": True, "engine": "rapidocr-onnxruntime"})
    if len(argv) != 2:
        return emit({"ok": False, "code": "ocr_failed", "message": "Usage: ocr_screenshot.py <image>"}, 2)
    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception:
        return unavailable()
    try:
        engine = RapidOCR()
        result, _elapsed = engine(argv[1])
    except Exception:
        return emit({
            "ok": False,
            "code": "ocr_failed",
            "message": "Roost could not read text from one or more screenshots. You can still enter the facts yourself.",
        }, 1)
    lines = []
    for item in result or []:
        text = str(item[1]).strip() if len(item) > 1 else ""
        if not text:
            continue
        score = item[2] if len(item) > 2 else None
        lines.append({"text": text, "confidence": score})
    return emit({"ok": True, "text": "\n".join(line["text"] for line in lines), "lines": lines})


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
