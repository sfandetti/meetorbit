// Light modes for the lights in chosen rooms (or every light): still ones (night, reading, relax), moving ones (party, candle, aurora,
// sunset) and MUSIC, where the lights follow the beat Orbit's visualizer hears. The first change of any kind
// (a mode, a room switched or slid) remembers how the lights were; STOP puts them all back, however much was
// played with in between. Each light gets its own commands (through hue.putLight's queue), so
// colour lights show colour, white-tone lights a matching white, and plain bulbs follow the brightness.
const HUE_RED=0,HUE_ORANGE=5500,HUE_AMBER=8000,HUE_GREEN=25500,HUE_TEAL=33000,HUE_BLUE=44000,HUE_PURPLE=50000,HUE_MAGENTA=56000,HUE_PINK=60000;
const pick=(list,random)=>list[Math.floor(random()*list.length)%list.length];
const between=(lo,hi,random)=>Math.round(lo+(hi-lo)*random());
// One light in a colour (hue 0-65535) at a brightness (1-254): colour lights take the colour; white-tone lights
// the nearest warm or cool white; plain bulbs just the brightness. tt: fade time in tenths of a second.
export function tint(light,hue,bri,tt=4){
  if(light.kind==='color')return {on:true,hue,sat:254,bri,transitiontime:tt};
  const warm=hue<12000||hue>52000;
  return light.kind==='ambiance'?{on:true,ct:warm?454:250,bri,transitiontime:tt}:{on:true,bri,transitiontime:tt};
}
export function white(light,ct,bri){return light.kind==='white'?{on:true,bri,transitiontime:8}:{on:true,ct,bri,transitiontime:8};}
// Still modes: what each light shows.
const STILL={
  night:l=>l.kind==='color'?{on:true,hue:HUE_ORANGE-1500,sat:254,bri:12,transitiontime:20}:white(l,500,4),
  reading:l=>white(l,233,254),
  relax:l=>white(l,447,140),
};
// Moving modes: every `ms` the next light (round the house) gets a new look.
const MOVING={
  party:{ms:350,look:(l,r)=>tint(l,between(0,65535,r),254,2)},
  candle:{ms:140,look:(l,r)=>l.kind==='color'?{on:true,hue:between(HUE_ORANGE,HUE_AMBER,r),sat:between(200,254,r),bri:between(70,200,r),transitiontime:1}:{...white(l,500,between(60,190,r)),transitiontime:1}},
  aurora:{ms:900,look:(l,r)=>tint(l,pick([HUE_GREEN,HUE_TEAL,HUE_BLUE,HUE_PURPLE,HUE_GREEN+3000],r),between(110,210,r),35)},
  sunset:{ms:1300,look:(l,r)=>tint(l,pick([HUE_ORANGE,HUE_RED,HUE_PINK,HUE_MAGENTA,HUE_PURPLE,HUE_AMBER],r),between(140,230,r),30)},
};
export function createHueModes({hue,random=Math.random,every=(fn,ms)=>{const t=setInterval(fn,ms);t.unref?.();return t;},stopEvery=clearInterval,now=Date.now,onChange=()=>{}}){
  let mode='',where=[],saved=new Map(),ran=new Set(),timer=null,turn=0,music={b:0,m:0,h:0,at:-Infinity},beats=0,base=0;
  // The lights the mode runs on: those in the chosen rooms (all of them when none are chosen).
  function targets(){
    const ids=where.length?new Set(hue.rooms().filter(r=>where.includes(r.id)).flatMap(r=>r.lights||[])):null;
    return hue.lights().filter(l=>!ids||ids.has(l.id));
  }
  const usable=()=>targets().filter(l=>l.reachable);
  function next(){const ls=usable();return ls.length?ls[turn++%ls.length]:null;}
  // MUSIC: a beat flashes the next few lights in fresh colours; between beats one light at a time follows the
  // loudness (bass on half the lights, treble on the rest) while the colours drift.
  function musicTick(){
    const ls=usable();if(!ls.length||now()-music.at>3000)return;  // the visualizer stopped: leave the lights be
    if(beats){beats=0;base=(base+9000+between(0,6000,random))%65536;
      for(let i=0;i<Math.min(3,ls.length);i++){const l=next();hue.putLight(l.id,tint(l,(base+i*14000)%65536,254,0));}return;}
    const l=next(),level=turn%2?music.b:music.h;
    hue.putLight(l.id,tint(l,(base+turn*5000)%65536,Math.max(30,Math.round(40+level*214)),1));
  }
  function clear(){if(timer){stopEvery(timer);timer=null;}}
  const api={
    current:()=>mode,
    rooms:()=>[...where],
    // Something to put back: STOP would change the lights.
    changed:()=>saved.size>0,
    // Before a hand change to these lights (room switched or slid): remember them as they are, if not already.
    async remember(lightIds){if(!lightIds.some(id=>!saved.has(id)))return;await hue.refresh();
      for(const l of hue.lights())if(lightIds.includes(l.id)&&!saved.has(l.id))saved.set(l.id,l.state);onChange(mode);},
    // Start a mode in some rooms (room ids; none = every light). Every light it touches is remembered as it
    // was before the first mode; a light left out by a new choice of rooms goes straight back.
    async start(id,rooms=[]){
      if(id==='stop'||!id)return api.stop(true);
      if(!STILL[id]&&!MOVING[id]&&id!=='music')throw Error(`There is no ${id} mode.`);
      await hue.refresh();where=[...new Set((rooms||[]).map(String))].filter(r=>hue.rooms().some(x=>x.id===r));
      // Lights the last mode ran on that the new choice leaves out go back (lights changed by hand stay as they are).
      const now=new Set(targets().map(l=>l.id));
      for(const lid of ran)if(!now.has(lid)&&saved.has(lid)){hue.putLight(lid,{...saved.get(lid),transitiontime:10});saved.delete(lid);}
      ran=now;
      for(const l of targets())if(!saved.has(l.id))saved.set(l.id,l.state);
      clear();mode=id;turn=0;beats=0;
      if(STILL[id])for(const l of usable())hue.putLight(l.id,STILL[id](l));
      else if(MOVING[id]){const m=MOVING[id];for(const l of usable())hue.putLight(l.id,m.look(l,random));timer=every(()=>{const l=next();if(l)hue.putLight(l.id,m.look(l,random));},m.ms);}
      else timer=every(musicTick,100);
      onChange(mode);return `${id[0].toUpperCase()+id.slice(1)} mode is on.`;
    },
    // STOP (restore): end any mode and put every remembered light back as it was. Without restore (a room
    // changed by hand) only the mode ends; what was remembered stays for the next STOP.
    stop(restore=true){
      const was=mode,had=saved.size>0;clear();mode='';where=[];ran=new Set();
      if(restore){for(const [lid,state] of saved)hue.putLight(lid,{...state,transitiontime:10});saved.clear();}
      if(was||(restore&&had))onChange('');
      return restore&&had?'The lights are back to how they were.':was?'The light mode is off.':'Nothing to put back.';
    },
    // Forget the remembered lights (ALL OFF / ALL ON: the new state is the one to keep).
    forget(){const had=saved.size>0;saved.clear();ran=new Set();if(had)onChange(mode);},
    // The visualizer on Orbit: b/m/h loudness 0-1 and whether a beat just landed.
    music({b,m,h,beat}){music={b:+b||0,m:+m||0,h:+h||0,at:now()};if(beat)beats++;},
  };
  return api;
}
