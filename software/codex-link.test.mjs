import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexLink} from './codex-link.mjs';

async function fixture({loaded=['selected'],authorizeDecision=async()=>true}={}){
  const sent=[];let clock=0,link;
  link=new CodexLink({threadId:'selected',authorizeDecision,now:()=>clock,send:message=>{
    sent.push(message);if(!message.method||message.method==='initialized')return;
    const result=message.method==='thread/loaded/list'?{data:loaded}:message.method==='thread/resume'?{thread:{id:'selected'}}:{};
    queueMicrotask(()=>link.receive({id:message.id,result}));
  }});
  const ready=link.attach();return {link,sent,ready,tick:()=>clock+=120001};
}
const approval=(id=90,threadId='selected')=>({id,method:'item/commandExecution/requestApproval',params:{threadId,turnId:'turn',itemId:'item',command:'echo harmless fixture',reason:'Test request',availableDecisions:['accept','decline','cancel']}});
function answer(request,decision='accept'){return {nonce:request.nonce,threadId:request.threadId,turnId:request.turnId,itemId:request.itemId,decision,proof:'test-only human authorization'};}

test('attach only subscribes to the exact already-loaded conversation, never starts a turn',async()=>{
  const f=await fixture();await f.ready;assert.equal(f.link.connected,true);assert.deepEqual(f.sent.filter(m=>m.method).map(m=>m.method),['initialize','initialized','thread/loaded/list','thread/resume']);f.link.close();
});
test('refuses a missing desktop owner rather than loading a substitute session',async()=>{
  const f=await fixture({loaded:['other']});await assert.rejects(f.ready,/not loaded/);assert.equal(f.link.connected,false);assert.ok(!f.sent.some(m=>m.method==='thread/resume'));f.link.close();
});
test('a fresh human decision responds once and waits for native acknowledgment',async()=>{
  const f=await fixture();await f.ready;f.link.receive(approval());const request=[...f.link.pending.values()][0];
  assert.deepEqual(await f.link.decide(answer(request)),{state:'submitted'});assert.deepEqual(f.sent.at(-1),{id:90,result:{decision:'accept'}});
  await assert.rejects(f.link.decide(answer(request)),/already answered/);assert.equal(f.link.pending.size,1);
  f.link.receive({method:'serverRequest/resolved',params:{threadId:'selected',requestId:90}});assert.equal(f.link.pending.size,0);f.link.close();
});
test('foreign, expired, mismatched and persistent approval attempts never send a grant',async()=>{
  const f=await fixture();await f.ready;f.link.receive(approval(1,'other'));assert.equal(f.link.pending.size,0);
  f.link.receive(approval());const request=[...f.link.pending.values()][0],count=f.sent.length;
  await assert.rejects(f.link.decide({...answer(request),itemId:'different'}),/another action/);
  await assert.rejects(f.link.decide(answer(request,'acceptForSession')),/approve once/);f.tick();await assert.rejects(f.link.decide(answer(request)),/stale/);
  assert.equal(f.sent.length,count);f.link.close();
});
test('authorization is required and resolving during authorization prevents a late approval',async()=>{
  const denied=await fixture({authorizeDecision:undefined});await denied.ready;denied.link.authorizeDecision=undefined;denied.link.receive(approval());await assert.rejects(denied.link.decide(answer([...denied.link.pending.values()][0])),/authorization/);denied.link.close();
  let release;const f=await fixture({authorizeDecision:()=>new Promise(resolve=>release=resolve)});await f.ready;f.link.receive(approval());const pending=f.link.decide(answer([...f.link.pending.values()][0]));
  f.link.receive({method:'serverRequest/resolved',params:{threadId:'selected',requestId:90}});release(true);await assert.rejects(pending,/changed/);assert.ok(!f.sent.some(m=>m.result?.decision));f.link.close();
});
test('interruption and disconnect clear approvals and unrelated thread status is ignored',async()=>{
  const f=await fixture();await f.ready;f.link.receive({method:'thread/status/changed',params:{threadId:'other',status:{type:'active'}}});assert.equal(f.link.status,'monitoring');
  f.link.receive(approval());f.link.receive({method:'turn/completed',params:{threadId:'selected'}});assert.equal(f.link.pending.size,0);
  f.link.receive(approval(91));f.link.close();assert.equal(f.link.pending.size,0);assert.equal(f.link.connected,false);
});
test('a closed native conversation cannot receive later approval requests',async()=>{
  const f=await fixture();await f.ready;f.link.receive({method:'thread/closed',params:{threadId:'selected'}});f.link.receive(approval());assert.equal(f.link.connected,false);assert.equal(f.link.pending.size,0);f.link.close();
});
