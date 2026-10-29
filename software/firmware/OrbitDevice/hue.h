// HUE LIGHTS page (23): two tabs. ROOMS: a slider per Philips Hue room (tap switches it, slide sets how
// bright) and ALL OFF / ALL ON. MODES: eight light modes, a WHERE dropdown saying where they run (all or
// some rooms) and STOP (lights back as they were). While MUSIC LINK is on, Orbit listens on every screen and sends
// what it hears to the PC about ten times a second, so the lights follow any music in the room. The PC talks to the Hue Bridge (hue.mjs, hue-modes.mjs) and sends
// the rooms again whenever they change, so the page also follows the Hue app, wall switches and the voice.
String hueIds[6],hueNames[6],hueNote="Waiting for the PC...",hueMode="";bool hueOn[6];int hueBri[6],hueCount=0,hueView=0;
// MUSIC is not a tile here: it is the MM key on the visualizer (sound_waves.h). The voice can still start it.
const int HUE_MODES=7;
const char *hueModeIds[HUE_MODES]={"party","candle","aurora","sunset","night","reading","relax"};
const char *hueModeNames[HUE_MODES]={"PARTY","CANDLE","AURORA","SUNSET","NIGHT","READING","RELAX"};
const uint8_t hueModeColors[HUE_MODES][3][3]={  // three colours each, for the tile's stripes
 {{255,0,200},{0,255,200},{255,255,0}},{{255,120,0},{255,170,30},{200,60,0}},{{0,230,120},{0,170,200},{150,60,255}},
 {{255,110,0},{255,40,110},{140,40,200}},{{120,20,0},{40,0,60},{10,10,50}},{{255,250,230},{255,235,190},{240,240,255}},{{255,160,60},{230,120,40},{255,190,110}}};
String hueFlash;uint32_t hueFlashAt=0,hueTappedAt=0;  // when a mode was tapped here  // a short word in the corner after a tap: STOPPING, or PC NOT CONNECTED
bool hueSelOn[6],hueChanged=false;  // hueChanged: the PC remembers lights from before; STOP puts them back
  // rooms chosen for the modes (none = every light)
int hueDrag=-1,hueDragBri=0;bool hueDragged=false;  // the room slider being dragged, and its level while dragging
bool hueLinked(){return hueMode=="music";}
bool hueAvailable(){return hueCount>0;}  // paired, with rooms: the corner bulb shows
bool hueAnyOn(){for(int i=0;i<hueCount;i++)if(hueOn[i])return true;return false;}
// From the PC: {"type":"hue","n":"2","i0":"1","t0":"Kitchen","o0":"1","b0":"80",...,"mode":"party","note":""}
void hueFromJson(const char *j,size_t len){
 hueCount=constrain(jsonField(j,len,"n").toInt(),0,6);hueNote=jsonField(j,len,"note").substring(0,60);{String m=jsonField(j,len,"mode").substring(0,10);
  // Just after a tap here, an older update from the PC may still name the previous mode: the tap wins.
  if(m==hueMode||millis()-hueTappedAt>2500)hueMode=m;}
 hueChanged=jsonField(j,len,"chg")=="1";
 String mr=","+jsonField(j,len,"mr")+",";bool fromMode=hueMode.length()>0;
 for(int i=0;i<hueCount;i++){String k=String(i);if(fromMode)hueSelOn[i]=mr.indexOf(","+jsonField(j,len,("i"+k).c_str())+",")>=0;if(i==hueDrag)continue;hueIds[i]=jsonField(j,len,("i"+k).c_str()).substring(0,6);
  hueNames[i]=jsonField(j,len,("t"+k).c_str()).substring(0,18);hueOn[i]=jsonField(j,len,("o"+k).c_str())=="1";hueBri[i]=constrain(jsonField(j,len,("b"+k).c_str()).toInt(),1,100);}
}
// Layout. Standing up: tabs, one column of 6 rooms or 2 x 4 modes, then a row of keys.
// Lying down: tabs, 2 x 3 rooms or 4 x 2 modes, then a row of keys. Under the modes, the WHERE dropdown and STOP.
int hueTabY(){return tall()?62:38;}int hueTabH(){return tall()?24:22;}int hueTop(){return tall()?90:64;}
int hueKeysY(){return tall()?272:168;}
void hueTile(int i,int &x,int &y,int &w,int &h){if(tall()){x=8;w=W-16;h=26;y=hueTop()+i*30;}else{w=148;h=30;x=8+(i%2)*156;y=hueTop()+(i/2)*34;}}
void hueModeTile(int i,int &x,int &y,int &w,int &h){if(tall()){w=108;h=30;x=8+(i%2)*116;y=hueTop()+(i/2)*33;}else{w=74;h=36;x=6+(i%4)*78;y=hueTop()+(i/4)*39;}}
// WHERE dropdown under the modes: closed it shows the choice; open, a list of ALL ROOMS and each room with
// a tick box, and DONE. A running mode moves to the new rooms when the list closes.
bool hueDropOpen=false;
int hueDropY(){return tall()?226:146;}int hueDropH(){return tall()?30:28;}
int hueListY(){return tall()?60:38;}int hueRowH(){return tall()?25:21;}
int hueListRows(){return hueCount+2;}  // ALL ROOMS, the rooms, DONE
int hueRowAt(int x,int y){if(x<8||x>=W-8||y<hueListY())return -1;int r=(y-hueListY())/hueRowH();return r<hueListRows()?r:-1;}
bool hueAllRooms(){for(int i=0;i<hueCount;i++)if(hueSelOn[i])return false;return true;}
int hueStopY(){return tall()?264:182;}
String hueWhere(){String s;int n=0;for(int i=0;i<hueCount;i++)if(hueSelOn[i]){n++;s+=(s.length()?", ":"")+hueNames[i];}
 return !n?String("ALL ROOMS"):int(s.length())<=(tall()?20:30)?s:String(n)+" ROOMS";}
