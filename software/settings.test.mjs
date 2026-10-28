import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSettings} from './settings.mjs';
import {validateProfile,importCompanionProfile,DEFAULT_PROFILE} from './profile.mjs';
// Stand-in for DPAPI: reversible, but proves secrets are never written as plain text.
const fake={protect:async t=>Buffer.from('sealed:'+t).toString('base64'),unprotect:async s=>Buffer.from(s,'base64').toString().replace(/^sealed:/,'')};
async function temp(){return mkdtemp(join(tmpdir(),'orbit-settings-'));}

test('first run imports the old companion profile, later runs read the saved file',async()=>{
  const dir=await temp();try{
    const s=await createSettings({dir,...fake,importOld:async()=>importCompanionProfile({name:'Seth',theme:3,screens:[0,1,16,20],quick_taps:[17,16,18],camera_name:'Razer Kiyo'})});
    assert.equal(s.profile().name,'Seth');assert.equal(s.profile().theme,3);assert.deepEqual(s.profile().screens,[0,1,20]);assert.equal(s.profile().camera,'Razer Kiyo');
    const again=await createSettings({dir,...fake,importOld:async()=>{throw Error('should not import twice');}});
    assert.equal(again.profile().name,'Seth');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('secrets are stored sealed, survive a restart, and can be removed',async()=>{
  const dir=await temp();try{
    const s=await createSettings({dir,...fake});await s.setSecrets({openai_key:'sk-test-secret-value'});
    assert.ok(!(await readFile(join(dir,'secrets.json'),'utf8')).includes('sk-test-secret-value'));
    const again=await createSettings({dir,...fake});assert.equal(again.secret('openai_key'),'sk-test-secret-value');
    await again.setSecrets({openai_key:''});assert.equal(again.has('openai_key'),false);
    await assert.rejects(again.setSecrets({not_a_secret:'x'}),/Unknown private setting/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('keys sealed for another Windows account start empty with a clear note',async()=>{
  const dir=await temp();try{
    await writeFile(join(dir,'secrets.json'),JSON.stringify({protected:'bm90LW91cnM='}));
    const s=await createSettings({dir,protect:fake.protect,unprotect:async()=>{throw Error('wrong user');}});
    assert.equal(s.has('openai_key'),false);assert.match(s.secretError(),/Enter them again/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('profile validation keeps the firmware rules',()=>{
  const p=validateProfile({screens:[5,3],startup_page:16,quick_taps:[17,16,-1]});
  assert.deepEqual(p.screens,[0,3,5]);assert.throws(()=>validateProfile({screens:[3,16]}),/at least one screen/);assert.equal(p.startup_page,0);assert.deepEqual(p.quick_taps,[17,16,-1]);
  assert.throws(()=>validateProfile({name:'x'.repeat(25)}),/1-24/);
  assert.throws(()=>validateProfile({brightness:2}),/5-100/);
  assert.throws(()=>validateProfile({ai_provider:'gemini'}),/DeepSeek/);
  assert.equal(validateProfile({ai_provider:'deepseek'}).ai_provider,'deepseek');
  assert.deepEqual(validateProfile({}),{...DEFAULT_PROFILE,screens:[...DEFAULT_PROFILE.screens]});
});
