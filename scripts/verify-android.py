#!/usr/bin/env python3
"""Install independent demo APKs and run offline or opt-in live device flows."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--serial', default=os.environ.get('ANDROID_SERIAL'))
parser.add_argument('--platform', choices=['expo', 'flutter', 'all'], default='all')
parser.add_argument('--live', action='store_true', help='Call the configured local model server')
parser.add_argument('--install-only', action='store_true', help='Install the APKs and stop (no flows)')
parser.add_argument('--video', action='store_true', help='Record the form flow (functional checks only)')
args = parser.parse_args()
if not args.serial:
    devices = [line.split()[0] for line in subprocess.check_output(['adb', 'devices'], text=True).splitlines()[1:] if line.endswith('\tdevice')]
    if len(devices) != 1:
        parser.error('Use --serial to select exactly one connected device')
    args.serial = devices[0]
maestro = os.environ.get('MAESTRO_BIN') or shutil.which('maestro') or str(ROOT / 'artifacts/tools/maestro/bin/maestro')
if not Path(maestro).is_file():
    parser.error('Install Maestro or set MAESTRO_BIN')
adb = ['adb', '-s', args.serial]
env = dict(os.environ, MAESTRO_CLI_NO_ANALYTICS='1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED='true')
output = ROOT / 'artifacts/android'
output.mkdir(parents=True, exist_ok=True)
subprocess.run(adb + ['reverse', 'tcp:8787', 'tcp:8787'], check=True)
results = []
apps = {
    'expo': ('dev.engine.lab.expo', ROOT / 'apps/expo-lab/android/app/build/outputs/apk/release/app-release.apk'),
    'flutter': ('dev.engine.engine_lab', ROOT / 'apps/flutter/build/app/outputs/flutter-apk/app-release.apk'),
}
for platform, (app_id, apk) in apps.items():
    if args.platform not in [platform, 'all']:
        continue
    if not apk.is_file():
        parser.error(f'Build the demo APK first: {apk.relative_to(ROOT)}')
    installer = subprocess.Popen(adb + ['install', '-r', str(apk)])
    deadline = time.monotonic() + 120
    while installer.poll() is None:
        activity = subprocess.check_output(adb + ['shell', 'dumpsys', 'activity', 'activities'], text=True)
        if 'mResumedActivity:' in activity and any('PlayProtectDialogsActivity' in line for line in activity.splitlines() if 'mResumedActivity:' in line):
            # Decline third-party upload of our explicitly authorized local APK.
            decision = subprocess.run([maestro, 'test', '--udid', args.serial, '--test-output-dir', str(output / 'installer'), '--debug-output', str(output / 'installer'), str(ROOT / 'tests/device/install-local.yaml')], env=env, timeout=60)
            if decision.returncode and installer.poll() is None:
                installer.terminate()
                raise RuntimeError('Could not decline upload of the local demo APK')
        if time.monotonic() > deadline:
            installer.terminate()
            raise TimeoutError('Local demo installation timed out')
        time.sleep(1)
    if installer.returncode:
        raise RuntimeError('Local demo installation failed')
    if args.install_only:
        results.append({'platform': platform, 'installed': True})
        continue
    # Performance is a separate explicit bounded command, never part of functional verification.
    flows = [f'{platform}-input', platform]
    if args.live:
        flows.append('live')
    for flow in flows:
        name = f'{platform}-{flow}'
        destination = output / name
        destination.mkdir(exist_ok=True)
        command = [maestro, 'test', '--udid', args.serial, '--test-output-dir', str(destination), '--debug-output', str(destination), '-e', f'APP_ID={app_id}', str(ROOT / f'tests/device/{flow}.yaml')]
        recording = None
        recording_pid = None
        remote_video = f'/sdcard/engine-{platform}-form.mp4'
        if args.video and flow.endswith('-input'):
            subprocess.run(adb + ['shell', 'am', 'start', '-n', f'{app_id}/.MainActivity'], check=True, stdout=subprocess.DEVNULL)
            recording = subprocess.Popen(adb + ['shell', f'echo $$; exec screenrecord --time-limit 180 {remote_video}'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            recording_pid = int(recording.stdout.readline().strip())
        try:
            with (destination / 'flow.log').open('w') as log:
                completed = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=300)
            results.append({'platform': platform, 'flow': flow, 'passed': completed.returncode == 0})
            (output / 'results.json').write_text(json.dumps({'device': args.serial, 'results': results}, indent=2))
            print(name, 'PASS' if completed.returncode == 0 else 'FAIL', flush=True)
            if completed.returncode:
                raise SystemExit(completed.returncode)
        finally:
            if recording:
                subprocess.run(adb + ['shell', 'kill', '-INT', str(recording_pid)], stdout=subprocess.DEVNULL, check=False)
                try:
                    recording.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    recording.terminate()
                subprocess.run(adb + ['pull', remote_video, str(output / f'{platform}-form.mp4')], check=False, stdout=subprocess.DEVNULL)
                subprocess.run(adb + ['shell', 'rm', remote_video], check=False)
