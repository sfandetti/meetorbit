// Seth's console settings for the physical Orbit (screens, theme, name, alarm, AI desk choice...).
// Page numbers match names[] in firmware/OrbitDevice/OrbitDevice.ino. Page 16 (old AI desk) is retired:
// the firmware always hides it and always shows 21 (voice + console) and 22 (light show).
export const PAGES=['Welcome','Prism clock','Split clock','PC matrix','CPU pulse','GPU engine','Thermals','Network','Memory','Storage','Power','Six channels','Type clock','Binary clock','Focus timer','Stopwatch','AI desk (retired)','Music remote','App launcher','Sentry','Privacy guard'];
export const SELECTABLE=PAGES.map((_,i)=>i).filter(i=>i!==16);
export const THEMES=['Office','Retro','Cyberpunk','Bubblegum'];
export const PALETTES=['Glacier','Electric orchid','Acid lime','Solar amber','Lavender'];
// Who Orbit talks to (engines.mjs).
export const ORBIT_ENGINES=['chatgpt','claude','deepseek','cursor','codex'];
export const AI_PROVIDERS=['openai','claude','deepseek','cursor'];
export const ALARM_SOUNDS=['siren','retro','intruder'];
export const TIMEZONES={'EST5EDT,M3.2.0,M11.1.0':'Eastern US','CST6CDT,M3.2.0,M11.1.0':'Central US','MST7MDT,M3.2.0,M11.1.0':'Mountain US','PST8PDT,M3.2.0,M11.1.0':'Pacific US','UTC0':'UTC','GMT0BST,M3.5.0/1,M10.5.0/2':'United Kingdom','CET-1CEST,M3.5.0,M10.5.0/3':'Central Europe'};
export const DEFAULT_PROFILE={name:'Friend',timezone:'EST5EDT,M3.2.0,M11.1.0',theme:0,palette:0,brightness:70,screens:SELECTABLE,startup_page:0,quick_taps:[17,16,18],startup:false,
  ai_provider:'openai',provider_models:{},cursor_path:'',alarm_enabled:false,alarm_sound:'siren',alarm_loop:false,camera:'',record_timestamp:true,record_camera_name:true,motion_sensitivity:2,recording_limit_mb:1024,
  apps:[],privacy_folders:[],privacy_browsers:[],orbit_engine:'chatgpt'};

const int=(value,min,max,message)=>{const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw Error(message);return n;};
// Validates the plain fields. Shortcuts (apps) and privacy targets are checked by their own modules.
export function validateProfile(data={},previous=DEFAULT_PROFILE){
  const out={...DEFAULT_PROFILE,...previous};const has=key=>Object.hasOwn(data,key);
  if(has('name')){const name=String(data.name).trim();if(!/^[\x20-\x7e]{1,24}$/.test(name))throw Error('Use a name with 1-24 plain letters, numbers or spaces.');out.name=name;}
  if(has('timezone')){const tz=String(data.timezone);if(!tz||tz.length>80||!/^[A-Za-z0-9,+\-:/.]+$/.test(tz))throw Error('Choose a valid time zone.');out.timezone=tz;}
  if(has('theme'))out.theme=int(data.theme,0,THEMES.length-1,'Choose a valid theme.');
  if(has('palette'))out.palette=int(data.palette,0,PALETTES.length-1,'Choose a valid colour variation.');
  if(has('brightness'))out.brightness=int(data.brightness,5,100,'Brightness must be 5-100.');
  if(has('startup_page'))out.startup_page=int(data.startup_page,0,PAGES.length-1,'Choose a valid startup screen.');
  if(out.startup_page===16)out.startup_page=0;
  if(has('screens')){const pages=data.screens;if(!Array.isArray(pages)||!pages.length||pages.some(p=>!SELECTABLE.includes(p)))throw Error('Select at least one screen.');out.screens=pages;}
  out.screens=[...new Set([...out.screens.filter(p=>p!==16),0,out.startup_page])].sort((a,b)=>a-b);
  // Quick Taps: -1 = off. The firmware opens AI voice (page 21) for 16, so 16 means "AI voice" here.
  if(has('quick_taps')){const q=data.quick_taps;if(!Array.isArray(q)||q.length!==3||q.some(v=>!Number.isInteger(v)||v<-1||v>=PAGES.length))throw Error('Choose a screen or Off for each Quick Tap.');out.quick_taps=q;}
  if(has('startup'))out.startup=data.startup===true;
  if(has('ai_provider')){if(!AI_PROVIDERS.includes(data.ai_provider))throw Error('Choose OpenAI, Claude, DeepSeek or Cursor.');out.ai_provider=data.ai_provider;}
  if(has('provider_models')){const m=data.provider_models;if(!m||typeof m!=='object'||Array.isArray(m))throw Error('Invalid saved model choices.');out.provider_models=Object.fromEntries(AI_PROVIDERS.map(p=>[p,String(m[p]||'').slice(0,100)]));}
  if(has('cursor_path'))out.cursor_path=String(data.cursor_path).trim().slice(0,400);
  if(has('alarm_enabled'))out.alarm_enabled=data.alarm_enabled===true;
  if(has('alarm_sound')){if(!ALARM_SOUNDS.includes(data.alarm_sound))throw Error('Choose a supported alarm sound.');out.alarm_sound=data.alarm_sound;}
  if(has('alarm_loop'))out.alarm_loop=data.alarm_loop===true;
  if(has('camera'))out.camera=String(data.camera||'').slice(0,200);
  if(has('record_timestamp'))out.record_timestamp=data.record_timestamp===true;
  if(has('record_camera_name'))out.record_camera_name=data.record_camera_name===true;
  if(has('motion_sensitivity')){const s=Number(data.motion_sensitivity);if(!(s>=0.2&&s<=20))throw Error('Choose a motion threshold from 0.2-20%.');out.motion_sensitivity=s;}
  if(has('orbit_engine')){if(!ORBIT_ENGINES.includes(data.orbit_engine))throw Error('Choose ChatGPT, Claude, DeepSeek, Cursor or Codex.');out.orbit_engine=data.orbit_engine;}
  if(has('recording_limit_mb'))out.recording_limit_mb=int(data.recording_limit_mb,100,20000,'Choose a recording limit from 100-20000 MB.');
  return out;
}
// Old Python companion profile -> this format (first run only). Shortcuts and privacy targets are re-checked later.
export function importCompanionProfile(old={}){
  const picked={};
  for(const key of ['name','timezone','theme','palette','brightness','screens','startup_page','quick_taps','startup','ai_provider','cursor_path','alarm_enabled','alarm_sound','alarm_loop','record_timestamp','record_camera_name','motion_sensitivity','recording_limit_mb'])if(Object.hasOwn(old,key))picked[key]=old[key];
  if(old.provider_models)picked.provider_models=old.provider_models;
  if(Array.isArray(picked.screens))picked.screens=picked.screens.filter(p=>SELECTABLE.includes(p));
  if(old.camera_name)picked.camera=String(old.camera_name);
  let profile;try{profile=validateProfile(picked);}catch{profile={...DEFAULT_PROFILE};}
  return {...profile,apps:Array.isArray(old.apps)?old.apps:[],privacy_folders:Array.isArray(old.privacy_folders)?old.privacy_folders:[],privacy_browsers:Array.isArray(old.privacy_browsers)?old.privacy_browsers:[]};
}
