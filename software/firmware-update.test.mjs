import test from 'node:test';
import assert from 'node:assert/strict';
import {updateFirmware} from './firmware-update.mjs';
// A pretend Orbit: the main image restarts it (it reconnects later), the speaker image does not.
function fakeOrbit({reply=()=> 'OK 100 bytes'}={}){
  const sent=[];let connectedAt=1,now=10;
  const link={usbConfig:async()=>({token:'t'.repeat(64)}),status:()=>({online:true,deviceIp:'192.168.1.248',connectedAt,firmware:'CYD-M-LINK'})};
  const fetcher=async(url,options)=>{sent.push({url,auth:options.headers.Authorization});const text=reply(url);if(url.includes('role=main'))connectedAt=Date.now()+1;return {ok:!/^FAILED/.test(text),text:async()=>text};};
  return {link,fetcher,sent,sleep:async()=>{now++;}};
}
const firmware={version:'CYD-M-LINK',images:[{role:'speaker',file:'orbit-speaker.bin',data:Buffer.alloc(10)},{role:'main',file:'orbit-main.bin',data:Buffer.alloc(20)}]};
test('main is installed first, then the speaker, with the link token',async()=>{
  const o=fakeOrbit(),steps=[];
  await updateFirmware({link:o.link,firmware,fetcher:o.fetcher,sleep:o.sleep,progress:s=>steps.push(s)});
  assert.deepEqual(o.sent.map(s=>new URL(s.url).searchParams.get('role')),['main','speaker']);
  assert.equal(o.sent[0].auth,'Bearer '+'t'.repeat(64));assert.match(steps.at(-1),/Done/);
});
test('an empty or failed reply stops the update before the speaker',async()=>{
  const o=fakeOrbit({reply:()=>''});
  await assert.rejects(updateFirmware({link:o.link,firmware,fetcher:o.fetcher,sleep:o.sleep}),/did not confirm the main update/);
  assert.equal(o.sent.length,1);
});
test('Orbit that never reconnects after the main update is reported',async()=>{
  const o=fakeOrbit();o.link.status=()=>({online:true,deviceIp:'192.168.1.248',connectedAt:1});
  await assert.rejects(updateFirmware({link:o.link,firmware,fetcher:o.fetcher,sleep:o.sleep,waitMs:50}),/did not reconnect/);
});
