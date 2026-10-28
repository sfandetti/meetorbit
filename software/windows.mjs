import {execFile,spawn} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
// Windows helpers the console and Orbit's buttons use. Each runs one fixed PowerShell script;
// nothing typed by a user is ever placed inside a script.
export function powershell(script,{timeout=20000}={}){
  const encoded=Buffer.from('[Console]::OutputEncoding=[Text.Encoding]::UTF8;'+script,'utf16le').toString('base64');
  return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout,maxBuffer:1<<20},(error,stdout)=>error?reject(Error('Windows could not complete that action.')):resolve(String(stdout).trim())));
}
export async function lockPC(){await powershell("Add-Type -Name L -Namespace OrbitLock -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool LockWorkStation();';if(-not [OrbitLock.L]::LockWorkStation()){throw 'lock'}");return 'PC locked';}
export function signOut(){spawn('shutdown.exe',['/l'],{detached:true,stdio:'ignore',windowsHide:true}).unref();return 'Signing out of Windows';}

// "Start Orbit when I sign in to Windows": a per-user Run entry pointing at this program.
const RUN_KEY='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export async function setStartWithWindows(enabled,command){
  if(enabled&&!command)throw Error('Start-up command unknown.');
  const value=Buffer.from(String(command||''),'utf8').toString('base64');
  await powershell(enabled?`New-ItemProperty -Path '${RUN_KEY}' -Name 'Orbit' -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${value}'))) -PropertyType String -Force | Out-Null`
    :`Remove-ItemProperty -Path '${RUN_KEY}' -Name 'Orbit' -ErrorAction SilentlyContinue`);
}

// What the active media player is doing (Playing, Paused...), for the music icon on Orbit.
export async function mediaPlayback(){
  try{
    const value=await powershell("$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Runtime.WindowsRuntime;$t=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime];$m=[System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1}|Select -First 1;$task=$m.MakeGenericMethod($t).Invoke($null,@($t::RequestAsync()));if(!$task.Wait(1500)){throw 'timeout'};$s=$task.Result.GetCurrentSession();if($null -eq $s){'None'}else{$s.GetPlaybackInfo().PlaybackStatus.ToString()}",{timeout:6000});
    return ['Playing','Paused','Stopped','Closed','Opened','Changing','None'].includes(value)?value:'Unknown';
  }catch{return 'Unknown';}
}

// Sentry alarm: a generated siren or buzzer (WAV), or a spoken "Intruder!".
export function alarmWav(sound){
  const rate=16000,samples=rate*2,pcm=Buffer.alloc(samples*2);let phase=0;
  for(let i=0;i<samples;i++){const t=i/rate,freq=sound==='siren'?550+400*Math.sin(t*Math.PI*3):(Math.floor(t*6)%2?220:440);phase+=2*Math.PI*freq/rate;
    pcm.writeInt16LE(Math.round(Math.sin(phase)*8000*Math.max(0,Math.min(1,t*20,(2-t)*20))),i*2);}
  const head=Buffer.alloc(44);head.write('RIFF',0);head.writeUInt32LE(36+pcm.length,4);head.write('WAVEfmt ',8);head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);
  head.writeUInt32LE(rate,24);head.writeUInt32LE(rate*2,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(pcm.length,40);
  return Buffer.concat([head,pcm]);
}
export function createAlarm({dataDir}){
  let child=null,run=0,active=false;  // run: bumped on every start/stop so an older loop ends itself
  async function playOnce(sound){
    if(sound==='intruder')return spawnPs("Add-Type -AssemblyName System.Speech;(New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('Intruder! Intruder!')");
    await mkdir(dataDir,{recursive:true});const file=path.join(dataDir,`alarm-${sound==='siren'?'siren':'retro'}.wav`);await writeFile(file,alarmWav(sound));
    return spawnPs(`(New-Object System.Media.SoundPlayer '${file.replace(/'/g,"''")}').PlaySync()`);
  }
  function spawnPs(script){
    return new Promise(resolve=>{child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore'});child.on('exit',()=>{child=null;resolve();});child.on('error',()=>{child=null;resolve();});});
  }
  function stop(){run++;active=false;child?.kill();child=null;}
  async function start(sound,loop=false){
    stop();const mine=run;active=true;
    do{await playOnce(sound);if(loop)await new Promise(r=>setTimeout(r,300));}while(loop&&mine===run);
    if(mine===run)active=false;
  }
  return {start(sound,loop){start(sound,loop).catch(()=>{active=false;});},stop,get active(){return active;}};
}
