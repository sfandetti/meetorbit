// Orbit: the one PC program. Console at http://127.0.0.1:8910, device link for the physical Orbit,
// AI voice relay, Codex console, and the companion features (screens, shortcuts, AI desk, privacy).
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {readFile,readdir,copyFile,access,mkdir,stat,unlink,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {createSentry,listCameras} from './sentry.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createSettings,dataDir} from './settings.mjs';
import {PAGES,SELECTABLE,THEMES,PALETTES,TIMEZONES,validateProfile,importCompanionProfile} from './profile.mjs';
import {attachVoiceRelay} from './voice-relay.mjs';
import {attachVoiceProxy} from './voice-proxy.mjs';
import {createDeviceLink,pressMediaKey,systemVolume,LED_EFFECTS,MEDIA_KEYS} from './device-link.mjs';
import {createDeviceFeed,newPasscode,passcodeMatches} from './device-feed.mjs';
import {createTaskContext} from './task-context.mjs';
import {createTaskControl,taskControlHttp} from './task-control.mjs';
import {createPrivacy,BROWSERS,BROWSER_PARTS} from './privacy.mjs';
import {validateShortcuts,launchShortcut,shortcutRuns,startMenuApps,SYSTEM_ACTIONS} from './shortcuts.mjs';
import {askDesk,deskModels,cursorBinary,PROVIDER_KEYS} from './ai-desk.mjs';
import {ENGINES,ENGINE_IDS,engineName,availableEngines,createChats,defaultModel,VOICE_INSTRUCTIONS} from './engines.mjs';
import {transcribe,speak} from './speech.mjs';
import {lockPC,signOut,setStartWithWindows,mediaPlayback,createAlarm,powershell} from './windows.mjs';
import {createSerialBeep} from './serial-beep.mjs';
import {bundledFirmware,updateFirmware} from './firmware-update.mjs';
import {orbitScreen} from './screenshot.mjs';
import {createHue,hueTool,hueMessage,matchName} from './hue.mjs';
import {createHueModes} from './hue-modes.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.ORBIT_PORT||8910);
const DATA=process.env.ORBIT_DATA_DIR||dataDir();
const VERSION=JSON.parse(await readFile(path.join(HERE,'package.json'),'utf8')).version;

// ---- First run: keep Orbit paired by taking over the old Orbit Control install's link files ----
async function adoptOldInstall(){
  const old=path.join(process.env.LOCALAPPDATA||'','Programs','OrbitControl','.orbit-runtime');
  await mkdir(DATA,{recursive:true});
  for(const name of ['device-link.json','paired-thread.json','task-auth.json']){
    const target=path.join(DATA,name);
    try{await access(target);}catch{try{await copyFile(path.join(old,name),target);}catch{}}
  }
}
// The old Python companion's settings (screens, theme, shortcuts...), read from its own page if it is running.
async function oldCompanionProfile(){
  const response=await fetch('http://127.0.0.1:8910/api/state',{signal:AbortSignal.timeout(3000)});const state=await response.json();
  if(state.product!=='OrbitCompanion')throw Error('not the old companion');return importCompanionProfile(state.profile);
}
await adoptOldInstall();
const settings=await createSettings({dir:DATA,importOld:oldCompanionProfile});
const runtimeDir=pathToFileURL(DATA+path.sep);

// ---- Codex console (the paired coding conversation) ----
let threadId=process.env.ORBIT_CODEX_THREAD_ID;
try{threadId||=JSON.parse(await readFile(path.join(DATA,'paired-thread.json'),'utf8')).threadId;}catch{}
const taskContext=createTaskContext({threadId});
const taskControl=createTaskControl({threadId,runtimeDir});

// ---- Privacy cleanup, alarm, shortcuts ----
const privacy=createPrivacy({protectedPaths:[HERE,DATA]});
try{const p=settings.profile();await privacy.save({folders:p.privacy_folders,browsers:p.privacy_browsers});}catch(error){console.error('Privacy targets need review: '+error.message);}
const alarm=createAlarm({dataDir:DATA});
// ---- Sentry webcam: frames go to Orbit's Sentry screen over its HTTP port, with the link token ----
const FFMPEG=process.env.ORBIT_FFMPEG||path.join(HERE,'vendor','ffmpeg','ffmpeg.exe');
async function showOnOrbit(rgb565){
  const s=link?.status();if(!s?.online||!s.deviceIp)return;
  const {token}=await link.usbConfig(),form=new FormData();form.append('frame',new Blob([rgb565],{type:'application/octet-stream'}),'frame.bin');
  await fetch(`http://${s.deviceIp}:${s.httpPort}/camera`,{method:'POST',headers:{Authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(4000)});
}
let alarmAt=0;
const sentry=createSentry({ffmpeg:FFMPEG,dataDir:DATA,getProfile:()=>settings.profile(),sendFrame:showOnOrbit,log:message=>console.log(`${new Date().toLocaleTimeString()} ${message}`),
  onMotion(){const p=settings.profile();if(p.alarm_enabled&&Date.now()-alarmAt>10000){alarmAt=Date.now();alarm.start(p.alarm_sound,p.alarm_loop);}}});
const showSentryScreen=()=>link?.send({type:'feed',screen:'19'});
let installedApps=[];startMenuApps().then(apps=>{installedApps=apps;});
let media='Unknown';
setInterval(async()=>{media=await mediaPlayback();},3000).unref();

// ---- AI voice relay (loopback only, inside this process) and the console's voice proxy ----
const relayServer=http.createServer((req,res)=>{res.writeHead(404);res.end();});
await new Promise(resolve=>relayServer.listen(0,'127.0.0.1',resolve));
const relayPort=relayServer.address().port;
// ---- Philips Hue (rooms on Orbit's HUE LIGHTS page; the voice gets control_lights once paired) ----
const hue=await createHue({file:path.join(DATA,'hue.json'),getKey:()=>settings.secret('hue_key'),setKey:key=>settings.setSecrets({hue_key:key}),deviceName:os.hostname()});
const hueModes=createHueModes({hue,onChange:()=>pushHue(true)});
let hueSent='';
// The lights a room (or "0", every light) holds: remembered before a hand change so STOP can put them back.
const roomLights=id=>id==='0'?hue.lights().map(l=>l.id):hue.rooms().find(r=>r.id===id)?.lights||[];
function pushHue(force=false){const text=JSON.stringify(hueMessage(hue.status(),hueModes.current(),hueModes.rooms(),hueModes.changed()));if(!force&&text===hueSent)return;if(link?.send(JSON.parse(text)))hueSent=text;}
async function hueRefresh(force=false){if(settings.has('hue_key'))await hue.refresh().catch(()=>{});pushHue(force);}
// Rooms switched in the Hue app or on a wall switch show up on Orbit within a few seconds.
setInterval(()=>{if(link?.status().online)hueRefresh();},8000).unref();
// From Orbit: a room tapped or slid, a mode picked, or (many times a second) the visualizer's beat.
// Changing a room by hand ends a running mode without putting the old lights back.
async function hueEvent(e){
  if(e.type==='hue-music'){hueModes.music(e);return;}
  const id=String(e.id||'0').replace(/\D/g,'')||'0';
  if(e.type==='hue-toggle'){hueModes.stop(false);await hueModes.remember(roomLights(id));await hue.toggle(id,e.on===true).catch(()=>{});}
  if(e.type==='hue-bri'){hueModes.stop(false);await hueModes.remember(roomLights(id));await hue.brightness(id,Number(e.bri)).catch(()=>{});}
  if(e.type==='hue-mode')await hueModes.start(String(e.mode||''),String(e.rooms||'').split(',').filter(Boolean)).catch(()=>{});
  await hueRefresh(true);
}
const relay=attachVoiceRelay(relayServer,{port:relayPort,initialKey:settings.secret('openai_key'),
  getTools:async()=>{if(!settings.has('hue_key'))return [];await hue.refresh().catch(()=>{});return [hueTool(hue.describe())];},
  runTool:async(name,args)=>{if(name!=='control_lights')return 'Unknown tool.';
    if(args.mode){let rooms=[];if(args.room){const r=matchName(hue.rooms(),args.room);if(!r)return `There is no Hue room called ${args.room}.`;rooms=[r.id];}return hueModes.start(args.mode,rooms);}
    hueModes.stop(false);const r=args.room?matchName(hue.rooms(),args.room):null;await hueModes.remember(roomLights(r?.id||'0'));
    const said=await hue.control(args);pushHue();return said;}});

// ---- Device link + companion feed ----
let link=null,cleanupToken=null;
const feed=createDeviceFeed({
  link:{send:m=>link?.send(m)||false},getProfile:()=>settings.profile(),
  getPin:()=>({pin_hash:settings.secret('pin_hash'),pin_salt:settings.secret('pin_salt')}),
  getMedia:()=>media,getCamera:()=>sentry.status(),
  actions:{execute:runDeviceCommand,confirmed:runConfirmed},
});
async function systemAction(action,{askToConfirm}){
  if(action==='lock')return lockPC();
  if(action==='signout')return askToConfirm('signout','Sign out?','Sign out of Windows? This closes your session and applications. Hold YES to confirm; NO cancels.');
  if(action==='cleanup'){const plan=await privacy.prepare();cleanupToken=plan.token;
    return askToConfirm('cleanup','Privacy cleanup',`Permanently delete ${plan.files} selected files? Cannot undo. Hold YES to confirm; NO cancels.`);}
  throw Error('Unknown system shortcut');
}
async function runConfirmed(action){
  if(action==='signout')return signOut();
  if(action==='cleanup'){const token=cleanupToken;cleanupToken=null;if(!token)throw Error('Review expired. Try again.');return (await privacy.commit(privacy.confirm(token).token)).status;}
  throw Error('Unknown action');
}
async function runDeviceCommand(command,helpers){
  const [kind,arg='']=command.split(':');
  if(kind==='privacy')return systemAction(arg,helpers);
  if(kind==='media'){if(!Object.hasOwn(MEDIA_KEYS,arg))throw Error('Unknown media control');await pressMediaKey(arg);return 'Media command sent';}
  if(kind==='app'){const item=settings.profile().apps[Number(arg)];if(!item)throw Error('Unknown shortcut');return item.kind==='system'?systemAction(item.action,helpers):launchShortcut(item);}
  if(kind==='ai'){
    if(arg==='dismiss'){feed.dismiss();return 'Message closed';}
    if(arg==='checkin'){deskAnswer('Give me a short useful desk check-in and ask what I want to focus on.').catch(()=>{});return 'Asking AI...';}
    if(arg==='health'){const pc=link?.status().lastPc?.line||'no readings';deskAnswer('Briefly describe my PC health from these live readings (CPU%, GPU%, temps, memory...): '+pc).catch(()=>{});return 'Asking AI...';}
  }
  if(kind==='camera'){  // Orbit's Sentry screen buttons
    if(arg==='snap'){await sentry.snapshot();return 'Snapshot received';}
    if(arg==='live'){sentry.preview();return 'Preview on for 60 seconds';}
    if(arg==='record'){await sentry.record();return 'Recording started';}
    if(arg==='arm'){sentry.arm();return 'Sentry armed';}
    if(arg==='stop'||arg==='disarm'){alarm.stop();sentry.stop();return arg==='stop'?'Camera stopped':'Sentry disarmed';}
  }
  throw Error('Unknown or unconfigured control');
}
async function deskAnswer(prompt){
  const p=settings.profile(),provider=p.ai_provider;
  try{const {answer}=await askDesk({provider,key:settings.secret(PROVIDER_KEYS[provider]),model:p.provider_models[provider]||'',cursorPath:p.cursor_path,prompt,workdir:path.join(DATA,'AIWorkspace')});
    if(!answer)throw Error('The provider returned no text.');feed.message('Orbit AI',answer,true);return answer;}
  catch(error){feed.message('AI unavailable',error.message,true);throw error;}
}
const voiceOrigin=`http://127.0.0.1:${PORT}`;
// ---- Who Orbit talks to (its ENGINE picker): ChatGPT's realtime voice, a text engine, or Codex ----
const chats=createChats();
async function readyEngines(){
  return availableEngines({has:name=>settings.has(name),codexConnected:!!(await taskContext.refresh()).connected});
}
async function chooseEngine(id){
  if(!ENGINE_IDS.includes(id))throw Error('Unknown engine.');
  if(!(await readyEngines()).some(e=>e.id===id))throw Error(`${engineName(id)} isn't set up yet. Add its key in AI desk.`);
  await settings.save({...settings.profile(),orbit_engine:id});
}
// A freshly saved Claude or DeepSeek key gets a model straight away, so it works without another step.
async function pickModel(provider){
  if(!['claude','deepseek'].includes(provider))return;const p=settings.profile();if(p.provider_models?.[provider])return;
  try{const model=defaultModel(provider,await deskModels({provider,key:settings.secret(PROVIDER_KEYS[provider])}));if(model)await settings.save({...p,provider_models:{...p.provider_models,[provider]:model}});}
  catch(error){console.error(`Could not list ${provider} models: ${error.message}`);}
}
const engines={
  current(){const id=settings.profile().orbit_engine;return {id,name:engineName(id)};},
  list:readyEngines,choose:id=>chooseEngine(id).catch(()=>{}),chats,
  transcribe:pcm=>transcribe(pcm,{key:settings.secret('openai_key')}),
  speak:text=>speak(text,{key:settings.secret('openai_key')}),
  async ask(id,text,history){
    const p=settings.profile(),provider=ENGINES.find(e=>e.id===id)?.provider;if(!provider)throw Error('Choose an engine on Orbit first.');
    const {answer}=await askDesk({provider,key:settings.secret(PROVIDER_KEYS[provider]),model:p.provider_models[provider]||'',cursorPath:p.cursor_path,prompt:text,history,
      instructions:VOICE_INSTRUCTIONS,maxTokens:300,workdir:path.join(DATA,'AIWorkspace')});
    return answer;
  },
};
try{
  link=await createDeviceLink({runtimeDir,voiceOrigin,port:Number(process.env.ORBIT_LINK_PORT||8790),getContext:()=>taskContext.refresh(),getConversation:()=>taskContext.conversation,control:taskControl,onEvent:e=>String(e.type).startsWith('hue-')?hueEvent(e):feed.onDeviceEvent(e),onConnect:()=>{feed.onConnect();hueSent='';setTimeout(()=>hueRefresh(true),500);},
    log:message=>console.log(`${new Date().toLocaleTimeString()} ${message}`),engines});
  const info=await link.usbConfig();console.log(`Orbit device link: ws://${info.host}:${info.port}/device`);
}catch(error){console.error('Orbit device link: '+error.message);}
feed.start();
// Keep Windows' sign-in entry in step with the saved choice (and pointing at this copy of Orbit).
if(settings.profile().startup&&!process.env.ORBIT_PORT)setStartWithWindows(true,startCommand()).catch(error=>console.error('Start with Windows: '+error.message));

// ---- Console web server ----
const PAGE_TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const pageDir=path.join(HERE,'console');
const pages=new Map();
for(const entry of await readdir(pageDir,{recursive:true,withFileTypes:true})){
  if(!entry.isFile())continue;const file=path.join(entry.parentPath??entry.path,entry.name),type=PAGE_TYPES[path.extname(file)];
  if(type)pages.set('/'+path.relative(pageDir,file).split(path.sep).join('/'),[file,type]);
}
pages.set('/',pages.get('/index.html'));
// Browser audio worklet for the console's hold-to-talk test lives with the old dashboard code.
pages.set('/pcm-worklet.js',[path.join(HERE,'pcm-worklet.js'),PAGE_TYPES['.js']]);
const SECURITY_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'microphone=(self), camera=()',
  'Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:${PORT} ws://localhost:${PORT}; frame-ancestors 'none'; base-uri 'none'`};

const routes=new Map();  // "METHOD /path" -> handler(body, request) -> result object
const route=(method,p,fn)=>routes.set(method+' '+p,fn);
function publicState(){
  const p=settings.profile();
  return {product:'Orbit',version:VERSION,profile:p,pages:PAGES,selectable:SELECTABLE,themes:THEMES,palettes:PALETTES,timezones:TIMEZONES,ledEffects:LED_EFFECTS,
    browsers:BROWSERS,browserParts:Object.keys(BROWSER_PARTS),systemActions:SYSTEM_ACTIONS,
    keys:Object.fromEntries(Object.entries(PROVIDER_KEYS).map(([provider,name])=>[provider,settings.has(name)])),keyError:settings.secretError(),
    pinEnabled:settings.has('pin_hash'),sentry:sentry.status(),device:link?.status()||{online:false,error:'Device link unavailable'},deviceState:feed.deviceState(),
    desk:feed.desk(),reply:feed.reply(),media,alarmActive:alarm.active,commandRuns:shortcutRuns(),voice:relay.status()};
}
function requirePin(pin){if(!passcodeMatches({pin_hash:settings.secret('pin_hash'),pin_salt:settings.secret('pin_salt')},pin))throw Error('Incorrect passcode.');}
route('GET','/api/state',async()=>({...publicState(),engines:{all:ENGINES.map(({id,name})=>({id,name})),ready:await readyEngines(),current:engines.current()}}));
// Who Orbit talks to, chosen in the console (Orbit's ENGINE view does the same).
route('POST','/api/engine',async body=>{await chooseEngine(String(body.id||''));link?.refreshEngines();return {current:engines.current()};});
route('POST','/api/profile',async body=>{
  const current=settings.profile();const next=validateProfile(body,current);
  if(Object.hasOwn(body,'apps'))next.apps=await validateShortcuts(body.apps,installedApps,current.apps);
  if(Object.hasOwn(body,'privacy_folders')||Object.hasOwn(body,'privacy_browsers')){
    const saved=await privacy.save({folders:body.privacy_folders??current.privacy_folders,browsers:body.privacy_browsers??current.privacy_browsers});
    next.privacy_folders=saved.folders;next.privacy_browsers=saved.browsers;
  }
  if(body.new_pin||body.clear_pin){
    requirePin(body.current_pin||'');
    if(body.clear_pin)await settings.setSecrets({pin_hash:'',pin_salt:''});
    else{if(String(body.new_pin)!==String(body.pin_confirm||''))throw Error('Enter matching passcodes with four to six digits.');await settings.setSecrets(newPasscode(body.new_pin));}
  }
  if(next.startup!==current.startup)await setStartWithWindows(next.startup,startCommand());
  await settings.save(next);feed.push();link?.refreshEngines();return publicState();
});
route('POST','/api/keys',async body=>{
  const name=PROVIDER_KEYS[body.provider];if(!name)throw Error('Choose OpenAI, Claude, DeepSeek or Cursor.');
  const key=String(body.key||'').trim();
  if(body.clear){await settings.setSecrets({[name]:''});if(body.provider==='openai')relay.configure({clear:true});return publicState();}
  if(key.length<15||key.length>512||/\s/.test(key))throw Error('Paste the whole API key (no spaces).');
  if(body.provider==='openai')relay.configure({apiKey:key});
  await settings.setSecrets({[name]:key});await pickModel(body.provider);link?.refreshEngines();return publicState();
});
// Voice lab in the console uses the same relay through the proxy.
route('GET','/api/voice/status',()=>relay.status());
const needLink=()=>{if(!link)throw Error('The device link could not start. Check this PC is on your home network, then restart Orbit.');return link;};
route('POST','/api/device/leds',body=>needLink().setLeds(body));
route('POST','/api/device/pair-start',()=>needLink().startPairing());
route('POST','/api/device/test-tone',body=>needLink().testTone(body.on!==false));
route('POST','/api/device/relink',body=>needLink().relink(body.code));
route('POST','/api/device/screen',body=>{const page=Number(body.page);if(!SELECTABLE.includes(page)&&![21,22].includes(page))throw Error('Unknown screen.');if(!needLink().send({type:'feed',screen:String(page)}))throw Error('Orbit is not connected.');return {sent:true};});
route('POST','/api/media',async body=>{if(!Object.hasOwn(MEDIA_KEYS,body.action))throw Error('Unknown media control.');await pressMediaKey(body.action);return {status:'Media command sent'};});
route('GET','/api/volume',async()=>({level:await systemVolume()}));
route('POST','/api/volume',async body=>({level:await systemVolume(Number(body.level))}));
route('GET','/api/inventory',async()=>{installedApps=await startMenuApps();return {apps:installedApps,cameras:await listCameras(FFMPEG),ports:await serialBeep.ports().catch(()=>[])};});
// Sentry from the console. Preview and recording also put Orbit on its Sentry screen.
route('POST','/api/sentry/snapshot',async()=>sentry.snapshot());
route('POST','/api/sentry/preview',()=>{const s=sentry.preview();showSentryScreen();return s;});
route('POST','/api/sentry/record',async()=>{const s=await sentry.record();showSentryScreen();return s;});
route('POST','/api/sentry/arm',()=>sentry.arm());
route('POST','/api/sentry/stop',()=>{alarm.stop();return sentry.stop();});
const CLIP=/^(manual|motion)-[\d-]+\.mp4$/;
route('GET','/api/recordings',async()=>{
  const rows=[];try{for(const name of await readdir(sentry.clipsDir)){if(!CLIP.test(name))continue;const s=await stat(path.join(sentry.clipsDir,name));rows.push({name,bytes:s.size,at:s.mtimeMs});}}catch{}
  return rows.sort((a,b)=>b.at-a.at).slice(0,200);
});
route('POST','/api/recordings/delete',async body=>{requirePin(body.pin||'');if(!CLIP.test(String(body.name)))throw Error('Choose a finished recording.');
  try{await unlink(path.join(sentry.clipsDir,body.name));}catch(e){throw Error(e.code==='EBUSY'||e.code==='EPERM'?'That recording is open in a player. Close it and try again.':'Recording not found.');}return {status:'Recording deleted'};});
route('POST','/api/recordings/open',async()=>{await mkdir(sentry.clipsDir,{recursive:true});spawn(path.join(process.env.WINDIR||'C:\\Windows','explorer.exe'),[sentry.clipsDir],{detached:true,stdio:'ignore'}).unref();return {status:'Opened the recordings folder'};});
route('POST','/api/shortcut/run',async body=>{requirePin(body.pin||'');const item=settings.profile().apps[Number(body.slot)];if(!item)throw Error('Choose a saved shortcut.');
  return {status:item.kind==='system'?await systemAction(item.action,{askToConfirm:(a,t,b)=>feed.askToConfirm(a,t,b)}):launchShortcut(item)};});
route('POST','/api/system/action',async body=>{if(body.action!=='lock')requirePin(body.pin||'');return {status:await systemAction(body.action,{askToConfirm:(a,t,b)=>feed.askToConfirm(a,t,b)})};});
route('POST','/api/ai/ask',async body=>({answer:await deskAnswer(String(body.prompt||''))}));
route('POST','/api/ai/models',async body=>{const provider=body.provider||settings.profile().ai_provider;return {models:await deskModels({provider,key:settings.secret(PROVIDER_KEYS[provider])})};});
route('GET','/api/ai/cursor',async()=>({path:await cursorBinary(settings.profile().cursor_path)}));
route('POST','/api/desk/message',body=>({id:feed.message(body.title||'A quick question',String(body.body||''),true)}));
route('POST','/api/desk/dismiss',()=>{feed.dismiss();return {status:'Message closed'};});
route('GET','/api/privacy/settings',()=>privacy.settings());
route('POST','/api/privacy/prepare',async body=>{requirePin(body.pin||'');return privacy.prepare();});
route('POST','/api/privacy/confirm',body=>privacy.confirm(body.token));
route('POST','/api/privacy/cancel',body=>privacy.cancel(body.token));
route('POST','/api/privacy/commit',async body=>privacy.commit(body.token));
route('POST','/api/alarm/test',()=>{alarm.start(settings.profile().alarm_sound,false);return {status:'Playing the selected alarm once'};});
route('POST','/api/alarm/stop',()=>{alarm.stop();return {status:'Alarm silenced'};});
route('GET','/api/task/status',async()=>taskContext.refresh());
route('GET','/api/task/conversation',async()=>{const c=await taskContext.refresh();return {connected:c.connected,runtime:c.runtime,messages:taskContext.conversation};});
// Firmware updates over Wi-Fi: one at a time, progress shown in Device settings.
let firmwareJob={running:false,status:''};
// Hue in the console: find the bridge, pair (after its button is pressed), switch rooms, forget it.
route('GET','/api/hue',async()=>{if(settings.has('hue_key'))await hue.refresh().catch(()=>{});return {...hue.status(),mode:hueModes.current()};});
route('POST','/api/hue/find',async()=>hue.find());
route('POST','/api/hue/pair',async()=>{const s=await hue.pair();pushHue(true);return s;});
route('POST','/api/hue/forget',async()=>{const s=await hue.forget();pushHue(true);return s;});
route('POST','/api/hue/mode',async body=>{await hueModes.start(String(body.mode||''),Array.isArray(body.rooms)?body.rooms:[]);return {...hue.status(),mode:hueModes.current()};});
route('POST','/api/hue/room',async body=>{const id=String(body.id||'0').replace(/\D/g,'')||'0';hueModes.stop(false);await hueModes.remember(roomLights(id));await hue.toggle(id,body.on===true);pushHue(true);return hue.status();});
route('GET','/api/firmware',async()=>{let available='';try{available=(await bundledFirmware(path.join(HERE,'firmware-images'))).version;}catch{}return {...firmwareJob,available,installed:link?.status().firmware||''};});
route('POST','/api/firmware/update',async()=>{
  if(firmwareJob.running)throw Error('An update is already running.');
  const firmware=await bundledFirmware(path.join(HERE,'firmware-images'));const device=needLink();
  if(!device.status().online)throw Error('Orbit is not connected. Turn it on and wait for it to connect first.');
  firmwareJob={running:true,status:'Starting…'};
  updateFirmware({link:device,firmware,progress:status=>{firmwareJob.status=status;}})
    .catch(error=>{firmwareJob.status=error.message;}).finally(()=>{firmwareJob.running=false;});
  return firmwareJob;
});
// Screenshot of Orbit's screen, for checking layouts: {rot, page, view, tap} are applied on Orbit first.
// Saved as screens\<name>.png in Orbit's data folder. POST, so only this console can turn or tap Orbit.
route('POST','/api/orbit/screen',async body=>{
  const device=needLink(),s=device.status();if(!s.online||!s.deviceIp)throw Error('Orbit is not connected.');
  const {token}=await device.usbConfig(),shot=await orbitScreen({deviceIp:s.deviceIp,httpPort:s.httpPort,token,rot:body?.rot,page:body?.page,view:body?.view,tap:body?.tap});
  const name=String(body?.name||'orbit').replace(/[^\w-]/g,'').slice(0,40)||'orbit',dir=path.join(DATA,'screens');await mkdir(dir,{recursive:true});
  const file=path.join(dir,name+'.png');await writeFile(file,shot.png);return {file,width:shot.width,height:shot.height};
});
route('POST','/api/folder/browse',async()=>({folder:await powershell("Add-Type -AssemblyName System.Windows.Forms;$p=[System.Windows.Forms.FolderBrowserDialog]::new();$p.Description='Choose a folder whose contents Privacy cleanup may permanently delete';$p.ShowNewFolderButton=$false;if($p.ShowDialog() -eq 'OK'){$p.SelectedPath};$p.Dispose()",{timeout:300000})}));

const serialBeep=createSerialBeep();
function startCommand(){
  // Hidden start at sign-in, keeping the log (%LOCALAPPDATA%\Orbit\orbit.log). The installer replaces this
  // with its own launcher.
  const q=s=>s.replace(/'/g,"''");
  return `powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '${q(process.execPath)}' -ArgumentList '\\"${q(fileURLToPath(import.meta.url))}\\"' -WorkingDirectory '${q(HERE)}' -RedirectStandardOutput '${q(path.join(DATA,'orbit.log'))}' -RedirectStandardError '${q(path.join(DATA,'orbit-errors.log'))}'"`;
}

const server=http.createServer(async(request,response)=>{
  const host=request.headers.host;
  if(![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(host)){response.writeHead(403);response.end('Local access only');return;}
  const pathname=new URL(request.url,'http://localhost').pathname;
  // Binary answers: the latest webcam picture, and recordings to download.
  if(request.method==='GET'&&pathname==='/api/camera.bmp'){const image=sentry.latestImage();if(!image){response.writeHead(404);response.end();return;}response.writeHead(200,{'Content-Type':'image/bmp','Cache-Control':'no-store'});response.end(image);return;}
  if(request.method==='GET'&&pathname.startsWith('/api/recordings/file/')){
    const name=decodeURIComponent(pathname.slice('/api/recordings/file/'.length));
    if(!CLIP.test(name)){response.writeHead(404);response.end();return;}
    try{const file=path.join(sentry.clipsDir,name),size=(await stat(file)).size;response.writeHead(200,{'Content-Type':'video/mp4','Content-Length':size,'Content-Disposition':`attachment; filename="${name}"`});createReadStream(file).pipe(response);}
    catch{response.writeHead(404);response.end();}
    return;
  }
  if(pathname.startsWith('/api/')){
    if(await taskControlHttp(request,response,taskControl))return;
    const handler=routes.get(request.method+' '+pathname);
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    if(!handler){response.writeHead(404);response.end(JSON.stringify({error:'Not found'}));return;}
    // Changes only from this page itself (blocks other websites from posting to the console).
    if(request.method!=='GET'&&request.headers.origin!==`http://${host}`){response.writeHead(403);response.end(JSON.stringify({error:'Open the Orbit console on this PC to do that.'}));return;}
    try{
      let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>16000)throw Error('Request is too large.');}
      response.end(JSON.stringify(await handler(raw?JSON.parse(raw):{},request)));
    }catch(error){response.writeHead(400);response.end(JSON.stringify({error:String(error?.message||'That did not work.').replace(/sk-[\w-]+/g,'[redacted]').slice(0,300)}));}
    return;
  }
  const page=pages.get(pathname);
  if(!page||!['GET','HEAD'].includes(request.method)){response.writeHead(404);response.end('Not found');return;}
  try{const data=await readFile(page[0]);response.writeHead(200,{'Content-Type':page[1],...SECURITY_HEADERS});response.end(request.method==='HEAD'?undefined:data);}
  catch{response.writeHead(500);response.end('Unable to load the console');}
});
attachVoiceProxy(server,{port:PORT,origin:`http://127.0.0.1:${relayPort}`,getContext:()=>taskContext.refresh()});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${PORT} is in use. Is another Orbit already running?`:error.message);process.exit(1);});
server.listen(PORT,'127.0.0.1',()=>console.log(`Orbit console: http://127.0.0.1:${PORT}  (data: ${DATA}, ${os.hostname()})`));
