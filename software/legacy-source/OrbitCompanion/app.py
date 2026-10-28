from __future__ import annotations
import base64, ctypes, hashlib, hmac, json, os, secrets, subprocess, sys, threading, time, urllib.request, urllib.parse, uuid, webbrowser
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ctypes import wintypes
import ai_providers, shortcuts, privacy_cleanup, recordings_store, media_status
from alarm_audio import Alarm
ALARM=Alarm(); PRIVACY_PENDING={}; PIN_FAILURES=0; PIN_BLOCKED_UNTIL=0

ROOT=Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
sys.path.insert(0,str(ROOT/'packages'))
DATA=Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'OrbitCompanion'
PORT=8910
PAGES=['Welcome','Prism clock','Split clock','PC matrix','CPU pulse','GPU engine','Thermals','Network','Memory','Storage','Power','Six channels','Type clock','Binary clock','Focus timer','Stopwatch','AI desk','Music remote','App launcher','Sentry','Privacy guard']
THEMES=['Office','Retro','Cyberpunk','Bubblegum']
PALETTES=['Glacier','Electric orchid','Acid lime','Solar amber','Lavender']
DEFAULT={'quick_taps':[17,16,18],'alarm_enabled':False,'alarm_sound':'siren','alarm_loop':False,'ai_provider':'openai','cursor_path':'','provider_models':{},'privacy_folders':[],'privacy_browsers':[],'name':'Friend','address':'seth-orbit.local','theme':0,'palette':0,'brightness':70,'screens':list(range(21)),'camera':None,'camera_path':'','apps':[], 'model':'','startup':False,'startup_page':0,'record_timestamp':True,'record_camera_name':True,'camera_name':'','motion_sensitivity':2.0,'recording_limit_mb':1024,'timezone':'EST5EDT,M3.2.0,M11.1.0'}
LOCK=threading.RLock()
STATE={'online':False,'status':{},'camera':'Off','ai':'Ready','firmware':'Not installed by this app','last_reply':None,'error':''}
PROFILE={}; SECRETS={}; MESSAGE=None; ACK=None; PREVIEW_UNTIL=0; LAST_FRAME=0; SEEN=set(); COMMAND_HISTORY=[]; AI_PENDING=set(); STOP=threading.Event(); CAMERA_LOCK=threading.Lock(); INVENTORY={'apps':[],'cameras':[],'ports':[]}
TOKEN=secrets.token_urlsafe(32)

def atomic(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2),encoding='utf-8');os.replace(tmp,path)

class Blob(ctypes.Structure):
    _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]

def protect(text, decrypt=False):
    raw=base64.b64decode(text) if decrypt else text.encode()
    buf=ctypes.create_string_buffer(raw); inp=Blob(len(raw),ctypes.cast(buf,ctypes.POINTER(ctypes.c_ubyte)));out=Blob()
    dll=ctypes.windll.crypt32
    if decrypt: ok=dll.CryptUnprotectData(ctypes.byref(inp),None,None,None,None,1,ctypes.byref(out))
    else: ok=dll.CryptProtectData(ctypes.byref(inp),'Orbit private settings',None,None,None,1,ctypes.byref(out))
    if not ok: raise OSError('Windows could not unlock private settings for this account')
    try:
        data=ctypes.string_at(out.data,out.size)
        return data.decode() if decrypt else base64.b64encode(data).decode()
    finally: ctypes.windll.kernel32.LocalFree(out.data)

def load():
    global PROFILE,SECRETS
    DATA.mkdir(parents=True,exist_ok=True)
    PROFILE=dict(DEFAULT)
    if (DATA/'profile.json').exists():
        saved=json.loads((DATA/'profile.json').read_text('utf-8-sig'));PROFILE.update(saved)
        if saved.get('ui_schema',0)<2:PROFILE['screens']=sorted(set(PROFILE['screens']+[20]))
        if saved.get('theme_schema',0)<1 and PROFILE.get('theme')==2 and PROFILE.get('palette') in (0,1):PROFILE['palette']=1-PROFILE['palette']
    PROFILE['ui_schema']=2
    PROFILE['theme_schema']=1
    if (DATA/'private.json').exists(): SECRETS=json.loads(protect(json.loads((DATA/'private.json').read_text())['protected'],True))
    if (DATA/'commands.json').exists(): COMMAND_HISTORY.extend(json.loads((DATA/'commands.json').read_text())[-500:]);SEEN.update(COMMAND_HISTORY)

