import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import * as dpapi from './dpapi.mjs';
import {DEFAULT_PROFILE} from './profile.mjs';
// Orbit's saved data in %LOCALAPPDATA%\Orbit: profile.json (plain settings) and secrets.json
// (API keys and the passcode hash, encrypted with Windows DPAPI for this user only).
export const SECRET_NAMES=['openai_key','claude_key','deepseek_key','cursor_key','pin_salt','pin_hash','hue_key'];
export function dataDir(){return join(process.env.LOCALAPPDATA||homedir(),'Orbit');}
async function atomic(file,text){const temp=file+'.tmp';await writeFile(temp,text,{encoding:'utf8',mode:0o600});await rename(temp,file);}
export async function createSettings({dir=dataDir(),protect=dpapi.protect,unprotect=dpapi.unprotect,importOld}={}){
  await mkdir(dir,{recursive:true});
  const profileFile=join(dir,'profile.json'),secretFile=join(dir,'secrets.json');
  let profile,secrets={},secretError='';
  try{profile={...DEFAULT_PROFILE,...JSON.parse(await readFile(profileFile,'utf8'))};}
  catch(error){
    if(error.code!=='ENOENT')throw Error(`Orbit settings could not be read (${profileFile}). Fix or delete that file.`);
    profile=await importOld?.().catch(()=>null)||{...DEFAULT_PROFILE};await atomic(profileFile,JSON.stringify(profile,null,2));
  }
  try{secrets=JSON.parse(await unprotect(JSON.parse(await readFile(secretFile,'utf8')).protected));}
  catch(error){if(error.code!=='ENOENT')secretError='Saved keys could not be unlocked on this Windows account. Enter them again.';}
  // Writes run one at a time so two quick saves can't interleave.
  let queue=Promise.resolve();const serial=job=>(queue=queue.then(job,job));
  return {
    profile:()=>structuredClone(profile),
    secret:name=>secrets[name]||'',
    has:name=>!!secrets[name],
    secretError:()=>secretError,
    // next must already be validated (validateProfile plus the shortcut/privacy checks).
    save:next=>serial(async()=>{await atomic(profileFile,JSON.stringify(next,null,2));profile=structuredClone(next);return structuredClone(profile);}),
    setSecrets:changes=>serial(async()=>{
      const next={...secrets};
      for(const [name,value] of Object.entries(changes)){if(!SECRET_NAMES.includes(name))throw Error('Unknown private setting.');if(value)next[name]=String(value);else delete next[name];}
      await atomic(secretFile,JSON.stringify({protected:await protect(JSON.stringify(next))}));secrets=next;secretError='';
    }),
  };
}
