"""Take a full-screen screenshot and run the result-dialog OCR prompt against it.

Mirrors `_read_dialog_via_screenshot(full_screen=True)` in prime_driver.py —
the prompt used after Confirm → Yes when scan succeeds and we OCR the dialog
to extract the ticket codes. This is the path that returned form rates panel
content instead of popup text in the Grace Gordon incident.

Run on the VM when you want to see exactly what Gemini returns for this
prompt against the current screen state:

    cd C:\\oceanjet-automation\\rpa-agent
    py screenshot_debug_result_dialog.py --ocr

Saves a timestamped PNG and prints the Gemini response to the terminal.
"""
import argparse
import io
import os
import sys
from datetime import datetime
from pathlib import Path

from PIL import ImageGrab


PROMPT = (
    "This is a screenshot of a ferry ticketing system. "
    "Find the small popup/dialog overlaying the main form and read "
    "ALL the text shown in that popup exactly as written. "
    "Return ONLY the popup text content, nothing else."
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--ocr",
        action="store_true",
        help="Also send the screenshot to Gemini with the result-dialog prompt",
    )
    args = parser.parse_args()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = Path(f"screenshot_result_{timestamp}.png")

    img = ImageGrab.grab()
    img.save(out_path, format="PNG")
    print(f"Saved: {out_path.resolve()}  ({img.size[0]}x{img.size[1]})")

    if not args.ocr:
        return

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

    print("\n--- Prompt sent to Gemini ---")
    print(PROMPT)

    client = genai.Client(api_key=api_key)
    start = datetime.now()
    response = client.models.generate_content(
        model="gemini-flash-latest",
        contents=[PROMPT, types.Part.from_bytes(data=image_bytes, mime_type="image/png")],
    )
    elapsed = (datetime.now() - start).total_seconds()

    print(f"\n--- Gemini response ({elapsed:.1f}s) ---")
    print(response.text.strip() if response.text else "(empty response)")


if __name__ == "__main__":
    main()
