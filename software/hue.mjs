// Philips Hue: this PC talks to the Hue Bridge on the home network (the bridge's local API, plain HTTP on
// the LAN). Pairing needs the round button on top of the bridge pressed; the bridge then gives this PC its
// own app key, saved encrypted with the AI keys (secret "hue_key"). Orbit's HUE LIGHTS page and the AI
// voice both control the lights through here.
import {readFile,writeFile} from 'node:fs/promises';

// Colours the voice (and anyone else) can ask for: CIE xy points in Hue's gamut, or a white temperature (ct, mireds).
export const HUE_COLORS={
  red:{xy:[0.675,0.322]},orange:{xy:[0.58,0.39]},yellow:{xy:[0.5,0.45]},green:{xy:[0.2,0.7]},teal:{xy:[0.17,0.35]},
  cyan:{xy:[0.16,0.25]},blue:{xy:[0.167,0.04]},purple:{xy:[0.27,0.11]},violet:{xy:[0.25,0.1]},pink:{xy:[0.45,0.22]},
  magenta:{xy:[0.38,0.16]},white:{ct:300},'warm white':{ct:450},warm:{ct:450},'cool white':{ct:200},cool:{ct:200},daylight:{ct:180},
};
const words=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|lights?|lamps?|room)\b/g,' ').replace(/\s+/g,' ').trim();
// The best match for a spoken name among {name} items: exact, then contains, then shares a word.
export function matchName(list,spoken){
  const want=words(spoken);if(!want)return null;
  return list.find(x=>words(x.name)===want)||list.find(x=>words(x.name).includes(want)||want.includes(words(x.name)))
    ||list.find(x=>words(x.name).split(' ').some(w=>w.length>2&&want.split(' ').includes(w)))||null;
}
// What one request changes on a group: {on, brightness 0-100, color name}. Brightness or a colour turns it on.
export function groupAction({on,brightness,color}={}){
  const action={};
  if(typeof on==='boolean')action.on=on;
  if(Number.isFinite(Number(brightness))&&brightness!==null&&brightness!==''){const b=Math.max(0,Math.min(100,Math.round(Number(brightness))));
    if(b===0)action.on=false;else{action.on=true;action.bri=Math.max(1,Math.round(b*254/100));}}
  if(color){const c=HUE_COLORS[String(color).toLowerCase().trim()];if(!c)throw Error(`Hue has no colour called ${color}. Try ${Object.keys(HUE_COLORS).slice(0,11).join(', ')}.`);Object.assign(action,c);if(action.on!==false)action.on=true;}
  return action;
}
// The Hue Bridges on this network, from Philips' discovery service: [{id, ip}].
export async function findBridges({fetcher=fetch}={}){
  const r=await fetcher('https://discovery.meethue.com/',{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(`Hue discovery answered ${r.status}.`);
  return (await r.json()).filter(b=>/^[0-9.]{7,15}$/.test(b.internalipaddress||'')).map(b=>({id:String(b.id||''),ip:b.internalipaddress}));
}
// What a light can show: colour (hue/sat), white tones (ct) or brightness only.
export function lightKind(type){return /color light/i.test(type||'')?'color':/temperature/i.test(type||'')?'ambiance':'white';}
// A light's state as it is now, in a form that can be sent back to put it exactly like this again.
export function restorable(state={}){
  const out={on:!!state.on};if(state.bri)out.bri=state.bri;
  if(state.colormode==='xy'&&state.xy)out.xy=state.xy;else if(state.colormode==='ct'&&state.ct)out.ct=state.ct;
  else if(state.colormode==='hs'&&state.hue!==undefined){out.hue=state.hue;out.sat=state.sat;}
  return out;
}
// file: where the bridge's address is kept. getKey/setKey: the saved app key. lightGap: ms between single-light
// commands (the bridge handles about ten a second; more and it starts dropping them).
export async function createHue({file,getKey,setKey,fetcher=fetch,deviceName='orbit',lightGap=110}){
  let bridge=null;try{bridge=JSON.parse(await readFile(file,'utf8'));}catch{}
  let rooms=[],scenes=[],lights=[],error='',readAt=0;
  // Single-light changes wait their turn; a newer change for a light replaces one still waiting.
  const queue=new Map();let pumping=false;
  function pump(){
    const next=queue.entries().next().value;if(!next){pumping=false;return;}pumping=true;
    const [id,state]=next;queue.delete(id);call('PUT',authed(`/lights/${id}/state`),state).catch(()=>{});
    const t=setTimeout(pump,lightGap);t.unref?.();
  }
  const base=()=>{if(!bridge?.ip)throw Error('No Hue Bridge yet. Click Find bridge.');return `http://${bridge.ip}/api`;};
  async function call(method,path,body){
    const r=await fetcher(base()+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(6000)});
    const data=await r.json();const fail=[data].flat().find(x=>x?.error)?.error;
    if(fail){if(fail.type===1){error='The Hue Bridge no longer knows this PC. Pair again.';}throw Object.assign(Error(fail.description||'Hue Bridge error'),{hueType:fail.type});}
    return data;
  }
  const authed=path=>{const key=getKey();if(!key)throw Error('Pair with the Hue Bridge first.');return `/${key}${path}`;};
  // Rooms and zones (lights grouped in the Hue app), and the scenes saved for them.
  async function refresh(){
    const [groups,sc,ls]=await Promise.all([call('GET',authed('/groups')),call('GET',authed('/scenes')),call('GET',authed('/lights'))]);
    lights=Object.entries(ls).map(([id,l])=>({id,name:l.name,kind:lightKind(l.type),reachable:l.state?.reachable!==false,state:restorable(l.state)}));
    rooms=Object.entries(groups).filter(([,g])=>['Room','Zone'].includes(g.type)).map(([id,g])=>({id,name:g.name,type:g.type,lights:(g.lights||[]).map(String),on:!!g.state?.any_on,bri:Math.max(1,Math.round((g.action?.bri||0)*100/254))}))
      .sort((a,b)=>(a.type===b.type?a.name.localeCompare(b.name):a.type==='Room'?-1:1));
    scenes=Object.entries(sc).filter(([,s])=>s.type==='GroupScene').map(([id,s])=>({id,name:s.name,group:s.group}));
    error='';readAt=Date.now();return rooms;
  }
  async function fresh(){if(Date.now()-readAt>3000)await refresh();}
  async function setGroup(id,action){await call('PUT',authed(`/groups/${id}/action`),action);readAt=0;}
  return {
    status:()=>({bridge:bridge?{ip:bridge.ip,name:bridge.name||'Hue Bridge'}:null,paired:!!getKey(),rooms,error}),
    // Find the bridge on the network and remember it.
    async find(){
      const [first]=await findBridges({fetcher});if(!first)throw Error('No Hue Bridge found on this network. Is it plugged in and online?');
      bridge={ip:first.ip,id:first.id};
      try{const c=await call('GET','/0/config');bridge.name=c.name||'Hue Bridge';}catch{}
      await writeFile(file,JSON.stringify(bridge),{mode:0o600});return this.status();
    },
    // Ask the bridge for an app key. Works for 30 seconds after its round button is pressed.
    async pair(){
      const [answer]=await call('POST','',{devicetype:`orbit#${String(deviceName).replace(/[^\w-]/g,'').slice(0,19)||'pc'}`}).catch(e=>{if(e.hueType===101)throw Error('Press the round button on top of the Hue Bridge, then click Pair within 30 seconds.');throw e;});
      const key=answer?.success?.username;if(!key)throw Error('The Hue Bridge did not give a key.');
      await setKey(key);await refresh();return this.status();
    },
    async forget(){await setKey('');rooms=[];scenes=[];return this.status();},
    refresh,
    rooms:()=>rooms,
    lights:()=>lights,
    putLight(id,state){queue.set(String(id),state);if(!pumping)pump();},
    // A room's brightness from Orbit's slider (0 turns it off).
    async brightness(id,percent){await setGroup(String(id),groupAction({brightness:percent}));await refresh();return rooms;},
    // Orbit's tiles: switch one room or zone, or every light (id "0").
    async toggle(id,on){await setGroup(String(id),{on:!!on});await refresh();return rooms;},
    // One spoken request: {room, on, brightness, color, scene}. Returns a short sentence of what happened.
    async control({room,on,brightness,color,scene}={}){
      await fresh();
      let target={id:'0',name:'all the lights'};
      if(room&&!/^(all|every|house|home|everything|everywhere)/i.test(words(room)||'all')){const r=matchName(rooms,room);if(!r)throw Error(`There is no Hue room called ${room}. Rooms: ${rooms.map(r=>r.name).join(', ')||'none'}.`);target=r;}
      if(scene){
        const inRoom=scenes.filter(s=>target.id==='0'||s.group===target.id),s=matchName(inRoom,scene)||matchName(scenes,scene);
        if(!s)throw Error(`There is no Hue scene called ${scene}.`);
        await setGroup(s.group,{scene:s.id,...(brightness!==undefined&&brightness!==null?{bri:Math.max(1,Math.round(Number(brightness)*254/100))}:{})});
        await refresh();return `Set ${s.name} in ${rooms.find(r=>r.id===s.group)?.name||'the room'}.`;
      }
      const action=groupAction({on,brightness,color});if(!Object.keys(action).length)throw Error('Say what to change: on, off, a brightness, a colour or a scene.');
      await setGroup(target.id,action);await refresh();
      return `${target.name}: ${action.on===false?'off':[action.on?'on':'',action.bri?`${Math.round(action.bri*100/254)}%`:'',color||''].filter(Boolean).join(', ')}.`;
    },
    // What the AI is told: the rooms and scenes it can use.
    describe(){return rooms.length?`Rooms: ${rooms.map(r=>`${r.name} (${r.on?'on':'off'})`).join(', ')}. Scenes: ${[...new Set(scenes.map(s=>s.name))].slice(0,30).join(', ')||'none'}.`:'';},
  };
}
// Orbit's light modes (hue-modes.mjs runs them).
export const HUE_MODES=[{id:'music',name:'Music link'},{id:'party',name:'Party'},{id:'candle',name:'Candle'},{id:'aurora',name:'Aurora'},
  {id:'sunset',name:'Sunset'},{id:'night',name:'Night'},{id:'reading',name:'Reading'},{id:'relax',name:'Relax'}];
// The tool the realtime voice gets once Hue is paired.
export function hueTool(describe=''){
  return {type:'function',name:'control_lights',
    description:`Control the Philips Hue lights in the user's home: on or off, brightness, colour or a saved scene. Leave room out for every light. ${describe}`.trim().slice(0,1000),
    parameters:{type:'object',properties:{
      room:{type:'string',description:'Room or zone name, e.g. "living room". Omit for all lights. With mode, the room the mode runs in.'},
      on:{type:'boolean',description:'true turns on, false turns off.'},
      brightness:{type:'integer',minimum:0,maximum:100,description:'Brightness in percent.'},
      color:{type:'string',enum:Object.keys(HUE_COLORS)},
      scene:{type:'string',description:'Name of a saved Hue scene.'},
      mode:{type:'string',enum:[...HUE_MODES.map(m=>m.id),'stop'],description:'A light mode: music (the lights follow the music Orbit hears), party, candle, aurora, sunset, night, reading or relax. stop puts every light back as it was before the user started changing them.'}},additionalProperties:false}};
}
// What Orbit's HUE LIGHTS page shows: up to 6 rooms as i/t/o/b (id, name, on, brightness %), the running
// mode and a note.
export function hueMessage(status,mode='',modeRooms=[],changed=false){
  const out={type:'hue',n:'0',note:'',mode,mr:modeRooms.join(','),chg:changed?'1':''};
  if(!status.bridge)out.note='Set up Hue in the Orbit console on your PC.';
  else if(!status.paired)out.note='Pair the Hue Bridge in the Orbit console.';
  else if(status.error)out.note=status.error.slice(0,60);
  const list=status.paired?status.rooms.slice(0,6):[];out.n=String(list.length);
  list.forEach((r,i)=>{out['i'+i]=r.id;out['t'+i]=r.name.slice(0,18);out['o'+i]=r.on?'1':'0';out['b'+i]=String(r.bri);});
  return out;
}
