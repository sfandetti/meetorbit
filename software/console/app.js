import {initCodex,codexVisible} from './codex.js';
import {initSentry,sentryPoll} from './sentry.js';
import {initHue} from './hue.js';
const $=id=>document.getElementById(id);
let state=null,profile={},inventory={apps:[],cameras:[],ports:[]},dirty=false,busy=false,ledsEditedAt=0,volumeEditedAt=0,pairUntil=0;
const packs=[{"name":"Office","card":"#ffffff","line":"#a5b4c5","ink":"#152b44","muted":"#4c6075","colors":["#146a8c","#7943a6","#13795b","#9b5a08","#3455a5"],"desc":"Corporate precision / cool paper / structured type","font":"Office","backgrounds":["#edf2f7","#f1edf7","#ebf5ef","#f7f0e6","#edf0fa"]},{"name":"Retro","card":"#142b20","line":"#427752","ink":"#d4ffc0","muted":"#92bc7d","colors":["#a6f56b","#ffb454","#59d1b0","#ff795d","#e4db7b"],"desc":"Pixel lettering / phosphor green / warm arcade colors","font":"Retro","backgrounds":["#0b1b14","#24180b","#092323","#29110e","#252309"]},{"name":"Cyberpunk","card":"#270c27","line":"#ff76c7","ink":"#fff2fc","muted":"#ffc2e8","colors":["#ff80cd","#57f3ff","#d7ff47","#ffe65c","#bd96ff"],"desc":"Hot-pink world / cyan signals / angular condensed type","font":"Cyber","backgrounds":["#8c1554","#0a4354","#314b06","#552509","#491669"]},{"name":"Bubblegum","card":"#fff5fb","line":"#bc78af","ink":"#54234d","muted":"#855076","colors":["#ad286f","#295bb8","#147b68","#a35c10","#7a3bbb"],"desc":"Candy pastels / rounded lettering / soft playful controls","font":"Bubble","backgrounds":["#ffe1ef","#dcecff","#daf4e8","#fff0cf","#eee2ff"]}];
const HEADINGS={home:'Your Orbit.',device:'Device settings.',screens:'Set the mood.',remote:'Your PC. Anywhere.',ai:'A little intelligence.',voice:'Talk to Orbit.',lights:'Light it up.',codex:'Codex console.',privacy:'Privacy & session.'};
const PROVIDER_LABELS={openai:'OpenAI API key',claude:'Anthropic API key',deepseek:'DeepSeek API key',cursor:'Cursor API key (optional with CLI sign-in)'};
const PROVIDER_HELP={openai:'Uses the OpenAI Responses API. Save your key, then load models.',claude:'Uses the Anthropic Messages API. Save your Anthropic key, then load models.',deepseek:'Uses the DeepSeek chat API. Save your DeepSeek key, then load models.',cursor:'Uses the installed Cursor CLI in read-only Ask mode. Sign in to that CLI separately.'};

export async function api(path,data){
  const response=await fetch('/api/'+path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'Please try again.');return result;
}
export function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
export function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
// Runs one button's job: the button shows it is busy, and any error appears in the notice bar.
export async function action(button,fn){if(busy&&!button.dataset.always)return;busy=true;button.disabled=true;button.classList.add('working');button.setAttribute('aria-busy','true');try{await fn();}catch(e){if(e.message!=='Canceled')notice(e.message,true);}finally{button.disabled=false;button.classList.remove('working');button.removeAttribute('aria-busy');busy=false;}}
export function getProfile(){return profile;}
export function markChanged(){dirty=true;$('save-status').textContent='Unsaved changes';}
// Passcode prompt for PC actions when a device passcode is set.
export function actionPin(){
  if(!state?.pinEnabled)return Promise.resolve('');
  return new Promise((resolve,reject)=>{const d=$('pin-dialog');$('pin-dialog-input').value='';d.onclose=()=>{d.returnValue==='ok'?resolve($('pin-dialog-input').value):reject(Error('Canceled'));};d.showModal();});
}

