import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {nearbyNetworks} from './wifi-networks.mjs';
const companion='http://127.0.0.1:8910';
async function upstream(path,body,token){
  const response=await fetch(companion+'/api/'+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(path==='inventory'?45000:path==='provision'?25000:6000),headers:body?{'Content-Type':'application/json','X-Orbit-Token':token,Origin:companion}:{},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Orbit Companion rejected the request.');return data;
}
export function validateProvision(body={}){
  const {port,ssid,password='',address=''}=body;
  if(typeof port!=='string'||!/^COM\d{1,4}$/i.test(port))throw Error('Refresh USB ports and choose your ESP32.');
  if(typeof ssid!=='string'||!ssid.length||Buffer.byteLength(ssid,'utf8')>32||/[\r\n\t\x00]/.test(ssid))throw Error('Enter a Wi-Fi name of up to 32 bytes, without line breaks.');
  if(typeof password!=='string'||Buffer.byteLength(password,'utf8')>63||/[\r\n\t\x00]/.test(password))throw Error('Check the Wi-Fi password. Leave it blank only for an open network.');
  if(typeof address!=='string'||address.length>253||(address&&!/^[a-z\d.-]+$/i.test(address)))throw Error('Enter only the device IP address or local hostname.');
  return {port,ssid,password,address};
}
export async function bridgeRequest(action,method,body){
  if(action==='networks'&&method==='GET')return nearbyNetworks();
  if(action==='start'&&method==='POST'){
    try{await upstream('state');return {status:'Companion already running'};}catch{}
    const exe=join(process.env.LOCALAPPDATA||'','Programs','OrbitCompanion','OrbitCompanion.exe');
    await access(exe).catch(()=>{throw Error('Orbit Companion is not installed. The demo still works.');});
    const child=spawn(exe,[],{detached:true,stdio:'ignore',windowsHide:true});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    return {status:'Companion starting'};
  }
  const state=await upstream('state').catch(()=>{throw Error('Companion unavailable. Click Connect companion first.');});
  if(state.product!=='OrbitCompanion')throw Error('The local service is not Orbit Companion.');
  if(action==='state'&&method==='GET'){
    const status=state.state?.status||{};
    return {online:!!state.state?.online,paired:!!state.profile?.paired,device:{address:String(state.profile?.address||''),firmware:String(status.firmware||''),width:Number(status.width)||0,height:Number(status.height)||0,fps:Number(status.fps)||0,packets:Number(status.packets)||0},firmware:{running:!!state.firmware?.running,status:String(state.firmware?.result||'')}};
  }
  if(action==='ports'&&method==='GET'){const inventory=await upstream('inventory');return {ports:(inventory.ports||[]).map(p=>({device:p.id,description:p.name}))};}
  if(action==='flash'&&method==='POST'){
    if(typeof body.port!=='string'||!/^COM\d{1,4}$/i.test(body.port))throw Error('Select a detected Windows USB port.');
    const result=await upstream('flash',{port:body.port},state.token);return {running:!!result.running,status:String(result.result||'')};
  }
  if(action==='provision'&&method==='POST'){
    const clean=validateProvision(body);
    if(state.firmware?.running)throw Error('Wait for the firmware upload to finish, then restart the board normally.');
    const inventory=await upstream('inventory');
    if(!(inventory.ports||[]).some(p=>p.id===clean.port))throw Error('That USB port is no longer connected. Refresh ports and try again.');
    try{
      await upstream('provision',{port:clean.port,ssid:clean.ssid,password:clean.password},state.token);
    }catch(error){
      if(/No pairing acknowledgment/i.test(error.message))throw Error('The board did not acknowledge pairing. Release BOOT, tap RESET, close other serial apps, then retry.');
      throw Error('Wi-Fi setup did not complete. Check the USB cable, selected port, and that Orbit firmware is running normally, then retry.');
    }
    if(clean.address&&clean.address!==state.profile?.address){
      try{await upstream('save',{address:clean.address},state.token);}
      catch{throw Error('Wi-Fi was sent, but the companion address could not be saved. Open Companion setup to set the device address.');}
    }
    return {status:'USB pairing acknowledged and Wi-Fi details sent. Waiting for the device to connect over Wi-Fi.',acknowledged:true};
  }
  throw Error('Unsupported companion action.');
}
