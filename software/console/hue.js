// Philips Hue card on the Lights page: find the bridge, pair it (after its round button is pressed),
// then switch rooms here, on Orbit's HUE LIGHTS page, or by asking Orbit's voice.
import {api,action,notice,element} from './app.js';
const $=id=>document.getElementById(id);
function render(s){
  $('hue-status').textContent=!s.bridge?'No Hue Bridge yet. Click Find bridge.':!s.paired?`Found ${s.bridge.name} at ${s.bridge.ip}. Press the round button on top of the bridge, then click Pair within 30 seconds.`
    :s.error||`Paired with ${s.bridge.name}. Tap a room to switch it. Orbit's voice can change them too: "turn the kitchen blue".`;
  $('hue-pair').hidden=!s.bridge||s.paired;$('hue-forget').hidden=!s.paired;$('hue-find').textContent=s.bridge?'Find again':'Find bridge';
  $('hue-rooms').replaceChildren(...(s.paired?s.rooms:[]).map(r=>{const b=element('button',`${r.name} · ${r.on?'On':'Off'}`,r.on?'primary':'');
    b.onclick=()=>action(b,async()=>render(await api('hue/room',{id:r.id,on:!r.on})));return b;}));
  // Modes for every light. Music link follows the music while Orbit's VE visualizer runs. Stop puts the lights back.
  $('hue-modes-title').hidden=!s.paired;
  $('hue-modes').replaceChildren(...(s.paired?[...MODES,['stop','Stop']]:[]).map(([id,name])=>{const b=element('button',name,s.mode===id?'primary':'');
    b.onclick=()=>action(b,async()=>render(await api('hue/mode',{mode:s.mode===id?'stop':id})));return b;}));
}
const MODES=[['music','Music link'],['party','Party'],['candle','Candle'],['aurora','Aurora'],['sunset','Sunset'],['night','Night'],['reading','Reading'],['relax','Relax']];
export function initHue(){
  const load=()=>api('hue').then(render).catch(()=>{});
  $('hue-find').onclick=()=>action($('hue-find'),async()=>{render(await api('hue/find',{}));notice('Hue Bridge found.');});
  $('hue-pair').onclick=()=>action($('hue-pair'),async()=>{render(await api('hue/pair',{}));notice('Paired with Hue. Orbit can control your lights now.');});
  $('hue-forget').onclick=()=>action($('hue-forget'),async()=>{render(await api('hue/forget',{}));notice('Hue forgotten on this PC.');});
  load();setInterval(()=>{if($('lights').classList.contains('active'))load();},5000);
}
