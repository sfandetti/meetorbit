export function initPrivacy({log=()=>{}}={}){
  const $=id=>document.getElementById(id);let settings={folder:'',browsers:[]},token=null,stage=0,busy=false,committing=false,submitted=false;
  async function request(action,body){const r=await fetch('/api/privacy/'+action,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Cleanup could not be completed.');return data;}
  function message(text){$('privacyStatus').textContent=text;const device=document.querySelector('.privacy-target');if(device)device.textContent=text;}
  function describe(data){return [`Folder: ${data.folder||'(none — browser history only)'}`,`Browser history: ${data.browsers.length?data.browsers.map(b=>b[0].toUpperCase()+b.slice(1)).join(', ')+' · all standard profiles':'none'}`,`${data.files.toLocaleString()} files · ${(data.bytes/1024/1024).toFixed(1)} MB`,data.warning].join('\n\n');}
  async function begin(){
    if(busy)return;busy=true;submitted=false;message('Reviewing configured cleanup targets…');
    try{const plan=await request('prepare',{});token=plan.token;stage=1;$('privacyConfirmTitle').textContent='Big red button. Big consequences.';$('privacyConfirmDetail').textContent=describe(plan);$('privacyConfirmNext').textContent='Yes, continue';$('privacyConfirmNext').disabled=false;$('privacyDialogError').textContent='';$('privacyDialog').showModal();}catch(error){message(error.message);}finally{busy=false;}
  }
  $('privacyBrowse').addEventListener('click',async()=>{const button=$('privacyBrowse');button.disabled=true;try{const result=await request('browse',{});if(result.folder)$('privacyFolder').value=result.folder;}catch{message('Folder picker could not open. Paste the full folder path instead.');}finally{button.disabled=false;}});
  $('privacySave').addEventListener('click',async()=>{try{settings=await request('settings',{folder:$('privacyFolder').value,browsers:[...document.querySelectorAll('[data-clean-browser]:checked')].map(e=>e.dataset.cleanBrowser)});message('Cleanup targets saved. Nothing has been deleted.');}catch(error){message(error.message);}});
  function cancel(){if(committing)return;const previous=token;token=null;stage=0;if(previous)request('cancel',{token:previous}).catch(()=>{});message(submitted?'Review closed. A cleanup request was already sent; check its result.':'Cancelled. Nothing was deleted.');}
  $('privacyConfirmCancel').addEventListener('click',()=>{if(committing)return;cancel();$('privacyDialog').close();});
  $('privacyDialog').addEventListener('cancel',event=>{if(committing){event.preventDefault();return;}cancel();});
  $('privacyConfirmNext').addEventListener('click',async()=>{
    if(!token||busy)return;busy=true;$('privacyConfirmNext').disabled=true;$('privacyDialogError').textContent='';
    try{
      if(stage===1){const plan=await request('confirm',{token});token=plan.token;stage=2;$('privacyConfirmTitle').textContent='Double sure? No undo button after this.';$('privacyConfirmDetail').textContent=describe(plan)+'\n\nThe next button permanently deletes these local files. They do not go to the Recycle Bin.';$('privacyConfirmNext').textContent='Yes — permanently delete';}
      else if(stage===2){const finalToken=token;token=null;stage=0;committing=true;submitted=true;$('privacyConfirmCancel').disabled=true;const result=await request('commit',{token:finalToken});$('privacyDialog').close();message(result.status);log(`Emergency cleanup: ${result.deleted} files deleted; ${result.failed} items not removed.`);}
    }catch(error){token=null;stage=0;$('privacyDialogError').textContent=error.message+' Start a new review before trying again.';}
    finally{busy=false;committing=false;$('privacyConfirmCancel').disabled=false;$('privacyConfirmNext').disabled=!token;}
  });
  request('settings').then(value=>{settings=value;$('privacyFolder').value=value.folder;document.querySelectorAll('[data-clean-browser]').forEach(e=>e.checked=value.browsers.includes(e.dataset.cleanBrowser));message(value.folder||value.browsers.length?'Cleanup targets loaded. Emergency Delete requires two confirmations.':'Choose a folder and browsers in Device setup.');}).catch(error=>message(error.message));
  return {begin,get configured(){return !!settings.folder||!!settings.browsers.length;},get summary(){return this.configured?`${settings.folder?'Folder configured':'No folder'} · ${settings.browsers.length?settings.browsers.join(' + ')+' history':'No browser history'}`:'Configure cleanup in Device setup first.';}};
}
