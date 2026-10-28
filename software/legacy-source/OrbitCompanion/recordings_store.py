"""Manage only finalized Orbit recordings; never expose/delete active clips."""
import os, subprocess
from pathlib import Path

def recording_path(data, name):
    folder=Path(data)/'Recordings'
    if not isinstance(name,str) or not name or '/' in name or '\\' in name or ':' in name or not name.endswith('.avi') or name.endswith('.part.avi'):
        raise ValueError('Choose a finished recording')
    p=folder/name
    if p.is_symlink() or p.resolve().parent!=folder.resolve() or not p.is_file():
        raise ValueError('Recording not found')
    return p

def list_recordings(data):
    rows=[]
    for p in (Path(data)/'Recordings').glob('*.avi'):
        try:
            p=recording_path(data,p.name);s=p.stat()
            rows.append({'name':p.name,'bytes':s.st_size,'at':s.st_mtime})
        except (OSError,ValueError):continue
    return sorted(rows,key=lambda r:r['at'],reverse=True)[:200]

def delete_recording(data,name):
    p=recording_path(data,name)
    try:p.unlink()
    except PermissionError:raise ValueError('Recording is in use. Close its player and try again.') from None
    return {'status':'Recording deleted','name':name}

def open_folder(data):
    folder=Path(data)/'Recordings';folder.mkdir(parents=True,exist_ok=True)
    explorer=Path(os.environ.get('WINDIR',r'C:\Windows'))/'explorer.exe'
    try:
        # Launch Explorer explicitly rather than relying on a folder association.
        subprocess.Popen([str(explorer),str(folder.resolve())],cwd=str(folder),creationflags=0x08000000)
    except OSError:raise ValueError('Could not open File Explorer. You can download or delete recordings in the list below.') from None
    return {'status':'Recordings folder requested','folder':str(folder)}
