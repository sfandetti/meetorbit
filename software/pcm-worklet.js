// Mono signed PCM16, 24kHz, little-endian: also the future device relay format.
class OrbitPCM extends AudioWorkletProcessor {
  constructor(){super();this.recording=false;this.samples=[];this.phase=0;this.level=0;this.levelFrames=0;this.port.onmessage=({data})=>{
    if(data==='start'){this.samples=[];this.phase=0;this.recording=true;}
    if(data==='stop'){this.recording=false;this.flush();this.port.postMessage({type:'stopped'});}
    if(data==='cancel'){this.recording=false;this.samples=[];}
  };}
  flush(){if(!this.samples.length)return;const buffer=new ArrayBuffer(this.samples.length*2),view=new DataView(buffer);this.samples.forEach((v,i)=>view.setInt16(i*2,v,true));this.samples=[];this.port.postMessage({type:'audio',buffer},[buffer]);}
  process(inputs,outputs){
    // The output stays silent; input is never monitored into the speakers while recording.
    for(const output of outputs)for(const channel of output)channel.fill(0);
    const input=inputs[0]?.[0];if(!input)return true;
    let peak=0;
    for(const sample of input){peak=Math.max(peak,Math.abs(sample));if(this.recording){this.phase+=24000/sampleRate;if(this.phase>=1){this.phase-=1;const n=Math.max(-1,Math.min(1,sample));this.samples.push(Math.round(n<0?n*32768:n*32767));if(this.samples.length===2400)this.flush();}}}
    this.level=Math.max(this.level,peak);this.levelFrames+=input.length;if(this.levelFrames>=sampleRate/10){this.port.postMessage({type:'level',value:this.level});this.level=0;this.levelFrames=0;}return true;
  }
}
registerProcessor('orbit-pcm',OrbitPCM);
