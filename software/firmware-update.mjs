import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
// Firmware updates over Wi-Fi (Orbit's POST /ota, see firmware/OrbitDevice/ota_update.h).
// Orbit has two app slots: main runs from one, the Bluetooth "Orbit Speaker" program sits in the other.
// A main update overwrites the speaker's slot, so main goes first (Orbit restarts into it), then the
// speaker is reinstalled into the slot the old main vacated (role=speaker: installed without switching).
export async function bundledFirmware(dir){
  const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
  const images=[];
  for(const image of manifest.images){
    const data=await readFile(path.join(dir,image.file));
    if(createHash('sha256').update(data).digest('hex')!==image.sha256)throw Error(`Firmware file ${image.file} is damaged. Reinstall Orbit.`);
    images.push({...image,data});
  }
  return {version:manifest.firmware,images};
}
async function sendImage({deviceIp,httpPort=80,token,image,fetcher}){
  const form=new FormData();form.append('firmware',new Blob([image.data],{type:'application/octet-stream'}),path.basename(image.file));
  const response=await fetcher(`http://${deviceIp}:${httpPort}/ota?role=${image.role}`,{method:'POST',headers:{Authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(240000)});
  const text=(await response.text().catch(()=>'')).trim();
  // An empty reply (dropped connection) counts as a failure too: Orbit keeps its previous firmware.
  if(!response.ok||!/^OK/.test(text))throw Error(`Orbit did not confirm the ${image.role} update${text?` (${text.slice(0,80)})`:''}. It keeps its previous firmware; try again.`);
  return text;
}
// link: the device link (status(), usbConfig()). progress(text) reports each step for the console.
export async function updateFirmware({link,firmware,progress=()=>{},fetcher=fetch,waitMs=90000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  const {token}=await link.usbConfig();
  async function waitOnline(after=0){
    const end=Date.now()+waitMs;
    // Wait for Orbit's status message too (s.firmware): it says which HTTP port to send firmware to.
    while(Date.now()<end){const s=link.status();if(s.online&&s.deviceIp&&s.firmware&&(!after||(s.connectedAt||0)>after))return s;await sleep(2000);}
    throw Error('Orbit did not reconnect. Check it is on, then try the update again.');
  }
  let s=await waitOnline();
  for(const image of [...firmware.images].sort((a,b)=>(a.role==='main'?0:1)-(b.role==='main'?0:1))){
    progress(`Sending ${image.role==='main'?'Orbit firmware':'Orbit Speaker'} (${(image.data.length/1048576).toFixed(2)} MB)…`);
    const startedAt=Date.now();await sendImage({deviceIp:s.deviceIp,httpPort:s.httpPort,token,image,fetcher});
    if(image.role==='main'){progress('Installed. Waiting for Orbit to restart…');s=await waitOnline(startedAt);}
  }
  progress(`Done. Orbit is running ${link.status().firmware||firmware.version}.`);
  return {version:firmware.version};
}
