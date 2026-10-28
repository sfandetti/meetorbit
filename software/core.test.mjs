import test from 'node:test';
import assert from 'node:assert/strict';
import { Orbit } from './core.mjs';
import { screens } from './catalog.mjs';
import { readFileSync } from 'node:fs';
const sample = (id='r1', expires=300000) => ({id,title:'Sample request',detail:'Private request details',expires});
test('all original screen names and ids are preserved in source order', () => {
  const source = readFileSync(new URL('./legacy-source/OrbitCompanion/app.py',import.meta.url),'utf8');
  const original = source.match(/^PAGES=\[(.*)\]/m)[1].match(/'[^']+'/g).map(s=>s.slice(1,-1));
  assert.deepEqual(screens.slice(0,21).map(s=>s.name),original);
  assert.deepEqual(screens.slice(0,21).map(s=>s.id),Array.from({length:21},(_,i)=>i));
  assert.equal(screens[21].kind,'companion');
});

test('pickup wakes; repeat movement does not repeat the pickup remark', () => {
  const o=new Orbit(); o.pickup(); assert.equal(o.state,'idle');
  o.pickup(); assert.equal(o.events.filter(e=>e.type==='pickup-remark').length,1);
  o.sleep(); o.tick(2000); o.pickup();
  assert.equal(o.events.filter(e=>e.type==='pickup-remark').length,1);
});
test('quiet pickup wakes without a remark; playful remarks can be disabled', () => {
  const o=new Orbit(); o.quiet=true; o.pickup(); assert.equal(o.state,'idle');
  assert.equal(o.events.some(e=>e.type==='pickup-remark'),false);
  o.sleep(); o.tick(61000); o.quiet=false; o.pickupRemarks=false; o.pickup();
  assert.equal(o.events.some(e=>e.type==='pickup-remark'),false);
});
test('orientation waits 650ms and rejects jitter', () => {
  const o=new Orbit(); o.sampleOrientation('landscape');
  o.tick(600); o.sampleOrientation('landscape'); assert.equal(o.orientation,'portrait');
  o.sampleOrientation('portrait'); o.tick(900); o.sampleOrientation('landscape');
  o.tick(1500); o.sampleOrientation('landscape'); assert.equal(o.orientation,'portrait');
  o.tick(1550); o.sampleOrientation('landscape'); assert.equal(o.orientation,'landscape');
});
test('flat posture and orientation lock preserve the last stable orientation', () => {
  const o=new Orbit(); o.sampleOrientation('landscape'); o.tick(700); o.sampleOrientation('landscape');
  o.sampleOrientation('flat'); o.tick(5000); o.sampleOrientation('flat'); assert.equal(o.orientation,'landscape');
  o.orientationLocked=true; o.sampleOrientation('portrait'); o.tick(9000); o.sampleOrientation('portrait');
  assert.equal(o.orientation,'landscape');
});
test('locked alerts wake Orbit but hide private details and block decisions', () => {
  const o=new Orbit(); o.setSecurity('idle'); o.receive(sample());
  assert.equal(o.state,'idle'); assert.equal(o.visibleRequest,null);
  assert.equal(o.decide('r1','approve'),'passcode'); assert.equal(o.decisions.length,0);
  o.unlock(true); assert.equal(o.visibleRequest.detail,'Private request details');
  assert.equal(o.decide('r1','approve'),'ok');
});
test('always-passcode binds a short-lived one-use grant to the exact request', () => {
  const o=new Orbit(); o.setSecurity('approval'); o.receive(sample()); o.receive(sample('r2'));
  o.unlock(true); assert.equal(o.decide('r1','approve'),'passcode');
  o.unlock(true,'r2'); assert.equal(o.decide('r1','approve'),'passcode');
  o.unlock(true,'r1'); assert.equal(o.decide('r1','approve'),'ok');
  assert.equal(o.decide('r2','approve'),'passcode'); assert.equal(o.decisions.length,1);
});
test('expired authorization cannot approve a pending request', () => {
  const o=new Orbit(); o.setSecurity('approval'); o.receive(sample()); o.unlock(true,'r1'); o.tick(15001);
  assert.equal(o.decide('r1','approve'),'passcode');
});
test('inactivity locks after 30 seconds; sleep locks immediately', () => {
  const o=new Orbit(); o.wake(); o.setSecurity('idle'); o.unlock(true);
  o.tick(29999); assert.equal(o.locked,false); o.tick(30000); assert.equal(o.locked,true);
  o.unlock(true); o.sleep(); o.pickup(); assert.equal(o.locked,true);
});
test('duplicate and expired requests cannot replay an approval', () => {
  const o=new Orbit(); assert.equal(o.receive(sample()),true); assert.equal(o.receive(sample()),false);
  assert.equal(o.decide('r1','approve'),'ok'); assert.equal(o.decide('r1','approve'),'unavailable');
  assert.equal(o.receive(sample()),false); assert.equal(o.receive(sample('old',0)),false);
});
test('expiration removes the pending request, including after an unlock prompt', () => {
  const o=new Orbit(); o.receive(sample('r1',100)); o.tick(101); o.unlock(true,'r1');
  assert.equal(o.active,undefined); assert.equal(o.decide('r1','approve'),'unavailable');
});
test('offline decisions remain pending and require fresh authorization on reconnect', () => {
  const o=new Orbit(); o.setSecurity('approval'); o.receive(sample()); o.unlock(true,'r1');
  o.setConnected(false); assert.equal(o.decide('r1','approve'),'offline'); assert.equal(o.requests.length,1);
  o.setConnected(true); assert.equal(o.decide('r1','approve'),'passcode');
});
test('snooze re-alerts once after one minute and survives sleep', () => {
  const o=new Orbit(); o.receive(sample()); assert.equal(o.snooze('r1'),true); assert.equal(o.active,undefined);
  o.sleep(); o.tick(59999); assert.equal(o.state,'sleeping'); o.tick(60000);
  assert.equal(o.state,'idle'); assert.equal(o.active.id,'r1');
  const alerts=o.events.filter(e=>e.type==='alert').length; o.tick(61000);
  assert.equal(o.events.filter(e=>e.type==='alert').length,alerts);
});
test('quiet alerts stay visible without sound; locked requests cannot be snoozed', () => {
  const o=new Orbit(); o.quiet=true; o.setSecurity('idle'); o.receive(sample());
  assert.equal(o.events.find(e=>e.type==='alert').audible,false); assert.equal(o.snooze('r1'),false);
});
test('sleep, disconnect and lock prevent old sample voice callbacks resuming a conversation', () => {
  for (const action of ['sleep','disconnect','lock']) {
    const o=new Orbit(); const token=o.listen();
    if(action==='sleep') o.sleep();
    if(action==='disconnect') o.setConnected(false);
    if(action==='lock') o.setSecurity('idle');
    assert.equal(o.advanceVoice(token,'speaking'),false,action);
  }
});
test('a newer conversation cancels callbacks from the older conversation', () => {
  const o=new Orbit(); const old=o.listen(); const current=o.listen();
  assert.equal(o.advanceVoice(old,'speaking'),false); assert.equal(o.advanceVoice(current,'thinking'),true);
});
test('focus completion is emitted only once', () => {
  const o=new Orbit(); o.focusUntil=1000; o.tick(1000); o.tick(2000);
  assert.equal(o.events.filter(e=>e.type==='focus-complete').length,1);
});
