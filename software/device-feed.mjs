import {randomUUID,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
// Keeps Orbit's companion settings in step with this PC over the device link, and carries out the buttons
// pressed on Orbit (App launcher, Sentry, Privacy guard, AI desk). Replaces the old HTTP POST /feed
// worker: the "feed" link message carries the same fields, all as strings, so the firmware reuses its
// /feed code. Orbit answers each feed with "feed-status" and pushes "command" / "desk-reply" as they happen.
export function passcodeHash(salt,pin){return createHash('sha256').update(String(salt)+String(pin)).digest('hex');}
export function newPasscode(pin){
  if(!/^\d{4,6}$/.test(String(pin)))throw Error('Enter matching passcodes with four to six digits.');
  const salt=randomBytes(16).toString('hex');return {pin_salt:salt,pin_hash:passcodeHash(salt,pin)};
}
export function passcodeMatches(secrets,pin){
  if(!secrets.pin_hash)return true;
  const a=Buffer.from(passcodeHash(secrets.pin_salt,pin)),b=Buffer.from(secrets.pin_hash);return a.length===b.length&&timingSafeEqual(a,b);
}
export function feedFields(profile,{pin={},desk=null,ack=null,media='Unknown',camera={},now=Date.now()}={}){
  const f={owner:profile.name,tz:profile.timezone,theme:profile.theme,palette:profile.palette,brightness:profile.brightness,startup_page:profile.startup_page,
    enabled:profile.screens.reduce((mask,p)=>mask+2**p,0),pin_hash:pin.pin_hash||'',pin_salt:pin.pin_salt||'',media_state:media,
    privacy_folders:profile.privacy_folders.length,privacy_browsers:profile.privacy_browsers.length,
    camera_state:camera.state||'Off',camera_armed:camera.armed?1:0,camera_motion:camera.motion||0,camera_clips:camera.clips||0};
  profile.quick_taps.forEach((v,i)=>{f['quick'+i]=v;});
  if(Array.isArray(profile.home_keys))f.home_keys=profile.home_keys.join(',');
  for(let i=0;i<6;i++)f['app'+i]=profile.apps[i]?.name||'Not set';
  if(desk){Object.assign(f,{ai_id:desk.id,ai_title:desk.title,ai_body:desk.body,ai_attention:desk.attention&&desk.expires>now?1:0,ai_expired:desk.expires<=now?1:0});}
  else f.ai_clear=1;
  if(ack)Object.assign(f,{command_ack:ack.id,command_session:ack.session,command_result:ack.result});
  return Object.fromEntries(Object.entries(f).map(([k,v])=>[k,String(v)]));
}
// link: {send(obj)->bool, status()}; actions: {execute(command)->Promise<string>, confirmed(action)->Promise<string>}.
export function createDeviceFeed({link,getProfile,getPin=()=>({}),getMedia=()=>'Unknown',getCamera=()=>({}),actions,now=Date.now,interval=2000}){
  let desk=null,ack=null,lastSent='',lastSentAt=0,lastReply=null,deviceState={},timer=null;const seen=new Set(),pendingConfirm=new Map(),running=new Set();
  function fields(){return feedFields(getProfile(),{pin:getPin(),desk,ack,media:getMedia(),camera:getCamera(),now:now()});}
  // Sends when something changed; the timer also resends every 10 s, so Orbit's feed-status stays fresh.
  function push(force=false){const f=fields(),text=JSON.stringify(f);if(!force&&text===lastSent)return false;if(link.send({type:'feed',...f})){lastSent=text;lastSentAt=now();return true;}return false;}
  function message(title,body,attention=true,expiresIn=300000){
    desk={id:randomUUID().replace(/-/g,''),title:String(title).slice(0,60),body:String(body).slice(0,240),attention:!!attention,expires:now()+expiresIn};
    lastReply=null;push(true);return desk.id;
  }
  // Clean-up and sign-out from Orbit need a YES held on the AI desk before they run.
  function askToConfirm(action,title,body){const id=message(title,body,true,120000);pendingConfirm.clear();pendingConfirm.set(id,{action,expires:now()+120000});return 'Confirm YES or NO on AI desk';}
  async function handleCommand(e){
    const id=String(e.id||''),session=String(e.session||''),command=String(e.command||''),tag=session+':'+id;
    if(!command||!id)return;
    if(seen.has(tag)){if(!running.has(tag)&&ack?.id!==id){ack={id,session,result:'Already handled; retry manually'};push(true);}return;}
    seen.add(tag);if(seen.size>500)seen.delete(seen.values().next().value);running.add(tag);
    let result;try{result=await actions.execute(command,{askToConfirm,message});}catch(error){result=String(error?.message||'Command could not complete').slice(0,40);}
    running.delete(tag);ack={id,session,result:String(result||'Done').slice(0,40)};push(true);
  }
  async function handleReply(e){
    if(!desk||e.id!==desk.id||!['YES','NO'].includes(e.reply)||desk.expires<=now())return;
    lastReply={id:desk.id,reply:e.reply,at:now()};desk.attention=false;
    const pending=pendingConfirm.get(desk.id);pendingConfirm.delete(desk.id);
    if(pending&&e.reply==='YES'&&now()<pending.expires){
      let result;try{result=await actions.confirmed(pending.action);}catch(error){result=String(error?.message||'Could not complete').slice(0,180);}
      message(pending.action==='cleanup'?'Privacy result':'Sign out',result,true);
    }else push(true);
  }
  return {
    push,message,askToConfirm,
    dismiss(){desk=null;lastReply=null;push(true);},
    reply:()=>lastReply,desk:()=>desk&&{...desk},deviceState:()=>({...deviceState}),
    // Called by the device link for messages it does not handle itself.
    onDeviceEvent(e){
      if(e.type==='command')return handleCommand(e);
      if(e.type==='desk-reply')return handleReply(e);
      if(e.type==='feed-status'){deviceState={page:Number(e.page),pinLocked:e.pin_locked==='1',at:now()};
        // A YES/NO also rides on every status, in case the one-off desk-reply was missed.
        if(desk&&e.ai_id===desk.id&&lastReply?.id!==desk.id)return handleReply({id:e.ai_id,reply:e.reply});}
    },
    onConnect(){lastSent='';push(true);},
    start(){timer??=setInterval(()=>push(now()-lastSentAt>=10000),interval);timer.unref?.();},
    stop(){clearInterval(timer);timer=null;},
  };
}
