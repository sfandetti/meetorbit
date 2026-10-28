import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import WebSocket,{WebSocketServer} from 'ws';
import dgram from 'node:dgram';
import {createDeviceLink,deviceHost} from './device-link.mjs';
// A stand-in for the dashboard voice socket: becomes ready after a delay and answers each end with reply audio.
async function fakeVoice(){
 const events=[],sockets=[],beginEvents=[];let starts=0;
 const server=http.createServer((_,res)=>{res.writeHead(404);res.end();});const wss=new WebSocketServer({server});
 wss.on('connection',ws=>{sockets.push(ws);ws.on('message',raw=>{const e=JSON.parse(raw);events.push(e.type);if(e.type==='begin')beginEvents.push(e);
  if(e.type==='start'){starts++;setTimeout(()=>ws.send(JSON.stringify({type:'relay.ready',mode:e.mode})),80);}
  if(e.type==='end'){ws.send(JSON.stringify({type:'upstream',event:{type:'response.output_audio.delta',delta:Buffer.alloc(3000,7).toString('base64')}}));ws.send(JSON.stringify({type:'upstream',event:{type:'response.done'}}));}
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {origin:`http://127.0.0.1:${server.address().port}`,events,beginEvents,sendAll(e){for(const ws of sockets)ws.send(JSON.stringify(e));},get starts(){return starts;},dropAll(){for(const ws of sockets)ws.close();},async close(){wss.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
async function fixture(){
 const voice=await fakeVoice(),dir=await mkdtemp(os.tmpdir()+'/orbit-device-');
 const port=19000+Math.floor(Math.random()*500);
 let stopped=0;const pcStats=onLine=>{const t=setInterval(()=>onLine('PC 20.00 49.07 -1.00 -1.00 -1.00 -1.00 -1.00 35.21 0.00 0.00 0.00 19.25 39.23 617.11 0.00 0.00'),20);return {stop(){clearInterval(t);stopped++;}};};
 const link=await createDeviceLink({runtimeDir:pathToFileURL(dir+'/'),voiceOrigin:voice.origin,port,pcStats});const cfg=await link.usbConfig();
 const device=new WebSocket(`ws://${cfg.host}:${cfg.port}/device`,{headers:{Authorization:'Bearer '+cfg.token}});
 const texts=[],audio=[];device.on('message',(raw,binary)=>{if(binary)audio.push(raw.length);else texts.push(JSON.parse(raw).type);});
 await new Promise((resolve,reject)=>{device.once('open',resolve);device.once('error',reject);});
 return {voice,device,link,texts,audio,async close(){device.close();await link.close();await voice.close();await rm(dir,{recursive:true,force:true});}};
}
test('the Wi-Fi adapter is preferred over virtual private adapters',()=>{
 const ifs={'Ethernet 2':[{family:'IPv4',internal:false,address:'192.168.56.1'}],'vEthernet (WSL)':[{family:'IPv4',internal:false,address:'172.20.0.1'}],'Wi-Fi':[{family:'IPv4',internal:false,address:'192.168.1.66'}]};
 assert.equal(deviceHost(ifs,''),'192.168.1.66');
 assert.equal(deviceHost(ifs,'10.0.0.5'),'10.0.0.5');
 assert.equal(deviceHost({'Ethernet':[{family:'IPv4',internal:false,address:'8.8.8.8'}]},''),'');
});
test('physical Ethernet is preferred to a VPN adapter on a wired PC',()=>{
 const ifs={'PIA OpenVPN WinTUN Adapter':[{family:'IPv4',internal:false,address:'10.29.18.46'}],'Ethernet':[{family:'IPv4',internal:false,address:'192.168.1.220'}]};
 assert.equal(deviceHost(ifs,''),'192.168.1.220');
 assert.equal(deviceHost(ifs,'10.29.18.46'),'10.29.18.46');
});
test('ring LED settings are clamped and validated',async()=>{
 const {ledSettings}=await import('./device-link.mjs');
 assert.deepEqual(ledSettings({}),{on:true,brightness:65,color:'#1e6eff',effect:0,speed:1});
 assert.deepEqual(ledSettings({on:false,brightness:250,color:'#ABCDEF',effect:7,speed:2}),{on:false,brightness:100,color:'#abcdef',effect:7,speed:2});
 assert.deepEqual(ledSettings({brightness:-5,color:'red; drop',effect:99,speed:-3}),{on:true,brightness:0,color:'#1e6eff',effect:11,speed:0});
});
const until=async(check,ms=2000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,10));}};
test('device turn waits for the relay, keeps order, and receives pushed reply audio',{skip:!deviceHost()&&'no private network address'},async()=>{
 const f=await fixture();try{
  f.device.send(JSON.stringify({type:'begin'}));f.device.send(Buffer.alloc(960));f.device.send(JSON.stringify({type:'end'}));
  await until(()=>f.texts.includes('done'));
  assert.deepEqual(f.voice.events,['start','begin','audio','end']);
  assert.ok(f.texts.includes('leds'),'the device receives its ring settings on connect');
  assert.ok(f.texts.includes('pc'),'PC gauge readings stream to the connected device');
  f.device.send(JSON.stringify({type:'leds-state',on:true,brightness:40,color:'#ff0000',effect:7,speed:2}));
  await until(()=>f.link.status().leds.effect===7);
  assert.deepEqual(f.link.status().leds,{on:true,brightness:40,color:'#ff0000',effect:7,speed:2},'changes made on Orbit are remembered');
  assert.match(f.link.status().deviceIp,/^(10|172|192)\./,'the device address is recorded for Wi-Fi updates');
  assert.deepEqual(f.audio,[2048,952]);
  assert.ok(f.texts.indexOf('ready')<f.texts.indexOf('speaking')&&f.texts.indexOf('speaking')<f.texts.indexOf('done'));
 }finally{await f.close();}
});
test('console text is plain ASCII, collapses code and keeps the newest messages',async()=>{
 const {consoleText,consoleMessage}=await import('./device-link.mjs');
 assert.equal(consoleText('It’s **done** — see:\n```js\nx()\n```\nok…'),"It's done - see: [code] ok...");
 const long=Array.from({length:10},(_,i)=>({role:i%2?'assistant':'user',text:`message ${i} `+'x'.repeat(500)}));
 const m=consoleMessage({connected:true,runtime:'active'},long,2);
 assert.equal(m.n,5);assert.equal(m.pending,2);assert.equal(m.r4,'a');assert.match(m.t4,/^message 9 /);assert.ok(m.t4.length<=360);
 assert.ok(JSON.stringify(m).length<3000,'fits one device frame');
});
test('a spoken console command is only transcribed, then waits for SEND before reaching the coding chat',{skip:!deviceHost()&&'no private network address'},async()=>{
 const voice=await fakeVoice(),dir=await mkdtemp(os.tmpdir()+'/orbit-device-');const sent=[];
 const control={session:()=>({id:'s'}),status:async()=>({approvals:[]}),cancel(){},
  prepare:async(_,body)=>({token:'t1',action:{text:body.text},pinRequired:false}),commit:async(_,{token})=>{sent.push(token);return {state:'sent'};}};
 const link=await createDeviceLink({runtimeDir:pathToFileURL(dir+'/'),voiceOrigin:voice.origin,port:19500+Math.floor(Math.random()*90),pcStats:()=>({stop(){}}),control,
  getContext:async()=>({connected:true,runtime:'idle'}),getConversation:()=>[{role:'user',text:'hi'},{role:'assistant',text:'Hello from Codex'}]});
 const cfg=await link.usbConfig();const device=new WebSocket(`ws://${cfg.host}:${cfg.port}/device`,{headers:{Authorization:'Bearer '+cfg.token}});
 const msgs=[];device.on('message',(raw,binary)=>{if(!binary)msgs.push(JSON.parse(raw));});
 await new Promise((resolve,reject)=>{device.once('open',resolve);device.once('error',reject);});
 try{
  await until(()=>msgs.some(m=>m.type==='console'));const c=msgs.find(m=>m.type==='console');
  assert.equal(c.t1,'Hello from Codex');assert.equal(c.connected,true);
  // The fake relay answers the transcription-only turn with a transcript.
  device.send(JSON.stringify({type:'begin',console:true}));device.send(JSON.stringify({type:'end'}));
  await until(()=>voice.events.includes('end'));
  voice.sendAll({type:'upstream',event:{type:'conversation.item.input_audio_transcription.completed',transcript:'run the tests'}});
  await until(()=>msgs.some(m=>m.type==='review'));
  assert.equal(msgs.find(m=>m.type==='review').text,'run the tests');assert.equal(sent.length,0,'nothing is sent before SEND');
  assert.ok(voice.beginEvents.some(e=>e.transcriptionOnly===true),'the relay is asked to transcribe only');
  device.send(JSON.stringify({type:'confirm'}));await until(()=>msgs.some(m=>m.type==='command-result'));
  assert.deepEqual(sent,['t1']);
 }finally{device.close();await link.close();await voice.close();await rm(dir,{recursive:true,force:true});}
});
test('a dropped relay session reopens on the next turn',{skip:!deviceHost()&&'no private network address'},async()=>{
 const f=await fixture();try{
  f.device.send(JSON.stringify({type:'begin'}));f.device.send(JSON.stringify({type:'end'}));await until(()=>f.texts.includes('done'));
  f.voice.dropAll();await new Promise(r=>setTimeout(r,100));
  f.device.send(JSON.stringify({type:'begin'}));f.device.send(JSON.stringify({type:'end'}));await until(()=>f.texts.filter(t=>t==='done').length===2);
  assert.equal(f.voice.starts,2);
 }finally{await f.close();}
});
test('the device can press only the media Stop key on the PC and read or set the volume',{skip:!deviceHost()&&'no private network address'},async()=>{
 const voice=await fakeVoice(),dir=await mkdtemp(os.tmpdir()+'/orbit-device-'),pressed=[];
 const volumes=[];let level=40;
 const link=await createDeviceLink({runtimeDir:pathToFileURL(dir+'/'),voiceOrigin:voice.origin,port:19900+Math.floor(Math.random()*90),mediaKey:async action=>{pressed.push(action);},volume:async v=>{volumes.push(v);if(v!==undefined)level=v;return level;}});const cfg=await link.usbConfig();
 const device=new WebSocket(`ws://${cfg.host}:${cfg.port}/device`,{headers:{Authorization:'Bearer '+cfg.token}});const texts=[];
 device.on('message',(raw,binary)=>{if(!binary)texts.push(JSON.parse(raw));});
 try{await new Promise((resolve,reject)=>{device.once('open',resolve);device.once('error',reject);});
  device.send(JSON.stringify({type:'media',action:'stop'}));device.send(JSON.stringify({type:'media',action:'shutdown'}));device.send(JSON.stringify({type:'media',action:'toString'}));
  await until(()=>texts.some(t=>t.type==='media-result')&&texts.filter(t=>t.type==='error').length===2);
  assert.deepEqual(pressed,['stop']);
  assert.equal(texts.find(t=>t.type==='media-result').text,'Stopped');
  device.send(JSON.stringify({type:'media',action:'get-volume'}));device.send(JSON.stringify({type:'media',action:'volume',level:72}));device.send(JSON.stringify({type:'media',action:'volume',level:'loud'}));
  await until(()=>texts.filter(t=>t.type==='volume').length===2&&texts.filter(t=>t.type==='error').length===3);
  assert.deepEqual(volumes,[undefined,72]);
  assert.deepEqual(texts.filter(t=>t.type==='volume').map(t=>t.level),[40,72]);
 }finally{device.close();await link.close();await voice.close();await rm(dir,{recursive:true,force:true});}
});
test('the companion key reaches the device only in the 32-hex format and waits for confirmation',{skip:!deviceHost()&&'no private network address'},async()=>{
 const f=await fixture();try{
  await assert.rejects(f.link.pairCompanion('not-a-key'),/Invalid/);
  f.device.on('message',(raw,binary)=>{if(binary)return;const e=JSON.parse(raw);if(e.type==='companion-pair')f.device.send(JSON.stringify({type:'companion-paired',ok:/^[0-9a-f]{32}$/.test(e.key)}));});
  assert.deepEqual(await f.link.pairCompanion('0123456789abcdef0123456789abcdef'),{paired:true});
 }finally{await f.close();}
});
test('moving Orbit to another PC sends a checked link code and waits for confirmation',{skip:!deviceHost()&&'no private network address'},async()=>{
 const f=await fixture();try{
  const token='ab'.repeat(32);
  await assert.rejects(f.link.relink('ORBIT-LINK:8.8.8.8:8790:'+token),/Invalid/);
  await assert.rejects(f.link.relink('ORBIT-LINK:192.168.1.50:8790:short'),/Invalid/);
  f.device.on('message',(raw,binary)=>{if(binary)return;const e=JSON.parse(raw);if(e.type==='relink')f.device.send(JSON.stringify({type:'relinked',ok:e.host==='192.168.1.50'&&e.port===8790&&e.token===token}));});
  assert.deepEqual(await f.link.relink('ORBIT-LINK:192.168.1.50:8790:'+token),{moved:true,host:'192.168.1.50',port:8790});
 }finally{await f.close();}
});
test('Wi-Fi pairing broadcasts an invitation and hands the token out once, only for the right code',{skip:!deviceHost()&&'no private network address'},async()=>{
 const f=await fixture();try{
  const listener=dgram.createSocket({type:'udp4',reuseAddr:true});const invites=[];listener.on('message',m=>invites.push(JSON.parse(m)));
  await new Promise(r=>listener.bind(8791,r));
  const p=await f.link.startPairing();assert.match(p.code,/^\d{4}$/);
  await until(()=>invites.length>0,3000);const inv=invites[0];
  assert.equal(inv.orbit,'pair');assert.equal(inv.code,p.code);assert.equal(inv.token,undefined,'the token is never broadcast');
  const base=`http://${inv.host}:${inv.port}/pair?nonce=${inv.nonce}&code=`;
  assert.equal((await fetch(base+'0000')).status,403);
  const ok=await fetch(base+inv.code);assert.equal(ok.status,200);assert.match((await ok.json()).token,/^[0-9a-f]{64}$/);
  assert.equal((await fetch(base+inv.code)).status,403,'one use only');
  assert.equal(f.link.status().pairing,null);
  listener.close();
 }finally{await f.close();}
});
test('a device that sends a browser Origin is refused',{skip:!deviceHost()&&'no private network address'},async()=>{
 const voice=await fakeVoice(),dir=await mkdtemp(os.tmpdir()+'/orbit-device-');
 const link=await createDeviceLink({runtimeDir:pathToFileURL(dir+'/'),voiceOrigin:voice.origin,port:19600+Math.floor(Math.random()*300)});const cfg=await link.usbConfig();
 try{const ws=new WebSocket(`ws://${cfg.host}:${cfg.port}/device`,{headers:{Authorization:'Bearer '+cfg.token,Origin:'http://evil.example'}});
  await assert.rejects(new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);}));
 }finally{await link.close();await voice.close();await rm(dir,{recursive:true,force:true});}
});
