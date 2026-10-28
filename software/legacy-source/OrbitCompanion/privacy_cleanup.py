import hashlib, json, os, secrets, subprocess, time
from pathlib import Path

PLANS={}
BROWSER_PARTS={'history':['History','History-journal','History-wal','History-shm'],'cookies':['Network/Cookies','Network/Cookies-journal','Network/Cookies-wal','Network/Cookies-shm','Cookies','Cookies-journal','Cookies-wal','Cookies-shm'],'cache':['Cache','Code Cache','GPUCache','Service Worker/CacheStorage']}

def related(a,b):return a==b or a in b.parents or b in a.parents

def validate_folders(values,protected):
    if not isinstance(values,list) or len(values)>12:raise ValueError('Choose up to twelve folders')
    result=[];home=Path.home().resolve()
    blocked=[Path(os.environ.get('SystemRoot',r'C:\Windows')),Path(os.environ.get('ProgramFiles',r'C:\Program Files')),Path(os.environ.get('ProgramFiles(x86)',r'C:\Program Files (x86)')),Path(os.environ.get('ProgramData',r'C:\ProgramData')),home/'AppData',*protected]
    top=[home,home/'Desktop',home/'Documents',home/'Downloads',home/'OneDrive',home/'OneDrive/Desktop',home/'OneDrive/Documents']
    for value in values:
        raw=Path(os.path.expandvars(str(value))).expanduser()
        if any(q.is_symlink() or q.is_junction() for q in [raw,*raw.parents]):raise ValueError('Cleanup folders cannot be links or junctions')
        p=raw.resolve()
        if not p.is_dir() or p==Path(p.anchor) or p in top or any(related(p,b.resolve()) for b in blocked):raise ValueError('Choose a specific personal subfolder, outside system and app folders')
        if any(related(p,Path(existing)) for existing in result):raise ValueError('Cleanup folders must not overlap')
        result.append(str(p))
    return result

def browser_roots():
    base=Path(os.environ.get('LOCALAPPDATA',''))
    return {'chrome':base/'Google/Chrome/User Data','edge':base/'Microsoft/Edge/User Data'}

def browser_profiles(root):
    # Never follow links; selection spans Default and numbered local profiles.
    if any(p.is_symlink() or p.is_junction() for p in [root,*root.parents]):raise ValueError('Browser profile links are not supported')
    if not root.exists():return []
    profiles=[]
    for p in root.iterdir():
        if p.name=='Default' or p.name.startswith('Profile ') and p.name[8:].isdigit():
            if p.is_symlink() or p.is_junction():raise ValueError('Browser profile links are not supported')
            if p.is_dir():profiles.append(p)
    return profiles

def validate_browsers(values):
    allowed={browser+'_'+part for browser in browser_roots() for part in BROWSER_PARTS}
    if not isinstance(values,list) or any(v not in allowed for v in values):raise ValueError('Choose supported browser data categories')
    return sorted(set(values))

def collect(path,entries,include_root=True):
    if path.is_symlink() or path.is_junction():raise ValueError('Links or junctions are not allowed in cleanup targets')
    if not path.exists():return
    stat=path.stat();entries[str(path)]={'path':str(path),'directory':path.is_dir(),'size':stat.st_size,'mtime':stat.st_mtime_ns}
    if path.is_dir():
        for child in path.iterdir():collect(child,entries)
        if not include_root:entries.pop(str(path))
    if len(entries)>20000:raise ValueError('Cleanup selection is too large; choose smaller folders')

def snapshot(profile):
    entries={};roots=browser_roots()
    for browser in {v.split('_')[0] for v in profile.get('privacy_browsers',[])}:
        result=subprocess.run(['tasklist.exe','/fi','IMAGENAME eq '+browser+'.exe','/fo','csv','/nh'],capture_output=True,text=True,creationflags=0x08000000)
        if '"'+browser+'.exe"' in result.stdout.lower():raise ValueError('Close '+browser.title()+' before clearing its local data')
    for folder in profile.get('privacy_folders',[]):collect(Path(folder),entries,False)
    for selected in profile.get('privacy_browsers',[]):
        browser,part=selected.split('_')
        for root in browser_profiles(roots[browser]):
            for name in BROWSER_PARTS[part]:collect(root/name,entries)
    records=sorted(entries.values(),key=lambda e:e['path'])
    digest=hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()
    return records,digest

def prepare(profile):
    records,digest=snapshot(profile)
    if not records:raise ValueError('No files found in the selected cleanup targets')
    token=secrets.token_urlsafe(24);now=time.time()
    for expired in [k for k,v in PLANS.items() if v['expires']<now]:PLANS.pop(expired,None)
    if len(PLANS)>8:PLANS.clear()
    PLANS[token]={'profile':dict(profile),'records':records,'digest':digest,'expires':now+120}
    return {'confirmation':token,'files':sum(not e['directory'] for e in records),'bytes':sum(e['size'] for e in records if not e['directory']),'folders':profile.get('privacy_folders',[]),'browser_data':profile.get('privacy_browsers',[]),'warning':'Permanently delete these selected local files? This cannot be undone in Orbit. Backups, sync copies and SSD recovery are not covered.'}

def commit(token):
    plan=PLANS.pop(token,None)
    if not plan or time.time()>plan['expires']:raise ValueError('Confirmation expired. Review cleanup again')
    _,digest=snapshot(plan['profile'])
    if digest!=plan['digest']:raise ValueError('Files changed after review. Review cleanup again')
    deleted=0;failed=0
    for entry in sorted(plan['records'],key=lambda e:len(Path(e['path']).parts),reverse=True):
        p=Path(entry['path'])
        try:
            if any(q.is_symlink() or q.is_junction() for q in [p,*p.parents]):raise OSError('Target changed')
            if entry['directory']:p.rmdir()
            else:p.unlink();deleted+=1
        except OSError:failed+=1
    return {'status':str(deleted)+' files deleted'+('; '+str(failed)+' items could not be removed' if failed else ''),'deleted':deleted,'failed':failed}
