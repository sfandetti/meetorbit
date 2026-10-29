// Blue ring LEDs: two 4-LED WS2812-style strips chained (8 LEDs). Data comes from one of the free
// LED1 pads (GPIO16 or GPIO17; which pad is which is unverified), so both pins carry the same
// signal until LED PIN picks one. Brightness is capped to spare the battery and the 2 A boost board.
// The LIGHT SHOW page (22) picks an effect, colour, brightness and speed; voice states still override.
// The data signal is bit-banged with the CPU cycle counter rather than the RMT peripheral: the RMT
// driver's ~1.9 KB of IRAM is what Bluetooth speaker mode needs to fit.
#include "esp_cpu.h"
#include "soc/gpio_reg.h"
const int LED_COUNT=8,LED_CAP=60;  // percent of full scale at brightness 100
const int ledPins[2]={16,17};
bool ledOn=true,ledActive[2]={false,false};int ledBright=65,ledPinMask=3,ledEffect=0,ledSpeed=1;
uint8_t ledRGB[3]={30,110,255};
uint32_t ledFrameAt=0,ledTestUntil=0,ledPinTestUntil=0;bool ledDirty=true,ledPinTest=false;
portMUX_TYPE ledMux=portMUX_INITIALIZER_UNLOCKED;
uint8_t ledShown[LED_COUNT][3];  // last frame sent, for the on-screen preview
const int LED_EFFECTS=12;
const char *ledEffectNames[LED_EFFECTS]={"SOLID","BREATHE","RAINBOW","SPIN","COMET","THEATER","SPARKLE","FIRE","POLICE","OCEAN","HEARTBEAT","PARTY"};
bool soundLedFrame(uint8_t px[][3]);  // sound_waves.h
bool alarmLedFrame(uint8_t px[][3]);  // alarm_clock.h
bool swLedFrame(uint8_t px[][3]);  // orbit_sweep.h
bool runLedFrame(uint8_t px[][3]);  // orbit_run.h
const char *ledSpeedNames[3]={"SLOW","MEDIUM","FAST"};
const uint8_t ledSwatches[9][3]={{255,0,0},{255,90,0},{255,200,0},{0,255,40},{0,220,255},{30,110,255},{150,40,255},{255,40,160},{255,255,255}};

