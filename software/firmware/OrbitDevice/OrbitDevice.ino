// Orbit Rectangular Showcase / CYD-L. Live readings, square instruments,
// 24 main screens and a separate Setup menu. No simulated voice features.
#include <Arduino.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <WiFi.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>
#include <esp_task_wdt.h>
TFT_eSPI tft;
TFT_eSprite ui(&tft);
SPIClass touchBus(VSPI);
XPT2046_Touchscreen touch(33,36);
Preferences prefs;
const int count=24;
String ownerName="Friend",ownerTZ="EST5EDT,M3.2.0,M11.1.0";
uint32_t enabledPages=(1UL<<24)-1;
const char *names[count]={"ORBIT COMPANION","PRISM CLOCK","SPLIT CLOCK","PC MATRIX","CPU PULSE","GPU ENGINE","THERMAL STRIP","NETWORK STREAM","MEMORY BLOCKS","STORAGE TRAFFIC","POWER DRIVE","SIX CHANNELS","TYPE CLOCK","BINARY CLOCK","FOCUS","STOPWATCH","AI DESK","MUSIC REMOTE","APP LAUNCHER","SENTRY","PRIVACY GUARD","ORBIT COMPANION","LIGHT SHOW","HUE LIGHTS"};
const char *setupNames[]={"SETUP","BRIGHTNESS","COLORS","WI-FI STATUS","NEARBY WI-FI","DEVICE MEMORY","TOUCH TEST","AI INBOX","PC CONNECTION","VISUALS"};
uint16_t accents[]={0x07ff,0xf81f,0x87e0,0xfd20,0xaaff};
int page=0,returnPage=0,startupPage=0,colorIndex=0,brightness=70;
int privacyFolderCount=0,privacyBrowserCount=0;
int quickTargets[3]={17,16,18};uint32_t quickIconAt=0,mediaAt=0;bool mediaPlaying=false;
// Freeze diagnosis: the main loop records which step it is in (kept through a watchdog restart), and the
// step from before the restart is reported to the PC as lastStep.
RTC_NOINIT_ATTR uint32_t loopStep,loopStepMark;uint32_t lastStep=0;
bool cameraFullscreen=false,buttonPressed=false;int pressedX=0,pressedY=0,pendingX=0,pendingY=0;uint32_t feedbackUntil=0;
bool remoteBusy();
void drawQuickIcon();
void drawVoice();
void drawLights();
void lightTap(int x,int y);
void hueFromJson(const char *j,size_t len);void drawHue();bool hueTap(int x,int y);bool hueLinked();bool hueOwnsTouch(int x,int y);bool hueAvailable();bool hueAnyOn();
void soundStop();void drawSound();void soundTap(int x,int y);void ledHue(uint8_t h,uint8_t out[3]);
void speakerEnter();
bool laptopMedia(const char *action);
String pairStatusText();uint16_t pairStatusColor();bool pairPromptActive();void pairTouch(int x,int y);void drawPairOverlay();  // pair_link.h
int remotePage=-1;  // page whose button started the pending action; only that page shows the spinner
uint16_t accent=0x07ff,ink=0xef7e,muted=0x8492,panel=0x10a3;
#include "themes.h"
uint32_t lastFrame=0,frames=0,framesAt=0;float fps=0;
uint32_t focusMs=25*60000,focusAt=0,watchAt=0,watchMs=0;
bool focusRunning=false,watchRunning=false,scanning=false;
int touchX=160,touchY=120;
// The picture's size: 320 x 240 lying down, 240 x 320 standing up. Every screen lays itself out for both.
int W=320,H=240;
bool tall(){return H>W;}uint32_t touchEvents=0;
String networkText="Hold SCAN to find nearby Wi-Fi";
void text(const String &s,int x,int y,int font=2,uint16_t c=themeColor(0xffff),int datum=TL_DATUM){ui.setFreeFont(nullptr);if(font==1)ui.setTextFont(1);else ui.setFreeFont(themeFont(font));ui.setTextColor(c);ui.setTextDatum(datum);ui.drawString(s,x,y);}
void big(const String &s,int x,int y,uint16_t c=themeColor(0xffff),int datum=MC_DATUM){ui.setFreeFont(themeFont(7));if(ui.textWidth(s)>W-16)ui.setFreeFont(themeFont(4));ui.setTextColor(c);ui.setTextDatum(datum);ui.drawString(s,x,y);ui.setFreeFont(nullptr);}
void button(const String &s,int x,int y,int w=140,bool active=true,uint16_t customBg=0){
 bool pressed=buttonPressed&&pressedX>=x&&pressedX<x+w&&pressedY>=y&&pressedY<y+34;
 bool busy=(remoteBusy()&&page==remotePage&&pendingX>=x&&pendingX<x+w&&pendingY>=y&&pendingY<y+34)||(page==104&&scanning);
 uint16_t bg=busy?0xfd20:pressed?0xffff:customBg?customBg:active?accent:panel,fg=busy||pressed?0x0000:customBg?0xffff:active?themeBg:ink;
 if(themeIndex==3){ui.fillRoundRect(x,y,w,34,7,bg);ui.drawRoundRect(x,y,w,34,7,pressed?ink:accent);}else{ui.fillRect(x,y,w,34,bg);ui.drawRect(x,y,w,34,pressed?ink:accent);if(themeIndex==2)ui.drawLine(x+w-10,y,x+w-1,y+9,fg);}
 ui.setFreeFont(themeFont(2));int labelFont=ui.textWidth(s)>w-(busy?32:14)?1:2;text(s,x+w/2-(busy?6:0),y+17,labelFont,fg,MC_DATUM);
 if(busy){int cx=x+w-13,cy=y+17;for(int i=0;i<8;i++){float a=(i+millis()/90)*PI/4;ui.fillRect(cx+int(cosf(a)*5),cy+int(sinf(a)*5),2,2,i<4?0x0000:0x7be0);}ui.fillRect(x,y+31,(millis()/12)%w,3,0x0000);}
}
// Main pages keep the top corners for the HOME (left) and AI + MUSIC + ROTATE (right) shortcut buttons.
// Standing up there is no room beside them, so the title goes on its own line underneath (y 36-56).
void header(const String &s,const String &right=""){
  if(tall()&&page<count){ui.fillRect(10,40,4,12,accent);text(s,22,37,2,ink);text(right,W-8,41,1,muted,TR_DATUM);return;}
  // Lying down a long title and its status can meet; the title wins.
  // With the Hue bulb in the corner there is less room; a title that would run under it gets the small font.
  int x=page<count?42:10,rx=page<count?(hueAvailable()?W-150:W-114):W-10;ui.fillRect(x,13,4,12,accent);
  ui.setFreeFont(themeFont(2));if(page<count&&hueAvailable()&&x+12+ui.textWidth(s)>W-148)text(s,x+12,14,1,ink);else text(s,x+12,10,2,ink);
  ui.setFreeFont(themeFont(2));int end=x+12+ui.textWidth(s);if(end+8<=rx-6*int(right.length()))text(right,rx,13,1,muted,TR_DATUM);}
