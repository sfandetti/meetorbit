// Speech for the engines that can't hear or speak by themselves (Claude, DeepSeek, Cursor): OpenAI turns
// what was said into text, and the engine's answer back into speech. Orbit's audio format both ways:
// 24 kHz, 16-bit, mono PCM.
import {VOICE_DEFAULTS} from './voice-relay.mjs';
export function wav(pcm,rate=24000){
  const head=Buffer.alloc(44);head.write('RIFF',0);head.writeUInt32LE(36+pcm.length,4);head.write('WAVEfmt ',8);head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);
  head.writeUInt32LE(rate,24);head.writeUInt32LE(rate*2,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(pcm.length,40);
  return Buffer.concat([head,pcm]);
}
const needKey=key=>{if(!key)throw Error('Talking to this engine needs your OpenAI key too (for speech). Add it in the Orbit console.');};
// Each call tries the models in order and moves on when OpenAI doesn't offer one; a bad key or a rate
// limit stops at once, since another model wouldn't help.
async function firstWorking(models,attempt){
  let last;
  for(const model of [...new Set(models)]){
    const response=await attempt(model);
    if(response.ok)return response;
    last=Error(response.status===401?'OpenAI rejected the key.':`OpenAI speech request failed (${response.status}).`);
    if(response.status===401||response.status===429)break;
  }
  throw last;
}
export async function transcribe(pcm,{key,fetcher=fetch,models=[VOICE_DEFAULTS.transcription,'gpt-4o-mini-transcribe']}={}){
  needKey(key);
  const response=await firstWorking(models,model=>{
    const form=new FormData();form.append('file',new Blob([wav(pcm)],{type:'audio/wav'}),'heard.wav');form.append('model',model);form.append('language','en');
    return fetcher('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(20000)});
  });
  return String((await response.json().catch(()=>({}))).text||'').trim();
}
// Text to Orbit-ready PCM in Orbit's usual voice.
export async function speak(text,{key,voice=VOICE_DEFAULTS.voice,fetcher=fetch,models=['gpt-4o-mini-tts','tts-1']}={}){
  needKey(key);
  const input=String(text||'').slice(0,3000);if(!input)return Buffer.alloc(0);
  const response=await firstWorking(models,model=>fetcher('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({model,voice,input,response_format:'pcm'}),signal:AbortSignal.timeout(60000)}));
  return Buffer.from(await response.arrayBuffer());
}
