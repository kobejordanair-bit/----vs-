# Usage: python3 -I refs.py TYPE  -> calibration references (name rank stats) of that type
import json,sys
d=json.load(open('analysis-batch-51-100/stats-reference.v1.json'))
items=next(v for v in d.values() if isinstance(v,list))
for x in sorted(items,key=lambda x:x['name']):
  if x['type']==sys.argv[1]: print(x['name'],x['rank'],x['stats'])
