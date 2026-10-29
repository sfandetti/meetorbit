import WebSocket, { WebSocketServer } from 'ws';
export const VOICE_DEFAULTS={model:'gpt-realtime-2.1-mini',voice:'marin',transcription:'gpt-transcribe'};
export const VOICES=['marin','cedar','coral','sage','alloy','ash','ballad','echo','shimmer','verse'];
export const SYSTEM_PROMPT="You are Orbit, a practical voice companion in a small desktop device. Speak naturally and briefly. Orbit is a fully portable, battery-powered device about six inches long in a cylindrical enclosure with a circular cross-section. It can be physically rotated and used away from a desk. Automatic screen rotation is not working yet; describe that feature as unfinished and do not claim it detects orientation. You CAN communicate with the paired ChatGPT/Codex chat through Orbit CONSOLE: receive its messages and activity, and send user-reviewed messages to it. Do not say you cannot talk to Codex or have no communication channel. CONSOLE inside the AI page is that channel and also shows pending requests. In CONSOLE, hold the bottom bar to dictate a command, review the draft, then tap SEND to submit it to that coding conversation. The browser Task inbox also supports reviewed commands and native approval requests. This voice session is separate from the coding agent: it does not execute commands or grant approvals automatically. Report coding activity only from live paired-chat context when provided, and say when that connection is unavailable. Never claim a command was sent or an action completed without confirmation. Help users find CONSOLE when they want to monitor or direct coding work.";
export function sessionConfig(config={}){
  const model=String(config.model||VOICE_DEFAULTS.model);
  if(!/^gpt-realtime(?:-[a-zA-Z0-9.]+)*$/.test(model)||model.length>80)throw Error('Choose a gpt-realtime model.');
  const voice=config.voice||VOICE_DEFAULTS.voice;if(!VOICES.includes(voice))throw Error('Choose a supported voice.');
  const instructions=String(config.instructions||SYSTEM_PROMPT).trim();if(!instructions||instructions.length>3000)throw Error('Instructions must contain 1–3000 characters.');
  return {type:'realtime',model,instructions,output_modalities:['audio'],max_output_tokens:600,audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:VOICE_DEFAULTS.transcription},turn_detection:null},output:{format:{type:'audio/pcm',rate:24000},voice}}};
}
export function decodeAudio(value){
  if(typeof value!=='string'||value.length>20000||!value.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('Invalid PCM audio frame.');
  const bytes=Buffer.from(value,'base64');if(!bytes.length||bytes.length%2||bytes.length>12000||bytes.toString('base64')!==value)throw Error('Invalid PCM audio frame.');return bytes;
}
// The key comes only from the dashboard. A stale Windows OPENAI_API_KEY used to override every saved key.
// Tools the voice can use (getTools: the current list, e.g. control_lights once Hue is paired; runTool:
// does one call and returns what happened, in words the model can repeat).
export const TOOL_NOTE="You have tools: control_orbit opens Orbit's screens, rotates its picture and switches its own ring lights; control_pc_audio plays, pauses or skips music in the PC's default player and sets the PC volume; control_lights (when listed) controls the Philips Hue lights. Use them whenever the user asks, then confirm in a few words. If a tool reports a problem, say so.";
export function attachVoiceRelay(server,{port,initialKey='',connectUpstream,getTools=async()=>[],runTool=async()=>'Not available.'}={}){
  let apiKey=initialKey;const clients=new Set();
  const wss=new WebSocketServer({noServer:true,maxPayload:24576});
  const status=()=>({configured:!!apiKey,defaults:VOICE_DEFAULTS,voices:VOICES,instructions:SYSTEM_PROMPT,active:clients.size});
  function configure(body){
    if(body.clear){for(const client of clients)client.close();apiKey='';return status();}
    if(typeof body.apiKey!=='string'||body.apiKey.length<20||body.apiKey.length>512||/\s/.test(body.apiKey))throw Error('Enter your OpenAI API key.');
    // Orbit keeps a voice connection open, so drop it (it reconnects) rather than refusing the new key.
    for(const client of clients)client.close();apiKey=body.apiKey;return status();
  }
  server.on('upgrade',(request,socket,head)=>{
    const host=request.headers.host,origin=request.headers.origin;
    if(request.url!=='/api/voice/socket'||![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)||origin!==`http://${host}`){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    if(clients.size>=1){socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',client=>{
    clients.add(client);let upstream=null,ready=false,started=false,recording=false,mode='',frames=[],bytes=0,responseActive=false,closed=false,lastActivity=Date.now(),turnTimer,sessionKey='';
    const send=data=>{if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify(data));};
    const emit=event=>send({type:'upstream',event});
    // Keep OpenAI's own reason (code + message) so a bad key, a model or billing problem can be told apart.
    const redact=text=>String(text).replaceAll(sessionKey||apiKey||'__no_key__','[redacted]').replace(/sk-[\w-]+/g,'[redacted]');
    const safeError=error=>{const message=redact(error?.message||'Voice relay failed'),code=error?.code?`[${error.code}] `:'';return (/api.?key|authentication/i.test(message)?`OpenAI rejected the relay API key. ${code}${message}`:code+message).slice(0,240);};
    const sendUp=event=>{if(upstream?.readyState===WebSocket.OPEN)upstream.send(JSON.stringify(event));};
    function shutdown(){if(closed)return;closed=true;clearInterval(idle);clearTimeout(turnTimer);frames=[];recording=false;upstream?.close();clients.delete(client);}
    function fail(message){send({type:'relay.error',message});}
    const idle=setInterval(()=>{if(Date.now()-lastActivity>120000){send({type:'relay.error',message:'Voice disconnected after two minutes of inactivity.'});client.close();}},10000);idle.unref();
    client.on('close',shutdown);client.on('error',shutdown);
    client.on('message',(raw,binary)=>{
      try{
        lastActivity=Date.now();if(binary)throw Error('Send PCM frames as JSON base64.');const event=JSON.parse(raw);
        if(event.type==='start'){
          if(started)throw Error('Voice session already started.');mode=event.mode==='loopback'?'loopback':'openai';
          if(mode==='loopback'){started=true;ready=true;send({type:'relay.ready',mode,sampleRate:24000});return;}
          if(!apiKey)throw Error('Configure an OpenAI API key in Voice lab, or choose Local loopback.');
          const config=sessionConfig(event.config);started=true;sessionKey=apiKey;
          upstream=connectUpstream?connectUpstream(config,sessionKey):new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.model)}`,{headers:{Authorization:`Bearer ${sessionKey}`},handshakeTimeout:15000,maxPayload:2*1024*1024});
          send({type:'relay.connecting',model:config.model});
          upstream.on('open',async()=>{let tools=[];try{tools=await getTools();}catch{}
            sendUp({type:'session.update',session:tools.length?{...config,instructions:config.instructions+' '+TOOL_NOTE,tools,tool_choice:'auto'}:config});});
          upstream.on('unexpected-response',(_,response)=>{let body='';response.on('data',chunk=>{if(body.length<4000)body+=chunk;});response.on('end',()=>{
            let detail='';try{const e=JSON.parse(body).error||{};detail=redact(`${e.code?`[${e.code}] `:''}${e.message||''}`).slice(0,160);}catch{}
            fail((response.statusCode===401?'OpenAI rejected the relay API key (401). ':`OpenAI connection refused (${response.statusCode}). `)+(detail||'Check the key, model access and API billing.'));client.close();upstream.terminate();});});
          upstream.on('error',()=>{fail('Could not connect to OpenAI. Check the key, model access and network.');client.close();});
          upstream.on('close',()=>{if(!closed){send({type:'relay.closed'});client.close();}});
          upstream.on('message',data=>{
            try{const e=JSON.parse(data);
              if(e.type==='session.updated'){ready=true;send({type:'relay.ready',mode,model:config.model,sampleRate:24000});}
              if(e.type==='response.created')responseActive=true;
              if(e.type==='response.done')responseActive=false;
              // A reply that calls tools: do them, hand back the results and let the model answer (that answer is
              // the turn's real end, so this response.done is not passed on).
              const calls=e.type==='response.done'?(e.response?.output||[]).filter(item=>item?.type==='function_call'):[];
              if(calls.length){(async()=>{for(const c of calls){let output;try{output=String(await runTool(c.name,JSON.parse(c.arguments||'{}')));}catch(err){output='Failed: '+String(err?.message||err).slice(0,200);}
                sendUp({type:'conversation.item.create',item:{type:'function_call_output',call_id:c.call_id,output}});}sendUp({type:'response.create'});})();return;}
              if(e.type==='error'){fail(safeError(e.error));return;}
              if(e.type==='response.done'&&e.response?.status==='failed'){fail(safeError(e.response.status_details?.error||{message:'Model response failed.'}));}
              if(['session.created','session.updated','input_audio_buffer.committed','conversation.item.input_audio_transcription.completed','conversation.item.input_audio_transcription.failed','response.created','response.output_item.added','response.output_audio.delta','response.output_audio.done','response.output_audio_transcript.delta','response.output_audio_transcript.done','response.done','rate_limits.updated'].includes(e.type))emit(e);
            }catch{fail('Invalid event received from voice provider.');}
          });return;
        }
        if(!ready)throw Error('Connect voice before starting a turn.');
        if(event.type==='begin'){
          if(recording)throw Error('Already recording.');recording=true;bytes=0;frames=[];
          if(responseActive){sendUp({type:'response.cancel'});responseActive=false;}
          if(mode==='openai')sendUp({type:'input_audio_buffer.clear'});
          clearTimeout(turnTimer);turnTimer=setTimeout(()=>{recording=false;frames=[];sendUp({type:'input_audio_buffer.clear'});fail('Recording stopped at 30 seconds. Release and try a shorter turn.');},30000);
          send({type:'relay.recording'});return;
        }
        if(event.type==='audio'){
          if(!recording)throw Error('Hold push-to-talk before sending audio.');const pcm=decodeAudio(event.audio);bytes+=pcm.length;
          if(bytes>1440000)throw Error('Recording exceeds the 30-second limit.');
          if(mode==='loopback')frames.push(event.audio);else{if(upstream.bufferedAmount>512000)throw Error('Voice connection is too slow. Cancel and reconnect.');sendUp({type:'input_audio_buffer.append',audio:event.audio});}return;
        }
        if(event.type==='end'){
          if(!recording)throw Error('No recording is active.');recording=false;clearTimeout(turnTimer);
          if(bytes<4800){frames=[];sendUp({type:'input_audio_buffer.clear'});throw Error('Hold the button a little longer before releasing.');}
          send({type:'relay.committed',audioMs:Math.round(bytes/48)});
          if(mode==='loopback'){for(const delta of frames)emit({type:'response.output_audio.delta',delta});emit({type:'response.output_audio.done'});frames=[];send({type:'relay.loopback.done'});}
          else{sendUp({type:'input_audio_buffer.commit'});sendUp({type:'response.create'});}return;
        }
        if(event.type==='interrupt'){
          recording=false;frames=[];clearTimeout(turnTimer);if(responseActive)sendUp({type:'response.cancel'});responseActive=false;sendUp({type:'input_audio_buffer.clear'});
          if(typeof event.itemId==='string'&&/^item_[\w-]{1,100}$/.test(event.itemId)&&Number.isFinite(event.audioEndMs))sendUp({type:'conversation.item.truncate',item_id:event.itemId,content_index:0,audio_end_ms:Math.max(0,Math.floor(event.audioEndMs))});
          send({type:'relay.interrupted'});return;
        }
        if(event.type==='text'){
          if(mode!=='openai')throw Error('Typed prompts require AI voice mode.');const text=String(event.text||'').trim();if(!text||text.length>2000)throw Error('Enter 1–2000 characters.');
          if(recording||responseActive)throw Error('Stop the current turn first.');sendUp({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}});sendUp({type:'response.create'});return;
        }
        throw Error('Unknown voice event.');
      }catch(error){if(recording){recording=false;frames=[];clearTimeout(turnTimer);sendUp({type:'input_audio_buffer.clear'});}fail(safeError(error));}
    });
    send({type:'relay.connected',protocol:'orbit-pcm-v1'});
  });
  return {status,configure,close(){for(const client of clients)client.close();wss.close();}};
}
