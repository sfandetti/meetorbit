import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const folder=new URL('./.orbit-runtime/riley/',import.meta.url),file=new URL('connection.json',folder);
await mkdir(folder,{recursive:true});let settings;
try{settings=JSON.parse(await readFile(file,'utf8'));}catch{}
if(!settings?.binding?.threadId){
 if(!process.env.ORBIT_RILEY_THREAD_ID)throw Error('No assistant thread is paired on this installation. Provision an explicit thread; no default or fallback is allowed.');
 settings={binding:{threadId:process.env.ORBIT_RILEY_THREAD_ID,assistant:process.env.ORBIT_RILEY_ASSISTANT||'External assistant',owner:process.env.ORBIT_RILEY_OWNER||'the account owner',project:process.env.ORBIT_RILEY_PROJECT||'Selected project',target:process.env.ORBIT_RILEY_TARGET||'Selected conversation'}};
}
if(typeof settings.token!=='string'||!Number.isFinite(settings.expiresAt)||settings.expiresAt<Date.now()+60000){settings={...settings,baseUrl:'http://127.0.0.1:8789',token:randomBytes(32).toString('hex'),expiresAt:Date.now()+12*60*60*1000,scope:['read','message'],humanApprovalsOnly:true};await writeFile(file,JSON.stringify(settings,null,2),{mode:0o600});}
console.log('Riley-only credential ready; token is stored privately, never printed.');
await import('./riley-relay.mjs').then(async({createRileyRelay})=>{const {createServer}=await import('node:http');const server=createServer(createRileyRelay({binding:settings.binding,token:settings.token,expiresAt:settings.expiresAt}));server.on('error',()=>{console.error('Riley relay could not start.');process.exitCode=1;});server.listen(8789,'127.0.0.1',()=>console.log('Assistant-specific text relay ready on port 8789.'));});