int hueTileAt(int x,int y){for(int i=0;i<hueCount;i++){int tx,ty,w,h;hueTile(i,tx,ty,w,h);if(x>=tx&&x<tx+w&&y>=ty-2&&y<ty+h+2)return i;}return -1;}
int hueModeAt(int x,int y){for(int i=0;i<HUE_MODES;i++){int tx,ty,w,h;hueModeTile(i,tx,ty,w,h);if(x>=tx&&x<tx+w&&y>=ty&&y<ty+h)return i;}return -1;}
int hueSliderLevel(int i,int x){int tx,ty,w,h;hueTile(i,tx,ty,w,h);return constrain(map(x,tx+4,tx+w-4,1,100),1,100);}
void drawHueTabs(){
 const char *tabs[2]={"ROOMS","MODES"};int w=(W-16)/2;
 for(int t=0;t<2;t++){int x=8+t*w;bool sel=t==hueView;ui.fillRect(x,hueTabY(),w,hueTabH(),sel?accent:panel);ui.drawRect(x,hueTabY(),w,hueTabH(),accent);
  text(tabs[t],x+w/2,hueTabY()+hueTabH()/2,2,sel?themeBg:ink,MC_DATUM);}
 if(hueMode.length()){ui.fillCircle(W-18,hueTabY()+hueTabH()/2,4,(millis()/400)%2?ui.color565(255,200,0):ui.color565(255,60,160));}  // a mode is running
}
void drawHueRooms(){
 uint16_t warm=ui.color565(255,196,70),warmDim=ui.color565(150,120,70);
 for(int i=0;i<hueCount;i++){int x,y,w,h;hueTile(i,x,y,w,h);bool on=hueOn[i];int bri=i==hueDrag?hueDragBri:hueBri[i];if(i==hueDrag)on=true;
  ui.fillRect(x,y,w,h,panel);if(on){ui.fillRect(x,y,w,h,warmDim);ui.fillRect(x,y,max(4,(w*bri)/100),h,warm);}
  ui.drawRect(x,y,w,h,on?warm:accent);
  int cx=x+13,cy=y+h/2-2;uint16_t ic=on?0x0000:muted;
  if(on)ui.fillCircle(cx,cy,5,ic);else ui.drawCircle(cx,cy,5,ic);ui.fillRect(cx-2,cy+5,5,3,ic);
  text(hueNames[i],x+24,y+h/2,tall()?2:1,on?0x0000:ink,ML_DATUM);
  text(on?String(bri)+"%":"OFF",x+w-6,y+h/2,1,on?(bri>85?0x0000:ink):muted,MR_DATUM);}
 // ALL OFF | ALL ON, and STOP once there is something to put back.
 if(hueChanged){int bw=(W-32)/3;button("ALL OFF",8,hueKeysY(),bw,false);button("ALL ON",16+bw,hueKeysY(),bw,false);button("STOP",W-8-bw,hueKeysY(),bw);}
 else{int bw=(W-24)/2;button("ALL OFF",8,hueKeysY(),bw,false);button("ALL ON",W-8-bw,hueKeysY(),bw);}
}
void drawHueModes(){
 for(int i=0;i<HUE_MODES;i++){int x,y,w,h;hueModeTile(i,x,y,w,h);bool sel=hueMode==hueModeIds[i];
  for(int k=0;k<w;k++){float t=k/float(w-1)*2;int a=min(1,int(t)),b=a+1;float f=t-a;const uint8_t *p=hueModeColors[i][a],*q=hueModeColors[i][b];
   ui.drawFastVLine(x+k,y,h,ui.color565(p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f,p[2]+(q[2]-p[2])*f));}
  if(sel){ui.drawRect(x,y,w,h,TFT_WHITE);ui.drawRect(x+1,y+1,w-2,h-2,TFT_WHITE);ui.drawRect(x+2,y+2,w-4,h-4,0x0000);
   ui.fillRect(x+w-24,y+3,21,11,TFT_WHITE);text("ON",x+w-13,y+9,1,0x0000,MC_DATUM);}  // tap it again to turn it off
  else ui.drawRect(x,y,w,h,0x0000);
  // The name on a dark band so it reads on any colour.
  int bandH=tall()?16:14,by=y+h-bandH-3;ui.fillRect(x+3,by,w-6,bandH,0x0000);
  ui.setFreeFont(themeFont(2));int f=ui.textWidth(hueModeNames[i])>w-10?1:2;text(hueModeNames[i],x+w/2,by+bandH/2,f,sel?ui.color565(255,220,0):0xffff,MC_DATUM);}
 // WHERE: the dropdown (closed), then STOP. Open, the room list covers the tiles.
 int dy=hueDropY(),dh=hueDropH();ui.fillRect(8,dy,W-16,dh,panel);ui.drawRect(8,dy,W-16,dh,accent);
 text("WHERE",16,dy+dh/2,1,muted,ML_DATUM);text(hueWhere(),58,dy+dh/2,tall()?1:2,ink,ML_DATUM);
 int ax=W-22,ay=dy+dh/2;if(hueDropOpen)ui.fillTriangle(ax-6,ay+3,ax+6,ay+3,ax,ay-4,accent);else ui.fillTriangle(ax-6,ay-3,ax+6,ay-3,ax,ay+4,accent);
 button("STOP",8,hueStopY(),W-16,hueMode.length()>0||hueChanged);  // lit when a mode runs or lights were changed
 if(!hueDropOpen)return;
 int ly=hueListY(),rh=hueRowH(),lh=hueListRows()*rh;
 ui.fillRect(4,ly-4,W-8,lh+8,themeBg);ui.drawRect(4,ly-4,W-8,lh+8,accent);ui.drawRect(5,ly-3,W-10,lh+6,accent);
 for(int r=0;r<hueListRows();r++){int y=ly+r*rh;bool done=r==hueListRows()-1;
  if(done){ui.fillRect(8,y+2,W-16,rh-3,accent);text("DONE",W/2,y+rh/2,2,themeBg,MC_DATUM);continue;}
  bool sel=r==0?hueAllRooms():hueSelOn[r-1];if(r)ui.drawFastHLine(12,y,W-24,themeColor(0x3186));
  int bx=16,by=y+rh/2-7;ui.drawRect(bx,by,14,14,accent);if(sel)ui.fillRect(bx+3,by+3,8,8,accent);
  text(r==0?String("ALL ROOMS"):hueNames[r-1],bx+24,y+rh/2,2,sel?ink:muted,ML_DATUM);}
}
void drawHue(){
 String m=millis()-hueFlashAt<3000?hueFlash:hueMode;m.toUpperCase();header("HUE LIGHTS",m);
 if(!hueCount){wrapped(hueNote.length()?hueNote:"Waiting for the PC...",18,tall()?110:80,W-36,3,muted);return;}
 drawHueTabs();
 if(hueView==0)drawHueRooms();else drawHueModes();
}
bool hueSend(const String &json){bool ok=laptopSend(json);if(!ok){hueFlash="PC NOT CONNECTED";hueFlashAt=millis();}Serial.printf("HUE SEND %s %s\n",ok?"OK":"FAILED",json.c_str());return ok;}
void hueToggle(const String &id,bool on){hueSend(String("{\"type\":\"hue-toggle\",\"id\":\"")+id+"\",\"on\":"+(on?"true":"false")+"}");}
void hueSetMode(const char *id){
 String rooms;for(int i=0;i<hueCount;i++)if(hueSelOn[i])rooms+=(rooms.length()?",":"")+hueIds[i];
 hueMode=id;hueTappedAt=millis();if(hueSend(String("{\"type\":\"hue-mode\",\"mode\":\"")+id+"\",\"rooms\":\""+rooms+"\"}")&&!strcmp(id,"stop")){hueFlash="STOPPING";hueFlashAt=millis();}}
