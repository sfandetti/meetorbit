import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,access,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPrivacy} from './privacy.mjs';
// Fixtures live in the system temp folder (under AppData), so tests clear the system-path block.
async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'orbit-privacy-test-')),folder=path.join(root,'selected'),second=path.join(root,'second'),profiles=path.join(root,'browser');
  await mkdir(path.join(folder,'nested'),{recursive:true});await mkdir(second);await writeFile(path.join(folder,'one.txt'),'Disposable Orbit test fixture');await writeFile(path.join(folder,'nested','two.txt'),'Second disposable fixture');await writeFile(path.join(second,'three.txt'),'Third disposable fixture');
  await mkdir(path.join(profiles,'Default','Network'),{recursive:true});await mkdir(path.join(profiles,'Default','Cache'));await writeFile(path.join(profiles,'Default','History'),'Invented history fixture, not a user database');await writeFile(path.join(profiles,'Default','Bookmarks'),'Preserve invented bookmarks');
  await writeFile(path.join(profiles,'Default','Network','Cookies'),'Invented cookie fixture');await writeFile(path.join(profiles,'Default','Cache','data_0'),'Invented cache fixture');
  const app=createPrivacy({systemPaths:[],browserRoots:{chrome:profiles},checkBrowsers:async()=>{}});
  return {root,folder,second,profiles,app,async cleanup(){const absolute=path.resolve(root),tmp=path.resolve(os.tmpdir());assert.equal(path.dirname(absolute).toLowerCase(),tmp.toLowerCase());assert.ok(path.basename(absolute).startsWith('orbit-privacy-test-'));await rm(absolute,{recursive:true,force:true});}};
}
test('emergency deletion requires both confirmations and preserves folders plus bookmarks',async()=>{
  const f=await fixture();try{
    await f.app.save({folders:[f.folder,f.second],browsers:['chrome_history']});const first=await f.app.prepare();assert.equal(first.files,4);
    await assert.rejects(f.app.commit(first.token),/Confirmation/);await access(path.join(f.folder,'one.txt'));
    const review=await f.app.prepare(),second=f.app.confirm(review.token);assert.notEqual(second.token,review.token);assert.throws(()=>f.app.confirm(review.token),/Confirmation/);
    const result=await f.app.commit(second.token);assert.equal(result.deleted,4);assert.equal(result.failed,0);assert.deepEqual(await readdir(f.folder),[]);assert.deepEqual(await readdir(f.second),[]);
    await access(path.join(f.profiles,'Default','Bookmarks'));await access(path.join(f.profiles,'Default','Network','Cookies'));await assert.rejects(access(path.join(f.profiles,'Default','History')));
    await writeFile(path.join(f.folder,'after.txt'),'Created after cleanup');assert.deepEqual(await f.app.commit(second.token),result);await access(path.join(f.folder,'after.txt'));
  }finally{await f.cleanup();}
});
test('cookies and cache are cleared only when chosen',async()=>{
  const f=await fixture();try{
    await f.app.save({folders:[],browsers:['chrome_cookies','chrome_cache']});const review=await f.app.prepare();assert.equal(review.files,2);
    await f.app.commit(f.app.confirm(review.token).token);
    await assert.rejects(access(path.join(f.profiles,'Default','Network','Cookies')));await assert.rejects(access(path.join(f.profiles,'Default','Cache')));
    await access(path.join(f.profiles,'Default','History'));await access(path.join(f.profiles,'Default','Bookmarks'));
  }finally{await f.cleanup();}
});
test('changed files invalidate reviewed deletion before any content is removed',async()=>{
  const f=await fixture();try{await f.app.save({folders:[f.folder],browsers:[]});const first=await f.app.prepare(),second=f.app.confirm(first.token);await writeFile(path.join(f.folder,'new.txt'),'Added after review');await assert.rejects(f.app.commit(second.token),/changed after review/);await access(path.join(f.folder,'one.txt'));await access(path.join(f.folder,'nested','two.txt'));}finally{await f.cleanup();}
});
test('changing cleanup setup invalidates old confirmations',async()=>{
  const f=await fixture();try{await f.app.save({folders:[f.folder],browsers:[]});const first=await f.app.prepare(),second=f.app.confirm(first.token);await f.app.save({folders:[],browsers:['chrome_history']});await assert.rejects(f.app.commit(second.token),/Confirmation/);await access(path.join(f.folder,'one.txt'));}finally{await f.cleanup();}
});
test('Cancel invalidates the final deletion token',async()=>{
  const f=await fixture();try{await f.app.save({folders:[f.folder],browsers:[]});const review=await f.app.prepare(),second=f.app.confirm(review.token);f.app.cancel(second.token);await assert.rejects(f.app.commit(second.token),/Confirmation/);await access(path.join(f.folder,'one.txt'));}finally{await f.cleanup();}
});
test('cleanup rejects protected folders, system folders, overlaps, root paths and unknown browser data',async()=>{
  const f=await fixture();try{
    await assert.rejects(createPrivacy({systemPaths:[],protectedPaths:[f.folder]}).save({folders:[f.folder],browsers:[]}),/outside system files/);
    await assert.rejects(createPrivacy().save({folders:[f.folder],browsers:[]}),/outside system files/);
    await assert.rejects(f.app.save({folders:[f.root,f.folder],browsers:[]}),/overlap/);
    await assert.rejects(f.app.save({folders:[path.parse(f.folder).root],browsers:[]}),/specific folder/);
    await assert.rejects(f.app.save({folders:[],browsers:['chrome_passwords']}),/Chrome, Edge or Brave/);
    await assert.rejects(f.app.save({folders:Array(13).fill(f.folder),browsers:[]}),/twelve/);
  }finally{await f.cleanup();}
});
test('folder links cannot escape into another target',async t=>{
  const f=await fixture();try{const target=path.join(f.root,'outside'),link=path.join(f.folder,'linked');await mkdir(target);await writeFile(path.join(target,'keep.txt'),'Disposable external fixture');try{await symlink(target,link,'junction');}catch(e){if(e.code==='EPERM'){t.skip('Host does not allow junction creation');return;}throw e;}await f.app.save({folders:[f.folder],browsers:[]});await assert.rejects(f.app.prepare(),/link or junction/);await access(path.join(target,'keep.txt'));}finally{await f.cleanup();}
});