def public():
    return {**PROFILE,'key_configured':bool(SECRETS.get(ai_providers.KEYS[PROFILE.get('ai_provider','openai')])),'provider_keys':{p:bool(SECRETS.get(k)) for p,k in ai_providers.KEYS.items()},'cursor_available':bool(ai_providers.cursor_binary(PROFILE.get('cursor_path',''))),'alarm_active':ALARM.active,'pin_enabled':bool(SECRETS.get('pin_hash')),'paired':bool(SECRETS.get('pair_key'))}

def validate(data):
    out=dict(PROFILE)
    name=str(data.get('name',out['name'])).strip()
    if not 1<=len(name)<=24 or any(ord(c)<32 or ord(c)>126 for c in name): raise ValueError('Use a name with 1–24 plain letters, numbers or spaces')
    address=str(data.get('address',out['address'])).strip()
    if not address or len(address)>253 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-' for c in address): raise ValueError('Enter only the device IP address or local hostname')
    pages=data.get('screens',out['screens'])
    if not isinstance(pages,list) or not pages or any(type(i)!=int or i<0 or i>=len(PAGES) for i in pages): raise ValueError('Select at least one screen')
    startup_page=int(data.get('startup_page',out.get('startup_page',0)))
    if startup_page not in range(len(PAGES)):raise ValueError('Choose a valid startup screen')
    quick_taps=data.get('quick_taps',out.get('quick_taps',[17,16,18]))
    if not isinstance(quick_taps,list) or len(quick_taps)!=3 or any(type(v)!=int or v not in range(-1,len(PAGES)) for v in quick_taps):raise ValueError('Choose a screen or Off for each Quick Tap')
    out['quick_taps']=quick_taps
    pages=sorted(set(pages+[0,startup_page]))
    out.update(startup_page=startup_page,record_timestamp=bool(data.get('record_timestamp',out.get('record_timestamp',True))),record_camera_name=bool(data.get('record_camera_name',out.get('record_camera_name',True))))
    theme=int(data.get('theme',out.get('theme',0)))
    if not 0<=theme<4:raise ValueError('Choose a valid theme')
    palette=int(data.get('palette',out['palette']));brightness=int(data.get('brightness',out['brightness']))
    if not 0<=palette<5 or not 5<=brightness<=100: raise ValueError('Invalid display setting')
    chosen=shortcuts.validate(data.get('apps',out['apps']),INVENTORY['apps'],PROFILE.get('apps',[]))
    provider=data.get('ai_provider',out.get('ai_provider','openai'))
    if provider not in ai_providers.KEYS:raise ValueError('Choose OpenAI, Claude or Cursor')
    cursor_path=str(data.get('cursor_path',out.get('cursor_path',''))).strip()
    if cursor_path and not ai_providers.cursor_binary(cursor_path):raise ValueError('Choose an existing Cursor agent.exe')
    saved_models=data.get('provider_models',out.get('provider_models',{}))
    if not isinstance(saved_models,dict):raise ValueError('Invalid saved model choices')
    out['privacy_folders']=privacy_cleanup.validate_folders(data.get('privacy_folders',out.get('privacy_folders',[])),[ROOT,ROOT.parent if getattr(sys,"frozen",False) else ROOT,DATA])
    out['privacy_browsers']=privacy_cleanup.validate_browsers(data.get('privacy_browsers',out.get('privacy_browsers',[])))
    sound=data.get('alarm_sound',out.get('alarm_sound','siren'))
    if sound not in ('siren','retro','intruder'):raise ValueError('Choose a supported alarm sound')
    out.update(alarm_enabled=bool(data.get('alarm_enabled',out.get('alarm_enabled',False))),alarm_sound=sound,alarm_loop=bool(data.get('alarm_loop',out.get('alarm_loop',False))))
    out.update(ai_provider=provider,cursor_path=cursor_path,provider_models={k:str(saved_models.get(k,''))[:100] for k in ai_providers.KEYS})
    camera=data.get('camera',out['camera'])
    if camera is not None and (type(camera)!=int or camera<0 or camera>31): raise ValueError('Choose a detected camera')
    if camera is not None and INVENTORY['cameras'] and camera not in [c['id'] for c in INVENTORY['cameras']]: raise ValueError('That camera is no longer available')
    camera_path=next((c.get('path','') for c in INVENTORY['cameras'] if c['id']==camera),'') if camera is not None else ''
    tz=str(data.get('timezone',out['timezone']))
    if not tz or len(tz)>80 or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,+-:/.' for c in tz): raise ValueError('Invalid device time zone')
    sensitivity=float(data.get('motion_sensitivity',out.get('motion_sensitivity',2)))
    limit=int(data.get('recording_limit_mb',out.get('recording_limit_mb',1024)))
    if not .2<=sensitivity<=20 or not 100<=limit<=20000:raise ValueError('Choose sensitivity from 0.2–20% and storage from 100–20000 MB')
    if CAMERA.armed and (camera_path!=PROFILE.get('camera_path','') or camera!=PROFILE.get('camera')):raise ValueError('Disarm Sentry before switching cameras')
    out['camera_name']=next((c['name'][:60] for c in INVENTORY['cameras'] if c['id']==camera),out.get('camera_name','Camera'))
    out.update(motion_sensitivity=sensitivity,recording_limit_mb=limit,name=name,address=address,theme=theme,palette=palette,brightness=brightness,screens=sorted(set(pages)),apps=chosen,camera=camera,camera_path=camera_path,timezone=tz,model=str(data.get('model',out['model'])).strip()[:100],startup=bool(data.get('startup',out['startup'])))
    return out

