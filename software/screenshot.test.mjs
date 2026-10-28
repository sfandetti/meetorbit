import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {rgb332ToPng,orbitScreen} from './screenshot.mjs';

test('an RGB332 frame becomes a PNG with the right size and colours',()=>{
  const png=rgb332ToPng(Buffer.from([0xe0,0x1c,0x03,0xff,0x00,0x00]),3,2);
  assert.deepEqual([...png.subarray(0,8)],[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  assert.equal(png.readUInt32BE(16),3);assert.equal(png.readUInt32BE(20),2);
  const idat=png.indexOf('IDAT'),raw=inflateSync(png.subarray(idat+4,idat+4+png.readUInt32BE(idat-4)));
  assert.deepEqual([...raw.subarray(1,10)],[255,0,0,0,255,0,0,0,255]);  // red, green, blue
  assert.deepEqual([...raw.subarray(11,14)],[255,255,255]);
  assert.throws(()=>rgb332ToPng(Buffer.alloc(5),3,2),/Expected 6 bytes/);
});

test('orbitScreen asks Orbit with the token and only the options given',async()=>{
  let asked;
  const fetcher=async(url,options)=>{asked={url,auth:options.headers.Authorization};return new Response(Buffer.alloc(4),{headers:{'x-width':'2','x-height':'2'}});};
  const shot=await orbitScreen({deviceIp:'10.0.0.5',httpPort:8080,token:'t',rot:0,page:5},{fetcher});
  assert.equal(asked.url,'http://10.0.0.5:8080/screen?rot=0&page=5');assert.equal(asked.auth,'Bearer t');
  assert.equal(shot.width,2);assert.equal(shot.height,2);
});
