// HOME page (0): AI top right plus up to 7 shortcut tiles, chosen and ordered on the PC dashboard (feed "home_keys", e.g.
// "23,21,17,200"). A tile is a screen (its page number), 109 the visualizer, 200 ROTATE or 201 the ring
// lights on/off. SETTINGS sits underneath. The tiles replace the corner icons every screen used to have.
const int HOME_MAX=8;
int homeKeys[HOME_MAX]={23,21,17,200,22,24,25,26},homeKeyCount=8;
int homeFlashId=-1;uint32_t homeFlashAt=0;
bool homeKeyValid(int id){return (id>=0&&id<count&&id!=16)||id==109||id==200||id==201;}
// "23,21,17" -> the tiles; unknown or repeated ids are skipped. Saved only when it changes.
void homeSet(const String &list,bool save=true){
 int keys[HOME_MAX],n=0;int at=0;
 while(at<=(int)list.length()&&n<HOME_MAX){int comma=list.indexOf(',',at);if(comma<0)comma=list.length();String part=list.substring(at,comma);part.trim();
  if(part.length()){int id=part.toInt();bool seen=false;for(int i=0;i<n;i++)if(keys[i]==id)seen=true;if(homeKeyValid(id)&&!seen)keys[n++]=id;}
  at=comma+1;}
 bool same=n==homeKeyCount;for(int i=0;same&&i<n;i++)same=keys[i]==homeKeys[i];if(same)return;
 homeKeyCount=n;for(int i=0;i<n;i++)homeKeys[i]=keys[i];
 if(save)prefs.putString("homekeys",list.substring(0,60));
}
void homeLoad(){String s=prefs.getString("homekeys","");if(s.length())homeSet(s,false);}
const char *homeLabel(int id){
 switch(id){case 21:return "AI";case 17:return "MUSIC";case 23:return "LIGHTS";case 22:return "LIGHT SHOW";case 24:return "ALARM";case 25:return "SOUNDS";
  case 26:return "SWEEP";case 27:return "RUN";case 109:return "VISUALS";case 200:return "ROTATE";case 201:return ledOn?"RING OFF":"RING ON";
  case 0:return "HOME";case 1:return "PRISM";case 2:return "SPLIT";case 3:return "PC";case 4:return "CPU";case 5:return "GPU";case 6:return "THERMAL";
  case 7:return "NETWORK";case 8:return "MEMORY";case 9:return "STORAGE";case 10:return "POWER";case 11:return "CHANNELS";case 12:return "TYPE CLOCK";
  case 13:return "BINARY";case 14:return "FOCUS";case 15:return "STOPWATCH";case 18:return "APPS";case 19:return "SENTRY";case 20:return "PRIVACY";}
 return "?";
}
// A small drawing for each tile, centred on cx, cy.
void homeIcon(int id,int cx,int cy,uint16_t c){
 switch(id){
  case 23:ui.drawCircle(cx,cy-3,8,c);ui.fillCircle(cx,cy-3,5,c);ui.fillRect(cx-4,cy+6,9,3,c);ui.fillRect(cx-3,cy+10,7,2,c);break;  // bulb
  case 21:text("AI",cx,cy,4,c,MC_DATUM);break;
  case 17:ui.fillCircle(cx-5,cy+7,4,c);ui.fillRect(cx-2,cy-9,2,16,c);ui.fillRect(cx-2,cy-9,11,3,c);ui.fillRect(cx+7,cy-8,2,12,c);ui.fillCircle(cx+5,cy+4,4,c);break;  // notes
  case 200:for(int d=40;d<=320;d+=8){float t=d*PI/180;ui.fillRect(cx+int(sinf(t)*10)-1,cy-int(cosf(t)*10)-1,3,3,c);}ui.fillTriangle(cx-6,cy-13,cx+3,cy-9,cx-5,cy-5,c);break;
  case 22:case 201:for(int i=0;i<12;i++){float t=i*PI/6;ui.fillCircle(cx+int(sinf(t)*11),cy-int(cosf(t)*11),2,id==201&&!ledOn?muted:vivid(i*.5f));}break;  // the ring
  case 24:ui.fillCircle(cx,cy-2,9,c);ui.fillRect(cx-9,cy-2,19,8,c);ui.fillRect(cx-11,cy+5,23,3,c);ui.fillCircle(cx,cy+10,3,c);break;  // bell
  case 25:ui.fillCircle(cx,cy,11,c);ui.fillCircle(cx+6,cy-4,10,panel);break;  // moon
  case 26:for(int r=0;r<3;r++)for(int k=0;k<3;k++)ui.fillRect(cx-11+k*8,cy-11+r*8,6,6,(r==1&&k==1)?themeColor(0xf800):c);break;  // board
  case 27:ui.fillTriangle(cx,cy-12,cx-7,cy+6,cx+7,cy+6,c);ui.fillTriangle(cx-4,cy+6,cx+4,cy+6,cx,cy+12,themeColor(0xfd20));break;  // rocket
  case 109:for(int k=0;k<5;k++){int h=6+((k*7+3)%5)*4;ui.fillRect(cx-12+k*5,cy+10-h,4,h,vivid(k*.6f));}break;  // bars
  case 1:case 2:case 12:case 13:case 14:case 15:ui.drawCircle(cx,cy,11,c);ui.drawLine(cx,cy,cx,cy-7,c);ui.drawLine(cx,cy,cx+5,cy+2,c);break;  // clocks and timers
  default:ui.drawRect(cx-12,cy-9,24,18,c);for(int k=0;k<4;k++)ui.fillRect(cx-9+k*5,cy+5-((k*5+2)%4)*3-3,3,((k*5+2)%4)*3+3,c);  // PC screens
 }
}
// What is running, for the tiles and the house's dots: music playing on the PC (the feed's media state,
// fresh within 12 s), a Hue light mode, Music Mode (MM on the visualizer).
bool homeMusicOn(){return mediaPlaying&&millis()-mediaAt<12000;}
bool homeLightsOn(){return hueMode.length()>0||hueAnyOn();}
const uint16_t HOME_MUSIC=0x07e0,HOME_LIGHTS=0xfd20;
// A tile that shows something running: its own colour and a word for it.
uint16_t homeActive(int id,String &word){
 if(id==17&&homeMusicOn()){word="PLAYING";return themeColor(HOME_MUSIC);}
 if(id==23&&hueMode.length()){word=hueLinked()?"MUSIC MODE":hueMode;word.toUpperCase();return themeColor(HOME_LIGHTS);}
 if(id==23&&hueAnyOn()){word="LIGHTS ON";return themeColor(HOME_LIGHTS);}
 if(id==109&&hueLinked()){word="MUSIC MODE";return themeColor(HOME_LIGHTS);}
 return 0;
}
int homeCols(){return tall()?2:4;}
// What each tile slot shows (-1 empty). AI always sits top right, lying down or standing up; the chosen
// shortcuts fill the other slots in order.
int homeSlots(int slot[HOME_MAX]){
 int others[HOME_MAX],n=0;for(int i=0;i<homeKeyCount;i++)if(homeKeys[i]!=21&&n<HOME_MAX-1)others[n++]=homeKeys[i];
 int total=max(homeCols(),n+1),ai=homeCols()-1,k=0;for(int i=0;i<total;i++)slot[i]=i==ai?21:(k<n?others[k++]:-1);return total;
}
int homeTileW(){return tall()?110:74;}int homeTileH(){return tall()?46:70;}
int homeTileX(int i){return tall()?8+(i%2)*114:6+(i%4)*77;}int homeTileY(int i){return tall()?62+(i/2)*51:38+(i/4)*75;}
int homeSettingsKeyY(){return tall()?266:190;}
// The slot under a point, or -1 (blank or empty slots).
int homeTileAt(int x,int y){int slot[HOME_MAX],n=homeSlots(slot);for(int i=0;i<n;i++)if(slot[i]>=0&&x>=homeTileX(i)&&x<homeTileX(i)+homeTileW()&&y>=homeTileY(i)&&y<homeTileY(i)+homeTileH())return i;return -1;}
void drawHome(){
 header("HOME",clockText());
 int slot[HOME_MAX],shown=homeSlots(slot);
 for(int i=0;i<shown;i++){int id=slot[i];if(id<0)continue;int x=homeTileX(i),y=homeTileY(i),w=homeTileW(),h=homeTileH();bool lit=id==homeFlashId&&millis()-homeFlashAt<300;
  String word;uint16_t on=homeActive(id,word);
  ui.fillRect(x,y,w,h,lit?accent:panel);ui.drawRect(x,y,w,h,on&&!lit?on:accent);if(on&&!lit){ui.drawRect(x+1,y+1,w-2,h-2,on);ui.drawRect(x+2,y+2,w-4,h-4,on);}
  uint16_t c=lit?themeBg:on?on:accent;String label=word.length()?word:String(homeLabel(id));
  if(tall()){homeIcon(id,x+22,y+h/2,c);text(label,x+40,y+h/2,1,lit?themeBg:on?on:ink,ML_DATUM);}
  else{homeIcon(id,x+w/2,y+28,c);text(label,x+w/2,y+58,1,lit?themeBg:on?on:ink,MC_DATUM);}
  // Moving bars in the corner of a busy tile, so it reads as live at a glance.
  if(on&&!lit)for(int k=0;k<3;k++){int bh=3+int(5*(1+sinf(millis()/140.f+k*1.7f)));ui.fillRect(x+w-16+k*4,y+14-bh,3,bh,on);}}
 button("SETTINGS",tall()?8:6,homeSettingsKeyY(),tall()?W-16:W-12,false);
}
void homeOpen(int id){
 homeFlashId=id;homeFlashAt=millis();
 if(id==200){rotateScreen();return;}
 if(id==201){ledOn=!ledOn;ledSave(true);return;}
 if(id==109||(id>=0&&id<count))setPage(id);
}
// A tap on the home page: a tile, SETTINGS, or nothing (false: blank space, so double taps still page).
bool homeTap(int x,int y){
 int i=homeTileAt(x,y);if(i>=0){int slot[HOME_MAX];homeSlots(slot);homeOpen(slot[i]);return true;}
 int sy=homeSettingsKeyY();if(y>=sy-2&&y<sy+36){setPage(100);return true;}
 return false;
}
