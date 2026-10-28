// Sentry webcam controls in PC controls: snapshot, preview, recording, arming, and the recordings list.
import {api,action,notice,element,actionPin,save,getProfile} from './app.js';
const $=id=>document.getElementById(id);
let lastFrame=0,clipCount=-1;
// Settings the camera uses are saved first, so a just-chosen webcam or threshold applies.
async function saved(fn){if(document.getElementById('save-status').textContent==='Unsaved changes')await save();return fn();}
async function recordings(){
  const clips=await api('recordings');clipCount=clips.length;$('recordings').replaceChildren();
  if(!clips.length){$('recordings').append(element('p','No recordings yet.','help'));return;}
  for(const c of clips){
    const row=element('div',undefined,'recording-row'),link=element('a',`${new Date(c.at).toLocaleString()} · ${c.name.startsWith('motion')?'motion':'manual'} · ${(c.bytes/1048576).toFixed(1)} MB`);
    link.href='/api/recordings/file/'+encodeURIComponent(c.name);link.download=c.name;
    const remove=element('button','Delete','recording-delete');
    remove.onclick=()=>{if(!confirm(`Permanently delete this recording?\n${c.name}`))return;action(remove,async()=>{await api('recordings/delete',{name:c.name,pin:await actionPin()});await recordings();notice('Recording deleted.');});};
    row.append(link,remove);$('recordings').append(row);
  }
}
export function initSentry(){
  $('snapshot').onclick=()=>action($('snapshot'),()=>saved(async()=>{await api('sentry/snapshot',{});showImage(true);notice('Snapshot taken and sent to Orbit.');}));
  $('preview').onclick=()=>action($('preview'),()=>saved(async()=>{await api('sentry/preview',{});notice('Preview on for 60 seconds, here and on Orbit.');}));
  $('camera-record').onclick=()=>action($('camera-record'),()=>saved(async()=>{await api('sentry/record',{});notice('Recording. Press Stop camera to finish (60 seconds at most).');}));
  $('camera-stop').dataset.always='1';$('camera-stop').onclick=()=>action($('camera-stop'),async()=>{await api('sentry/stop',{});notice('Camera stopped.');setTimeout(()=>recordings().catch(()=>{}),2500);});
  $('sentry-arm').onclick=()=>action($('sentry-arm'),()=>saved(async()=>{await api('sentry/arm',{});notice('Sentry armed: movement is recorded on this PC until you disarm.');}));
  $('sentry-disarm').dataset.always='1';$('sentry-disarm').onclick=()=>action($('sentry-disarm'),async()=>{await api('sentry/stop',{});notice('Sentry disarmed. The camera is off.');setTimeout(()=>recordings().catch(()=>{}),2500);});
  $('recordings-open').onclick=()=>action($('recordings-open'),async()=>{notice((await api('recordings/open',{})).status);});
  $('camera-full').onclick=()=>action($('camera-full'),async()=>{const box=$('camera-image').parentElement;if(document.fullscreenElement)await document.exitFullscreen();else await box.requestFullscreen();});
  recordings().catch(()=>{});
}
function showImage(force){
  $('camera-image').src='/api/camera.bmp?t='+Date.now();$('camera-image').hidden=false;$('camera-empty').hidden=true;if(force)lastFrame=Date.now();
}
// Called with each /api/state poll.
export function sentryPoll(state){
  const s=state.sentry;if(!s)return;
  const on=s.state!=='Off'&&s.state!=='Error';
  $('sentry-state').textContent=(s.armed?'Sentry · ':'Camera · ')+s.state;
  $('sentry-motion').textContent=on?`Motion ${s.motion}% · ${s.clips} recordings`:`${s.clips} recordings`;
  $('sentry-error').textContent=s.error||'';
  $('camera-record').classList.toggle('recording',s.recording);
  if(on&&s.frameAt&&s.frameAt!==lastFrame){lastFrame=s.frameAt;showImage(false);}
  if(s.clips!==clipCount&&clipCount>=0)recordings().catch(()=>{});
  if(!getProfile().camera)$('sentry-error').textContent='Choose your webcam above, then Save changes.';
}
