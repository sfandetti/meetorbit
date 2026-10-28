export function heardWakePhrase(text){return /\bhey[\s,!.:-]+orbit\b/i.test(String(text||''));}
export function initWake({window:win=window,document:doc=document,delay=setTimeout,cancel=clearTimeout}={}){
  const toggle=doc.getElementById('wakeEnabled'),status=doc.getElementById('wakeStatus'),Recognition=win.SpeechRecognition||win.webkitSpeechRecognition;
  let recognition=null,enabled=false,busy=false,pending=false,restart=null,failures=0,hidden=doc.hidden;
  const message=text=>status.textContent=text;
  function stop(){cancel(restart);restart=null;try{recognition?.abort();}catch{}recognition=null;}
  function off(text='Voice activation is off.'){enabled=false;pending=false;toggle.checked=false;stop();message(text);}
  function start(){if(!enabled||busy||hidden||recognition)return;const r=new Recognition();recognition=r;r.continuous=true;r.interimResults=false;r.lang='en-US';
    r.onstart=()=>message('Listening for “Hey Orbit” · microphone active');
    r.onresult=e=>{for(let i=e.resultIndex||0;i<e.results.length;i++)if(e.results[i].isFinal&&heardWakePhrase(e.results[i][0]?.transcript)){pending=true;busy=true;message('“Hey Orbit” heard. Pause briefly, then speak…');r.abort();break;}};
    r.onerror=e=>{if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error))off('Wake microphone unavailable. Check browser permission or use the microphone button.');else if(e.error==='network'&&++failures>=3)off('Browser speech service unavailable. Use the microphone button.');};
    r.onend=()=>{if(recognition===r)recognition=null;if(pending&&enabled&&!hidden){pending=false;const terminal=doc.querySelector('[data-mode="relay"]')?.getAttribute('aria-pressed')==='true';doc.dispatchEvent(new win.CustomEvent('orbit-wake-voice',{detail:{terminal}}));}else if(enabled&&!busy&&!hidden){restart=delay(start,failures?3000:500);}};
    try{r.start();}catch{off('Voice activation could not start. Use Chrome or the microphone button.');}
  }
  if(!Recognition){toggle.disabled=true;message('Wake phrases are unavailable in this browser. Use Chrome with speech recognition, or the microphone button.');return {off};}
  toggle.addEventListener('change',()=>{if(toggle.checked){enabled=true;failures=0;start();}else off();});
  doc.addEventListener('orbit-voice-activity',e=>{busy=!!e.detail;if(busy){stop();message('Wake listening paused during the voice turn.');}else if(enabled){cancel(restart);restart=delay(start,600);}});
  doc.addEventListener('visibilitychange',()=>{hidden=doc.hidden;if(hidden){pending=false;stop();message(enabled?'Wake listening paused while this tab is hidden.':'Voice activation is off.');}else start();});
  win.addEventListener('pagehide',()=>off());return {off};
}
if(typeof document!=='undefined'&&document.getElementById('wakeEnabled'))initWake();