function applyPack(){const p=packs[profile.theme||0],variant=profile.palette||0,style=document.documentElement.style;
  for(const k of ['card','line','ink','muted'])style.setProperty('--'+k,p[k]);style.setProperty('--bg',p.backgrounds[variant]);style.setProperty('--accent',p.colors[variant]);
  for(let i=0;i<5;i++)style.setProperty('--chart'+i,p.colors[(i+variant)%5]);document.body.dataset.theme=p.name;style.setProperty('--theme-font','Orbit'+p.font);style.colorScheme=['Office','Bubblegum'].includes(p.name)?'light':'dark';}
function section(id){document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s.id===id));document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.section===id));$('heading').textContent=HEADINGS[id];
  if(id==='remote')loadVolume();codexVisible(id==='codex');}
function connection(online,reachable=true){
  const s=!reachable?'unavailable':online?'connected':'connecting';$('connection-banner').dataset.state=s;
  $('connection-banner-text').textContent=!reachable?'Orbit program not responding. Reconnecting…':online?'Connected to your Orbit · Wi‑Fi':'Orbit is not connected. Check it is on and on the same Wi‑Fi.';
  $('connection').textContent=!reachable?'Program unavailable':online?'Display connected':'Display disconnected';$('dot').style.background=online?'#6ef4d2':'#efb54d';
}
function renderChoices(){
  applyPack();$('themes').replaceChildren();
  packs.forEach((pack,i)=>{const b=element('button',undefined,'theme-choice'+((profile.theme||0)===i?' chosen':''));const sw=element('span',undefined,'theme-swatches');[pack.backgrounds[0],...pack.colors].forEach(c=>{const dot=element('i');dot.style.background=c;sw.append(dot);});b.append(element('strong',pack.name),sw,element('small',pack.desc));b.onclick=()=>{profile.theme=i;profile.palette=0;renderChoices();markChanged();};$('themes').append(b);});
  $('palettes').replaceChildren();const colors=packs[profile.theme||0].colors;
  state.palettes.forEach((name,i)=>{const b=element('button',undefined,'palette'+(i===profile.palette?' chosen':'')),swatch=element('i');swatch.style.background=colors[i];b.append(swatch,element('span',name),element('span',i===profile.palette?'✓':''));b.onclick=()=>{profile.palette=i;renderChoices();markChanged();};$('palettes').append(b);});
  $('page-list').replaceChildren();
  state.selectable.forEach(i=>{const label=element('label'),box=element('input');box.type='checkbox';box.checked=profile.screens.includes(i);box.onchange=()=>{profile.screens=box.checked?[...profile.screens,i]:profile.screens.filter(n=>n!==i);markChanged();};label.append(box,element('span',state.pages[i]));$('page-list').append(label);});
}
// Home shortcuts: drag between the home grid and the pool (or click), drag within the grid to reorder.
function homeEditor(){
  // AI voice (21) is always top right on Orbit, so it is pinned here and not part of the list.
  profile.home_keys=profile.home_keys.filter(k=>k!==21);
  const on=$('home-on'),off=$('home-off'),max=(state.homeMax||8)-1,name=id=>state.homeShortcuts.find(s=>s.id===id)?.name||id;
  const change=keys=>{profile.home_keys=keys;markChanged();homeEditor();};
  const chip=(id,inHome)=>{const c=element('button',name(id),'home-chip');c.type='button';c.draggable=true;c.dataset.id=id;
    c.ondragstart=e=>{e.dataTransfer.setData('text/plain',String(id));e.dataTransfer.effectAllowed='move';};
    c.onclick=()=>inHome?change(profile.home_keys.filter(k=>k!==id)):profile.home_keys.length<max&&change([...profile.home_keys,id]);
    if(inHome){c.ondragover=e=>e.preventDefault();c.ondrop=e=>{e.preventDefault();e.stopPropagation();const dragged=Number(e.dataTransfer.getData('text/plain'));if(dragged===id)return;
      const keys=profile.home_keys.filter(k=>k!==dragged);if(keys.length>=max)return;keys.splice(keys.indexOf(id),0,dragged);change(keys);};}
    return c;};
  const tiles=[...profile.home_keys.map(id=>chip(id,true)),...Array.from({length:max-profile.home_keys.length},()=>element('span','','home-slot'))];
  tiles.splice(3,0,element('span','AI voice (always here)','home-chip home-pinned'));
  on.replaceChildren(...tiles);
  off.replaceChildren(...state.homeShortcuts.filter(s=>s.id!==21&&!profile.home_keys.includes(s.id)).map(s=>chip(s.id,false)));
  on.ondragover=off.ondragover=e=>e.preventDefault();
  on.ondrop=e=>{e.preventDefault();const id=Number(e.dataTransfer.getData('text/plain'));const keys=profile.home_keys.filter(k=>k!==id);if(keys.length<max)change([...keys,id]);};
  off.ondrop=e=>{e.preventDefault();const id=Number(e.dataTransfer.getData('text/plain'));if(profile.home_keys.includes(id))change(profile.home_keys.filter(k=>k!==id));};
}
function pageOptions(select,withOff){const names=state.pages.map((n,i)=>i===16?'AI voice':n);select.replaceChildren(...(withOff?[new Option('Off',-1)]:[]),...names.map((n,i)=>new Option(n,i)).filter(o=>withOff||state.selectable.includes(Number(o.value))));}

