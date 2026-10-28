import {spawn,execFile} from 'node:child_process';
import {mkdir,readdir,stat,rename,unlink,writeFile,statfs} from 'node:fs/promises';
import path from 'node:path';
// Sentry: the PC webcam, watched through FFmpeg. One FFmpeg reads the camera (a webcam can only be open
// in one program) and hands this module raw frames; from them come motion detection, the console's
// snapshot, small preview images for Orbit's Sentry screen, and recordings (a second FFmpeg encodes
// them, starting with the 2 s before the motion).
export const W=640,H=360,FPS=10,FRAME=W*H*3;
const SMALL_W=160,SMALL_H=90;

// Video cameras Windows offers (DirectShow names, which FFmpeg opens by name).
export function listCameras(ffmpeg){
  return new Promise(resolve=>execFile(ffmpeg,['-hide_banner','-list_devices','true','-f','dshow','-i','dummy'],{windowsHide:true,timeout:15000},(error,stdout,stderr)=>{
    const names=[...String(stderr).matchAll(/"([^"]+)" \(video\)/g)].map(m=>m[1]);resolve([...new Set(names)]);
  }));
}
// 640x360 RGB -> 160x90 (every 4th pixel): grey for motion, big-endian RGB565 for Orbit's screen.
export function smallFrames(rgb){
  const grey=new Float32Array(SMALL_W*SMALL_H),rgb565=Buffer.alloc(SMALL_W*SMALL_H*2);
  for(let y=0;y<SMALL_H;y++)for(let x=0;x<SMALL_W;x++){
    const i=((y*4)*W+x*4)*3,r=rgb[i],g=rgb[i+1],b=rgb[i+2],o=y*SMALL_W+x;
    grey[o]=0.299*r+0.587*g+0.114*b;rgb565.writeUInt16BE(((r>>3)<<11)|((g>>2)<<5)|(b>>3),o*2);
  }
  return {grey,rgb565};
}
// Share (%) of the small picture that changed noticeably from the slowly-updated background.
export function motionPercent(grey,background){
  let changed=0;for(let i=0;i<grey.length;i++){if(Math.abs(grey[i]-background[i])>25)changed++;background[i]+=(grey[i]-background[i])*0.025;}
  return changed*100/grey.length;
}
// A 24-bit BMP of the latest frame: browsers show it as-is, no image library needed.
export function bmp(rgb,w=W,h=H){
  const row=w*3,pad=(4-row%4)%4,size=54+(row+pad)*h,out=Buffer.alloc(size);
  out.write('BM',0);out.writeUInt32LE(size,2);out.writeUInt32LE(54,10);out.writeUInt32LE(40,14);out.writeInt32LE(w,18);out.writeInt32LE(-h,22);
  out.writeUInt16LE(1,26);out.writeUInt16LE(24,28);out.writeUInt32LE(row*h,34);
  for(let y=0,o=54;y<h;y++,o+=pad)for(let x=0;x<w;x++,o+=3){const i=(y*w+x)*3;out[o]=rgb[i+2];out[o+1]=rgb[i+1];out[o+2]=rgb[i];}
  return out;
}
// A Windows path inside an FFmpeg filter: forward slashes, the drive colon escaped, and quoted
// (unquoted, the colon would split the filter's options).
const filterPath=p=>`'${p.replace(/\\/g,'/').replace(/:/g,'\\:')}'`;

