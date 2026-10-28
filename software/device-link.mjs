import http from 'node:http';
import os from 'node:os';
import {randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import dgram from 'node:dgram';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import WebSocket,{WebSocketServer} from 'ws';
import {normalizeSetup} from './setup.mjs';
import {execFile} from 'node:child_process';
import {startPcStats,PC_LINE} from './pc-stats.mjs';
import {detectMood} from './mood.mjs';
import {enginesMessage,engineName} from './engines.mjs';
// Media keys Orbit may press on this PC. Only these fixed codes are ever sent.
export const MEDIA_KEYS={stop:0xB2,play:0xB3,next:0xB0,previous:0xB1,mute:0xAD,louder:0xAF,quieter:0xAE};
export function pressMediaKey(action){
  const vk=MEDIA_KEYS[action];if(!vk)return Promise.reject(Error('Unknown media action'));
  const script=`Add-Type -Name Keys -Namespace OrbitMedia -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte k,byte s,uint f,System.UIntPtr e);';[OrbitMedia.Keys]::keybd_event(${vk},0,1,[UIntPtr]::Zero);[OrbitMedia.Keys]::keybd_event(${vk},0,3,[UIntPtr]::Zero)`;
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout:10000},error=>error?reject(error):resolve()));
}
const PAIR_UDP_PORT=8791;  // Orbit listens here for "Pair Orbit with this PC" invitations
const privateIP=ip=>/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip);
// Prefer the Wi-Fi adapter (Orbit is a Wi-Fi device) over virtual adapters such as VirtualBox host-only
// networks, which are also private. ORBIT_DEVICE_HOST overrides the choice.
export function deviceHost(interfaces=os.networkInterfaces(),override=process.env.ORBIT_DEVICE_HOST){
  if(override&&privateIP(override))return override;
  const candidates=Object.entries(interfaces).flatMap(([name,list])=>(list||[]).filter(n=>n?.family==='IPv4'&&!n.internal&&privateIP(n.address)).map(n=>({name,address:n.address})));
  const rank=({name})=>/wi-?fi|wlan|wireless/i.test(name)?0:/virtual|vbox|vmware|vethernet|hyper-v|wsl|docker|loopback|bluetooth|vpn|wintun|openvpn|wireguard|tailscale|zerotier/i.test(name)?2:1;
  return candidates.sort((a,b)=>rank(a)-rank(b))[0]?.address||'';
}
export function physicalSetup(value={}){
  const s=normalizeSetup(value),themes=['corporate','arcade','flight','pocket','paper'];
  return {theme:Math.max(0,themes.indexOf(s.theme)),wallpaper:['none','aurora','grid','sunset'].indexOf(s.wallpaper),brightness:s.brightness,enabled:s.enabled.reduce((mask,n)=>mask|(1<<n),0),start:s.start,networkMbps:s.networkMbps,thermalWarm:s.thermalWarm,thermalHigh:s.thermalHigh,audio:value.audio===true};
}
// Ring LEDs: on/off, brightness 0-100 (the firmware caps real output), colour as #rrggbb,
// effect 0-11 (LED_EFFECTS in led_ring.h) and speed 0-2 (slow, medium, fast).
export const LED_EFFECTS=['Solid','Breathe','Rainbow','Spin','Comet','Theater','Sparkle','Fire','Police','Ocean','Heartbeat','Party'];
const clampInt=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.round(Number(value)))):fallback;
export function ledSettings(value={}){
  const color=/^#[0-9a-f]{6}$/i.test(value?.color||'')?value.color.toLowerCase():'#1e6eff';
  return {on:value?.on!==false,brightness:clampInt(value?.brightness,0,100,65),color,effect:clampInt(value?.effect,0,LED_EFFECTS.length-1,0),speed:clampInt(value?.speed,0,2,1)};
}
// Windows master volume through Core Audio (IAudioEndpointVolume). level undefined reads it;
// a number 0-100 sets it. Resolves to the resulting level 0-100.
const VOLUME_CS=`using System;using System.Runtime.InteropServices;
namespace OrbitAudio{
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioEndpointVolume{int f();int g();int h();int i();int SetMasterVolumeLevelScalar(float level,Guid ctx);int j();int GetMasterVolumeLevelScalar(out float level);}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDevice{int Activate(ref Guid id,int ctx,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)] out object o);}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDeviceEnumerator{int f();int GetDefaultAudioEndpoint(int flow,int role,out IMMDevice d);}
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class Enumerator{}
public static class Volume{
 static IAudioEndpointVolume Endpoint(){var e=(IMMDeviceEnumerator)new Enumerator();IMMDevice d;Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0,1,out d));var id=typeof(IAudioEndpointVolume).GUID;object o;Marshal.ThrowExceptionForHR(d.Activate(ref id,23,IntPtr.Zero,out o));return (IAudioEndpointVolume)o;}
 public static int Get(){float v;Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v));return (int)Math.Round(v*100);}
 public static int Set(int percent){Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0,Math.Min(100,percent))/100f,Guid.Empty));return Get();}
}}`;
export function systemVolume(level){
  const call=level===undefined?'[OrbitAudio.Volume]::Get()':`[OrbitAudio.Volume]::Set(${Math.max(0,Math.min(100,Math.round(Number(level))))})`;
  const encoded=Buffer.from(`Add-Type -TypeDefinition @'\n${VOLUME_CS}\n'@\n${call}`,'utf16le').toString('base64');
  return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout:15000},(error,stdout)=>{const value=Number(String(stdout).trim());if(error||!Number.isFinite(value))reject(error||Error('Volume unavailable'));else resolve(value);}));
}
// Orbit's CONSOLE view (inside the AI page): the paired coding conversation as plain ASCII that the
// device font can draw. Code blocks collapse to [code]; the newest messages win the ~1800-character budget.
export function consoleText(value,max=360){
  let s=String(value||'').replace(/```[\s\S]*?(```|$)/g,' [code] ').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,'-').replace(/…/g,'...')
    .normalize('NFKD').replace(/[*_`#>]+/g,'').replace(/\s+/g,' ').replace(/[^\x20-\x7e]/g,'').trim();
  return s.length>max?s.slice(0,max-3).trimEnd()+'...':s;
}
export function consoleMessage(ctx={},conversation=[],pending=0,title=''){
  const out={type:'console',connected:!!ctx.connected,runtime:consoleText(ctx.runtime,20),pending:Number(pending)||0};
  if(title)out.title=consoleText(title,24);
  const picked=[];let budget=1800;
  for(const m of [...conversation].reverse()){if(picked.length>=6||budget<60)break;const text=consoleText(m.text,Math.min(360,budget));if(!text)continue;picked.unshift({r:m.role==='user'?'u':'a',text});budget-=text.length;}
  out.n=picked.length;picked.forEach((m,i)=>{out['r'+i]=m.r;out['t'+i]=m.text;});return out;
}
// onEvent receives device messages this module does not handle itself (the companion feed's "command",
// "desk-reply", "feed-status"); onConnect runs each time Orbit connects.
// engines (optional): who Orbit talks to. {current()->{id,name}, list()->[{id,name}], choose(id), chats,
// transcribe(pcm)->text, ask(id,text,history)->reply, speak(text)->pcm}. Without it, Orbit talks to ChatGPT.
export async function createDeviceLink({runtimeDir,voiceOrigin='http://127.0.0.1:8788',getContext,getConversation=()=>[],control,port=8790,mediaKey=pressMediaKey,volume=systemVolume,pcStats=startPcStats,onEvent=()=>{},onConnect=()=>{},log=()=>{},engines=null}={}){
  let refreshEngines=()=>{};  // set for the connected Orbit
  await mkdir(runtimeDir,{recursive:true});const file=new URL('device-link.json',runtimeDir);
  let saved;try{saved=JSON.parse(await readFile(file,'utf8'));}catch{}
  const token=/^[a-f0-9]{64}$/.test(saved?.token||'')?saved.token:randomBytes(32).toString('hex');
  let setup=saved?.setup||physicalSetup(),leds=ledSettings(saved?.leds),host='',deviceIp='',lastPc=null,recentFromDevice=[],server=null,peer=null,lastStatus={},error='',connectedAt=0;
  async function persist(){await writeFile(file,JSON.stringify({token,setup,leds}),{mode:0o600});}
  await persist();
  const wss=new WebSocketServer({noServer:true,maxPayload:8192});
  // deviceIp is where firmware updates are sent (Orbit's /ota on port 80).
  function status(){return {listening:!!server,online:peer?.readyState===WebSocket.OPEN,connectedAt,host,port,deviceIp,httpPort:lastStatus.httpPort||80,firmware:lastStatus.firmware||'',audioReady:!!lastStatus.audioReady,micPeak:Number(lastStatus.micPeak)||0,audioFrames:Number(lastStatus.audioFrames)||0,error,setup,leds,lastPc,recentFromDevice,pairing:pairing?{code:pairing.code,secondsLeft:Math.max(0,Math.round((pairing.expires-Date.now())/1000))}:null,diagnostics:{resetReason:lastStatus.resetReason,heap:lastStatus.heap,minHeap:lastStatus.minHeap,otaCrashBytes:lastStatus.otaCrashBytes,lastStep:lastStatus.lastStep}};}
  function send(data){if(peer?.readyState===WebSocket.OPEN)peer.send(JSON.stringify(data));}
  async function start(){if(server)return;host=deviceHost();if(!host)throw Error('Connect this computer to a private Wi-Fi or Ethernet network first.');
    server=http.createServer((req,res)=>{
      // Wi-Fi pairing: during an active pairing window, an Orbit whose user tapped YES fetches this PC's
      // token with the 4-digit code it was shown. One use only; private network peers only.
      const url=new URL(req.url,'http://device');const remote=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
      if(req.method==='GET'&&url.pathname==='/pair'&&pairing&&Date.now()<pairing.expires&&privateIP(remote)&&!req.headers.origin
        &&url.searchParams.get('code')===pairing.code&&url.searchParams.get('nonce')===pairing.nonce){
        endPairing();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({token,name:os.hostname()}));return;}
      res.writeHead(403);res.end('Paired Orbit device only');});
    server.on('upgrade',(req,socket,head)=>{
      const candidate=String(req.headers.authorization||'').replace(/^Bearer /,'');const remote=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
      if(req.url!=='/device'||req.headers.origin||!privateIP(remote)||candidate.length!==token.length||!timingSafeEqual(Buffer.from(candidate),Buffer.from(token))||peer){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
      wss.handleUpgrade(req,socket,head,ws=>{deviceIp=remote;wss.emit('connection',ws);});
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  }
  wss.on('connection',ws=>{
    // PC gauges: stream a reading each second while Orbit is connected.
    const stats=pcStats(line=>{if(PC_LINE.test(line)){lastPc={line,at:Date.now()};send({type:'pc',line});}});
    peer=ws;error='';connectedAt=Date.now();lastStatus={};  // filled by Orbit's status message right after connecting
    let voice=null,voiceReady=false,voiceMode='openai',queued=[],queuedBytes=0,speaking=false,review=null,closed=false,consoleCapture=false,lastConsole='';
    const taskSession=control?.session('');
    // The mood of Orbit's reply, from its words as they arrive: the face and lights follow it.
    let replyText='',mood='neutral';
    function setMood(next){if(next!==mood){mood=next;send({type:'mood',mood});}}
    function stopVoice(){const old=voice;voice=null;voiceReady=false;queued=[];queuedBytes=0;speaking=false;old?.close();}
    const safeError=()=>send({type:'error',text:'Device action failed. Check the Orbit console.'});
    // The console snapshot is re-sent only when it changes (or when Orbit opens its console view). It shows
    // the conversation with whichever engine Orbit talks to: the paired Codex chat, or Orbit's own chat.
    async function taskStatus(force=false){if(!getContext)return;const ctx=await getContext();send({type:'task',text:String(ctx.latestUpdate||'Coding connection unavailable.').slice(0,900)});let pending=0;
      if(control){const s=await control.status();pending=s.approvals.length;send({type:'requests',count:pending,text:pending?'Review native requests in the Orbit console.':'No pending requests.'});}
      const engine=engines?.current()||{id:'codex',name:'Codex'};
      const message=engine.id==='codex'?consoleMessage(ctx,getConversation()||[],pending,'CODEX CONSOLE'):consoleMessage({connected:true,runtime:'talking'},engines.chats.list(engine.id),pending,engine.name.toUpperCase());
      const snapshot=JSON.stringify(message);if(force||snapshot!==lastConsole){lastConsole=snapshot;if(peer===ws&&ws.readyState===WebSocket.OPEN)ws.send(snapshot);}
      await sendEngines();}
    // Orbit's ENGINE picker: the engines ready on this PC and the current choice (sent when it changes).
    let lastEngines='';
    async function sendEngines(force=false){if(!engines)return;const text=JSON.stringify(enginesMessage(await engines.list(),engines.current().id));
      if(force||text!==lastEngines){lastEngines=text;if(peer===ws&&ws.readyState===WebSocket.OPEN)ws.send(text);}}
    refreshEngines=()=>{sendEngines(true).catch(()=>{});lastConsole='';taskStatus().catch(()=>{});};
    // Claude, DeepSeek and Cursor: Orbit's recording is turned into text, answered, and spoken back.
    let capture=null,engineRun=0;
    async function engineReply(id,pcm){
      const run=++engineRun,still=()=>run===engineRun&&!closed;
      try{
        const heard=await engines.transcribe(pcm);if(!still())return;
        if(!heard){send({type:'error',text:'No words heard. Hold and try again.'});return;}
        send({type:'transcript',text:heard.slice(0,900)});const history=engines.chats.list(id);engines.chats.add(id,'user',heard);
        const reply=await engines.ask(id,heard,history);if(!still())return;
        if(!reply){send({type:'error',text:'No answer came back. Try again.'});return;}
        engines.chats.add(id,'assistant',reply);send({type:'reply',text:reply.slice(0,900)});setMood(detectMood(reply));taskStatus().catch(()=>{});
        const audio=await engines.speak(reply);if(!still())return;
        if(audio.length)pushAudio(audio);speaking=false;send({type:'done'});
      }catch(err){if(still()){log(`${engineName(id)} turn failed: ${err?.message}`);send({type:'error',text:consoleText(err?.message||'That did not work. Try again.',150)});}}
    }
    // A spoken console command: the relay only transcribes it, then it becomes a reviewed draft that
    // Orbit shows with SEND / CANCEL. Nothing reaches the coding conversation until SEND is tapped.
    async function consoleDraft(text){
      text=consoleText(text,1000);if(!text){send({type:'console-note',text:'No words heard. Hold and try again.'});return;}
      if(!control){send({type:'console-note',text:'The console is not available on this PC.'});return;}
      try{review=await control.prepare(taskSession,{kind:'command',text});send({type:'review',text:consoleText(review.action.text,300),pinRequired:review.pinRequired});}
      catch(err){review=null;send({type:'console-note',text:consoleText('Codex is not connected on this PC. '+(err?.message||''),120)});}
    }
    // Reply audio is pushed to the device as binary frames; TCP backpressure paces it to playback.
    function pushAudio(data){if(ws.bufferedAmount+data.length>3*1024*1024){stopVoice();send({type:'error',text:'Reply audio queue filled. Try a shorter reply.'});return;}if(!speaking){speaking=true;send({type:'speaking'});}for(let i=0;i<data.length;i+=2048)ws.send(data.subarray(i,i+2048));}
    // The relay session opens lazily on the first turn and reopens after an idle disconnect;
    // device events wait in order until it reports ready.
    function openVoice(){const up=new WebSocket(voiceOrigin.replace('http:','ws:')+'/api/voice/socket',{headers:{Origin:voiceOrigin}});voice=up;voiceReady=false;
      up.on('open',()=>up.send(JSON.stringify({type:'start',mode:voiceMode})));
      up.on('message',raw=>{if(voice!==up)return;let msg;try{msg=JSON.parse(raw);}catch{return;}const e=msg.event;
        if(msg.type==='relay.ready'){voiceReady=true;send({type:'ready'});for(const item of queued)up.send(item);queued=[];queuedBytes=0;}
        if(msg.type==='relay.error')send({type:'error',text:String(msg.message||'Voice failed').slice(0,160)});
        if(e?.type==='response.output_audio.delta')pushAudio(Buffer.from(e.delta,'base64'));
        if(consoleCapture&&(e?.type==='conversation.item.input_audio_transcription.completed'||e?.type==='conversation.item.input_audio_transcription.failed')){
          consoleCapture=false;speaking=false;const heard=e.type.endsWith('completed')?String(e.transcript||''):'';send({type:'transcript',text:heard.slice(0,900)});send({type:'done'});
          if(e.type.endsWith('failed'))send({type:'console-note',text:'Could not make out the words. Try again.'});else consoleDraft(heard);return;}
        if(consoleCapture&&e?.type?.startsWith('response.'))return;
        if(e?.type==='conversation.item.input_audio_transcription.completed'){send({type:'transcript',text:String(e.transcript||'').slice(0,900)});engines?.chats.add('chatgpt','user',e.transcript);}
        if(e?.type==='response.output_audio_transcript.done'){engines?.chats.add('chatgpt','assistant',e.transcript);taskStatus().catch(()=>{});}
        // The reply's words arrive while it plays: the face and lights follow their mood.
        if(e?.type==='response.output_audio_transcript.delta'){replyText=(replyText+String(e.delta||'')).slice(-400);setMood(detectMood(replyText));}
        if(e?.type==='response.output_audio_transcript.done')send({type:'reply',text:String(e.transcript||'').slice(0,900)});
        if(e?.type==='response.done'||msg.type==='relay.loopback.done'){speaking=false;send({type:'done'});}
      });
      up.on('error',()=>{if(voice===up)send({type:'error',text:'Voice relay unavailable or already in use. Disconnect browser voice and retry.'});});
      up.on('close',()=>{if(voice===up){voice=null;voiceReady=false;queued=[];queuedBytes=0;if(speaking){speaking=false;send({type:'done'});}}});
    }
    function toVoice(event){const data=JSON.stringify(event);if(!voice)openVoice();if(voiceReady&&voice.readyState===WebSocket.OPEN){voice.send(data);return;}
      if(queuedBytes+data.length>2*1024*1024)throw Error('Voice relay is not ready.');queued.push(data);queuedBytes+=data.length;}
    ws.on('message',async(raw,binary)=>{try{
      if(binary){if(raw.length>4096||raw.length%2)throw Error('Invalid PCM');
        if(capture){if(capture.bytes+raw.length<=24000*2*30){capture.chunks.push(Buffer.from(raw));capture.bytes+=raw.length;}return;}  // up to 30 s
        toVoice({type:'audio',audio:Buffer.from(raw).toString('base64')});return;}
      const e=JSON.parse(raw);recentFromDevice.push(String(e.type).slice(0,24));if(recentFromDevice.length>12)recentFromDevice.shift();
      if(e.type==='companion-paired'){pairWaiter?.(e.ok===true);return;}
      if(e.type==='relinked'){relinkWaiter?.(e.ok===true);return;}
      if(e.type==='leds-state'){leds=ledSettings(e);await persist();return;}  // changed on Orbit's LIGHT SHOW page
      if(e.type==='status'){lastStatus={firmware:String(e.firmware||'').slice(0,20),audioReady:!!e.audioReady,micPeak:e.micPeak,audioFrames:e.audioFrames,
        resetReason:Number(e.reset)||0,heap:Number(e.heap)||0,minHeap:Number(e.minHeap)||0,otaCrashBytes:Number(e.otaCrashBytes)||0,lastStep:Number(e.lastStep)||0,httpPort:Number(e.httpPort)||80,at:Date.now()};
        log(`Orbit ${lastStatus.firmware}: restart reason ${lastStatus.resetReason}${lastStatus.lastStep?`, was at step ${lastStatus.lastStep} before restarting`:''}, ${Math.round(lastStatus.heap/1024)} KB free`);return;}
      if(e.type==='voice'){const mode=e.mode==='loopback'?'loopback':'openai';if(mode!==voiceMode){voiceMode=mode;stopVoice();}return;}
      // A turn goes to the chosen engine: Codex turns become reviewed commands, ChatGPT is the realtime
      // voice, and the text engines get the whole recording when it ends.
      if(e.type==='begin'){setMood('neutral');replyText='';speaking=false;engineRun++;
        const engine=engines?.current()||{id:'chatgpt'};capture=null;
        consoleCapture=e.console===true||engine.id==='codex';if(consoleCapture&&review){control?.cancel(taskSession,review.token);review=null;}
        if(!consoleCapture&&engine.id!=='chatgpt'){capture={id:engine.id,chunks:[],bytes:0};return;}
        toVoice(consoleCapture?{type:'begin',transcriptionOnly:true}:{type:'begin'});return;}
      if(e.type==='console'){await taskStatus(true);return;}
      if(e.type==='end'){if(capture){const c=capture;capture=null;engineReply(c.id,Buffer.concat(c.chunks));return;}toVoice({type:'end'});return;}
      if(e.type==='cancel'){speaking=false;capture=null;engineRun++;if(voice)toVoice({type:'interrupt'});return;}
      if(e.type==='engine'){if(engines){await engines.choose(String(e.id||''));refreshEngines();}return;}  // picked on Orbit
      if(e.type==='media'&&(e.action==='volume'||e.action==='get-volume')){
        const level=e.action==='volume'?Number(e.level):undefined;if(e.action==='volume'&&!Number.isFinite(level))throw Error('Invalid volume');
        send({type:'volume',level:await volume(level)});return;
      }
      if(e.type==='media'){if(!Object.hasOwn(MEDIA_KEYS,e.action))throw Error('Unknown media action');await mediaKey(e.action);send({type:'media-result',text:{stop:'Stopped',play:'Play / pause sent',next:'Next track',previous:'Previous track',mute:'Mute toggled',louder:'Volume up',quieter:'Volume down'}[e.action]});return;}
      if(e.type==='task'){await taskStatus();return;}
      if(e.type==='draft'){
        if(!control||typeof e.text!=='string'||!e.text.trim()||e.text.length>1000)throw Error('Use a command of up to 1000 characters.');
        await consoleDraft(e.text);return;
      }
      if(e.type==='confirm'){
        if(!review){send({type:'command-result',text:'That draft expired. Speak it again.'});return;}const pending=review;review=null;
        try{const result=await control.commit(taskSession,{token:pending.token,pin:String(e.pin||'')});
          send({type:'command-result',text:result.state==='unconfirmed'?'Delivery unconfirmed. Check the PC before retrying.':'Sent to Codex. Waiting for the reply.'});}
        catch(err){send({type:'command-result',text:consoleText(/passcode/i.test(err?.message||'')?'A task passcode is set. Send this one from the PC console.':err?.message||'Send failed.',120)});}
        setTimeout(()=>taskStatus().catch(()=>{}),2500).unref();return;}
      if(e.type==='cancel-review'){if(review)control.cancel(taskSession,review.token);review=null;return;}
      await onEvent(e);
    }catch{safeError();}});
    ws.on('close',()=>{closed=true;stats?.stop();stopVoice();if(review)control?.cancel(taskSession,review.token);if(peer===ws)peer=null;});
    ws.on('error',()=>{});send({type:'hello',name:os.hostname().slice(0,24)});send({type:'setup',...setup});send({type:'leds',...leds});taskStatus().catch(()=>{});
    try{onConnect();}catch{}
    const interval=setInterval(()=>{if(closed){clearInterval(interval);return;}taskStatus().catch(()=>{});},7000);interval.unref();
  });
  // Give Orbit the PC companion's 32-hex pairing key over this authenticated link (replaces the
  // USB "PAIR" step, which the companion only offers together with Wi-Fi credentials).
  let pairWaiter=null;
  function pairCompanion(key){
    if(!/^[0-9a-f]{32}$/.test(key))return Promise.reject(Error('Invalid companion key'));
    if(peer?.readyState!==WebSocket.OPEN)return Promise.reject(Error('Orbit is not connected.'));
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pairWaiter=null;reject(Error('Orbit did not confirm the key.'));},5000);
      pairWaiter=ok=>{clearTimeout(timer);pairWaiter=null;ok?resolve({paired:true}):reject(Error('Orbit rejected the key.'));};send({type:'companion-pair',key});});
  }
  // "Pair Orbit with this PC": for 60 s, broadcast an invitation (name, address, 4-digit code, nonce) on
  // UDP 8791. Orbit shows "Pair with <name>? <code>"; on YES it GETs /pair?code&nonce here for the token.
  // The token is never broadcast. The on-screen tap is what stops another PC taking Orbit over.
  let pairing=null;
  function endPairing(){if(!pairing)return;clearInterval(pairing.timer);clearTimeout(pairing.stop);pairing.socket.close();pairing=null;}
  async function startPairing(){
    await start();endPairing();
    const iface=Object.values(os.networkInterfaces()).flat().find(n=>n?.address===host);
    const broadcast=iface?.netmask?host.split('.').map((o,i)=>(Number(o)&Number(iface.netmask.split('.')[i]))|(~Number(iface.netmask.split('.')[i])&255)).join('.'):'255.255.255.255';
    const socket=dgram.createSocket('udp4');await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,host,resolve);});socket.setBroadcast(true);socket.on('error',()=>{});
    const code=String(randomInt(1000,10000)),nonce=randomBytes(8).toString('hex');
    const message=Buffer.from(JSON.stringify({orbit:'pair',name:os.hostname().slice(0,24),host,port,code,nonce}));
    const announce=()=>{for(const target of new Set([broadcast,'255.255.255.255']))socket.send(message,PAIR_UDP_PORT,target,()=>{});};
    pairing={code,nonce,expires:Date.now()+60000,socket,timer:setInterval(announce,1000),stop:setTimeout(endPairing,60000)};announce();
    return {code,name:os.hostname(),host,seconds:60};
  }
  // Move Orbit to another PC's dashboard: code = "ORBIT-LINK:<host>:<port>:<64-hex token>" from that PC's
  // Show-Orbit-Link-Code.ps1. Orbit confirms, saves it and reconnects there; this PC then shows it offline.
  let relinkWaiter=null;
  function relink(code){
    const m=/^ORBIT-LINK:([0-9.]{7,15}):(\d{1,5}):([0-9a-f]{64})$/.exec(String(code||'').trim());
    if(!m||!privateIP(m[1])||Number(m[2])<1||Number(m[2])>65535)return Promise.reject(Error('Invalid link code.'));
    if(peer?.readyState!==WebSocket.OPEN)return Promise.reject(Error('Orbit is not connected.'));
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{relinkWaiter=null;reject(Error('Orbit did not confirm the move.'));},5000);
      relinkWaiter=ok=>{clearTimeout(timer);relinkWaiter=null;ok?resolve({moved:true,host:m[1],port:Number(m[2])}):reject(Error('Orbit rejected the link code.'));};
      send({type:'relink',host:m[1],port:Number(m[2]),token:m[3]});});
  }
  // Speaker test tone on Orbit over Wi-Fi: 60 s of 440 Hz beeps, or stop it early.
  function testTone(on){if(peer?.readyState!==WebSocket.OPEN)throw Error('Orbit is not connected.');send({type:on?'beep':'beep-stop'});return {sent:true};}
  return {status,pairCompanion,testTone,relink,startPairing,
    // The engine choice or the list changed on the PC: update Orbit's picker and console.
    refreshEngines:()=>refreshEngines(),
    // Send one message to Orbit; false when it is not connected.
    send(data){if(peer?.readyState!==WebSocket.OPEN)return false;peer.send(JSON.stringify(data));return true;},async setLeds(value){leds=ledSettings(value);await persist();send({type:'leds',...leds});return {...leds,online:peer?.readyState===WebSocket.OPEN};},async configure(value){setup=physicalSetup(value);await persist();await start();send({type:'setup',...setup});return status();},async usbConfig(){await start();return {host,port,token};},async close(){endPairing();peer?.close();wss.close();await new Promise(resolve=>server?server.close(resolve):resolve());server=null;}};
}
