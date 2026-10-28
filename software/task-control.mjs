import {randomUUID,randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {DesktopLink,approvalMethods} from './desktop-link.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const secretText=x=>String(x||'').replace(/sk-[A-Za-z0-9_-]+/g,'[credential redacted]').replace(/Bearer\s+[^\s"']+/gi,'[credential redacted]');
export function createTaskControl({threadId,runtimeDir,makeLink=options=>new DesktopLink(options),now=Date.now}={}){
  let link=null,connecting=null,lastError='',auth=null,authLoaded=false,failedPins=0,blockedUntil=0;
  const sessions=new Map(),reviews=new Map(),operations=new Map(),events=[];
  function event(kind,message){events.unshift({id:randomUUID(),kind,message,at:now()});events.length=Math.min(30,events.length);}
  async function loadAuth(){if(authLoaded)return;try{auth=JSON.parse(await readFile(new URL('task-auth.json',runtimeDir),'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Task lock settings could not be read.');}authLoaded=true;}
  function pinOkay(pin){if(now()<blockedUntil)throw Error('Too many incorrect codes. Try again in 30 seconds.');if(!auth)return true;
    const candidate=scryptSync(String(pin||''),auth.salt,32);const okay=timingSafeEqual(candidate,Buffer.from(auth.hash,'hex'));
    if(!okay){if(++failedPins>=5){blockedUntil=now()+30000;failedPins=0;}throw Error('Incorrect task passcode.');}failedPins=0;return true;
  }
  async function ensure(){
    if(link?.observed)return link;if(connecting)return connecting;
    connecting=(async()=>{if(!threadId)throw Error('No coding conversation selected.');link?.close();
      const next=makeLink({threadId,authorizeDecision:async({request,decision,proof})=>proof?.nonce===request.nonce&&proof?.decision===decision&&proof?.expires>now()});link=next;
      next.on('approval',()=>event('attention','A coding action needs your review.'));
      next.on('resolved',()=>event('resolved','A native request was cleared by the desktop.'));
      next.on('delivery',d=>event(d.state,d.state==='uncertain'?'Approval delivery is uncertain. Check the desktop; do not resend automatically.':'The desktop received your answer.'));
      try{await next.attach();lastError='';return next;}catch(e){lastError=e.message;throw e;}
    })().finally(()=>connecting=null);return connecting;
  }
  function prune(){for(const [id,s]of sessions)if(s.expires<now())sessions.delete(id);for(const [id,r]of reviews)if(r.expires<now())reviews.delete(id);for(const [id,o]of operations)if(o.expires<now())operations.delete(id);}
  function session(cookie){prune();let id=String(cookie||'').match(/(?:^|;\s*)orbit_task=([\w-]+)/)?.[1],s=sessions.get(id);if(!s){if(sessions.size>50)sessions.delete(sessions.keys().next().value);id=randomUUID();s={id,csrf:randomUUID(),expires:now()+36000000};sessions.set(id,s);}return s;}
  function authorize(s,csrf){if(!s||csrf!==s.csrf)throw Error('Task session expired. Reopen the task inbox.');}
  function cards(){return [...(link?.broker.pending.values()||[])].map(r=>({nonce:r.nonce,kind:r.method.includes('commandExecution')?'Command execution':r.method.includes('permissions')?'Requested permissions · this turn only':r.method.includes('requestUserInput')?'Question from ChatGPT':'File changes',detail:secretText(JSON.stringify(r.scope,null,2)),questions:r.method.includes('requestUserInput')?r.scope.questions:undefined,state:r.expires<now()?'expired':r.state,expires:r.expires,choices:r.method.includes('requestUserInput')?['accept']:['accept','decline','cancel'].filter(d=>!r.scope.availableDecisions||r.scope.availableDecisions.includes(d))}));}
  async function status(){await loadAuth();try{await ensure();}catch{}return {connected:!!link?.observed,title:secretText(link?.title||'Coding task'),runtime:link?.runtime||'unknown',pinRequired:!!auth,approvals:link?.observed?cards():[],unsupported:link?.observed?(link.requests||[]).filter(r=>!r.completed&&!approvalMethods.has(r.method)).map(r=>({kind:r.method,message:'Answer this request in the desktop app.'})):[],events:[...events],error:link?.observed?'':lastError||'Desktop unavailable'};}
  async function prepare(s,body){await loadAuth();await ensure();prune();if(reviews.size>100)throw Error('Too many pending reviews.');
    let action;
    if(body.kind==='command'){if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000)throw Error('Enter a command of 1–4000 characters.');action={kind:'command',text:body.text.trim()};}
    else if(body.kind==='approval'){const r=link.broker.pending.get(body.nonce);if(!r||r.state!=='pending'||r.expires<now())throw Error('This approval has expired or was already answered.');if(!['accept','decline','cancel'].includes(body.decision))throw Error('Invalid decision.');action={kind:'approval',nonce:r.nonce,decision:body.decision,scope:digest(r.scope),...(r.method.includes('requestUserInput')?{response:body.response}:{})};}
    else throw Error('Unknown task action.');
    const token=randomUUID(),review={session:s.id,action,expires:now()+60000};reviews.set(token,review);return {token,expires:review.expires,action,pinRequired:!!auth};
  }
  async function commit(s,{token,pin}={}){
    await loadAuth();const operation=operations.get(token);if(operation){if(operation.session!==s.id)throw Error('Review belongs to another browser.');return operation.promise;}
    const review=reviews.get(token);if(!review||review.session!==s.id||review.expires<now())throw Error('Review expired. Review the action again.');pinOkay(pin);
    reviews.delete(token);const promise=(async()=>{try{await ensure();const a=review.action;let result;
      if(a.kind==='command'){result=await link.sendMessage(a.text);event('command','Your command was received by the desktop.');}
      else{const r=link.broker.pending.get(a.nonce);if(!r||digest(r.scope)!==a.scope)throw Error('Approval changed. Review it again.');result=await link.decide({nonce:r.nonce,threadId:r.threadId,turnId:r.turnId,itemId:r.itemId,decision:a.decision,response:a.response,proof:{nonce:r.nonce,decision:a.decision,expires:now()+5000}});event('submitted','Answer submitted; waiting for desktop acknowledgment.');}
      return result;
    }catch(error){event('error',secretText(error.message));return {state:'unconfirmed',error:secretText(error.message)+ ' Check the desktop before sending again.'};}})();operations.set(token,{session:s.id,promise,expires:now()+600000});return promise;
  }
  async function setPin({currentPin,pin}={}){await loadAuth();pinOkay(currentPin);if(pin&&!/^\d{4,12}$/.test(pin))throw Error('Use 4–12 digits.');const next=pin?{salt:randomBytes(16).toString('hex')}:null;if(next)next.hash=scryptSync(pin,next.salt,32).toString('hex');await mkdir(runtimeDir,{recursive:true});await writeFile(new URL('task-auth.json',runtimeDir),JSON.stringify(next),{mode:0o600});auth=next;reviews.clear();return {pinRequired:!!auth};}
  return {status,session,authorize,prepare,commit,setPin,async refreshNative(){await ensure();link.follow(true);return {state:'refreshing'};},async renew(nonce){await ensure();const r=link.broker.pending.get(nonce);if(!r||r.state!=='pending'||r.expires>=now())throw Error('Only an expired, unanswered review can be refreshed.');const {actionPreview,...scope}=r.scope;const native=link.requests.find(q=>q.id===r.rpcId&&!q.completed&&digest(q.params)===digest(scope));if(!native)throw Error('Native request is no longer pending.');link.broker.pending.delete(nonce);link.syncRequests();return {state:'review-again'};},cancel(s,token){const r=reviews.get(token);if(r?.session===s.id)reviews.delete(token);return {state:'cancelled'};},close(){link?.close();},ensure};
}
export async function taskControlHttp(request,response,control){
  const path=new URL(request.url,'http://localhost').pathname;if(!path.startsWith('/api/task/control/'))return false;
  response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
  const s=control.session(request.headers.cookie);response.setHeader('Set-Cookie',`orbit_task=${s.id}; HttpOnly; SameSite=Strict; Path=/api/task/control/`);
  try{const action=path.split('/').at(-1);
    if(action==='status'&&request.method==='GET'){response.end(JSON.stringify({...await control.status(),csrf:s.csrf}));return true;}
    if(request.method!=='POST'||request.headers.origin!==`http://${request.headers.host}`)throw Error('Same-origin task action required.');control.authorize(s,request.headers['x-orbit-task']);
    let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>12000)throw Error('Task request too large.');}const body=JSON.parse(raw||'{}');let result;
    if(action==='prepare')result=await control.prepare(s,body);else if(action==='commit')result=await control.commit(s,body);else if(action==='cancel')result=control.cancel(s,body.token);else if(action==='refresh')result=await control.refreshNative();else if(action==='renew')result=await control.renew(body.nonce);else if(action==='pin')result=await control.setPin(body);else throw Error('Unknown task action.');response.end(JSON.stringify(result));
  }catch(e){response.writeHead(400);response.end(JSON.stringify({error:secretText(e.message)}));}return true;
}
