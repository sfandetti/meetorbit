import {execFile} from 'node:child_process';
// Windows DPAPI (current user): only this Windows account on this PC can unlock the result.
// Data travels over stdin as base64 (never the command line, never a console code page), so secrets
// don't appear in process listings and any characters survive the round trip.
function powershell(script,input){
  return new Promise((resolve,reject)=>{
    const child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:20000,maxBuffer:1<<20},(error,stdout)=>error?reject(Error('Windows could not unlock private settings for this account.')):resolve(String(stdout).trim()));
    child.stdin.end(input);
  });
}
const RUN="Add-Type -AssemblyName System.Security;$in=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());[Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::";
export async function protect(text){return powershell(RUN+"Protect($in,$null,'CurrentUser')))",Buffer.from(String(text),'utf8').toString('base64'));}
export async function unprotect(sealed){return Buffer.from(await powershell(RUN+"Unprotect($in,$null,'CurrentUser')))",String(sealed)),'base64').toString('utf8');}
