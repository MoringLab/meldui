#!/usr/bin/env python3
"""Check existing installed demos; restore display and accessibility preferences."""
import json
import os
from pathlib import Path
import subprocess
import time
import sys

ROOT = Path(__file__).resolve().parent.parent
SERIAL = os.environ.get('ANDROID_SERIAL', 'MTK0000903071707360')
adb = ['adb', '-s', SERIAL]
maestro = os.environ.get('MAESTRO_BIN', str(ROOT/'artifacts/tools/maestro/bin/maestro'))
env = dict(os.environ, MAESTRO_CLI_NO_ANALYTICS='1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED='true')
out = ROOT/'artifacts/conditions'
out.mkdir(parents=True,exist_ok=True)
journal = out/'restore-pending.json'
apps = {'expo':'dev.engine.lab.expo','flutter':'dev.engine.engine_lab'}
def shell(*args):
    return subprocess.check_output(adb+['shell',*args],text=True).strip()
def screenshot(name):
    with (out/f'{name}.png').open('wb') as file:
        subprocess.run(adb+['exec-out','screencap','-p'],stdout=file,check=True)
def flow(name,app):
    directory=out/f'{app}-{name}';directory.mkdir(exist_ok=True)
    with (directory/'flow.log').open('w') as log:
        subprocess.run([maestro,'test','--udid',SERIAL,'--test-output-dir',str(directory),'--debug-output',str(directory),'-e',f'APP_ID={apps[app]}',str(ROOT/f'tests/device/{name}.yaml')],env=env,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=120)
    print(app,name,'PASS',flush=True)
if '--restore' in sys.argv:
    saved=json.loads(journal.read_text())
    for namespace,values in saved.items():
        for key,value in values.items():
            shell('settings','delete' if value=='null' else 'put',namespace,key,*([] if value=='null' else [value]))
    journal.unlink()
    print('Saved display/accessibility preferences restored',flush=True)
    raise SystemExit
if journal.exists():
    raise RuntimeError('Restore saved preferences with --restore before another conditions run')
original = {key:shell('settings','get','system',key) for key in ['font_scale','accelerometer_rotation','user_rotation']}
secure = {key:shell('settings','get','secure',key) for key in ['enabled_accessibility_services','accessibility_enabled']}
journal.write_text(json.dumps({'system':original,'secure':secure}))
results=[]
try:
    for app in apps:
        shell('settings','put','system','accelerometer_rotation','0')
        shell('settings','put','system','user_rotation','0')
        flow('resume',app);results.append({'app':app,'backgroundResume':True})
        subprocess.run(adb+['reverse','--remove','tcp:8787'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
        assert 'tcp:8787' not in subprocess.check_output(adb+['reverse','--list'],text=True), 'Engine forwarding is still active'
        try:
            flow('connection',app);results[-1]['offlineKeepsUI']=True
        finally:
            subprocess.run(adb+['reverse','tcp:8787','tcp:8787'],check=True)
        shell('settings','put','system','font_scale','1.3')
        shell('am','start','-n',apps[app]+'/.MainActivity');time.sleep(2)
        screenshot(app+'-large-text')
        shell('settings','put','system','accelerometer_rotation','0')
        shell('settings','put','system','user_rotation','1');time.sleep(2)
        screenshot(app+'-landscape')
        for key,value in original.items():
            shell('settings','delete' if value=='null' else 'put','system',key,*([] if value=='null' else [value]))
    # Release the automation service started by these test flows before TalkBack.
    for package in ['dev.mobile.maestro','dev.mobile.maestro.test']:
        shell('am','force-stop',package)
    service='com.google.android.marvin.talkback/.TalkBackService'
    prior=secure['enabled_accessibility_services']
    enabled=[] if prior in ['null',''] else prior.split(':')
    if service not in enabled: enabled.append(service)
    shell('settings','put','secure','enabled_accessibility_services',':'.join(enabled))
    shell('settings','put','secure','accessibility_enabled','1')
    time.sleep(3)
    for app in apps:
        shell('am','start','-n',apps[app]+'/.MainActivity');time.sleep(2)
        shell('input','keyevent','4')  # Dismiss first-run help if shown.
        shell('am','start','-n',apps[app]+'/.MainActivity')
        for step in range(3):
            shell('input','swipe','100','450','300','450','180');time.sleep(.4)
        screenshot(app+'-talkback')
    accessibility=shell('dumpsys','accessibility')
    results.append({'talkBackServiceObserved': 'TalkBackService' in accessibility})
finally:
    restored = False
    try:
        for namespace,values in [('system',original),('secure',secure)]:
            for key,value in values.items():
                shell('settings','delete' if value=='null' else 'put',namespace,key,*([] if value=='null' else [value]))
        subprocess.run(adb+['reverse','tcp:8787','tcp:8787'],check=True)
        restored = all(shell('settings','get',namespace,key) == value for namespace,values in [('system',original),('secure',secure)] for key,value in values.items())
    finally:
        (out/'results.json').write_text(json.dumps({'device':SERIAL,'results':results,'preferencesRestored':restored},indent=2))
    if restored: journal.unlink()
    assert restored, 'Display or accessibility preferences were not restored'
