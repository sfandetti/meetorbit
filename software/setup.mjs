export const dashboardIds = [3,6,7,11];
export const retiredIds = [0,2,4,5,8,9,10];
export const metrics = [
  {key:'cpu',label:'CPU',unit:'%',base:38}, {key:'gpu',label:'GPU',unit:'%',base:46},
  {key:'ram',label:'RAM',unit:'%',base:61}, {key:'temp',label:'THERMAL',unit:'°C',base:54},
  {key:'rx',label:'DOWNLOAD',unit:'MB/s',base:12}, {key:'tx',label:'UPLOAD',unit:'MB/s',base:3},
  {key:'disk',label:'DISK',unit:'%',base:38}, {key:'power',label:'POWER',unit:'W',base:86},
];
export function demoReadings(time,{demoLoad='cycle',networkMbps=1000}={}) {
  const wave=(Math.sin(time/5500)+1)/2;
  const load={light:.12,busy:.64,stress:.96}[demoLoad]??(.08+wave*.88);
  return metrics.map((m,i)=>{
    const ripple=Math.sin(time/1100+i)*.025;
    const values={cpu:8+load*90+ripple*50,gpu:5+load*92+Math.sin(time/1700)*3,ram:38+load*46,temp:38+load*63+Math.sin(time/2100)*1.3,rx:(networkMbps/8)*Math.max(0,load+ripple),tx:(networkMbps/8)*Math.max(0,load*.42+ripple),disk:12+load*76,power:35+load*165};
    return {...m,value:Math.round(Math.max(0,values[m.key])*10)/10};
  });
}
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function thermalStatus(value,{thermalWarm=70,thermalHigh=90}={}){
  return value>=thermalHigh?{tone:'red',label:'HIGH · CHECK LOAD',color:'#ff667a'}:value>=thermalWarm?{tone:'yellow',label:'WARM',color:'#f6d34c'}:{tone:'green',label:'COOL',color:'#43e6a1'};
}
export function networkStatus(megabytes,{networkMbps=1000}={}){
  const percent=clamp(megabytes*8/networkMbps*100,0,100);
  return {...(percent>=80?{tone:'red',label:'HIGH TRAFFIC',color:'#ff667a'}:percent>=50?{tone:'yellow',label:'BUSY',color:'#f6d34c'}:percent>=10?{tone:'green',label:'ACTIVE',color:'#43e6a1'}:{tone:'cyan',label:'LIGHT TRAFFIC',color:'#5edcf5'}),percent};
}
export function metricDisplay(metric,settings={}){
  const colors={cpu:'#62b8ff',gpu:'#bd8bff',ram:'#59e1bf',disk:'#ffad65',power:'#f3d566'};
  if(metric.key==='temp')return {...thermalStatus(metric.value,settings),percent:clamp(metric.value/110*100,0,100)};
  if(['rx','tx'].includes(metric.key))return networkStatus(metric.value,settings);
  return {color:colors[metric.key]||'#8ccfff',tone:'accent',label:metric.key==='power'?'PC DRAW':'UTILIZATION',percent:clamp(metric.value/(metric.key==='power'?220:100)*100,0,100)};
}
export function normalizeSetup(input={}) {
  const enabled=[...new Set((Array.isArray(input.enabled)?input.enabled:[21,22,1,3,6,7,11,14,15,16,17,18,19,20]).filter(id=>Number.isInteger(id)&&id>=0&&id<=22&&!retiredIds.includes(id)))];
  if(input.panelsVersion!==1&&enabled.includes(21)&&!enabled.includes(22))enabled.splice(enabled.indexOf(21)+1,0,22);
  if(!enabled.length)enabled.push(3);
  const thermalWarm=clamp(Number(input.thermalWarm)||70,30,95),thermalHigh=clamp(Number(input.thermalHigh)||90,thermalWarm+5,110);
  return {panelsVersion:1,thermalWarm,thermalHigh,networkMbps:clamp(Number(input.networkMbps)||1000,1,100000),demoLoad:['cycle','light','busy','stress'].includes(input.demoLoad)?input.demoLoad:'cycle',version:1,enabled,start:enabled.includes(input.start)?input.start:enabled.includes(21)?21:enabled.includes(3)?3:enabled[0],security:['off','idle','approval'].includes(input.security)?input.security:'off',wallpaper:['none','aurora','grid','sunset'].includes(input.wallpaper)?input.wallpaper:'none',brightness:Math.max(20,Math.min(100,Number(input.brightness)||100)),theme:typeof input.theme==='string'?input.theme:'corporate'};
}
