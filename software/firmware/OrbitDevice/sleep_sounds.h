// SOUND MACHINE page (25): rain, storm, ocean, crickets, fan and fire, made live from noise and a little maths
// (no recordings: they would fill the flash, and these never loop). Tap a tile to play it, again to stop.
// The bell opens a volume slider (like the alarm's); the timer fades the sound out after 15, 30 or 60
// minutes. It uses Orbit's speaker, so a voice turn or the alarm takes over from it.
const int SLEEP_SOUNDS=6;
const char *sleepNames[SLEEP_SOUNDS]={"RAIN","STORM","OCEAN","CRICKETS","FAN","FIRE"};
const uint8_t sleepColors[SLEEP_SOUNDS][3]={{40,120,255},{110,60,200},{0,170,190},{40,170,80},{120,140,160},{255,90,20}};
const int sleepTimers[4]={0,15,30,60};
volatile int sleepSound=-1;int sleepTimer=0;uint32_t sleepEndsAt=0,sleepFadeMs=20000;  // a bell preview fades in 0.4 s
void sleepLoad(){sleepTimer=constrain(prefs.getInt("sleeptimer",0),0,3);}
void sleepSave(){prefs.putInt("sleeptimer",sleepTimer);}

// ---- The sounds: one sample at a time at 16 kHz, roughly -1..1 ----
struct SleepSynth{
 uint32_t seed=0x1234567;float b1=0,b2=0,b3=0,hp=0,lpo=0,drop=0,res1=0,res2=0,thunder=0,crack=0,flame=0;
 uint32_t n=0,thunderAt=16000*4,pop=0;float popAmp=0;
 uint32_t chirpAt[3]={3000,9000,17000},chirpStart[3]={0,0,0};bool chirping[3]={false,false,false};
 float white(){seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return (int32_t(seed)/2147483648.f);}
 float brown(float &b,float k){b=b*k+white()*(1-k)*6.f;return b;}
 // Noise kept in the range Orbit's small speaker can play (it has no deep bass).
 float low(float &b,float k){b=b*k+white()*(1-k);return b*4.f;}
 bool chance(float p){return (seed>>8)*(1.f/16777216.f)<p;}
 // A short knock through a ringing filter (a crackle's pop): call ring(kick) every sample.
 float ring(float kick,float f,float decay){float w=2*PI*f/16000;float y=kick+2*decay*cosf(w)*res1-decay*decay*res2;res2=res1;res1=y;return y;}
 float rainSample(float heavy){
  float w=white();hp=0.97f*(hp+w-lpo);lpo=w;  // hiss: white noise without its bass
  if(chance(0.0015f*heavy))drop=0.3f+0.7f*(seed&255)/255.f;
  float d=drop*white();drop*=0.993f;  // droplets: tiny bursts that die away
  return hp*0.22f*heavy+d*0.5f;
 }
 float next(int id){
  n++;float t=n/16000.f;
  switch(id){
   case 0:return rainSample(1);
   case 1:{  // storm: a 50 s cycle of about 25 s heavy rain with thunder, a calmer break, then it builds again
    float c=fmodf(t,50.f),I=c<25?1:c<30?1-(c-25)/5*0.65f:c<42?0.35f:0.35f+(c-42)/8*0.65f;
    float r=rainSample(0.8f+1.2f*I)*0.8f+brown(b1,0.995f)*0.25f*I;
    if(I>0.95f&&n>=thunderAt){thunderAt=n+16000*(6+(seed%9));thunder=1;crack=0.6f+0.4f*((seed>>6)&255)/255.f;}
    float th=0;
    if(thunder>0.002f){th=(low(b2,0.92f)+low(b3,0.8f)*0.4f)*thunder*1.5f*(0.6f+0.4f*sinf(t*7+2*sinf(t*3)));thunder*=0.99993f;}  // the long roll
    if(crack>0.01f){th+=white()*crack;crack*=0.9985f;}  // the crack at the start
    return r+th;}
   case 2:{float swell=0.5f-0.5f*cosf(2*PI*t/8.5f),wash=0.4f+0.6f*swell;  // ocean: gentle waves in and out
    float k=0.62f+0.18f*(1-swell);lpo=lpo*k+white()*(1-k);return (lpo*2.2f+low(b1,0.9f)*0.15f)*wash;}
   case 3:{  // crickets: three of them, near and far, each chirping three quick pulses now and then, over a soft breeze
    const float pitch[3]={4300,4700,3900},level[3]={0.5f,0.32f,0.18f},every[3]={0.65f,0.83f,1.1f};float out=low(b1,0.95f)*0.04f;
    for(int i=0;i<3;i++){
     if(!chirping[i]&&n>=chirpAt[i]){chirping[i]=true;chirpStart[i]=n;}
     if(chirping[i]){uint32_t p=n-chirpStart[i];
      if(p>=3*512){chirping[i]=false;chirpAt[i]=n+uint32_t(16000*every[i]*(0.85f+0.3f*((seed>>(i*5))&255)/255.f));}
      else if(p%512<288)out+=sinf(2*PI*pitch[i]*n/16000.f)*sinf(PI*(p%512)/288.f)*level[i];}}
    return out;}
   case 4:return low(b1,0.9f)*0.5f+low(b2,0.97f)*0.4f+low(b3,0.7f)*0.05f;  // fan: a deep, steady whoosh
   default:{flame=flame*0.9995f+white()*0.0005f;  // fire: a low roar (felt more than heard) and little crackles
    float roar=brown(b1,0.993f)*(0.3f+fabsf(flame)*8);
    if(pop==0&&chance(0.0006f)){pop=1+(seed%6);popAmp=0.4f+0.6f*((seed>>4)&255)/255.f;}
    float c=0;if(pop&&chance(0.02f)){c=white()*popAmp*2;pop--;popAmp*=0.8f;}
    return roar+ring(c,1800+(seed%1600),0.9f)*0.25f;}
  }
 }
};
const float sleepTrim[SLEEP_SOUNDS]={1,1,1,1,1.6f,1};  // per sound, so they sound about equally loud on Orbit
// Plays whatever sleepSound says (fading across a change), at the bell's level, until sleepEndsAt or STOP,
// fading the last 20 s of a timer.
void sleepFeed(void*){
 // Borrowed while playing (the voice needs that memory for Wi-Fi when nothing plays).
 SleepSynth *sp=new(std::nothrow) SleepSynth();int32_t *out=(int32_t*)malloc(512*4);
 if(!sp||!out){delete sp;free(out);sleepSound=-1;speakerTaskHandle=nullptr;vTaskDelete(nullptr);}
 SleepSynth &s=*sp;int playing=-2;float gain=0;  // -2: nothing started yet
 while(!speakerTaskStop){
  int want=sleepSound;float target=want<0?0:sleepVolPct/100.f*0.9f;
  if(sleepEndsAt){int32_t left=int32_t(sleepEndsAt-millis());if(left<=0)break;if(left<int32_t(sleepFadeMs))target*=left/float(sleepFadeMs);}
  if(want!=playing)target=0;
  for(int i=0;i<256;i++){
   gain+=(target-gain)*0.0004f;
   if(want!=playing&&gain<0.002f){playing=want;s=SleepSynth();}
   float v=playing>=0?s.next(playing)*sleepTrim[playing]*gain:0;
   int32_t q=int32_t(constrain(v,-1.f,1.f)*20000.f)*65536;out[i*2]=q;out[i*2+1]=q;}
  if(want<0&&gain<0.002f)break;
  size_t written=0;i2s_channel_write(speakerTx,out,512*4,&written,100);
 }
 delete sp;free(out);sleepSound=-1;speakerTaskHandle=nullptr;vTaskDelete(nullptr);
}
bool sleepStart(int id){
 if(sleepSound>=0&&speakerTaskHandle){sleepSound=id;return true;}  // already playing: the feed fades over
 soundStop();micStop();speakerStop();
 i2s_chan_config_t ch=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);ch.dma_desc_num=6;ch.dma_frame_num=256;
 if(i2s_new_channel(&ch,&speakerTx,nullptr)!=ESP_OK){speakerTx=nullptr;return false;}
 i2s_std_config_t cfg={};cfg.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(16000);
 cfg.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO);
 cfg.gpio_cfg.mclk=I2S_GPIO_UNUSED;cfg.gpio_cfg.bclk=GPIO_NUM_22;cfg.gpio_cfg.ws=GPIO_NUM_27;cfg.gpio_cfg.dout=GPIO_NUM_4;cfg.gpio_cfg.din=I2S_GPIO_UNUSED;
 if(i2s_channel_init_std_mode(speakerTx,&cfg)!=ESP_OK||i2s_channel_enable(speakerTx)!=ESP_OK){i2s_del_channel(speakerTx);speakerTx=nullptr;return false;}
 sleepSound=id;sleepFadeMs=20000;sleepEndsAt=sleepTimers[sleepTimer]?millis()+sleepTimers[sleepTimer]*60000UL:0;speakerTaskStop=false;speakerStopAt=millis()+86400000UL;
 if(xTaskCreate(sleepFeed,"sleep-sound",6144,nullptr,3,&speakerTaskHandle)!=pdPASS){speakerTaskHandle=nullptr;sleepSound=-1;speakerStop();return false;}
 Serial.printf("SOUND MACHINE %s\n",sleepNames[id]);return true;
}
void sleepStop(){if(sleepSound>=0)sleepSound=-1;}  // the feed fades out and closes the speaker (speakerLoop)
bool sleepPlaying(){return sleepSound>=0&&speakerTaskHandle;}

