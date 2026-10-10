#!/usr/bin/env python3
"""One explicit bounded benchmark. No automatic reruns or rebuilds.
Use: scripts/native-job.sh python3 scripts/device/perf-expo.py label --run
The whole job has a 240 second deadline, including CLI subprocesses.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
SERIAL = "MTK0000903071707360"


def find(node):
    if isinstance(node, dict):
        for value in node.get("attributes", {}).values():
            if isinstance(value, str) and value.startswith('{"platform":"react-native"'):
                return value
        for child in node.get("children", []):
            value = find(child)
            if value:
                return value
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("label")
    parser.add_argument("--run", action="store_true", help="Required explicit opt-in")
    parser.add_argument("--no-a11y", action="store_true")
    args = parser.parse_args()
    if not args.run:
        parser.error("benchmark disabled: pass --run for one bounded run")
    if not args.label.replace("-", "").replace("_", "").isalnum():
        parser.error("label must contain only letters, numbers, hyphens or underscores")
    deadline = time.monotonic() + 240

    def stop(signum, frame):
        raise TimeoutError("benchmark stopped; partial samples remain in device logs")

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGALRM, stop)
    signal.alarm(240)
    env = dict(os.environ, MAESTRO_CLI_NO_ANALYTICS="1", MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED="true")
    cli = str(ROOT / "artifacts/tools/maestro/bin/maestro")

    def command(argv, cap=20):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("benchmark deadline reached")
        return subprocess.run(argv, capture_output=True, text=True, env=env,
                              timeout=min(cap, remaining), check=True).stdout.strip()

    def adb(*argv):
        return command(["adb", "-s", SERIAL, *argv])

    previous = None
    journal = ROOT / "artifacts/device/settings-journal.json"
    try:
        if args.no_a11y:
            previous = adb("shell", "settings", "get", "secure", "accessibility_enabled")
            journal.parent.mkdir(parents=True, exist_ok=True)
            journal.write_text(json.dumps({"secure.accessibility_enabled": previous, "restored": False}))
            adb("shell", "settings", "put", "secure", "accessibility_enabled", "0")
        adb("shell", "input", "keyevent", "224")
        command([cli, "test", "--udid", SERIAL, str(ROOT / "tests/device/expo-benchmark.yaml")], 90)
        # At most eight queries; each CLI invocation is bounded as well as the whole job.
        for _ in range(8):
            time.sleep(min(15, max(0, deadline - time.monotonic())))
            out = command([cli, "--udid", SERIAL, "hierarchy", "--no-reinstall-driver"], 15)
            try:
                value = find(json.loads(out[out.index("{"):]))
            except (ValueError, KeyError):
                value = None
            if value:
                data = json.loads(value)
                target = ROOT / f"artifacts/eval/perf-expo-{args.label}.json"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(data, indent=1))
                print({c: {k: data[c].get(k) for k in ("samples", "p50", "p95", "p99", "max")}
                       for c in ("cold", "warm")})
                return
        raise TimeoutError("no report within bounded queries; no automatic rerun")
    finally:
        signal.alarm(0)
        if previous is not None:
            # Restoration has its own bounded deadline, independent of benchmark expiry.
            subprocess.run(["adb", "-s", SERIAL, "shell", "settings", "put", "secure",
                            "accessibility_enabled", previous], timeout=10, check=True)
            now = subprocess.check_output(["adb", "-s", SERIAL, "shell", "settings", "get",
                                           "secure", "accessibility_enabled"], timeout=10, text=True).strip()
            journal.write_text(json.dumps({"secure.accessibility_enabled": previous, "restored": now == previous}))
            if now != previous:
                raise RuntimeError("device setting restoration unverified")


if __name__ == "__main__":
    main()
