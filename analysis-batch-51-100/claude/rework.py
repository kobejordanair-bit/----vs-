# Move one person's generated outputs into attempts/NN.combined.K with a
# hash manifest and reason, so a revised manuscript can be split again.
# Usage: python3 -I rework.py NN K "reason"
import sys,os,glob,json,hashlib,shutil
n,k,reason=sys.argv[1:4]; B='analysis-batch-51-100'; A=f'{B}/attempts/{n}.combined.{k}'
os.makedirs(A)
files=[f for f in glob.glob(f'{B}/drafts/{n}.*') if not f.endswith(('.draft.md',))]+glob.glob(f'{B}/reviews/{n}.*')+glob.glob(f'{B}/results.{n}-{n}.v1.json')
man={}
for f in files:
  dst=os.path.join(A,os.path.basename(f)); man[os.path.basename(f)]=hashlib.sha256(open(f,'rb').read()).hexdigest()
  if f.endswith('.search-log.json'): shutil.copy(f,dst); os.remove(f)
  else: shutil.move(f,dst)
json.dump({"format":"dynasty-batch50-attempt-archive","schemaVersion":1,"slug":n,"attempt":int(k),"provider":"Claude Code (Anthropic)","reason":reason,"files":man},open(f'{A}/archive-manifest.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
print(A,len(man))
