let editingShortcut=null;
function providerUI(){
 const p=$('ai-provider').value;
 $('cursor-path-field').hidden=p!=='cursor';$('load-models').hidden=p==='cursor';
 $('key-label').textContent=p==='claude'?'Anthropic API key':p==='cursor'?'Cursor API key (optional with CLI sign-in)':'OpenAI API key';
 $('provider-help').textContent=p==='cursor'?'Uses the installed Cursor CLI in read-only Ask mode. Sign in to that CLI separately. '+(profile.cursor_available?'Cursor CLI detected.':'Cursor CLI is not detected yet.'):p==='claude'?'Uses the official Anthropic Messages API. Save your Anthropic key, then load available models.':'Uses the official OpenAI Responses API. Save your OpenAI key, then load available models.';
 $('key-status').textContent=profile.provider_keys?.[p]?'A key for this provider is saved securely.':'No saved key for this provider.';
}
function shortcutFields(){const kind=$('shortcut-kind').value;$('shortcut-exe-fields').hidden=kind!=='executable';$('shortcut-command-field').hidden=kind!=='command';$('shortcut-system-field').hidden=kind!=='system';$('shortcut-options').hidden=kind==='system';$('shortcut-name').parentElement.hidden=kind==='system';}
function resetShortcut(){editingShortcut=null;for(const k of ['name','path','arguments','command','cwd'])$('shortcut-'+k).value='';$('shortcut-terminal').checked=false;$('shortcut-add').textContent='Add shortcut';$('shortcut-cancel').hidden=true;}
function renderSelectedShortcuts(){
 $('selected-apps').replaceChildren();profile.apps.forEach((item,slot)=>{const card=element('div',undefined,'shortcut-card');card.append(element('strong',(slot+1)+'. '+item.name),element('small',item.kind==='command'?item.command:item.kind==='executable'?item.path+' '+(item.arguments||''):item.kind==='system'?'Confirmation required for cleanup and sign out':'Installed app'));
 const run=element('button','Run');run.onclick=()=>action(run,async()=>{await save();const r=await api('shortcut/run',{slot,pin:await actionPin()});notice(r.status);});card.append(run);
 if(item.kind&&item.kind!=='app'&&item.kind!=='system'){const edit=element('button','Edit');edit.onclick=()=>{editingShortcut=item.id;$('shortcut-kind').value=item.kind;for(const k of ['name','path','arguments','command','cwd'])$('shortcut-'+k).value=item[k]||'';$('shortcut-terminal').checked=!!item.show_terminal;$('shortcut-add').textContent='Update shortcut';$('shortcut-cancel').hidden=false;shortcutFields();};card.append(edit);}
 const remove=element('button','Remove');remove.onclick=()=>{profile.apps.splice(slot,1);renderApps();change();};card.append(remove);$('selected-apps').append(card);
 });
}
async function actionPin(){if(!profile.pin_enabled)return '';const value=window.prompt('Enter your Orbit passcode to run this PC action:');if(value===null)throw Error('Canceled');return value;}
function readFeatures(){
 const provider=$('ai-provider').value;const provider_models={...profile.provider_models,[provider]:$('model').value};
 return {ai_provider:provider,cursor_path:$('cursor-path').value,provider_models,privacy_folders:$('privacy-folders').value.split('\n').map(v=>v.trim()).filter(Boolean),privacy_browsers:[...document.querySelectorAll('[data-browser-part]:checked')].map(e=>e.value),alarm_enabled:$('alarm_enabled').checked,alarm_sound:$('alarm_sound').value,alarm_loop:$('alarm_loop').checked};
}
function renderRuns(runs){
 const open=new Set([...$('command-runs').querySelectorAll('details[open]')].map(e=>e.dataset.run));$('command-runs').replaceChildren();
 if(!runs?.length){$('command-runs').textContent='No commands run this session.';return;}
 runs.slice(0,8).forEach(run=>{const details=element('details');details.dataset.run=run.id;details.open=open.has(run.id);details.append(element('summary',run.name+' - '+run.state+(run.exit_code===null?'':' (exit '+run.exit_code+')')),element('pre',run.output||'No captured output.'));$('command-runs').append(details);});
}
function initFeatures(){
 $('ai-provider').value=profile.ai_provider||'openai';$('cursor-path').value=profile.cursor_path||'';providerUI();
 $('ai-provider').onchange=()=>{profile.provider_models={...profile.provider_models,[profile.ai_provider||'openai']:$('model').value};profile.ai_provider=$('ai-provider').value;$('model').value=profile.provider_models[profile.ai_provider]||'';$('api-key').value='';$('clear-key').checked=false;$('models').replaceChildren();providerUI();change();};
 $('shortcut-kind').onchange=shortcutFields;shortcutFields();$('shortcut-cancel').onclick=resetShortcut;
 $('shortcut-add').onclick=()=>{if(!editingShortcut&&profile.apps.length>=6){notice('Choose up to six shortcuts.',true);return;}const kind=$('shortcut-kind').value;const item={kind,id:editingShortcut||crypto.randomUUID(),name:$('shortcut-name').value.trim(),path:$('shortcut-path').value,arguments:$('shortcut-arguments').value,command:$('shortcut-command').value,cwd:$('shortcut-cwd').value,show_terminal:$('shortcut-terminal').checked,action:$('shortcut-system').value};if(kind==='system')item.name={lock:'Lock PC',signout:'Sign out',cleanup:'Privacy cleanup'}[item.action];if(!item.name){notice('Give the shortcut a button name.',true);return;}const index=profile.apps.findIndex(a=>a.id===editingShortcut);if(index>=0)profile.apps[index]=item;else profile.apps.push(item);resetShortcut();renderApps();change();notice('Shortcut added. Save changes to send its label to Orbit.');};
 $('privacy-folders').value=(profile.privacy_folders||[]).join('\n');for(const browser of ['chrome','edge'])for(const part of ['history','cookies','cache']){const label=element('label',undefined,'check'),check=element('input');check.type='checkbox';check.value=browser+'_'+part;check.dataset.browserPart='';check.checked=(profile.privacy_browsers||[]).includes(check.value);check.onchange=change;label.append(check,element('span',(browser==='chrome'?'Chrome':'Edge')+' '+part));$('privacy-browser-choices').append(label);}
 $('privacy-review').onclick=()=>action($('privacy-review'),async()=>{await save();const pin=await actionPin();const plan=await api('privacy/prepare',{pin});const description=plan.warning+'\n\n'+plan.files+' files, '+(plan.bytes/1048576).toFixed(1)+' MB\n'+[...plan.folders,...plan.browser_data].join('\n');if(!window.confirm(description))return;const r=await api('privacy/commit',{confirmation:plan.confirmation,pin});$('privacy-result').textContent=r.status;notice(r.status);});
 $('pc-lock').onclick=()=>action($('pc-lock'),async()=>{const r=await api('system/action',{action:'lock'});notice(r.status);});$('pc-signout').onclick=()=>action($('pc-signout'),async()=>{const r=await api('system/action',{action:'signout',pin:await actionPin()});notice(r.status);});
 $('alarm_enabled').checked=!!profile.alarm_enabled;$('alarm_sound').value=profile.alarm_sound||'siren';$('alarm_loop').checked=!!profile.alarm_loop;
 $('alarm-test').onclick=()=>action($('alarm-test'),async()=>{await save();const r=await api('alarm/test',{});notice(r.status);});$('alarm-stop').onclick=()=>action($('alarm-stop'),async()=>{const r=await api('alarm/stop',{});notice(r.status);});
 if($('pin-status'))$('pin-status').textContent=profile.pin_enabled?'Passcode protection is enabled.':'Passcode protection is off.';
}
