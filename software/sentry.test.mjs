import test from 'node:test';
import assert from 'node:assert/strict';
import {smallFrames,motionPercent,bmp,W,H,FRAME} from './sentry.mjs';
const solid=(r,g,b)=>{const f=Buffer.alloc(FRAME);for(let i=0;i<FRAME;i+=3){f[i]=r;f[i+1]=g;f[i+2]=b;}return f;};
test('frames shrink to Orbit-sized RGB565 and grey',()=>{
  const {grey,rgb565}=smallFrames(solid(255,0,0));
  assert.equal(rgb565.length,160*90*2);assert.equal(rgb565.readUInt16BE(0),0xF800);assert.equal(grey.length,160*90);assert.ok(Math.abs(grey[0]-76.2)<0.1);
});
test('motion is the share of the picture that changed, and the background adapts',()=>{
  const dark=smallFrames(solid(0,0,0)).grey,bright=smallFrames(solid(200,200,200)).grey,background=Float32Array.from(dark);
  assert.equal(motionPercent(dark,background),0);
  assert.equal(motionPercent(bright,background),100);
  for(let i=0;i<300;i++)motionPercent(bright,background);  // a lasting change becomes the new normal
  assert.equal(motionPercent(bright,background),0);
});
test('snapshots are valid top-down 24-bit BMPs',()=>{
  const image=bmp(solid(10,20,30));
  assert.equal(image.toString('ascii',0,2),'BM');assert.equal(image.readInt32LE(18),W);assert.equal(image.readInt32LE(22),-H);
  assert.deepEqual([image[54],image[55],image[56]],[30,20,10]);  // stored blue, green, red
});
