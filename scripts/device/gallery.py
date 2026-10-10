#!/usr/bin/env python3
"""One physical swipe in a gallery already opened by gallery.yaml. No benchmark or preference changes."""
import json, sys, time
from pathlib import Path
from gesture import adb, dump, bounds, text_of
app=sys.argv[1]
root=dump()
images=[n for n in root.iter('node') if 'Coast illustration' in text_of(n) and bounds(n) and bounds(n)[2]-bounds(n)[0]>100 and bounds(n)[3]-bounds(n)[1]>80]
if not images: raise RuntimeError('No displayed image bounds; inspect gallery-ready screenshot')
image=min(images,key=lambda n:(bounds(n)[2]-bounds(n)[0])*(bounds(n)[3]-bounds(n)[1]))
x1,y1,x2,y2=bounds(image)
y=int(y1+(y2-y1)*.4)
adb('shell','input','swipe',str(int(x1+(x2-x1)*.8)),str(y),str(int(x1+(x2-x1)*.2)),str(y),'600')
time.sleep(1)
after=dump()
passed=any('2 / 2' in text_of(n) for n in after.iter('node'))
p=Path('artifacts/device');p.mkdir(parents=True,exist_ok=True)
p.joinpath(f'gallery-{app}.png').write_bytes(__import__('subprocess').check_output(['adb','-s','MTK0000903071707360','exec-out','screencap','-p']))
result={'platform':app,'physicalSwipe':passed,'imageBounds':[x1,y1,x2,y2],'modelCalls':0,'preferencesChanged':False}
p.joinpath(f'gallery-{app}.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result),flush=True)
assert passed, 'Horizontal swipe did not advance the image page'
