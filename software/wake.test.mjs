import test from 'node:test';
import assert from 'node:assert/strict';
import {heardWakePhrase,initWake} from './wake.mjs';
function fixture(supported=true){const callbacks={},events=[],instances=[],timers=new Map();let counter=0;const toggle={checked:false,disabled:false,addEventListener(t,f){this[t]=f;}},status={textContent:''};
 class Recognition{constructor(){instances.push(this);}start(){this.onstart?.();}abort(){this.onend?.();}}
 const doc={hidden:false,getElementById:id=>id==='wakeEnabled'?toggle:status,querySelector:()=>({getAttribute:()=> 'true'}),addEventListener:(t,f)=>callbacks[t]=f,dispatchEvent:e=>events.push(e)};
 const win={...(supported?{SpeechRecognition:Recognition}:{}),CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},addEventListener:(t,f)=>callbacks[t]=f};
 initWake({window:win,document:doc,delay:f=>{const id=++counter;timers.set(id,f);return id;},cancel:id=>timers.delete(id)});return {toggle,status,callbacks,events,instances,doc,timers};
}
test('wake phrase needs Hey Orbit, not an incidental mention of orbit',()=>{assert.equal(heardWakePhrase('hey, Orbit!'),true);assert.equal(heardWakePhrase('the orbit is circular'),false);assert.equal(heardWakePhrase('they orbit'),false);});
test('wake listening is opt-in and dispatches only after recognition releases the microphone',()=>{const f=fixture();assert.equal(f.instances.length,0);f.toggle.checked=true;f.toggle.change();assert.equal(f.instances.length,1);f.instances[0].onresult({resultIndex:0,results:[Object.assign([{transcript:'Hey Orbit'}],{isFinal:true})]});assert.equal(f.events[0].type,'orbit-wake-voice');assert.equal(f.events[0].detail.terminal,true);});
test('busy turns and hidden tabs pause wake capture, and turning it off stops restarts',()=>{const f=fixture();f.toggle.checked=true;f.toggle.change();f.callbacks['orbit-voice-activity']({detail:true});assert.match(f.status.textContent,/paused/);f.callbacks['orbit-voice-activity']({detail:false});assert.ok(f.timers.size);f.doc.hidden=true;f.callbacks.visibilitychange();assert.equal(f.timers.size,0);f.toggle.checked=false;f.toggle.change();assert.match(f.status.textContent,/off/);assert.equal(f.timers.size,0);});
test('unsupported browser clearly disables wake phrases rather than pretending to listen',()=>{const f=fixture(false);assert.equal(f.toggle.disabled,true);assert.match(f.status.textContent,/unavailable/);assert.equal(f.instances.length,0);});
