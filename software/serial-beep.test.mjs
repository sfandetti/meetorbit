import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createSerialBeep} from './serial-beep.mjs';

function fixture(options={}){
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  let input='';child.stdin.on('data',chunk=>{input+=chunk});child.kill=()=>{child.emit('close',1)};
  const timers=[];let now=1000,launches=0;
  const controller=createSerialBeep({ports:async()=>['COM4'],launch:()=>{launches++;return child},clock:()=>now,schedule:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer},cancel:timer=>{if(timer)timer.cancelled=true},...options});
  return {controller,child,timers,get input(){return input},get launches(){return launches},advance:ms=>{now+=ms},event:event=>{child.stdout.write(JSON.stringify({event})+'\n')}};
}
test('beep waits for board acknowledgment and countdown is bounded to one minute',async()=>{
  const f=fixture();await f.controller.start('com4');
  assert.equal(f.controller.state().phase,'starting');assert.equal(f.controller.state().endsAt,0);
  f.event('sent');assert.equal(f.controller.state().phase,'starting');
  f.event('started');assert.equal(f.controller.state().remainingSeconds,60);
  f.advance(13500);assert.equal(f.controller.state().remainingSeconds,47);
  f.event('complete');assert.equal(f.controller.state().busy,true);
  f.child.emit('close',0);assert.equal(f.controller.state().busy,false);assert.equal(f.controller.state().phase,'idle');
});
test('USB cannot be reused until helper has closed, including during Stop',async()=>{
  const f=fixture();await f.controller.start('COM4');f.event('started');
  await assert.rejects(f.controller.start('COM4'),/already in use/);
  assert.throws(()=>f.controller.reserve(),/Stop the board beep/);
  f.controller.stop();assert.equal(f.input,'STOP\n');assert.equal(f.controller.state().busy,true);
  await assert.rejects(f.controller.start('COM4'),/already in use/);
  f.child.emit('close',0);const release=f.controller.reserve();assert.equal(f.controller.state().busy,true);release();assert.equal(f.controller.state().busy,false);
});
test('device setup reservation blocks beeps without launching a serial process',async()=>{
  const f=fixture();const release=f.controller.reserve();
  await assert.rejects(f.controller.start('COM4'),/already in use/);assert.equal(f.launches,0);
  release();await f.controller.start('COM4');assert.equal(f.launches,1);f.child.emit('close',1);
});
test('busy ports and missing acknowledgment never claim the board is beeping',async()=>{
  for(const event of ['port-unavailable','no-ack','device-error','connection-error']){
    const f=fixture();await f.controller.start('COM4');f.event(event);f.child.emit('close',1);
    assert.equal(f.controller.state().phase,'error');assert.equal(f.controller.state().busy,false);assert.equal(f.controller.state().remainingSeconds,0);
    if(event==='port-unavailable')assert.match(f.controller.state().message,/Close other beep utilities/);
  }
});
test('invalid or unplugged ports do not spawn anything',async()=>{
  const f=fixture();
  for(const port of ['COM4\nSPEAKER REPEAT','COM4;whoami','file',null])await assert.rejects(f.controller.start(port),/Select/);
  await assert.rejects(f.controller.start('COM9'),/no longer connected/);assert.equal(f.launches,0);assert.equal(f.controller.state().busy,false);
});
test('unexpected helper exit and stalled Stop release ownership and report failure',async()=>{
  const f=fixture();await f.controller.start('COM4');f.event('started');f.child.emit('close',1);
  assert.equal(f.controller.state().phase,'error');assert.match(f.controller.state().message,/unexpectedly/);assert.equal(f.controller.state().busy,false);
  const g=fixture();await g.controller.start('COM4');g.event('started');g.controller.stop();
  assert.equal(g.timers.at(-1).ms,5000);g.timers.at(-1).fn();assert.equal(g.controller.state().busy,false);assert.equal(g.controller.state().phase,'error');
});
test('local recording exposes countdown, capture and playback only after firmware events',async()=>{
  const f=fixture();await f.controller.start('COM4','loopback');
  assert.equal(f.controller.state().mode,'loopback');assert.equal(f.timers[0].ms,28000);
  f.event('countdown');assert.equal(f.controller.state().phase,'countdown');assert.equal(f.controller.state().remainingSeconds,5);
  f.event('recording');assert.equal(f.controller.state().phase,'recording');assert.equal(f.controller.state().remainingSeconds,3);
  assert.throws(()=>f.controller.reserve(),/Stop/);
  f.event('playing');assert.equal(f.controller.state().phase,'playing');assert.match(f.controller.state().message,/speaker/);
  f.event('complete');assert.equal(f.controller.state().busy,true);f.child.emit('close',0);assert.equal(f.controller.state().busy,false);
});
test('unsupported audio modes cannot become helper arguments',async()=>{
  const f=fixture();await assert.rejects(f.controller.start('COM4','loopback;whoami'),/supported/);assert.equal(f.launches,0);
});
test('Stop during recording prevents late firmware events from restarting the UI',async()=>{
  const f=fixture();await f.controller.start('COM4','loopback');f.event('countdown');f.controller.stop();
  f.event('recording');assert.equal(f.controller.state().phase,'stopping');assert.equal(f.input,'STOP\n');f.child.emit('close',0);assert.equal(f.controller.state().busy,false);
});
test('capture counters and stage history survive completion for diagnosis',async()=>{
  const f=fixture();await f.controller.start('COM4','loopback');f.event('countdown');f.event('recording');
  f.child.stdout.write(JSON.stringify({event:'captured',frames:48000,peak:7800})+'\n');f.event('playing');f.event('complete');f.child.emit('close',0);
  assert.deepEqual(f.controller.state().capture,{frames:48000,peak:7800});assert.match(f.controller.state().message,/completed/);
  assert.deepEqual(f.controller.state().lastEvents.map(e=>e.event),['countdown','recording','captured','playing','complete']);
});
