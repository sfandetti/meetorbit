// Codex console tab: the paired coding conversation, typed commands, and native approval requests.
// Every command or approval is a two-step prepare -> confirm, the same rule as Orbit's SEND button.
import {element,notice} from './app.js';
const $=id=>document.getElementById(id);
let current=null,review=null,busy=false,feedKey='',lastCards='',visible=false;const sentLocally=[];
async function task(action,body){
  const response=await fetch('/api/task/control/'+action,{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json','X-Orbit-Task':current?.csrf||''}:{},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Codex connection failed.');return data;
}
function line(role,text){const row=element('div',undefined,'codex-line codex-'+role);row.append(element('span',role==='user'?'you ❯':role==='assistant'?'codex ❯':'orbit ·'),element('p',text));return row;}
async function refresh(){
  try{current=await task('status');}catch(e){$('codex-connection').textContent=e.message;return;}
  $('codex-connection').textContent=current.connected?`${current.title} · ${current.runtime}`:(current.error||'Codex is not connected on this PC. Open the Codex app with the paired chat.');
  $('codex-pin-label').hidden=!current.pinRequired;$('codex-send').disabled=!current.connected||busy;
  const approvals=current.approvals||[],pending=approvals.filter(a=>a.state==='pending').length;$('codex-count').textContent=pending?`(${pending})`:'';
  const signature=JSON.stringify([approvals,current.unsupported]);if(signature===lastCards)return;lastCards=signature;
  const list=$('codex-approvals');list.replaceChildren();if(!approvals.length)list.append(element('p','Nothing is waiting for your OK.','help'));
  for(const a of approvals){
    const card=element('div',undefined,'shortcut-card');card.append(element('strong',a.kind+' · '+a.state),element('pre',a.detail));const fields=[];
    for(const q of a.questions||[]){const label=element('label',q.question||q.header||q.id),input=element('input');input.maxLength=2000;label.append(input);card.append(label);if(q.options?.length)card.append(element('small','Options: '+q.options.map(o=>o.label).join(' · ')));fields.push({id:q.id,input});}
    for(const decision of a.choices){const b=element('button',a.questions?'Review answers':decision==='accept'?'Approve once':decision==='decline'?'Decline':'Cancel action');b.disabled=a.state!=='pending';
      b.onclick=()=>{const response=fields.length?{answers:Object.fromEntries(fields.map(f=>[f.id,{answers:[f.input.value]}]))}:undefined;prepare({kind:'approval',nonce:a.nonce,decision,response},`${b.textContent}\n${a.detail}${response?'\nYour answers:\n'+JSON.stringify(response,null,2):''}`);};card.append(b);}
    if(a.state==='expired'){const renew=element('button','Refresh expired request');renew.onclick=async()=>{try{await task('renew',{nonce:a.nonce});await refresh();}catch(e){$('codex-result').textContent=e.message;}};card.append(renew);}
    list.append(card);
  }
  for(const a of current.unsupported||[])list.append(element('p',`${a.kind}: ${a.message}`,'help'));
}
async function prepare(actionBody,description){
  if(busy)return;busy=true;
  try{review=await task('prepare',actionBody);$('codex-review-text').textContent=description;$('codex-review').hidden=false;$('codex-review-pin').value='';$('codex-review-pin-label').hidden=!review.pinRequired;
    $('codex-confirm').textContent=actionBody.kind==='command'?'Send this command':actionBody.decision==='accept'?'Approve once':'Send this answer';$('codex-result').textContent='Check it, then confirm.';}
  catch(e){$('codex-result').textContent=e.message;}finally{busy=false;}
}
async function cancelReview(){if(review){try{await task('cancel',{token:review.token});}catch{}review=null;}$('codex-review').hidden=true;}
async function refreshFeed(){
  try{const response=await fetch('/api/task/conversation',{cache:'no-store'});const data=await response.json();const key=JSON.stringify(data.messages||[]);if(key===feedKey)return;feedKey=key;
    const log=$('codex-log'),atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<60;log.replaceChildren();const messages=(data.messages||[]).slice(-12);
    for(const m of messages)log.append(line(m.role,m.text));for(const local of sentLocally)if(!messages.some(m=>m.role==='user'&&m.text===local))log.append(line('user',local));
    if(!messages.length&&!sentLocally.length)log.append(line('system',data.connected?'No messages yet. Type a command below.':'Codex is not connected on this PC.'));
    if(atBottom)log.scrollTop=log.scrollHeight;
  }catch{}
}
export function codexVisible(on){visible=on;if(on){refresh();feedKey='';refreshFeed();}}
export function initCodex(){
  $('codex-form').onsubmit=async e=>{e.preventDefault();const text=$('codex-input').value.trim();if(!text||busy)return;busy=true;$('codex-send').disabled=true;$('codex-result').textContent='Sending to Codex…';let prepared;
    try{if(!current?.csrf)await refresh();prepared=await task('prepare',{kind:'command',text});const data=await task('commit',{token:prepared.token,pin:$('codex-pin').value});if(data.error)throw Error(data.error);prepared=null;
      sentLocally.push(text);if(sentLocally.length>12)sentLocally.shift();$('codex-input').value='';$('codex-result').textContent='Received by Codex. Waiting for a reply…';feedKey='';refreshFeed();}
    catch(error){$('codex-result').textContent=error.message;}finally{if(prepared)task('cancel',{token:prepared.token}).catch(()=>{});busy=false;$('codex-send').disabled=false;$('codex-pin').value='';}};
  $('codex-confirm').onclick=async()=>{if(busy||!review)return;busy=true;$('codex-confirm').disabled=true;
    try{const data=await task('commit',{token:review.token,pin:$('codex-review-pin').value});$('codex-result').textContent=data.error||(data.state==='received-by-desktop'?'Received by Codex.':'Answer sent. Waiting for Codex to finish the request.');review=null;$('codex-review').hidden=true;}
    catch(e){$('codex-result').textContent=e.message;}finally{busy=false;$('codex-confirm').disabled=false;await refresh();}};
  $('codex-review-cancel').onclick=cancelReview;
  $('codex-refresh').onclick=async()=>{try{await task('refresh',{});$('codex-result').textContent='Asked Codex for a fresh list.';await refresh();}catch(e){$('codex-result').textContent=e.message;}};
  $('codex-save-pin').onclick=async()=>{try{await task('pin',{currentPin:$('codex-current-pin').value,pin:$('codex-new-pin').value});notice('Task passcode updated.');$('codex-current-pin').value='';$('codex-new-pin').value='';await cancelReview();await refresh();}catch(e){notice(e.message,true);}};
  refresh();
  // Requests refresh every 2.5 s while this tab is open, every 10 s otherwise (for the count in the menu).
  let tick=0;setInterval(()=>{tick++;if(!document.hidden&&!busy&&(visible||tick%4===0))refresh();},2500);
  setInterval(()=>{if(visible&&!document.hidden)refreshFeed();},4000);
}
