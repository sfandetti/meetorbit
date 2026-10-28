import { lstat,readdir,realpath,unlink,rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
const relation=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
const key=p=>path.resolve(p).toLowerCase();
// Browser data Orbit can clear, per browser, for every standard local profile (Default, Profile N).
export const BROWSERS={chrome:'Chrome',edge:'Edge',brave:'Brave'};
export const BROWSER_PARTS={history:['History','History-journal','History-wal','History-shm'],
  cookies:['Network/Cookies','Network/Cookies-journal','Network/Cookies-wal','Network/Cookies-shm','Cookies','Cookies-journal','Cookies-wal','Cookies-shm'],
  cache:['Cache','Code Cache','GPUCache','Service Worker/CacheStorage']};
export const BROWSER_CHOICES=Object.keys(BROWSERS).flatMap(b=>Object.keys(BROWSER_PARTS).map(p=>`${b}_${p}`));
export function privacySettings(input={}){
  const folders=input.folders??[];
  if(!Array.isArray(folders)||folders.length>12||folders.some(f=>typeof f!=='string'||f.length>32767))throw Error('Choose up to twelve folders to empty.');
  if(!Array.isArray(input.browsers)||input.browsers.some(v=>!BROWSER_CHOICES.includes(v)))throw Error('Choose Chrome, Edge or Brave history, cookies or cache.');
  return {folders:folders.map(f=>f.trim()).filter(Boolean),browsers:[...new Set(input.browsers)].sort()};
}
// Emergency Delete / Privacy cleanup. Settings live in the caller's profile; save() validates them.
// Deleting always takes two confirmations and re-checks that nothing changed since the review.
const home=os.homedir();
const SYSTEM_PATHS=[process.env.SystemRoot,process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.ProgramData,path.join(home,'AppData')];
export function createPrivacy({protectedPaths=[],systemPaths=SYSTEM_PATHS,browserRoots,checkBrowsers}={}){
  let settings={folders:[],browsers:[]};const plans=new Map(),completed=new Map();
  const roots=browserRoots||{chrome:path.join(process.env.LOCALAPPDATA||'','Google','Chrome','User Data'),edge:path.join(process.env.LOCALAPPDATA||'','Microsoft','Edge','User Data'),brave:path.join(process.env.LOCALAPPDATA||'','BraveSoftware','Brave-Browser','User Data')};
  // Whole top-level personal folders are too broad: choose a subfolder of them.
  const tooBroad=[home,...['Desktop','Documents','Downloads','OneDrive','OneDrive/Desktop','OneDrive/Documents'].map(p=>path.join(home,p))].map(key);
  const blocked=[...systemPaths,...protectedPaths].filter(Boolean).map(key);
  async function noLinks(target){for(let current=path.resolve(target);;current=path.dirname(current)){const st=await lstat(current);if(st.isSymbolicLink())throw Error('Cleanup targets cannot contain links or junctions.');if(current===path.dirname(current))break;}}
  async function folderPath(folder){
    if(!path.isAbsolute(folder)||folder.startsWith('\\\\'))throw Error('Use a full local folder path. Network shares are not supported.');
    await noLinks(folder);const resolved=await realpath(folder),lower=key(resolved);const st=await lstat(resolved);
    if(!st.isDirectory()||lower===key(path.parse(resolved).root)||tooBroad.includes(lower)||blocked.some(p=>relation(lower,p)))throw Error('Choose a specific folder outside system files and the Orbit app.');return resolved;
  }
  async function resolveFolders(folders){
    const out=[];for(const f of folders){const p=await folderPath(f);if(out.some(o=>relation(key(o),key(p))))throw Error('Cleanup folders must not overlap.');out.push(p);}return out;
  }
  async function save(input){const next=privacySettings(input);next.folders=await resolveFolders(next.folders);settings=next;plans.clear();return structuredClone(settings);}
  async function browserClosed(names){
    if(checkBrowsers)return checkBrowsers(names);
    for(const name of names){const image=name+'.exe';const {stdout}=await run('tasklist.exe',['/fi',`IMAGENAME eq ${image}`,'/fo','csv','/nh'],{windowsHide:true,timeout:15000});if(stdout.toLowerCase().includes('"'+image+'"'))throw Error(`Close ${BROWSERS[name]} (including background processes), then try again. Orbit will not close it for you.`);}
  }
  async function snapshot(config){
    const folders=await resolveFolders(config.folders);const browsers=[...new Set(config.browsers.map(c=>c.split('_')[0]))];await browserClosed(browsers);const entries=[],seen=new Set();
    async function collect(target,allowedRoot,includeRoot=true){
      let st;try{st=await lstat(target);}catch(e){if(e.code==='ENOENT')return;throw e;}await noLinks(path.dirname(target));
      if(st.isSymbolicLink())throw Error('A cleanup target contains a link or junction.');
      const resolved=await realpath(target);if(key(resolved)!==key(allowedRoot)&&!key(resolved).startsWith(key(allowedRoot)+path.sep))throw Error('Cleanup target escaped the selected folder.');
      if(seen.has(key(resolved)))return;seen.add(key(resolved));
      if(includeRoot)entries.push({path:resolved,root:allowedRoot,dir:st.isDirectory(),size:st.size,mtime:st.mtimeMs,ino:String(st.ino)});
      if(entries.length>50000)throw Error('This cleanup contains over 50,000 items. Choose smaller folders.');
      if(st.isDirectory())for(const child of await readdir(resolved))await collect(path.join(resolved,child),allowedRoot);
    }
    for(const folder of folders)await collect(folder,folder,false);
    for(const choice of config.browsers){const [browser,part]=choice.split('_'),root=roots[browser];try{await lstat(root);}catch(e){if(e.code==='ENOENT')continue;throw e;}await noLinks(root);
      for(const profile of await readdir(root,{withFileTypes:true})){if(profile.name!=='Default'&&!/^Profile \d+$/.test(profile.name))continue;if(profile.isSymbolicLink())throw Error('Browser profile links are not supported.');if(!profile.isDirectory())continue;
        for(const name of BROWSER_PARTS[part])await collect(path.join(root,profile.name,...name.split('/')),root);
      }
    }
    entries.sort((a,b)=>a.path.localeCompare(b.path));const digest=createHash('sha256').update(JSON.stringify(entries)).digest('hex');return {entries,digest,folders};
  }
  function getPlan(token,stage){const plan=plans.get(token);if(!plan||plan.expires<Date.now()||plan.stage!==stage){plans.delete(token);throw Error('Confirmation expired or already used. Start the cleanup review again.');}return plan;}
  const summary=plan=>({folders:plan.config.folders,browsers:plan.config.browsers,files:plan.entries.filter(e=>!e.dir).length,bytes:plan.entries.filter(e=>!e.dir).reduce((n,e)=>n+e.size,0),warning:'Permanently empties the selected folders (the folders themselves stay) and clears the chosen local browser data for every standard profile. Bookmarks stay. Cookies sign you out of websites. Cloud services, sync and backups may keep copies; SSDs cannot guarantee unrecoverable deletion.'});
  async function prepare(){if(!settings.folders.length&&!settings.browsers.length)throw Error('Choose cleanup folders or browser data in Privacy first.');const snap=await snapshot(settings);if(!snap.entries.some(e=>!e.dir))throw Error('No files found in the selected cleanup targets.');for(const [id,p]of plans)if(p.expires<Date.now())plans.delete(id);if(plans.size>=8)plans.clear();const token=randomUUID(),plan={...snap,config:structuredClone(settings),stage:1,expires:Date.now()+120000};plans.set(token,plan);return {token,...summary(plan)};}
  function confirm(token){const plan=getPlan(token,1);plans.delete(token);const next=randomUUID();plan.stage=2;plans.set(next,plan);return {token:next,...summary(plan)};}
  async function commit(token){
    if(completed.has(token))return completed.get(token);
    const plan=getPlan(token,2);plans.delete(token);
    const operation=(async()=>{const now=await snapshot(plan.config);if(now.digest!==plan.digest)throw Error('Files changed after review. Review again before deleting.');
    let deleted=0,failed=0;for(const entry of [...plan.entries].sort((a,b)=>b.path.split(path.sep).length-a.path.split(path.sep).length)){
      try{await noLinks(entry.path);const resolved=await realpath(entry.path);if(key(resolved)!==key(entry.path))throw Error('Target changed');const st=await lstat(entry.path);if(!entry.dir&&(String(st.ino)!==entry.ino||st.size!==entry.size||st.mtimeMs!==entry.mtime))throw Error('File changed');if(entry.dir)await rmdir(entry.path);else{await unlink(entry.path);deleted++;}}catch{failed++;}
    }
    return {deleted,failed,status:failed?`${deleted} files deleted; ${failed} items could not be removed. Review the remaining items.`:`${deleted} files permanently deleted.`,folderRetained:true};})();
    completed.set(token,operation);setTimeout(()=>completed.delete(token),300000).unref();return operation;
  }
  return {settings:()=>structuredClone(settings),save,prepare,confirm,commit,cancel(token){plans.delete(token);return {cancelled:true};}};
}