// Where a main page's content starts below the header.
int topY(){return tall()?60:36;}
void showFrame(){ui.pushSprite(0,0);}
const char *pageName(int n){return n>=100&&n<=109?setupNames[n-100]:names[constrain(n,0,count-1)];}
void nextPage(int direction);
void setPage(int n){if(n>=100&&n<=109){if(page<count)returnPage=page;page=n;}else page=(n%count+count)%count;ledcWrite(21,page==29?12:brightness*255/100);Serial.printf("SCREEN %d %s\n",page,pageName(page));}
// Screen order for taps and swipes. Going back (left) from home: AI, Sentry, Privacy guard (file deletion),
// Hue lights, Light show (colours), then the rest in their usual order. Hidden screens are skipped.
const uint8_t pageOrder[]={0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,22,23,20,19,21};
void nextPage(int direction){
  int at=0;for(int i=0;i<count;i++)if(pageOrder[i]==page)at=i;
  for(int i=0;i<count;i++){at=(at+direction+count)%count;int n=pageOrder[at];if(enabledPages&(1UL<<n)){setPage(n);return;}}
}
String clockText(){time_t now=time(nullptr);struct tm tm;localtime_r(&now,&tm);char s[24];if(now>1700000000)strftime(s,sizeof(s),"%H:%M",&tm);else snprintf(s,sizeof(s),"%02lu:%02lu",(unsigned long)(millis()/3600000),(unsigned long)(millis()/60000%60));return String(s);}
String dateText(){time_t now=time(nullptr);struct tm tm;localtime_r(&now,&tm);char s[32];if(now>1700000000)strftime(s,sizeof(s),"%a / %b %d",&tm);else strcpy(s,"SYNCING TIME");return String(s);}
int secondNow(){time_t now=time(nullptr);return now>1700000000?int(now%60):int(millis()/1000%60);}
String duration(uint32_t ms){char s[24];uint32_t sec=ms/1000;snprintf(s,sizeof(s),"%02lu:%02lu",(unsigned long)(sec/60),(unsigned long)(sec%60));return String(s);}
// Wi-Fi status: a dot and up to three arcs above (cx,cy). Green arcs show signal strength when
// connected; grey with a red slash when not.
void drawWifiIcon(int cx,int cy){
  bool on=WiFi.isConnected();int rssi=on?WiFi.RSSI():-100,bars=!on?0:rssi>-60?3:rssi>-72?2:1;
  uint16_t lit=themeColor(0x07e0),dim=themeColor(0x3186);
  ui.fillCircle(cx,cy,2,on?lit:dim);
  for(int i=0;i<3;i++){int r=6+i*5;uint16_t c=i<bars?lit:dim;
    for(int a=-45;a<=45;a+=5){float t=a*PI/180;ui.fillRect(cx+int(sinf(t)*r)-1,cy-int(cosf(t)*r)-1,2,2,c);}}
  if(!on){ui.drawLine(cx-12,cy-18,cx+12,cy+2,themeColor(0xf800));ui.drawLine(cx-11,cy-18,cx+13,cy+2,themeColor(0xf800));}
}
#include "security.h"
#include "pc_cluster.h"
#include "companion.h"
#include "showcase.h"
#include "remote.h"
#include "audio_diag.h"
#include "voice_link.h"
#include "led_ring.h"
#include "sound_waves.h"
#include "hue.h"
#include "ota_update.h"
#include "pair_link.h"
// Bluetooth music is a separate program (firmware/OrbitSpeaker) in the spare OTA slot: linking the
// Bluetooth stack here would permanently reserve ~87 KB of RAM. speakerEnter() is in ota_update.h.
void footer(){
  if(page>=100){text("BACK: TOP LEFT",10,H-11,1,muted);text("MAIN",W-10,H-11,1,accent,TR_DATUM);return;}
  int x0=tall()?10:80,step=tall()?7:8;
  for(int i=0;i<count;i++)ui.fillRect(x0+i*step,H-10,step-2,i==page?5:2,i==page?accent:themeColor(0x3186));
  text(String(page+1)+"/"+String(count),W-10,H-11,1,muted,TR_DATUM);
}
// Setup tiles: 2 x 4 lying down; standing up, one column of 8 with the description on the right.
void setupTile(int i,int &x,int &y,int &w,int &h){if(tall()){w=228;h=30;x=6;y=38+i*33;}else{w=148;h=39;x=8+(i%2)*156;y=41+(i/2)*44;}}
int setupTileAt(int x,int y){for(int i=0;i<8;i++){int tx,ty,tw,th;setupTile(i,tx,ty,tw,th);if(x>=tx&&x<tx+tw&&y>=ty&&y<ty+th)return i;}return -1;}
// Brightness bar and colour swatches (setup), shared by drawing and touch.
int barX(){return tall()?12:24;}int barW(){return W-2*barX();}int barY(){return tall()?170:149;}
int swatchX(int i){return tall()?8+i*46:12+i*61;}int swatchY(){return tall()?150:126;}int swatchW(){return tall()?40:52;}
void drawSetup(){
  header("");text(pageName(page),83,10,2,ink);text("< BACK",7,11,2,accent);
  int cx=W/2;
  if(page==100){
    const char *sub[]={"DISPLAY LEVEL","SIGNATURE COLOR","SIGNAL + ADDRESS","SCAN NETWORKS","MEMORY + FPS","LIVE INPUT","MESSAGES","PC LINK"};
    for(int i=0;i<8;i++){int x,y,w,h;setupTile(i,x,y,w,h);ui.fillRect(x,y,w,h,buttonPressed&&pressedX>=x&&pressedX<x+w&&pressedY>=y&&pressedY<y+h?muted:themeColor(0x1083));ui.fillRect(x,y,3,h,accents[i%5]);
      if(tall()){text(setupNames[i+1],x+9,y+15,2,ink,ML_DATUM);text(sub[i],x+w-6,y+15,1,muted,MR_DATUM);}else{text(setupNames[i+1],x+9,y+5,2,ink);text(sub[i],x+9,y+24,1,muted);}}
  }else if(page==101){
    big(String(brightness)+"%",cx,tall()?110:90,ink);ui.fillRect(barX(),barY(),barW(),18,panel);ui.fillRect(barX(),barY(),max(1,barW()*brightness/100),18,accent);text("DRAG OR TAP THE BAR",cx,tall()?230:193,2,muted,MC_DATUM);
  }else if(page==102){
    if(tall())text("Your palette",cx,100,4,ink,MC_DATUM);else big("Your palette",160,80,ink);
    for(int i=0;i<5;i++){int x=swatchX(i),w=swatchW();ui.fillRect(x,swatchY(),w,w,accents[i]);if(i==colorIndex)ui.drawRect(x-2,swatchY()-2,w+4,w+4,ink);}
    text("TAP A COLOR",cx,tall()?230:201,2,muted,MC_DATUM);
  }else if(page==103||page==108){
    int y0=tall()?50:48,dy=tall()?36:31;
    text(page==103?"WI-FI":"PC FEED",12,y0,2,muted);big(page==103?(WiFi.isConnected()?"Online":"Offline"):(pcLive()?feedTransport:"Waiting"),cx,y0+(tall()?60:45),pcLive()?accent:ink);
    int y=tall()?160:139;
    text(WiFi.isConnected()?WiFi.SSID().substring(0,tall()?22:28):tall()?"Reconnecting...":"Reconnecting to saved network",cx,y,2,ink,MC_DATUM);
    text(WiFi.isConnected()?WiFi.localIP().toString():"--",cx,y+dy,2,muted,MC_DATUM);
    text(page==103?"SIGNAL  "+String(WiFi.RSSI())+" dBm":"USB CAN BE POWER ONLY",cx,y+dy*2,2,muted,MC_DATUM);
  }else if(page==104){
    int y=tall()?56:51,start=0;while(start<int(networkText.length())&&y<(tall()?220:170)){int end=networkText.indexOf('\n',start);if(end<0)end=networkText.length();wrapped(networkText.substring(start,end),12,y,W-24,tall()?2:1,ink);start=end+1;y+=tall()?42:28;}
    button(scanning?"SCANNING...":"HOLD TO SCAN",cx-90,tall()?240:179,180);
  }else if(page==105){
    int y0=tall()?50:49;
    text("FREE DEVICE MEMORY",12,y0,2,muted);big(String(ESP.getFreeHeap()/1024)+" KB",cx,y0+(tall()?55:45),accent);
    int y=tall()?160:143,dy=tall()?36:31;
    text("DISPLAY  "+String(fps,1)+" FPS",12,y,2,ink);text("UPTIME  "+duration(millis()),12,y+dy,2,muted);text("CYD-L / ORBIT COMPANION",12,y+dy*2,1,muted);
  }else if(page==106){
    for(int x=12;x<W;x+=16)for(int y=44;y<H-22;y+=16)ui.drawPixel(x,y,themeColor(0x3186));
    ui.drawFastHLine(0,touchY,W,accent);ui.drawFastVLine(touchX,35,H-58,accent);ui.drawRect(touchX-9,touchY-9,19,19,themeColor(0xf81f));text(String(touchX)+" / "+String(touchY),cx,H-38,2,ink,MC_DATUM);
  }else if(page==107){drawCompanion();ui.fillRect(0,0,W-45,32,themeBg);text("< BACK",7,11,2,accent);text("AI INBOX",83,10,2,ink);}
}
void draw(){ui.fillSprite(themeBg);if(securityLocked){drawSecurity();showFrame();frames++;return;}if(page==109)drawSound();else if(page>=100)drawSetup();else if(page>=16)drawRemote();else drawShowcase(page);bool face=(page==21&&voiceView==2)||page==109;  // the face and the visuals fill the screen: no footer or corner shortcuts
  if(aiAttention&&(millis()/500)%2==0)ui.fillRect(hueAvailable()?W-152:W-116,8,6,6,themeColor(0xfd20));if(!face&&(!cameraFullscreen||page!=19))footer();if(!face)drawQuickIcon();drawPairOverlay();showFrame();frames++;}
