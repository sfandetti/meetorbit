import os, subprocess, threading, time, uuid
from pathlib import Path

RUNS=[];LOCK=threading.Lock()

def folder(value):
    if not value:return ''
    p=Path(os.path.expandvars(value)).expanduser().resolve()
    if not p.is_dir():raise ValueError('The working folder does not exist')
    return str(p)

def validate(items,inventory,previous):
    if not isinstance(items,list) or len(items)>6:raise ValueError('Choose up to six shortcuts')
    allowed={a['id']:a for a in inventory};old={a['id']:a for a in previous};chosen=[]
    for item in items:
        if not isinstance(item,dict):raise ValueError('Invalid shortcut')
        kind=item.get('kind','app')
        if kind=='app':
            app=allowed.get(item.get('id')) or old.get(item.get('id'))
            if not app or app.get('kind','app')!='app':raise ValueError('Choose an app from the detected list')
            chosen.append({'kind':'app','id':app['id'],'name':app['name'][:60]});continue
        if kind=='system':
            action=item.get('action')
            names={'cleanup':'Privacy cleanup','lock':'Lock PC','signout':'Sign out'}
            if action not in names:raise ValueError('Choose a supported system shortcut')
            chosen.append({'kind':'system','id':'system:'+action,'name':names[action],'action':action});continue
        if kind not in ('executable','command'):raise ValueError('Choose an app, executable or command')
        name=str(item.get('name','')).strip()
        if not name or len(name)>60:raise ValueError('Give the shortcut a name of up to 60 characters')
        result={'kind':kind,'id':str(item.get('id') or uuid.uuid4().hex),'name':name,'cwd':folder(item.get('cwd','')),'show_terminal':bool(item.get('show_terminal',False))}
        if kind=='executable':
            p=Path(os.path.expandvars(str(item.get('path','')))).expanduser().resolve()
            if not p.is_file() or p.suffix.lower()!='.exe':raise ValueError('Choose an existing .exe file')
            args=str(item.get('arguments',''))
            if len(args)>4000 or any(c in args for c in '\x00\r\n'):raise ValueError('Arguments must be one line, up to 4000 characters')
            result.update(path=str(p),arguments=args)
        else:
            command=str(item.get('command','')).strip()
            if not command or len(command)>4000 or '\x00' in command:raise ValueError('Enter a command of up to 4000 characters')
            result['command']=command
        chosen.append(result)
    return chosen

def launch(item):
    kind=item.get('kind','app')
    if kind=='app':subprocess.Popen(['explorer.exe','shell:AppsFolder\\'+item['id']]);return 'Opened '+item['name'][:20]
    cwd=item.get('cwd') or None
    if kind=='executable':
        command=subprocess.list2cmdline([item['path']])+(' '+item['arguments'] if item.get('arguments') else '')
        subprocess.Popen(command,cwd=cwd,shell=False);return 'Started '+item['name'][:20]
    with LOCK:
        if sum(r['state']=='Running' for r in RUNS)>=4:raise ValueError('Four commands are already running')
        run={'id':uuid.uuid4().hex,'name':item['name'],'state':'Running','output':'','exit_code':None,'at':time.time()}
        RUNS.append(run);RUNS[:]=RUNS[-20:]
    command=[os.environ.get('COMSPEC',r'C:\Windows\System32\cmd.exe'),'/d','/s','/k' if item.get('show_terminal') else '/c',item['command']]
    try:
        visible=item.get('show_terminal',False)
        p=subprocess.Popen(command,cwd=cwd,stdout=None if visible else subprocess.PIPE,stderr=None if visible else subprocess.STDOUT,creationflags=subprocess.CREATE_NEW_CONSOLE if visible else 0x08000000)
    except Exception:
        run.update(state='Failed',output='Could not start. Check the command and working folder.');raise ValueError(run['output']) from None
    def finish():
        if p.stdout:
            while chunk:=p.stdout.read(1024):
                with LOCK:run['output']=(run['output']+chunk.decode(errors='replace'))[-16000:]
            p.stdout.close()
        code=p.wait()
        with LOCK:run.update(exit_code=code,state='Finished' if code==0 else 'Failed')
    threading.Thread(target=finish,daemon=True).start()
    return 'Started '+item['name'][:20]

def status():
    with LOCK:return [dict(r) for r in reversed(RUNS)]
