#!/usr/bin/env python3
"""A single physical part-slider drag; no benchmark or device preference changes."""
import json,re,subprocess,sys,time
from pathlib import Path
from gesture import adb,dump,bounds,text_of
platform=sys.argv[1]
root=dump()
sliders=[n for n in root.iter('node') if 'SeekBar' in n.get('class','') and bounds(n) and bounds(n)[1]>265]
assert sliders, 'No visible part slider'
slider=sliders[0];x1,y1,x2,y2=bounds(slider);y=(y1+y2)//2
before={text_of(n) for n in root.iter('node') if re.fullmatch(r'\d+(?:\.\d+)?',text_of(n))}
adb('shell','input','swipe',str(int(x1+(x2-x1)*.1)),str(y),str(int(x1+(x2-x1)*.8)),str(y),'500')
time.sleep(.4)
after={text_of(n) for n in dump().iter('node') if re.fullmatch(r'\d+(?:\.\d+)?',text_of(n))}
assert before != after, 'Part slider did not change its bound value'
out=Path('artifacts/phase3');out.mkdir(exist_ok=True)
(out/f'native-scene-{platform}.json').write_text(json.dumps({'platform':platform,'physicalSliderChanged':True,'before':sorted(before),'after':sorted(after),'preferencesChanged':False,'scope':'One physical bound input change; not a timing benchmark'},indent=2))
(out/f'native-scene-{platform}.png').write_bytes(subprocess.check_output(['adb','-s','MTK0000903071707360','exec-out','screencap','-p']))
print(platform,'physical scene slider PASS',flush=True)