// ---- The page ----
void sleepTile(int i,int &x,int &y,int &w,int &h){if(tall()){w=108;h=56;x=8+(i%2)*116;y=62+(i/2)*62;}else{w=98;h=52;x=6+(i%3)*104;y=40+(i/3)*58;}}
int sleepTileAt(int x,int y){for(int i=0;i<SLEEP_SOUNDS;i++){int tx,ty,w,h;sleepTile(i,tx,ty,w,h);if(x>=tx&&x<tx+w&&y>=ty&&y<ty+h)return i;}return -1;}
int sleepKeysY(){return tall()?252:160;}
// Keys under the tiles: TIMER, the volume bell, STOP. Returns their x and width.
void sleepKeys(int &tx,int &tw,int &bx,int &bw,int &sx,int &sw){if(tall()){tx=8;tw=88;bx=102;bw=60;sx=168;sw=64;}else{tx=10;tw=128;bx=144;bw=62;sx=212;sw=98;}}
void sleepIcon(int i,int cx,int cy,uint16_t c,bool on){
 switch(i){
  case 0:for(int k=0;k<5;k++)ui.drawLine(cx-12+k*6,cy-7+(k%2)*4,cx-15+k*6,cy+3+(k%2)*4,c);break;  // rain
  case 1:ui.fillTriangle(cx+2,cy-11,cx-7,cy+2,cx,cy+2,c);ui.fillTriangle(cx,cy-2,cx+6,cy-2,cx-3,cy+11,c);break;  // lightning
  case 2:for(int k=0;k<2;k++)for(int x=-14;x<14;x++)ui.fillRect(cx+x,cy-3+k*7+int(sinf(x*0.45f)*3),1,2,c);break;  // waves
  case 3:ui.fillCircle(cx,cy,10,c);ui.fillCircle(cx+5,cy-4,9,on?ui.color565(40,170,80):panel);ui.fillCircle(cx+12,cy+6,1,c);ui.fillCircle(cx-14,cy-8,1,c);break;  // a crescent moon and stars
  case 4:{float a=millis()*(sleepSound==4?0.012f:0);for(int k=0;k<3;k++){float t=a+k*2.094f;ui.fillTriangle(cx,cy,cx+int(cosf(t)*12),cy+int(sinf(t)*12),cx+int(cosf(t+0.6f)*12),cy+int(sinf(t+0.6f)*12),c);}ui.fillCircle(cx,cy,2,c);break;}  // fan
  default:ui.fillTriangle(cx-9,cy+8,cx+9,cy+8,cx,cy-12,c);ui.fillTriangle(cx-5,cy+8,cx+5,cy+8,cx-2,cy-4,panel);break;  // flame
 }
}
void drawSleep(){
 header("SOUND MACHINE",sleepPlaying()?sleepNames[sleepSound]:"");
 for(int i=0;i<SLEEP_SOUNDS;i++){int x,y,w,h;sleepTile(i,x,y,w,h);bool on=sleepPlaying()&&sleepSound==i;const uint8_t *c=sleepColors[i];
  uint16_t col=ui.color565(c[0],c[1],c[2]);ui.fillRect(x,y,w,h,on?col:panel);ui.drawRect(x,y,w,h,col);if(on)ui.drawRect(x+1,y+1,w-2,h-2,TFT_WHITE);
  sleepIcon(i,x+w/2,y+h/2-8,on?TFT_WHITE:col,on);text(sleepNames[i],x+w/2,y+h-11,2,on?TFT_WHITE:ink,MC_DATUM);
  if(on)for(int k=0;k<4;k++){int bh=3+int(5*(0.5f+0.5f*sinf(millis()*0.006f+k*1.7f)));ui.fillRect(x+w-24+k*5,y+12-bh,3,bh,TFT_WHITE);}}  // playing
 int tx,tw,bx,bw,sx,sw,y=sleepKeysY();sleepKeys(tx,tw,bx,bw,sx,sw);
 button(sleepTimer?String("TIMER ")+sleepTimers[sleepTimer]+"m":String("TIMER OFF"),tx,y,tw,sleepTimer>0);
 alarmBell(bx,y,bw,sleepVolPct);  // the same bell as the alarm
 button("STOP",sx,y,sw,sleepPlaying());
 if(sleepPlaying()&&sleepEndsAt){uint32_t left=(sleepEndsAt-millis())/60000+1;text(String("Fades out in ")+left+" min",W/2,y+(tall()?44:46),1,muted,MC_DATUM);}
 if(volPopup==2)drawVolPopup();
}
// After the slider: a taste of rain at the new level, unless a sound is already playing (it follows live).
bool alarmVolPreviewSleep(){if(sleepPlaying())return true;if(!sleepStart(0))return false;sleepEndsAt=millis()+2500;sleepFadeMs=400;return true;}
bool sleepTap(int x,int y){
 if(volPopupTap(2,x,y))return true;
 int i=sleepTileAt(x,y);
 if(i>=0){if(sleepPlaying()&&sleepSound==i)sleepStop();else sleepStart(i);return true;}
 int tx,tw,bx,bw,sx,sw,ky=sleepKeysY();sleepKeys(tx,tw,bx,bw,sx,sw);
 if(y<ky-4||y>=ky+38)return false;
 if(x>=tx&&x<tx+tw){sleepTimer=(sleepTimer+1)%4;sleepSave();if(sleepPlaying())sleepEndsAt=sleepTimers[sleepTimer]?millis()+sleepTimers[sleepTimer]*60000UL:0;return true;}
 if(x>=bx&&x<bx+bw){volPopup=volPopup==2?0:2;return true;}
 if(x>=sx&&x<sx+sw){sleepStop();return true;}
 return false;
}
