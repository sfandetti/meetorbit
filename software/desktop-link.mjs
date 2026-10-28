// Windows desktop IPC transport, independently implemented from published protocol examples:
// https://github.com/NathanZane/codex-mobile/blob/main/src/codex/CodexDesktopIpcClient.ts
// https://github.com/jazzenchen/agent-hud-open/blob/main/Sources/AgentHUDCore/Providers/Codex/CodexDesktopIPC.swift
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {CodexLink} from './codex-link.mjs';
const PIPE='\\\\.\\pipe\\codex-ipc';
export const approvalMethods=new Map([['item/commandExecution/requestApproval','thread-follower-command-approval-decision'],['item/fileChange/requestApproval','thread-follower-file-approval-decision'],['item/permissions/requestApproval','thread-follower-permissions-request-approval-response'],['item/tool/requestUserInput','thread-follower-submit-user-input']]);

export class DesktopLink extends EventEmitter {
  constructor({threadId,authorizeDecision,connect=()=>net.connect(PIPE),timeout=5000}={}){
    super();this.threadId=threadId;this.connect=connect;this.timeout=timeout;this.socket=null;this.client=null;this.owner=null;this.revision=null;this.requests=[];this.buffer=Buffer.alloc(0);this.calls=new Map();this.submissions=new Map();this.observed=false;
    this.broker=new CodexLink({threadId,send:reply=>this.submit(reply),authorizeDecision:async choice=>{
      if(!authorizeDecision||await authorizeDecision(choice)!==true)return false;
      const owner=await this.rpc('thread-owner-discovery',{hostId:'local',conversationId:this.threadId});
      if(owner.handledByClientId!==this.owner)throw Error('Desktop owner changed. Review the action again.');return true;
    }});
    for(const name of ['approval','resolved','submitted','cleared'])this.broker.on(name,data=>this.emit(name,data));
  }
  write(frame){if(!this.socket||this.socket.destroyed)throw Error('Desktop connection closed.');const body=Buffer.from(JSON.stringify(frame)),head=Buffer.alloc(4);head.writeUInt32LE(body.length);this.socket.write(Buffer.concat([head,body]));}
  rpc(method,params,extra={},timeout=this.timeout){
    const requestId=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.calls.delete(requestId);reject(Error('Desktop request timed out.'));},timeout);this.calls.set(requestId,{resolve,reject,timer});try{this.write({type:'request',requestId,sourceClientId:this.client||'initializing-client',version:1,method,params,...extra});}catch(error){clearTimeout(timer);this.calls.delete(requestId);reject(error);}});
  }
  follow(following){this.write({type:'broadcast',method:'thread-stream-following-changed',version:1,sourceClientId:this.client,targetClientIds:[this.owner],params:{hostId:'local',conversationId:this.threadId,following}});}
  async attach(){
    try{
      if(this.socket)throw Error('Desktop link already started.');this.socket=this.connect();
      this.socket.on('data',data=>this.receiveBytes(data));this.socket.on('error',()=>this.close('Desktop pipe unavailable.'));this.socket.on('close',()=>this.close('Desktop disconnected.'));
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Desktop connection timed out.')),this.timeout);this.socket.once('connect',()=>{clearTimeout(timer);resolve();});this.socket.once('error',()=>{clearTimeout(timer);reject(Error('Desktop pipe unavailable.'));});});
      const initialized=await this.rpc('initialize',{clientType:'orbit-local-companion'});this.client=initialized.result?.clientId;if(typeof this.client!=='string'||!this.client)throw Error('Desktop did not identify this client.');
      const discovery=await this.rpc('thread-owner-discovery',{hostId:'local',conversationId:this.threadId});this.owner=discovery.handledByClientId;if(typeof this.owner!=='string'||!this.owner)throw Error('No live desktop owner for this conversation.');
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.off('snapshot',done);reject(Error('The selected conversation did not provide a live snapshot.'));},this.timeout);const done=()=>{clearTimeout(timer);resolve();};this.once('snapshot',done);this.follow(true);});
      return {connected:true,selectedConversationVerified:true,streamVersion:11,approvalDeliveryVerified:false};
    }catch(error){this.close(error.message);throw error;}
  }
  receiveBytes(chunk){
    this.buffer=Buffer.concat([this.buffer,chunk]);while(this.buffer.length>=4){const size=this.buffer.readUInt32LE(0);if(size>64*1024*1024){this.close('Desktop frame too large.');return;}if(this.buffer.length<size+4)return;const body=this.buffer.subarray(4,size+4);this.buffer=this.buffer.subarray(size+4);try{this.receive(JSON.parse(body));}catch{this.close('Unsupported desktop stream.');return;}}
  }
  receive(frame){
    if(frame.type==='response'){const call=this.calls.get(frame.requestId);if(!call)return;this.calls.delete(frame.requestId);clearTimeout(call.timer);const detail=String(frame.error?.message||frame.error||frame.result?.message||'').replace(/sk-[\w-]+/g,'[redacted]').slice(0,300);frame.resultType==='success'?call.resolve(frame):call.reject(Error('Desktop rejected the request.'+(detail?' '+detail:'')));return;}
    if(frame.type==='client-discovery-request'&&this.client){this.write({type:'client-discovery-response',requestId:frame.requestId,sourceClientId:this.client,version:1,result:{canHandle:false}});return;}
    const p=frame.params;
    if(frame.type!=='broadcast'||frame.method!=='thread-stream-state-changed'||frame.sourceClientId!==this.owner||p?.hostId!=='local'||p.conversationId!==this.threadId)return;
    if(frame.version!==11)throw Error('Desktop stream version changed.');const change=p.change;
    if(change?.type==='snapshot'){
      if(!Array.isArray(change.conversationState?.requests)||!Number.isInteger(change.revision))throw Error('Incomplete desktop snapshot.');
      // Retain pending requests only, never the full conversation history or credentials.
      this.turnIndex=new Map();this.actionPreviews=new Map();this.runtime=change.conversationState.threadRuntimeStatus?.type;this.title=String(change.conversationState.title||'Coding task');this.cwd=change.conversationState.cwd;
      for(const t of [...(change.conversationState.turns||[]),...Object.values(change.conversationState.turnHistory?.history?.entitiesByKey||{})])this.trackTurn(t);
      this.requests=structuredClone(change.conversationState.requests);this.revision=change.revision;this.observed=true;this.broker.connected=true;this.syncRequests();this.emit('snapshot');
    }else if(change?.type==='patches'){
      if(!this.observed||change.baseRevision!==this.revision||!Number.isInteger(change.revision)||change.revision<=this.revision||!Array.isArray(change.patches))throw Error('Desktop stream revision mismatch.');
      const root={requests:structuredClone(this.requests)};
      for(const patch of change.patches){if(!Array.isArray(patch.path))throw Error('Invalid patch path.');if(patch.path[0]==='requests')applyRequestPatch(root,patch);this.trackPatch(patch);}
      if(!Array.isArray(root.requests))throw Error('Invalid request state.');this.requests=root.requests;this.revision=change.revision;this.syncRequests();
    }
  }
  trackTurn(t,key){if(!t||typeof t!=='object')return;const id=t.turnId||t.id||key;if(id)this.turnIndex.set(String(id),{turnId:id,status:t.status,started:t.turnStartedAtMs||0});for(const item of t.items||[]){if(['fileChange','commandExecution'].includes(item.type)&&item.id){const preview={type:item.type,command:item.command,cwd:item.cwd,changes:item.changes};this.actionPreviews.set(item.id,JSON.stringify(preview).length<=64000?preview:{unavailable:'Large change: review in the desktop app.'});}}if(this.turnIndex.size>100)this.turnIndex.delete(this.turnIndex.keys().next().value);if(this.actionPreviews.size>100)this.actionPreviews.delete(this.actionPreviews.keys().next().value);}
  trackPatch({path:p,value,op}){
    if(p[0]==='threadRuntimeStatus'){this.runtime=p.length===1?value?.type:value;return;}
    if(p[0]==='title'){this.title=String(value||'Coding task');return;}
    if(p[0]==='turnHistory'&&p[1]==='history'&&p[2]==='entitiesByKey'){
      const id=String(p[3]);if(p.length===4){if(op==='remove')this.turnIndex.delete(id);else this.trackTurn(value,id);}
      else if(['status','turnStartedAtMs'].includes(p[4])){const t=this.turnIndex.get(id);if(t)t[p[4]==='status'?'status':'started']=value;}
      if(p[4]==='items'){
        // Invalidate old previews on item mutations; a fresh snapshot is required to approve a changed diff.
        if(value?.type==='fileChange'||value?.type==='commandExecution')this.trackTurn({items:[value]});
        else if(p.length>6||op==='remove')this.actionPreviews.clear();
      }
    }
    if(p[0]==='turns'&&value&&typeof value==='object'&&!Array.isArray(value)&&p.length===2)this.trackTurn(value);
  }
  async sendMessage(text){
    if(!this.observed||!this.owner)throw Error('The live conversation is disconnected.');
    if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('Enter a command of 1–4000 characters.');
    const owner=this.owner,discovery=await this.rpc('thread-owner-discovery',{hostId:'local',conversationId:this.threadId});
    if(discovery.handledByClientId!==owner)throw Error('Desktop owner changed. Review and send again.');
    const active=[...this.turnIndex.values()].filter(t=>t.status==='inProgress').sort((a,b)=>b.started-a.started)[0];
    const input=[{type:'text',text:text.trim(),text_elements:[]}];let method,params;
    if(this.runtime==='active'){
      if(!active?.turnId)throw Error('Active turn is not verified. Wait for the desktop state to refresh.');
      const restoreMessage={id:`restore:${active.turnId}`,text:text.trim(),cwd:this.cwd,createdAt:Date.now(),context:{prompt:text.trim(),workspaceRoots:this.cwd?[this.cwd]:[],commentAttachments:[],fileAttachments:[],imageAttachments:[],addedFiles:[]}};
      method='thread-follower-steer-turn';params={conversationId:this.threadId,expectedTurnId:active.turnId,input,attachments:[],restoreMessage,clientUserMessageId:randomUUID()};
    }else if(['idle','completed'].includes(this.runtime)){method='thread-follower-start-turn';params={conversationId:this.threadId,turnStart:{request:{threadId:this.threadId,input,clientUserMessageId:randomUUID()},context:{attachments:[],commentAttachments:[],inheritThreadSettings:true}}};}
    else throw Error('The desktop is not ready for a command.');
    const result=await this.rpc(method,params,{targetClientId:owner,...(method==='thread-follower-start-turn'?{version:2}:{})},30000);
    if(result.handledByClientId!==owner)throw Error('Delivery unconfirmed. Check the desktop before sending again.');
    return {state:'received-by-desktop',mode:method.includes('steer')?'steer':'start'};
  }
  syncRequests(){
    const fresh=this.requests.filter(r=>!r.completed&&approvalMethods.has(r.method)&&r.params?.threadId===this.threadId&&r.params.turnId&&r.params.itemId).map(r=>({...r,params:{...r.params,...(r.method==='item/fileChange/requestApproval'?{actionPreview:this.actionPreviews.get(r.params.itemId)||{unavailable:'File diff unavailable. Review in the desktop app.'}}:{})}}));
    for(const [nonce,old]of this.broker.pending){const next=fresh.find(r=>r.id===old.rpcId);if(!next||JSON.stringify(next.params)!==JSON.stringify(old.scope)){this.broker.pending.delete(nonce);this.emit('resolved',{nonce});}}
    for(const request of fresh)this.broker.receive(request);
    this.emit('status',{connected:true,selectedConversationVerified:true,pendingActions:this.broker.pending.size});
  }
  submit(reply){
    const request=[...this.broker.pending.values()].find(r=>r.rpcId===reply.id);
    if(!request||!this.observed||!this.owner)throw Error('Native approval is no longer available.');
    const method=approvalMethods.get(request.method);if(!method)throw Error('Unsupported native approval.');
    const operation=this.rpc(method,{conversationId:this.threadId,requestId:request.rpcId,...(request.method==='item/permissions/requestApproval'||request.method==='item/tool/requestUserInput'?{response:reply.result}:{decision:reply.result.decision})},{targetClientId:this.owner});
    this.submissions.set(request.nonce,operation);operation.then(response=>{
      if(response.handledByClientId!==this.owner)throw Error('Desktop did not confirm the expected owner.');this.emit('delivery',{nonce:request.nonce,state:'received-by-desktop'});
    }).catch(()=>{this.emit('delivery',{nonce:request.nonce,state:'uncertain',message:'Desktop did not confirm this answer. Do not automatically retry.'});}).finally(()=>this.submissions.delete(request.nonce));
  }
  decide(answer){return this.broker.decide(answer);}
  close(reason='Desktop link closed.'){
    const socket=this.socket;if(!socket)return;
    if(this.client&&this.owner&&!socket.destroyed){try{this.follow(false);}catch{}}
    this.socket=null;socket.destroy();this.observed=false;this.owner=null;this.client=null;this.requests=[];this.buffer=Buffer.alloc(0);this.broker.close(reason);
    for(const call of this.calls.values()){clearTimeout(call.timer);call.reject(Error(reason));}this.calls.clear();this.emit('status',{connected:false,reason});
  }
}
function applyRequestPatch(root,{op,path,value}){
  if(!['add','replace','remove'].includes(op)||path.some(p=>['__proto__','prototype','constructor'].includes(String(p))))throw Error('Unsupported request patch.');
  let parent=root;for(const key of path.slice(0,-1)){if(parent===null||typeof parent!=='object'||!Object.hasOwn(parent,key))throw Error('Missing request patch parent.');parent=parent[key];}
  const key=path.at(-1);if(Array.isArray(parent)){if(!Number.isInteger(key)||key<0||key>parent.length||(op!=='add'&&key===parent.length))throw Error('Invalid request index.');if(op==='add')parent.splice(key,0,structuredClone(value));else if(op==='remove')parent.splice(key,1);else parent[key]=structuredClone(value);}
  else{if(!parent||typeof parent!=='object'||(op!=='add'&&!Object.hasOwn(parent,key)))throw Error('Invalid request field.');if(op==='remove')delete parent[key];else parent[key]=structuredClone(value);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.env.CODEX_THREAD_ID){console.error('Run from the selected coding conversation.');process.exitCode=1;}
  else{const link=new DesktopLink({threadId:process.env.CODEX_THREAD_ID});try{console.log(JSON.stringify(await link.attach()));}catch(error){console.error(error.message);process.exitCode=1;}finally{link.close();}}
}
