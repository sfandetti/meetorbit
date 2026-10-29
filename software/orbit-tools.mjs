// Voice tools beside the Hue lights: Orbit controls itself (open a screen, rotate, its ring lights) and the
// PC's sound (master volume and the default media player's play/pause/next/previous, through media keys).
import {HOME_SHORTCUTS} from './profile.mjs';

// Screen names the voice can open, from the home shortcut list (plus home). "Lights" means Hue.
export const ORBIT_SCREENS=[{id:0,name:'Home'},...HOME_SHORTCUTS.filter(s=>s.id<200&&s.id!==201)];
const screenKey=name=>String(name).toLowerCase().replace(/[^a-z0-9]/g,'');
export function findScreen(name){const key=screenKey(name);return ORBIT_SCREENS.find(s=>screenKey(s.name)===key)||ORBIT_SCREENS.find(s=>screenKey(s.name).includes(key)||key.includes(screenKey(s.name)));}

export function orbitTool(){
  return {type:'function',name:'control_orbit',
    description:'Control Orbit itself: open one of its screens (games are Orbit Sweep and Orbit Run), turn its picture a quarter turn, or switch its ring lights (the LED ring on Orbit, not the Hue lights) on or off.',
    parameters:{type:'object',properties:{
      action:{type:'string',enum:['open_screen','rotate','ring_lights_on','ring_lights_off']},
      screen:{type:'string',enum:ORBIT_SCREENS.map(s=>s.name),description:'For open_screen: which screen.'}},required:['action'],additionalProperties:false}};
}
export function pcAudioTool(){
  return {type:'function',name:'control_pc_audio',
    description:"Control the sound on the user's PC: the music or video playing in the default player (play/pause, next, previous, stop) and the master volume (set a level, louder, quieter, mute).",
    parameters:{type:'object',properties:{
      action:{type:'string',enum:['play_pause','next','previous','stop','set_volume','louder','quieter','mute']},
      level:{type:'integer',minimum:0,maximum:100,description:'For set_volume: the volume in percent.'}},required:['action'],additionalProperties:false}};
}
// send(obj)->bool reaches Orbit; mediaKey(name) presses a media key; volume(level?)->level reads or sets it.
export async function runOrbitTool(args,{send}){
  const a=args?.action;
  if(a==='open_screen'){const s=findScreen(args.screen||'');if(!s)return `Orbit has no screen called ${args.screen}.`;
    return send({type:'feed',screen:String(s.id)})?`Opened ${s.name} on Orbit.`:'Orbit is not connected.';}
  const what={rotate:'rotate',ring_lights_on:'ring-on',ring_lights_off:'ring-off'}[a];if(!what)return 'Unknown Orbit action.';
  return send({type:'orbit-do',action:what})?{rotate:'Turned the picture.','ring-on':'Ring lights on.','ring-off':'Ring lights off.'}[what]:'Orbit is not connected.';
}
export async function runPcAudioTool(args,{mediaKey,volume}){
  const a=args?.action;
  if(a==='set_volume'){const level=Number(args.level);if(!Number.isFinite(level))return 'Say what volume, 0 to 100.';return `Volume is ${await volume(Math.max(0,Math.min(100,Math.round(level))))} percent.`;}
  // Media keys move the volume about 2 percent a press: louder and quieter step it 10 percent instead.
  if(a==='louder'||a==='quieter'){const now=await volume();return `Volume is ${await volume(Math.max(0,Math.min(100,now+(a==='louder'?10:-10))))} percent.`;}
  const key={play_pause:'play',next:'next',previous:'previous',stop:'stop',mute:'mute'}[a];if(!key)return 'Unknown audio action.';
  await mediaKey(key);return {play:'Pressed play/pause.',next:'Skipped to the next track.',previous:'Went back a track.',stop:'Stopped the music.',mute:'Toggled mute.'}[key];
}