// ---- Shortcuts ----
let editing=null;
function shortcutFields(){const kind=$('shortcut-kind').value;$('shortcut-exe-fields').hidden=kind!=='executable';$('shortcut-command-field').hidden=kind!=='command';$('shortcut-system-field').hidden=kind!=='system';$('shortcut-options').hidden=kind==='system';$('shortcut-name').parentElement.hidden=kind==='system';}
function resetShortcut(){editing=null;for(const k of ['name','path','arguments','command','cwd'])$('shortcut-'+k).value='';$('shortcut-terminal').checked=false;$('shortcut-add').textContent='Add shortcut';$('shortcut-cancel').hidden=true;}
function renderApps(){
  const filter=$('app-filter').value.toLowerCase();$('apps').replaceChildren();
  inventory.apps.filter(a=>a.name.toLowerCase().includes(filter)).slice(0,100).forEach(app=>{const label=element('label'),box=element('input');box.type='checkbox';box.checked=profile.apps.some(a=>a.id===app.id);
    box.onchange=()=>{if(box.checked&&profile.apps.length>=6){box.checked=false;notice('Choose up to six shortcuts.',true);return;}profile.apps=box.checked?[...profile.apps,{kind:'app',...app}]:profile.apps.filter(a=>a.id!==app.id);renderApps();markChanged();};label.append(box,element('span',app.name));$('apps').append(label);});
  $('selected-apps').replaceChildren();
  profile.apps.forEach((item,slot)=>{const card=element('div',undefined,'shortcut-card');card.append(element('strong',(slot+1)+'. '+item.name),element('small',item.kind==='command'?item.command:item.kind==='executable'?item.path+' '+(item.arguments||''):item.kind==='system'?'Cleanup and sign out are confirmed on Orbit':'Installed app'));
    const run=element('button','Run');run.onclick=()=>action(run,async()=>{if(dirty)await save();const r=await api('shortcut/run',{slot,pin:await actionPin()});notice(r.status);});card.append(run);
    if(item.kind==='executable'||item.kind==='command'){const edit=element('button','Edit');edit.onclick=()=>{editing=item.id;$('shortcut-kind').value=item.kind;for(const k of ['name','path','arguments','command','cwd'])$('shortcut-'+k).value=item[k]||'';$('shortcut-terminal').checked=!!item.show_terminal;$('shortcut-add').textContent='Update shortcut';$('shortcut-cancel').hidden=false;shortcutFields();};card.append(edit);}
    const remove=element('button','Remove');remove.onclick=()=>{profile.apps.splice(slot,1);renderApps();markChanged();};card.append(remove);$('selected-apps').append(card);});
}
function addShortcut(){
  if(!editing&&profile.apps.length>=6){notice('Choose up to six shortcuts.',true);return;}
  const kind=$('shortcut-kind').value,item={kind,id:editing||crypto.randomUUID().replace(/-/g,''),name:$('shortcut-name').value.trim(),path:$('shortcut-path').value,arguments:$('shortcut-arguments').value,command:$('shortcut-command').value,cwd:$('shortcut-cwd').value,show_terminal:$('shortcut-terminal').checked,action:$('shortcut-system').value};
  if(kind==='system')item.name=state.systemActions[item.action];if(!item.name){notice('Give the shortcut a button name.',true);return;}
  const index=profile.apps.findIndex(a=>a.id===editing);if(index>=0)profile.apps[index]=item;else profile.apps.push(item);resetShortcut();renderApps();markChanged();notice('Shortcut added. Save changes to send its label to Orbit.');
}
function renderRuns(runs){
  const open=new Set([...$('command-runs').querySelectorAll('details[open]')].map(e=>e.dataset.run));$('command-runs').replaceChildren();
  if(!runs?.length){$('command-runs').textContent='No commands run this session.';return;}
  runs.slice(0,8).forEach(run=>{const d=element('details');d.dataset.run=run.id;d.open=open.has(run.id);d.append(element('summary',run.name+' · '+run.state+(run.exit_code===null?'':' (exit '+run.exit_code+')')),element('pre',run.output||'No captured output.'));$('command-runs').append(d);});
}
async function refreshInventory(){inventory=await api('inventory');
  $('camera').replaceChildren(new Option('No webcam selected',''),...inventory.cameras.map(c=>new Option(c,c)));$('camera').value=inventory.cameras.includes(profile.camera)?profile.camera:'';renderApps();}

