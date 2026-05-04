"""Take a full-screen screenshot the same way the post-Confirm fallback does.

Run on the VM when you want to see exactly what Gemini sees:

    cd C:\\oceanjet-automation\\rpa-agent
    py screenshot_debug.py

Saves a timestamped PNG in the current directory and prints the path.
Optionally pass --ocr to also send the image to Gemini with the same
prompt _ocr_post_confirm_screen() uses, and print the response.
"""
import argparse
import io
import os
import sys
from datetime import datetime
from pathlib import Path

from PIL import ImageGrab


PROMPT = (
    "This is a screenshot of a ferry ticketing system.\n"
    "1. Is there a popup/dialog visible on top of the main form? "
    "If yes, read the popup message text exactly as written. "
    "If no popup is visible, respond with POPUP: NONE\n"
    "2. Read the 'Trip Availability' section — find the 'Available' row and list the "
    "seat counts for each class (TC, OA, BC).\n\n"
    "Return in this exact format:\n"
    "POPUP: <popup message text or NONE>\n"
    "AVAILABLE: TC=<number>, OA=<number>, BC=<number>"
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--ocr",
        action="store_true",
        help="Also send the screenshot to Gemini with the post-Confirm prompt",
    )
    args = parser.parse_args()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = Path(f"screenshot_{timestamp}.png")

    img = ImageGrab.grab()
    img.save(out_path, format="PNG")
    print(f"Saved: {out_path.resolve()}  ({img.size[0]}x{img.size[1]})")

    if not args.ocr:
        return

    # Lazy import so a no-OCR run doesn't require GEMINI_API_KEY.
    from dotenv import load_dotenv
    from google import genai
    from google.genai import types

    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    image_bytes = buf.getvalue()

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-flash-latest",
        contents=[PROMPT, types.Part.from_bytes(data=image_bytes, mime_type="image/png")],
    )
    print("\n--- Gemini OCR response ---")
    print(response.text.strip())


if __name__ == "__main__":
    main()
