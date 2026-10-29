import test from 'node:test';
import assert from 'node:assert/strict';
import {findScreen,runOrbitTool,runPcAudioTool,orbitTool} from './orbit-tools.mjs';
import {validateProfile} from './profile.mjs';

test('the voice finds Orbit screens by loose names', () => {
  assert.equal(findScreen('Orbit Run').id,27);assert.equal(findScreen('sweep').id,26);assert.equal(findScreen('Home').id,0);
  assert.equal(findScreen('visualizer').id,109);assert.equal(findScreen('nonsense'),undefined);
  assert.ok(orbitTool().parameters.properties.screen.enum.includes('Sound machine'));
});
test('control_orbit opens screens and sends Orbit actions', async () => {
  const sent=[];const send=d=>{sent.push(d);return true;};
  assert.match(await runOrbitTool({action:'open_screen',screen:'Orbit Run'},{send}),/Opened Orbit Run/);
  assert.match(await runOrbitTool({action:'ring_lights_off'},{send}),/off/);
  assert.deepEqual(sent,[{type:'feed',screen:'27'},{type:'orbit-do',action:'ring-off'}]);
  assert.match(await runOrbitTool({action:'open_screen',screen:'Moon'},{send}),/no screen/);
  assert.match(await runOrbitTool({action:'rotate'},{send:()=>false}),/not connected/);
});
test('control_pc_audio presses media keys and steps the volume', async () => {
  const keys=[];let level=50;const tools={mediaKey:async k=>{keys.push(k);},volume:async v=>{if(v!==undefined)level=v;return level;}};
  assert.match(await runPcAudioTool({action:'next'},tools),/next/);assert.deepEqual(keys,['next']);
  assert.match(await runPcAudioTool({action:'louder'},tools),/60 percent/);
  assert.match(await runPcAudioTool({action:'set_volume',level:130},tools),/100 percent/);
});
test('home shortcuts: up to 8 known, different tiles', () => {
  assert.deepEqual(validateProfile({home_keys:[27,200,109]}).home_keys,[27,200,109]);
  assert.throws(()=>validateProfile({home_keys:[1,1]}),/home shortcuts/);
  assert.throws(()=>validateProfile({home_keys:[1,2,3,4,5,6,7,8,9]}),/home shortcuts/);
  assert.throws(()=>validateProfile({home_keys:[16]}),/home shortcuts/);
});