// ---- AI desk keys ----
function providerUI(){
  const p=$('ai-provider').value;$('cursor-path-field').hidden=p!=='cursor';$('load-models').hidden=p==='cursor';$('key-label').textContent=PROVIDER_LABELS[p];$('provider-help').textContent=PROVIDER_HELP[p];
  $('key-status').textContent=state.keys[p]?'A key for this provider is saved (encrypted on this PC).':'No saved key for this provider.';$('model').value=profile.provider_models?.[p]||'';
}
// Who Orbit talks to: the engines ready on this PC, kept in step with Orbit's ENGINE screen.
function engineUI(){
  const select=$('orbit-engine'),e=state.engines;if(!e||document.activeElement===select)return;
  // Every engine is listed; ones without a key (or Codex not connected) can't be chosen yet.
  const ready=new Set((e.ready||[]).map(x=>x.id)),key=JSON.stringify([[...ready],e.current.id]);if(select.dataset.key===key)return;select.dataset.key=key;
  select.replaceChildren(...(e.all||e.ready).map(x=>{const o=new Option(ready.has(x.id)?x.name:`${x.name} (${x.id==='codex'?'open the Codex chat':'add its key in AI desk'})`,x.id);o.disabled=!ready.has(x.id);return o;}));
  select.value=e.current.id;
}
function voiceUI(){
  const saved=state.keys.openai,v=state.voice;
  $('voice-status').textContent=state.keyError||(saved?`A key is saved. Orbit's voice is ready${v?.active?' and in use right now':''}.`:'No OpenAI key saved yet. Orbit cannot talk until you add one.');
  $('live-voice').textContent=saved?'Ready':'Needs a key';
}
async function saveKey(provider,key,clear=false){state=await api('keys',{provider,key,clear});providerUI();voiceUI();}

