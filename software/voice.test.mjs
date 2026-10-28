import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { attachVoiceRelay,sessionConfig,decodeAudio } from './voice-relay.mjs';
test('voice session is manual push-to-talk with 24kHz PCM and no tools',()=>{
  const config=sessionConfig();assert.equal(config.audio.input.turn_detection,null);assert.equal(config.audio.input.format.rate,24000);assert.equal(config.audio.output.format.rate,24000);assert.equal('tools' in config,false);
  assert.throws(()=>sessionConfig({model:'http://external.test'}));assert.throws(()=>sessionConfig({voice:'unknown'}));assert.throws(()=>sessionConfig({instructions:'x'.repeat(3001)}));
});
test('PCM frame validation rejects malformed, oversized and partial samples',()=>{
  assert.equal(decodeAudio(Buffer.alloc(4800).toString('base64')).length,4800);
  for(const bad of ['','!invalid',Buffer.alloc(3).toString('base64'),Buffer.alloc(14000).toString('base64')])assert.throws(()=>decodeAudio(bad));
});
test('microphone worklet sends only held audio, resamples to 24kHz and never monitors into speakers',()=>{
  let Processor;const messages=[];
  class Base{port={postMessage:event=>messages.push(event)};}
  const sandbox={AudioWorkletProcessor:Base,sampleRate:48000,registerProcessor:(_,p)=>{Processor=p;},ArrayBuffer,DataView,Math};
  vm.runInNewContext(readFileSync(new URL('./pcm-worklet.js',import.meta.url),'utf8'),sandbox);
  const processor=new Processor(),input=new Float32Array(4800).fill(.5),output=new Float32Array(4800).fill(1);
  processor.process([[input]],[[output]]);assert.equal(messages.some(e=>e.type==='audio'),false);assert.ok(output.every(x=>x===0));
  processor.port.onmessage({data:'start'});processor.process([[input]],[[output]]);processor.port.onmessage({data:'stop'});
  const audio=messages.filter(e=>e.type==='audio');assert.equal(audio.length,1);assert.equal(audio[0].buffer.byteLength,4800);assert.equal(new DataView(audio[0].buffer).getInt16(0,true),16384);assert.equal(messages.at(-1).type,'stopped');
  const count=audio.length;processor.process([[input]],[[output]]);assert.equal(messages.filter(e=>e.type==='audio').length,count);
  processor.port.onmessage({data:'start'});processor.process([[new Float32Array(100)]],[[output]]);processor.port.onmessage({data:'cancel'});processor.port.onmessage({data:'stop'});assert.equal(messages.filter(e=>e.type==='audio').length,count);
});
async function harness(options={}){
  const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const relay=attachVoiceRelay(server,{port,initialKey:'',...options});
  const ws=new WebSocket(`ws://127.0.0.1:${port}/api/voice/socket`,{origin:`http://127.0.0.1:${port}`});
  const received=[];ws.on('message',raw=>received.push(JSON.parse(raw)));
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  async function wait(type){const until=Date.now()+2000;while(Date.now()<until){const index=received.findIndex(e=>e.type===type);if(index>=0)return received.splice(index,1)[0];await new Promise(r=>setTimeout(r,5));}throw Error('Missing '+type);}
  return {ws,relay,port,send:e=>ws.send(JSON.stringify(e)),wait,async close(){ws.terminate();relay.close();await new Promise(r=>server.close(r));}};
}
test('local loopback relays exact held PCM, never opens an AI connection, and rejects unheld audio',async()=>{
  let calls=0;const h=await harness({connectUpstream(){calls++;throw Error('No upstream expected');}});
  try{
    h.send({type:'start',mode:'loopback'});await h.wait('relay.ready');
    const audio=Buffer.alloc(4800,7).toString('base64');h.send({type:'audio',audio});assert.match((await h.wait('relay.error')).message,/Hold/);
    h.send({type:'begin'});await h.wait('relay.recording');h.send({type:'audio',audio});h.send({type:'end'});assert.equal((await h.wait('relay.committed')).audioMs,100);
    assert.equal((await h.wait('upstream')).event.delta,audio);await h.wait('relay.loopback.done');assert.equal(calls,0);
    h.send({type:'end'});assert.match((await h.wait('relay.error')).message,/No recording/);
  }finally{await h.close();}
});
test('missing key is actionable and is never exposed through status',async()=>{
  const h=await harness();try{h.send({type:'start',mode:'openai'});assert.match((await h.wait('relay.error')).message,/API key/);assert.equal(h.relay.status().configured,false);assert.equal('apiKey' in h.relay.status(),false);}finally{await h.close();}
});
test('AI relay forwards append, commit, response and interrupted playback in order; redacts key errors',async()=>{
  const key='sk-test-private-key-do-not-log';let provider;const sent=[];
  class Provider extends EventEmitter{readyState=WebSocket.OPEN;bufferedAmount=0;send(raw){const e=JSON.parse(raw);sent.push(e);if(e.type==='session.update')queueMicrotask(()=>this.emit('message',JSON.stringify({type:'session.updated'})));}close(){this.readyState=WebSocket.CLOSED;this.emit('close');}}
  const h=await harness({initialKey:key,connectUpstream(){provider=new Provider();queueMicrotask(()=>provider.emit('open'));return provider;}});
  try{
    h.send({type:'start',mode:'openai'});await h.wait('relay.ready');h.send({type:'begin'});await h.wait('relay.recording');h.send({type:'audio',audio:Buffer.alloc(4800).toString('base64')});h.send({type:'end'});await h.wait('relay.committed');
    assert.deepEqual(sent.map(e=>e.type),['session.update','input_audio_buffer.clear','input_audio_buffer.append','input_audio_buffer.commit','response.create']);
    provider.emit('message',JSON.stringify({type:'response.created'}));h.send({type:'interrupt',itemId:'item_test',audioEndMs:125});await h.wait('relay.interrupted');assert.ok(sent.some(e=>e.type==='response.cancel'));assert.equal(sent.at(-1).audio_end_ms,125);
    provider.emit('message',JSON.stringify({type:'error',error:{message:'Incorrect key '+key}}));const error=await h.wait('relay.error');assert.equal(error.message.includes(key),false);assert.match(error.message,/redacted/);
  }finally{await h.close();}
});
test('WebSocket upgrade refuses an unrelated browser origin',async()=>{
  const h=await harness();try{const result=await new Promise((resolve,reject)=>{const other=new WebSocket(`ws://127.0.0.1:${h.port}/api/voice/socket`,{origin:'https://untrusted.example'});other.on('unexpected-response',(_,response)=>{response.resume();other.terminate();resolve(response.statusCode);});other.on('error',()=>{});setTimeout(()=>reject(Error('Origin check timed out')),1000).unref();});assert.equal(result,403);}finally{await h.close();}
});
test('a tool call is done on the PC, its result goes back, and the model answers',async()=>{
  let provider;const sent=[],ran=[];
  class Provider extends EventEmitter{readyState=WebSocket.OPEN;bufferedAmount=0;send(raw){const e=JSON.parse(raw);sent.push(e);if(e.type==='session.update')queueMicrotask(()=>this.emit('message',JSON.stringify({type:'session.updated'})));}close(){this.readyState=WebSocket.CLOSED;this.emit('close');}}
  const h=await harness({initialKey:'sk-test-tool-key-0000000000',connectUpstream(){provider=new Provider();queueMicrotask(()=>provider.emit('open'));return provider;},
    getTools:async()=>[{type:'function',name:'control_lights',parameters:{type:'object'}}],runTool:async(name,args)=>{ran.push([name,args]);return 'Kitchen: off.';}});
  try{
    h.send({type:'start',mode:'openai'});await h.wait('relay.ready');
    assert.equal(sent[0].session.tools[0].name,'control_lights');assert.match(sent[0].session.instructions,/Hue/);
    provider.emit('message',JSON.stringify({type:'response.done',response:{output:[{type:'function_call',name:'control_lights',call_id:'call_1',arguments:'{"room":"kitchen","on":false}'}]}}));
    const until=Date.now()+2000;while(sent.at(-1)?.type!=='response.create'&&Date.now()<until)await new Promise(r=>setTimeout(r,5));
    assert.deepEqual(ran,[['control_lights',{room:'kitchen',on:false}]]);
    assert.deepEqual(sent.slice(-2).map(e=>e.type),['conversation.item.create','response.create']);
    assert.deepEqual(sent.at(-2).item,{type:'function_call_output',call_id:'call_1',output:'Kitchen: off.'});
  }finally{await h.close();}
});
