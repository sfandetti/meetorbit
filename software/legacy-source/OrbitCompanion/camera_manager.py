from __future__ import annotations
import collections
import json,os,subprocess,sys,threading,time,urllib.request,secrets
from pathlib import Path

class CameraManager:
 def __init__(self,data,root,profile,device,stop):
  self.data=Path(data);self.root=Path(root);self.profile=profile;self.device=device;self.stop_event=stop
  self.process=None;self.mode='off';self.armed=False;self.preview_until=0;self.last_sent=0;self.lock=threading.RLock();self.last_error='';self.sent_times=collections.deque(maxlen=60);self.upload_average=.12;self.last_frame_sent=0;self.last_heartbeat=0
 def control(self,mode):
  with self.lock:
   p=self.profile()
   if p.get('camera') is None:raise ValueError('Select a webcam in Setup first')
   if self.process is None or self.process.poll() is not None:
    self.mode=mode;self.last_error=''
    (self.data/'camera-status.json').write_text(json.dumps({'state':'Starting','updated':time.time(),'recording':False}),encoding='utf-8')
    self.write_request(mode)
    args=[sys.executable,'--camera-worker',str(self.data)] if getattr(sys,'frozen',False) else [sys.executable,str(self.root/'camera_worker.py'),str(self.data)]
    self.process=subprocess.Popen(args,creationflags=0x08000000,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   else:self.mode=mode;self.write_request(mode)
 def write_request(self,mode):
  p=self.profile();request={'mode':mode,'heartbeat':time.time(),'camera':p.get('camera'),'camera_path':p.get('camera_path',''),'sensitivity':p.get('motion_sensitivity',2),'storage_mb':p.get('recording_limit_mb',1024),'timestamp':p.get('record_timestamp',True),'camera_name':p.get('camera_name','Camera') if p.get('record_camera_name',True) else ''}
  tmp=self.data/'camera-request.tmp';tmp.write_text(json.dumps(request),encoding='utf-8');
  for _ in range(10):
   try:os.replace(tmp,self.data/'camera-request.json');break
   except PermissionError:time.sleep(.002)
  self.last_heartbeat=time.time()
 def status(self):
  try:state=json.loads((self.data/'camera-status.json').read_text('utf-8'))
  except (OSError,ValueError):state={'state':'Off'}
  state.update(armed=self.armed,preview=self.preview_until>time.time(),clips=len(list((self.data/'Recordings').glob('*.avi'))),recordings_folder=str(self.data/'Recordings'))
  recent=[t for t in list(self.sent_times) if time.time()-t<5]
  state['preview_fps']=round((len(recent)-1)/(recent[-1]-recent[0]),1) if len(recent)>1 else 0
  state['upload_ms']=round(self.upload_average*1000)
  if self.last_error:state.update(state='Error',error=self.last_error,recording=False)
  return state
 def arm(self):
  self.control('sentry');self.armed=True;self.preview_until=time.time()+60;return self.status()
 def record(self):
  self.control("manual");self.armed=False;self.preview_until=time.time()+86400;return self.status()
 def preview(self):
  self.control('manual' if self.mode=='manual' else 'sentry' if self.armed else 'preview');self.preview_until=time.time()+60;return self.status()
 def stop(self):
  with self.lock:
   self.armed=False;self.preview_until=0;self.mode='off';self.last_error=''
   if self.process is not None and self.process.poll() is None:
    self.write_request('off')
    try:self.process.wait(timeout=3)
    except subprocess.TimeoutExpired:self.process.terminate();self.process.wait(timeout=2)
   self.process=None
   (self.data/'camera-status.json').write_text(json.dumps({'state':'Off','updated':time.time(),'recording':False}),encoding='utf-8')
  return self.status()
 def snapshot(self):
  before=(self.data/'camera-frame.bin').stat().st_mtime if (self.data/'camera-frame.bin').exists() else 0
  if self.process is None or self.process.poll() is not None:self.control('snapshot')
  end=time.time()+12
  while time.time()<end:
   s=self.status()
   if s.get('state')=='Error':raise ValueError(s.get('error','Camera failed'))
   path=self.data/'camera-frame.bin'
   if path.exists() and path.stat().st_mtime>before and len(path.read_bytes())==28800:
    # Let initial camera exposure settle before returning a single snapshot.
    if self.mode!='snapshot' or self.process.poll() is not None:return self.upload()
   time.sleep(.15)
  raise ValueError('Camera did not produce a frame in time')
 def upload(self):
  began=time.time();address,key=self.device()
  with (self.data/'camera-frame.bin').open('rb') as source:raw=source.read();produced_at=os.fstat(source.fileno()).st_mtime
  if len(raw)!=28800:raise ValueError('Incomplete camera frame')
  boundary=secrets.token_hex(16);body=(f'--{boundary}\r\nContent-Disposition: form-data; name="frame"; filename="frame.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()+raw+f'\r\n--{boundary}--\r\n'.encode())
  req=urllib.request.Request('http://'+address+'/camera',body,{'Authorization':'Bearer '+key,'Content-Type':'multipart/form-data; boundary='+boundary})
  with urllib.request.urlopen(req,timeout=4) as r:r.read()
  finished=time.time();self.last_sent=began;self.sent_times.append(finished);self.upload_average=.8*self.upload_average+.2*(finished-began);self.last_frame_sent=produced_at;return {'status':'Snapshot sent'}
 def tick(self,online,page):
  with self.lock:
   if self.mode=='preview' and (self.preview_until<time.time() or not online or page!=19):self.stop();return
   if self.process is not None:
    if self.process.poll() is None:
     if time.time()-self.last_heartbeat>1:self.write_request(self.mode)
    elif self.mode in ('sentry','preview','manual'):
     s=self.status();self.last_error=s.get('error') or 'Camera driver stopped. The companion is still running; restart the camera.';self.armed=False;self.preview_until=0;self.mode='off'
   if self.preview_until>time.time() and online and page==19 and time.time()-self.last_sent>max(1/6,min(.5,self.upload_average*1.05)):
    path=self.data/'camera-frame.bin'
    if path.exists() and time.time()-path.stat().st_mtime<3 and path.stat().st_mtime>self.last_frame_sent:
     try:self.upload()
     except Exception:self.preview_until=0;self.last_error='Display preview unavailable. Check Wi-Fi; PC recording can continue.'