// ---- Lights ----
function renderLeds(leds){if(!leds||Date.now()-ledsEditedAt<4000)return;$('led-on').checked=leds.on;$('led-brightness').value=leds.brightness;$('led-brightness-value').value=leds.brightness+'%';$('led-color').value=leds.color;$('led-effect').value=leds.effect;$('led-speed').value=leds.speed;}
let ledTimer=0;
function ledsChanged(){ledsEditedAt=Date.now();$('led-brightness-value').value=$('led-brightness').value+'%';clearTimeout(ledTimer);
  ledTimer=setTimeout(async()=>{try{const r=await api('device/leds',{on:$('led-on').checked,brightness:Number($('led-brightness').value),color:$('led-color').value,effect:Number($('led-effect').value),speed:Number($('led-speed').value)});$('led-status').textContent=r.online?'Sent to Orbit.':'Saved. Orbit gets it when it connects.';}catch(e){$('led-status').textContent=e.message;}},150);}

// ---- Volume ----
async function loadVolume(){if(Date.now()-volumeEditedAt<3000)return;try{const {level}=await api('volume');$('volume').value=level;$('volume-value').value=level+'%';}catch{$('volume-value').value='unavailable';}}
let volumeTimer=0;
function volumeChanged(){volumeEditedAt=Date.now();$('volume-value').value=$('volume').value+'%';clearTimeout(volumeTimer);volumeTimer=setTimeout(()=>api('volume',{level:Number($('volume').value)}).catch(e=>notice(e.message,true)),200);}

// ---- Privacy ----
let privacyToken=null;
function privacyBrowsers(){
  const box=$('privacy-browser-choices');box.replaceChildren();
  for(const [browser,name] of Object.entries(state.browsers))for(const part of state.browserParts){const label=element('label',undefined,'check'),check=element('input');check.type='checkbox';check.value=browser+'_'+part;check.dataset.browserPart='';check.checked=profile.privacy_browsers.includes(check.value);check.onchange=markChanged;label.append(check,element('span',name+' '+part));box.append(label);}
}
async function reviewCleanup(){
  if(dirty)await save();const plan=await api('privacy/prepare',{pin:await actionPin()});privacyToken=plan.token;
  $('privacy-plan-text').textContent=`${plan.warning}\n\n${plan.files} files, ${(plan.bytes/1048576).toFixed(1)} MB\n${[...plan.folders,...plan.browsers].join('\n')}`;$('privacy-plan').hidden=false;
}

function readForm(){
  const provider=$('ai-provider').value;
  return {...profile,name:$('name').value,timezone:$('timezone').value,startup:$('startup').checked,brightness:Number($('brightness').value),startup_page:Number($('startup_page').value),
    quick_taps:[0,1,2].map(i=>Number($('quick-'+i).value)),ai_provider:provider,cursor_path:$('cursor-path').value,provider_models:{...profile.provider_models,[provider]:$('model').value},
    camera:$('camera').value,record_timestamp:$('record_timestamp').checked,record_camera_name:$('record_camera_name').checked,motion_sensitivity:Number($('motion_sensitivity').value),recording_limit_mb:Number($('recording_limit_mb').value),
    alarm_enabled:$('alarm_enabled').checked,alarm_sound:$('alarm_sound').value,alarm_loop:$('alarm_loop').checked,
    privacy_folders:$('privacy-folders').value.split('\n').map(v=>v.trim()).filter(Boolean),privacy_browsers:[...document.querySelectorAll('[data-browser-part]:checked')].map(e=>e.value),
    new_pin:$('new-pin').value,pin_confirm:$('confirm-pin').value,current_pin:$('current-pin').value,clear_pin:$('clear-pin').checked};
}
export async function save(){
  state=await api('profile',readForm());profile=structuredClone(state.profile);
  for(const id of ['new-pin','confirm-pin','current-pin'])$(id).value='';$('clear-pin').checked=false;
  dirty=false;renderChoices();renderApps();pinStatus();$('save-status').textContent='All changes saved';notice('Saved. Orbit updates straight away when it is connected.');
}
// Firmware: what Orbit runs, what this program carries, and progress while an update runs.
async function firmwarePoll(){
  try{const f=await api('firmware');
    $('firmware-info').textContent=`Orbit runs ${f.installed||'(not connected)'}; this program includes ${f.available||'no firmware files'}.${f.installed&&f.installed===f.available?' Up to date.':''}`;
    $('firmware-status').textContent=f.status;$('firmware-update').disabled=f.running||!f.available;if(f.running)setTimeout(firmwarePoll,2000);}
  catch(e){$('firmware-info').textContent=e.message;}
}
function pinStatus(){$('pin-status').textContent=state.pinEnabled?'Passcode protection is on.':'Passcode protection is off.';}