def startup(enabled):
    import winreg
    key=winreg.CreateKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Run')
    with key:
        if enabled:
            args=[sys.executable] if getattr(sys,'frozen',False) else [str(Path(sys.executable).with_name('pythonw.exe')),str(ROOT/'app.py')]
            winreg.SetValueEx(key,'OrbitCompanion',0,winreg.REG_SZ,subprocess.list2cmdline(args))
        else:
            try:winreg.DeleteValue(key,'OrbitCompanion')
            except FileNotFoundError:pass

def require_pin(value):
    global PIN_FAILURES,PIN_BLOCKED_UNTIL
    if not SECRETS.get('pin_hash'):return
    if time.time()<PIN_BLOCKED_UNTIL:raise ValueError('Too many incorrect passcodes. Wait 30 seconds')
    digest=hashlib.sha256((SECRETS['pin_salt']+str(value)).encode()).hexdigest()
    if not hmac.compare_digest(digest,SECRETS['pin_hash']):
        PIN_FAILURES+=1
        if PIN_FAILURES>=5:PIN_BLOCKED_UNTIL=time.time()+30;PIN_FAILURES=0
        raise ValueError('Incorrect passcode')
    PIN_FAILURES=0

def save(data):
    global PROFILE
    with LOCK:
        candidate=validate(data)
        new_pin=str(data.get('new_pin',''));clear_pin=bool(data.get('clear_pin',False))
        if new_pin or clear_pin:
            require_pin(data.get('current_pin',''))
            if new_pin and (not new_pin.isascii() or not new_pin.isdigit() or not 4<=len(new_pin)<=6 or new_pin!=str(data.get('pin_confirm',''))):raise ValueError('Enter matching passcodes with four to six digits')
        key=data.get('api_key','').strip()
        if key:
            if len(key)<15 or len(key)>512 or any(c.isspace() for c in key):raise ValueError('Enter a valid API key')
            SECRETS[ai_providers.KEYS[candidate['ai_provider']]]=key
        if data.get('clear_key'):SECRETS.pop(ai_providers.KEYS[candidate['ai_provider']],None)
        if (candidate.get('camera'),candidate.get('camera_path'))!=(PROFILE.get('camera'),PROFILE.get('camera_path')):ALARM.stop();CAMERA.stop()
        if PROFILE.get('alarm_enabled') and not candidate.get('alarm_enabled'):ALARM.stop()
        startup(candidate['startup'])
        if new_pin:
            SECRETS['pin_salt']=secrets.token_hex(16);SECRETS['pin_hash']=hashlib.sha256((SECRETS['pin_salt']+new_pin).encode()).hexdigest()
        elif clear_pin:SECRETS.pop('pin_salt',None);SECRETS.pop('pin_hash',None)
        atomic(DATA/'private.json',{'protected':protect(json.dumps(SECRETS))})
        atomic(DATA/'profile.json',candidate);PROFILE=candidate
    return public()

