import { initPrivacy } from './privacy-ui.mjs';
import { initVoice } from './voice.mjs';
import { dashboardIds, retiredIds, metrics, demoReadings, metricDisplay, normalizeSetup } from './setup.mjs';
import { Orbit } from './core.mjs';
import { screens } from './catalog.mjs';
import { themes, resolveTheme, paintScene } from './themes.mjs';
const $ = id => document.getElementById(id);
async function refreshTaskStatus(){try{const response=await fetch('/api/task/status');if(!response.ok){$('taskStatus').replaceChildren(document.createTextNode('Use the connected Orbit app for live task status: '));const link=document.createElement('a');link.href='http://127.0.0.1:8788/';link.textContent='Open connected Orbit';$('taskStatus').append(link);return;}const context=await response.json();$('taskStatus').textContent=context.connected?`Live coding task: ${context.title} · ${context.runtime} · ${context.latestUpdate.slice(0,180)}`:'Live coding task unavailable · Orbit will report that honestly.';}catch{$('taskStatus').textContent='Live coding task connection unavailable.';}}
refreshTaskStatus();setInterval(()=>{if(!document.hidden)refreshTaskStatus();},15000);
const orbit = new Orbit(Date.now());
document.addEventListener('orbit-task-attention',()=>{orbit.touch();if(!orbit.quiet&&!['listening','speaking'].includes(orbit.state))sound();document.getElementById('hardwareRings')?.classList.add('task-attention');setTimeout(()=>document.getElementById('hardwareRings')?.classList.remove('task-attention'),8000);});
orbit.orientation = 'landscape';
let sensor = 'landscape', serial = 0, audio, pinAction = null, failures = 0, blockedUntil = 0;
let displayedRequest = null;
let legacyPage = 0, watchElapsed = 0, watchStarted = null, musicPlaying = false;
let legacyRendered = null;
let selectedTheme = 'corporate', themeMotion = true;
let characterPreview='auto',curiousUntil=0,happyUntil=0;
function characterState(){return characterPreview!=='auto'?characterPreview:orbit.state==='idle'?(Date.now()<happyUntil?'happy':Date.now()<curiousUntil?'curious':'idle'):orbit.state;}
function automaticCharacter(){characterPreview='auto';$('expressionPreview').value='auto';}
let setup;
try { setup=normalizeSetup(JSON.parse(localStorage.getItem('orbit-setup')||'{}')); } catch { setup=normalizeSetup(); }
let demoPinHash=localStorage.getItem('orbit-demo-pin-hash')||'';
async function hashPin(pin){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('orbit-demo:'+pin)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
let trackIndex=0,trackSeconds=0,musicVolume=65,lastMusicTick=Date.now();
const tracks=['Blue Hour','A Little Further','Afterglow'];
const titles={3:'Compute cockpit',6:'Thermal watch',7:'Network watch',11:'Six channels'};
const pageName=page=>titles[page.id]||page.name;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
try { selectedTheme = resolveTheme(localStorage.getItem('orbit-theme')).id; } catch { }
for (const theme of themes) $('themeSelect').add(new Option(theme.name,theme.id));
$('themeSelect').value = selectedTheme;
document.body.dataset.theme = selectedTheme;
$('themeDescription').textContent = resolveTheme(selectedTheme).description;
const themeContext = $('themeCanvas').getContext('2d');
let lastPaint = 0;
let renderedOrientation = null;
function paintTheme(time) {
  if (time-lastPaint >= 33 && !document.hidden && !$('themeCanvas').hidden) {
    lastPaint=time;
    const canvas=$('themeCanvas'), w=orbit.orientation==='landscape'?320:240, h=orbit.orientation==='landscape'?240:320;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    paintScene(themeContext,{theme:selectedTheme,width:w,height:h,time,state:characterState(),mode:orbit.mode,motion:themeMotion&&!reducedMotion.matches,date:new Date()});
  }
  requestAnimationFrame(paintTheme);
}
requestAnimationFrame(paintTheme);
let review = {};
try { review = JSON.parse(localStorage.getItem('orbit-screen-review') || '{}'); } catch { /* Storage is optional. */ }

$('legacyDescription').textContent = screens[0].description;
function el(tag, text) { const e = document.createElement(tag); if(text !== undefined) e.textContent=text; return e; }
function demoButton(label, handler) { const b=el('button',label); b.addEventListener('click',()=>{orbit.touch();handler();});return b; }
const svgNS='http://www.w3.org/2000/svg';
function svgEl(tag,attrs){const node=document.createElementNS(svgNS,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node;}
function gaugeArt(key,forceDial=false){
  if(key==='temp'&&!forceDial){const art=el('div');art.className='gauge-art thermometer-art';art.setAttribute('aria-hidden','true');const stem=el('i');stem.className='thermometer-stem';stem.append(el('i'));art.append(stem,el('b'));return art;}
  if(forceDial||['cpu','gpu'].includes(key)){
    const svg=svgEl('svg',{viewBox:'0 0 100 100',class:'gauge-art dial-art','aria-hidden':'true'});
    svg.append(svgEl('circle',{cx:50,cy:50,r:44,pathLength:100,class:'dial-track'}));
    if(key==='temp'){
      const warm=setup.thermalWarm/110*100,high=setup.thermalHigh/110*100;
      for(const [start,len,color] of [[0,warm,'#43e6a1'],[warm,high-warm,'#f6d34c'],[high,100-high,'#ff667a']])svg.append(svgEl('circle',{cx:50,cy:50,r:48,pathLength:100,fill:'none',stroke:color,'stroke-width':2,'stroke-dasharray':`${len} ${100-len}`,'stroke-dashoffset':-start,transform:'rotate(-90 50 50)'}));
    }
    svg.append(svgEl('circle',{cx:50,cy:50,r:44,pathLength:100,class:'dial-progress',transform:'rotate(-90 50 50)'}),svgEl('circle',{cx:50,cy:6,r:2.5,class:'dial-dot'}));return svg;
  }
  const art=el('div');art.className='gauge-art '+({ram:'liquid-art',rx:'traffic-art download-art',tx:'traffic-art upload-art'}[key]||'');art.setAttribute('aria-hidden','true');
  if(key==='ram'){const fill=el('i');fill.className='liquid-fill';art.append(fill);}
  if(['rx','tx'].includes(key)){art.append(el('span',key==='rx'?'↓':'↑'));const bars=el('div');bars.className='traffic-bars';for(let i=0;i<12;i++)bars.append(el('i'));art.append(bars);}
  return art;
}
function updateInstrument(cell,metric){
  const display=metricDisplay(metric,setup);cell.querySelector('.metric-value').textContent=metric.value;cell.style.setProperty('--accent',display.color);cell.style.setProperty('--level',`${display.percent}%`);cell.dataset.tone=display.tone;
  const status=cell.querySelector('.instrument-status');if(status)status.textContent=display.label;
  const progress=cell.querySelector('.dial-progress');if(progress)progress.style.strokeDasharray=`${display.percent} 100`;
  const dot=cell.querySelector('.dial-dot');if(dot){const angle=display.percent/100*Math.PI*2;dot.setAttribute('cx',50+44*Math.sin(angle));dot.setAttribute('cy',50-44*Math.cos(angle));}
  cell.setAttribute('aria-label',`${metric.label}: ${metric.value}${metric.unit}. ${display.label}`);
  const bars=cell.querySelectorAll('.traffic-bars i');bars.forEach((bar,i)=>bar.classList.toggle('active',i/12*100<display.percent));
}
function drawClock(root,date){
  if(!root.querySelector('.clock-hours')){root.replaceChildren();root.append(el('span'),el('span',':'),el('span'));root.children[0].className='clock-hours';root.children[1].className='clock-colon';root.children[2].className='clock-minutes';}
  const parts=new Intl.DateTimeFormat([],{hour:'2-digit',minute:'2-digit'}).formatToParts(date);root.querySelector('.clock-hours').textContent=parts.find(p=>p.type==='hour')?.value||'00';root.querySelector('.clock-minutes').textContent=parts.find(p=>p.type==='minute')?.value||'00';
  root.setAttribute('aria-label',date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
  const meta=root.parentElement.querySelector('.clock-meta');if(meta)meta.textContent=`${parts.find(p=>p.type==='dayPeriod')?.value||''}  ·  ${date.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}`.replace(/^  ·  /,'');
}
function drawLegacy() {
  legacyRendered = legacyPage;
  const page=screens[legacyPage], root=$('legacyContent');
  $('legacyTitle').textContent=pageName(page);root.dataset.kind=page.kind;$('legacyView').dataset.kind=page.kind;
  root.replaceChildren();
  const date=new Date();
  if(page.kind==='clock') {
    const time=el('div');time.className=`legacy-time clock-digits clock-${page.id}`;const meta=el('p');meta.className='clock-meta';root.append(time,meta);drawClock(time,date);
  } else if(page.kind==='binary') {
    const grid=el('div');grid.className='binary-grid';
    for(const [label,value] of [['H',date.getHours()],['M',date.getMinutes()],['S',date.getSeconds()]]) {
      const row=el('div');row.append(el('span',label));
      for(let bit=5;bit>=0;bit--){const dot=el('i');dot.className=value&(1<<bit)?'lit':'';row.append(dot);}grid.append(row);
    }root.append(grid);
  } else if(page.kind==='telemetry') {
    const focus={3:'cpu',4:'cpu',5:'gpu',6:'temp',7:'rx',8:'ram',9:'disk',10:'power'}[page.id];
    const grid=el('div');grid.className=page.id===11?'dashboard six-dashboard':'dashboard focus-dashboard';
    grid.dataset.focus=focus||'all';let supportIndex=0;
    for(const m of demoReadings(orbit.now,setup)) {
      const cell=el('div');cell.className='instrument'+(m.key===focus?' hero-instrument':'');cell.dataset.metric=m.key;cell.dataset.gauge={cpu:'speed',gpu:'segments',ram:'liquid',temp:'heat',rx:'download',tx:'upload'}[m.key]||'compact';if(focus&&m.key!==focus&&m.key!=='power'){cell.style.gridColumn=supportIndex<3?'1':'4';cell.style.gridRow=String(supportIndex%3+1);supportIndex++;}
      const ring=el('div');ring.className='instrument-ring';const value=el('strong',`${m.value}`);value.className='metric-value';ring.append(gaugeArt(m.key,m.key===focus),value,el('span',m.unit));cell.append(el('small',m.label),ring);
      const status=el('small');status.className='instrument-status';cell.append(status);
      const spark=el('div');spark.className='sparkline';spark.setAttribute('aria-hidden','true');for(let i=0;i<18;i++){const bar=el('i');bar.style.height=`${20+Math.abs(Math.sin(i*.7+m.base))*75}%`;spark.append(bar);}cell.append(spark);grid.append(cell);updateInstrument(cell,m);
    }
    const legend=el('div');legend.className='range-legend';
    legend.textContent=page.id===6?`Green <${setup.thermalWarm}° · Yellow ${setup.thermalWarm}–${setup.thermalHigh}° · Red ≥${setup.thermalHigh}°`:page.id===7?`Traffic / ${setup.networkMbps} Mbps · Light <10% · Busy 50% · High 80%`:'';
    if(legend.textContent)root.append(legend);
    root.append(grid);root.dataset.kind='telemetry';
  } else if(page.kind==='stopwatch') {
    const elapsed=watchElapsed+(watchStarted===null?0:orbit.now-watchStarted),s=Math.floor(elapsed/1000);
    const time=el('div',`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`);time.className='legacy-time';root.append(time);
    root.append(demoButton(watchStarted===null?'Start':'Pause',()=>{if(watchStarted===null)watchStarted=orbit.now;else{watchElapsed+=orbit.now-watchStarted;watchStarted=null;}drawLegacy();}),demoButton('Reset',()=>{watchElapsed=0;watchStarted=null;drawLegacy();}));
  } else if(page.kind==='music') {
    root.dataset.kind='music';
    const art=el('div','♫');art.className='album-art';
    const info=el('div');info.className='track-info';info.append(el('strong',tracks[trackIndex]),el('small','Orbit demo playlist'));
    const progress=el('progress');progress.id='trackProgress';progress.max=180;progress.value=trackSeconds;progress.setAttribute('aria-label','Track progress');
    const controls=el('div');controls.className='transport';
    controls.append(demoButton('⏮',()=>{trackIndex=(trackIndex+tracks.length-1)%tracks.length;trackSeconds=0;drawLegacy();}),demoButton(musicPlaying?'Ⅱ':'▶',()=>{musicPlaying=!musicPlaying;drawLegacy();}),demoButton('⏭',()=>{trackIndex=(trackIndex+1)%tracks.length;trackSeconds=0;drawLegacy();}));
    [...controls.children].forEach((b,i)=>b.setAttribute('aria-label',['Previous track',musicPlaying?'Pause music':'Play music','Next track'][i]));
    const volume=el('label',`Volume ${musicVolume}%`);volume.className='music-volume';const slider=el('input');slider.type='range';slider.min=0;slider.max=100;slider.value=musicVolume;slider.setAttribute('aria-label','Music volume');slider.addEventListener('input',()=>{musicVolume=Number(slider.value);volume.firstChild.textContent=`Volume ${musicVolume}%`;orbit.touch();});volume.append(slider);
    const time=el('small');time.id='trackTime';root.append(art,info,progress,controls,volume,time);
  } else if(page.kind==='launcher') {
    root.append(el('p','Your six selected shortcuts'));
    const grid=el('div');grid.className='launcher-grid';
    for(const name of ['Browser','Music','Notes','Calendar','Project','Custom'])grid.append(demoButton(name,()=>log(`Sample shortcut: ${name}. No program was launched.`)));root.append(grid);
  } else if(page.kind==='camera') {
    const image=el('div','Camera not connected');image.className='camera-placeholder';root.append(image);
    for(const label of ['Snapshot','Record','Sentry'])root.append(demoButton(label,()=>log(`Sample camera control: ${label}. No camera was accessed.`)));
  } else if(page.kind==='privacy') {
    const summary=el('p',privacy.summary);summary.className='privacy-target';const small=el('div');small.className='privacy-small-actions';small.append(demoButton('Review cleanup',()=>privacy.begin()),demoButton('Lock PC',()=>log('Lock PC preview. No action sent.')),demoButton('Sign out',()=>log('Sign out preview. No action sent.')));
    const emergency=demoButton('EMERGENCY DELETE',()=>privacy.begin());emergency.className='emergency-delete';emergency.setAttribute('aria-label','Emergency delete configured folder contents and browser history');root.append(summary,small,emergency,el('p','Emergency Delete is real · two confirmations required. Lock / sign out remain previews.'));
  } else if(page.kind==='ai') {
    root.append(el('p','A place for messages and decisions.'),demoButton('Sample request',()=>$('sampleAlert').click()));
  } else {
    root.append(el('div',`Hello, ${$('ownerName').value.trim()||'friend'}.`),el('p','Your desk, within reach.'));
  }
}
const log = message => {
  const li = document.createElement('li'), time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit',second:'2-digit'});
  li.append(time, document.createTextNode(message));
  $('events').prepend(li);
  while ($('events').children.length > 7) $('events').lastChild.remove();
};
function speak(text) {
  if (!$('enableSound').checked || orbit.quiet || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = .96;
  window.speechSynthesis.speak(utterance);
}
function sound() {
  if (!$('enableSound').checked || orbit.quiet) return;
  const name = $('ownerName').value.trim() || 'Hey';
  if ($('alertStyle').value === 'voice') { speak(`${name}, I need you for a second.`); return; }
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  audio.resume();
  const style = $('alertStyle').value;
  const tones = style === 'telephone' ? [660,880,660,880] : style === 'horn' ? [330,415,330] : [523,659,784];
  tones.forEach((frequency, i) => {
    const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + i * .17;
    oscillator.type = style === 'horn' ? 'triangle' : 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(.08, start + .015);
    gain.gain.exponentialRampToValueAtTime(.001, start + .2);
    oscillator.connect(gain).connect(audio.destination); oscillator.start(start); oscillator.stop(start + .22);
  });
}
function render() {
  const expression=characterState();
  const request = orbit.active;
  const locked = orbit.locked && orbit.state !== 'sleeping';
  const visible = orbit.visibleRequest;
  const hasRequest = !!request && orbit.state !== 'sleeping';
  const customCanvas=selectedTheme!=='corporate' && orbit.mode==='companion' && !locked && !hasRequest;
  $('themeCanvas').hidden=!customCanvas;
  $('themeCanvas').setAttribute('role','img');$('themeCanvas').setAttribute('aria-hidden',String(!customCanvas));$('themeCanvas').setAttribute('aria-label',orbit.mode==='companion'?`Orbit character: ${expression}`:'Themed clock');
  document.body.classList.toggle('custom-companion',customCanvas&&orbit.mode==='companion');
  document.body.classList.toggle('custom-clock',customCanvas&&orbit.mode==='clock');
  document.body.classList.toggle('motion-off',!themeMotion||reducedMotion.matches);
  $('device').className = `device ${orbit.state} ${orbit.orientation} ${hasRequest ? 'has-request' : ''} ${locked ? 'locked' : ''} ${orbit.connected ? '' : 'offline'}`;
  if (renderedOrientation !== orbit.orientation) {
    renderedOrientation=orbit.orientation;
    const portrait=orbit.orientation==='portrait';
    $('deviceRender').src=portrait?'assets/orbit-enclosure-portrait.png':'assets/orbit-enclosure-landscape.png';
    $('deviceRender').width=portrait?1500:2400;
    $('deviceRender').height=portrait?2400:1500;
  }
  $('device').dataset.characterState=expression;
  $('device').dataset.companion=String(orbit.mode==='companion');
  $('face').setAttribute('aria-label',`Orbit character: ${expression}`);
  $('characterEffects').hidden=orbit.mode!=='companion'||locked||hasRequest;
  $('characterEffects').dataset.state=expression;
  $('face').hidden = orbit.mode !== 'companion';
  const showCaption=orbit.mode==='companion'&&expression==='speaking'&&characterPreview==='auto'&&!!orbit.line;
  $('homeCopy').hidden = !showCaption;
  $('device').dataset.hasCaption=String(showCaption);
  $('talk').hidden = orbit.mode !== 'companion';
  $('companionVoiceStatus').hidden=orbit.mode!=='companion';
  $('taskDevicePanel').hidden=orbit.mode!=='relay';
  $('clockView').hidden = orbit.mode !== 'clock' || orbit.state === 'sleeping';
  $('focusView').hidden = orbit.mode !== 'focus' || orbit.state === 'sleeping';
  $('legacyView').hidden = orbit.mode !== 'legacy' || orbit.state === 'sleeping';
  if (orbit.mode === 'legacy') {
    if (legacyRendered !== legacyPage) drawLegacy();
    const page = screens[legacyPage], time = $('legacyContent').querySelector('.legacy-time');
    if (time && page.kind === 'clock') drawClock(time,new Date());
    if (time && page.kind === 'stopwatch') {
      const seconds = Math.floor((watchElapsed + (watchStarted === null ? 0 : orbit.now-watchStarted))/1000);
      time.textContent = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    }
    if (page.kind === 'binary') {
      const date = new Date();
      [...$('legacyContent').querySelectorAll('.binary-grid>div')].forEach((row,index)=>{
        const value = [date.getHours(),date.getMinutes(),date.getSeconds()][index];
        [...row.querySelectorAll('i')].forEach((dot,col)=>dot.classList.toggle('lit',!!(value & (1 << (5-col)))));
      });
    }
  }
  $('stateLabel').textContent = orbit.state === 'idle' ? 'HERE WITH YOU' : orbit.state.toUpperCase();
  $('line').textContent = showCaption?orbit.line:'';
  $('connection').textContent = orbit.connected ? '● ONLINE' : '○ OFFLINE';
  const ledMode = hasRequest?'attention':orbit.state;
  const ledLevel=$('ledEnabled').checked ? Number($('ledBrightness').value)/100 : 0;
  $('hardwareRings').dataset.state=ledMode;
  $('hardwareRings').style.setProperty('--led-level',String(orbit.state==='sleeping'?ledLevel*.15:ledLevel));
  $('hardwareRings').setAttribute('aria-label',ledLevel?`Two blue rings: ${ledMode}`:'Blue rings off');
  $('lockBadge').textContent = orbit.security === 'off' ? '' : orbit.locked ? 'LOCKED' : 'UNLOCKED';
  $('requestView').hidden = !visible || orbit.state === 'sleeping';
  if (visible) {
    displayedRequest = visible.id;
    $('requestTitle').textContent = visible.title;
    $('requestDetail').textContent = visible.detail;
  } else {
    displayedRequest = null;
    $('requestTitle').textContent = '';
    $('requestDetail').textContent = '';
  }
  $('approve').disabled = !orbit.connected;
  $('reject').disabled = !orbit.connected;
  $('lockView').hidden = !locked;
  $('lockText').textContent = hasRequest ? 'A request needs your attention. Unlock to see it.' : 'Enter your passcode to continue.';
  $('caption').textContent = `${orbit.state[0].toUpperCase() + orbit.state.slice(1)} · ${orbit.orientation}${sensor === 'flat' ? ' held while flat' : ''} · ${orbit.requests.length} pending${characterPreview==='auto'?'':` · Preview: ${expression}`}`;
  const date = new Date();
  drawClock($('clockTime'),date);

  const seconds = orbit.focusUntil ? Math.max(0, Math.ceil((orbit.focusUntil - orbit.now) / 1000)) : 1500;
  $('focusTime').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`;
  $('focusStart').textContent = orbit.focusUntil ? 'End session' : 'Start 25-minute focus';
  $('focusProgress').value=orbit.focusUntil?1500-seconds:0;
  for (const event of orbit.events.splice(0)) {
    if (event.type === 'wake') log(`Orbit woke up: ${event.reason}.`);
    if (event.type === 'sleep') log('Orbit went to sleep.');
    if (event.type === 'pickup-remark') speak('Hey, I’m here.');
    if (event.type === 'alert') { log(`Request waiting${event.audible ? '' : ' · quiet mode'}.`); if (event.audible) sound(); }
    if (event.type === 'orientation') log(`Layout changed to ${event.value}.`);
    if (event.type === 'demo-decision'&&event.decision==='approve')happyUntil=Date.now()+2800;
    if (event.type === 'demo-decision') log(`Sample ${event.id}: ${event.decision}. No real action was sent.`);
    if (event.type === 'snooze') log('Sample request snoozed for one minute.');
    if (event.type === 'focus-complete') { log('Focus session complete.'); if (event.audible) sound(); }
  }
}
function tick() {
  if(voice?.active){if(orbit.locked||!orbit.connected||orbit.state==='sleeping')voice.stop();else orbit.touch();}
  const now=Date.now();if(musicPlaying)trackSeconds=Math.min(180,trackSeconds+(now-lastMusicTick)/1000);lastMusicTick=now;
  if(trackSeconds>=180){trackSeconds=0;trackIndex=(trackIndex+1)%tracks.length;if(screens[legacyPage].kind==='music')legacyRendered=null;}
  orbit.tick(now); orbit.sampleOrientation(sensor); render();
  for(const m of demoReadings(now,setup)){const cell=document.querySelector(`[data-metric="${m.key}"]`);if(cell)updateInstrument(cell,m);}
  if($('trackProgress'))$('trackProgress').value=trackSeconds;
  if($('trackTime'))$('trackTime').textContent=`${Math.floor(trackSeconds/60)}:${String(Math.floor(trackSeconds%60)).padStart(2,'0')} / 3:00 · ${musicPlaying?'Playing':'Paused'} · simulated playback`;
}
setInterval(tick, 200);
const on = (id, event, fn) => $(id).addEventListener(event, fn);
function selectControlPanel(id) {
  document.querySelectorAll('[data-panel]').forEach(button=>{
    const active=button.dataset.panel===id;
    button.setAttribute('aria-selected',String(active));
    $(`panel-${button.dataset.panel}`).hidden=!active;
  });
}
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>selectControlPanel(button.dataset.panel)));
document.querySelector('.control-tabs').addEventListener('keydown',event=>{
  const buttons=[...document.querySelectorAll('[data-panel]')],index=buttons.indexOf(event.target);
  if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
  selectControlPanel(buttons[next].dataset.panel);buttons[next].focus();
});
let layoutMode='preview';
const zoomByLayout={preview:false,development:true};
try{const saved=JSON.parse(localStorage.getItem('orbit-view-settings')||'{}');if(['preview','development'].includes(saved.layout))layoutMode=saved.layout;for(const key of Object.keys(zoomByLayout))if(typeof saved.zoom?.[key]==='boolean')zoomByLayout[key]=saved.zoom[key];}catch{}
function applyLayout(mode){
  layoutMode=mode;document.body.dataset.layout=mode;
  document.querySelectorAll('button[data-layout]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.layout===mode)));
  const closeup=zoomByLayout[mode];$('device').closest('.preview').classList.toggle('screen-closeup',closeup);
  $('screenZoom').setAttribute('aria-pressed',String(closeup));$('screenZoom').textContent=closeup?'Show whole device':'Screen close-up';
  try{localStorage.setItem('orbit-view-settings',JSON.stringify({layout:mode,zoom:zoomByLayout}));}catch{}
}
document.querySelectorAll('button[data-layout]').forEach(button=>button.addEventListener('click',()=>applyLayout(button.dataset.layout)));
on('screenZoom','click',()=>{zoomByLayout[layoutMode]=!zoomByLayout[layoutMode];applyLayout(layoutMode);});
on('previewCancel','click',()=>voice.stop());
applyLayout(layoutMode);
on('themeSelect','change',()=>{
  selectedTheme=resolveTheme($('themeSelect').value).id;
  document.body.dataset.theme=selectedTheme;
  $('themeDescription').textContent=resolveTheme(selectedTheme).description;
  try { localStorage.setItem('orbit-theme',selectedTheme); } catch { }
  setup.theme=selectedTheme;saveSetup();orbit.touch();log(`${resolveTheme(selectedTheme).name} theme selected.`);render();
});
on('expressionPreview','change',()=>{characterPreview=$('expressionPreview').value;orbit.touch();orbit.mode='companion';document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode==='companion')));render();});
on('themeMotion','change',()=>{themeMotion=$('themeMotion').checked;render();});
// The physical ring follows this tab through the device link (debounced while dragging).
let ledTimer=null;
function sendLeds(){clearTimeout(ledTimer);ledTimer=setTimeout(async()=>{
  try{const r=await fetch('/api/device/leds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:$('ledEnabled').checked,brightness:Number($('ledBrightness').value),color:$('ledColor').value,effect:Number($('ledEffect').value),speed:Number($('ledSpeed').value)})});const s=await r.json();if(!r.ok)throw Error(s.error);
    $('ledDeviceStatus').textContent=s.online?'Physical Orbit ring updated.':'Saved. Orbit applies it when it reconnects.';}
  catch{$('ledDeviceStatus').textContent='Could not reach the device link. Only the preview changed.';}},150);}
fetch('/api/device/state').then(r=>r.ok?r.json():null).then(s=>{
  if(!s?.leds){$('ledDeviceStatus').textContent='Device link unavailable: preview only.';return;}
  $('ledEnabled').checked=s.leds.on;$('ledBrightness').value=s.leds.brightness;$('ledValue').textContent=`${s.leds.brightness}%`;$('ledColor').value=s.leds.color;$('ledEffect').value=String(s.leds.effect??0);$('ledSpeed').value=String(s.leds.speed??1);
  $('ledDeviceStatus').textContent=s.online?'These controls drive the physical Orbit ring.':'Orbit is offline; changes apply when it reconnects.';render();
}).catch(()=>{$('ledDeviceStatus').textContent='Device link unavailable: preview only.';});
on('ledEnabled','change',()=>{render();sendLeds();});
on('ledBrightness','input',()=>{$('ledValue').textContent=`${$('ledBrightness').value}%`;render();sendLeds();});
on('ledColor','input',()=>sendLeds());
on('ledEffect','change',()=>sendLeds());
// "Pair Orbit with this PC": start a 60 s invitation, show the code, and watch for Orbit to connect.
let pairWatch=null;
on('orbitPairStart','click',async()=>{
  clearInterval(pairWatch);const status=$('orbitPairStatus');status.textContent='Starting…';
  try{const r=await fetch('/api/device/pair-start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const p=await r.json();if(!r.ok)throw Error(p.error);
    status.textContent=`Look at Orbit: tap YES when it shows code ${p.code} (pairing with ${p.name}).`;const started=Date.now();
    pairWatch=setInterval(async()=>{try{const s=await(await fetch('/api/device/state')).json();
      if(s.online&&!s.pairing){clearInterval(pairWatch);status.textContent=`Paired: Orbit is connected to this PC (${p.name}).`;}
      else if(Date.now()-started>62000){clearInterval(pairWatch);status.textContent='Pairing timed out. Is Orbit on and on the same Wi-Fi? Click to try again.';}}catch{}},2000);
  }catch(error){status.textContent='Could not start pairing: '+error.message;}
});
on('ledSpeed','change',()=>sendLeds());
function stopSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
on('pickup','click', () => { automaticCharacter();orbit.pickup();curiousUntil=Date.now()+3000;render(); });
on('sleep','click', () => { automaticCharacter();voice.disconnect();orbit.sleep(); stopSpeech(); render(); });
document.querySelectorAll('[data-tilt]').forEach(button => button.addEventListener('click', () => {
  sensor = button.dataset.tilt;
  document.querySelectorAll('[data-tilt]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
  log(sensor === 'flat' ? 'Lying flat: keep the last orientation.' : 'Waiting for a stable orientation…');
}));
on('rotationLock','change', () => { orbit.orientationLocked = $('rotationLock').checked; orbit.candidate = null; });
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  if(button.dataset.mode==='companion'){chooseScreen(21);return;}
  if(button.dataset.mode==='relay'){chooseScreen(22);return;}
  orbit.touch();
  orbit.mode = button.dataset.mode;
  if(orbit.mode==='companion'&&setup.enabled.includes(21)){legacyPage=21;$('legacyScreen').value='21';$('legacyDescription').textContent=screens[21].description;}
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
  render();
}));
on('security','change', () => { voice.stop();orbit.setSecurity($('security').value);setup.security=$('security').value;saveSetup();render(); });
on('quiet','change', () => { orbit.quiet = $('quiet').checked; if (orbit.quiet) stopSpeech(); log(orbit.quiet ? 'Quiet mode on: alerts stay visual.' : 'Quiet mode off.'); });
on('pickupRemarks','change', () => { orbit.pickupRemarks = $('pickupRemarks').checked; });
on('enableSound','change', () => { if (!$('enableSound').checked) stopSpeech(); else sound(); });
on('offline','change', () => { if($('offline').checked)voice.disconnect('Simulated Wi-Fi lost.');orbit.setConnected(!$('offline').checked); stopSpeech(); log(orbit.connected ? 'Connection restored.' : 'Offline: decisions cannot be sent.'); render(); });
on('sampleAlert','click', () => {
  if (!orbit.connected) { log('Offline: the sample request could not arrive.'); return; }
  orbit.receive({id:`demo-${++serial}`,title:'Share the project update?',detail:'Send a short progress summary to the project. This request is only a simulation.',expires:orbit.now + 300000});
  render();
});
function promptPin(action = null) {
  pinAction = action; $('pin').value = ''; $('pinError').textContent = ''; $('pinDialog').showModal(); $('pin').focus();
}
on('unlock','click', () => promptPin());
on('pinCancel','click', () => { pinAction = null; $('pinDialog').close(); });
on('pinDialog','cancel', () => { pinAction = null; });
on('pinForm','submit', async event => {
  event.preventDefault();
  if (Date.now() < blockedUntil) { $('pinError').textContent = 'Please wait 30 seconds before trying again.'; return; }
  if (await hashPin($('pin').value) !== (demoPinHash||await hashPin('2468'))) {
    failures++;
    if (failures >= 5) { blockedUntil = Date.now() + 30000; failures = 0; }
    $('pinError').textContent = 'That passcode did not match.'; $('pin').value = ''; return;
  }
  failures = 0;
  const action = pinAction;
  pinAction = null;
  orbit.unlock(true, action?.id);
  $('pinDialog').close();
  if (action) performDecision(action.id, action.decision);
  log('Orbit unlocked.'); render();
});
function performDecision(id, decision) {
  const result = orbit.decide(id, decision);
  if (result === 'passcode') promptPin({id,decision});
  if (result === 'offline') log('Decision not sent: reconnect first.');
  if (result === 'unavailable') log('This request is no longer available.');
  render();
}
on('approve','click', () => performDecision(displayedRequest,'approve'));
on('reject','click', () => performDecision(displayedRequest,'reject'));
on('snooze','click', () => { orbit.snooze(displayedRequest); render(); });
on('focusStart','click', () => { orbit.touch(); orbit.focusUntil = orbit.focusUntil ? null : orbit.now + 1500000; render(); });
function chooseScreen(id) {$('legacyScreen').value=String(id);$('legacyScreen').dispatchEvent(new Event('change'));}
on('legacyScreen','change', () => {
  orbit.touch(); legacyPage=Number($('legacyScreen').value);
  if([21,22].includes(legacyPage)&&!setup.enabled.includes(legacyPage)){setup.enabled.unshift(legacyPage);saveSetup();rebuildScreens();}
  const page=screens[legacyPage];orbit.mode=['focus','companion','relay'].includes(page.kind)?page.kind:'legacy';
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===orbit.mode)));
  $('legacyDescription').textContent=dashboardIds.includes(page.id)?'All eight readings, with a different focus. Animated demo data.':page.description;
  $('reviewDecision').value=review[legacyPage]||'undecided';render();document.dispatchEvent(new CustomEvent('orbit-panel-changed',{detail:page.kind}));
});
on('reviewDecision','change', () => {
  review[legacyPage]=$('reviewDecision').value;
  try { localStorage.setItem('orbit-screen-review',JSON.stringify(review)); } catch { log('Review choice kept for this session only.'); }
  log(`${screens[legacyPage].name}: ${$('reviewDecision').selectedOptions[0].text}. Nothing removed.`);
});

function saveSetup(){setup=normalizeSetup(setup);try{localStorage.setItem('orbit-setup',JSON.stringify(setup));$('setupStatus').textContent='Saved in this browser. Export to keep a portable copy.';}catch{$('setupStatus').textContent='Browser storage unavailable. Export your setup to keep it.';}applyAppearance();}
function applyAppearance(){$('screen').dataset.wallpaper=setup.wallpaper;$('screen').style.filter=`brightness(${setup.brightness/100})`;}
function rebuildScreens(){
  $('legacyScreen').replaceChildren();$('startScreen').replaceChildren();$('screenChoices').replaceChildren();
  for(const page of [...screens].sort((a,b)=>(a.id===21?-2:a.id===22?-1:a.id)-(b.id===21?-2:b.id===22?-1:b.id)).filter(p=>!retiredIds.includes(p.id))){
    const label=el('label');label.className='check';const input=el('input');input.type='checkbox';input.checked=setup.enabled.includes(page.id);input.setAttribute('aria-label',`Enable ${pageName(page)}`);
    input.addEventListener('change',()=>{if(!input.checked&&setup.enabled.length===1){input.checked=true;$('setupStatus').textContent='Keep at least one screen enabled.';return;}setup.enabled=input.checked?[...setup.enabled,page.id]:setup.enabled.filter(id=>id!==page.id);saveSetup();rebuildScreens();if(!setup.enabled.includes(legacyPage))chooseScreen(setup.start);});label.append(input,document.createTextNode(pageName(page)));$('screenChoices').append(label);
    if(setup.enabled.includes(page.id)||[21,22].includes(page.id))$('legacyScreen').add(new Option(pageName(page),String(page.id)));
    if(setup.enabled.includes(page.id))$('startScreen').add(new Option(pageName(page),String(page.id)));
  }
  $('legacyScreen').value=String(legacyPage);$('startScreen').value=String(setup.start);
}
$('wallpaper').value=setup.wallpaper;$('displayBrightness').value=setup.brightness;$('security').value=setup.security;orbit.setSecurity(setup.security);
for(const id of ['demoLoad','networkMbps','thermalWarm','thermalHigh']){$(id).value=setup[id];on(id,'change',()=>{setup[id]=id==='demoLoad'?$(id).value:Number($(id).value);saveSetup();for(const key of ['demoLoad','networkMbps','thermalWarm','thermalHigh'])$(key).value=setup[key];legacyRendered=null;render();});}
rebuildScreens();applyAppearance();
on('startScreen','change',()=>{setup.start=Number($('startScreen').value);saveSetup();});
on('wallpaper','change',()=>{setup.wallpaper=$('wallpaper').value;saveSetup();});
on('displayBrightness','input',()=>{setup.brightness=Number($('displayBrightness').value);saveSetup();});
function stepScreen(delta){const i=setup.enabled.indexOf(legacyPage);chooseScreen(setup.enabled[(i+delta+setup.enabled.length)%setup.enabled.length]);}
on('previousScreen','click',()=>stepScreen(-1));on('nextScreen','click',()=>stepScreen(1));
let swipeStart=null;
on('screen','pointerdown',e=>{if(!e.target.closest('button,input'))swipeStart={x:e.clientX,y:e.clientY};});
on('screen','pointerup',e=>{if(swipeStart&&Math.abs(e.clientX-swipeStart.x)>35&&Math.abs(e.clientX-swipeStart.x)>Math.abs(e.clientY-swipeStart.y))stepScreen(e.clientX<swipeStart.x?1:-1);swipeStart=null;});
on('changePinForm','submit',async e=>{e.preventDefault();const old=$('currentPin').value,next=$('newPin').value;if(!/^\d{4}$/.test(next)){$('changePinStatus').textContent='Use four digits.';return;}if(await hashPin(old)!==(demoPinHash||await hashPin('2468'))){$('changePinStatus').textContent='Current code did not match.';return;}demoPinHash=await hashPin(next);try{localStorage.setItem('orbit-demo-pin-hash',demoPinHash);}catch{}$('currentPin').value='';$('newPin').value='';$('changePinStatus').textContent='Demo passcode saved. It is not included in exports.';});
on('exportSetup','click',()=>{const blob=new Blob([JSON.stringify({...setup,theme:selectedTheme},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='orbit-setup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
on('importSetup','change',async()=>{try{const file=$('importSetup').files[0];if(!file)return;if(file.size>32000)throw Error('Setup file is too large.');const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.enabled))throw Error('Choose an Orbit setup export.');setup=normalizeSetup(data);selectedTheme=resolveTheme(setup.theme).id;$('themeSelect').value=selectedTheme;$('themeSelect').dispatchEvent(new Event('change'));$('wallpaper').value=setup.wallpaper;$('displayBrightness').value=setup.brightness;$('security').value=setup.security;orbit.setSecurity(setup.security);
for(const id of ['demoLoad','networkMbps','thermalWarm','thermalHigh'])$(id).value=setup[id];saveSetup();rebuildScreens();chooseScreen(setup.start);$('setupStatus').textContent='Setup imported. Your demo passcode was kept.';}catch(error){$('setupStatus').textContent=error.message;}finally{$('importSetup').value='';}});
async function bridge(path,body){const response=await fetch('/api/bridge/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw Error(result.error||'Companion unavailable.');return result;}
on('bridgeConnect','click',async()=>{try{$('bridgeStatus').textContent='Connecting companion and detecting USB board…';await bridge('start',{});await new Promise(r=>setTimeout(r,2500));await refreshBridge();await refreshDevicePorts();selectControlPanel('wifi');}catch(error){$('bridgeStatus').textContent=error.message;}});
let deviceProvisioning=false,deviceFirmwareRunning=false,devicePortsLoading=false,serialBeepBusy=false;
document.addEventListener('orbit-serial-busy',event=>{serialBeepBusy=event.detail;updateUsbControls();});
function updateUsbControls(){const blocked=deviceProvisioning||deviceFirmwareRunning||devicePortsLoading||serialBeepBusy,selected=!!$('usbPort').value;$('flashFirmware').disabled=blocked||!selected;$('deviceWifiSave').disabled=blocked||!selected;$('refreshPorts').disabled=blocked;$('usbPort').disabled=blocked;}
async function refreshBridge(){
  const s=await bridge('state');deviceFirmwareRunning=!!s.firmware?.running;
  $('bridgeStatus').textContent=s.online?'Companion connected · device online':'Companion running · device offline';
  $('bridgeConnect').textContent=s.online?'Companion connected':'Connect companion';
  if(s.online)$('deviceWifiStatus').textContent='Connected over Wi-Fi. Live device communication confirmed.';
  const d=s.device||{};
  $('deviceConnectionStatus').textContent=s.online?`Device online over Wi-Fi${d.firmware?' · '+d.firmware:''}${d.width&&d.height?' · '+d.width+' × '+d.height:''}${d.fps?' · '+d.fps.toFixed(1)+' FPS':''}.`:'Device offline. Start Orbit normally, check Wi-Fi details and the companion’s device address.';
  if(deviceFirmwareRunning){$('flashProgress').hidden=false;$('firmwareStatus').textContent='Uploading existing firmware…';}
  else{$('flashProgress').hidden=true;if(s.firmware?.status)$('firmwareStatus').textContent=s.firmware.status;}
  updateUsbControls();return s;
}
on('firmwareOpen','click',async()=>{$('firmwareDialog').showModal();try{const s=await refreshBridge();if(!$('deviceWifiAddress').value)$('deviceWifiAddress').value=s.device?.address||'';}catch(e){$('deviceConnectionStatus').textContent=e.message;}});
on('closeFirmware','click',()=>$('firmwareDialog').close());
on('firmwareWifiOpen','click',()=>{$('firmwareDialog').close();selectControlPanel('wifi');refreshBridge().then(s=>{if(!$('deviceWifiAddress').value)$('deviceWifiAddress').value=s.device?.address||'';}).catch(e=>{$('deviceConnectionStatus').textContent=e.message;});});
on('wifiUsbOpen','click',()=>$('firmwareOpen').click());
async function refreshDevicePorts(){
  devicePortsLoading=true;updateUsbControls();const previous=$('usbPort').value;
  try{const inventory=await bridge('ports');$('usbPort').replaceChildren(new Option('Choose the ESP32 USB port',''));for(const port of inventory.ports||[])$('usbPort').add(new Option(`${port.device} · ${port.description||''}`,port.device));if([...$('usbPort').options].some(o=>o.value===previous))$('usbPort').value=previous;$('firmwareStatus').textContent='Choose the ESP32 port. Uploading replaces its current firmware.';$('deviceWifiStatus').textContent=(inventory.ports||[]).some(p=>/USB|CH340|CP210|ESP32|UART/i.test(p.description||''))?'Select the ESP32 port above. Wi-Fi pairing does not reflash the board.':'No clearly identified ESP32 USB port found. Check the data cable; a built-in COM1 port is usually not your board.';}
  catch(e){$('firmwareStatus').textContent=e.message;}finally{
    if(!$('usbPort').value){const candidates=[...$('usbPort').options].filter(o=>/CH340|CP210|ESP32|USB.SERIAL|USB UART/i.test(o.text));if(candidates.length===1)$('usbPort').value=candidates[0].value;}
    if($('usbPort').value)$('deviceWifiStatus').textContent='USB board selected: '+$('usbPort').value+'. Ready to send Wi-Fi details.';
    devicePortsLoading=false;updateUsbControls();}
}
on('refreshPorts','click',refreshDevicePorts);
on('usbPort','change',updateUsbControls);
on('flashFirmware','click',async()=>{
  if(!confirm('Upload the existing Orbit Companion firmware to '+$('usbPort').value+'? The new browser designs are not in this firmware.'))return;
  deviceFirmwareRunning=true;updateUsbControls();
  try{$('flashProgress').hidden=false;const result=await bridge('flash',{port:$('usbPort').value});$('firmwareStatus').textContent=result.status||'Upload started.';deviceFirmwareRunning=!!result.running;}
  catch(e){$('firmwareStatus').textContent=e.message;$('flashProgress').hidden=true;deviceFirmwareRunning=false;}finally{updateUsbControls();}
});
on('deviceWifiShowPassword','change',()=>{$('deviceWifiPassword').type=$('deviceWifiShowPassword').checked?'text':'password';});
on('wifiScan','click',async()=>{
  $('wifiScan').disabled=true;$('wifiScanStatus').textContent='Reading nearby networks from Windows…';
  try{const {networks}=await bridge('networks');$('wifiNetworks').replaceChildren(new Option('Choose your Wi-Fi network',''));
    for(const network of networks){const option=new Option(network.ssid+(network.compatible?' · 2.4 GHz available':' · 2.4 GHz not detected'),network.ssid);$('wifiNetworks').add(option);}
    $('wifiScanStatus').textContent='Select your network to fill its exact name. Signal is measured at this PC, not at Orbit.';
  }catch(error){$('wifiScanStatus').textContent=error.message;}finally{$('wifiScan').disabled=false;}
});
on('wifiNetworks','change',()=>{if($('wifiNetworks').value)$('deviceWifiSsid').value=$('wifiNetworks').value;});
on('deviceWifiForm','submit',async e=>{
  e.preventDefault();if(deviceProvisioning||deviceFirmwareRunning)return;
  const payload={port:$('usbPort').value,ssid:$('deviceWifiSsid').value,password:$('deviceWifiPassword').value,address:$('deviceWifiAddress').value.trim()};
  $('deviceWifiPassword').value='';deviceProvisioning=true;updateUsbControls();$('deviceWifiStatus').textContent='Sending Wi-Fi details over USB and waiting for pairing acknowledgment…';
  try{const result=await bridge('provision',payload);$('deviceWifiStatus').textContent=result.status;await refreshBridge();}
  catch(error){$('deviceWifiStatus').textContent=error.message;}
  finally{payload.password='';deviceProvisioning=false;updateUsbControls();}
});
on('deviceConnectionCheck','click',async()=>{try{await refreshBridge();}catch(e){$('deviceConnectionStatus').textContent=e.message;}});
setInterval(()=>{if(($('firmwareDialog').open||!$('panel-wifi').hidden)&&!deviceProvisioning)refreshBridge().catch(e=>{$('deviceConnectionStatus').textContent=e.message;});},3000);
const privacy=initPrivacy({log});
let voiceToken=null;
const voice=initVoice({
  canStart({terminal=false}={}){automaticCharacter();orbit.touch();if(orbit.locked){promptPin();return false;}if(!orbit.connected)return false;chooseScreen(terminal?22:21);voiceToken=orbit.listen();stopSpeech();render();return voiceToken!==null;},
  onState(state,message){if(voiceToken!==null&&orbit.advanceVoice(voiceToken,state)){if(message)orbit.line=message.slice(0,180);render();}},log
});
orbit.pickup();chooseScreen(setup.start);render();
document.addEventListener('orbit-select-panel',e=>chooseScreen(e.detail==='relay'?22:21));
