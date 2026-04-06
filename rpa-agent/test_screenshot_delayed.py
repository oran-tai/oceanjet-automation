"""
Delayed screenshot test — gives you 60 seconds to close AnyDesk before taking screenshots.

Usage:
  1. Open PRIME on the VM
  2. Run: py test_screenshot_delayed.py
  3. Close AnyDesk within 60 seconds
  4. Reconnect after the countdown and check the images on the Desktop

Output:
  - screenshot_delayed_pil.png         (PIL ImageGrab — likely black)
  - screenshot_delayed_printwindow.png (PrintWindow — should still work)
"""
import time
import win32gui
import win32ui
from PIL import Image, ImageGrab

PRIME_TITLE = "Prime Software"
OUTPUT_DIR = r"C:\Users\Administrator\Desktop"
DELAY_SECONDS = 60


def find_prime_window():
    def callback(hwnd, results):
        title = win32gui.GetWindowText(hwnd)
        if PRIME_TITLE in title and win32gui.IsWindowVisible(hwnd):
            results.append(hwnd)
    results = []
    win32gui.EnumWindows(callback, results)
    if not results:
        print("ERROR: PRIME window not found. Is PRIME open?")
        return None
    print(f"Found PRIME window: hwnd={results[0]}, title='{win32gui.GetWindowText(results[0])}'")
    return results[0]


def screenshot_pil(hwnd, output_path):
    try:
        rect = win32gui.GetWindowRect(hwnd)
        img = ImageGrab.grab(bbox=rect)
        img.save(output_path)
        print(f"PIL ImageGrab: saved to {output_path} ({img.size[0]}x{img.size[1]})")
    except Exception as e:
        print(f"PIL ImageGrab: FAILED - {e}")


def screenshot_printwindow(hwnd, output_path):
    try:
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        width = right - left
        height = bottom - top

        hwnd_dc = win32gui.GetWindowDC(hwnd)
        mfc_dc = win32ui.CreateDCFromHandle(hwnd_dc)
        save_dc = mfc_dc.CreateCompatibleDC()
        bitmap = win32ui.CreateBitmap()
        bitmap.CreateCompatibleBitmap(mfc_dc, width, height)
        save_dc.SelectObject(bitmap)

        result = win32gui.PrintWindow(hwnd, save_dc.GetSafeHdc(), 2)
        if result != 1:
            win32gui.PrintWindow(hwnd, save_dc.GetSafeHdc(), 0)

        bmp_info = bitmap.GetInfo()
        bmp_bits = bitmap.GetBitmapBits(True)
        img = Image.frombuffer(
            "RGB",
            (bmp_info["bmWidth"], bmp_info["bmHeight"]),
            bmp_bits, "raw", "BGRX", 0, 1
        )

        save_dc.DeleteDC()
        mfc_dc.DeleteDC()
        win32gui.ReleaseDC(hwnd, hwnd_dc)
        win32gui.DeleteObject(bitmap.GetHandle())

        img.save(output_path)
        print(f"PrintWindow: saved to {output_path} ({img.size[0]}x{img.size[1]})")
    except Exception as e:
        print(f"PrintWindow: FAILED - {e}")


if __name__ == "__main__":
    hwnd = find_prime_window()
    if not hwnd:
        exit(1)

    print()
    print(f">>> CLOSE ANYDESK NOW — screenshots will be taken in {DELAY_SECONDS} seconds <<<")
    print()

    for i in range(DELAY_SECONDS, 0, -10):
        print(f"  {i} seconds remaining...")
        time.sleep(10)

    print()
    print("Taking screenshots (AnyDesk should be closed by now)...")
    print()

    screenshot_pil(hwnd, f"{OUTPUT_DIR}\\screenshot_delayed_pil.png")
    screenshot_printwindow(hwnd, f"{OUTPUT_DIR}\\screenshot_delayed_printwindow.png")

    print()
    print("Done! Reconnect AnyDesk and check the images on the Desktop.")
