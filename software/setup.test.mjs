import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSetup,dashboardIds,retiredIds,demoReadings,thermalStatus,networkStatus,metricDisplay} from './setup.mjs';
test('four dense dashboards replace sparse views without reusing legacy IDs',()=>{
  assert.deepEqual(dashboardIds,[3,6,7,11]);
  assert.ok(dashboardIds.every(id=>!retiredIds.includes(id)));
  assert.ok(retiredIds.every(id=>!normalizeSetup().enabled.includes(id)));
});
test('import rejects unknown screens, duplicates, invalid policy and empty selection',()=>{
  const s=normalizeSetup({enabled:[-1,3,3,200,'7',4],start:200,security:'anything',wallpaper:'https://tracker.invalid',brightness:150});
  assert.deepEqual(s.enabled,[3]);assert.equal(s.start,3);assert.equal(s.security,'off');assert.equal(s.wallpaper,'none');assert.equal(s.brightness,100);
  assert.deepEqual(normalizeSetup({enabled:[]}).enabled,[3]);
});
test('removing startup screen selects a remaining screen and exports no credential',()=>{
  const s=normalizeSetup({enabled:[17,6],start:3,pin:'1234',token:'private'});
  assert.equal(s.start,17);assert.equal('pin' in s,false);assert.equal('token' in s,false);
  assert.deepEqual(normalizeSetup(JSON.parse(JSON.stringify(s))),s);
});
test('companion and ChatGPT relay are separate panels with a one-time migration',()=>{assert.ok(normalizeSetup().enabled.includes(22));assert.deepEqual(normalizeSetup({enabled:[21,1]}).enabled,[21,22,1]);const optedOut=normalizeSetup({enabled:[21,1],panelsVersion:1});assert.deepEqual(optedOut.enabled,[21,1]);assert.deepEqual(normalizeSetup({enabled:[22],start:22}).enabled,[22]);});
test('animated sample metrics remain bounded and include all eight readings',()=>{
  const a=demoReadings(0),b=demoReadings(1500);assert.equal(a.length,8);assert.notDeepEqual(a,b);
  for(const m of b)assert.ok(Number.isFinite(m.value)&&m.value>=0);
});
test('thermal thresholds and network utilization drive colors and ring values',()=>{
  assert.equal(thermalStatus(69).tone,'green');assert.equal(thermalStatus(70).tone,'yellow');assert.equal(thermalStatus(90).tone,'red');
  assert.equal(networkStatus(100,{networkMbps:1000}).percent,80);assert.equal(networkStatus(100,{networkMbps:1000}).tone,'red');assert.equal(networkStatus(1,{networkMbps:1000}).tone,'cyan');
  assert.equal(metricDisplay({key:'temp',value:55}).percent,50);assert.equal(metricDisplay({key:'cpu',value:110}).percent,100);
  assert.ok(!normalizeSetup({enabled:[0,1]}).enabled.includes(0));
});
