import {readFile,writeFile,mkdir} from 'node:fs/promises';
// Keep the already-running 8787 relay and its in-memory key intact.
const pairing=new URL('./.orbit-runtime/paired-thread.json',import.meta.url);
let saved;try{saved=JSON.parse(await readFile(pairing,'utf8'));}catch{}
const selected=process.env.ORBIT_CODEX_THREAD_ID||saved?.threadId||process.env.CODEX_THREAD_ID;
if(selected){process.env.ORBIT_CODEX_THREAD_ID=selected;if(selected!==saved?.threadId){await mkdir(new URL('./.orbit-runtime/',import.meta.url),{recursive:true});await writeFile(pairing,JSON.stringify({threadId:selected}),'utf8');}}
process.env.ORBIT_SIM_PORT=process.env.ORBIT_SIM_PORT||'8788';
process.env.ORBIT_VOICE_PROXY=process.env.ORBIT_VOICE_PROXY||'http://127.0.0.1:8787';
await import('./serve.mjs');