def ps(script,timeout=20):
    p=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],capture_output=True,text=True,timeout=timeout,creationflags=0x08000000)
    if p.returncode:raise RuntimeError('Windows could not complete that operation')
    return p.stdout.strip().lstrip('\ufeff')

def inventory():
    apps=json.loads(ps("@(Get-StartApps | Sort-Object Name | ForEach-Object { @{name=$_.Name;id=$_.AppID} }) | ConvertTo-Json -Compress",30) or '[]')
    if isinstance(apps,dict):apps=[apps]
    try:
        from cv2_enumerate_cameras import enumerate_cameras
        cameras=[{'id':c.index,'name':c.name,'path':c.path} for c in enumerate_cameras(700)]
    except ImportError:
        cameras=[]
    try:
        import serial.tools.list_ports
        ports=[{'id':p.device,'name':p.description} for p in serial.tools.list_ports.comports()]
    except ImportError:ports=[]
    INVENTORY.update(apps=apps,cameras=cameras,ports=ports)
    return INVENTORY

def feed(fields):
    with LOCK: address=PROFILE['address'];key=SECRETS.get('pair_key','')
    if not key:raise ValueError('Pair the display first')
    req=urllib.request.Request('http://'+address+'/feed',urllib.parse.urlencode(fields).encode(),{'Authorization':'Bearer '+key})
    with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)

def message(title,body,attention=True):
    global MESSAGE
    with LOCK:
        MESSAGE={'id':uuid.uuid4().hex,'title':str(title)[:60],'body':str(body)[:240],'attention':bool(attention),'expires':time.time()+300}
        STATE['last_reply']=None
    return MESSAGE['id']

def ai(prompt):
    with LOCK:profile=dict(PROFILE);private=dict(SECRETS)
    if not str(prompt).strip():raise ValueError('Type a question first')
    STATE['ai']='Thinking...'
    try:
        answer,usage=ai_providers.ask(profile,private,prompt,DATA/'AIWorkspace')
        if not answer:raise ValueError('The provider returned no displayable text')
        message('Orbit AI',answer,True);STATE['ai']='Reply sent to display'
        return {'answer':answer,'usage':usage}
    finally:
        if STATE['ai']=='Thinking...':STATE['ai']='Request ended'

def models():return ai_providers.models(PROFILE,SECRETS)

from camera_manager import CameraManager
CAMERA=CameraManager(DATA,ROOT,lambda:PROFILE,lambda:(PROFILE['address'],SECRETS.get('pair_key','')),STOP)
def camera_frame():
    if STATE.get('status',{}).get('firmware') not in ('CYD-F','CYD-G','CYD-H','CYD-I','CYD-J'):raise ValueError('Connect the updated display before sending images')
    return CAMERA.snapshot()
def camera_service():
    published=0;was_recording=False;was_armed=False;last_alarm=0
    while not STOP.wait(.02):
        try:
            CAMERA.tick(STATE.get('online',False),STATE.get('status',{}).get('page'))
            if time.time()-published>.25:
                camera=CAMERA.status();STATE['camera']=camera.get('state','Off');published=time.time()
                motion_recording=CAMERA.armed and camera.get('recording',False)
                if motion_recording and not was_recording and PROFILE.get('alarm_enabled') and time.time()-last_alarm>10:
                    ALARM.start(PROFILE.get('alarm_sound','siren'),PROFILE.get('alarm_loop',False));last_alarm=time.time()
                was_recording=motion_recording
                if was_armed and not CAMERA.armed:ALARM.stop()
                was_armed=CAMERA.armed
        except Exception:STATE['camera']='Camera unavailable'

def media(action):
    keys={'play':0xB3,'next':0xB0,'previous':0xB1,'mute':0xAD,'louder':0xAF,'quieter':0xAE}
    key=keys[action];ctypes.windll.user32.keybd_event(key,0,0,0);ctypes.windll.user32.keybd_event(key,0,2,0)
    return 'Media command sent'

def sign_out():
    subprocess.Popen(['shutdown.exe','/l'],creationflags=0x08000000)
    return 'Signing out of Windows'

