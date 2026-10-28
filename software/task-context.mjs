import {DesktopLink} from './desktop-link.mjs';
export function redactStatus(value,max=1400){return String(value||'').replace(/sk-[A-Za-z0-9_-]+/g,'[credential redacted]').replace(/\b(?:Bearer\s+)[^\s"']+/gi,'[credential redacted]').replace(/(?:[A-Z]:\\|\/Users\/|\/home\/)[^\s<>"']+/g,'[local path]').slice(0,max);}
export function projectTask(state,now=Date.now()){
  const turns=[...(state.turns||[]),...Object.values(state.turnHistory?.history?.entitiesByKey||{})].filter(t=>t&&Array.isArray(t.items));
  turns.sort((a,b)=>(b.turnStartedAtMs||0)-(a.turnStartedAtMs||0));
  let latestUpdate='No visible progress update is available yet.';
  for(const turn of turns.slice(0,5)){const messages=turn.items.filter(i=>i.type==='agentMessage'&&(i.phase==null||['commentary','final','final_answer'].includes(i.phase))&&typeof i.text==='string'&&i.text.trim());if(messages.length){latestUpdate=redactStatus(messages.at(-1).text);break;}}
  return {connected:true,title:redactStatus(state.title,120),runtime:state.threadRuntimeStatus?.type||'unknown',latestUpdate,pendingApprovals:(state.requests||[]).filter(r=>!r.completed).length,observedAt:now};
}
export function projectConversation(state){
  const turns=[...(state.turns||[]),...Object.values(state.turnHistory?.history?.entitiesByKey||{})].filter(t=>t&&Array.isArray(t.items)).sort((a,b)=>(a.turnStartedAtMs||0)-(b.turnStartedAtMs||0));
  const messages=new Map();for(const turn of turns.slice(-5))for(const item of turn.items){let text='',role;
    if(item.type==='agentMessage'&&(item.phase==null||['commentary','final','final_answer'].includes(item.phase))){role='assistant';text=item.text;}
    else if(['userMessage','steeringUserMessage'].includes(item.type)){role='user';text=(item.content||item.input||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');const marker='## My request:';if(text.includes(marker))text=text.slice(text.lastIndexOf(marker)+marker.length);text=text.replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/g,'').replace(/<external_codex_apps_open_page>[\s\S]*?<\/external_codex_apps_open_page>/g,'').trim();}
    if(role&&typeof text==='string'&&text.trim()){const id=String(item.id||`${turn.turnId}:${messages.size}`);messages.set(id,{id,role,text:redactStatus(text,6000)});}
  }return [...messages.values()].slice(-30);
}
export function createTaskContext({threadId,connect}={}){
  let cached={connected:false,title:'Coding session',latestUpdate:'Live task connection has not been established.',observedAt:null},inflight=null,conversation=[];
  async function refresh(){if(inflight)return inflight;
    inflight=(async()=>{if(!threadId){cached={...cached,connected:false,latestUpdate:'No coding conversation is selected.'};return cached;}
      const link=new DesktopLink({threadId,...(connect?{connect}:{})});const receive=link.receive.bind(link);
      link.receive=frame=>{if(frame.type==='broadcast'&&frame.method==='thread-stream-state-changed'&&frame.sourceClientId===link.owner&&frame.params?.hostId==='local'&&frame.params.conversationId===threadId&&frame.version===11&&frame.params.change?.type==='snapshot'){cached=projectTask(frame.params.change.conversationState);conversation=projectConversation(frame.params.change.conversationState);}receive(frame);};
      try{await link.attach();return cached;}catch{cached={...cached,connected:false,latestUpdate:'The live coding session is unavailable. Do not claim to know its current work.'};return cached;}finally{link.close();}
    })().finally(()=>inflight=null);return inflight;
  }
  return {refresh,get snapshot(){return structuredClone(cached);},get conversation(){return cached.connected?structuredClone(conversation):[];}};
}
