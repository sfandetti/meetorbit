// Visual systems, not palette presets. Corporate retains the original DOM face.
export const themes = Object.freeze([
  {id:'corporate',name:'Corporate',description:'The original calm desk companion. Quiet typography, a simple digital face, precise readings and restrained motion.',instrument:'linear',layout:'split-desk'},
  {id:'arcade',name:'Arcade',description:'A bright little game console. Pixel character, animated energy dials, segmented clocks and chunky action buttons.',instrument:'radial',layout:'game-hud'},
  {id:'flight',name:'Flight Deck',description:'An instrument panel for your assistant. Radar companion, calibrated needle gauges, analog clock and amber mission panels.',instrument:'needle',layout:'instrument-panel'},
  {id:'pocket',name:'Pocket Pal',description:'A playful character first. A bouncing little creature, soft sticker panels, bubble meters and an alarm-clock face.',instrument:'bubble',layout:'character-stage'},
  {id:'paper',name:'Field Notes',description:'A quiet ink-and-paper notebook. A line-drawn companion, serif clock, ruled readings and understated transitions.',instrument:'ruler',layout:'notebook'},
]);
export function resolveTheme(id) { return themes.find(theme=>theme.id===id) || themes[0]; }
const TAU=Math.PI*2;
function line(c,x1,y1,x2,y2,color,width=1){c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();}
function circle(c,x,y,r,color,stroke){c.beginPath();c.arc(x,y,r,0,TAU);if(color){c.fillStyle=color;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}}
function box(c,x,y,w,h,r,color,stroke){c.beginPath();c.roundRect(x,y,w,h,r);if(color){c.fillStyle=color;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}}
function text(c,value,x,y,size,color,font='monospace',align='center'){c.font=`${size}px ${font}`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;c.fillText(value,x,y);}
function dial(c,x,y,r,value,color,needle=false){
  circle(c,x,y,r,'#101d32','#42506b');
  for(let i=0;i<11;i++){const a=Math.PI*.75+i*Math.PI*1.5/10;line(c,x+Math.cos(a)*(r-4),y+Math.sin(a)*(r-4),x+Math.cos(a)*(r-1),y+Math.sin(a)*(r-1),'#7b89a5');}
  const a=Math.PI*.75+value*Math.PI*1.5;
  if(needle){line(c,x,y,x+Math.cos(a)*(r-7),y+Math.sin(a)*(r-7),color,2);circle(c,x,y,3,color);}
  else{c.beginPath();c.strokeStyle=color;c.lineWidth=4;c.arc(x,y,r-8,Math.PI*.75,a);c.stroke();}
}
function analog(c,x,y,r,date,ink,paper,font='serif'){
  circle(c,x,y,r,paper,ink);c.lineWidth=1;
  for(let i=0;i<60;i++){const a=i*TAU/60-Math.PI/2;const inner=r-(i%5===0?8:3);line(c,x+Math.cos(a)*inner,y+Math.sin(a)*inner,x+Math.cos(a)*(r-2),y+Math.sin(a)*(r-2),ink,i%5===0?1.2:.5);}
  for(const n of [12,3,6,9]){const a=n*TAU/12-Math.PI/2;text(c,String(n),x+Math.cos(a)*(r-16),y+Math.sin(a)*(r-16),10,ink,font);}
  const minute=(date.getMinutes()+date.getSeconds()/60)*TAU/60-Math.PI/2;
  const hour=(date.getHours()%12+date.getMinutes()/60)*TAU/12-Math.PI/2;
  line(c,x,y,x+Math.cos(hour)*r*.47,y+Math.sin(hour)*r*.47,ink,3);
  line(c,x,y,x+Math.cos(minute)*r*.7,y+Math.sin(minute)*r*.7,ink,1.7);
  circle(c,x,y,3,ink);
}

