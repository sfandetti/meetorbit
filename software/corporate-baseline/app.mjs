import { Orbit } from './core.mjs';
import { screens } from './catalog.mjs';
const $ = id => document.getElementById(id);
const orbit = new Orbit(Date.now());
orbit.orientation = 'landscape';
let sensor = 'landscape', serial = 0, audio, pinAction = null, failures = 0, blockedUntil = 0;
let displayedRequest = null;
let legacyPage = 0, watchElapsed = 0, watchStarted = null, musicPlaying = false;
let legacyRendered = null;
let review = {};
try { review = JSON.parse(localStorage.getItem('orbit-screen-review') || '{}'); } catch { /* Storage is optional. */ }
for (const page of screens) $('legacyScreen').add(new Option(`${String(page.id+1).padStart(2,'0')} · ${page.name}`,String(page.id)));
$('legacyDescription').textContent = screens[0].description;
function el(tag, text) { const e = document.createElement(tag); if(text !== undefined) e.textContent=text; return e; }
function demoButton(label, handler) { const b=el('button',label); b.addEventListener('click',()=>{orbit.touch();handler();});return b; }
function drawLegacy() {
  legacyRendered = legacyPage;
  const page=screens[legacyPage], root=$('legacyContent');
  $('legacyTitle').textContent=page.name;
  root.replaceChildren();
  const date=new Date();
  if(page.kind==='clock') {
    const time=el('div',date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));time.className=`legacy-time clock-${page.id}`;root.append(time,el('p',date.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})));
  } else if(page.kind==='binary') {
    const grid=el('div');grid.className='binary-grid';
    for(const [label,value] of [['H',date.getHours()],['M',date.getMinutes()],['S',date.getSeconds()]]) {
      const row=el('div');row.append(el('span',label));
      for(let bit=5;bit>=0;bit--){const dot=el('i');dot.className=value&(1<<bit)?'lit':'';row.append(dot);}grid.append(row);
    }root.append(grid);
  } else if(page.kind==='telemetry') {
    const values={3:[['CPU',28,'%'],['GPU',46,'%'],['RAM',61,'%']],4:[['CPU',28,'%']],5:[['GPU',46,'%']],6:[['CPU',49,'°C'],['GPU',54,'°C']],7:[['RX',12,'MB/s'],['TX',3,'MB/s']],8:[['RAM',61,'%']],9:[['READ',38,'MB/s'],['WRITE',12,'MB/s']],10:[['POWER',86,'W']],11:[['CPU',28,'%'],['GPU',46,'%'],['RAM',61,'%'],['RX',12,'MB/s'],['TX',3,'MB/s'],['DISK',38,'%']]};
    const grid=el('div');grid.className='gauges';
    for(const [name,value,unit] of values[page.id]) { const cell=el('div');cell.append(el('small',name),el('strong',`${value}${unit}`));const progress=el('progress');progress.max=100;progress.value=value;progress.setAttribute('aria-label',name);cell.append(progress);grid.append(cell); }root.append(grid,el('p','Illustrative readings · PC feed not connected'));
  } else if(page.kind==='stopwatch') {
    const elapsed=watchElapsed+(watchStarted===null?0:orbit.now-watchStarted),s=Math.floor(elapsed/1000);
    const time=el('div',`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`);time.className='legacy-time';root.append(time);
    root.append(demoButton(watchStarted===null?'Start':'Pause',()=>{if(watchStarted===null)watchStarted=orbit.now;else{watchElapsed+=orbit.now-watchStarted;watchStarted=null;}drawLegacy();}),demoButton('Reset',()=>{watchElapsed=0;watchStarted=null;drawLegacy();}));
  } else if(page.kind==='music') {
    root.append(el('p','Your music goes here'),el('div',musicPlaying?'♫ Playing sample':'♫ Paused'));
    for(const label of ['Previous',musicPlaying?'Pause':'Play','Next']) root.append(demoButton(label,()=>{if(label==='Play'||label==='Pause')musicPlaying=!musicPlaying;log(`Sample music control: ${label}.`);drawLegacy();}));
  } else if(page.kind==='launcher') {
    root.append(el('p','Your six selected shortcuts'));
    const grid=el('div');grid.className='launcher-grid';
    for(const name of ['Browser','Music','Notes','Calendar','Project','Custom'])grid.append(demoButton(name,()=>log(`Sample shortcut: ${name}. No program was launched.`)));root.append(grid);
  } else if(page.kind==='camera') {
    const image=el('div','Camera not connected');image.className='camera-placeholder';root.append(image);
    for(const label of ['Snapshot','Record','Sentry'])root.append(demoButton(label,()=>log(`Sample camera control: ${label}. No camera was accessed.`)));
  } else if(page.kind==='privacy') {
    root.append(el('p','Preview only. Your PC and files are untouched.'));
    for(const label of ['Review cleanup','Lock PC','Sign out'])root.append(demoButton(label,()=>log(`Sample privacy control: ${label}. No real action was performed.`)));
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
  const request = orbit.active;
  const locked = orbit.locked && orbit.state !== 'sleeping';
  const visible = orbit.visibleRequest;
  const hasRequest = !!request && orbit.state !== 'sleeping';
  $('device').className = `device ${orbit.state} ${orbit.orientation} ${hasRequest ? 'has-request' : ''} ${locked ? 'locked' : ''} ${orbit.connected ? '' : 'offline'}`;
  $('face').hidden = orbit.mode !== 'companion';
  $('homeCopy').hidden = orbit.mode !== 'companion';
  $('talk').hidden = orbit.mode !== 'companion';
  $('clockView').hidden = orbit.mode !== 'clock' || orbit.state === 'sleeping';
  $('focusView').hidden = orbit.mode !== 'focus' || orbit.state === 'sleeping';
  $('legacyView').hidden = orbit.mode !== 'legacy' || orbit.state === 'sleeping';
  if (orbit.mode === 'legacy') {
    if (legacyRendered !== legacyPage) drawLegacy();
    const page = screens[legacyPage], time = $('legacyContent').querySelector('.legacy-time');
    if (time && page.kind === 'clock') time.textContent = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
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
  $('line').textContent = orbit.line;
  $('connection').textContent = orbit.connected ? '● ONLINE' : '○ OFFLINE';
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
  $('caption').textContent = `${orbit.state[0].toUpperCase() + orbit.state.slice(1)} · ${orbit.orientation}${sensor === 'flat' ? ' held while flat' : ''} · ${orbit.requests.length} pending`;
  const date = new Date();
  $('clockTime').textContent = date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  $('clockDate').textContent = date.toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'});
  const seconds = orbit.focusUntil ? Math.max(0, Math.ceil((orbit.focusUntil - orbit.now) / 1000)) : 1500;
  $('focusTime').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`;
  $('focusStart').textContent = orbit.focusUntil ? 'End focus' : 'Start focus';
  for (const event of orbit.events.splice(0)) {
    if (event.type === 'wake') log(`Orbit woke up: ${event.reason}.`);
    if (event.type === 'sleep') log('Orbit went to sleep.');
    if (event.type === 'pickup-remark') speak('Oh, where are we going?');
    if (event.type === 'alert') { log(`Request waiting${event.audible ? '' : ' · quiet mode'}.`); if (event.audible) sound(); }
    if (event.type === 'orientation') log(`Layout changed to ${event.value}.`);
    if (event.type === 'demo-decision') log(`Sample ${event.id}: ${event.decision}. No real action was sent.`);
    if (event.type === 'snooze') log('Sample request snoozed for one minute.');
    if (event.type === 'focus-complete') { log('Focus session complete.'); if (event.audible) sound(); }
  }
}
function tick() { orbit.tick(Date.now()); orbit.sampleOrientation(sensor); render(); }
setInterval(tick, 200);
const on = (id, event, fn) => $(id).addEventListener(event, fn);
function stopSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
on('pickup','click', () => { orbit.pickup(); render(); });
on('sleep','click', () => { orbit.sleep(); stopSpeech(); render(); });
document.querySelectorAll('[data-tilt]').forEach(button => button.addEventListener('click', () => {
  sensor = button.dataset.tilt;
  document.querySelectorAll('[data-tilt]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
  log(sensor === 'flat' ? 'Lying flat: keep the last orientation.' : 'Waiting for a stable orientation…');
}));
on('rotationLock','change', () => { orbit.orientationLocked = $('rotationLock').checked; orbit.candidate = null; });
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  orbit.touch();
  orbit.mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
  render();
}));
on('security','change', () => { orbit.setSecurity($('security').value); render(); });
on('quiet','change', () => { orbit.quiet = $('quiet').checked; if (orbit.quiet) stopSpeech(); log(orbit.quiet ? 'Quiet mode on: alerts stay visual.' : 'Quiet mode off.'); });
on('pickupRemarks','change', () => { orbit.pickupRemarks = $('pickupRemarks').checked; });
on('enableSound','change', () => { if (!$('enableSound').checked) stopSpeech(); else sound(); });
on('offline','change', () => { orbit.setConnected(!$('offline').checked); stopSpeech(); log(orbit.connected ? 'Connection restored.' : 'Offline: decisions cannot be sent.'); render(); });
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
on('pinForm','submit', event => {
  event.preventDefault();
  if (Date.now() < blockedUntil) { $('pinError').textContent = 'Please wait 30 seconds before trying again.'; return; }
  if ($('pin').value !== '2468') {
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
on('talk','click', () => {
  const token = orbit.listen();
  if (token === null) { if (orbit.locked) promptPin(); render(); return; }
  log('Sample conversation started. No microphone is being recorded.'); render();
  setTimeout(() => { if (orbit.advanceVoice(token,'thinking')) render(); },1100);
  setTimeout(() => { if (orbit.advanceVoice(token,'speaking')) { speak('I’m right here. Let’s keep going.'); render(); } },2200);
  setTimeout(() => { if (orbit.advanceVoice(token,'idle')) render(); },4800);
});
on('focusStart','click', () => { orbit.touch(); orbit.focusUntil = orbit.focusUntil ? null : orbit.now + 1500000; render(); });
on('legacyScreen','change', () => {
  orbit.touch(); legacyPage=Number($('legacyScreen').value);
  const page=screens[legacyPage];orbit.mode=page.kind==='focus'?'focus':'legacy';
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed','false'));
  $('legacyDescription').textContent=page.description;
  $('reviewDecision').value=review[legacyPage]||'undecided';render();
});
on('reviewDecision','change', () => {
  review[legacyPage]=$('reviewDecision').value;
  try { localStorage.setItem('orbit-screen-review',JSON.stringify(review)); } catch { log('Review choice kept for this session only.'); }
  log(`${screens[legacyPage].name}: ${$('reviewDecision').selectedOptions[0].text}. Nothing removed.`);
});
render();
