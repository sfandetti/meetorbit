import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import WebSocket from 'ws';
import {projectTask,projectConversation,redactStatus} from './task-context.mjs';
import {attachVoiceProxy,taskInstructions,proxyVoiceHttp} from './voice-proxy.mjs';
import {attachVoiceRelay,SYSTEM_PROMPT} from './voice-relay.mjs';

test('task projection takes the latest visible update, excludes reasoning/tool output and redacts credentials',()=>{
  const result=projectTask({title:'Orbit',threadRuntimeStatus:{type:'active'},requests:[],turnHistory:{history:{entitiesByKey:{old:{turnStartedAtMs:1,items:[{type:'agentMessage',phase:'final',text:'Old work'}]},current:{turnStartedAtMs:2,items:[{type:'agentMessage',phase:'commentary',text:'Connecting Orbit. sk-fixture-secret'},{type:'reasoning',text:'Private reasoning'},{type:'agentMessage',phase:'analysis',text:'Hidden analysis'},{type:'commandExecution',aggregatedOutput:'Private output'}]}}}}},123);
  assert.equal(result.latestUpdate,'Connecting Orbit. [credential redacted]');assert.equal(result.observedAt,123);assert.ok(!JSON.stringify(result).includes('Private'));assert.equal('turnHistory' in result,false);assert.equal(redactStatus('Bearer private-token'),'[credential redacted]');
});
test('task-aware instructions explicitly describe read-only context and preserve the disconnected state',()=>{
  const text=taskInstructions({}, {connected:false,latestUpdate:'Unavailable'});assert.match(text,/connected is false/);assert.match(text,/"connected":false/);assert.match(text,/cannot approve actions/);assert.ok(text.length<=3000);
});
test('terminal conversation includes user commands and visible replies, excluding reasoning and tool output',()=>{
 const result=projectConversation({turnHistory:{history:{entitiesByKey:{turn:{turnStartedAtMs:1,items:[{id:'user',type:'userMessage',content:[{type:'text',text:'Please continue'}]},{id:'hidden',type:'reasoning',text:'Private thought'},{id:'tool',type:'commandExecution',aggregatedOutput:'Private output'},{id:'reply',type:'agentMessage',phase:'commentary',text:'Working on it sk-fixture-key'},{id:'steer',type:'steeringUserMessage',input:[{type:'text',text:'Change the color'}]}]}}}}});assert.deepEqual(result.map(m=>m.id),['user','reply','steer']);assert.equal(result[1].text,'Working on it [credential redacted]');assert.ok(!JSON.stringify(result).includes('Private'));
});
test('terminal strips browser context wrappers from user messages',()=>{
 const messages=projectConversation({turns:[{items:[{id:'wrapped',type:'userMessage',content:[{type:'text',text:'<in-app-browser-context>internal browser metadata</in-app-browser-context>\n## My request:\nMake the terminal simple.'}]}]}]});assert.equal(messages[0].text,'Make the terminal simple.');assert.ok(!JSON.stringify(messages).includes('metadata'));
});
test('desktop final_answer replies appear in both the terminal and latest task update',()=>{
 const state={title:'Orbit',turns:[{turnStartedAtMs:1,items:[{id:'u',type:'userMessage',content:[{type:'text',text:'How you doing?'}]},{id:'answer',type:'agentMessage',phase:'final_answer',text:'Doing well, Seth. How is the terminal feeling?'},{id:'private',type:'agentMessage',phase:'analysis',text:'Hidden analysis'}]}]};
 assert.equal(projectConversation(state).at(-1).id,'answer');assert.equal(projectTask(state).latestUpdate,'Doing well, Seth. How is the terminal feeling?');assert.ok(!JSON.stringify(projectConversation(state)).includes('Hidden analysis'));
});