def request_system(action):
    if action=='lock':
        if not ctypes.windll.user32.LockWorkStation():raise ValueError('Windows could not lock this session')
        return 'PC locked'
    if action not in ('cleanup','signout'):raise ValueError('Unknown system shortcut')
    plan=privacy_cleanup.prepare(PROFILE) if action=='cleanup' else {}
    body=('Permanently delete '+str(plan['files'])+' selected files? Cannot undo. Hold YES to confirm; NO cancels.') if action=='cleanup' else 'Sign out of Windows? This closes your session and applications. Hold YES to confirm; NO cancels.'
    mid=message('Privacy cleanup' if action=='cleanup' else 'Sign out?',body,True)
    MESSAGE['expires']=time.time()+120;PRIVACY_PENDING.clear();PRIVACY_PENDING[mid]={'action':action,'confirmation':plan.get('confirmation'),'expires':time.time()+120}
    return 'Confirm YES or NO on AI desk'

def execute(command):
    global PREVIEW_UNTIL,MESSAGE
    if command.startswith('privacy:'):return request_system(command.split(':',1)[1])
    if command.startswith('media:'):return media(command.split(':')[1])
    if command.startswith('app:'):
        slot=int(command.split(':')[1])
        if slot not in range(len(PROFILE['apps'])):raise ValueError('Unknown shortcut')
        app=PROFILE['apps'][slot]
        return request_system(app['action']) if app.get('kind')=='system' else shortcuts.launch(app)
    if command=='camera:snap':camera_frame();return 'Snapshot received'
    if command=='camera:record':CAMERA.record();return 'Manual recording started'
    if command=='camera:live':CAMERA.preview();return 'Preview on for 60 seconds'
    if command=='camera:stop':ALARM.stop();CAMERA.stop();return 'Camera stopped'
    if command=='camera:arm':CAMERA.arm();return 'Sentry armed'
    if command=='camera:disarm':ALARM.stop();CAMERA.stop();return 'Sentry disarmed'
    if command=='ai:dismiss':
        with LOCK:MESSAGE=None
        return 'Message closed'
    if command=='ai:health':
        health={}
        try:health=json.loads((DATA/'pc-health-latest.json').read_text('utf-8-sig'))
        except (OSError,ValueError):pass
        ai('Briefly describe my PC health based on these live readings: '+json.dumps({k:v for k,v in health.items() if k not in ('deviceStatus','device','adapter')}));return 'AI answer ready'
    if command=='ai:checkin':ai('Give me a short useful desk check-in and ask what I want to focus on.');return 'AI answer ready'
    raise ValueError('Unknown or unconfigured control')

def handle_command(status):
    global ACK
    command=status.get('command','');cid=status.get('command_id');session=status.get('command_session')
    if not command:return
    if SECRETS.get('pin_hash') and (not status.get('pin_capable') or status.get('pin_locked')):
        ACK={'id':cid,'session':session,'result':'Unlock Orbit or update firmware'};return
    tag=f'{session}:{cid}'
    if tag in AI_PENDING:return
    if tag not in SEEN:
        SEEN.add(tag);COMMAND_HISTORY.append(tag)
        atomic(DATA/'commands.json',COMMAND_HISTORY[-500:])
        if command.startswith('ai:') and command!='ai:dismiss':
            AI_PENDING.add(tag)
            def answer_job():
                global ACK
                try:result=execute(command)
                except Exception:result='AI unavailable. Check AI desk.'
                finally:AI_PENDING.discard(tag)
                ACK={'id':cid,'session':session,'result':result}
            threading.Thread(target=answer_job,daemon=True).start();return
        try:result=execute(command)
        except Exception as e:result=str(e)[:40] if isinstance(e,(ValueError,KeyError,IndexError)) else 'Command could not complete'
        ACK={'id':cid,'session':session,'result':result}
    elif not ACK or ACK['id']!=cid or ACK['session']!=session:ACK={'id':cid,'session':session,'result':'Already handled; retry manually'}