function paintCompanion(c,{theme,w,h,t,state,motion}){
  const asleep=state==='sleeping',thinking=state==='thinking',curious=state==='curious',happy=state==='happy',talking=state==='speaking';
  const ink=theme==='paper'?'#4b554a':theme==='pocket'?'#354d42':theme==='arcade'?'#f7d45d':'#d0eabb';
  c.fillStyle={arcade:'#151341',flight:'#101b20',pocket:'#f5e4ee',paper:'#f4efdf'}[theme];c.fillRect(0,0,w,h);
  if(theme==='arcade'){for(let x=0;x<w;x+=16)line(c,x,22,x,h,'#28215a');for(let y=24;y<h;y+=16)line(c,0,y,w,y,'#28215a');}
  if(theme==='paper')for(let y=36;y<h;y+=18)line(c,0,y,w,y,'#e0dac6');
  const r=Math.min(w*.23,h*.23),s=r/52,x=w/2,y=h*.44+(motion?Math.sin(t*(asleep?1.3:happy?5:2))*(happy?4:2):0);
  const tilt=motion?(curious?Math.sin(t*1.7)*.13:thinking?Math.sin(t)*.05-.06:0):curious?.12:thinking?-.06:0;
  const blink=asleep?.08:happy?.3:motion&&Math.sin(t*.8)>.995?.1:1;
  c.save();c.translate(x,y);c.rotate(tilt);c.scale(s,s);
  if(theme==='arcade'){
    box(c,-49,-40,98,80,4,'#62e9e3','#a0fff9');box(c,-40,-30,80,59,2,'#112849');line(c,0,-40,0,-53,'#62e9e3',3);box(c,-4,-59,8,8,0,'#ff75b9');
  }else if(theme==='flight'){
    circle(c,0,0,53,'#122a2a','#557772');circle(c,0,0,39,null,'#32514e');circle(c,0,0,20,null,'#32514e');line(c,-53,0,53,0,'#32514e');line(c,0,-53,0,53,'#32514e');
    if(motion&&!asleep){const angle=t*(thinking?2:.8);line(c,0,0,Math.cos(angle)*51,Math.sin(angle)*51,'#80b59c',1);}
  }else if(theme==='pocket'){
    circle(c,-34,-37,18,'#d8b3ed','#80566b');circle(c,34,-37,18,'#d8b3ed','#80566b');box(c,-52,-38,104,79,33,'#bfe6c8','#6a886d');circle(c,-34,6,8,'#f3b6a8');circle(c,34,6,8,'#f3b6a8');
  }else{
    box(c,-47,-40,94,80,4,'#f8f4e9',ink);circle(c,-20,-8,14,null,ink);circle(c,20,-8,14,null,ink);line(c,-6,-8,6,-8,ink);
  }
  const glance=thinking&&motion?Math.sin(t*1.6)*4:0;
  for(const [i,dx] of [-20,20].entries()){
    const eyeHeight=(curious?(i?23:13):20)*blink;
    if(asleep||happy)line(c,dx-8+glance,-7,dx+8+glance,-7,happy?ink:ink,happy?4:2);
    else if(theme==='paper'||theme==='pocket'){
      if(thinking)line(c,dx-5+glance,-10,dx+5+glance,-10,ink,3);else circle(c,dx+glance,-8,curious&&i?6:4,ink);
    }else box(c,dx-8+glance,-7-eyeHeight/2,16,Math.max(2,eyeHeight),theme==='arcade'?0:4,ink);
  }
  if(curious)line(c,13,-28,30,-31,ink,2);
  if(asleep)circle(c,0,21,4,null,ink);
  else if(talking){box(c,-9,15,18,motion?5+(Math.sin(t*19)+1)*5:10,5,ink);}
  else if(thinking)line(c,-5,20,6,18,ink,2);
  else{c.beginPath();c.lineWidth=happy?3:2;c.strokeStyle=ink;c.arc(0,13,happy?13:9,0,Math.PI);c.stroke();}
  c.restore();
}

