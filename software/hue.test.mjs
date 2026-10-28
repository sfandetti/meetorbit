import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {matchName,groupAction,hueMessage,hueTool,createHue} from './hue.mjs';

test('spoken room names find the right room',()=>{
  const rooms=[{name:'Living room'},{name:'Kitchen'},{name:'Master Bedroom'}];
  assert.equal(matchName(rooms,'the kitchen lights').name,'Kitchen');
  assert.equal(matchName(rooms,'living room').name,'Living room');
  assert.equal(matchName(rooms,'bedroom').name,'Master Bedroom');
  assert.equal(matchName(rooms,'garage'),null);
});

test('a request becomes a Hue group action',()=>{
  assert.deepEqual(groupAction({on:false}),{on:false});
  assert.deepEqual(groupAction({brightness:50}),{on:true,bri:127});
  assert.deepEqual(groupAction({brightness:0}),{on:false});
  assert.deepEqual(groupAction({color:'Blue'}),{xy:[0.167,0.04],on:true});
  assert.deepEqual(groupAction({color:'warm white',brightness:30}),{on:true,bri:76,ct:450});
  assert.throws(()=>groupAction({color:'plaid'}),/no colour called plaid/);
});

test("Orbit's page gets up to six rooms, or a note saying what to do",()=>{
  assert.equal(hueMessage({bridge:null,paired:false,rooms:[]}).note,'Set up Hue in the Orbit console on your PC.');
  const m=hueMessage({bridge:{ip:'1.2.3.4'},paired:true,rooms:Array.from({length:8},(_,i)=>({id:String(i+1),name:'Room '+i,on:i===0}))});
  assert.equal(m.n,'6');assert.equal(m.t0,'Room 0');assert.equal(m.o0,'1');assert.equal(m.o1,'0');assert.equal(m.i5,'6');
  assert.equal(hueTool('Rooms: Kitchen.').name,'control_lights');
});

// A pretend bridge: two rooms and a scene, recording every change.
function fakeBridge(){
  const changes=[];let pressed=false;
  const groups={1:{name:'Kitchen',type:'Room',state:{any_on:true},action:{bri:254}},2:{name:'Living room',type:'Room',state:{any_on:false},action:{bri:100}},9:{name:'Lightset',type:'Entertainment',state:{},action:{}}};
  const reply=data=>new Response(JSON.stringify(data));
  const fetcher=async(url,options={})=>{
    const u=new URL(url),method=options.method||'GET';
    if(u.hostname==='discovery.meethue.com')return reply([{id:'abc',internalipaddress:'10.0.0.9'}]);
    if(u.pathname==='/api/0/config')return reply({name:'Test bridge'});
    if(u.pathname==='/api'&&method==='POST')return reply(pressed?[{success:{username:'app-key'}}]:[{error:{type:101,description:'link button not pressed'}}]);
    if(u.pathname==='/api/app-key/groups')return reply(groups);
    if(u.pathname==='/api/app-key/lights')return reply({5:{name:'Lamp',type:'Extended color light',state:{on:true,bri:100,colormode:'ct',ct:300,reachable:true}}});
    if(u.pathname==='/api/app-key/scenes')return reply({s1:{name:'Relax',type:'GroupScene',group:'2'}});
    const m=u.pathname.match(/^\/api\/app-key\/groups\/(\d+)\/action$/);
    if(m&&method==='PUT'){const body=JSON.parse(options.body);changes.push([m[1],body]);if(groups[m[1]]&&'on' in body)groups[m[1]].state.any_on=body.on;return reply([{success:{}}]);}
    return reply([{error:{type:3,description:'not found'}}]);
  };
  return {fetcher,changes,press(){pressed=true;}};
}

test('find, pair (only after the button), then control rooms and scenes',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'hue-'));let key='';const bridge=fakeBridge();
  const hue=await createHue({file:path.join(dir,'hue.json'),getKey:()=>key,setKey:async k=>{key=k;},fetcher:bridge.fetcher});
  assert.equal((await hue.find()).bridge.name,'Test bridge');
  await assert.rejects(hue.pair(),/Press the round button/);
  bridge.press();const s=await hue.pair();
  assert.equal(key,'app-key');assert.deepEqual(s.rooms.map(r=>r.name),['Kitchen','Living room']);  // the entertainment area is left out
  assert.equal(await hue.control({room:'kitchen',on:false}),'Kitchen: off.');
  assert.deepEqual(bridge.changes.at(-1),['1',{on:false}]);
  assert.match(await hue.control({color:'red'}),/all the lights: on, red/);assert.equal(bridge.changes.at(-1)[0],'0');
  assert.equal(await hue.control({scene:'relax'}),'Set Relax in Living room.');assert.deepEqual(bridge.changes.at(-1),['2',{scene:'s1'}]);
  await assert.rejects(hue.control({room:'garage',on:true}),/no Hue room called garage/);
  await hue.toggle('2',false);assert.deepEqual(bridge.changes.at(-1),['2',{on:false}]);
  assert.match(hue.describe(),/Kitchen \(off\).*Scenes: Relax/);
  await hue.forget();assert.equal(key,'');
});