async function poll(){
  try{state=await api('state');}catch{connection(false,false);return;}
  const d=state.device||{};connection(d.online);
  $('setup-hero').hidden=!!(d.online||d.deviceIp);
  $('live-version').textContent=d.firmware||'Not connected';$('live-link').textContent=d.online?'Home Wi‑Fi':'Waiting for Orbit';
  const page=state.deviceState?.page;$('live-page').textContent=Number.isInteger(page)?(page===21?'AI voice':page===22?'Light show':state.pages[page]||'—'):'—';
  $('link-device').textContent=d.online?`Connected · ${d.deviceIp}`:d.deviceIp?`Offline (last seen at ${d.deviceIp})`:'Not paired yet';
  $('link-host').textContent=d.host?`${d.host}:${d.port}`:(d.error||'—');$('link-firmware').textContent=d.firmware||'—';
  $('link-memory').textContent=d.diagnostics?.heap?`${Math.round(d.diagnostics.heap/1024)} KB free (lowest ${Math.round(d.diagnostics.minHeap/1024)} KB)`:'—';
  if(d.pairing){$('pair-code').hidden=false;$('pair-code').textContent=`Code ${d.pairing.code} · tap YES on Orbit (${d.pairing.secondsLeft}s left)`;}
  else if(pairUntil&&Date.now()<pairUntil+3000){$('pair-code').textContent=d.online?'Paired. Orbit is connected.':'Pairing window closed. Try again if Orbit did not connect.';}
  else $('pair-code').hidden=true;
  $('reply').textContent=state.reply?state.reply.reply:'Waiting for a reply';
  $('media-state').textContent=state.media&&state.media!=='Unknown'?`Now: ${state.media}.`:'';
  $('alarm-state').textContent=state.alarmActive?'Alarm playing':'Alarm quiet';
  renderRuns(state.commandRuns);renderLeds(d.leds);voiceUI();engineUI();sentryPoll(state);
  return state;
}