void tap(int x,int y){
  if(securityLocked){securityTap(x,y);return;}
  if(page==109){soundTap(x,y);return;}  // VISUALS: EXIT, or the next animation
  if(page==0&&homeSettingsAt(x,y)){setPage(100);return;}
  if(page==21&&voiceTap(x,y))return;  // CONSOLE / TALK switch, console scrolling and SEND / CANCEL
  if(page==21&&y>=talkTop())return;  // talk bar: handled by voiceLoop while held
  if(page==20&&remoteHold(x,y))return;
  if(page==19&&remoteHold(x,y))return;
  if(page==16&&aiId.length()&&y>=replyTop())return;
  if(page>=16&&page<=18&&remoteHold(x,y))return;
  if(page==23&&hueTap(x,y))return;  // HUE LIGHTS tiles and ALL OFF / ALL ON
  if(page<count){nextPage(x<W/2?-1:1);return;}  // tap the left half to go back, the right half to go forward
  if(y>=H-18){setPage(returnPage);return;}
  if(x<70&&y<32){if(page==100)setPage(returnPage);else setPage(100);return;}
  if(page==100){int i=setupTileAt(x,y);if(i>=0)setPage(101+i);return;}
  if(page==101&&y>=barY()-20&&y<=barY()+38){brightness=constrain(map(x,barX(),barX()+barW(),5,100),5,100);ledcWrite(21,brightness*255/100);prefs.putInt("brightness",brightness);return;}
  if(page==102&&y>=swatchY()-4&&y<=swatchY()+swatchW()+4){int i=0;for(int k=0;k<5;k++)if(x>=swatchX(k)-4)i=k;colorIndex=i;applyTheme();prefs.putInt("color",colorIndex);return;}
}
bool holdControl(int x,int y){
  if(page==0&&homeSettingsAt(x,y)){setPage(100);return true;}
  if((page==16||page==107)&&y>=replyTop()&&aiId.length()&&!aiExpired){aiReply=x<W/2?"YES":"NO";aiAttention=false;return true;}
  if(page==20&&y>=privacyDeleteY()&&y<privacyDeleteY()+34){requestRemote("privacy:cleanup");return true;}
  if(remoteHold(x,y))return true;
  if(page==14&&y>=timerButtonY()-3&&y<=timerButtonY()+35){if(!focusMs)focusMs=25*60000;focusRunning=!focusRunning;focusAt=millis();return true;}
  if(page==15&&y>=timerButtonY()-3&&y<=timerButtonY()+35){if(x>W/2){watchMs=0;watchAt=millis();}else{watchRunning=!watchRunning;watchAt=millis();}return true;}
  if(page==104&&y>=(tall()?236:175)&&!scanning){WiFi.scanNetworks(true);scanning=true;return true;}
  return false;
}
#include "touch_gesture.h"
TouchGesture gesture;
QuickTapIcon quickIcon;
void quickJump(int slot){int target=quickTargets[slot];if(target>=0&&target<count){cameraFullscreen=false;setPage(target);}}
const int VOICE_PAGE=21;uint32_t homeIconAt=0,aiIconAt=0,lightIconAt=0;
// Shortcut buttons on every main page: HOME top-left; AI, MUSIC and ROTATE top-right. One tap each.
uint32_t rotateIconAt=0;
void drawQuickIcon(){
  if(page>=count||securityLocked)return;
  uint16_t h=millis()-homeIconAt<550?0xfd20:accent;  // HOME: a small house
  ui.fillRect(0,0,36,32,panel);ui.drawRect(0,0,36,32,h);ui.fillTriangle(18,6,7,16,29,16,h);ui.fillRect(11,16,14,10,h);ui.fillRect(16,20,4,6,panel);
  // The right-hand buttons sit against the right edge either way up: (LIGHTS when Hue is paired), AI, MUSIC, ROTATE.
  if(hueAvailable()){int lx=W-144;uint16_t l=millis()-lightIconAt<550?0xfd20:accent;bool lit=hueAnyOn();  // LIGHTS: a bulb
    ui.fillRect(lx,0,36,32,panel);ui.drawRect(lx,0,36,32,l);if(lit)ui.fillCircle(lx+18,13,7,l);else ui.drawCircle(lx+18,13,7,l);
    ui.fillRect(lx+14,21,9,3,l);ui.fillRect(lx+15,25,7,2,l);
    if(lit)for(int k=0;k<5;k++){float t=(k-2)*0.6f;ui.drawLine(lx+18+int(sinf(t)*10),13-int(cosf(t)*10),lx+18+int(sinf(t)*13),13-int(cosf(t)*13),l);}}
  int ax=W-108,mx=W-72,rx=W-36;
  uint16_t a=millis()-aiIconAt<550?0xfd20:accent;    // AI: opens the voice companion
  ui.fillRect(ax,0,36,32,panel);ui.drawRect(ax,0,36,32,a);text("AI",ax+18,16,2,a,MC_DATUM);
  uint16_t r=millis()-rotateIconAt<550?0xfd20:accent;  // ROTATE: a circular arrow; turns the picture a quarter turn
  ui.fillRect(rx,0,36,32,panel);ui.drawRect(rx,0,36,32,r);
  for(int deg=40;deg<=320;deg+=8){float t=deg*PI/180;ui.fillRect(rx+18+int(sinf(t)*9)-1,16-int(cosf(t)*9)-1,3,3,r);}
  ui.fillTriangle(rx+12,4,rx+20,8,rx+13,12,r);
  if(quickTargets[0]<0)return;
  uint16_t c=millis()-quickIconAt<550?0xfd20:mediaPlaying&&millis()-mediaAt<10000?((millis()/500)%2?0x87e0:0x07e0):accent;ui.fillRect(mx,0,36,32,panel);ui.drawRect(mx,0,36,32,c);ui.fillCircle(mx+12,22,3,c);ui.fillRect(mx+14,9,2,13,c);ui.fillRect(mx+14,9,10,3,c);ui.fillRect(mx+22,10,2,9,c);ui.fillCircle(mx+20,20,3,c);
}
// Screen rotation. The ROTATE button turns Orbit's picture a quarter turn per tap (Orbit has no tilt
// sensor). Every screen has its own layout for lying down (320 x 240) and standing up (240 x 320): the
// frame buffer is remade at the new size (the same 75 KB either way) and each screen draws to W x H.
uint8_t screenRot=1;  // display rotation: 1 and 3 lying down (landscape), 0 and 2 standing up (portrait)
void setScreenRotation(int rot){
  screenRot=rot&3;tft.setRotation(screenRot);W=tft.width();H=tft.height();tft.fillScreen(themeBg);
  if(ui.created()){ui.deleteSprite();ui.setColorDepth(8);if(!ui.createSprite(W,H))Serial.println("FRAMEBUFFER FAILED");}
  conDirty=true;touchX=W/2;touchY=H/2;  // the console re-wraps its lines for the new width
}
void rotationSetup(){setScreenRotation(prefs.getUChar("rot",1));}
// One tap: lying down -> standing up -> lying down the other way -> standing up the other way.
void rotateScreen(){setScreenRotation(screenRot+3);prefs.putUChar("rot",screenRot);gesture=TouchGesture();Serial.printf("ROTATION %d\n",screenRot);}
// The touch panel reads as if lying down (rotation 1, 320 x 240); turn that into the picture's own x, y.
void touchToScreen(int &x,int &y){
  int tx=x,ty=y;
  if(screenRot==3){x=319-tx;y=239-ty;}
  else if(screenRot==0){x=239-ty;y=tx;}
  else if(screenRot==2){x=ty;y=319-tx;}
}
void touchInput(){
  bool pressed=touch.touched();int x=touchX,y=touchY;
  if(pressed){TS_Point p=touch.getPoint();pressed=p.z>=200;if(pressed){x=constrain(map(p.x,200,3700,0,319),0,319);y=constrain(map(p.y,240,3800,0,239),0,239);
    touchToScreen(x,y);touchX=x;touchY=y;}}
  buttonPressed=pressed;pressedX=x;pressedY=y;if(pressed)securityLastTouch=millis();
  TouchGesture::Event event=gesture.update(pressed,x,y,millis(),page);if(event.kind==TouchGesture::NONE)return;
  if(securityLocked){quickIcon.cancel();securityTap(gesture.startX,event.startY);return;}
  if(pairPromptActive()){if(event.kind==TouchGesture::TAP||event.kind==TouchGesture::HOLD)pairTouch(gesture.startX,event.startY);return;}  // pairing prompt owns the screen
  // The face view owns every touch (voiceLoop: tap to talk, hold 3 s to leave), including the lift after leaving.
  if(page==21&&(voiceView==2||int32_t(millis()-faceQuietUntil)<0))return;
  // Corner shortcuts: a single tap jumps straight there (the music icon used to need a double tap).
  if(page<count&&event.startY<32){
    if(gesture.startX<38){if(event.kind==TouchGesture::TAP){homeIconAt=millis();cameraFullscreen=false;setPage(startupPage);}return;}
    if(hueAvailable()&&gesture.startX>=W-144&&gesture.startX<W-108){if(event.kind==TouchGesture::TAP){lightIconAt=millis();cameraFullscreen=false;setPage(23);}return;}
    if(gesture.startX>=W-108&&gesture.startX<W-72){if(event.kind==TouchGesture::TAP){aiIconAt=millis();cameraFullscreen=false;setPage(VOICE_PAGE);}return;}
    if(gesture.startX>=W-72&&gesture.startX<W-36&&quickTargets[0]>=0){if(event.kind==TouchGesture::TAP){quickIconAt=millis();quickJump(0);}return;}
    if(gesture.startX>=W-36){if(event.kind==TouchGesture::TAP){rotateIconAt=millis();rotateScreen();}return;}
  }
  quickIcon.cancel();
  // A press on the talk bar never navigates; in the console it may be the draft's CANCEL / SEND.
  if(page==21&&event.startY>=talkTop()){if(event.kind==TouchGesture::TAP||event.kind==TouchGesture::HOLD)voiceTap(gesture.startX,event.startY);return;}
  // LIGHT SHOW controls: taps pick effects/colours/speed; the brightness bar is read in ledLoop.
  // Swipes elsewhere on the page still change pages.
  if(page==22&&event.startY>=topY()){if(lightBarAt(gesture.startX,event.startY))return;if(event.kind==TouchGesture::TAP||event.kind==TouchGesture::HOLD){lightTap(gesture.startX,event.startY);return;}}
  if(page==17&&volumeBarAt(gesture.startX,event.startY))return;  // volume slider (musicLoop)
  if(event.kind!=TouchGesture::TAP&&hueOwnsTouch(gesture.startX,event.startY))return;  // HUE room slider (hueLoop)
  if(page==20&&event.kind==TouchGesture::HOLD&&holdControl(event.x,event.y))return;
  touchEvents++;Serial.printf("TOUCH %d %d KIND=%d\n",event.x,event.y,event.kind);
  if(page>=100){if(event.kind==TouchGesture::HOLD&&holdControl(event.x,event.y))return;tap(event.x,event.y);return;}
  // A contact begun on a camera control belongs to that control, even if
  // resistive-touch drift looks like a swipe. Blank taps advance normally.
  if(event.kind==TouchGesture::SWIPE_UP||event.kind==TouchGesture::SWIPE_DOWN){
    // Swipes that begin on a screen's controls stay with those controls.
    int sy=event.startY;
    bool control=(page==0&&homeSettingsAt(gesture.startX,sy))||(page==16&&sy>=replyTop()-24)||(page==17&&sy>=musicTop())||(page==18&&sy>=appTop()&&sy<appTop()+6*appStep())||((page==14||page==15)&&sy>=timerButtonY()-3)||(page==19&&(cameraFullscreen||sy>=cameraTop()))||(page==20&&sy>=privacyDeleteY());
    if(!control)quickJump(event.kind==TouchGesture::SWIPE_UP?1:2);return;
  }
  if(page==19&&(cameraFullscreen||event.startY>=cameraTop())&&remoteHold(gesture.startX,event.startY))return;
  if(event.kind==TouchGesture::SWIPE_LEFT){nextPage(1);return;}
  if(event.kind==TouchGesture::SWIPE_RIGHT){nextPage(-1);return;}
  if(event.kind==TouchGesture::HOLD&&holdControl(event.x,event.y))return;
  tap(event.x,event.y);
}
void commands(){
  static String line;
  while(Serial.available()){
    char c=Serial.read();if(c=='\n'){
      line.trim();if(line.startsWith("SCREEN "))setPage(line.substring(7).toInt());
      if(line=="NEXT")tap(W/2,H/2);
      if(line=="ROTATE")rotateScreen();
      if(line.startsWith("ROTATION "))setScreenRotation(line.substring(9).toInt());
      if(line.startsWith("TAP ")){int x,y;if(sscanf(line.c_str()+4,"%d %d",&x,&y)==2)tap(x,y);}
      if(line=="SECURITYTEST")Serial.println(securitySelfTest()?"SECURITYTEST PASS":"SECURITYTEST FAIL");
      if(line=="GESTURETEST")Serial.println(gestureSelfTest()?"GESTURETEST PASS":"GESTURETEST FAIL");
      if(line=="QUICKTEST")Serial.println(quickTapSelfTest()?"QUICKTEST PASS":"QUICKTEST FAIL");
      if(line=="MIC START")micStart();
      if(line=="MIC FAST"){micStop();micStart(48000);}
      if(line=="MIC STOP")micStop();
      if(line=="SPEAKER TEST")speakerTest();
      if(line=="SPEAKER REPEAT")speakerTest(true);
      if(line=="AUDIO LOOPBACK")audioLoopbackTest();
      if(line=="AUDIO STOP"){micStop();speakerStop();}
      if(line.startsWith("VOICELINK "))voicePair(line);
      if(line=="VOICE MODE LOOPBACK")voiceSetMode(true);
      if(line=="VOICE MODE AI")voiceSetMode(false);
      if(line=="VOICE STATUS")voiceStatus();
      if(line.startsWith("LED "))ledCommand(line);
      if(line=="SOUND")soundCommand();
      if(line.startsWith("TIME ")){struct timeval tv={};tv.tv_sec=strtoll(line.c_str()+5,nullptr,10);settimeofday(&tv,nullptr);Serial.println("TIME SET");}
      if(line.startsWith("PC ")){receivePC(line);feedTransport="USB";}
      if(line.startsWith("PAIR ")&&line.length()==37){pairKey=line.substring(5);prefs.putString("pair",pairKey);Serial.println("PAIR SAVED");}
      if(line.startsWith("WIFI\t")){int split=line.indexOf('\t',5);if(split>5){String ssid=line.substring(5,split),password=line.substring(split+1);WiFi.disconnect();WiFi.begin(ssid.c_str(),password.c_str());Serial.println("WIFI CONFIGURED");}}
      if(line=="STATUS")Serial.printf("ORBIT CYD-L DISPLAY=OK WIDTH=%d HEIGHT=%d PAGE=%d TOUCHES=%lu HEAP=%u FPS=%.1f PC_PACKETS=%lu PC_LIVE=%d CPU=%.1f RAM=%.1f GPU=%.1f TEMP=%.1f WIFI=%d IP=%s LINK=%s MAIN=21 SETUP=9\n",tft.width(),tft.height(),page,(unsigned long)touchEvents,ESP.getFreeHeap(),fps,(unsigned long)pcPackets,pcLive(),pc.cpu,pc.ram,pc.gpu,pc.temp,WiFi.isConnected(),WiFi.localIP().toString().c_str(),feedTransport.c_str());
      line="";
    }else if(line.length()<512)line+=c;
  }
}
void setup(){
  Serial.begin(115200);delay(200);Serial.println("ORBIT CYD-L BOOT");
  if(loopStepMark==0x5EEDF00D&&esp_reset_reason()!=ESP_RST_POWERON)lastStep=loopStep;loopStepMark=0x5EEDF00D;loopStep=0;
  // Watchdog: if the main loop is stuck for 15 s, Orbit restarts itself (and then reports lastStep).
  esp_task_wdt_config_t wdt={.timeout_ms=15000,.idle_core_mask=0,.trigger_panic=true};
  if(esp_task_wdt_reconfigure(&wdt)!=ESP_OK)esp_task_wdt_init(&wdt);enableLoopWDT();
  pinMode(0,INPUT_PULLUP);for(int pin:{4,16,17}){pinMode(pin,OUTPUT);digitalWrite(pin,HIGH);}audioPinsIdle();
  prefs.begin("orbit-cyd",false);securityLoad();for(int i=0;i<3;i++)quickTargets[i]=constrain(prefs.getInt(("quick"+String(i)).c_str(),quickTargets[i]),-1,20);brightness=constrain(prefs.getInt("brightness",70),5,100);colorIndex=constrain(prefs.getInt("color",0),0,4);accent=accents[colorIndex];
  ownerName=prefs.getString("owner","Friend");ownerTZ=prefs.getString("tz",ownerTZ);// Voice page always available; the AI DESK page (16) is retired: it depended on the unpaired companion.
enabledPages=(prefs.getUInt("enabled",(1UL<<21)-1)|(1UL<<21)|(1UL<<22)|(1UL<<23))&~(1UL<<16);  // + LIGHT SHOW, HUE LIGHTS
for(int i=0;i<3;i++)if(quickTargets[i]==16)quickTargets[i]=21;
  themeIndex=constrain(prefs.getInt("theme",0),0,3);applyTheme();startupPage=constrain(prefs.getInt("startupPage",0),0,20);
  tft.init();rotationSetup();ledcAttach(21,5000,8);ledcWrite(21,brightness*255/100);
  ui.setColorDepth(8);
  if(!ui.createSprite(W,H)){
    ui.setColorDepth(8);
    if(!ui.createSprite(W,H)){
      Serial.println("FRAMEBUFFER FAILED");
      tft.setTextColor(themeInk,themeBg);tft.drawString("Graphics memory unavailable",10,90,2);
      while(true)delay(1000);
    }
  }
  Serial.printf("FRAMEBUFFER %d BIT HEAP=%u\n",ui.getColorDepth(),ESP.getFreeHeap());
  touchBus.begin(25,39,32,33);touch.begin(touchBus);touch.setRotation(1);
  setenv("TZ",ownerTZ.c_str(),1);tzset();WiFi.mode(WIFI_STA);WiFi.setHostname("seth-orbit");WiFi.setAutoReconnect(true);WiFi.begin();companionSetup();voiceSetup();ledSetup();otaSetup();setPage(startupPage);draw();focusAt=watchAt=millis();
}
void loop(){
  uint32_t now=millis();if(focusRunning){uint32_t dt=now-focusAt;focusMs=dt>=focusMs?0:focusMs-dt;if(!focusMs)focusRunning=false;}focusAt=now;
  if(watchRunning)watchMs+=now-watchAt;watchAt=now;
  loopStep=1;touchInput();loopStep=2;commands();loopStep=3;micLoop();speakerLoop();loopStep=4;companionLoop();loopStep=5;voiceLoop();
  loopStep=6;musicLoop();loopStep=7;soundLoop();hueLoop();ledLoop();loopStep=8;pairLoop();securityLoop();loopStep=9;
  static bool lastBoot=HIGH;static uint32_t bootAt;bool boot=digitalRead(0);if(!boot&&lastBoot)bootAt=now;if(boot&&!lastBoot&&!securityLocked){if(now-bootAt>700)setPage(page>=100?returnPage:100);else tap(W/2,H/2);}lastBoot=boot;
  if(scanning){int n=WiFi.scanComplete();if(n>=0){networkText="";for(int i=0;i<min(n,4);i++){networkText+=WiFi.SSID(i).substring(0,26);if(i<min(n,4)-1)networkText+='\n';}if(!n)networkText="No networks found";WiFi.scanDelete();scanning=false;}else if(n==WIFI_SCAN_FAILED){networkText="Scan failed. Hold to retry.";scanning=false;}}
  static bool ntp=false;if(WiFi.isConnected()&&!ntp){configTime(0,0,"pool.ntp.org","time.nist.gov");setenv("TZ",ownerTZ.c_str(),1);tzset();ntp=true;}
  if(now-lastFrame>=50){lastFrame=now;loopStep=10;draw();loopStep=11;touchInput();}if(now-framesAt>=2000){fps=frames*1000.f/(now-framesAt);frames=0;framesAt=now;}delay(2);
}
