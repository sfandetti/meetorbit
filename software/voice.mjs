export function initVoice({canStart=()=>true,onState=()=>{},log=()=>{}}={}){
  const $=id=>document.getElementById(id);
  let ws=null,ready=false,recording=false,finishing=false,mic=null,context=null,worklet=null,source=null,sessionMode='loopback',busy=false;
  let nodes=[],audioNext=0,audioStart=0,audioDuration=0,itemId=null,ignoreAudio=false,turnEnded=0,recordStarted=0,recordTimer,playbackTimer,connectTimer,micTimer,generation=0;
  let text='',resolveStopped=null,outputVolume=.8,muted=false,firstAudio=false,byteCount=0,startPending=false,cancelStart=false,enabling=false,contextReady=null;
  const diagnostics=[];
  let credentialKnown=false,credentialConfigured=false,windowAway=false;
  let reconnectWanted=false,restoring=false;
  let commandCapture=false,terminalStarting=false,terminalCancelled=false,terminalTimer;
  let handsFree=false,heardSpeech=false,lastSpeech=0,recordWall=0;
  const terminalState=(stage,message)=>document.dispatchEvent(new CustomEvent('orbit-terminal-mic-state',{detail:{stage,message}}));
  try{reconnectWanted=!!sessionStorage.getItem('orbit-voice-mode');}catch{}
  function rememberVoice(){reconnectWanted=true;try{sessionStorage.setItem('orbit-voice-mode',sessionMode);}catch{}}
  async function restoreVoice(){
    if(restoring||!reconnectWanted||ws||document.hidden||document.hasFocus?.()===false||!navigator.permissions?.query)return;
    restoring=true;try{const permission=await navigator.permissions.query({name:'microphone'});if(permission.state!=='granted')return;try{$('voiceMode').value=sessionStorage.getItem('orbit-voice-mode')||'openai';}catch{}await enableMic();if(mic)await connect();}finally{restoring=false;}
  }
  function showCredential(config){
    credentialKnown=true;credentialConfigured=!!config.configured;
    const message=credentialConfigured?'API key saved for this computer session · shared across Orbit browsers':'No API key saved for this computer session';
    $('companionCredentialStatus').textContent=message;$('voiceCredentialStatus').textContent=message;
    $('companionKeyLabel').hidden=credentialConfigured&&!$('companionKey').value;
    $('companionChangeKey').hidden=!credentialConfigured;
    $('voiceKey').placeholder=credentialConfigured?'Replace saved API key (optional)':'OpenAI API key · relay memory only';
  }
  async function refreshCredential(){try{const response=await fetch('/api/voice/status',{cache:'no-store'});if(!response.ok)throw Error();const config=await response.json();showCredential(config);return config;}catch{$('companionCredentialStatus').textContent='Could not check the shared relay key. Try again.';}}
  function trace(message){diagnostics.unshift(`${new Date().toLocaleTimeString()} ${message}`);diagnostics.length=Math.min(diagnostics.length,50);$('voiceTrace').textContent=diagnostics.join('\n');}
  function status(message){$('voiceStatus').textContent=message;$('companionConnectStatus').textContent=message;$('companionVoiceStatus').textContent=message;}
  function state(value,message){busy=['listening','thinking','speaking'].includes(value);document.dispatchEvent(new CustomEvent('orbit-voice-activity',{detail:busy}));onState(value,message);$('voiceStage').textContent=message||value;update();if(value==='idle'&&windowAway&&ready)queueMicrotask(()=>{if(windowAway&&ready&&!busy&&!recording)disconnect('Voice released for another window. Your API key is still saved.');});}
  function update(){
    $('voiceConnect').disabled=!!ws;$('voiceDisconnect').disabled=!ws&&!mic;
    $('voiceEnableMic').textContent=mic?'Microphone ready':enabling?'Requesting microphone…':'Enable microphone';$('voiceEnableMic').disabled=!!mic||enabling;
    for(const id of ['voiceHold','talk']){$(id).disabled=id==='talk'?false:!ready||!mic;$(id).textContent=recording?'Release to send':ready&&mic?'Hold to talk':id==='talk'?'Start voice':'Hold to talk';$(id).setAttribute('aria-pressed',String(recording));}
    $('companionVoiceStart').disabled=(!!ws&&!ready)||enabling;
    if(ready&&mic){$('companionVoiceStatus').textContent=sessionMode==='openai'?'AI connected · hold to speak':'Local echo · microphone test';if($('companionVoiceDialog').open)$('companionVoiceDialog').close();}
    $('voiceToggle').disabled=!ready||!mic;$('voiceToggle').textContent=recording?'Send recording':'Tap to record';
    $('voiceSendText').disabled=!ready||sessionMode!=='openai'||busy;$('voiceReplay').disabled=busy;
    $('voiceMode').disabled=!!ws;$('voiceModel').disabled=!!ws;$('voiceVoice').disabled=!!ws;$('voiceInstructions').disabled=!!ws;
    $('voiceStop').disabled=!recording&&!busy;$('previewCancel').disabled=!recording&&!busy;
  }
  const send=event=>{if(ws?.readyState===WebSocket.OPEN){if(ws.bufferedAmount>512000){disconnect('Connection too slow. Reconnect voice.');return false;}ws.send(JSON.stringify(event));return true;}return false;};
  async function ensureContext(){
    if(!context){try{context=new AudioContext({sampleRate:24000});}catch{context=new AudioContext();}contextReady=context.audioWorklet.addModule('./pcm-worklet.js');}
    await contextReady;
    if(context.state==='suspended')await context.resume();return context;
  }
  function bytesToBase64(buffer){let s='';for(const byte of new Uint8Array(buffer))s+=String.fromCharCode(byte);return btoa(s);}
  function clearPlayback(){clearTimeout(playbackTimer);for(const n of nodes){try{n.source.stop();}catch{}n.source.disconnect();n.gain.disconnect();}nodes=[];audioNext=0;audioStart=0;audioDuration=0;}
  function playedMs(){return !context||!audioStart?0:Math.max(0,Math.min(audioDuration,(context.currentTime-audioStart)*1000));}
  function interrupt(){
    handsFree=false;
    const played=playedMs();cancelStart=true;ignoreAudio=true;clearTimeout(recordTimer);recording=false;finishing=false;worklet?.port.postMessage('cancel');if(mic)for(const t of mic.getTracks())t.enabled=false;
    if(ready)send({type:'interrupt',itemId,audioEndMs:played});clearPlayback();state('idle','Ready for the next turn.');trace('Turn interrupted; queued audio cleared.');
  }
  function scheduleAudio(base64){
    if(ignoreAudio||!context)return;const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));if(bytes.length%2)return;
    const view=new DataView(bytes.buffer),buffer=context.createBuffer(1,bytes.length/2,24000),channel=buffer.getChannelData(0);
    for(let i=0;i<channel.length;i++)channel[i]=view.getInt16(i*2,true)/32768;
    const audioSource=context.createBufferSource(),gain=context.createGain();audioSource.buffer=buffer;gain.gain.value=muted?0:outputVolume;audioSource.connect(gain).connect(context.destination);
    const start=Math.max(context.currentTime+.025,audioNext);if(!audioStart)audioStart=start;audioNext=start+buffer.duration;audioDuration+=buffer.duration*1000;
    nodes.push({source:audioSource,gain});audioSource.onended=()=>{nodes=nodes.filter(n=>n.source!==audioSource);audioSource.disconnect();gain.disconnect();};audioSource.start(start);
    if(!firstAudio){firstAudio=true;$('voiceTiming').textContent=`Reply audio: ${Math.max(0,Math.round(performance.now()-turnEnded))} ms after send`;trace('First audio received.');state('speaking',sessionMode==='loopback'?'Playing your microphone recording.':'Orbit is speaking.');}
  }
  function finishPlayback(){clearTimeout(playbackTimer);playbackTimer=setTimeout(()=>{if(!recording&&!ignoreAudio){state('idle','Ready. Hold to speak again.');trace('Playback complete.');}},Math.max(0,(audioNext-(context?.currentTime||0))*1000)+100);}
  async function enableMic(){
    if(enabling||mic)return;enabling=true;update();
    const token=generation;
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode)throw Error('This browser cannot capture microphone audio. Open Orbit in Chrome or Edge.');
      status('Requesting microphone permission…');const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(token!==generation){stream.getTracks().forEach(t=>t.stop());return;}
      mic=stream;for(const track of mic.getTracks()){track.enabled=false;track.onended=()=>disconnect('Microphone was disconnected.');}
      await ensureContext();source=context.createMediaStreamSource(mic);worklet=new AudioWorkletNode(context,'orbit-pcm');source.connect(worklet);worklet.connect(context.destination);
      worklet.port.onmessage=({data})=>{
        if(data.type==='level'){$('voiceMeter').value=Math.min(1,data.value*3);if(handsFree&&recording){const now=Date.now();if(data.value>.035){heardSpeech=true;lastSpeech=now;}if(heardSpeech&&now-lastSpeech>1500)void end();else if(!heardSpeech&&now-recordWall>7000){interrupt();terminalState('idle','No speech detected. Say “Hey Orbit” to try again.');}}}
        if(data.type==='audio'&&(recording||finishing)){byteCount+=data.buffer.byteLength;send({type:'audio',audio:bytesToBase64(data.buffer)});}
        if(data.type==='stopped'&&resolveStopped){const resolve=resolveStopped;resolveStopped=null;resolve();}
      };
      status('Microphone ready. Audio is sent only while recording.');$('voiceStage').textContent=ready?'Ready. Hold to speak.':'Connect voice to start.';trace(`Microphone enabled · ${context.sampleRate} Hz processing → 24 kHz PCM16.`);update();
      clearTimeout(micTimer);micTimer=setTimeout(()=>{if(!recording&&!busy&&!ws)releaseMic();},120000);
    }catch(error){if(token===generation){releaseMic();status(error.name==='NotAllowedError'?'Microphone permission was denied. Allow it in the browser and try again.':error.message);trace('Microphone unavailable.');}}finally{if(token===generation)enabling=false;update();}
  }
  function releaseMic(){clearTimeout(micTimer);if(mic){for(const t of mic.getTracks()){t.onended=null;t.stop();}mic=null;}worklet?.disconnect();source?.disconnect();worklet=null;source=null;$('voiceMeter').value=0;update();}
  function disconnect(message='Voice disconnected. Microphone released.'){
    clearTimeout(terminalTimer);
    if(commandCapture||terminalStarting)terminalState('idle',message);
    generation++;enabling=false;cancelStart=true;clearTimeout(connectTimer);clearTimeout(recordTimer);clearPlayback();ready=false;recording=false;finishing=false;ignoreAudio=true;
    const connection=ws;ws=null;connection?.close();releaseMic();state('idle',message);status(message);trace('Relay disconnected.');
  }
  async function connect(){
    if(ws)return;
    try{
      const relay=await refreshCredential();
      if(relay?.active>0){status('Another Orbit window is using voice. Switch away from that window or disconnect it, then connect here. Your API key is still saved.');return;}
      if($('voiceMode').value==='openai'&&(!credentialKnown||!credentialConfigured)){status('No shared API key is available. Add it once in Orbit AI companion by Chat or Voice lab.');return;}
      await ensureContext();sessionMode=$('voiceMode').value;
      const connection=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/voice/socket`);ws=connection;status('Connecting local voice relay…');trace(`Connecting · ${sessionMode}.`);update();
      connectTimer=setTimeout(()=>{if(!ready)disconnect('Voice connection timed out. Check the relay and API key.');},20000);
      connection.onopen=()=>connection.send(JSON.stringify({type:'start',mode:sessionMode,config:{model:$('voiceModel').value,voice:$('voiceVoice').value,instructions:$('voiceInstructions').value}}));
      let connectionError='';
      connection.onmessage=({data})=>{if(ws!==connection)return;try{const e=JSON.parse(data);if(e.type==='relay.ready'){ready=true;rememberVoice();connectionError='';clearTimeout(connectTimer);status(sessionMode==='loopback'?'Local loopback connected · no audio leaves this PC.':'AI voice connected · recordings go to OpenAI.');trace('Relay ready.');$('voiceStage').textContent=mic?'Ready. Hold to speak.':'Enable microphone, then hold to talk.';update();return;}
        if(e.type==='relay.error'){connectionError=e.message;status(e.message);trace(e.message);if(recording||finishing||busy)interrupt();if(commandCapture){clearTimeout(terminalTimer);terminalState('idle',e.message);}return;}
        if(e.type==='relay.connecting'){trace(`OpenAI handshake · ${e.model}.`);return;}
        if(e.type==='relay.committed'){trace(`Audio committed · ${e.audioMs} ms · ${byteCount} bytes.`);return;}
        if(e.type==='relay.loopback.done'){finishPlayback();return;}
        if(e.type!=='upstream')return;const event=e.event;
        if(commandCapture&&event.type==='conversation.item.input_audio_transcription.completed'){
          clearTimeout(terminalTimer);
          const transcript=event.transcript||'';document.dispatchEvent(new CustomEvent('orbit-terminal-transcript',{detail:transcript}));interrupt();terminalState('idle',transcript?'Transcript ready. Press Enter or Send.':'No words detected. Try again.');return;
        }
        if(commandCapture&&event.type==='conversation.item.input_audio_transcription.failed'){clearTimeout(terminalTimer);interrupt();terminalState('idle','Transcription failed. Try again or type your command.');return;}
        if(commandCapture&&event.type.startsWith('response.'))return;
        if((recording||finishing||ignoreAudio)&&event.type.startsWith('response.'))return;
        if(event.type!=='response.output_audio.delta'&&event.type!=='response.output_audio_transcript.delta')trace(event.type);
        if(event.type==='response.created'){ignoreAudio=false;text='';$('voiceAssistant').textContent='';state('thinking','Orbit is thinking.');}
        if(event.type==='response.output_item.added'&&event.item?.role==='assistant')itemId=event.item.id;
        if(event.type==='response.output_audio.delta')scheduleAudio(event.delta);
        if(event.type==='response.output_audio.done')finishPlayback();
        if(event.type==='response.output_audio_transcript.delta'){text+=event.delta;$('voiceAssistant').textContent=text.slice(0,8000);}
        if(event.type==='response.output_audio_transcript.done'){$('voiceAssistant').textContent=event.transcript||text;onState('speaking',event.transcript||text);}
        if(event.type==='conversation.item.input_audio_transcription.completed'){$('voiceUser').textContent=event.transcript||'(No transcript)';document.dispatchEvent(new CustomEvent('orbit-voice-transcript',{detail:event.transcript||''}));}
        if(event.type==='conversation.item.input_audio_transcription.failed')$('voiceUser').textContent='Transcription failed. See relay trace.';
        if(event.type==='response.done'){if(event.response?.usage)$('voiceUsage').textContent=`Tokens · input ${event.response.usage.input_tokens??'—'} / output ${event.response.usage.output_tokens??'—'}`;if(!firstAudio)state('idle',event.response?.status==='failed'?'Response failed. Check relay trace.':'Turn complete.');}
      }catch{status('Could not read a relay event.');}};
      connection.onclose=()=>{if(ws===connection)disconnect(connectionError||'Voice connection closed. Reconnect to continue.');};
      connection.onerror=()=>{connectionError=connectionError||'Could not open voice. Another Orbit window may be connected; disconnect it and retry here.';status(connectionError);};
    }catch(error){disconnect(error.message);}
  }
  async function begin({terminal=false}={}){
    if(startPending||recording||finishing||!ready||!mic)return;if(!canStart({terminal}))return;
    startPending=true;cancelStart=false;await context.resume();startPending=false;if(cancelStart||!ready||!mic)return;
    interrupt();commandCapture=terminal;cancelStart=false;ignoreAudio=terminal;itemId=null;firstAudio=false;text='';byteCount=0;audioDuration=0;$('voiceAssistant').textContent='';$('voiceUser').textContent=sessionMode==='loopback'?'Local microphone loopback · no transcription':'Listening…';
    if(!send({type:'begin',...(terminal?{transcriptionOnly:true}:{})}))return;recording=true;recordStarted=performance.now();for(const track of mic.getTracks())track.enabled=true;worklet.port.postMessage('start');state('listening','Listening. Release to send.');if(terminal)terminalState('recording','Listening… click Stop when finished.');trace('Push-to-talk down.');
    recordTimer=setTimeout(()=>end(),29500);update();
  }
  async function end(){
    handsFree=false;
    if(startPending){cancelStart=true;return;}
    if(!recording||finishing)return;finishing=true;recording=false;clearTimeout(recordTimer);
    const stopped=new Promise(resolve=>{resolveStopped=resolve;});worklet?.port.postMessage('stop');for(const track of mic?.getTracks()||[])track.enabled=false;
    await Promise.race([stopped,new Promise(resolve=>setTimeout(resolve,500))]);finishing=false;resolveStopped=null;
    if(!ready)return;turnEnded=performance.now();trace(`Push-to-talk up · ${Math.round(turnEnded-recordStarted)} ms.`);
    if(byteCount<4800){send({type:'interrupt'});state('idle','Hold the button a little longer.');if(commandCapture)terminalState('idle','Recording too short. Tap the microphone and try again.');return;}
    if(commandCapture){terminalState('transcribing','Transcribing…');clearTimeout(terminalTimer);terminalTimer=setTimeout(()=>{interrupt();terminalState('idle','Transcription timed out. Try again or type your command.');},20000);}
    state('thinking',sessionMode==='loopback'?'Sending recording through local relay…':'Sending audio to Orbit…');send({type:'end'});
  }
  for(const id of ['talk','voiceHold']){
    const button=$(id);button.style.touchAction='none';
    button.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();button.setPointerCapture(e.pointerId);begin();});
    button.addEventListener('pointerup',e=>{e.preventDefault();end();});button.addEventListener('pointercancel',()=>interrupt());
    button.addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();if(!e.repeat)begin();}});button.addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();end();}});
    button.addEventListener('contextmenu',e=>e.preventDefault());
  }
  $('talk').addEventListener('click',async()=>{if(!ready||!mic){$('companionVoiceMode').value=ws?sessionMode:'openai';if(credentialConfigured){await startCompanionVoice();}else{$('companionVoiceDialog').showModal();refreshCredential();}}});
  $('companionChangeKey').addEventListener('click',()=>{$('companionKeyLabel').hidden=false;$('companionKey').focus();});
  $('talk').addEventListener('keydown',e=>{if((!ready||!mic)&&[' ','Enter'].includes(e.key)&&!e.repeat){$('companionVoiceDialog').showModal();}});
  $('companionVoiceClose').addEventListener('click',()=>$('companionVoiceDialog').close());
  async function startCompanionVoice(){
    $('companionVoiceStart').disabled=true;
    try{
      if($('companionKey').value){const response=await fetch('/api/voice/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:$('companionKey').value})});const result=await response.json();if(!response.ok)throw Error(result.error);$('companionKey').value='';showCredential(result);}
      if(!ws)$('voiceMode').value=$('companionVoiceMode').value;
      if($('voiceMode').value==='openai'){await refreshCredential();if(!credentialConfigured){status('Add an API key once; it will be shared across Orbit browsers for this relay session.');return;}}
      await enableMic();if(mic)await connect();
    }catch(error){status(error.message);}finally{update();}
  }
  $('companionVoiceStart').addEventListener('click',startCompanionVoice);
  async function toggleMic({terminal=true,automatic=false}={}){
    if(commandCapture&&recording){await end();return;}if(terminalStarting||finishing)return;
    terminalStarting=true;terminalCancelled=false;terminalState('connecting','Connecting microphone…');
    try{
      if(ready&&sessionMode!=='openai')disconnect();$('companionVoiceMode').value='openai';
      if(!ready||!mic)await startCompanionVoice();
      const deadline=Date.now()+20000;while(!ready&&ws&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
      if(terminalCancelled)throw Error('Recording cancelled.');if(!ready||!mic)throw Error($('companionConnectStatus').textContent||'Connect AI voice and allow the microphone first.');
      await begin({terminal});if(!recording)throw Error('Unlock Orbit before recording.');handsFree=automatic;heardSpeech=false;recordWall=lastSpeech=Date.now();
    }catch(e){terminalState('idle',e.message);document.dispatchEvent(new CustomEvent('orbit-voice-activity',{detail:false}));}finally{terminalStarting=false;}
  }
  document.addEventListener('orbit-terminal-mic',()=>toggleMic());
  document.addEventListener('orbit-wake-voice',e=>toggleMic({terminal:!!e.detail?.terminal,automatic:true}));
  document.addEventListener('orbit-terminal-mic-cancel',()=>{terminalCancelled=true;clearTimeout(terminalTimer);if(commandCapture){interrupt();terminalState('idle','Recording cancelled.');}});
  function forgetConnection(){reconnectWanted=false;try{sessionStorage.removeItem('orbit-voice-mode');}catch{}disconnect();}
  $('voiceEnableMic').addEventListener('click',enableMic);$('voiceConnect').addEventListener('click',connect);$('voiceDisconnect').addEventListener('click',forgetConnection);
  $('voiceToggle').addEventListener('click',()=>recording?end():begin());$('voiceStop').addEventListener('click',interrupt);
  $('voiceSendText').addEventListener('click',()=>{const prompt=$('voiceText').value.trim();if(!prompt||!ready||busy||!canStart())return;interrupt();ignoreAudio=false;firstAudio=false;turnEnded=performance.now();$('voiceUser').textContent=prompt;$('voiceAssistant').textContent='';send({type:'text',text:prompt});$('voiceText').value='';state('thinking','Orbit is thinking.');});
  $('voiceVolume').addEventListener('input',()=>{outputVolume=Number($('voiceVolume').value)/100;for(const node of nodes)node.gain.gain.value=muted?0:outputVolume;});
  $('voiceMute').addEventListener('change',()=>{muted=$('voiceMute').checked;for(const node of nodes)node.gain.gain.value=muted?0:outputVolume;});
  $('voiceReplay').addEventListener('click',async()=>{await ensureContext();const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.value=523;gain.gain.value=muted?0:outputVolume*.15;oscillator.connect(gain).connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.25);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};trace('Local speaker test tone.');});
  $('voiceKeyForm').addEventListener('submit',async e=>{e.preventDefault();try{const response=await fetch('/api/voice/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:$('voiceKey').value})});const result=await response.json();if(!response.ok)throw Error(result.error);$('voiceKey').value='';showCredential(result);status('API key saved for this computer session. All Orbit browsers use it. Connect AI voice to verify access.');}catch(error){status(error.message);}});
  $('voiceForgetKey').addEventListener('click',async()=>{disconnect();try{const response=await fetch('/api/voice/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clear:true})});if(!response.ok)throw Error('Could not clear relay key.');showCredential({configured:false});status('Shared relay API key cleared for all Orbit browsers. Local loopback still works.');}catch(error){status(error.message);}});
  window.addEventListener('focus',async()=>{windowAway=false;await refreshCredential();await restoreVoice();});window.addEventListener('blur',()=>{windowAway=true;if(recording)interrupt();if(ready&&!busy&&!enabling)disconnect('Voice released for another window. Your API key is still saved.');});document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect('Voice stopped when the page was hidden.');else{refreshCredential();restoreVoice();}});window.addEventListener('pagehide',()=>disconnect());
  refreshCredential().then(config=>{if(!config)return;
    $('voiceModel').value=config.defaults.model;for(const voice of config.voices)$('voiceVoice').add(new Option(voice,voice));$('voiceVoice').value=config.defaults.voice;$('voiceInstructions').value=config.instructions;status(config.configured?'API key available · Start voice connects directly.':'Add an API key for AI voice, or use Local loopback.');update();restoreVoice();
  }).catch(()=>status('Voice relay unavailable.'));
  update();
  return {get active(){return busy||recording;},get connected(){return ready;},stop:interrupt,disconnect:forgetConnection,trace};
}