async function init(){
  if(!await poll())return setTimeout(init,2500);
  profile=structuredClone(state.profile);applyPack();
  $('footer-version').textContent=`v${state.version} · Local-first · Windows · ESP32 CYD`;
  $('timezone').replaceChildren(...Object.entries(state.timezones).map(([v,n])=>new Option(n,v)));if(!state.timezones[profile.timezone])$('timezone').append(new Option(profile.timezone,profile.timezone));
  for(const k of ['name','timezone','motion_sensitivity','recording_limit_mb'])$(k).value=profile[k];
  $('startup').checked=profile.startup;$('brightness').value=profile.brightness;$('brightness-value').value=profile.brightness+'%';
  pageOptions($('startup_page'),false);$('startup_page').value=profile.startup_page;for(let i=0;i<3;i++){pageOptions($('quick-'+i),true);$('quick-'+i).value=profile.quick_taps[i];}homeEditor();
  $('record_timestamp').checked=profile.record_timestamp;$('record_camera_name').checked=profile.record_camera_name;
  $('alarm_enabled').checked=profile.alarm_enabled;$('alarm_sound').value=profile.alarm_sound;$('alarm_loop').checked=profile.alarm_loop;
  $('ai-provider').value=profile.ai_provider;$('cursor-path').value=profile.cursor_path;providerUI();voiceUI();
  $('privacy-folders').value=profile.privacy_folders.join('\n');privacyBrowsers();pinStatus();
  $('led-effect').replaceChildren(...state.ledEffects.map((n,i)=>new Option(n,i)));renderLeds(state.device?.leds);
  renderChoices();
  document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>section(b.dataset.section));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>section(b.dataset.go));
  const live=['prompt','message-title','message-body','app-filter','api-key','voice-key','relink-code','volume','codex-input','codex-pin','codex-review-pin','codex-current-pin','codex-new-pin','pin-dialog-input','model','ai-provider','orbit-engine'];
  document.querySelectorAll('main input,main select,main textarea').forEach(e=>{if(!live.includes(e.id)&&!e.id.startsWith('led-')&&!e.id.startsWith('shortcut-'))e.addEventListener('input',markChanged);});
  $('brightness').oninput=()=>{$('brightness-value').value=$('brightness').value+'%';markChanged();};
  $('save').onclick=()=>action($('save'),save);
  $('all-pages').onclick=()=>{profile.screens=[...state.selectable];renderChoices();markChanged();};
  $('essentials').onclick=()=>{profile.screens=[0,1,3,4,5,6,7,17,18,19];renderChoices();markChanged();};
  $('export').onclick=()=>{const {apps,camera,cursor_path,privacy_folders,privacy_browsers,...shareable}=profile;const url=URL.createObjectURL(new Blob([JSON.stringify(shareable,null,2)],{type:'application/json'}));const a=element('a');a.href=url;a.download='orbit-display-preferences.json';a.click();URL.revokeObjectURL(url);notice('Exported display preferences. Keys, shortcuts and folders are left out.');};
  // Device
  $('pair-start').onclick=()=>action($('pair-start'),async()=>{const r=await api('device/pair-start',{});pairUntil=Date.now()+r.seconds*1000;$('pair-code').hidden=false;$('pair-code').textContent=`Code ${r.code} · tap YES on Orbit`;notice(`Pairing open for ${r.seconds} seconds. Check Orbit shows code ${r.code}, then tap YES.`);});
  $('test-tone').onclick=()=>action($('test-tone'),async()=>{await api('device/test-tone',{on:true});notice('Orbit is beeping for up to a minute.');});
  $('test-tone-stop').onclick=()=>action($('test-tone-stop'),async()=>{await api('device/test-tone',{on:false});notice('Beeps stopped.');});
  $('firmware-update').onclick=()=>action($('firmware-update'),async()=>{if(!confirm('Update Orbit now? It restarts during the update (about two minutes).'))throw Error('Canceled');await api('firmware/update',{});notice('Updating Orbit. Keep it on.');firmwarePoll();});
  firmwarePoll();
  $('relink').onclick=()=>action($('relink'),async()=>{const r=await api('device/relink',{code:$('relink-code').value});notice(`Orbit moved to ${r.host}. It will show offline here.`);});
  // PC controls
  document.querySelectorAll('[data-media]').forEach(b=>b.onclick=()=>action(b,async()=>{notice((await api('media',{action:b.dataset.media})).status);}));
  $('volume').oninput=volumeChanged;
  $('app-filter').oninput=renderApps;$('shortcut-kind').onchange=shortcutFields;shortcutFields();$('shortcut-cancel').onclick=resetShortcut;$('shortcut-add').onclick=addShortcut;
  $('alarm-test').onclick=()=>action($('alarm-test'),async()=>{if(dirty)await save();notice((await api('alarm/test',{})).status);});
  $('alarm-stop').dataset.always='1';$('alarm-stop').onclick=()=>action($('alarm-stop'),async()=>{notice((await api('alarm/stop',{})).status);});
  // AI desk
  $('ai-provider').onchange=()=>{profile.ai_provider=$('ai-provider').value;$('api-key').value='';$('models').replaceChildren();providerUI();markChanged();};
  $('model').oninput=()=>{profile.provider_models={...profile.provider_models,[$('ai-provider').value]:$('model').value};markChanged();};
  $('key-save').onclick=()=>action($('key-save'),async()=>{await saveKey($('ai-provider').value,$('api-key').value);$('api-key').value='';notice('Key saved and encrypted on this PC.');});
  $('key-clear').onclick=()=>action($('key-clear'),async()=>{await saveKey($('ai-provider').value,'',true);notice('Saved key removed.');});
  $('load-models').onclick=()=>action($('load-models'),async()=>{const {models}=await api('ai/models',{provider:$('ai-provider').value});$('models').replaceChildren(...models.map(m=>new Option(m,m)));notice(`${models.length} models loaded. Type or pick one, then Save changes.`);});
  $('ask').onclick=()=>action($('ask'),async()=>{if(!$('prompt').value.trim())throw Error('Type a question first.');if(dirty)await save();notice('Asking…');const r=await api('ai/ask',{prompt:$('prompt').value});$('ai-result').textContent=r.answer;notice('Answer sent to Orbit.');});
  $('send-message').onclick=()=>action($('send-message'),async()=>{if(!$('message-body').value.trim())throw Error('Type a message first.');await api('desk/message',{title:$('message-title').value,body:$('message-body').value});notice('Sent. Hold YES or NO on Orbit to reply.');});
  // AI voice
  $('voice-key-save').onclick=()=>action($('voice-key-save'),async()=>{await saveKey('openai',$('voice-key').value);$('voice-key').value='';notice('OpenAI key saved. Hold to talk on Orbit to try it.');});
  $('voice-key-clear').onclick=()=>action($('voice-key-clear'),async()=>{await saveKey('openai','',true);notice('OpenAI key removed.');});
  $('orbit-engine').onchange=()=>action($('orbit-engine'),async()=>{const r=await api('engine',{id:$('orbit-engine').value});notice(`Orbit now talks to ${r.current.name}.`);});
  // Lights
  for(const id of ['led-on','led-brightness','led-color','led-effect','led-speed'])$(id).addEventListener('input',ledsChanged);
  // Privacy
  $('privacy-browse').onclick=()=>action($('privacy-browse'),async()=>{const {folder}=await api('folder/browse',{});if(folder){$('privacy-folders').value=[...$('privacy-folders').value.split('\n').filter(Boolean),folder].join('\n');markChanged();}});
  $('privacy-review').onclick=()=>action($('privacy-review'),reviewCleanup);
  $('privacy-cancel').onclick=async()=>{if(privacyToken)await api('privacy/cancel',{token:privacyToken}).catch(()=>{});privacyToken=null;$('privacy-plan').hidden=true;};
  $('privacy-confirm').onclick=()=>action($('privacy-confirm'),async()=>{const second=await api('privacy/confirm',{token:privacyToken});const r=await api('privacy/commit',{token:second.token});privacyToken=null;$('privacy-plan').hidden=true;$('privacy-result').textContent=r.status;notice(r.status);});
  $('pc-lock').onclick=()=>action($('pc-lock'),async()=>{notice((await api('system/action',{action:'lock'})).status);});
  $('pc-signout').onclick=()=>action($('pc-signout'),async()=>{notice((await api('system/action',{action:'signout',pin:await actionPin()})).status);});
  initCodex();initSentry();initHue();
  refreshInventory().catch(e=>notice(e.message,true));
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  setInterval(poll,2500);
}
init();
