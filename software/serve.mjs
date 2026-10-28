import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { bridgeRequest } from './bridge.mjs';
import { attachVoiceRelay } from './voice-relay.mjs';
import { createPrivacy } from './privacy.mjs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {createTaskContext} from './task-context.mjs';
import {attachVoiceProxy,proxyVoiceHttp} from './voice-proxy.mjs';
import {createTaskControl,taskControlHttp} from './task-control.mjs';
import {createSerialBeep} from './serial-beep.mjs';
import {createDeviceLink} from './device-link.mjs';
const serialBeep=createSerialBeep();
const runFile=promisify(execFile);
const privacy=createPrivacy({runtimeDir:fileURLToPath(new URL('./.orbit-runtime/',import.meta.url)),protectedPaths:[fileURLToPath(new URL('../../',import.meta.url))]});
const allowed = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/index.html', ['index.html','text/html; charset=utf-8']],
  ['/style.css', ['style.css','text/css; charset=utf-8']],
  ['/themes.css', ['themes.css','text/css; charset=utf-8']],
  ['/themes.mjs', ['themes.mjs','text/javascript; charset=utf-8']],
  ['/enclosure.css', ['enclosure.css','text/css; charset=utf-8']],
  ['/assets/orbit-enclosure-landscape.png', ['assets/orbit-enclosure-landscape.png','image/png']],
  ['/assets/orbit-enclosure-portrait.png', ['assets/orbit-enclosure-portrait.png','image/png']],
  ['/app.mjs', ['app.mjs','text/javascript; charset=utf-8']],
  ['/core.mjs', ['core.mjs','text/javascript; charset=utf-8']],
  ['/catalog.mjs', ['catalog.mjs','text/javascript; charset=utf-8']],
  ['/setup.mjs', ['setup.mjs','text/javascript; charset=utf-8']],
  ['/workbench.css', ['workbench.css','text/css; charset=utf-8']],
  ['/voice.mjs', ['voice.mjs','text/javascript; charset=utf-8']],
  ['/voice.css', ['voice.css','text/css; charset=utf-8']],
  ['/character.css', ['character.css','text/css; charset=utf-8']],
  ['/privacy-ui.mjs', ['privacy-ui.mjs','text/javascript; charset=utf-8']],
  ['/pcm-worklet.js', ['pcm-worklet.js','text/javascript; charset=utf-8']],
  ['/task-ui.mjs', ['task-ui.mjs','text/javascript; charset=utf-8']],
  ['/task-ui.css', ['task-ui.css','text/css; charset=utf-8']],
  ['/wake.mjs', ['wake.mjs','text/javascript; charset=utf-8']],
  ['/serial-beep-ui.mjs', ['serial-beep-ui.mjs','text/javascript; charset=utf-8']],
]);
const port = Number(process.env.ORBIT_SIM_PORT || 8787);
const voiceProxyOrigin=process.env.ORBIT_VOICE_PROXY||'';
const taskContext=createTaskContext({threadId:process.env.ORBIT_CODEX_THREAD_ID||process.env.CODEX_THREAD_ID});
const taskControl=createTaskControl({threadId:process.env.ORBIT_CODEX_THREAD_ID||process.env.CODEX_THREAD_ID,runtimeDir:new URL('./.orbit-runtime/',import.meta.url)});
const server = http.createServer(async (request,response) => {
  const host=request.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)){response.writeHead(403);response.end('Local access only');return;}
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/serial/')){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    try{
      const action=pathname.slice('/api/serial/'.length);
      if(request.method==='GET'&&action==='state'){response.end(JSON.stringify(serialBeep.state()));return;}
      if(request.method==='GET'&&action==='ports'){response.end(JSON.stringify({ports:await serialBeep.ports()}));return;}
      if(request.method!=='POST'||request.headers.origin!==`http://${host}`){response.writeHead(403);response.end(JSON.stringify({error:'Same-origin requests only.'}));return;}
      let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>256)throw Error('Request too large.');}
      const body=JSON.parse(raw||'{}');let result;
      if(action==='beep'||action==='loopback'){
        // A Companion upload may continue after its initiating HTTP request ends.
        let bridgeState;try{bridgeState=await bridgeRequest('state','GET',{});}catch{}
        if(bridgeState?.firmware?.running)throw Error('Wait for the firmware upload to finish before using USB for a beep.');
        result=await serialBeep.start(body.port,action==='loopback'?'loopback':'beep');
      }else if(action==='stop'){result=serialBeep.stop();}
      else{response.writeHead(404);response.end(JSON.stringify({error:'Unknown USB action.'}));return;}
      response.end(JSON.stringify(result));
    }catch(error){response.writeHead(400);response.end(JSON.stringify({error:error.message}));}return;
  }
  if(pathname==='/api/device/state'&&request.method==='GET'&&deviceLink){response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(deviceLink.status()));return;}
  if(pathname==='/api/device/pair-start'&&deviceLink){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    if(request.method!=='POST'||request.headers.origin!==`http://${host}`){response.writeHead(403);response.end(JSON.stringify({error:'Same-origin requests only.'}));return;}
    try{response.end(JSON.stringify(await deviceLink.startPairing()));}catch(error){response.writeHead(400);response.end(JSON.stringify({error:error.message}));}return;
  }
  if(pathname==='/api/device/relink'&&deviceLink){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    if(request.method!=='POST'||request.headers.origin!==`http://${host}`){response.writeHead(403);response.end(JSON.stringify({error:'Same-origin requests only.'}));return;}
    try{let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>256)throw Error('Request too large.');}response.end(JSON.stringify(await deviceLink.relink(JSON.parse(raw||'{}').code)));}
    catch(error){response.writeHead(400);response.end(JSON.stringify({error:error.message}));}return;
  }
  if(pathname==='/api/device/test-tone'&&deviceLink){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    if(request.method!=='POST'||request.headers.origin!==`http://${host}`){response.writeHead(403);response.end(JSON.stringify({error:'Same-origin requests only.'}));return;}
    try{let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>64)throw Error('Request too large.');}response.end(JSON.stringify(deviceLink.testTone(JSON.parse(raw||'{}').on!==false)));}
    catch(error){response.writeHead(400);response.end(JSON.stringify({error:error.message}));}return;
  }
  if(pathname==='/api/device/companion-pair'&&deviceLink){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    if(request.method!=='POST'||request.headers.origin!==`http://${host}`){response.writeHead(403);response.end(JSON.stringify({error:'Same-origin requests only.'}));return;}
    try{let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>128)throw Error('Request too large.');}response.end(JSON.stringify(await deviceLink.pairCompanion(String(JSON.parse(raw||'{}').key||''))));}
    catch(error){response.writeHead(400);response.end(JSON.stringify({error:error.message}));}return;
  }
  if(pathname==='/api/device/leds'&&deviceLink){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    if(request.method!=='POST'||request.headers.origin!==`http://${host}`){response.writeHead(403);response.end(JSON.stringify({error:'Same-origin requests only.'}));return;}
    try{let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>256)throw Error('Request too large.');}response.end(JSON.stringify(await deviceLink.setLeds(JSON.parse(raw||'{}'))));}
    catch(error){response.writeHead(400);response.end(JSON.stringify({error:error.message}));}return;
  }
  if(await taskControlHttp(request,response,taskControl))return;
  if(['/api/task/status','/api/task/conversation'].includes(pathname)&&request.method==='GET'){
    const context=await taskContext.refresh();response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(pathname.endsWith('/conversation')?{connected:context.connected,runtime:context.runtime,messages:taskContext.conversation}:context));return;
  }
  if(voiceProxyOrigin&&pathname.startsWith('/api/voice/')){
    try{if(await proxyVoiceHttp(request,response,voiceProxyOrigin))return;}catch{response.writeHead(502,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'The retained voice relay is unavailable.'}));return;}
  }
  if(pathname.startsWith('/api/privacy/')){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    const action=pathname.slice('/api/privacy/'.length);
    if(action==='settings'&&request.method==='GET'){try{response.end(JSON.stringify(await privacy.settings()));}catch{response.writeHead(400);response.end(JSON.stringify({error:'Cleanup settings could not be read.'}));}return;}
    if(request.method!=='POST'||request.headers.origin!==`http://${host}`){response.writeHead(403);response.end(JSON.stringify({error:'Same-origin request required.'}));return;}
    try{let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>4096)throw Error('Request too large');}const body=raw?JSON.parse(raw):{};let result;
      if(action==='settings')result=await privacy.save(body);
      else if(action==='prepare')result=await privacy.prepare();
      else if(action==='confirm')result=privacy.confirm(body.token);
      else if(action==='cancel')result=privacy.cancel(body.token);
      else if(action==='commit')result=await privacy.commit(body.token);
      else if(action==='browse'){
        const script="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();Add-Type -AssemblyName System.Windows.Forms;$picker=[System.Windows.Forms.FolderBrowserDialog]::new();$picker.Description='Choose the folder whose contents Emergency Delete will permanently remove';$picker.ShowNewFolderButton=$false;if($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Write($picker.SelectedPath)};$picker.Dispose()";
        const {stdout}=await runFile('powershell.exe',['-NoProfile','-STA','-Command',script],{windowsHide:true,timeout:120000});result={folder:stdout.trim()};
      }else{response.writeHead(404);response.end(JSON.stringify({error:'Unknown privacy action'}));return;}
      response.end(JSON.stringify(result));
    }catch(error){response.writeHead(400);response.end(JSON.stringify({error:['ENOENT','EACCES','EPERM'].includes(error.code)?'A selected path is missing or inaccessible. Check the folder and close selected browsers.':error.message}));}return;
  }
  if(pathname==='/api/voice/status'||pathname==='/api/voice/config'){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    if(pathname.endsWith('/status')&&request.method==='GET'){response.end(JSON.stringify(voiceRelay.status()));return;}
    if(pathname.endsWith('/config')&&request.method==='POST'&&request.headers.origin===`http://${host}`){
      try{let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>2048)throw Error('Request too large');}response.end(JSON.stringify(voiceRelay.configure(JSON.parse(raw))));}catch{response.writeHead(400);response.end(JSON.stringify({error:'Disconnect voice, then enter a valid API key (20–512 characters, no spaces).'}));}return;
    }
    response.writeHead(403);response.end(JSON.stringify({error:'Same-origin request required.'}));return;
  }
  if(pathname.startsWith('/api/bridge/')){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
    if(request.method==='POST'&&request.headers.origin!==`http://${host}`){response.writeHead(403);response.end(JSON.stringify({error:'Same-origin requests only.'}));return;}
    const action=pathname.slice('/api/bridge/'.length);
    if(!['start','state','ports','flash','provision','networks'].includes(action)){response.writeHead(404);response.end(JSON.stringify({error:'Unknown action'}));return;}
    let release;
    try{let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>2048)throw Error('Request too large');}if(request.method==='POST'&&['flash','provision'].includes(action))release=serialBeep.reserve();const data=await bridgeRequest(action,request.method,raw?JSON.parse(raw):{});response.writeHead(200);response.end(JSON.stringify(data));}catch(error){response.writeHead(400);response.end(JSON.stringify({error:error.message}));}finally{release?.();}return;
  }
  const route = allowed.get(new URL(request.url,'http://localhost').pathname);
  if (!route || !['GET','HEAD'].includes(request.method)) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const data=await readFile(new URL(route[0],import.meta.url));
    response.writeHead(200,{'Content-Type':route[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Permissions-Policy':'microphone=(self), camera=()',
      'Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'`});
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(500); response.end('Unable to load preview'); }
});
const voiceRelay=voiceProxyOrigin?attachVoiceProxy(server,{port,origin:voiceProxyOrigin,getContext:()=>taskContext.refresh()}):attachVoiceRelay(server,{port});
// Physical Orbit voice: only the dashboard process (which proxies the retained relay) listens for the device.
let deviceLink=null;
if(voiceProxyOrigin&&process.env.ORBIT_DEVICE_LINK!=='0'){
  try{deviceLink=await createDeviceLink({runtimeDir:new URL('./.orbit-runtime/',import.meta.url),voiceOrigin:`http://127.0.0.1:${port}`,getContext:()=>taskContext.refresh(),getConversation:()=>taskContext.conversation,control:taskControl});
    const link=await deviceLink.usbConfig();console.log(`Orbit device link: ws://${link.host}:${link.port}/device`);
  }catch(error){console.error(`Orbit device link: ${error.message}`);}
}
server.on('error',error => { console.error(`Orbit preview: ${error.message}`); process.exitCode=1; });
server.listen(port,'127.0.0.1',()=>console.log(`Orbit simulator: http://127.0.0.1:${port}`));
