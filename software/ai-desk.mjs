import {execFile} from 'node:child_process';
import {stat,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
// AI desk: one typed question -> a short answer shown on Orbit's screen. Four providers.
export const DESK_INSTRUCTIONS='You are Orbit, a helpful PC desk companion. Answer in under 200 characters for a small display. Do not claim to execute PC actions or approve actions in other applications.';
export const PROVIDER_KEYS={openai:'openai_key',claude:'claude_key',deepseek:'deepseek_key',cursor:'cursor_key'};
export const PROVIDER_NAMES={openai:'OpenAI',claude:'Claude',deepseek:'DeepSeek',cursor:'Cursor'};
const isFile=async p=>{try{return (await stat(p)).isFile();}catch{return false;}};
// How to start the Cursor CLI: {file,args} or null. Cursor's Windows installer puts versions in
// %LOCALAPPDATA%\cursor-agent\versions\<version>\ (its own node.exe + index.js) behind .cmd/.ps1 launchers;
// running that node.exe directly keeps the question away from any command shell. An explicit agent.exe
// (or one on PATH) also works.
export async function cursorCommand(configured=''){
  if(configured)return await isFile(configured)&&configured.toLowerCase().endsWith('.exe')?{file:path.resolve(configured),args:[]}:null;
  const versions=path.join(process.env.LOCALAPPDATA||'','cursor-agent','versions');
  try{
    const names=(await readdir(versions,{withFileTypes:true})).filter(d=>d.isDirectory()&&/^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/.test(d.name)).map(d=>d.name).sort().reverse();
    for(const name of names){const dir=path.join(versions,name);if(await isFile(path.join(dir,'node.exe'))&&await isFile(path.join(dir,'index.js')))return {file:path.join(dir,'node.exe'),args:[path.join(dir,'index.js')]};}
  }catch{}
  for(const p of [path.join(os.homedir(),'.local','bin','agent.exe'),...String(process.env.PATH||'').split(';').filter(Boolean).flatMap(dir=>[path.join(dir,'agent.exe'),path.join(dir,'cursor-agent.exe')])])
    if(await isFile(p))return {file:path.resolve(p),args:[]};
  return null;
}
// Where the Cursor CLI is (for the console), or ''.
export async function cursorBinary(configured=''){const c=await cursorCommand(configured);return c?c.args[0]||c.file:'';}
async function postJson(url,headers,body,fetcher){
  const response=await fetcher(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(providerError(response.status,data));
  return data;
}
// Keep the provider's own reason but never echo a key back.
function providerError(status,data){
  const reason=String(data?.error?.message||data?.message||'').replace(/sk-[\w-]+/g,'[redacted]').slice(0,160);
  return `${status===401?'The provider rejected the API key':`The provider returned ${status}`}${reason?': '+reason:''}. Check the key, model access and billing.`;
}
// history: earlier turns [{role:'user'|'assistant',text}] so a conversation can continue; instructions and maxTokens
// let Orbit's voice ask for short, spoken-style answers.
export async function askDesk({provider,key,model,cursorPath='',prompt,workdir,history=[],instructions=DESK_INSTRUCTIONS,maxTokens=256},{fetcher=fetch,run=execFile}={}){
  const question=String(prompt||'').trim().slice(0,2000);if(!question)throw Error('Type a question first.');
  const earlier=history.slice(-10).map(m=>({role:m.role==='user'?'user':'assistant',content:String(m.text||'').slice(0,2000)})).filter(m=>m.content);
  if(provider==='cursor'){
    const command=await cursorCommand(cursorPath);if(!command)throw Error('Install Cursor CLI or choose its agent.exe in AI desk.');
    await mkdir(workdir,{recursive:true});
    // --trust: Cursor runs in Orbit's own empty AIWorkspace folder, in read-only Ask mode.
    const args=[...command.args,'--mode=ask','--print','--trust','--output-format','text',...(model?['--model',model]:[]),instructions+'\n\n'+earlier.map(m=>(m.role==='user'?'User: ':'You: ')+m.content).join('\n')+(earlier.length?'\n\n':'')+question];
    return new Promise((resolve,reject)=>run(command.file,args,{cwd:workdir,env:{...process.env,...(key?{CURSOR_API_KEY:key}:{})},windowsHide:true,timeout:90000,maxBuffer:1<<20},(error,stdout,stderr)=>{
      if(error)reject(Error(error.killed?'Cursor timed out. Try a shorter question.':`Cursor could not answer${String(stderr).trim()?': '+String(stderr).trim().split('\n').at(-1).slice(0,140):'. Check its API key.'}`));else resolve({answer:String(stdout).trim()});
    }));
  }
  if(!key)throw Error(`Save a ${PROVIDER_NAMES[provider]||''} API key in AI desk first.`);
  if(!model)throw Error('Choose a model in AI desk first.');
  if(provider==='claude'){
    const data=await postJson('https://api.anthropic.com/v1/messages',{'x-api-key':key,'anthropic-version':'2023-06-01'},{model,system:instructions,messages:[...earlier,{role:'user',content:question}],max_tokens:maxTokens},fetcher);
    return {answer:(data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(' ').trim(),usage:data.usage};
  }
  if(provider==='deepseek'){
    const data=await postJson('https://api.deepseek.com/chat/completions',{Authorization:'Bearer '+key},{model,messages:[{role:'system',content:instructions},...earlier,{role:'user',content:question}],max_tokens:maxTokens},fetcher);
    return {answer:String(data.choices?.[0]?.message?.content||'').trim(),usage:data.usage};
  }
  if(provider!=='openai')throw Error('Choose OpenAI, Claude, DeepSeek or Cursor.');
  const data=await postJson('https://api.openai.com/v1/responses',{Authorization:'Bearer '+key},{model,instructions,input:[...earlier,{role:'user',content:question}],max_output_tokens:Math.max(160,maxTokens)},fetcher);
  return {answer:(data.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join(' ').trim(),usage:data.usage};
}
// Models the saved key can use, for the AI desk model picker.
export async function deskModels({provider,key},{fetcher=fetch}={}){
  if(provider==='cursor')return [];
  if(!key)throw Error('Save an API key for the selected provider first.');
  const [url,headers]=provider==='claude'?['https://api.anthropic.com/v1/models?limit=100',{'x-api-key':key,'anthropic-version':'2023-06-01'}]
    :provider==='deepseek'?['https://api.deepseek.com/models',{Authorization:'Bearer '+key}]:['https://api.openai.com/v1/models',{Authorization:'Bearer '+key}];
  const response=await fetcher(url,{headers,signal:AbortSignal.timeout(15000)});const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(providerError(response.status,data));
  const ids=(data.data||[]).map(m=>String(m.id));
  // OpenAI lists every model family; keep the ones that answer text questions.
  return ids.filter(id=>provider!=='openai'||/^(gpt-|o\d)/.test(id)&&!/audio|realtime|transcribe|tts|image|search|codex/.test(id)).sort();
}
