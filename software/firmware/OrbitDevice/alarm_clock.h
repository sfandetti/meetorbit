// ALARM CLOCK page (24): set a wake-up time with the arrows, switch it on, TEST to hear it. When it rings,
// Orbit's own speaker beeps (louder as it goes on), the LED ring flashes, and the whole screen becomes a
// shaking cartoon face yelling WAKE UP! After 30 s it gets cross. SNOOZE (9 min) or STOP. It rings for at
// most 10 minutes. The time comes from the internet (NTP), so the alarm waits until Orbit has it.
bool alarmOn=false,alarmRinging=false,alarmPreview=false;int alarmH=7,alarmM=0,alarmFiredKey=-1;
uint32_t alarmRingAt=0,alarmSnoozeAt=0;
int alarmVolPct=100,sleepVolPct=55;  // volume (5-100%) of the alarm and of the sound machine, set with the bell's slideruint32_t alarmRingAt=0,alarmSnoozeAt=0;
void alarmLoad(){alarmOn=prefs.getBool("alarmon",false);alarmH=constrain(prefs.getInt("alarmh",7),0,23);alarmM=constrain(prefs.getInt("alarmm",0),0,59);alarmVolPct=constrain(prefs.getInt("alarmpct",100),5,100);sleepVolPct=constrain(prefs.getInt("sleeppct",55),5,100);}
void alarmSave(){prefs.putBool("alarmon",alarmOn);prefs.putInt("alarmh",alarmH);prefs.putInt("alarmm",alarmM);prefs.putInt("alarmpct",alarmVolPct);prefs.putInt("sleeppct",sleepVolPct);}
// The beeping: bursts of four beeps a second at 2.0 / 2.6 kHz (where a small speaker is loudest), almost a
// square wave, from half to full volume over 20 s. Full volume stays below the top so the amp can't brown out.
void alarmFeed(void*){
 // Sound buffers are borrowed while playing and given back after: the voice needs that memory for Wi-Fi.
 int32_t *samples=(int32_t*)malloc(512*4);uint32_t phase=0,started=millis();
 if(!samples){speakerTaskHandle=nullptr;vTaskDelete(nullptr);}
 while(!speakerTaskStop&&int32_t(millis()-speakerStopAt)<0){
  float vol=(alarmPreview?1.f:min(1.f,0.5f+(millis()-started)/40000.f))*(alarmVolPct/100.f);  // the bell's slider sets the top
  for(int i=0;i<256;i++){uint32_t n=phase+i,t=n%16000,k=t/2600,in=t%2600;
   float env=k<4&&in<1600?min(1.f,min(in/80.f,(1600-in)/80.f)):0.f,f=(n/16000)%2?2600.f:2000.f;
   float s=constrain(sinf(n*2.f*PI*f/16000.f)*3.f,-1.f,1.f);  // squared off: harsher, louder
   int32_t v=int32_t(s*22000.f*vol*env)*65536;samples[i*2]=v;samples[i*2+1]=v;}
  size_t written=0;if(i2s_channel_write(speakerTx,samples,512*4,&written,100)!=ESP_OK&&!written)break;phase+=written/8;
 }
 free(samples);speakerTaskHandle=nullptr;vTaskDelete(nullptr);
}
// Everything else using the audio port stops first (the visualizer or Music Link mic, a voice turn).
bool alarmSoundStart(){
 soundStop();micStop();speakerStop();
 if(voiceRx||voiceTx){voiceMicClose();voicePlayStop();if(voiceState!=V_OFF&&voiceState!=V_CONNECTING)voiceState=V_IDLE;}
 i2s_chan_config_t ch=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);ch.dma_desc_num=4;ch.dma_frame_num=128;
 if(i2s_new_channel(&ch,&speakerTx,nullptr)!=ESP_OK){speakerTx=nullptr;return false;}
 i2s_std_config_t cfg={};cfg.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(16000);
 cfg.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO);
 cfg.gpio_cfg.mclk=I2S_GPIO_UNUSED;cfg.gpio_cfg.bclk=GPIO_NUM_22;cfg.gpio_cfg.ws=GPIO_NUM_27;cfg.gpio_cfg.dout=GPIO_NUM_4;cfg.gpio_cfg.din=I2S_GPIO_UNUSED;
 if(i2s_channel_init_std_mode(speakerTx,&cfg)!=ESP_OK||i2s_channel_enable(speakerTx)!=ESP_OK){i2s_del_channel(speakerTx);speakerTx=nullptr;return false;}
 speakerTaskStop=false;speakerStopAt=millis()+(alarmPreview?1000:600000);
 if(xTaskCreate(alarmFeed,"alarm",4096,nullptr,3,&speakerTaskHandle)!=pdPASS){speakerTaskHandle=nullptr;speakerStop();return false;}
 return true;
}
// A second of beeps at the alarm's volume (after the slider is let go).
void alarmPreviewBeep(){alarmPreview=true;alarmSoundStart();alarmPreview=false;}
void alarmRing(){alarmPreview=false;alarmRinging=true;alarmRingAt=millis();alarmSoundStart();ledDirty=true;Serial.println("ALARM RINGING");}
void alarmQuiet(){alarmRinging=false;speakerStop();ledDirty=true;}
// Every loop: ring at the set minute (once), or when a snooze runs out; end after the 10 minutes of sound.
void alarmLoop(){
 if(alarmRinging){if(!speakerTx&&!speakerTaskHandle&&millis()-alarmRingAt>2000)alarmRinging=false;return;}
 if(alarmSnoozeAt&&int32_t(millis()-alarmSnoozeAt)>=0){alarmSnoozeAt=0;alarmRing();return;}
 time_t now=time(nullptr);if(!alarmOn||now<1700000000)return;
 struct tm tm;localtime_r(&now,&tm);int key=tm.tm_yday*1440+tm.tm_hour*60+tm.tm_min;
 if(tm.tm_hour==alarmH&&tm.tm_min==alarmM&&key!=alarmFiredKey){alarmFiredKey=key;alarmRing();}
}
// ---- The ALARM CLOCK page ----
String alarm12(int h){int x=h%12;return String(x?x:12);}
String alarmTimeText(){char s[12];snprintf(s,sizeof(s),"%s:%02d %s",alarm12(alarmH).c_str(),alarmM,alarmH<12?"AM":"PM");return String(s);}
int alarmCx(){return W/2;}int alarmHourX(){return W/2-(tall()?56:62);}int alarmMinX(){return W/2+(tall()?56:62);}
int alarmUpY(){return tall()?66:40;}int alarmDownY(){return tall()?166:124;}int alarmArrowH(){return tall()?30:26;}int alarmTimeY(){return tall()?128:93;}
int alarmKeysY(){return tall()?210:160;}
// Arrow 0 hour up, 1 hour down, 2 minute up, 3 minute down; -1 none.
int alarmArrowAt(int x,int y){
 int col=abs(x-alarmHourX())<40?0:abs(x-alarmMinX())<40?1:-1;if(col<0)return -1;
 if(y>=alarmUpY()-4&&y<alarmUpY()+alarmArrowH()+4)return col*2;
 if(y>=alarmDownY()-4&&y<alarmDownY()+alarmArrowH()+4)return col*2+1;
 return -1;
}
void alarmStep(int a){if(a==0)alarmH=(alarmH+1)%24;if(a==1)alarmH=(alarmH+23)%24;if(a==2)alarmM=(alarmM+1)%60;if(a==3)alarmM=(alarmM+59)%60;alarmFiredKey=-1;}
void alarmArrow(int cx,int y,bool up,bool pressed){
 int w=76,h=alarmArrowH();ui.fillRect(cx-w/2,y,w,h,pressed?accent:panel);ui.drawRect(cx-w/2,y,w,h,accent);uint16_t c=pressed?themeBg:accent;
 int my=y+h/2;if(up)ui.fillTriangle(cx-10,my+5,cx+10,my+5,cx,my-6,c);else ui.fillTriangle(cx-10,my-5,cx+10,my-5,cx,my+6,c);
}
String alarmCountdown(){
 time_t now=time(nullptr);if(now<1700000000)return "Waiting for the time from Wi-Fi";
 struct tm tm;localtime_r(&now,&tm);int mins=(alarmH*60+alarmM)-(tm.tm_hour*60+tm.tm_min);if(mins<=0)mins+=1440;
 return "Rings in "+(mins>=60?String(mins/60)+" h ":String(""))+String(mins%60)+" min";
}
// The volume key: a bell with one to three sound waves beside it (how loud: up to a third, two thirds, more).
void alarmBell(int x,int y,int w,int pct){int waves=1+(pct>33)+(pct>66);
 bool pressed=buttonPressed&&pressedX>=x&&pressedX<x+w&&pressedY>=y&&pressedY<y+34;uint16_t c=pressed?themeBg:accent;
 ui.fillRect(x,y,w,34,pressed?accent:panel);ui.drawRect(x,y,w,34,accent);
 int bx=x+w/2-12,by=y+17;  // the bell
 ui.fillCircle(bx,by-4,7,c);ui.fillRect(bx-7,by-4,15,9,c);ui.fillRect(bx-10,by+4,21,3,c);ui.fillCircle(bx,by+9,3,c);ui.fillRect(bx-1,by-13,3,3,c);
 for(int k=0;k<3;k++){int r=7+k*5;uint16_t wc=k<waves?c:(pressed?themeBg:themeColor(0x3186));  // the waves
  for(int a=-50;a<=50;a+=6){float t=a*PI/180;ui.fillRect(bx+12+int(cosf(t)*r)-1,by-2+int(sinf(t)*r)-1,2,2,wc);}}
}
// ---- The volume pop-up: tap a bell and a slider opens just above it; slide to set; tap the bell (or
// anywhere else) to close. Letting go of the slider plays a short sample at the new level.
int volPopup=0;  // 0 closed, 1 the alarm's (page 24), 2 the sound machine's (page 25)
int sleepKeysY();
int volPopupY(){return volPopup==1?(tall()?alarmKeysY()+46:alarmKeysY())-52:sleepKeysY()-52;}
int &volPopupPct(){return volPopup==1?alarmVolPct:sleepVolPct;}
bool volBarAt(int x,int y){return volPopup&&x>=8&&x<W-8&&y>=volPopupY()&&y<volPopupY()+46;}
void drawVolPopup(){
 int y=volPopupY(),pct=volPopupPct(),bx=18,bw=W-36-52;  // the bar, with the percentage to its right
 ui.fillRect(8,y,W-16,46,themeBg);ui.drawRect(8,y,W-16,46,accent);ui.drawRect(9,y+1,W-18,44,accent);
 ui.fillRect(bx,y+10,bw,26,panel);ui.drawRect(bx,y+10,bw,26,accent);ui.fillRect(bx+2,y+12,(bw-4)*pct/100,22,accent);
 text(String(pct)+"%",W-18,y+23,2,ink,MR_DATUM);
}
bool alarmVolPreviewSleep();  // sleep_sounds.h
// A tap while the pop-up is open: on the slider it belongs to the slider; anywhere but the bell closes it.
bool volPopupTap(int which,int x,int y){
 if(volPopup!=which)return false;
 if(volBarAt(x,y))return true;
 int bx,bw,by;if(which==1){by=tall()?alarmKeysY()+46:alarmKeysY();bx=tall()?158:166;bw=tall()?72:62;}else{by=sleepKeysY();bx=tall()?102:144;bw=60;}
 if(x>=bx&&x<bx+bw&&y>=by&&y<by+34)return false;  // the bell itself: its own tap closes it
 volPopup=0;return true;
}
void volPopupLoop(){
 static bool dragging=false;
 if((volPopup==1&&page!=24)||(volPopup==2&&page!=25)||alarmRinging){volPopup=0;dragging=false;}
 bool pen=digitalRead(36)==LOW&&buttonPressed;
 if(volPopup&&pen&&volBarAt(pressedX,pressedY)){volPopupPct()=constrain(map(pressedX,20,W-72,5,100),5,100);dragging=true;}
 else if(dragging&&!pen){dragging=false;alarmSave();if(volPopup==1)alarmPreviewBeep();else alarmVolPreviewSleep();}
}
void drawAlarm(){
 header("ALARM CLOCK",alarmOn?"ON":"OFF");
 int pressedArrow=buttonPressed?alarmArrowAt(pressedX,pressedY):-1;
 alarmArrow(alarmHourX(),alarmUpY(),true,pressedArrow==0);alarmArrow(alarmMinX(),alarmUpY(),true,pressedArrow==2);
 alarmArrow(alarmHourX(),alarmDownY(),false,pressedArrow==1);alarmArrow(alarmMinX(),alarmDownY(),false,pressedArrow==3);
 uint16_t c=alarmOn?accent:muted;char mm[4];snprintf(mm,sizeof(mm),"%02d",alarmM);
 text(alarm12(alarmH),alarmHourX(),alarmTimeY(),7,c,MC_DATUM);text(mm,alarmMinX(),alarmTimeY(),7,c,MC_DATUM);
 ui.fillRect(alarmCx()-3,alarmTimeY()-12,6,6,c);ui.fillRect(alarmCx()-3,alarmTimeY()+6,6,6,c);
 text(alarmH<12?"AM":"PM",alarmCx(),alarmTimeY()+(tall()?26:24),2,c,MC_DATUM);
 int y=alarmKeysY();
 if(tall()){button(alarmOn?"ALARM ON":"ALARM OFF",10,y,W-20,alarmOn);button("TEST",10,y+46,140,false);alarmBell(158,y+46,72,alarmVolPct);text(alarmOn?alarmCountdown():"Tap ALARM OFF to switch it on",W/2,y+92,1,muted,MC_DATUM);}
 else{button(alarmOn?"ALARM ON":"ALARM OFF",10,y,150,alarmOn);alarmBell(166,y,62,alarmVolPct);button("TEST",234,y,76,false);text(alarmOn?alarmCountdown():"Tap ALARM OFF to switch it on",W/2,y+48,1,muted,MC_DATUM);}
 if(volPopup==1)drawVolPopup();
}
// Taps on the page: an arrow steps once (holding repeats, in alarmTouchLoop), ON/OFF and TEST.
bool alarmRepeated=false;  // the held arrow already stepped while held: its release is not another step
bool alarmTap(int x,int y){
 if(volPopupTap(1,x,y))return true;
 int a=alarmArrowAt(x,y);if(a>=0){if(!alarmRepeated){alarmStep(a);alarmSave();}alarmRepeated=false;return true;}
 int ky=alarmKeysY();
 if(tall()){if(y>=ky&&y<ky+34){alarmOn=!alarmOn;alarmFiredKey=-1;alarmSave();return true;}if(y>=ky+46&&y<ky+80){if(x<154)alarmRing();else volPopup=volPopup==1?0:1;return true;}}
 else if(y>=ky&&y<ky+34){if(x<163){alarmOn=!alarmOn;alarmFiredKey=-1;alarmSave();}else if(x<231)volPopup=volPopup==1?0:1;else alarmRing();return true;}
 return false;
}
bool alarmOwnsTouch(int x,int y){return (page==24&&alarmArrowAt(x,y)>=0)||volBarAt(x,y);}  // also the volume slider
// Arrows held for half a second repeat every 120 ms (saved on release); a plain tap steps in alarmTap.
void alarmTouchLoop(){
 static bool down=false;static uint32_t downAt=0,stepAt=0;static int which=-1;
 bool pen=digitalRead(36)==LOW&&buttonPressed;
 if(page==24&&!alarmRinging&&pen){
  int a=alarmArrowAt(pressedX,pressedY);
  if(!down){down=true;downAt=millis();which=a;alarmRepeated=false;}
  else if(which>=0&&a==which&&millis()-downAt>500&&millis()-stepAt>120){alarmStep(a);stepAt=millis();alarmRepeated=true;}
 }else if(down&&!pen){down=false;if(alarmRepeated)alarmSave();which=-1;}
}
// ---- Ringing: the face takes over the whole screen ----
const char *alarmWords[]={"WAKE UP!","HEY!!","RISE & SHINE!","WAAAKE UP!","IT'S TIME!","UP UP UP!","GOOD MORNING!","BEEP BEEP!"};
const char *alarmCross[]={"I'M SERIOUS!","GET UP!!!","NOW!!!","WAKE UP!!!","HELLOOO?!"};
int alarmBtnY(){return tall()?262:188;}int alarmBtnH(){return tall()?48:44;}
void drawAlarmRing(){
 uint32_t now=millis(),t=now-alarmRingAt;bool flash=(now/250)%2,cross=t>30000;
 ui.fillSprite(cross?(flash?ui.color565(255,40,40):ui.color565(150,0,0)):(flash?ui.color565(255,225,40):ui.color565(255,150,30)));
 int shake=cross?6:3,cx=W/2+random(-shake,shake+1),cy=(tall()?132:102)+random(-shake,shake+1);
 int er=tall()?34:27,ex=tall()?50:52,ey=cy-22;
 // Eyes: wide and white, pupils darting; eyebrows tilt in when it gets cross.
 for(int s=-1;s<=1;s+=2){int x=cx+s*ex;ui.fillCircle(x,ey,er,TFT_WHITE);ui.drawCircle(x,ey,er,TFT_BLACK);ui.drawCircle(x,ey,er-1,TFT_BLACK);
  ui.fillCircle(x+random(-er/3,er/3+1),ey+random(-er/3,er/3+1),er/3,TFT_BLACK);
  int by=ey-er-10,tilt=cross?12:-5;for(int k=0;k<5;k++)ui.drawLine(x+s*er,by+k,x-s*er,by+tilt+k,TFT_BLACK);}  // inner ends down: cross
 // The mouth: wide open and yelling, opening and closing.
 int mw=tall()?44:42,mh=(tall()?22:18)+((now/120)%2)*8,my=cy+(tall()?42:36);
 ui.fillEllipse(cx,my,mw,mh,TFT_BLACK);ui.fillEllipse(cx,my+mh-8,mw/2,7,ui.color565(255,70,90));
 for(int k=-2;k<=2;k++)ui.fillRect(cx+k*14-5,my-mh+2,10,7,TFT_WHITE);  // teeth
 const char *word=cross?alarmCross[(now/700)%5]:alarmWords[(now/700)%8];
 text(word,W/2+random(-2,3),tall()?28:18,4,TFT_BLACK,MC_DATUM);
 text(clockText(),W/2,tall()?240:176,2,TFT_BLACK,MC_DATUM);
 int y=alarmBtnY(),h=alarmBtnH(),w=(W-30)/2;
 ui.fillRect(10,y,w,h,TFT_WHITE);ui.drawRect(10,y,w,h,TFT_BLACK);text("SNOOZE 9",10+w/2,y+h/2,2,TFT_BLACK,MC_DATUM);
 ui.fillRect(W-10-w,y,w,h,TFT_BLACK);text("STOP",W-10-w/2,y+h/2,4,TFT_WHITE,MC_DATUM);
}
void alarmRingTap(int x,int y){
 if(y<alarmBtnY()-6)return;
 if(x<W/2)alarmSnoozeAt=millis()+9*60000;
 alarmQuiet();Serial.println(x<W/2?"ALARM SNOOZE":"ALARM STOP");
}
// The LED ring while ringing: the whole ring flashes, white and red.
bool alarmLedFrame(uint8_t px[][3]){
 if(!alarmRinging)return false;bool on=(millis()/250)%2;
 for(int i=0;i<LED_COUNT;i++){px[i][0]=255;px[i][1]=on?255:0;px[i][2]=on?255:0;}return true;
}
