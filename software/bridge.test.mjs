import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeRequest,validateProvision} from './bridge.mjs';

const fixture=()=>({product:'OrbitCompanion',token:'fixture-csrf',profile:{paired:true,address:'orbit.local',api_key:'must-not-leak'},state:{online:true,status:{firmware:'CYD-K',width:320,height:240,fps:17,packets:10,reply:'private'}},firmware:{running:false,result:'Ready'}});
function mockFetch(t,replies){const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});const data=replies.shift();return {ok:data?.ok!==false,json:async()=>data?.body??data};});return calls;}
test('provision validation rejects serial protocol injection and byte-overlong network names without echoing secrets',()=>{
  for(const body of [{port:'COM10',ssid:'x\nPAIR evil',password:'secret'},{port:'COM10',ssid:'界'.repeat(11),password:'secret'},{port:'COM10',ssid:'network',password:'x\tsecret'},{port:'file',ssid:'network'},{port:'COM10',ssid:'network',address:'http://host/path'}])assert.throws(()=>validateProvision(body));
  assert.equal(validateProvision({port:'COM10',ssid:'network',password:''}).password,'');
});
test('state exposes only connection metadata, never companion credentials or arbitrary device replies',async t=>{
  mockFetch(t,[fixture()]);const state=await bridgeRequest('state','GET',{});const text=JSON.stringify(state);
  assert.equal(state.device.firmware,'CYD-K');assert.equal(state.online,true);assert.ok(!/fixture-csrf|must-not-leak|private/.test(text));
});
test('provision refreshes live serial inventory, forwards credentials only upstream and waits for acknowledgment',async t=>{
  const calls=mockFetch(t,[fixture(),{ports:[{id:'COM10'}]},{status:'acknowledged'}]);
  const result=await bridgeRequest('provision','POST',{port:'COM10',ssid:'test-network',password:'test-password'});
  assert.equal(result.acknowledged,true);assert.equal(calls.length,3);assert.match(calls[1].url,/inventory$/);assert.match(calls[2].url,/provision$/);
  assert.deepEqual(JSON.parse(calls[2].options.body),{port:'COM10',ssid:'test-network',password:'test-password'});
  assert.equal(calls[2].options.headers['X-Orbit-Token'],'fixture-csrf');assert.ok(!JSON.stringify(result).includes('test-password'));
});
test('provision refuses removed ports and uploading boards before changing the device',async t=>{
  let calls=mockFetch(t,[fixture(),{ports:[{id:'COM1'}]}]);
  await assert.rejects(bridgeRequest('provision','POST',{port:'COM10',ssid:'test-network'}),/no longer connected/);assert.equal(calls.length,2);
  t.mock.restoreAll();const flashing=fixture();flashing.firmware.running=true;calls=mockFetch(t,[flashing]);
  await assert.rejects(bridgeRequest('provision','POST',{port:'COM10',ssid:'test-network'}),/upload to finish/);assert.equal(calls.length,1);
});
test('provision failure does not echo an upstream error containing credentials',async t=>{
  mockFetch(t,[fixture(),{ports:[{id:'COM10'}]},{ok:false,body:{error:'bad test-password'}}]);
  await assert.rejects(bridgeRequest('provision','POST',{port:'COM10',ssid:'test-network',password:'test-password'}),error=>!error.message.includes('test-password')&&/did not complete/.test(error.message));
});
test('optional address update changes only the companion address after pairing',async t=>{
  const calls=mockFetch(t,[fixture(),{ports:[{id:'COM10'}]},{status:'acknowledged'},{status:'saved'}]);
  await bridgeRequest('provision','POST',{port:'COM10',ssid:'test-network',address:'192.168.1.90'});
  assert.match(calls[3].url,/save$/);assert.deepEqual(JSON.parse(calls[3].options.body),{address:'192.168.1.90'});
});