// getProfile(): camera name, motion_sensitivity, recording_limit_mb, record_timestamp, record_camera_name.
// sendFrame(rgb565): show a 160x90 image on Orbit (resolves when sent). onMotion(): Sentry started a clip.
export function createSentry({ffmpeg,dataDir,getProfile,sendFrame=async()=>{},onMotion=()=>{},log=()=>{},spawner=spawn}){
  const clipsDir=path.join(dataDir,'Recordings');
  let capture=null,recorder=null,mode='off',armed=false,error='',motion=0,frameAt=0,startedAt=0,previewUntil=0;
  let latest=null,background=null,lastMotionAt=0,above=0,clip=null,clipStartedAt=0,clips=0,sending=false,lastSentAt=0,snapshotWaiters=[];
  const preroll=[];
  async function countClips(){try{clips=(await readdir(clipsDir)).filter(n=>n.endsWith('.mp4')&&!n.endsWith('.part.mp4')).length;}catch{clips=0;}}
  countClips();
  function status(){
    const recording=!!recorder;
    const state=error?'Error':mode==='off'?'Off':Date.now()-startedAt<2000?'Warming up':recording?'Recording':armed?'Armed':'Preview';
    return {state,armed,recording,motion:Math.round(motion*10)/10,clips,error,frameAt,preview:previewUntil>Date.now(),camera:getProfile().camera||''};
  }
  function startCapture(){
    if(capture)return;
    const camera=getProfile().camera;if(!camera)throw Error('Choose a webcam in PC controls first.');
    error='';startedAt=Date.now();background=null;above=0;motion=0;preroll.length=0;
    const args=['-hide_banner','-loglevel','error','-f','dshow','-rtbufsize','64M','-i',`video=${camera}`,
      '-vf',`fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,'-pix_fmt','rgb24','-f','rawvideo','pipe:1'];
    const child=spawner(ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});capture=child;
    let pending=Buffer.alloc(0),stderr='';
    child.stdout.on('data',chunk=>{pending=pending.length?Buffer.concat([pending,chunk]):chunk;while(pending.length>=FRAME){const frame=pending.subarray(0,FRAME);pending=Buffer.from(pending.subarray(FRAME));onFrame(Buffer.from(frame));}});
    child.stderr.on('data',d=>{stderr=(stderr+d).slice(-600);});
    child.on('error',()=>{error='FFmpeg could not start. Reinstall Orbit.';});
    child.on('exit',()=>{
      if(capture!==child)return;capture=null;
      if(mode!=='off'){error=/busy|in use|Could not run graph|I\/O error/i.test(stderr)?'The webcam is busy or unavailable. Close other apps using it.':stderr.trim().split('\n').at(-1)?.slice(0,160)||'The webcam stopped.';log('Sentry: '+error);}
      stopRecording();mode='off';armed=false;previewUntil=0;for(const w of snapshotWaiters.splice(0))w.reject(Error(error||'Camera stopped'));
    });
  }
  function onFrame(rgb){
    const now=Date.now();latest=rgb;frameAt=now;const {grey,rgb565}=smallFrames(rgb);
    if(!background)background=Float32Array.from(grey);
    motion=motionPercent(grey,background);
    const warm=now-startedAt<2000;
    preroll.push(rgb);if(preroll.length>FPS*2)preroll.shift();
    if(recorder&&recorder.stdin.writable)recorder.stdin.write(rgb);
    if(!warm)for(const w of snapshotWaiters.splice(0))w.resolve(rgb);
    // Sentry: two moving frames in a row start a clip; it ends 5 s after the movement stops (60 s at most).
    if(armed&&!warm){
      const moving=motion>=Number(getProfile().motion_sensitivity||2);above=moving?above+1:0;if(moving)lastMotionAt=now;
      if(!recorder&&above>=2)startRecording('motion').then(()=>onMotion()).catch(e=>{error=e.message;});
    }
    if(recorder&&clipStartedAt&&(now-clipStartedAt>=60000||(mode==='sentry'&&now-lastMotionAt>5000)))stopRecording();
    if(mode==='preview'&&previewUntil<now&&!recorder&&!armed)stop();
    // Orbit's screen: a few frames a second while a preview is on.
    if(previewUntil>now&&!sending&&now-lastSentAt>=180){sending=true;lastSentAt=now;sendFrame(rgb565).catch(()=>{}).finally(()=>{sending=false;});}
  }
  async function startRecording(kind){
    if(recorder)return;
    const p=getProfile();await mkdir(clipsDir,{recursive:true});
    let used=0;for(const n of await readdir(clipsDir))if(n.endsWith('.mp4'))used+=(await stat(path.join(clipsDir,n))).size;
    if(used>=Number(p.recording_limit_mb||1024)*1048576)throw Error('Recording limit reached. Move or delete clips, or raise the limit.');
    try{const fs=await statfs(clipsDir);if(fs.bavail*fs.bsize<300*1048576)throw Error('Less than 300 MB free on this drive. Recording stopped.');}catch(e){if(/free/.test(e.message))throw e;}
    const stamp=new Date().toISOString().replace(/[:T]/g,'-').slice(0,19);
    clip=path.join(clipsDir,`${kind}-${stamp}.part.mp4`);
    const labels=[];
    if(p.record_timestamp!==false)labels.push(`drawtext=fontfile=${filterPath('C:/Windows/Fonts/arial.ttf')}:text=%{localtime}:x=8:y=h-th-8:fontsize=15:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`);
    if(p.record_camera_name!==false&&p.camera){const nameFile=path.join(dataDir,'camera-name.txt');await writeFile(nameFile,String(p.camera).slice(0,60));
      labels.push(`drawtext=fontfile=${filterPath('C:/Windows/Fonts/arial.ttf')}:textfile=${filterPath(nameFile)}:x=w-tw-8:y=h-th-8:fontsize=15:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`);}
    const args=['-hide_banner','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',`${W}x${H}`,'-r',String(FPS),'-i','pipe:0',
      ...(labels.length?['-vf',labels.join(',')]:[]),'-c:v','libx264','-preset','veryfast','-crf','27','-pix_fmt','yuv420p','-movflags','+faststart','-y',clip];
    const child=spawner(ffmpeg,args,{windowsHide:true,stdio:['pipe','ignore','pipe']});recorder=child;clipStartedAt=Date.now();
    const file=clip;let problem='';child.stdin.on('error',()=>{});child.stderr.on('data',d=>{problem=(problem+d).slice(-400);});
    child.on('exit',async code=>{if(recorder===child)recorder=null;
      if(code!==0)log(`Sentry: recording failed (${code}): ${problem.trim().split('\n').at(-1)||'no details'}`);
      try{if(code===0)await rename(file,file.replace('.part.mp4','.mp4'));else await unlink(file);}catch{}countClips();});
    if(kind==='motion')for(const f of preroll)child.stdin.write(f);
    log(`Sentry: recording ${path.basename(file)}`);
  }
  // A finished manual clip leaves the camera on as a normal preview (which then times out).
  function stopRecording(){const r=recorder;if(!r)return;recorder=null;clipStartedAt=0;r.stdin.end();if(mode==='manual')mode='preview';}
  function stop(){mode='off';armed=false;previewUntil=0;stopRecording();const c=capture;capture=null;c?.kill();motion=0;}
  return {
    status,
    preview(){startCapture();if(mode==='off')mode='preview';previewUntil=Date.now()+60000;return status();},
    async record(){startCapture();if(mode==='off'||mode==='preview')mode='manual';await startRecording('manual');previewUntil=Date.now()+60000;return status();},
    arm(){startCapture();mode='sentry';armed=true;lastMotionAt=0;return status();},
    disarm(){stop();return status();},
    stop(){stop();return status();},
    // One frame: from the running camera, or by opening it briefly. Also shown on Orbit when send is true.
    async snapshot({send=true}={}){
      const wasOff=!capture;if(wasOff){startCapture();mode='snapshot';}
      try{
        const rgb=await new Promise((resolve,reject)=>{snapshotWaiters.push({resolve,reject});setTimeout(()=>reject(Error('The webcam did not send a picture in time.')),12000).unref?.();});
        if(send)await sendFrame(smallFrames(rgb).rgb565).catch(()=>{});
      }finally{if(mode==='snapshot')stop();}
      return status();
    },
    latestImage:()=>latest&&bmp(latest),
    clipsDir,
  };
}
