import {readFile} from 'node:fs/promises';
const settings=JSON.parse(await readFile(new URL('./.orbit-runtime/riley/connection.json',import.meta.url),'utf8'));
const [action='status',requestId,text]=process.argv.slice(2);
let path,body;
if(action==='status')path='/api/status';
else if(action==='read')path='/api/conversation';
else if(action==='send'&&requestId&&text){path='/api/message';body={requestId,text};}
else{console.error('Use status, read, or send <unique-request-id> <message>.');process.exit(1);}
try{const response=await fetch(settings.baseUrl+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+settings.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();console.log(JSON.stringify(result,null,2));if(!response.ok)process.exitCode=1;}catch{console.error('Riley relay is unavailable. Do not send through the normal Orbit console as a fallback.');process.exitCode=1;}