test('gateway reuses retained credentials and refreshes task context before held audio reaches the provider',async()=>{
  const sent=[],sessions=[],providers=[];
  class Provider extends EventEmitter{readyState=WebSocket.OPEN;bufferedAmount=0;send(raw){const e=JSON.parse(raw);sent.push(e);if(e.type==='session.update'){sessions.push(e.session);queueMicrotask(()=>this.emit('message',JSON.stringify({type:'session.updated'})));}}close(){this.readyState=WebSocket.CLOSED;this.emit('close');}}
  let relay;const old=http.createServer((req,res)=>{if(req.url==='/api/voice/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(relay.status()));}});
  await new Promise(r=>old.listen(0,'127.0.0.1',r));const oldPort=old.address().port,origin=`http://127.0.0.1:${oldPort}`;
  relay=attachVoiceRelay(old,{port:oldPort,initialKey:'sk-fixture-retained-secret',connectUpstream(){const p=new Provider();providers.push(p);queueMicrotask(()=>p.emit('open'));return p;}});
  const gateway=http.createServer((req,res)=>proxyVoiceHttp(req,res,origin));await new Promise(r=>gateway.listen(0,'127.0.0.1',r));const port=gateway.address().port;
  let contextCalls=0;const proxy=attachVoiceProxy(gateway,{port,origin,getContext:async()=>({connected:true,title:'Orbit',latestUpdate:++contextCalls===1?'Earlier task':'Current task: connect live status'})});
  const ws=new WebSocket(`ws://127.0.0.1:${port}/api/voice/socket`,{origin:`http://127.0.0.1:${port}`}),received=[];ws.on('message',raw=>received.push(JSON.parse(raw)));
  const wait=async type=>{const until=Date.now()+3000;while(Date.now()<until){const i=received.findIndex(e=>e.type===type);if(i>=0)return received.splice(i,1)[0];await new Promise(r=>setTimeout(r,5));}throw Error('Missing '+type);};
  try{
    await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});ws.send(JSON.stringify({type:'start',mode:'openai',config:{}}));await wait('relay.ready');
    ws.send(JSON.stringify({type:'begin'}));ws.send(JSON.stringify({type:'audio',audio:Buffer.alloc(4800).toString('base64')}));ws.send(JSON.stringify({type:'end'}));await wait('relay.recording');await wait('relay.committed');
    assert.equal(sessions.length,2);assert.match(sessions[1].instructions,/Current task: connect live status/);assert.ok(sent.some(e=>e.type==='input_audio_buffer.append'));assert.ok(sent.some(e=>e.type==='response.create'));
    const publicStatus=await (await fetch(`http://127.0.0.1:${port}/api/voice/status`)).json();assert.equal(publicStatus.configured,true);assert.equal(JSON.stringify(publicStatus).includes('fixture-retained-secret'),false);
    assert.equal(relay.status().configured,true);assert.equal(received.some(e=>JSON.stringify(e).includes('fixture-retained-secret')),false);
    received.length=0;ws.send(JSON.stringify({type:'begin',transcriptionOnly:true}));await wait('relay.recording');
    providers.at(-1).emit('message',JSON.stringify({type:'response.created'}));providers.at(-1).emit('message',JSON.stringify({type:'response.output_audio.delta',delta:Buffer.alloc(4800).toString('base64')}));providers.at(-1).emit('message',JSON.stringify({type:'conversation.item.input_audio_transcription.completed',transcript:'Terminal fixture command'}));
    await new Promise(r=>setTimeout(r,20));assert.ok(received.some(e=>e.event?.transcript==='Terminal fixture command'));assert.equal(received.some(e=>e.event?.type==='response.output_audio.delta'),false,'terminal dictation never plays the companion response');
    ws.send(JSON.stringify({type:'begin'}));await wait('relay.recording');assert.ok(!sessions.at(-1).instructions.includes('Terminal fixture command'),'terminal commands stay out of companion voice dialogue');
  }finally{ws.terminate();proxy.close();relay.close();gateway.closeAllConnections();old.closeAllConnections();await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>old.close(r))]);}
});

test('gateway publishes current console guidance while retaining an already configured relay',async()=>{
 const retained=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({configured:true,instructions:'Old standalone voice guidance',active:0}));});
 await new Promise(r=>retained.listen(0,'127.0.0.1',r));
 const gateway=http.createServer((req,res)=>{proxyVoiceHttp(req,res,`http://127.0.0.1:${retained.address().port}`).catch(()=>{res.writeHead(500);res.end();});});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 try{const data=await (await fetch(`http://127.0.0.1:${gateway.address().port}/api/voice/status`)).json();assert.equal(data.configured,true);assert.equal(data.instructions,SYSTEM_PROMPT);assert.match(data.instructions,/CONSOLE/);assert.match(data.instructions,/SEND/);assert.doesNotMatch(data.instructions,/Old standalone/);}
 finally{gateway.closeAllConnections();retained.closeAllConnections();await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>retained.close(r))]);}
});