export function paintScene(c,{theme,width:w,height:h,time=0,state='idle',mode='companion',date=new Date(),motion=true}){
  c.clearRect(0,0,w,h);
  if(theme==='corporate') return;
  if(mode==='companion'){paintCompanion(c,{theme,w,h,t:motion?time/1000:0,state,motion});return;}
  const t=motion?time/1000:0, asleep=state==='sleeping';
  const blink=asleep?.1:(!motion||Math.sin(t*.8)<.995?1:.12);
  const talking=state==='speaking';
  const clock=mode==='clock';
  const hhmm=`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  if(theme==='arcade'){
    c.fillStyle='#151341';c.fillRect(0,0,w,h);
    for(let x=0;x<w;x+=16)line(c,x,22,x,h,'#28215a');
    for(let y=24;y<h;y+=16)line(c,0,y,w,y,'#28215a');
    for(let i=0;i<12;i++){const x=(i*47+Math.floor(t*5))%w,y=32+(i*37)%(h-70);c.fillStyle=i%2?'#f3c655':'#ff75b9';c.fillRect(x,y,2,2);}
    if(clock){
      text(c,hhmm,w/2,h*.43,w*.17,'#f8d95b','monospace');
      text(c,'TIME TO PLAY',w/2,h*.65,10,'#65eee7');
      for(let i=0;i<18;i++){const bh=4+(Math.sin(t*3+i*.7)+1)*10;c.fillStyle=i%2?'#ff75b9':'#65eee7';c.fillRect(w*.15+i*w*.04,h*.83-bh,w*.025,bh);}
    }else{
      const x=w*.3,y=h*.41+(motion?Math.sin(t*2)*3:0),s=w/320;
      box(c,x-46*s,y-39*s,92*s,76*s,4,'#62e9e3','#a0fff9');
      c.fillStyle='#112849';c.fillRect(x-37*s,y-29*s,74*s,54*s);
      for(const dx of [-19,19]){c.fillStyle='#f7d45d';c.fillRect(x+(dx-7)*s,y-15*blink*s,14*s,20*blink*s);}
      c.fillStyle='#ff75b9';c.fillRect(x-9*s,y+14*s,18*s,(talking?8+Math.sin(t*20)*3:4)*s);
      line(c,x,y-39*s,x,y-51*s,'#62e9e3',3);box(c,x-4*s,y-57*s,8*s,8*s,0,'#ff75b9');
      dial(c,w*.73,h*.34,22*s,.55+Math.sin(t)*.22,'#ff75b9');
      dial(c,w*.73,h*.59,22*s,.65+Math.sin(t*.8+1)*.18,'#f8d95b');
      text(c,'MOOD',w*.9,h*.34,7,'#ffabd7');text(c,'SPARK',w*.9,h*.59,7,'#fae89c');
    }
  }else if(theme==='flight'){
    c.fillStyle='#101b20';c.fillRect(0,0,w,h);
    for(let i=0;i<5;i++)line(c,12,36+i*30,w-12,36+i*30,'#24353a');
    if(clock){analog(c,w*.34,h*.46,Math.min(w*.25,h*.3),date,'#efcf88','#152329','monospace');text(c,hhmm,w*.79,h*.45,20,'#f1ce82');text(c,'LOCAL TIME',w*.79,h*.6,8,'#8eaaa6');}
    else{
      const x=w*.3,y=h*.43,r=Math.min(w*.24,h*.27);
      circle(c,x,y,r,'#122a2a','#557772');circle(c,x,y,r*.7,null,'#32514e');circle(c,x,y,r*.35,null,'#32514e');
      line(c,x-r,y,x+r,y,'#557772');line(c,x,y-r,x,y+r,'#557772');
      if(!asleep){const a=t*.8;line(c,x,y,x+Math.cos(a)*r,y+Math.sin(a)*r,'#c5ecbd',2);}
      box(c,x-26,y-14,18,asleep?3:13*blink,2,'#d0eabb');box(c,x+8,y-14,18,asleep?3:13*blink,2,'#d0eabb');
      line(c,x-8,y+14,x+8,y+14,'#efcf88',talking?4:2);
      dial(c,w*.76,h*.34,22,.5+Math.sin(t*.8)*.16,'#efcf88',true);
      text(c,'SYSTEM READY',w*.76,h*.57,9,'#e6c582');
      text(c,asleep?'STANDBY':'LINK / NOMINAL',w*.76,h*.65,7,'#91b1a8');
    }
    for(const [x,y] of [[7,28],[w-7,28],[7,h-8],[w-7,h-8]]){line(c,x-3,y,x+3,y,'#6f7772');line(c,x,y-3,x,y+3,'#6f7772');}
  }else if(theme==='pocket'){
    c.fillStyle='#f5e4ee';c.fillRect(0,0,w,h);
    for(let i=0;i<9;i++){circle(c,20+(i*61)%(w-30),35+(i*43)%(h-50),i%2?3:5,i%2?'#dfb6e2':'#ecd39b');}
    const x=w/2,y=h*.4+(motion?Math.sin(t*2)*3:0),r=Math.min(w*.24,h*.29);
    if(clock){
      circle(c,x-r*.72,y-r*.85,r*.29,'#f0bb6e','#80566b');circle(c,x+r*.72,y-r*.85,r*.29,'#f0bb6e','#80566b');
      analog(c,x,y,r,date,'#75485f','#fff5e5','sans-serif');line(c,x-r*.55,y+r*.9,x-r*.7,y+r*1.2,'#80566b',5);line(c,x+r*.55,y+r*.9,x+r*.7,y+r*1.2,'#80566b',5);
    }else{
      circle(c,x-r*.64,y-r*.69,r*.33,'#d8b3ed','#80566b');circle(c,x+r*.64,y-r*.69,r*.33,'#d8b3ed','#80566b');
      box(c,x-r,y-r*.72,r*2,r*1.5,r*.65,'#bfe6c8','#6a886d');
      circle(c,x-r*.38,y-r*.12,r*.105*blink,'#354d42');circle(c,x+r*.38,y-r*.12,r*.105*blink,'#354d42');
      circle(c,x-r*.66,y+r*.12,r*.15,'#f3b6a8');circle(c,x+r*.66,y+r*.12,r*.15,'#f3b6a8');
      c.beginPath();c.strokeStyle='#354d42';c.lineWidth=2;c.arc(x,y+r*.06,r*.2,0,Math.PI);c.stroke();
      if(talking)circle(c,x,y+r*.25,r*.12,'#65435a');
      text(c,asleep?'z z z':'hi, friend!',x+r*.9,y-r*.85,10,'#80566b','cursive');
    }
  }else if(theme==='paper'){
    c.fillStyle='#f4efdf';c.fillRect(0,0,w,h);
    for(let y=36;y<h;y+=18)line(c,0,y,w,y,'#e0dac6');line(c,19,24,19,h,'#d8aaa0');
    if(clock){analog(c,w*.5,h*.43,Math.min(w*.25,h*.29),date,'#3f473e','#f4efdf','Georgia');text(c,'A little time, well spent.',w/2,h*.82,12,'#4d574a','Georgia');}
    else{
      const x=w*.3,y=h*.4;
      box(c,x-43,y-35,86,72,3,'#f8f4e9','#4b554a');
      circle(c,x-18,y-7,13,null,'#4b554a');circle(c,x+18,y-7,13,null,'#4b554a');line(c,x-5,y-7,x+5,y-7,'#4b554a');
      if(asleep){line(c,x-24,y-7,x-12,y-7,'#4b554a');line(c,x+12,y-7,x+24,y-7,'#4b554a');}
      else{circle(c,x-18,y-7,2,'#4b554a');circle(c,x+18,y-7,2,'#4b554a');}
      c.beginPath();c.strokeStyle='#4b554a';c.arc(x,y+10,talking?10:7,0,Math.PI);c.stroke();
      line(c,x-25,y+46,x+25,y+46,'#889079');
      const day=String(date.getDate()).padStart(2,'0');text(c,'TODAY',w*.76,h*.3,9,'#68715c','monospace');text(c,day,w*.76,h*.45,39,'#3f473e','Georgia');text(c,'make room',w*.76,h*.59,10,'#68715c','Georgia');
    }
  }
}