def worker():
    global ACK,PREVIEW_UNTIL
    last_config=''
    while not STOP.wait(1):
        if not SECRETS.get('pair_key'):continue
        try:
            fields={}
            profile_tag=json.dumps(PROFILE,sort_keys=True)
            fields.update(pin_hash=SECRETS.get('pin_hash',''),pin_salt=SECRETS.get('pin_salt',''))
            fields.update(startup_page=PROFILE.get('startup_page',0),owner=PROFILE['name'],theme=PROFILE.get('theme',0),palette=PROFILE['palette'],brightness=PROFILE['brightness'],enabled=sum(1<<i for i in PROFILE['screens']),tz=PROFILE['timezone'])
            for i,v in enumerate(PROFILE.get('quick_taps',[17,16,18])):fields['quick'+str(i)]=v
            fields['media_state']=STATE.get('media','Unknown')
            fields.update(privacy_folders=len(PROFILE.get('privacy_folders',[])),privacy_browsers=len(PROFILE.get('privacy_browsers',[])))
            for i in range(6):fields['app'+str(i)]=PROFILE['apps'][i]['name'] if i<len(PROFILE['apps']) else 'Not set'
            with LOCK:
                msg=dict(MESSAGE) if MESSAGE else None
            if msg:
                fields.update(ai_id=msg['id'],ai_title=msg['title'],ai_body=msg['body'],ai_attention=int(msg['attention'] and msg['expires']>time.time()))
                fields['ai_expired']=int(msg['expires']<=time.time())
            else:fields['ai_clear']=1
            camera=CAMERA.status();fields.update(camera_state=camera.get('state','Off'),camera_armed=int(camera.get('armed',False)),camera_motion=camera.get('motion',0),camera_clips=camera.get('clips',0))
            if ACK:fields.update(command_ack=ACK['id'],command_session=ACK['session'],command_result=ACK['result'])
            status=feed(fields);STATE.update(online=True,status=status,error='')
            if msg and status.get('ai_id')==msg['id'] and status.get('reply') in ('YES','NO') and msg['expires']>time.time():
                reply={'id':msg['id'],'reply':status['reply'],'at':time.time()}
                STATE['last_reply']=reply;atomic(DATA/'ai-reply.json',reply)
                pending=PRIVACY_PENDING.pop(msg['id'],None)
                if pending and reply['reply']=='YES' and time.time()<pending['expires']:
                    def confirmed_job(pending=pending):
                        try:
                            result=privacy_cleanup.commit(pending['confirmation'])['status'] if pending['action']=='cleanup' else sign_out()
                        except Exception as e:result=str(e)[:180]
                        message('Privacy result',result,True)
                    threading.Thread(target=confirmed_job,daemon=True).start()
                with LOCK:
                    if MESSAGE and MESSAGE['id']==msg['id']:MESSAGE['attention']=False
            handle_command(status)
        except Exception:STATE.update(online=False,error='Display unavailable. Check power, pairing and the same Wi-Fi network.');PREVIEW_UNTIL=0

FIRMWARE_JOB={'running':False,'result':'Ready when the display is in loading mode'}
def provision(data):
    import serial
    port=data.get('port')
    if port not in [p['id'] for p in INVENTORY['ports']]:raise ValueError('Refresh and select a connected USB port')
    ssid=str(data.get('ssid',''));password=str(data.get('password',''))
    if not ssid or len(ssid.encode())>32 or any(c in ssid+password for c in '\r\n\t') or len(password)>63:raise ValueError('Check the Wi-Fi name and password')
    key=SECRETS.get('pair_key') or secrets.token_hex(16)
    connection=serial.Serial();connection.port=port;connection.baudrate=115200;connection.timeout=.3;connection.dtr=False;connection.rts=False
    try:
        connection.open();connection.write(('PAIR '+key+'\nWIFI\t'+ssid+'\t'+password+'\n').encode());connection.flush()
        deadline=time.time()+12;paired=False
        while time.time()<deadline:
            line=connection.readline().decode(errors='ignore')
            if 'PAIR SAVED' in line:paired=True
        if not paired:raise ValueError('No pairing acknowledgment. Boot normally after flashing, then try again.')
    finally:connection.close()
    with LOCK:
        SECRETS['pair_key']=key;atomic(DATA/'private.json',{'protected':protect(json.dumps(SECRETS))})
    return {'status':'Wi-Fi sent and pairing saved. Allow a few seconds to connect.'}

