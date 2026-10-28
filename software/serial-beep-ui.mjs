const $=id=>document.getElementById(id);
const select=$('beepPort'),start=$('boardBeep'),stop=$('boardBeepStop'),status=$('boardBeepStatus'),refresh=$('beepPortsRefresh');
const loopback=$('boardLoopback');
let busy=false,pending=false,localError='';
async function api(action,body){
  const response=await fetch('/api/serial/'+action,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw Error(data.error||'USB request failed.');return data;
}
function render(state){
  busy=state.busy;status.textContent=(!busy&&localError)||state.message+(state.phase==='running'?` ${state.remainingSeconds}s remaining.`:'');
  start.disabled=busy||pending||!select.value;stop.disabled=!state.stoppable||pending||state.phase==='stopping';select.disabled=busy||pending;refresh.disabled=busy||pending;
  loopback.disabled=start.disabled;
  if(['countdown','recording','playing'].includes(state.phase))status.textContent+=` ${state.remainingSeconds}s.`;
  // Existing firmware upload and pairing controls use the same physical USB port.
  document.dispatchEvent(new CustomEvent('orbit-serial-busy',{detail:busy}));
}
async function loadPorts(){
  localError='';
  refresh.disabled=true;
  try{
    const {ports}=await api('ports');const previous=select.value;
    select.replaceChildren(new Option(ports.length?'Choose board USB port':'No USB ports detected',''));
    for(const port of ports)select.add(new Option(port,port));
    if(ports.includes(previous))select.value=previous;
    else if(ports.includes('COM4'))select.value='COM4';
    else if(ports.length===1&&ports[0]!=='COM1')select.value=ports[0];
    render(await api('state'));
  }catch(error){status.textContent=error.message;start.disabled=true;loopback.disabled=true;refresh.disabled=false;}
}
async function startTest(action){
  localError='';
  pending=true;start.disabled=true;loopback.disabled=true;refresh.disabled=true;select.disabled=true;
  try{render(await api(action,{port:select.value}));}
  catch(error){localError=error.message;status.textContent=error.message;}
  finally{pending=false;await update();}
}
start.addEventListener('click',()=>startTest('beep'));
loopback.addEventListener('click',()=>startTest('loopback'));
stop.addEventListener('click',async()=>{try{render(await api('stop',{}));}catch(error){status.textContent=error.message;}});
select.addEventListener('change',()=>{start.disabled=busy||pending||!select.value;loopback.disabled=start.disabled;});
refresh.addEventListener('click',loadPorts);
async function update(){try{render(await api('state'));}catch{status.textContent='Orbit console connection lost. The board’s audio test is timed.';start.disabled=true;loopback.disabled=true;}}
await loadPorts();setInterval(update,1000);
