import test from 'node:test';
import assert from 'node:assert/strict';
import {initVoice} from './voice.mjs';

test('Companion starts voice without Voice lab and its hold button sends held audio',async()=>{
  class Element {
    listeners={};style={};value='';textContent='';disabled=false;open=false;
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    async fire(type,event={}){for(const fn of this.listeners[type]||[])await fn({preventDefault(){},button:0,pointerId:1,...event});}
    setAttribute(){} setPointerCapture(){} focus(){} add(){} showModal(){this.open=true;} close(){this.open=false;}
  }
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  let socket,processor,track={enabled:false,stop(){}};
  class Socket {
    static OPEN=1;readyState=1;bufferedAmount=0;sent=[];
    constructor(){socket=this;queueMicrotask(()=>this.onopen?.());}
    send(raw){const event=JSON.parse(raw);this.sent.push(event);if(event.type==='start')queueMicrotask(()=>this.onmessage({data:JSON.stringify({type:'relay.ready'})}));}
    close(){}
  }
  class Context {
    sampleRate=24000;state='running';currentTime=0;audioWorklet={async addModule(){}};destination={};
    async resume(){} createMediaStreamSource(){return {connect(){},disconnect(){}};}
  }
  class Worklet {
    constructor(){processor=this;this.port={postMessage:type=>{if(type==='stop')queueMicrotask(()=>this.port.onmessage({data:{type:'stopped'}}));}};}
    connect(){} disconnect(){}
  }
  let sharedKey=true,active=0;const windowEvents={},documentEvents={},dispatched=[];
  const saved=new Map();const globals={document:{getElementById:get,addEventListener(type,fn){documentEvents[type]=fn;},dispatchEvent(e){dispatched.push(e);}},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail;}},window:{AudioWorkletNode:Worklet,addEventListener(type,fn){windowEvents[type]=fn;}},navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[track]};}}},location:{protocol:'http:',host:'127.0.0.1:8787'},WebSocket:Socket,AudioContext:Context,AudioWorkletNode:Worklet,Option:class {},fetch:async()=>({ok:true,json:async()=>({configured:sharedKey,active,defaults:{model:'test-model',voice:'test'},voices:['test'],instructions:'Test'})})};
  for(const [name,value]of Object.entries(globals)){saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});}
  let voice;const states=[];
  try{
    voice=initVoice({onState:state=>states.push(state)});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(get('talk').disabled,false);assert.equal(get('talk').textContent,'Start voice');
    assert.match(get('companionCredentialStatus').textContent,/saved for this computer session/);assert.equal(get('companionKeyLabel').hidden,true);
    await get('talk').fire('click');await new Promise(resolve=>setImmediate(resolve));assert.equal(voice.connected,true);assert.equal(get('companionVoiceDialog').open,false);
    get('companionVoiceMode').value='openai';await get('companionVoiceStart').fire('click');await new Promise(resolve=>setImmediate(resolve));
    assert.equal(voice.connected,true);assert.equal(get('companionVoiceDialog').open,false);assert.equal(get('talk').textContent,'Hold to talk');
    await get('talk').fire('pointerdown');await new Promise(resolve=>setImmediate(resolve));
    assert.equal(track.enabled,true);processor.port.onmessage({data:{type:'audio',buffer:new ArrayBuffer(9600)}});
    await get('talk').fire('pointerup');await new Promise(resolve=>setImmediate(resolve));
    assert.equal(track.enabled,false);assert.deepEqual(socket.sent.filter(e=>['begin','audio','end'].includes(e.type)).map(e=>e.type),['begin','audio','end']);
    assert.ok(states.includes('listening'));assert.ok(states.includes('thinking'));
    socket.onmessage({data:JSON.stringify({type:'upstream',event:{type:'conversation.item.input_audio_transcription.completed',transcript:'Please continue the project'}})});
    assert.equal(dispatched.at(-1).type,'orbit-voice-transcript');assert.equal(dispatched.at(-1).detail,'Please continue the project');assert.equal(socket.sent.some(e=>e.type==='command'),false,'spoken text is a reviewable draft, never an automatic command');
    socket.onmessage({data:JSON.stringify({type:'upstream',event:{type:'response.output_audio_transcript.done',transcript:'Hello from Orbit'}})});
    assert.equal(get('voiceAssistant').textContent,'Hello from Orbit');assert.ok(states.includes('speaking'));
    await documentEvents['orbit-terminal-mic']();assert.equal(track.enabled,true);assert.equal(socket.sent.findLast(e=>e.type==='begin').transcriptionOnly,true);
    processor.port.onmessage({data:{type:'audio',buffer:new ArrayBuffer(9600)}});await documentEvents['orbit-terminal-mic']();assert.equal(track.enabled,false);
    const speakingBefore=states.filter(s=>s==='speaking').length;socket.onmessage({data:JSON.stringify({type:'upstream',event:{type:'response.output_audio_transcript.done',transcript:'Must not speak in terminal'}})});assert.equal(states.filter(s=>s==='speaking').length,speakingBefore);
    socket.onmessage({data:JSON.stringify({type:'upstream',event:{type:'conversation.item.input_audio_transcription.completed',transcript:'Terminal command draft'}})});assert.equal(dispatched.findLast(e=>e.type==='orbit-terminal-transcript').detail,'Terminal command draft');assert.equal(dispatched.findLast(e=>e.type==='orbit-terminal-mic-state').detail.stage,'idle');
    await get('talk').fire('pointerdown');assert.equal(socket.sent.findLast(e=>e.type==='begin').transcriptionOnly,undefined,'normal companion voice is restored after dictation');documentEvents['orbit-terminal-mic-cancel']();voice.stop();
    voice.disconnect();sharedKey=false;await windowEvents.focus();assert.match(get('companionCredentialStatus').textContent,/No API key saved/);assert.equal(get('companionKeyLabel').hidden,false);
    sharedKey=true;await windowEvents.focus();assert.equal(get('companionKeyLabel').hidden,true);assert.match(get('voiceCredentialStatus').textContent,/shared across Orbit browsers/);
    active=1;await get('companionVoiceStart').fire('click');assert.equal(voice.connected,false);assert.match(get('companionConnectStatus').textContent,/Another Orbit window is using voice/);
    active=0;await get('companionVoiceStart').fire('click');await new Promise(resolve=>setImmediate(resolve));assert.equal(voice.connected,true);
    await windowEvents.blur();assert.equal(voice.connected,false);assert.equal(track.enabled,false);assert.match(get('companionConnectStatus').textContent,/Voice released for another window/);assert.match(get('companionCredentialStatus').textContent,/API key saved/);
    navigator.permissions={query:async()=>({state:'granted'})};await windowEvents.focus();await new Promise(resolve=>setImmediate(resolve));assert.equal(voice.connected,true,'an already-authorized browser reconnects on focus without reopening setup');
  }finally{
    voice?.disconnect();for(const [name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
  }
});
