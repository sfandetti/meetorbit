import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DesktopLink} from './desktop-link.mjs';
const encode=value=>{const body=Buffer.from(JSON.stringify(value)),head=Buffer.alloc(4);head.writeUInt32LE(body.length);return Buffer.concat([head,body]);};
const request={id:17,method:'item/commandExecution/requestApproval',params:{threadId:'selected',turnId:'turn',itemId:'item',command:'echo fixture',availableDecisions:['accept','decline']}};
const responseFor=r=>({nonce:r.nonce,threadId:r.threadId,turnId:r.turnId,itemId:r.itemId,decision:'accept',proof:'fixture-only human approval'});
function fixture({owner='owner',authorizeDecision=async()=>true,initialRequests=[request],runtime='active',items=[]}={}){
  const sent=[];let socket,link;
  const snapshot=(requests=initialRequests)=>({type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:owner,params:{hostId:'local',conversationId:'selected',change:{type:'snapshot',revision:1,conversationState:{requests,threadRuntimeStatus:{type:runtime},turns:[{privateText:'Do not retain full history',items}],turnHistory:{history:{entitiesByKey:{turn:{turnId:'turn',status:runtime==='active'?'inProgress':'completed',turnStartedAtMs:1}}}}}}}});
  class Socket extends EventEmitter {
    destroyed=false;
    write(bytes){const frame=JSON.parse(bytes.subarray(4));sent.push(frame);queueMicrotask(()=>{
      if(this.destroyed)return;
      if(frame.type==='request'){const response={type:'response',requestId:frame.requestId,resultType:'success',handledByClientId:owner,result:frame.method==='initialize'?{clientId:'orbit'}:{}};this.emit('data',encode(response));}
      if(frame.type==='broadcast'&&frame.params.following)this.emit('data',encode(snapshot()));
    });}
    destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('close');}
  }
  link=new DesktopLink({threadId:'selected',authorizeDecision,timeout:100,connect:()=>{socket=new Socket();queueMicrotask(()=>socket.emit('connect'));return socket;}});
  const send=value=>socket.emit('data',encode(value));
  const patch=(patches,baseRevision=1,revision=2)=>send({type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:owner,params:{hostId:'local',conversationId:'selected',change:{type:'patches',baseRevision,revision,patches}}});
  return {link,sent,send,patch,snapshot};
}
test('Windows IPC discovers the exact live owner and subscribes without starting a turn',async()=>{
  const f=fixture();const result=await f.link.attach();assert.equal(result.selectedConversationVerified,true);assert.equal(result.approvalDeliveryVerified,false);assert.equal(f.link.broker.pending.size,1);assert.equal('turns' in f.link,false);
  assert.deepEqual(f.sent.filter(m=>m.type==='request').map(m=>m.method),['initialize','thread-owner-discovery']);f.link.close();assert.equal(f.sent.at(-1).params.following,false);
});
test('one-time decision goes to the native owner and stays submitted until stream resolution',async()=>{
  const f=fixture();await f.link.attach();const r=[...f.link.broker.pending.values()][0];await f.link.decide(responseFor(r));await new Promise(resolve=>setImmediate(resolve));
  const decision=f.sent.find(m=>m.method==='thread-follower-command-approval-decision');assert.equal(decision.targetClientId,'owner');assert.deepEqual(decision.params,{conversationId:'selected',requestId:17,decision:'accept'});
  assert.equal(r.state,'submitted');await assert.rejects(f.link.decide(responseFor(r)),/already answered/);
  f.patch([{op:'remove',path:['requests',0]}]);assert.equal(f.link.broker.pending.size,0);f.link.close();
});
test('foreign owner and thread broadcasts cannot inject an approval',async()=>{
  const f=fixture({initialRequests:[]});await f.link.attach();const forged=f.snapshot([request]);forged.sourceClientId='stranger';f.send(forged);assert.equal(f.link.broker.pending.size,0);forged.sourceClientId='owner';forged.params.conversationId='other';f.send(forged);assert.equal(f.link.broker.pending.size,0);f.link.close();
});
test('changed approval content invalidates a previously displayed approval token',async()=>{
  const f=fixture();await f.link.attach();const old=[...f.link.broker.pending.values()][0];f.patch([{op:'replace',path:['requests',0,'params','command'],value:'different fixture action'}]);
  await assert.rejects(f.link.decide(responseFor(old)),/stale/);assert.notEqual([...f.link.broker.pending.keys()][0],old.nonce);assert.ok(!f.sent.some(m=>m.method.includes('approval-decision')));f.link.close();
});
test('missing desktop owner fails without starting or resuming another session',async()=>{
  const f=fixture({owner:null});await assert.rejects(f.link.attach(),/No live desktop owner/);assert.ok(!f.sent.some(m=>m.method==='thread-stream-following-changed'));assert.equal(f.link.broker.connected,false);
});
test('stream gaps and unsupported versions invalidate pending approvals',async()=>{
  const f=fixture();await f.link.attach();f.patch([],999,1000);assert.equal(f.link.observed,false);assert.equal(f.link.broker.pending.size,0);
  const g=fixture();await g.link.attach();const m=g.snapshot();m.version=12;g.send(m);assert.equal(g.link.observed,false);
});
test('malicious patch paths fail closed and cannot modify prototypes',async()=>{
  const f=fixture();await f.link.attach();f.patch([{op:'add',path:['requests','__proto__','polluted'],value:true}]);assert.equal({}.polluted,undefined);assert.equal(f.link.observed,false);
});
test('without fresh user authorization native approval submission is refused',async()=>{
  const f=fixture({authorizeDecision:async()=>false});await f.link.attach();const r=[...f.link.broker.pending.values()][0];await assert.rejects(f.link.decide(responseFor(r)),/authorization/);assert.ok(!f.sent.some(m=>m.method.includes('approval-decision')));f.link.close();
});
test('commands steer the exact active turn once without permission or model overrides',async()=>{
  const f=fixture();await f.link.attach();assert.equal((await f.link.sendMessage('Continue this work')).state,'received-by-desktop');const sent=f.sent.filter(m=>m.method==='thread-follower-steer-turn');assert.equal(sent.length,1);assert.equal(sent[0].targetClientId,'owner');assert.equal(sent[0].params.conversationId,'selected');assert.equal(sent[0].params.expectedTurnId,'turn');assert.deepEqual(sent[0].params.input,[{type:'text',text:'Continue this work',text_elements:[]}]);assert.equal(sent[0].params.restoreMessage.context.prompt,'Continue this work');assert.equal('approvalPolicy' in sent[0].params,false);f.link.close();
});
test('idle commands start on the same owner and unknown runtime refuses delivery',async()=>{
  const f=fixture({runtime:'idle'});await f.link.attach();await f.link.sendMessage('Next task');const start=f.sent.find(m=>m.method==='thread-follower-start-turn');assert.equal(start.version,2);assert.equal(start.params.conversationId,'selected');assert.equal(start.params.turnStart.request.threadId,'selected');assert.equal(start.params.turnStart.context.inheritThreadSettings,true);f.link.close();const g=fixture({runtime:'unknown'});await g.link.attach();await assert.rejects(g.link.sendMessage('No delivery'),/not ready/);assert.ok(!g.sent.some(m=>m.method==='thread-follower-start-turn'));g.link.close();
});
test('permission responses grant only the exact requested permissions for this turn',async()=>{
 const scope={...request.params,permissions:{network:{enabled:true}}};const f=fixture({initialRequests:[{...request,method:'item/permissions/requestApproval',params:scope}]});await f.link.attach();const r=[...f.link.broker.pending.values()][0];await f.link.decide(responseFor(r));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.sent.find(m=>m.method==='thread-follower-permissions-request-approval-response').params.response,{permissions:{network:{enabled:true}},scope:'turn'});f.link.close();
});
test('question replies preserve explicit answers and reject missing answers before sending',async()=>{
 const f=fixture({initialRequests:[{...request,method:'item/tool/requestUserInput',params:{...request.params,questions:[{id:'choice',question:'Which one?'}]}}]});await f.link.attach();const r=[...f.link.broker.pending.values()][0];await assert.rejects(f.link.decide(responseFor(r)),/every question/);await f.link.decide({...responseFor(r),response:{answers:{choice:{answers:['First']}}}});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.sent.find(m=>m.method==='thread-follower-submit-user-input').params.response,{answers:{choice:{answers:['First']}}});f.link.close();
});
test('file approvals bind the displayed diff and refuse approval if that preview changes',async()=>{
 const f=fixture({initialRequests:[{...request,method:'item/fileChange/requestApproval'}],items:[{id:'item',type:'fileChange',changes:[{path:'fixture.txt',diff:'+ fixture-only change'}]}]});await f.link.attach();const old=[...f.link.broker.pending.values()][0];assert.equal(old.scope.actionPreview.changes[0].path,'fixture.txt');f.patch([{op:'replace',path:['turnHistory','history','entitiesByKey','turn','items',0,'changes'],value:[]}]);await assert.rejects(f.link.decide(responseFor(old)),/stale/);const next=[...f.link.broker.pending.values()][0];await assert.rejects(f.link.decide(responseFor(next)),/preview unavailable/);assert.ok(!f.sent.some(m=>m.method==='thread-follower-file-approval-decision'));f.link.close();
});
