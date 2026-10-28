import test from 'node:test';
import assert from 'node:assert/strict';
import {availableEngines,enginesMessage,createChats,defaultModel} from './engines.mjs';
test('an engine appears in the picker once its key is saved; Codex once it is connected',()=>{
  const has=name=>['openai_key','claude_key','deepseek_key'].includes(name);
  assert.deepEqual(availableEngines({has}).map(e=>e.id),['chatgpt','claude','deepseek']);
  assert.deepEqual(availableEngines({has:n=>n==='cursor_key',codexConnected:true}).map(e=>e.id),['cursor','codex']);
});
test('a sensible model is picked when a key is saved',()=>{
  assert.equal(defaultModel('claude',['claude-haiku-5-5','claude-opus-5-5','claude-sonnet-5','claude-sonnet-5-5']),'claude-sonnet-5-5');
  assert.equal(defaultModel('deepseek',['deepseek-reasoner','deepseek-chat']),'deepseek-chat');
  assert.equal(defaultModel('claude',[]),'');
});
test('the picker message lists ids and names as strings Orbit can read',()=>{
  const m=enginesMessage([{id:'chatgpt',name:'ChatGPT'},{id:'claude',name:'Claude'}],'claude');
  assert.deepEqual(m,{type:'engines',sel:'claude',n:'2',i0:'chatgpt',t0:'ChatGPT',i1:'claude',t1:'Claude'});
});
test('each engine keeps its own short conversation',()=>{
  const chats=createChats(3);
  for(const t of ['a','b','c','d'])chats.add('claude','user',t);
  chats.add('deepseek','assistant','hi');chats.add('deepseek','user','  ');
  assert.deepEqual(chats.list('claude').map(m=>m.text),['b','c','d']);
  assert.deepEqual(chats.list('deepseek'),[{role:'assistant',text:'hi'}]);
});