def flash(port):
    if port not in [p['id'] for p in INVENTORY['ports']]:raise ValueError('Select a detected USB port first')
    if FIRMWARE_JOB['running']:raise ValueError('An upload is already running')
    manifest=ROOT/'firmware'/'manifest.json'
    if not manifest.exists():raise ValueError('Firmware package is not included')
    spec=json.loads(manifest.read_text());images=[]
    for item in spec['images']:
        p=ROOT/'firmware'/item['file']
        if hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:raise ValueError('Firmware verification failed; download a fresh package')
        images.extend([item['offset'],str(p)])
    FIRMWARE_JOB.update(running=True,result='Uploading. Keep USB connected.')
    def run():
        try:
            cmd=[sys.executable,'-m','esptool','--chip','esp32','--port',port,'--baud','460800','--before','no-reset','--after','hard-reset','write-flash']+images
            if getattr(sys,'frozen',False):cmd=[str(ROOT/'esptool.exe')]+cmd[3:]
            p=subprocess.run(cmd,capture_output=True,text=True,timeout=150,creationflags=0x08000000)
            FIRMWARE_JOB['result']='Installed. If blank, release BOOT and tap RESET once.' if p.returncode==0 else 'Upload failed. Check the port and loading mode; existing Wi-Fi was not erased.'
        except Exception:FIRMWARE_JOB['result']='Upload did not complete. Check USB and loading mode.'
        finally:FIRMWARE_JOB['running']=False
    threading.Thread(target=run,daemon=True).start();return dict(FIRMWARE_JOB)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def valid_host(self):return self.headers.get('Host') in (f'127.0.0.1:{PORT}',f'localhost:{PORT}')
    def send(self,status,data,typ='application/json'):
        raw=json.dumps(data).encode() if typ=='application/json' else data
        self.send_response(status);self.send_header('Content-Type',typ);self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('Cross-Origin-Resource-Policy','same-origin');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if not self.valid_host():return self.send(403,{'error':'Local access only'})
        path=urllib.parse.urlparse(self.path).path
        if path in ('/','/app.js','/features.js','/style.css'):
            file=ROOT/'web'/({'/':'index.html'}.get(path,path[1:]));typ={'/':'text/html; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/features.js':'text/javascript; charset=utf-8','/style.css':'text/css; charset=utf-8'}[path]
            return self.send(200,file.read_bytes(),typ)
        if path.startswith('/fonts/') and path[7:] in ('Office.ttf','Retro.ttf','Cyber.ttf','Bubble.ttf'):
            return self.send(200,(ROOT/'web'/'fonts'/path[7:]).read_bytes(),'font/ttf')
        if path=='/api/state':return self.send(200,{'product':'OrbitCompanion','profile':public(),'state':STATE,'pages':PAGES,'palettes':PALETTES,'themes':THEMES,'token':TOKEN,'firmware':FIRMWARE_JOB,'camera_available':(DATA/'last-camera.jpg').exists(),'sentry':CAMERA.status(),'command_runs':shortcuts.status()})
        if path=='/api/inventory':
            try:return self.send(200,inventory())
            except Exception:return self.send(503,{'error':'Could not read PC devices. Try Refresh again.'})
        if path=='/api/recordings':
            return self.send(200,recordings_store.list_recordings(DATA))
        if path.startswith('/api/recordings/file/'):
            name=urllib.parse.unquote(path.split('/api/recordings/file/',1)[1])
            try:p=recordings_store.recording_path(DATA,name)
            except ValueError:return self.send(404,{'error':'Recording not found'})
            self.send_response(200);self.send_header('Content-Type','video/x-msvideo');self.send_header('Content-Length',str(p.stat().st_size));self.send_header('Content-Disposition','attachment; filename="'+name.replace('"','')+'"');self.send_header('Cross-Origin-Resource-Policy','same-origin');self.end_headers()
            with p.open('rb') as f:
                while chunk:=f.read(65536):self.wfile.write(chunk)
            return
        if path=='/api/camera.jpg':
            p=DATA/'last-camera.jpg'
            return self.send(200,p.read_bytes(),'image/jpeg') if p.exists() else self.send(404,{'error':'No snapshot yet'})
        if path=='/api/export':return self.send(200,{k:v for k,v in PROFILE.items() if k not in ('address','apps','camera','camera_path','camera_name','cursor_path','privacy_folders','privacy_browsers')})
        self.send(404,{'error':'Not found'})
    def do_POST(self):
        if not self.valid_host() or self.headers.get('Origin') not in (f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}') or not hmac.compare_digest(self.headers.get('X-Orbit-Token',''),TOKEN):return self.send(403,{'error':'Open Orbit Setup on this PC to continue'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size>16000:raise ValueError('Request is too large')
            data=json.loads(self.rfile.read(size));path=self.path
            if path=='/api/save':result=save(data)
            elif path=='/api/models':result=models()
            elif path=='/api/privacy/prepare':require_pin(data.get('pin',''));result=privacy_cleanup.prepare(PROFILE)
            elif path=='/api/privacy/commit':require_pin(data.get('pin',''));result=privacy_cleanup.commit(data.get('confirmation',''))
            elif path=='/api/system/action':
                if data.get('action')!='lock':require_pin(data.get('pin',''))
                result={'status':request_system(data.get('action'))}
            elif path=='/api/alarm/test':ALARM.start(PROFILE.get('alarm_sound','siren'),False);result={'status':'Playing selected alarm once'}
            elif path=='/api/alarm/stop':ALARM.stop();result={'status':'Alarm silenced'}
            elif path=='/api/shortcut/run':
                require_pin(data.get('pin',''))
                slot=int(data['slot'])
                if slot not in range(len(PROFILE['apps'])):raise ValueError('Choose a saved shortcut')
                item=PROFILE['apps'][slot];result={'status':request_system(item['action']) if item.get('kind')=='system' else shortcuts.launch(item)}
            elif path=='/api/ai':result=ai(data.get('prompt',''))
            elif path=='/api/message':result={'id':message(data.get('title','A quick question'),data.get('body',''),True)}
            elif path=='/api/provision':result=provision(data)
            elif path=='/api/flash':result=flash(data.get('port'))
            elif path=='/api/snapshot':result=camera_frame()
            elif path=='/api/camera/preview':
                STATE['status']=feed({'screen':19});STATE['online']=True;CAMERA.preview();result=CAMERA.status()
            elif path=='/api/camera/record':result=CAMERA.record()
            elif path=='/api/sentry/arm':result=CAMERA.arm()
            elif path=='/api/sentry/stop':result=ALARM.stop();CAMERA.stop()
            elif path=='/api/recordings/open':
                result=recordings_store.open_folder(DATA)
            elif path=='/api/recordings/delete':
                require_pin(data.get('pin',''))
                if data.get('confirm') is not True:raise ValueError('Confirm deletion first')
                result=recordings_store.delete_recording(DATA,data.get('name'))
            elif path=='/api/screen':
                page=int(data['page'])
                if page not in range(len(PAGES)):raise ValueError('Unknown screen')
                result=feed({'screen':page})
            elif path=='/api/media':result={'status':media(data['action'])}
            elif path=='/api/quit':STOP.set();result={'status':'Stopping companion'}
            else:return self.send(404,{'error':'Not found'})
            self.send(200,result)
        except urllib.error.HTTPError as e:self.send(400,{'error':f'Service returned {e.code}. Check credentials, model access and billing.'})
        except (ValueError,KeyError,IndexError) as e:self.send(400,{'error':str(e)[:200]})
        except Exception:self.send(500,{'error':'Operation could not complete. Check the device or PC permissions and try again.'})