// A tap: tabs, a room (on/off), ALL OFF / ALL ON, a mode or STOP. False when it hit none of them.
bool hueTap(int x,int y){
 if(!hueCount)return false;
 if(!(hueView==1&&hueDropOpen)&&y>=hueTabY()&&y<hueTabY()+hueTabH()+4){hueView=x<W/2?0:1;return true;}
 // The open room list takes every tap: a row ticks or unticks, DONE or a tap outside closes it.
 if(hueView==1&&hueDropOpen){
  int r=hueRowAt(x,y);
  if(r==0)for(int k=0;k<hueCount;k++)hueSelOn[k]=false;
  else if(r>0&&r<hueListRows()-1)hueSelOn[r-1]=!hueSelOn[r-1];
  else{hueDropOpen=false;if(hueMode.length()){String m=hueMode;hueSetMode(m.c_str());}}  // a running mode moves to the new rooms
  return true;
 }
 bool keys=y>=hueKeysY()&&y<hueKeysY()+34;
 if(hueView==0){
  if(hueDragged)return true;  // the end of a slide, not a tap
  int i=hueTileAt(x,y);if(i>=0){hueOn[i]=!hueOn[i];hueToggle(hueIds[i],hueOn[i]);hueMode="";return true;}
  if(keys&&hueChanged&&x>=W-8-(W-32)/3){hueSetMode("stop");hueMode="";hueChanged=false;return true;}
  if(keys){bool on=hueChanged?x>=8+(W-32)/3+4:x>=W/2;for(int k=0;k<hueCount;k++)hueOn[k]=on;hueToggle("0",on);hueMode="";return true;}
 }else{
  int i=hueModeAt(x,y);if(i>=0){if(hueMode==hueModeIds[i])hueSetMode("stop");else hueSetMode(hueModeIds[i]);if(hueMode=="stop")hueMode="";return true;}
  if(y>=hueDropY()&&y<hueDropY()+hueDropH()){hueDropOpen=true;return true;}
  if(y>=hueStopY()-6&&y<hueStopY()+42){hueSetMode("stop");hueMode="";hueChanged=false;return true;}  // a generous target
 }
 return false;
}
// Touches that start on a room slider belong to it (they never change page).
bool hueOwnsTouch(int x,int y){return page==23&&hueCount&&((hueView==0&&hueTileAt(x,y)>=0)||(hueView==1&&hueDropOpen));}
void hueLoop(){
 static int last=-1;if(page==23&&last!=23)hueSend("{\"type\":\"hue-get\"}");last=page;
 // Room sliders: once a finger on a room moves sideways, it sets that room's brightness (sent while
 // sliding, at most every 400 ms, and again when the finger lifts).
 static bool down=false;static int startX=0,startTile=-1;static uint32_t sentAt=0;
 if(page==23&&hueView==0&&buttonPressed){
  if(!down){down=true;startX=pressedX;startTile=hueTileAt(pressedX,pressedY);hueDragged=false;}
  else if(startTile>=0&&(hueDragged||abs(pressedX-startX)>12)){hueDragged=true;hueDrag=startTile;hueDragBri=hueSliderLevel(startTile,pressedX);
   if(millis()-sentAt>400){sentAt=millis();hueSend(String("{\"type\":\"hue-bri\",\"id\":\"")+hueIds[hueDrag]+"\",\"bri\":"+hueDragBri+"}");}}
 }else if(down){
  down=false;
  if(hueDrag>=0){hueBri[hueDrag]=hueDragBri;hueOn[hueDrag]=true;hueMode="";hueSend(String("{\"type\":\"hue-bri\",\"id\":\"")+hueIds[hueDrag]+"\",\"bri\":"+hueDragBri+"}");hueDrag=-1;}
 }else hueDragged=false;
 // MUSIC LINK: while Orbit listens, send the loudness (bass, middle, treble) and each beat.
 static uint32_t musicAt=0,lastBeat=0;
 if(hueLinked()&&soundListening()&&millis()-musicAt>=100){musicAt=millis();
  float b=0,m=0,h=0;for(int k=0;k<4;k++)b+=soundRaw[k];for(int k=4;k<10;k++)m+=soundRaw[k];for(int k=10;k<16;k++)h+=soundRaw[k];
  bool beat=soundBeatAt!=lastBeat;lastBeat=soundBeatAt;
  char json[96];snprintf(json,sizeof(json),"{\"type\":\"hue-music\",\"b\":%.2f,\"m\":%.2f,\"h\":%.2f,\"beat\":%d}",b/4,m/6,h/6,beat?1:0);hueSend(json);}
}
