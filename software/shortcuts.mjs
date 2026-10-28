import {spawn,execFile} from 'node:child_process';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
// The six App launcher buttons on Orbit. Only shortcuts saved here can be started from the device.
export const SYSTEM_ACTIONS={cleanup:'Privacy cleanup',lock:'Lock PC',signout:'Sign out'};
const expand=value=>String(value||'').replace(/%([^%]+)%/g,(m,name)=>process.env[name]??m).replace(/^~(?=$|[\\/])/,os.homedir());
async function folder(value){
  if(!value)return '';const p=path.resolve(expand(value));
  try{if((await stat(p)).isDirectory())return p;}catch{}throw Error('The working folder does not exist.');
}
// items: requested shortcuts; installed: Start-menu apps from inventory(); previous: currently saved ones
// (so an app that is temporarily missing from the Start menu can stay).
export async function validateShortcuts(items,installed=[],previous=[]){
  if(!Array.isArray(items)||items.length>6)throw Error('Choose up to six shortcuts.');
  const known=new Map([...previous,...installed].map(a=>[a.id,a]));const chosen=[];
  for(const item of items){
    if(!item||typeof item!=='object')throw Error('Invalid shortcut.');
    const kind=item.kind||'app';
    if(kind==='app'){const app=known.get(item.id);if(!app||(app.kind||'app')!=='app')throw Error('Choose an app from the detected list.');chosen.push({kind:'app',id:app.id,name:String(app.name).slice(0,60)});continue;}
    if(kind==='system'){if(!Object.hasOwn(SYSTEM_ACTIONS,item.action))throw Error('Choose a supported system shortcut.');chosen.push({kind:'system',id:'system:'+item.action,name:SYSTEM_ACTIONS[item.action],action:item.action});continue;}
    if(kind!=='executable'&&kind!=='command')throw Error('Choose an app, program or command.');
    const name=String(item.name||'').trim();if(!name||name.length>60)throw Error('Give the shortcut a name of up to 60 characters.');
    const result={kind,id:/^[\w-]{1,64}$/.test(item.id||'')?item.id:randomUUID(),name,cwd:await folder(item.cwd),show_terminal:item.show_terminal===true};
    if(kind==='executable'){
      const p=path.resolve(expand(item.path));let ok=false;try{ok=(await stat(p)).isFile()&&p.toLowerCase().endsWith('.exe');}catch{}
      if(!ok)throw Error('Choose an existing .exe file.');
      const args=String(item.arguments||'');if(args.length>4000||/[\0\r\n]/.test(args))throw Error('Arguments must be one line, up to 4000 characters.');
      Object.assign(result,{path:p,arguments:args});
    }else{
      const command=String(item.command||'').trim();if(!command||command.length>4000||command.includes('\0'))throw Error('Enter a command of up to 4000 characters.');
      result.command=command;
    }
    chosen.push(result);
  }
  return chosen;
}
// Recent command runs, shown under "Command results" in the console.
const runs=[];
export function shortcutRuns(){return runs.map(r=>({...r}));}
export function launchShortcut(item,{start=spawn}={}){
  const kind=item.kind||'app',cwd=item.cwd||undefined;
  if(kind==='app'){start('explorer.exe',['shell:AppsFolder\\'+item.id],{detached:true,stdio:'ignore'}).unref();return 'Opened '+item.name.slice(0,20);}
  // Verbatim arguments: the program sees them exactly as typed, like a Windows shortcut's Target box.
  if(kind==='executable'){
    start(item.path,item.arguments?[item.arguments]:[],{cwd,argv0:`"${item.path}"`,windowsVerbatimArguments:true,detached:true,stdio:'ignore'}).unref();
    return 'Started '+item.name.slice(0,20);
  }
  if(runs.filter(r=>r.state==='Running').length>=4)throw Error('Four commands are already running.');
  const run={id:randomUUID(),name:item.name,state:'Running',output:'',exit_code:null,at:Date.now()};runs.unshift(run);runs.splice(20);
  // cmd /s strips the outer quotes we add, so the command line runs as typed. A visible run gets its own
  // console window (detached) and stays open (/k); a hidden one is captured for "Command results".
  const comspec=process.env.ComSpec||'C:\\Windows\\System32\\cmd.exe',visible=item.show_terminal===true;
  const child=start(comspec,['/d','/s',visible?'/k':'/c',`"${item.command}"`],{cwd,argv0:`"${comspec}"`,windowsVerbatimArguments:true,...(visible?{detached:true,stdio:'ignore',windowsHide:false}:{windowsHide:true})});
  child.on('error',()=>{run.state='Failed';run.output='Could not start. Check the command and working folder.';});
  const add=chunk=>{run.output=(run.output+chunk.toString()).slice(-16000);};
  child.stdout?.on('data',add);child.stderr?.on('data',add);
  child.on('exit',code=>{run.exit_code=code;run.state=visible?'Opened':code===0?'Finished':'Failed';});
  if(visible)child.unref();
  return 'Started '+item.name.slice(0,20);
}
// Start-menu apps, for choosing app shortcuts.
export function startMenuApps(){
  return new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[Text.Encoding]::UTF8;@(Get-StartApps | Sort-Object Name | ForEach-Object { @{name=$_.Name;id=$_.AppID} }) | ConvertTo-Json -Compress'],{windowsHide:true,timeout:30000,maxBuffer:4<<20},(error,stdout)=>{
    if(error)return resolve([]);try{const list=JSON.parse(String(stdout).trim()||'[]');resolve((Array.isArray(list)?list:[list]).filter(a=>a?.id&&a?.name));}catch{resolve([]);}
  }));
}