def start_health():
    if not SECRETS.get('pair_key'):return None
    # Telemetry worker unlocks pairing using Windows DPAPI.
    return subprocess.Popen(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',str(ROOT/'health.ps1'),'-DataDirectory',str(DATA)],creationflags=0x08000000)

def media_worker():
    while not STOP.is_set():
        STATE['media']=media_status.playback_state(ps)
        STOP.wait(3)

def main():
    load()
    try:server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    except OSError:
        if '--open' in sys.argv:webbrowser.open(f'http://127.0.0.1:{PORT}')
        return
    threading.Thread(target=worker,daemon=True).start();threading.Thread(target=camera_service,daemon=True).start();threading.Thread(target=media_worker,daemon=True).start();health=start_health()
    threading.Thread(target=server.serve_forever,daemon=True).start()
    if '--open' in sys.argv:webbrowser.open(f'http://127.0.0.1:{PORT}')
    try:
        while not STOP.wait(1):
            if (health is None or health.poll() is not None) and SECRETS.get('pair_key'):
                health=start_health();STOP.wait(5)
    except KeyboardInterrupt:pass
    finally:
        ALARM.stop();CAMERA.stop();server.shutdown()
        if health:health.terminate()

if __name__=='__main__':
    if '--camera-worker' in sys.argv:
        from camera_worker import run
        run(sys.argv[sys.argv.index('--camera-worker')+1])
    else:main()