import {createHueModes,tint} from './hue-modes.mjs';
import {restorable,lightKind} from './hue.mjs';
// A pretend hue with three lights (colour, white tones, plain) recording what each light was told.
function fakeHue(){
  const sent=[];const lights=[{id:'1',kind:'color',reachable:true,state:{on:true,bri:200,xy:[0.4,0.4]}},{id:'2',kind:'ambiance',reachable:true,state:{on:false,bri:100,ct:300}},
    {id:'3',kind:'white',reachable:true,state:{on:true,bri:50}},{id:'4',kind:'color',reachable:false,state:{on:false}}];
  const rooms=[{id:'10',name:'Office',lights:['1','2']},{id:'11',name:'Hall',lights:['3']}];
  return {sent,lights:()=>lights,rooms:()=>rooms,refresh:async()=>{},putLight:(id,state)=>sent.push([id,state])};
}
function fakeTimers(){let fn=null;return {every:(f)=>{fn=f;return 1;},stopEvery:()=>{fn=null;},tick:()=>fn?.(),running:()=>!!fn};}

test('lights are sorted by what they can show, and their state can be put back',()=>{
  assert.equal(lightKind('Extended color light'),'color');assert.equal(lightKind('Color temperature light'),'ambiance');assert.equal(lightKind('Dimmable light'),'white');
  assert.deepEqual(restorable({on:true,bri:120,colormode:'xy',xy:[0.3,0.3],ct:200,hue:5}),{on:true,bri:120,xy:[0.3,0.3]});
  assert.deepEqual(tint({kind:'color'},1000,200,0),{on:true,hue:1000,sat:254,bri:200,transitiontime:0});
  assert.deepEqual(tint({kind:'ambiance'},44000,200),{on:true,ct:250,bri:200,transitiontime:4});
});

test('a still mode sets every reachable light, and STOP puts them back',async()=>{
  const hue=fakeHue(),t=fakeTimers();let changed=[];const modes=createHueModes({hue,...t,onChange:m=>changed.push(m)});
  assert.equal(await modes.start('reading'),'Reading mode is on.');
  assert.deepEqual(hue.sent.map(s=>s[0]),['1','2','3']);  // light 4 is unreachable
  assert.equal(hue.sent[0][1].ct,233);assert.equal(hue.sent[2][1].ct,undefined);
  await modes.start('night');hue.sent.length=0;  // a second mode keeps the original lights to go back to
  assert.equal(modes.stop(),'The lights are back to how they were.');
  assert.deepEqual(hue.sent.map(s=>[s[0],s[1].bri,s[1].on]),[['1',200,true],['2',100,false],['3',50,true],['4',undefined,false]]);
  assert.deepEqual(changed,['reading','night','']);assert.equal(modes.current(),'');
  await assert.rejects(modes.start('disco'),/no disco mode/);
});

test('moving modes keep changing one light at a time',async()=>{
  const hue=fakeHue(),t=fakeTimers();const modes=createHueModes({hue,...t,random:()=>0.5});
  await modes.start('party');hue.sent.length=0;t.tick();t.tick();t.tick();t.tick();
  assert.deepEqual(hue.sent.map(s=>s[0]),['1','2','3','1']);
  modes.stop(false);assert.equal(t.running(),false);
});

test('music: a beat flashes lights, quiet stretches follow the loudness, and it rests when the visualizer stops',async()=>{
  const hue=fakeHue(),t=fakeTimers();let clock=1000;const modes=createHueModes({hue,...t,random:()=>0,now:()=>clock});
  await modes.start('music');hue.sent.length=0;
  t.tick();assert.equal(hue.sent.length,0);  // nothing heard yet
  modes.music({b:0.9,m:0.2,h:0.1,beat:1});t.tick();
  assert.equal(hue.sent.length,3);assert.ok(hue.sent.every(([,s])=>s.bri===254&&s.transitiontime===0));
  hue.sent.length=0;modes.music({b:0.5,m:0.5,h:0.5,beat:0});t.tick();assert.equal(hue.sent.length,1);assert.equal(hue.sent[0][1].bri,147);
  clock+=4000;hue.sent.length=0;t.tick();assert.equal(hue.sent.length,0);
});

test('a mode can run in chosen rooms, and changing rooms puts the left-out lights back',async()=>{
  const hue=fakeHue(),t=fakeTimers();const modes=createHueModes({hue,...t});
  await modes.start('relax',['10']);assert.deepEqual(hue.sent.map(s=>s[0]),['1','2']);assert.deepEqual(modes.rooms(),['10']);
  hue.sent.length=0;await modes.start('relax',['11']);
  assert.deepEqual(hue.sent.map(s=>[s[0],s[1].bri]),[['1',200],['2',100],['3',140]]);  // office lights go back, the hall gets relax
  hue.sent.length=0;modes.stop();assert.deepEqual(hue.sent.map(s=>s[0]),['3']);assert.deepEqual(modes.rooms(),[]);
  hue.sent.length=0;await modes.start('night',['99']);assert.equal(hue.sent.length,3);  // an unknown room means every light
});

test('STOP puts back everything played with: hand changes and modes alike',async()=>{
  const hue=fakeHue(),t=fakeTimers();const modes=createHueModes({hue,...t});
  assert.equal(modes.changed(),false);
  await modes.remember(['3']);assert.equal(modes.changed(),true);  // the hall switched by hand
  await modes.start('party',['10']);modes.stop(false);  // a party in the office, then a slider moved: the mode ends, the memory stays
  assert.equal(modes.changed(),true);hue.sent.length=0;
  assert.equal(modes.stop(),'The lights are back to how they were.');
  assert.deepEqual(hue.sent.map(s=>s[0]).sort(),['1','2','3']);assert.equal(modes.changed(),false);
  assert.equal(modes.stop(),'Nothing to put back.');
});
