import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceFeed,feedFields,newPasscode,passcodeMatches} from './device-feed.mjs';
import {DEFAULT_PROFILE} from './profile.mjs';
function harness(overrides={}){
  const sent=[],ran=[];let online=true,time=1000;
  const feed=createDeviceFeed({link:{send:m=>online&&(sent.push(m),true)},getProfile:()=>({...DEFAULT_PROFILE,name:'Seth',apps:[{name:'Spotify'}]}),now:()=>time,
    actions:{async execute(command,{askToConfirm}){ran.push(command);if(command==='privacy:signout')return askToConfirm('signout','Sign out?','Hold YES');if(command==='boom')throw Error('Shortcut missing');return 'Opened Spotify';},async confirmed(action){ran.push('confirmed:'+action);return 'Signing out of Windows';}},...overrides});
  return {feed,sent,ran,setOnline:v=>{online=v;},advance:ms=>{time+=ms;}};
}
test('feed fields are all strings and match the old /feed names the firmware reads',()=>{
  const f=feedFields({...DEFAULT_PROFILE,screens:[0,1,3],apps:[{name:'Spotify'}]},{pin:{pin_hash:'h',pin_salt:'s'}});
  assert.equal(f.enabled,'11');assert.equal(f.app0,'Spotify');assert.equal(f.app5,'Not set');assert.equal(f.quick1,'16');assert.equal(f.ai_clear,'1');assert.equal(f.pin_hash,'h');
  assert.ok(Object.values(f).every(v=>typeof v==='string'));
});
test('changes are pushed once; nothing is sent while Orbit is offline',()=>{
  const h=harness();h.feed.onConnect();assert.equal(h.sent.length,1);assert.equal(h.sent[0].type,'feed');assert.equal(h.sent[0].owner,'Seth');
  assert.equal(h.feed.push(),false);h.setOnline(false);h.feed.message('Hi','There');assert.equal(h.sent.length,1);
});
test('a button pressed on Orbit runs once and is acknowledged with its result',async()=>{
  const h=harness();h.feed.onConnect();
  await h.feed.onDeviceEvent({type:'command',id:'7',session:'a1',command:'app:0'});
  assert.deepEqual(h.ran,['app:0']);const last=h.sent.at(-1);assert.equal(last.command_ack,'7');assert.equal(last.command_session,'a1');assert.equal(last.command_result,'Opened Spotify');
  await h.feed.onDeviceEvent({type:'command',id:'7',session:'a1',command:'app:0'});assert.deepEqual(h.ran,['app:0']);
  await h.feed.onDeviceEvent({type:'command',id:'8',session:'a1',command:'boom'});assert.equal(h.sent.at(-1).command_result,'Shortcut missing');
});
test('sign out from Orbit waits for YES on the AI desk; NO or expiry does nothing',async()=>{
  const h=harness();h.feed.onConnect();
  await h.feed.onDeviceEvent({type:'command',id:'1',session:'s',command:'privacy:signout'});
  const ask=h.sent.at(-1);assert.equal(ask.ai_title,'Sign out?');assert.equal(ask.ai_attention,'1');
  await h.feed.onDeviceEvent({type:'desk-reply',id:ask.ai_id,reply:'NO'});assert.ok(!h.ran.includes('confirmed:signout'));
  await h.feed.onDeviceEvent({type:'command',id:'2',session:'s',command:'privacy:signout'});const again=h.sent.filter(m=>m.ai_title==='Sign out?').at(-1);
  h.advance(121000);await h.feed.onDeviceEvent({type:'desk-reply',id:again.ai_id,reply:'YES'});assert.ok(!h.ran.includes('confirmed:signout'));
  await h.feed.onDeviceEvent({type:'command',id:'3',session:'s',command:'privacy:signout'});const third=h.sent.filter(m=>m.ai_title==='Sign out?').at(-1);
  await h.feed.onDeviceEvent({type:'desk-reply',id:third.ai_id,reply:'YES'});assert.ok(h.ran.includes('confirmed:signout'));assert.equal(h.sent.at(-1).ai_body,'Signing out of Windows');
});
test('desk messages record the reply and expire after five minutes',async()=>{
  const h=harness();h.feed.onConnect();const id=h.feed.message('Ready?','Start the next task?');
  await h.feed.onDeviceEvent({type:'desk-reply',id,reply:'YES'});assert.equal(h.feed.reply().reply,'YES');
  h.feed.message('Later','x');h.advance(300001);h.feed.push();assert.equal(h.sent.at(-1).ai_expired,'1');
});
test('passcodes are salted hashes checked in constant time',()=>{
  const p=newPasscode('4321');assert.notEqual(p.pin_hash,'4321');assert.ok(passcodeMatches(p,'4321'));assert.ok(!passcodeMatches(p,'1234'));assert.ok(passcodeMatches({},'anything'));
  assert.throws(()=>newPasscode('12'),/four to six/);
});
