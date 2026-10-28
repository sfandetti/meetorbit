import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export function parseNetworks(output){
  const networks=[];let current;
  for(const line of output.split(/\r?\n/)){
    let match=line.match(/^\s*SSID\s+\d+\s*:\s?(.*)$/);
    if(match){current={ssid:match[1],compatible:false};if(current.ssid)networks.push(current);continue;}
    if(current&&(/^\s*Band\s*:\s*2\.4\s*GHz/i.test(line)||/^\s*Channel\s*:\s*(?:[1-9]|1[0-4])\s*$/.test(line)))current.compatible=true;
  }
  return [...new Map(networks.map(n=>[n.ssid,n])).values()].sort((a,b)=>Number(b.compatible)-Number(a.compatible)||a.ssid.localeCompare(b.ssid));
}
export async function nearbyNetworks(){
  try{const {stdout}=await run('netsh.exe',['wlan','show','networks','mode=bssid'],{windowsHide:true,timeout:15000,maxBuffer:1048576});
    const networks=parseNetworks(stdout);if(!networks.length)throw Error();return {networks};
  }catch{throw Error('Windows could not list nearby Wi-Fi networks. Check that this PC’s Wi-Fi is enabled and Windows location access allows Wi-Fi scanning, or enter the name manually.');}
}
