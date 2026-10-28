// Orbit Rectangular Showcase / CYD-K. Live readings, square instruments,
// 21 main screens and a separate Setup menu. No simulated voice features.
#include <Arduino.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <WiFi.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>
TFT_eSPI tft;
TFT_eSprite ui(&tft);
SPIClass touchBus(VSPI);
XPT2046_Touchscreen touch(33,36);
Preferences prefs;
const int count=21;
String ownerName="Friend",ownerTZ="EST5EDT,M3.2.0,M11.1.0";
uint32_t enabledPages=(1UL<<21)-1;
const char *names[count]={"HELLO SETH","PRISM CLOCK","SPLIT CLOCK","PC MATRIX","CPU PULSE","GPU ENGINE","THERMAL STRIP","NETWORK STREAM","MEMORY BLOCKS","STORAGE TRAFFIC","POWER DRIVE","SIX CHANNELS","TYPE CLOCK","BINARY CLOCK","FOCUS","STOPWATCH","AI DESK","MUSIC REMOTE","APP LAUNCHER","SENTRY","PRIVACY GUARD"};
const char *setupNames[]={"SETUP","BRIGHTNESS","COLORS","WI-FI STATUS","NEARBY WI-FI","DEVICE MEMORY","TOUCH TEST","AI INBOX","PC CONNECTION"};
uint16_t accents[]={0x07ff,0xf81f,0x87e0,0xfd20,0xaaff};
int page=0,returnPage=0,startupPage=0,colorIndex=0,brightness=70;
int privacyFolderCount=0,privacyBrowserCount=0;
int quickTargets[3]={17,16,18};uint32_t quickIconAt=0,mediaAt=0;bool mediaPlaying=false;
bool cameraFullscreen=false,buttonPressed=false;int pressedX=0,pressedY=0,pendingX=0,pendingY=0;uint32_t feedbackUntil=0;
bool remoteBusy();
void drawQuickIcon();
uint16_t accent=0x07ff,ink=0xef7e,muted=0x8492,panel=0x10a3;
#include "themes.h"
uint32_t lastFrame=0,frames=0,framesAt=0;float fps=0;
uint32_t focusMs=25*60000,focusAt=0,watchAt=0,watchMs=0;
bool focusRunning=false,watchRunning=false,scanning=false;
int touchX=160,touchY=120;uint32_t touchEvents=0;
String networkText="Hold SCAN to find nearby Wi-Fi";
void text(const String &s,int x,int y,int font=2,uint16_t c=themeColor(0xffff),int datum=TL_DATUM){ui.setFreeFont(nullptr);if(font==1)ui.setTextFont(1);else ui.setFreeFont(themeFont(font));ui.setTextColor(c);ui.setTextDatum(datum);ui.drawString(s,x,y);}
void big(const String &s,int x,int y,uint16_t c=themeColor(0xffff),int datum=MC_DATUM){ui.setFreeFont(themeFont(7));ui.setTextColor(c);ui.setTextDatum(datum);ui.drawString(s,x,y);ui.setFreeFont(nullptr);}
void button(const String &s,int x,int y,int w=140,bool active=true,uint16_t customBg=0){
 bool pressed=buttonPressed&&pressedX>=x&&pressedX<x+w&&pressedY>=y&&pressedY<y+34;
 bool busy=(remoteBusy()&&pendingX>=x&&pendingX<x+w&&pendingY>=y&&pendingY<y+34)||(page==104&&scanning);
 uint16_t bg=busy?0xfd20:pressed?0xffff:customBg?customBg:active?accent:panel,fg=busy||pressed?0x0000:customBg?0xffff:active?themeBg:ink;
 if(themeIndex==3){ui.fillRoundRect(x,y,w,34,7,bg);ui.drawRoundRect(x,y,w,34,7,pressed?ink:accent);}else{ui.fillRect(x,y,w,34,bg);ui.drawRect(x,y,w,34,pressed?ink:accent);if(themeIndex==2)ui.drawLine(x+w-10,y,x+w-1,y+9,fg);}
 ui.setFreeFont(themeFont(2));int labelFont=ui.textWidth(s)>w-(busy?32:14)?1:2;text(s,x+w/2-(busy?6:0),y+17,labelFont,fg,MC_DATUM);
 if(busy){int cx=x+w-13,cy=y+17;for(int i=0;i<8;i++){float a=(i+millis()/90)*PI/4;ui.fillRect(cx+int(cosf(a)*5),cy+int(sinf(a)*5),2,2,i<4?0x0000:0x7be0);}ui.fillRect(x,y+31,(millis()/12)%w,3,0x0000);}
}
void header(const String &s,const String &right=""){ui.fillRect(10,13,4,12,accent);text(s,22,10,2,ink);text(right,page<count?278:310,13,1,muted,TR_DATUM);}
const char *pageName(int n){return n>=100&&n<=108?setupNames[n-100]:names[constrain(n,0,count-1)];}
void nextPage(int direction);
void setPage(int n){if(n>=100&&n<=108){if(page<count)returnPage=page;page=n;}else page=(n%count+count)%count;ledcWrite(21,page==29?12:brightness*255/100);Serial.printf("SCREEN %d %s\n",page,pageName(page));}
void nextPage(int direction){int n=page;for(int i=0;i<count;i++){n=(n+direction+count)%count;if(enabledPages&(1UL<<n)){setPage(n);return;}}}
String clockText(){time_t now=time(nullptr);struct tm tm;localtime_r(&now,&tm);char s[24];if(now>1700000000)strftime(s,sizeof(s),"%H:%M",&tm);else snprintf(s,sizeof(s),"%02lu:%02lu",(unsigned long)(millis()/3600000),(unsigned long)(millis()/60000%60));return String(s);}
String dateText(){time_t now=time(nullptr);struct tm tm;localtime_r(&now,&tm);char s[32];if(now>1700000000)strftime(s,sizeof(s),"%a / %b %d",&tm);else strcpy(s,"SYNCING TIME");return String(s);}
int secondNow(){time_t now=time(nullptr);return now>1700000000?int(now%60):int(millis()/1000%60);}
String duration(uint32_t ms){char s[24];uint32_t sec=ms/1000;snprintf(s,sizeof(s),"%02lu:%02lu",(unsigned long)(sec/60),(unsigned long)(sec%60));return String(s);}
#include "security.h"
#include "pc_cluster.h"
#include "companion.h"
#include "showcase.h"
#include "remote.h"
void footer(){
  if(page>=100){text("BACK: TOP LEFT",10,229,1,muted);text("MAIN",310,229,1,accent,TR_DATUM);return;}
  text("",10,229,1,muted);
  for(int i=0;i<count;i++)ui.fillRect(80+i*8,230,6,i==page?5:2,i==page?accent:themeColor(0x3186));
  text(String(page+1)+"/"+String(count),310,229,1,muted,TR_DATUM);
}
void drawSetup(){
  header("");text(pageName(page),83,10,2,ink);text("< BACK",7,11,2,accent);
  if(page==100){
    const char *sub[]={"DISPLAY LEVEL","SIGNATURE COLOR","SIGNAL + ADDRESS","SCAN NETWORKS","MEMORY + FPS","LIVE INPUT","MESSAGES","PC LINK"};
    for(int i=0;i<8;i++){int x=8+(i%2)*156,y=41+(i/2)*44;ui.fillRect(x,y,148,39,buttonPressed&&pressedX>=x&&pressedX<x+148&&pressedY>=y&&pressedY<y+39?muted:themeColor(0x1083));ui.fillRect(x,y,3,39,accents[i%5]);text(setupNames[i+1],x+9,y+5,2,ink);text(sub[i],x+9,y+24,1,muted);}
  }else if(page==101){
    big(String(brightness)+"%",160,90,ink);ui.fillRect(24,149,272,18,panel);ui.fillRect(24,149,max(1,272*brightness/100),18,accent);text("DRAG OR TAP THE BAR",160,193,2,muted,MC_DATUM);
  }else if(page==102){
    big("Your palette",160,80,ink);
    for(int i=0;i<5;i++){int x=12+i*61;ui.fillRect(x,126,52,52,accents[i]);if(i==colorIndex)ui.drawRect(x-2,124,56,56,ink);}
    text("TAP A COLOR",160,201,2,muted,MC_DATUM);
  }else if(page==103||page==108){
    text(page==103?"WI-FI":"PC FEED",12,48,2,muted);big(page==103?(WiFi.isConnected()?"Online":"Offline"):(pcLive()?feedTransport:"Waiting"),160,93,pcLive()?accent:ink);
    text(WiFi.isConnected()?WiFi.SSID().substring(0,28):"Reconnecting to saved network",160,139,2,ink,MC_DATUM);
    text(WiFi.isConnected()?WiFi.localIP().toString():"--",160,171,2,muted,MC_DATUM);
    text(page==103?"SIGNAL  "+String(WiFi.RSSI())+" dBm":"USB CAN BE POWER ONLY",160,202,2,muted,MC_DATUM);
  }else if(page==104){
    int y=51,start=0;while(start<int(networkText.length())&&y<170){int end=networkText.indexOf('\n',start);if(end<0)end=networkText.length();text(networkText.substring(start,end),12,y,2,ink);start=end+1;y+=28;}
    button(scanning?"SCANNING...":"HOLD TO SCAN",70,179,180);
  }else if(page==105){
    text("FREE DEVICE MEMORY",12,49,2,muted);big(String(ESP.getFreeHeap()/1024)+" KB",160,94,accent);
    text("DISPLAY  "+String(fps,1)+" FPS",12,143,2,ink);text("UPTIME  "+duration(millis()),12,174,2,muted);text("CYD-K / ORBIT COMPANION",12,204,1,muted);
  }else if(page==106){
    for(int x=12;x<320;x+=16)for(int y=44;y<218;y+=16)ui.drawPixel(x,y,themeColor(0x3186));
    ui.drawFastHLine(0,touchY,320,accent);ui.drawFastVLine(touchX,35,182,accent);ui.drawRect(touchX-9,touchY-9,19,19,themeColor(0xf81f));text(String(touchX)+" / "+String(touchY),160,202,2,ink,MC_DATUM);
  }else if(page==107){drawCompanion();ui.fillRect(0,0,275,32,themeBg);text("< BACK",7,11,2,accent);text("AI INBOX",83,10,2,ink);}
}
void draw(){ui.fillSprite(themeBg);if(securityLocked){drawSecurity();ui.pushSprite(0,0);frames++;return;}if(page>=100)drawSetup();else if(page>=16)drawRemote();else drawShowcase(page);if(aiAttention&&(millis()/500)%2==0)ui.fillRect(304,8,6,6,themeColor(0xfd20));if(!cameraFullscreen||page!=19)footer();drawQuickIcon();ui.pushSprite(0,0);frames++;}
void tap(int x,int y){
  if(securityLocked){securityTap(x,y);return;}
  if(page==0&&x>=165&&y>=178&&y<=217){setPage(100);return;}
  if(page==20&&remoteHold(x,y))return;
  if(page==19&&remoteHold(x,y))return;
  if(page==16&&aiId.length()&&y>=190)return;
  if(page>=16&&page<=18&&remoteHold(x,y))return;
  if(page<count){nextPage(1);return;}
  if(y>=222){setPage(returnPage);return;}
  if(x<70&&y<32){if(page==100)setPage(returnPage);else setPage(100);return;}
  if(page==100){if(y>=41&&y<217){int row=(y-41)/44,col=x>=160?1:0;setPage(101+row*2+col);}return;}
  if(page==101&&y>=130&&y<=185){brightness=constrain(map(x,24,296,5,100),5,100);ledcWrite(21,brightness*255/100);prefs.putInt("brightness",brightness);return;}
  if(page==102&&y>=124&&y<=180){colorIndex=constrain((x-12)/61,0,4);applyTheme();prefs.putInt("color",colorIndex);return;}
}
bool holdControl(int x,int y){
  if(page==0&&x>=165&&y>=178&&y<=217){setPage(100);return true;}
  if((page==16||page==107)&&y>=190&&aiId.length()&&!aiExpired){aiReply=x<160?"YES":"NO";aiAttention=false;return true;}
  if(page==20&&y>=153&&y<187){requestRemote("privacy:cleanup");return true;}
  if(remoteHold(x,y))return true;
  if(page==14&&y>=178&&y<=216){if(!focusMs)focusMs=25*60000;focusRunning=!focusRunning;focusAt=millis();return true;}
  if(page==15&&y>=178&&y<=216){if(x>160){watchMs=0;watchAt=millis();}else{watchRunning=!watchRunning;watchAt=millis();}return true;}
  if(page==104&&y>=175&&!scanning){WiFi.scanNetworks(true);scanning=true;return true;}
  return false;
}
#include "touch_gesture.h"
TouchGesture gesture;
QuickTapIcon quickIcon;
void quickJump(int slot){int target=quickTargets[slot];if(target>=0&&target<count){cameraFullscreen=false;setPage(target);}}
void drawQuickIcon(){if(page>=count||securityLocked||quickTargets[0]<0)return;uint16_t c=millis()-quickIconAt<550?0xfd20:mediaPlaying&&millis()-mediaAt<10000?((millis()/500)%2?0x87e0:0x07e0):accent;ui.fillRect(284,0,36,32,panel);ui.drawRect(284,0,36,32,c);ui.fillCircle(296,22,3,c);ui.fillRect(298,9,2,13,c);ui.fillRect(298,9,10,3,c);ui.fillRect(306,10,2,9,c);ui.fillCircle(304,20,3,c);}
void touchInput(){
  bool pressed=touch.touched();int x=touchX,y=touchY;
  if(pressed){TS_Point p=touch.getPoint();pressed=p.z>=200;if(pressed){x=constrain(map(p.x,200,3700,0,319),0,319);y=constrain(map(p.y,240,3800,0,239),0,239);touchX=x;touchY=y;}}
  buttonPressed=pressed;pressedX=x;pressedY=y;if(pressed)securityLastTouch=millis();
  TouchGesture::Event event=gesture.update(pressed,x,y,millis(),page);if(event.kind==TouchGesture::NONE)return;
  if(securityLocked){quickIcon.cancel();securityTap(gesture.startX,event.startY);return;}
  if(page<count&&gesture.startX>=284&&event.startY<32&&quickTargets[0]>=0){if(event.kind==TouchGesture::TAP){quickIconAt=millis();if(quickIcon.tap(millis(),page))quickJump(0);}else quickIcon.cancel();return;}
  quickIcon.cancel();
  if(page==20&&event.kind==TouchGesture::HOLD&&holdControl(event.x,event.y))return;
  touchEvents++;Serial.printf("TOUCH %d %d KIND=%d\n",event.x,event.y,event.kind);
  if(page>=100){if(event.kind==TouchGesture::HOLD&&holdControl(event.x,event.y))return;tap(event.x,event.y);return;}
  // A contact begun on a camera control belongs to that control, even if
  // resistive-touch drift looks like a swipe. Blank taps advance normally.
  if(event.kind==TouchGesture::SWIPE_UP||event.kind==TouchGesture::SWIPE_DOWN){
    bool control=(page==0&&gesture.startX>=165&&event.startY>=178)||(page==16&&event.startY>=166)||(page==17&&event.startY>=99)||(page==18&&event.startY>=47&&event.startY<197)||((page==14||page==15)&&event.startY>=178)||(page==19&&(cameraFullscreen||event.startY>=150))||(page==20&&event.startY>=153);
    if(!control)quickJump(event.kind==TouchGesture::SWIPE_UP?1:2);return;
  }
  if(page==19&&(cameraFullscreen||event.startY>=150)&&remoteHold(gesture.startX,event.startY))return;
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
      if(line=="NEXT")tap(160,120);
      if(line.startsWith("TAP ")){int x,y;if(sscanf(line.c_str()+4,"%d %d",&x,&y)==2)tap(x,y);}
      if(line=="SECURITYTEST")Serial.println(securitySelfTest()?"SECURITYTEST PASS":"SECURITYTEST FAIL");
      if(line=="GESTURETEST")Serial.println(gestureSelfTest()?"GESTURETEST PASS":"GESTURETEST FAIL");
      if(line=="QUICKTEST")Serial.println(quickTapSelfTest()?"QUICKTEST PASS":"QUICKTEST FAIL");
      if(line.startsWith("TIME ")){struct timeval tv={};tv.tv_sec=strtoll(line.c_str()+5,nullptr,10);settimeofday(&tv,nullptr);Serial.println("TIME SET");}
      if(line.startsWith("PC ")){receivePC(line);feedTransport="USB";}
      if(line.startsWith("PAIR ")&&line.length()==37){pairKey=line.substring(5);prefs.putString("pair",pairKey);Serial.println("PAIR SAVED");}
      if(line.startsWith("WIFI\t")){int split=line.indexOf('\t',5);if(split>5){String ssid=line.substring(5,split),password=line.substring(split+1);WiFi.disconnect();WiFi.begin(ssid.c_str(),password.c_str());Serial.println("WIFI CONFIGURED");}}
      if(line=="STATUS")Serial.printf("ORBIT CYD-K DISPLAY=OK WIDTH=%d HEIGHT=%d PAGE=%d TOUCHES=%lu HEAP=%u FPS=%.1f PC_PACKETS=%lu PC_LIVE=%d CPU=%.1f RAM=%.1f GPU=%.1f TEMP=%.1f WIFI=%d IP=%s LINK=%s MAIN=21 SETUP=9\n",tft.width(),tft.height(),page,(unsigned long)touchEvents,ESP.getFreeHeap(),fps,(unsigned long)pcPackets,pcLive(),pc.cpu,pc.ram,pc.gpu,pc.temp,WiFi.isConnected(),WiFi.localIP().toString().c_str(),feedTransport.c_str());
      line="";
    }else if(line.length()<512)line+=c;
  }
}
void setup(){
  Serial.begin(115200);delay(200);Serial.println("ORBIT CYD-K BOOT");
  pinMode(0,INPUT_PULLUP);for(int pin:{4,16,17}){pinMode(pin,OUTPUT);digitalWrite(pin,HIGH);}
  prefs.begin("orbit-cyd",false);securityLoad();for(int i=0;i<3;i++)quickTargets[i]=constrain(prefs.getInt(("quick"+String(i)).c_str(),quickTargets[i]),-1,20);brightness=constrain(prefs.getInt("brightness",70),5,100);colorIndex=constrain(prefs.getInt("color",0),0,4);accent=accents[colorIndex];
  ownerName=prefs.getString("owner","Friend");ownerTZ=prefs.getString("tz",ownerTZ);enabledPages=prefs.getUInt("enabled",(1UL<<21)-1);if(!enabledPages)enabledPages=1;
  themeIndex=constrain(prefs.getInt("theme",0),0,3);applyTheme();startupPage=constrain(prefs.getInt("startupPage",0),0,20);
  tft.init();tft.setRotation(1);tft.fillScreen(themeBg);ledcAttach(21,5000,8);ledcWrite(21,brightness*255/100);
  ui.setColorDepth(8);
  if(!ui.createSprite(320,240)){
    ui.setColorDepth(8);
    if(!ui.createSprite(320,240)){
      Serial.println("FRAMEBUFFER FAILED");
      tft.setTextColor(themeInk,themeBg);tft.drawString("Graphics memory unavailable",10,90,2);
      while(true)delay(1000);
    }
  }
  Serial.printf("FRAMEBUFFER %d BIT HEAP=%u\n",ui.getColorDepth(),ESP.getFreeHeap());
  touchBus.begin(25,39,32,33);touch.begin(touchBus);touch.setRotation(1);
  setenv("TZ",ownerTZ.c_str(),1);tzset();WiFi.mode(WIFI_STA);WiFi.setHostname("seth-orbit");WiFi.setAutoReconnect(true);WiFi.begin();companionSetup();setPage(startupPage);draw();focusAt=watchAt=millis();
}
void loop(){
  uint32_t now=millis();if(focusRunning){uint32_t dt=now-focusAt;focusMs=dt>=focusMs?0:focusMs-dt;if(!focusMs)focusRunning=false;}focusAt=now;
  if(watchRunning)watchMs+=now-watchAt;watchAt=now;touchInput();commands();companionLoop();securityLoop();
  static bool lastBoot=HIGH;static uint32_t bootAt;bool boot=digitalRead(0);if(!boot&&lastBoot)bootAt=now;if(boot&&!lastBoot&&!securityLocked){if(now-bootAt>700)setPage(page>=100?returnPage:100);else tap(160,120);}lastBoot=boot;
  if(scanning){int n=WiFi.scanComplete();if(n>=0){networkText="";for(int i=0;i<min(n,4);i++){networkText+=WiFi.SSID(i).substring(0,26);if(i<min(n,4)-1)networkText+='\n';}if(!n)networkText="No networks found";WiFi.scanDelete();scanning=false;}else if(n==WIFI_SCAN_FAILED){networkText="Scan failed. Hold to retry.";scanning=false;}}
  static bool ntp=false;if(WiFi.isConnected()&&!ntp){configTime(0,0,"pool.ntp.org","time.nist.gov");setenv("TZ",ownerTZ.c_str(),1);tzset();ntp=true;}
  if(now-lastFrame>=50){lastFrame=now;draw();touchInput();}if(now-framesAt>=2000){fps=frames*1000.f/(now-framesAt);frames=0;framesAt=now;}delay(2);
}
