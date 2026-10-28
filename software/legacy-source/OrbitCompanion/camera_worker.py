"""Isolated webcam owner. Keeps one capture open and records motion events locally."""
from __future__ import annotations
import collections,json,os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/"packages"))

def replace_file(tmp,target):
 for _ in range(10):
  try:os.replace(tmp,target);return True
  except PermissionError:time.sleep(.002)
 return False

def write_json(path,data):
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data),encoding='utf-8');replace_file(tmp,path)

def motion_percent(gray,background):
 import cv2
 diff=cv2.absdiff(gray,cv2.convertScaleAbs(background))
 mask=cv2.threshold(diff,25,255,cv2.THRESH_BINARY)[1]
 mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,None)
 return float(cv2.countNonZero(mask))*100.0/mask.size

def rgb565(frame):
 import cv2,numpy as np
 h,w=frame.shape[:2];cw=min(w,int(h*16/9));ch=min(h,int(w*9/16))
 crop=frame[(h-ch)//2:(h+ch)//2,(w-cw)//2:(w+cw)//2]
 small=cv2.resize(crop,(160,90),interpolation=cv2.INTER_AREA)
 b,g,r=cv2.split(small)
 return (((r.astype(np.uint16)>>3)<<11)|((g.astype(np.uint16)>>2)<<5)|(b.astype(np.uint16)>>3)).astype('>u2').tobytes()

def recording_frame(frame,command):
 import cv2
 out=frame.copy();parts=[]
 if command.get('timestamp',True):parts.append(time.strftime('%Y-%m-%d %H:%M:%S'))
 if command.get('camera_name'):parts.append(str(command['camera_name'])[:60])
 if parts:
  label=' | '.join(parts);cv2.rectangle(out,(0,339),(640,360),(0,0,0),-1)
  cv2.putText(out,label,(8,353),cv2.FONT_HERSHEY_SIMPLEX,.36,(255,255,255),1,cv2.LINE_AA)
 return out

def run(directory):
 import cv2
 from cv2_enumerate_cameras import enumerate_cameras
 data=Path(directory);status=data/'camera-status.json';request=data/'camera-request.json';clips=data/'Recordings';clips.mkdir(exist_ok=True)
 cap=None;writer=None;clip=None;background=None;preroll=collections.deque(maxlen=20)
 started=time.monotonic();last_image=0;last_status=0;last_motion=0;record_start=0;consecutive=0;failures=0;count=0
 try:
  command=json.loads(request.read_text('utf-8'));index=command['camera'];selected=command.get('camera_path')
  if selected:
   match=next((c for c in enumerate_cameras(cv2.CAP_DSHOW) if c.path==selected),None)
   if match is None:raise ValueError('Selected webcam is disconnected')
   index=match.index
  cap=cv2.VideoCapture(index,cv2.CAP_DSHOW)
  cap.set(cv2.CAP_PROP_FOURCC,cv2.VideoWriter_fourcc(*'MJPG'))
  cap.set(cv2.CAP_PROP_FRAME_WIDTH,640);cap.set(cv2.CAP_PROP_FRAME_HEIGHT,360);cap.set(cv2.CAP_PROP_FPS,10)
  if not cap.isOpened():raise ValueError('Camera unavailable. Check Windows permissions or another app using it.')
  while True:
   cycle=time.monotonic();command=json.loads(request.read_text('utf-8'));mode=command['mode']
   if mode=='off' or time.time()-command['heartbeat']>10:break
   ok,frame=cap.read()
   if not ok:
    failures+=1
    if failures>=15:raise ValueError('Camera stopped returning frames')
    time.sleep(.1);continue
   failures=0;frame=cv2.resize(frame,(640,360),interpolation=cv2.INTER_AREA)
   gray=cv2.GaussianBlur(cv2.cvtColor(cv2.resize(frame,(160,90)),cv2.COLOR_BGR2GRAY),(9,9),0)
   if background is None:background=gray.astype('float32')
   motion=motion_percent(gray,background);cv2.accumulateWeighted(gray,background,.025)
   warm=cycle-started<2
   detected=mode=='sentry' and not warm and motion>=float(command.get('sensitivity',2.0))
   consecutive=consecutive+1 if detected else 0
   if detected:last_motion=cycle
   if mode not in ('sentry','manual') and writer is not None:
    writer.release();writer=None
    if clip and clip.exists():clip.rename(clip.with_name(clip.name.replace('.part.','.')));count+=1
    clip=None
   if (mode=='manual' or mode=='sentry' and consecutive>=2) and writer is None:
    # A storage ceiling stops new recordings; it never silently deletes clips.
    used=sum(p.stat().st_size for p in clips.glob('*.avi'))
    import shutil
    if used>=int(command.get('storage_mb',1024))*1024**2 or shutil.disk_usage(clips).free<300*1024**2:
     raise ValueError('Recording storage limit reached. Move clips or increase the limit.')
    clip=clips/(time.strftime(('manual-' if mode=='manual' else 'motion-')+'%Y%m%d-%H%M%S')+'-'+str(time.time_ns()%1000000)+'.part.avi')
    writer=cv2.VideoWriter(str(clip),cv2.VideoWriter_fourcc(*'MJPG'),10,(640,360))
    if not writer.isOpened():writer.release();writer=None;raise ValueError('Video recording codec could not start')
    record_start=cycle
    if mode=='sentry':
     for past in preroll:writer.write(past)
   if writer is not None:
    if clip and used+clip.stat().st_size>=int(command.get('storage_mb',1024))*1024**2:raise ValueError('Recording limit reached. Move clips or increase the limit.')
    writer.write(recording_frame(frame,command))
    if mode=='sentry' and cycle-last_motion>5 or cycle-record_start>=60:
     writer.release();writer=None
     clip.rename(clip.with_name(clip.name.replace('.part.','.')));count+=1;clip=None
   preroll.append(recording_frame(frame,command))
   if cycle-last_image>=.08:
    raw=rgb565(frame);tmp=data/'camera-frame.tmp';tmp.write_bytes(raw);replace_file(tmp,data/'camera-frame.bin')
    ok,jpg=cv2.imencode('.jpg',frame,[cv2.IMWRITE_JPEG_QUALITY,80])
    if ok:
     tmp=data/'last-camera.tmp';tmp.write_bytes(jpg.tobytes());replace_file(tmp,data/'last-camera.jpg')
    last_image=cycle
   if cycle-last_status>.3:
    write_json(status,{'state':'Recording' if writer is not None else 'Warming up' if warm else 'Armed' if mode=='sentry' else 'Preview','motion':round(motion,1),'updated':time.time(),'frame_at':(data/'camera-frame.bin').stat().st_mtime,'clips':count,'recording':writer is not None})
    last_status=cycle
   if mode=='snapshot' and not warm:break
   time.sleep(max(0,.1-(time.monotonic()-cycle)))
 except Exception as e:
  write_json(status,{'state':'Error','error':str(e)[:180],'updated':time.time(),'recording':False})
 finally:
  if writer is not None:
   writer.release()
   if clip and clip.exists():clip.rename(clip.with_name(clip.name.replace('.part.','.')))
  if cap is not None:cap.release()
  try:
   old=json.loads(status.read_text('utf-8')) if status.exists() else {}
   if old.get('state')!='Error':write_json(status,{**old,'state':'Off','recording':False,'updated':time.time()})
  except (OSError,ValueError):pass

if __name__=='__main__':run(sys.argv[1])
