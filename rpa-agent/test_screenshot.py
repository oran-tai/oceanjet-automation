"""
Test screenshot methods with and without AnyDesk connected.

Usage:
  1. Open PRIME on the VM
  2. Run: py test_screenshot.py
  3. Check the two output images on the desktop
  4. Disconnect AnyDesk, reconnect, and compare the images

It takes two screenshots:
  - screenshot_pil.png      (PIL ImageGrab — current method, may fail headless)
  - screenshot_printwindow.png  (PrintWindow API — should work headless)
"""
import time
import win32gui
import win32ui
from PIL import Image, ImageGrab

PRIME_TITLE = "Prime Software"
OUTPUT_DIR = r"C:\Users\Administrator\Desktop"


def find_prime_window():
    """Find the PRIME main window handle."""
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
    """Take screenshot using PIL ImageGrab (current method)."""
    try:
        rect = win32gui.GetWindowRect(hwnd)
        img = ImageGrab.grab(bbox=rect)
        img.save(output_path)
        print(f"PIL ImageGrab: saved to {output_path} ({img.size[0]}x{img.size[1]})")
        return True
    except Exception as e:
        print(f"PIL ImageGrab: FAILED — {e}")
        return False


def screenshot_printwindow(hwnd, output_path):
    """Take screenshot using PrintWindow API (should work headless)."""
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

        # PW_RENDERFULLCONTENT = 2 (Windows 8.1+)
        result = win32gui.PrintWindow(hwnd, save_dc.GetSafeHdc(), 2)
        if result != 1:
            # Fallback without PW_RENDERFULLCONTENT
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
        return True
    except Exception as e:
        print(f"PrintWindow: FAILED — {e}")
        return False


if __name__ == "__main__":
    hwnd = find_prime_window()
    if not hwnd:
        exit(1)

    print()
    print("Taking screenshots...")
    print()

    pil_path = f"{OUTPUT_DIR}\\screenshot_pil.png"
    pw_path = f"{OUTPUT_DIR}\\screenshot_printwindow.png"

    screenshot_pil(hwnd, pil_path)
    screenshot_printwindow(hwnd, pw_path)

    print()
    print("Done! Check the images on your Desktop.")
    print()
    print("Next steps:")
    print("  1. Verify both images look correct with AnyDesk connected")
    print("  2. Close AnyDesk (don't run 'disconnect', just close it)")
    print("  3. Wait 30 seconds, reconnect via AnyDesk")
    print("  4. Run this script again")
    print("  5. Compare: PIL will likely be black, PrintWindow should still work")
