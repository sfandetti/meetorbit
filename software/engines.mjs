// The AI engines Orbit can talk to (picked on Orbit's ENGINE view or in the console), and a short
// conversation with each, which Orbit's CONSOLE view shows.
// ChatGPT is OpenAI's realtime voice (it hears and speaks itself). Claude, DeepSeek and Cursor answer in
// text: OpenAI turns speech into text for them and their answer back into speech. Codex is the paired
// coding chat: what you say becomes a reviewed command (SEND / CANCEL on Orbit).
export const ENGINES=[
  {id:'chatgpt',name:'ChatGPT'},
  {id:'claude',name:'Claude',provider:'claude'},
  {id:'deepseek',name:'DeepSeek',provider:'deepseek'},
  {id:'cursor',name:'Cursor',provider:'cursor'},
  {id:'codex',name:'Codex'},
];
export const ENGINE_IDS=ENGINES.map(e=>e.id);
export const engineName=id=>ENGINES.find(e=>e.id===id)?.name||'ChatGPT';
export const VOICE_INSTRUCTIONS="You are Orbit, a small, friendly desk companion with an animated face. Your answer is spoken aloud through Orbit's speaker, so reply in one to three short sentences of plain speech: no lists, markdown, code or links. Be warm and expressive.";

// Orbit's picker shows an engine once its key is saved (Codex: once the paired Codex chat is connected).
// The console lists every engine. A model is picked automatically when a key is saved (main.mjs).
export const ENGINE_KEYS={chatgpt:'openai_key',claude:'claude_key',deepseek:'deepseek_key',cursor:'cursor_key'};
export function availableEngines({has,codexConnected=false}){
  return ENGINES.filter(e=>e.id==='codex'?codexConnected:has(ENGINE_KEYS[e.id]));
}
// A sensible model when none was chosen: the newest Sonnet for Claude (quick and smart enough to talk),
// DeepSeek's chat model, otherwise the first one listed.
export function defaultModel(provider,models){
  const list=[...models].sort().reverse();
  if(provider==='claude')return list.find(m=>/sonnet/.test(m))||list[0]||'';
  if(provider==='deepseek')return list.find(m=>m==='deepseek-chat')||list[0]||'';
  return list[0]||'';
}
// The link message that fills Orbit's picker: n engines as i0/t0 (id/name)..., and the current choice.
export function enginesMessage(list,selected){
  const out={type:'engines',sel:selected,n:String(list.length)};
  list.slice(0,6).forEach((e,i)=>{out['i'+i]=e.id;out['t'+i]=e.name;});
  return out;
}
// The last few turns with each engine (kept in memory; a restart starts fresh conversations).
export function createChats(limit=12){
  const chats=new Map();
  return {
    add(id,role,text){const t=String(text||'').trim();if(!t)return;const list=chats.get(id)||[];list.push({role,text:t});chats.set(id,list.slice(-limit));},
    list:id=>[...(chats.get(id)||[])],
    clear:id=>chats.delete(id),
  };
}
