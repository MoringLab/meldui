#!/usr/bin/env python3
"""Gesture arbitration check on a connected Android device.

Drags a slider with a slight vertical drift and asserts the surrounding list did not scroll
while the slider value changed. A control swipe outside the slider proves the list does scroll.
Run through scripts/native-job.sh. Records JSON to artifacts/device/gesture-<app>.json.
"""
import json, re, subprocess, sys, time, xml.etree.ElementTree as ET
from pathlib import Path

DEVICE = "MTK0000903071707360"
APPS = {
    "expo": ("dev.engine.lab.expo", "dev.engine.lab.expo/.MainActivity"),
    "flutter": ("dev.engine.engine_lab", "dev.engine.engine_lab/.MainActivity"),
}

def adb(*a, check=True):
    return subprocess.run(["adb", "-s", DEVICE, *a], capture_output=True, text=True, check=check).stdout

def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/g.xml")
    return ET.fromstring(adb("exec-out", "cat", "/sdcard/g.xml"))

def bounds(node):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    return tuple(map(int, m.groups())) if m else None

def find(root, pred):
    return [n for n in root.iter("node") if pred(n)]

def text_of(n):
    return n.get("text") or n.get("content-desc") or ""

def surface_heading(root):
    """The surface's own heading is the lowest match; the fixture picker repeats the same title above it."""
    matches = find(root, lambda n: "함께 나누는 저녁" in text_of(n) and "Button" not in n.get("class", "") and "Spinner" not in n.get("class", ""))
    matches = [m for m in matches if bounds(m)]
    return max(matches, key=lambda m: bounds(m)[1]) if matches else None

def snapshot(root):
    return sorted({text_of(n) for n in root.iter("node") if text_of(n)} | {n.get("content-desc") or "" for n in find(root, lambda n: "SeekBar" in n.get("class", ""))})

def run(app):
    pkg, activity = APPS[app]
    adb("shell", "input", "keyevent", "224"); adb("shell", "wm", "dismiss-keyguard", check=False)
    adb("shell", "am", "force-stop", pkg)
    adb("shell", "am", "start", "-n", activity)
    time.sleep(6)
    root = dump()
    seekbars = find(root, lambda n: "SeekBar" in n.get("class", ""))
    if not seekbars:
        return {"app": app, "status": "fail", "reason": "no slider found on the first screen"}
    heading = surface_heading(root)
    before_y = bounds(heading)[1] if heading is not None else None
    before_state = snapshot(root)
    sx1, sy1, sx2, sy2 = bounds(seekbars[0])
    cy = (sy1 + sy2) // 2
    width = sx2 - sx1
    # Some toolkits expose only the thumb as the SeekBar node: then grab its centre and drag right.
    start_x = (sx1 + sx2) // 2 if width < 120 else sx1 + int(width * 0.2)
    end_x = start_x + (110 if width < 120 else int(width * 0.6))
    # Slightly diagonal drag: 55 px of vertical drift over a long horizontal drag.
    adb("shell", "input", "swipe", str(start_x), str(cy), str(end_x), str(cy + 55), "700")
    time.sleep(1)
    root2 = dump()
    heading2 = surface_heading(root2)
    after_y = bounds(heading2)[1] if heading2 is not None else None
    value_changed = snapshot(root2) != before_state
    # Control: a vertical swipe on non-slider content must scroll the list.
    x = 192  # away from the edge: Android treats an edge swipe as the back gesture
    height = int(re.search(r"x(\d+)", adb("shell", "wm", "size")).group(1))
    adb("shell", "input", "swipe", str(x), str(int(height * 0.8)), str(x), str(int(height * 0.35)), "400")
    time.sleep(1)
    root3 = dump()
    heading3 = surface_heading(root3)
    control_y = bounds(heading3)[1] if heading3 is not None else None
    list_scrolled_by_slider = before_y != after_y
    control_scrolled = control_y != after_y
    return {
        "app": app,
        "headingYBefore": before_y,
        "headingYAfterSliderDrag": after_y,
        "headingYAfterControlSwipe": control_y,
        "sliderValueChanged": value_changed,
        "listScrolledDuringSliderDrag": list_scrolled_by_slider,
        "controlSwipeScrolledList": control_scrolled,
        "status": "pass" if (value_changed and not list_scrolled_by_slider and control_scrolled) else "fail",
    }

if __name__ == "__main__":
    app = sys.argv[1]
    result = run(app)
    Path("artifacts/device").mkdir(parents=True, exist_ok=True)
    Path(f"artifacts/device/gesture-{app}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(json.dumps(result, ensure_ascii=False, indent=1))
    sys.exit(0 if result["status"] == "pass" else 1)
