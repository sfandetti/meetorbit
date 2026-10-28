import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';

const powershell=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const script=fileURLToPath(new URL('./serial-beep.ps1',import.meta.url));
function launchSerialHelper(port,mode){
  // Use a fixed, bundled command body; do not change Windows execution policy.
  // Port is validated before this is reached, and never accepted as shell code.
  const command=`& {\n${readFileSync(script,'utf8')}\n} -Port '${port}' -Action '${mode}'`;
  return spawn(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
}
export async function listSerialPorts(){
  const {stdout}=await promisify(execFile)(powershell,['-NoProfile','-NonInteractive','-Command','[IO.Ports.SerialPort]::GetPortNames() | ConvertTo-Json -Compress'],{windowsHide:true,timeout:5000});
  const parsed=stdout.trim()?JSON.parse(stdout):[];
  return (Array.isArray(parsed)?parsed:[parsed]).filter(p=>/^COM\d{1,4}$/.test(p)).sort((a,b)=>Number(a.slice(3))-Number(b.slice(3)));
}
const errors={
  'memory-error':'The board could not allocate its recording buffer. USB released; recording did not start.',
  'rx-init-error':'The board could not start the microphone input. USB released.',
  'tx-init-error':'Recording finished, but the board could not start speaker output. USB released.',
  'no-signal':'The recording contained no measurable microphone signal. USB released.',
  'capture-incomplete':'The board did not receive the full three seconds of microphone samples. USB released.',
  'tx-write-error':'The board could not finish sending the recording to the speaker. USB released.',
  'port-unavailable':'USB port is busy or unavailable. Close other beep utilities, serial monitors, or other USB tools, then try again.',
  'device-error':'The board reported an audio error. USB released; no firmware was changed.',
  'no-ack':'No test acknowledgment from the board. Check the selected port and firmware. USB released.',
  'connection-error':'USB connection was lost or could not be used. Reconnect the board and refresh ports.'
};
export function createSerialBeep({ports=listSerialPorts,launch=launchSerialHelper,clock=Date.now,schedule=setTimeout,cancel=clearTimeout}={}){
  let child=null,phase='idle',port='',mode='beep',message='Ready. Select your board’s USB port.',endsAt=0,timer=null,usbReserved=false,stopping=false;
  let lastEvents=[],capture=null;
  const active=()=>!!child||phase==='starting'||usbReserved;
  const state=()=>({phase,port,mode,message:usbReserved?'USB is in use for Orbit device setup. Wait for it to finish.':message,endsAt,remainingSeconds:endsAt?Math.max(0,Math.ceil((endsAt-clock())/1000)):0,busy:active(),stoppable:!!child,capture,lastEvents:[...lastEvents]});
  function reserve(){if(active())throw Error('Stop the board beep and wait for USB to be released before using another USB tool.');usbReserved=true;return()=>{usbReserved=false;};}
  function stop(){
    if(!child)return state();
    if(!stopping){
      stopping=true;phase='stopping';message='Stopping beep and releasing USB…';child.stdin.end('STOP\n');
      cancel(timer);const current=child;
      timer=schedule(()=>{if(child===current){phase='error';message='The USB helper did not stop promptly. The board’s timed beep auto-stops after one minute.';current.kill();}},5000);timer?.unref?.();
    }
    return state();
  }
  async function start(selected,selectedMode='beep'){
    if(!['beep','loopback'].includes(selectedMode))throw Error('Choose a supported audio test.');
    if(typeof selected!=='string'||!/^COM\d{1,4}$/i.test(selected))throw Error('Select a connected USB port.');
    if(active())throw Error('USB is already in use by Orbit. Stop the current test or wait for setup to finish.');
    mode=selectedMode;phase='starting';port=selected.toUpperCase();message='Opening USB and waiting for the board’s acknowledgment…';endsAt=0;stopping=false;
    lastEvents=[];capture=null;
    let lines;
    try{
      if(!(await ports()).includes(port))throw Error('That USB port is no longer connected. Refresh ports and select the board.');
      child=launch(port,mode);const current=child;
      current.stdin.on('error',()=>{});current.stderr.resume();
      lines=createInterface({input:current.stdout});
      lines.on('line',raw=>{
        if(child!==current)return;
        let event,data;try{data=JSON.parse(raw);event=data.event;}catch{return;}
        if(!['opened','sent','started','countdown','recording','captured','playing','complete',...Object.keys(errors)].includes(event))return;
        lastEvents.push({event,at:clock()});if(lastEvents.length>16)lastEvents.shift();
        if(event==='captured'&&Number.isInteger(data.frames)&&Number.isInteger(data.peak)&&data.frames>=0&&data.frames<=48000&&data.peak>=0&&data.peak<=32768)capture={frames:data.frames,peak:data.peak};
        if(errors[event]){phase='error';message=errors[event];endsAt=0;}
        else if(event==='started'&&!stopping&&phase!=='error'){phase='running';endsAt=clock()+60000;message='Board acknowledged the beep. Listen for repeating tones; it stops after one minute.';}
        else if(['countdown','recording','playing'].includes(event)&&!stopping&&phase!=='error'&&mode==='loopback'){
          phase=event;endsAt=clock()+(event==='countdown'?5000:3000);
          message=event==='countdown'?'Get ready. Say “Testing one two three” when the countdown reaches zero.':event==='recording'?'Speak now: recording for three seconds.':'Listen: playing three seconds through Orbit’s speaker.';
        }
        else if(event==='complete'&&phase!=='error'){phase='stopping';message='Test finished. Releasing USB…';endsAt=0;}
      });
      const closed=()=>{
        if(child!==current)return;
        cancel(timer);timer=null;lines.close();child=null;endsAt=0;
        if(phase!=='error'){
          if(phase!=='stopping'){phase='error';message='The USB helper exited unexpectedly. Reconnect the board if the test does not stop.';}
          else{phase='idle';message=(stopping?'Audio test stopped.':mode==='loopback'?'Recording and playback completed.':'Beep test completed.')+' USB released and available to other tools.';}
        }
      };
      current.on('error',()=>{phase='error';message='Could not start the USB helper. USB released.';closed();});
      current.on('close',closed);
      timer=schedule(()=>{if(child===current){phase='error';message='USB helper timed out. Reconnect the board if the test does not stop.';current.kill();}},mode==='loopback'?28000:70000);
      timer?.unref?.();return state();
    }catch(error){lines?.close();child=null;phase='error';message=error.message;throw error;}
  }
  return {state,start,stop,reserve,ports};
}
