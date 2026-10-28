import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// Connect only to an existing owner. Never start a replacement app-server or turn.
export class CodexLink extends EventEmitter {
  constructor({threadId,send,authorizeDecision,now=Date.now}={}){
    super();if(!threadId||typeof send!=='function')throw Error('A selected conversation and transport are required.');
    this.threadId=threadId;this.send=send;this.authorizeDecision=authorizeDecision;this.now=now;this.connected=false;this.pending=new Map();this.calls=new Map();this.sequence=0;this.status='disconnected';
  }
  request(method,params={}){
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.calls.delete(id);reject(Error('Codex connection timed out.'));},5000);this.calls.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.calls.delete(id);reject(error);}});
  }
  async attach(){
    await this.request('initialize',{clientInfo:{name:'orbit_local_companion',version:'0.1.0'},capabilities:{experimentalApi:true}});this.send({method:'initialized'});
    let cursor,found=false;
    for(let page=0;page<10;page++){
      const result=await this.request('thread/loaded/list',cursor?{cursor}:{});found=(result.data||[]).includes(this.threadId);if(found||!result.nextCursor)break;cursor=result.nextCursor;
    }
    if(!found)throw Error('This conversation is not loaded in the connected Codex owner. Orbit will not start a substitute session.');
    // The user selected this existing thread. Resume subscribes; it does not start a turn.
    const result=await this.request('thread/resume',{threadId:this.threadId,excludeTurns:true});
    if(result.thread?.id!==this.threadId)throw Error('The connected conversation did not match.');
    this.connected=true;this.status='monitoring';this.emit('status',{status:this.status,approvalRouting:'unverified until a live request arrives'});return this.status;
  }
  receive(message){
    if(message.id!==undefined&&!message.method){const call=this.calls.get(message.id);if(!call)return;this.calls.delete(message.id);clearTimeout(call.timer);message.error?call.reject(Error(message.error.message||'Codex request failed.')):call.resolve(message.result);return;}
    const p=message.params||{};if(!this.connected||p.threadId!==this.threadId)return;
    if(message.method==='thread/status/changed'){this.status=p.status?.type||'unknown';this.emit('status',{status:this.status,flags:p.status?.activeFlags||[]});}
    if(message.method==='serverRequest/resolved'){for(const [nonce,request]of this.pending)if(request.rpcId===p.requestId){this.pending.delete(nonce);this.emit('resolved',{nonce});}}
    if(['turn/completed','turn/interrupted','thread/closed'].includes(message.method)){this.pending.clear();if(message.method==='thread/closed')this.connected=false;this.emit('cleared');}
    if(message.method==='item/completed'){for(const [nonce,request]of this.pending)if(request.itemId===p.item?.id)this.pending.delete(nonce);}
    if(!['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput'].includes(message.method)||message.id===undefined||!p.turnId||!p.itemId)return;
    const old=[...this.pending.values()].find(r=>r.rpcId===message.id);if(old)return;
    const nonce=randomUUID(),request={nonce,rpcId:message.id,threadId:p.threadId,turnId:p.turnId,itemId:p.itemId,method:message.method,scope:structuredClone(p),expires:this.now()+120000,state:'pending'};
    this.pending.set(nonce,request);this.emit('approval',structuredClone(request));
  }
  async decide({nonce,threadId,turnId,itemId,decision,proof,response}={}){
    const request=this.pending.get(nonce);
    if(!this.connected||!request||request.state!=='pending'||request.expires<this.now()||threadId!==request.threadId||turnId!==request.turnId||itemId!==request.itemId)throw Error('Approval is stale, already answered, or belongs to another action.');
    // Only one-action choices. No persistent grants, policy changes, or model decisions.
    if(!['accept','decline','cancel'].includes(decision))throw Error('Choose approve once, decline, or cancel.');
    if(request.scope.availableDecisions&&!request.scope.availableDecisions.includes(decision))throw Error('That choice is not offered by Codex.');
    let result={decision};
    if(request.method==='item/fileChange/requestApproval'&&decision==='accept'&&request.scope.actionPreview?.unavailable)throw Error('File preview unavailable. Approve this change in the desktop app.');
    if(request.method==='item/permissions/requestApproval'){
      if(!request.scope.permissions||typeof request.scope.permissions!=='object')throw Error('Permission scope is not supported.');
      result={permissions:decision==='accept'?structuredClone(request.scope.permissions):{},scope:'turn'};
    }
    if(request.method==='item/tool/requestUserInput'){
      if(decision!=='accept'||!Array.isArray(request.scope.questions))throw Error('Answer the native questions explicitly.');
      const entries=[];for(const question of request.scope.questions){const answer=response?.answers?.[question.id]?.answers;if(!Array.isArray(answer)||!answer.length||answer.length>10||answer.some(a=>typeof a!=='string'||!a.trim()||a.length>2000))throw Error('Answer every question.');entries.push([question.id,{answers:[...answer]}]);}result={answers:Object.fromEntries(entries)};
    }
    request.state='authorizing';
    try{
      if(!this.authorizeDecision||await this.authorizeDecision({request:structuredClone(request),decision,proof})!==true)throw Error('Fresh user authorization is required.');
      if(!this.connected||this.pending.get(nonce)!==request||request.expires<this.now())throw Error('Approval changed while authorizing.');
      request.state='submitted';this.send({id:request.rpcId,result});
      // Keep it submitted until serverRequest/resolved acknowledges it. Never claim execution.
      this.emit('submitted',{nonce});return {state:'submitted'};
    }catch(error){if(request.state==='authorizing')request.state='pending';throw error;}
  }
  close(reason='Codex desktop connection unavailable.'){
    this.connected=false;this.status='disconnected';this.pending.clear();for(const call of this.calls.values()){clearTimeout(call.timer);call.reject(Error(reason));}this.calls.clear();this.emit('status',{status:this.status,reason});
  }
}

export function connectExistingCodex({threadId,codexPath='codex.exe',authorizeDecision}={}){
  const process=spawn(codexPath,['app-server','proxy'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const link=new CodexLink({threadId,authorizeDecision,send:message=>{if(!process.stdin.writable)throw Error('Codex transport closed.');process.stdin.write(JSON.stringify(message)+'\n');}});
  process.stdout.setEncoding('utf8');let buffer='';process.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>2*1024*1024){process.kill();link.close('Codex message exceeded the transport limit.');return;}for(let offset;(offset=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,offset);buffer=buffer.slice(offset+1);try{link.receive(JSON.parse(line));}catch{link.close('Invalid Codex protocol message.');process.kill();}}});
  // Raw stderr can include paths or credentials; expose only a fixed diagnosis.
  process.stderr.on('data',()=>{});process.on('error',()=>link.close('The installed Codex proxy could not start.'));process.on('exit',()=>link.close('The existing desktop owner could not be reached. Its shared control socket may be unavailable.'));
  return {link,async attach(){try{return await link.attach();}catch(error){process.kill();link.close(error.message);throw error;}},close(){link.close();process.kill();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const threadId=process.env.CODEX_THREAD_ID;
  if(!threadId){console.error('Run this check from the selected Codex conversation.');process.exitCode=1;}
  else{const connection=connectExistingCodex({threadId,codexPath:process.env.ORBIT_CODEX_EXECUTABLE||'codex.exe'});try{await connection.attach();console.log('Existing conversation connected for monitoring. Live approval delivery remains unverified.');}catch(error){console.error(error.message);process.exitCode=1;}finally{connection.close();}}
}