// Data pins idle LOW (the WS2812 reset level); an unused candidate pin is held HIGH so the board's
// own LED1 channel on it stays dark.
// The data pins use the weakest drive: slower edges leak far less into the speaker amp's I2S wires next to
// them (at full drive every ring update was heard as a faint crackle while sound played).
void ledAttach(){
 for(int p=0;p<2;p++){ledActive[p]=ledPinMask&(1<<p);pinMode(ledPins[p],OUTPUT);gpio_set_drive_capability((gpio_num_t)ledPins[p],GPIO_DRIVE_CAP_0);digitalWrite(ledPins[p],ledActive[p]?LOW:HIGH);}
}
// GRB order, 1.25 us bits: 0 = 0.4 us high, 1 = 0.8 us high. Both active pins are driven together.
// Interrupts are off for ~0.25 ms per frame; a first pass with no pins selected loads the loop into
// the flash cache so the real pass keeps exact timing.
void ledWrite(uint8_t px[][3]){
 uint8_t data[LED_COUNT*3];
 for(int i=0;i<LED_COUNT;i++){memcpy(ledShown[i],px[i],3);data[i*3]=px[i][1];data[i*3+1]=px[i][0];data[i*3+2]=px[i][2];}
 uint32_t mask=0;for(int p=0;p<2;p++)if(ledActive[p])mask|=1UL<<ledPins[p];
 const uint32_t mhz=ESP.getCpuFreqMHz(),t0=mhz*2/5,t1=mhz*4/5,period=mhz*5/4;
 for(int pass=0;pass<2;pass++){
  uint32_t m=pass?mask:0;
  portENTER_CRITICAL(&ledMux);
  uint32_t start=esp_cpu_get_cycle_count();
  for(int i=0;i<LED_COUNT*3;i++)for(int b=7;b>=0;b--){
   uint32_t high=data[i]>>b&1?t1:t0;
   while(esp_cpu_get_cycle_count()-start<period){}
   start=esp_cpu_get_cycle_count();REG_WRITE(GPIO_OUT_W1TS_REG,m);
   while(esp_cpu_get_cycle_count()-start<high){}
   REG_WRITE(GPIO_OUT_W1TC_REG,m);
  }
  portEXIT_CRITICAL(&ledMux);
 }
}
// Settings changed on Orbit itself are reported to the laptop so the dashboard stays in sync.
void ledSave(bool fromOrbit=false){
 prefs.putBool("ledon",ledOn);prefs.putInt("ledbr",ledBright);prefs.putUInt("ledrgb",(ledRGB[0]<<16)|(ledRGB[1]<<8)|ledRGB[2]);prefs.putInt("ledpin",ledPinMask);
 prefs.putInt("ledfx",ledEffect);prefs.putInt("ledspd",ledSpeed);ledDirty=true;
 if(fromOrbit){char json[140];snprintf(json,sizeof(json),"{\"type\":\"leds-state\",\"on\":%s,\"brightness\":%d,\"color\":\"#%02x%02x%02x\",\"effect\":%d,\"speed\":%d}",ledOn?"true":"false",ledBright,ledRGB[0],ledRGB[1],ledRGB[2],ledEffect,ledSpeed);laptopSend(json);}
}
void ledSetup(){
 ledOn=prefs.getBool("ledon",true);ledBright=constrain(prefs.getInt("ledbr",65),0,100);ledPinMask=constrain(prefs.getInt("ledpin",3),1,3);
 ledEffect=constrain(prefs.getInt("ledfx",0),0,LED_EFFECTS-1);ledSpeed=constrain(prefs.getInt("ledspd",1),0,2);
 uint32_t c=prefs.getUInt("ledrgb",(30<<16)|(110<<8)|255);ledRGB[0]=c>>16;ledRGB[1]=c>>8;ledRGB[2]=c;
 ledAttach();
}
// Hue 0-255 around the colour wheel to full-brightness RGB.
void ledHue(uint8_t h,uint8_t out[3]){
 uint8_t region=h/43,rem=(h-region*43)*6;uint8_t q=255-rem,t=rem;
 switch(region){case 0:out[0]=255;out[1]=t;out[2]=0;break;case 1:out[0]=q;out[1]=255;out[2]=0;break;case 2:out[0]=0;out[1]=255;out[2]=t;break;
  case 3:out[0]=0;out[1]=q;out[2]=255;break;case 4:out[0]=t;out[1]=0;out[2]=255;break;default:out[0]=255;out[1]=0;out[2]=q;}
}
void ledScale(uint8_t px[3],const uint8_t c[3],float k){for(int j=0;j<3;j++)px[j]=uint8_t(constrain(c[j]*k,0.f,255.f));}
// One frame of the chosen effect at full brightness (the caller applies the brightness cap).
// t is effect time in ms, scaled by the speed setting. Returns false for a static effect.
bool ledEffectFrame(uint8_t px[][3],uint32_t t){
 static uint8_t spark[LED_COUNT],party[LED_COUNT][3];static uint32_t partyAt=0;
 const uint8_t *c=ledRGB;
 switch(ledEffect){
  case 0:for(int i=0;i<LED_COUNT;i++)ledScale(px[i],c,1);return false;                                         // SOLID
  case 1:{float k=0.15f+0.85f*(0.5f+0.5f*sinf(t*0.003f));for(int i=0;i<LED_COUNT;i++)ledScale(px[i],c,k);return true;}  // BREATHE
  case 2:for(int i=0;i<LED_COUNT;i++)ledHue(t/12,px[i]);return true;                                           // RAINBOW
  case 3:for(int i=0;i<LED_COUNT;i++)ledHue(t/8+i*32,px[i]);return true;                                       // SPIN
  case 4:{float head=fmodf(t*0.006f,LED_COUNT);for(int i=0;i<LED_COUNT;i++){float d=fmodf(head-i+LED_COUNT,LED_COUNT);ledScale(px[i],c,d<1?1:powf(0.45f,d));}return true;}  // COMET
  case 5:{int step=(t/180)%3;for(int i=0;i<LED_COUNT;i++)ledScale(px[i],c,i%3==step?1:0.04f);return true;}    // THEATER
  case 6:for(int i=0;i<LED_COUNT;i++){if(spark[i]<20&&random(100)<4)spark[i]=255;else spark[i]=spark[i]*7/8;    // SPARKLE
          for(int j=0;j<3;j++)px[i][j]=max<int>(c[j]/6,spark[i]);}return true;
  case 7:for(int i=0;i<LED_COUNT;i++){int heat=150+random(105),g=random(heat/3);px[i][0]=heat;px[i][1]=g;px[i][2]=0;}return true;  // FIRE
  case 8:{bool phase=(t/120)%8<4;bool flash=(t/60)%2;for(int i=0;i<LED_COUNT;i++){bool red=(i<4)==phase;   // POLICE
          px[i][0]=red&&flash?255:0;px[i][1]=0;px[i][2]=!red&&flash?255:0;}return true;}
  case 9:for(int i=0;i<LED_COUNT;i++){float w=0.5f+0.5f*sinf(t*0.002f+i*0.8f);px[i][0]=0;px[i][1]=uint8_t(60+140*w);px[i][2]=uint8_t(150+105*(1-w));}return true;  // OCEAN
  case 10:{uint32_t b=t%1400;float k=b<120?1:b<260?0.25f:b<380?0.85f:0.1f;for(int i=0;i<LED_COUNT;i++)ledScale(px[i],c,k);return true;}  // HEARTBEAT
  default:if(t-partyAt>350||t<partyAt){partyAt=t;for(int i=0;i<LED_COUNT;i++)ledHue(random(256),party[i]);}     // PARTY
          for(int i=0;i<LED_COUNT;i++)memcpy(px[i],party[i],3);return true;
 }
}
// LIGHT SHOW layout, lying down or standing up. Effects: 3 columns x 4 rows; then 9 colour swatches;
// then the brightness bar with SPEED beside it (lying down) or below it (standing up).
int fxW(){return tall()?74:100;}int fxH(){return tall()?28:26;}int fxX(int i){return 6+(i%3)*(fxW()+4);}int fxY(int i){return (tall()?62:38)+(i/3)*(fxH()+3);}
int swX(int i){return tall()?6+i*26:6+i*34;}int swW(){return tall()?22:30;}int swY(){return tall()?190:156;}
int lightBarY(){return tall()?230:192;}int lightBarW(){return tall()?228:150;}
bool lightBarAt(int x,int y){return y>=lightBarY()-2&&y<lightBarY()+36&&x<6+lightBarW();}
int speedX(){return tall()?6:162;}int speedY(){return tall()?270:192;}int speedW(){return tall()?112:74;}
int powerX(){return tall()?122:240;}int powerW(){return tall()?112:74;}  // the ON/OFF key beside SPEED
// Brightness bar on the LIGHT SHOW page: slide along it; saved when you let go.
void ledSliderLoop(){
 static uint32_t touchAt=0;static bool dragging=false;
 if(page==22&&digitalRead(36)==LOW&&buttonPressed&&lightBarAt(pressedX,pressedY)){int v=constrain(map(pressedX,10,lightBarW(),0,100),0,100);if(v!=ledBright){ledBright=v;ledDirty=true;}dragging=true;touchAt=millis();}
 else if(dragging&&millis()-touchAt>300){dragging=false;ledSave(true);}
}
// Animate with the voice state: pulse with your voice while listening, breathe while thinking.
void ledLoop(){
 ledSliderLoop();
 uint32_t now=millis();if(now-ledFrameAt<30)return;ledFrameAt=now;
 if(ledPinTest){if(int32_t(now-ledPinTestUntil)<0)return;ledPinTest=false;ledAttach();ledDirty=true;Serial.println("LED PINTEST DONE");}
 static uint8_t px[LED_COUNT][3];
 if(int32_t(now-ledTestUntil)<0){for(int i=0;i<LED_COUNT;i++){ledHue(i*32+now/8,px[i]);for(int j=0;j<3;j++)px[i][j]/=3;}ledWrite(px);ledDirty=true;return;}  // LED TEST
 float level=ledOn?ledBright/100.f*LED_CAP/100.f:0;bool animating=false;
 if(!ledOn){if(!ledDirty)return;memset(px,0,sizeof(px));ledWrite(px);ledDirty=false;return;}
 // Voice: pulse with your voice while listening, breathe while thinking, flash with every syllable Orbit
 // speaks. The reply's mood picks the colour (red when grumpy).
 static float speech=0;speech+=(min(1.f,voiceOutPeak/9000.f)-speech)*0.7f;
 if(voiceState==V_LISTENING){level*=0.45f+0.55f*min(1.f,voicePeak/9000.f);animating=true;}
 else if(voiceState==V_THINKING){level*=0.35f+0.65f*(0.5f+0.5f*sinf(now*0.006f));animating=true;}
 else if(voiceState==V_SPEAKING){level*=0.12f+1.1f*speech;animating=true;}
 static const float speeds[3]={0.5f,1.f,2.f};static float effectT=0;static uint32_t lastAt=0;
 effectT+=(now-lastAt)*speeds[ledSpeed];lastAt=now;
 uint8_t mood[3];const uint8_t *colour=moodColor(mood)?mood:ledRGB;
 if(animating){for(int i=0;i<LED_COUNT;i++)ledScale(px[i],colour,1);}
 else if(alarmLedFrame(px))animating=true;
 else if(swLedFrame(px))animating=true;  // ORBIT SWEEP effects
 else if(runLedFrame(px))animating=true;  // ORBIT RUN: speed, fuel, crash  // ALARM ringing: the ring flashes
 else if(soundLedFrame(px))animating=true;  // SOUND WAVES page: the ring bounces to the room
 else animating=ledEffectFrame(px,uint32_t(effectT));
 if(!animating&&!ledDirty)return;
 for(int i=0;i<LED_COUNT;i++)for(int c=0;c<3;c++)px[i][c]=min(255,int(px[i][c]*level));
 ledWrite(px);ledDirty=false;
}
// LIGHT SHOW page: effect grid, colour swatches, brightness bar and speed button.
void drawLights(){
 header("LIGHT SHOW");
 for(int i=0;i<LED_COUNT;i++){uint8_t *p=ledShown[i];int m=max(max(p[0],p[1]),p[2]);float k=m?255.f/m:0;  // preview, normalised so dim LEDs stay visible
  uint16_t col=m?ui.color565(uint8_t(p[0]*k),uint8_t(p[1]*k),uint8_t(p[2]*k)):themeColor(0x2104);if(tall())ui.fillCircle(46+i*11,17,4,col);else ui.fillCircle(156+i*7,17,3,col);}
 for(int i=0;i<LED_EFFECTS;i++){int x=fxX(i),y=fxY(i),w=fxW(),h=fxH();bool sel=i==ledEffect&&ledOn;
  ui.fillRect(x,y,w,h,sel?accent:panel);ui.drawRect(x,y,w,h,accent);ui.setFreeFont(themeFont(2));text(ledEffectNames[i],x+w/2,y+h/2,ui.textWidth(ledEffectNames[i])>w-6?1:2,sel?themeBg:ink,MC_DATUM);}
 for(int i=0;i<9;i++){int x=swX(i),w=swW();ui.fillRect(x,swY(),w,28,ui.color565(ledSwatches[i][0],ledSwatches[i][1],ledSwatches[i][2]));
  if(memcmp(ledSwatches[i],ledRGB,3)==0)ui.drawRect(x-2,swY()-2,w+4,32,ink);}
 int by=lightBarY(),bw=lightBarW();
 ui.fillRect(6,by,bw,34,panel);ui.drawRect(6,by,bw,34,accent);if(ledBright)ui.fillRect(8,by+2,(bw-4)*ledBright/100,30,accent);
 text(ledOn?"BRIGHT "+String(ledBright)+"%":"LIGHTS OFF",6+bw/2,by+17,2,ledBright>50?themeBg:ink,MC_DATUM);
 ui.fillRect(speedX(),speedY(),speedW(),34,panel);ui.drawRect(speedX(),speedY(),speedW(),34,accent);text(String("SPEED ")+ledSpeedNames[ledSpeed],speedX()+speedW()/2,speedY()+17,tall()?2:1,ink,MC_DATUM);
 uint16_t offRed=ui.color565(200,40,40);ui.fillRect(powerX(),speedY(),powerW(),34,ledOn?panel:offRed);ui.drawRect(powerX(),speedY(),powerW(),34,ledOn?accent:offRed);
 text(ledOn?"TURN OFF":"LIGHTS OFF",powerX()+powerW()/2,speedY()+17,tall()?2:1,ledOn?ink:0xffff,MC_DATUM);
}
// A tap on the LIGHT SHOW page. Tapping the selected effect again turns the lights off/on.
void lightTap(int x,int y){
 if(y>=fxY(0)&&y<swY()-2){int col=constrain((x-6)/(fxW()+4),0,2),row=(y-fxY(0))/(fxH()+3),i=row*3+col;if(i<LED_EFFECTS){if(i==ledEffect)ledOn=!ledOn;else{ledEffect=i;ledOn=true;}}}
 else if(y>=swY()-2&&y<swY()+32){int i=constrain((x-6)/(swX(1)-swX(0)),0,8);memcpy(ledRGB,ledSwatches[i],3);ledOn=true;}
 else if(y>=speedY()-2&&y<speedY()+36&&x>=powerX()-2)ledOn=!ledOn;  // the ON/OFF key
 else if(y>=speedY()-2&&y<speedY()+36&&x>=speedX()-2)ledSpeed=(ledSpeed+1)%3;
 else return;
 ledSave(true);
}
// From the laptop's device link: {"type":"leds","on":true,"brightness":65,"color":"#1e6eff","effect":0,"speed":1}
int jsonInt(const char *j,const char *name,int fallback){String key=String("\"")+name+"\":";const char *p=strstr(j,key.c_str());return p?atoi(p+key.length()):fallback;}
void ledFromJson(const char *j,size_t len){
 String on=String("\"on\":");const char *p=strstr(j,on.c_str());if(p)ledOn=strncmp(p+on.length(),"true",4)==0;
 ledBright=constrain(jsonInt(j,"brightness",ledBright),0,100);
 ledEffect=constrain(jsonInt(j,"effect",ledEffect),0,LED_EFFECTS-1);ledSpeed=constrain(jsonInt(j,"speed",ledSpeed),0,2);
 String color=jsonField(j,len,"color");
 if(color.length()==7&&color[0]=='#'){uint32_t c=strtoul(color.c_str()+1,nullptr,16);ledRGB[0]=c>>16;ledRGB[1]=c>>8;ledRGB[2]=c;}
 ledSave();Serial.printf("LED ON=%d BRIGHT=%d COLOR=%d,%d,%d FX=%d PINS=%d\n",ledOn,ledBright,ledRGB[0],ledRGB[1],ledRGB[2],ledEffect,ledPinMask);
}
// Serial: LED ON | LED OFF | LED BRIGHT n | LED COLOR r g b | LED FX n | LED TEST | LED PIN 16|17|BOTH | LED PINTEST
void ledCommand(const String &line){
 int r,g,b,v;
 if(line=="LED ON"){ledOn=true;ledSave(true);}
 else if(line=="LED OFF"){ledOn=false;ledSave(true);}
 else if(sscanf(line.c_str(),"LED BRIGHT %d",&v)==1){ledBright=constrain(v,0,100);ledSave(true);}
 else if(sscanf(line.c_str(),"LED COLOR %d %d %d",&r,&g,&b)==3){ledRGB[0]=constrain(r,0,255);ledRGB[1]=constrain(g,0,255);ledRGB[2]=constrain(b,0,255);ledSave(true);}
 else if(sscanf(line.c_str(),"LED FX %d",&v)==1){ledEffect=constrain(v,0,LED_EFFECTS-1);ledSave(true);}
 else if(line=="LED TEST"){ledTestUntil=millis()+6000;}
 else if(line.startsWith("LED PIN ")&&line!="LED PINTEST"){String p=line.substring(8);ledPinMask=p=="16"?1:p=="17"?2:3;ledSave();ledAttach();}
 else if(line=="LED PINTEST"){
  // Hold both candidate pins LOW for 20 s: a pad that reads about 0 V on the meter is a real GPIO pad.
  for(int p=0;p<2;p++){ledActive[p]=false;pinMode(ledPins[p],OUTPUT);digitalWrite(ledPins[p],LOW);}
  ledPinTest=true;ledPinTestUntil=millis()+20000;Serial.println("LED PINTEST GPIO16+17 LOW FOR 20S");return;
 }
 else return;
 Serial.printf("LED ON=%d BRIGHT=%d COLOR=%d,%d,%d FX=%d PINS=%d\n",ledOn,ledBright,ledRGB[0],ledRGB[1],ledRGB[2],ledEffect,ledPinMask);
}
