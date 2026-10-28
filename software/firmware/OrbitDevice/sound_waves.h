// VISUALS page (109, the VE button on the music page): Orbit's own microphone hears the room, and the
// screen and the LED ring move to it. The mic runs only while this page shows, or while Hue MUSIC LINK is on
// (then only loudness levels go to the PC for the lights). No sound is recorded or sent.
// It shares the one I2S port with voice and the speaker, so it pauses while Orbit listens or talks.
const int SOUND_N=512,SOUND_BANDS=16;      // 512 samples at 16 kHz: a fresh picture of the sound every 32 ms
const uint32_t SOUND_RATE=16000;
i2s_chan_handle_t soundRx=nullptr;TaskHandle_t soundTask=nullptr;volatile bool soundRun=false;
volatile float soundRaw[SOUND_BANDS];       // 0-1 per band, written by the mic task
volatile float soundWave[128];  // the sound itself, scaled to about -1..1, for NEON WAVE
volatile float soundBass=0;volatile uint32_t soundBeatAt=0,soundBlocks=0;
float soundShown[SOUND_BANDS],soundCap[SOUND_BANDS];uint32_t soundDrawAt=0;  // what the screen shows (smoothed)

// In-place radix-2 FFT of n points (n a power of two).
void soundFFT(float *re,float *im,int n){
 for(int i=1,j=0;i<n;i++){int bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){float t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
 for(int len=2;len<=n;len<<=1){float a=-2*PI/len,wr=cosf(a),wi=sinf(a);
  for(int i=0;i<n;i+=len){float cr=1,ci=0;
   for(int k=0;k<len/2;k++){int p=i+k,q=p+len/2;float tr=re[q]*cr-im[q]*ci,ti=re[q]*ci+im[q]*cr;
    re[q]=re[p]-tr;im[q]=im[p]-ti;re[p]+=tr;im[p]+=ti;float nr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nr;}}}
}
// One block of sound -> 16 bands from about 90 Hz to 6 kHz, spaced like hearing (more room for the bass).
// Each band is measured against its own quiet level, and the loudest recent sound sets the top, so a
// quiet room and a loud party both fill the screen.
void soundAnalyse(float *re,float *im){
 static float noise[SOUND_BANDS],top=40,bassAvg=0;static bool primed=false;static uint32_t lastBeat=0;
 float mean=0;for(int i=0;i<SOUND_N;i++)mean+=re[i];mean/=SOUND_N;
 // Every 4th sample of the wave, scaled by the loudest recent block (never below six times the room's hush).
 static float waveTop=1,waveQuiet=1e9;float peak=1;for(int i=0;i<SOUND_N;i++)peak=max(peak,fabsf(re[i]-mean));
 waveTop=max(peak,waveTop*0.99f);waveQuiet=peak<waveQuiet?peak:waveQuiet*1.002f;float scale=max(waveTop,waveQuiet*6);
 for(int i=0;i<128;i++)soundWave[i]=(re[i*4]-mean)/scale;
 for(int i=0;i<SOUND_N;i++){re[i]=(re[i]-mean)*(0.5f-0.5f*cosf(2*PI*i/(SOUND_N-1)));im[i]=0;}
 soundFFT(re,im,SOUND_N);
 float db[SOUND_BANDS],loudest=-100;int hi=3;  // bins are 31 Hz wide; each band starts where the last ended
 for(int b=0;b<SOUND_BANDS;b++){
  int lo=hi;hi=max(lo+1,int(roundf(3*powf(64.f,(b+1)/float(SOUND_BANDS)))));
  float sum=0;for(int k=lo;k<hi;k++)sum+=re[k]*re[k]+im[k]*im[k];
  db[b]=10*log10f(sum/(hi-lo)+1);loudest=max(loudest,db[b]);
 }
 if(!primed){for(int b=0;b<SOUND_BANDS;b++)noise[b]=db[b];primed=true;}
 top=max(top-0.04f,loudest);float quiet=0;
 for(int b=0;b<SOUND_BANDS;b++){noise[b]=db[b]<noise[b]?noise[b]+(db[b]-noise[b])*0.2f:noise[b]+0.01f;quiet+=noise[b];}
 quiet/=SOUND_BANDS;float range=max(20.f,top-quiet);
 for(int b=0;b<SOUND_BANDS;b++)soundRaw[b]=constrain((db[b]-noise[b]-3)/range,0.f,1.f);
 // A beat: the bass jumps well above its recent average.
 float bass=(soundRaw[0]+soundRaw[1]+soundRaw[2]+soundRaw[3])/4;soundBass=bass;
 uint32_t now=millis();if(bass>0.25f&&bass>bassAvg*1.5f+0.05f&&now-lastBeat>180){lastBeat=now;soundBeatAt=now;}
 bassAvg+=(bass-bassAvg)*0.08f;soundBlocks++;
}
void soundFeed(void*){
 static int32_t frames[512];static float re[SOUND_N],im[SOUND_N];int fill=0;
 while(soundRun){
  size_t bytes=0;if(i2s_channel_read(soundRx,frames,sizeof(frames),&bytes,100)!=ESP_OK||!bytes)continue;
  for(size_t i=0;i<bytes/8;i++){re[fill++]=float(frames[i*2]>>8);if(fill==SOUND_N){soundAnalyse(re,im);fill=0;}}  // 24-bit left slot
 }
 soundTask=nullptr;vTaskDelete(nullptr);
}
bool soundListening(){return soundRx!=nullptr;}
void soundStop(){
 if(!soundRx)return;
 soundRun=false;while(soundTask)delay(2);
 i2s_channel_disable(soundRx);i2s_del_channel(soundRx);soundRx=nullptr;audioPinsIdle();
 for(int b=0;b<SOUND_BANDS;b++){soundRaw[b]=0;soundShown[b]=0;soundCap[b]=0;}soundBass=0;ledDirty=true;
 Serial.println("SOUND STOPPED");
}
bool soundStart(){
 if(soundRx)return true;
 i2s_chan_config_t ch=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);ch.dma_desc_num=4;ch.dma_frame_num=256;
 if(i2s_new_channel(&ch,nullptr,&soundRx)!=ESP_OK){soundRx=nullptr;return false;}
 i2s_std_config_t cfg={};cfg.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(SOUND_RATE);
 cfg.slot_cfg=I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO);  // mic timing, see audio_diag.h
 cfg.gpio_cfg.mclk=I2S_GPIO_UNUSED;cfg.gpio_cfg.bclk=GPIO_NUM_22;cfg.gpio_cfg.ws=GPIO_NUM_27;
 cfg.gpio_cfg.dout=I2S_GPIO_UNUSED;cfg.gpio_cfg.din=GPIO_NUM_35;
 if(i2s_channel_init_std_mode(soundRx,&cfg)!=ESP_OK||i2s_channel_enable(soundRx)!=ESP_OK){i2s_del_channel(soundRx);soundRx=nullptr;return false;}
 soundRun=true;
 if(xTaskCreate(soundFeed,"sound",4096,nullptr,2,&soundTask)!=pdPASS){soundTask=nullptr;soundRun=false;i2s_channel_disable(soundRx);i2s_del_channel(soundRx);soundRx=nullptr;audioPinsIdle();return false;}
 Serial.println("SOUND LISTENING");return true;
}
// Orbit is busy with its own audio: a voice turn, a reply playing, or a speaker or mic test.
bool soundPaused(){return voiceRx||voiceTx||micTesting||speakerTx||audioLoopTaskHandle;}
// Listen only while the page is up and nothing else needs the audio port. A failed start retries in 2 s.
void soundLoop(){
 static uint32_t retryAt=0;
 bool want=(page==109||hueLinked())&&!securityLocked&&!soundPaused();  // MUSIC LINK listens on every screen
 if(!want){soundStop();return;}
 if(!soundRx&&int32_t(millis()-retryAt)>=0&&!soundStart())retryAt=millis()+2000;
}
// The LED ring while listening: one LED per pair of bands, bass to treble around the ring, a colour each.
// Brightness follows the sound, and every beat flashes the whole ring. False when not listening.
bool soundLedFrame(uint8_t px[][3]){
 if(!soundRx||page!=109)return false;  // the ring dances only on the visualizer
 uint32_t now=millis();float flash=max(0.f,1-(now-soundBeatAt)/220.f);
 for(int i=0;i<LED_COUNT;i++){float v=max(soundRaw[i*2],soundRaw[i*2+1]);uint8_t c[3];ledHue(uint8_t(i*28+now/40),c);
  ledScale(px[i],c,constrain(0.04f+0.96f*v*v+0.5f*flash,0.f,1.f));}
 return true;
}
// ---- VISUALS (the VE button on the music page): four full-screen animations, each with its own colours.
// Tap anywhere for the next one; EXIT (top left) goes back to the music page. The choice is remembered.
const int VE_MODES=4;
const char *veNames[VE_MODES]={"SPECTRUM","NEON WAVE","ORBIT","GALAXY"};
int veMode=-1;uint32_t veModeAt=0;float veLevel=0,veSpin=0,veGrid=0;
struct VeStar{float x,y,z;uint8_t tint;};VeStar veStars[90];bool veStarsReady=false;
uint16_t veRgb(float r,float g,float b){return ui.color565(constrain(int(r),0,255),constrain(int(g),0,255),constrain(int(b),0,255));}
// SPECTRUM: rainbow bars with falling peak caps, mirrored dimly underneath like a glossy floor.
void veSpectrum(uint32_t now){
 int floorY=int(H*0.76f),top=40,gap=W>H?4:3,bw=(W-12-gap*(SOUND_BANDS-1))/SOUND_BANDS;
 int x0=(W-(bw*SOUND_BANDS+gap*(SOUND_BANDS-1)))/2,hMax=floorY-top,reflect=H-6-floorY;
 for(int b=0;b<SOUND_BANDS;b++){int x=x0+b*(bw+gap),h=int(soundShown[b]*hMax);uint8_t c[3];ledHue(uint8_t(b*14+now/40),c);
  if(h>0)ui.fillRect(x,floorY-h,bw,h,veRgb(c[0],c[1],c[2]));
  int r=min(reflect,h/3);if(r>0)ui.fillRect(x,floorY+3,bw,r,veRgb(c[0]/5,c[1]/5,c[2]/5));
  if(soundCap[b]>0.02f)ui.fillRect(x,max(top,floorY-int(soundCap[b]*hMax)-4),bw,3,TFT_WHITE);}
 ui.drawFastHLine(x0,floorY+1,W-2*x0,veRgb(60,60,60));
}
// NEON WAVE: the sound's own wave in glowing cyan over a striped sunset and a grid racing toward you.
void veNeonWave(float dt){
 int hy=int(H*0.6f),cx=W/2,sunR=min(W,H)*0.24f;
 for(int y=hy-sunR;y<hy;y+=1){int k=hy-y;if(k<sunR*0.55f&&(k/3)%3==0)continue;  // the sun's stripes, wider near the horizon
  float t=float(y-(hy-sunR))/sunR;int half=int(sqrtf(max(0.f,float(sunR*sunR-(hy-y)*(hy-y)))));
  ui.drawFastHLine(cx-half,y,half*2,veRgb(255,220-170*t,60+60*t));}
 veGrid=fmodf(veGrid+dt*(0.35f+veLevel*2.5f),1.f);
 for(int k=0;k<8;k++){float t=(k+veGrid)/8;int y=hy+int((H-hy)*t*t);ui.drawFastHLine(0,y,W,veRgb(120+135*t,0,110+60*t));}
 for(int j=-7;j<=7;j++)ui.drawLine(cx+j*W/36,hy,cx+j*W/5,H,veRgb(150,0,130));
 ui.drawFastHLine(0,hy,W,veRgb(255,60,200));
 int cy=int(hy*0.5f)+12;float amp=hy*0.42f;int px=0,py=cy;
 for(int i=0;i<128;i++){int x=i*(W-1)/127,y=cy+int(constrain(soundWave[i],-1.f,1.f)*amp);
  if(i){ui.drawLine(px,py-2,x,y-2,veRgb(120,0,160));ui.drawLine(px,py+2,x,y+2,veRgb(120,0,160));
   ui.drawLine(px,py-1,x,y-1,veRgb(0,200,255));ui.drawLine(px,py,x,y,veRgb(200,255,255));ui.drawLine(px,py+1,x,y+1,veRgb(0,200,255));}
  px=x;py=y;}
}
// ORBIT: a sunset sun with 48 rays that stretch with the music, a moon circling it, a flash on each beat.
void veOrbit(float dt,float flash){
 int cx=W/2,cy=H/2+(W>H?8:0);float R=min(W,H)/2-8,r0=R*0.3f+soundBass*R*0.12f;
 veSpin+=dt*(0.15f+veLevel*1.2f);
 for(int i=0;i<48;i++){int k=(i<24?i:47-i)*SOUND_BANDS/24;float v=soundShown[k],a=i*2*PI/48+veSpin,ca=cosf(a),sa=sinf(a);
  float len=3+v*(R-r0-6);int x1=cx+int(ca*(r0+3)),y1=cy+int(sa*(r0+3)),x2=cx+int(ca*(r0+3+len)),y2=cy+int(sa*(r0+3+len));
  uint16_t c=v<0.5f?veRgb(255,80-60*v*2,40+80*v*2):veRgb(255,20+200*(v-0.5f)*2,120-120*(v-0.5f)*2);
  ui.drawLine(x1,y1,x2,y2,c);ui.drawLine(x1+1,y1,x2+1,y2,c);if(v>0.15f)ui.fillCircle(x2,y2,1,veRgb(255,240,120));}
 ui.fillCircle(cx,cy,int(r0),veRgb(140,0,40));ui.fillCircle(cx,cy,int(r0*(0.55f+0.35f*flash)),veRgb(255,140+100*flash,0));
 ui.drawCircle(cx,cy,int(r0),veRgb(255,120,0));
 float m=-veSpin*0.7f;ui.drawCircle(cx,cy,int(R),veRgb(60,20,40));ui.fillCircle(cx+int(cosf(m)*R),cy+int(sinf(m)*R),4,veRgb(255,230,200));
}
// GALAXY: stars rushing past, faster and streakier the louder it gets, around a purple glow.
void veGalaxy(float dt,float flash){
 int cx=W/2,cy=H/2;float scale=max(W,H)*0.35f;
 if(!veStarsReady){for(auto &s:veStars){s.x=random(-1000,1000)/1000.f;s.y=random(-1000,1000)/1000.f;s.z=random(50,1000)/1000.f;s.tint=random(4);}veStarsReady=true;}
 int glow=int(10+veLevel*min(W,H)*0.25f+flash*12);
 ui.fillCircle(cx,cy,glow,veRgb(30,0,60));ui.fillCircle(cx,cy,glow*2/3,veRgb(70,10,120));ui.fillCircle(cx,cy,glow/3,veRgb(170,90,255));
 float speed=0.12f+veLevel*1.4f+flash*0.8f;
 for(auto &s:veStars){float z0=s.z;s.z-=speed*dt;
  int x=cx+int(s.x/s.z*scale),y=cy+int(s.y/s.z*scale);
  if(s.z<=0.03f||x<0||x>=W||y<0||y>=H){s.x=random(-1000,1000)/1000.f;s.y=random(-1000,1000)/1000.f;s.z=1;s.tint=random(4);continue;}
  int tx=cx+int(s.x/min(1.f,z0+speed*0.04f)*scale),ty=cy+int(s.y/min(1.f,z0+speed*0.04f)*scale);float b=255*(1-s.z*0.8f);
  uint16_t c=s.tint==0?veRgb(b*0.6f,b*0.7f,b):s.tint==1?veRgb(b*0.8f,b*0.5f,b):veRgb(b,b,b);
  ui.drawLine(tx,ty,x,y,c);if(s.z<0.35f)ui.fillRect(x,y,2,2,c);}
}
void drawSound(){
 if(veMode<0)veMode=constrain(prefs.getInt("vemode",0),0,VE_MODES-1);
 uint32_t now=millis();float dt=min(0.2f,(now-soundDrawAt)/1000.f);soundDrawAt=now;
 float sum=0;
 for(int b=0;b<SOUND_BANDS;b++){float v=soundRaw[b];
  soundShown[b]=v>soundShown[b]?v:max(v,soundShown[b]-dt*2.2f);       // jump up, fall gently
  soundCap[b]=soundShown[b]>soundCap[b]?soundShown[b]:max(0.f,soundCap[b]-dt*0.5f);sum+=soundShown[b];}
 veLevel+=(sum/SOUND_BANDS-veLevel)*0.4f;float flash=max(0.f,1-(now-soundBeatAt)/220.f);
 ui.fillSprite(TFT_BLACK);
 if(veMode==0)veSpectrum(now);else if(veMode==1)veNeonWave(dt);else if(veMode==2)veOrbit(dt,flash);else veGalaxy(dt,flash);
 ui.fillRect(4,4,54,26,TFT_BLACK);ui.drawRect(4,4,54,26,veRgb(110,110,110));text("EXIT",31,17,2,TFT_WHITE,MC_DATUM);
 if(now-veModeAt<1500)text(veNames[veMode],W-8,9,2,TFT_WHITE,TR_DATUM);
 else if(hueLinked()){uint8_t c[3];ledHue(uint8_t(now/8),c);ui.drawRect(W-50,6,44,22,ui.color565(c[0],c[1],c[2]));text("HUE",W-28,17,2,ui.color565(c[0],c[1],c[2]),MC_DATUM);}  // the lights follow along
 for(int i=0;i<VE_MODES;i++)ui.fillCircle(W/2-15+i*10,H-6,2,i==veMode?TFT_WHITE:veRgb(70,70,70));
}
void soundTap(int x,int y){
 if(x<70&&y<40){setPage(17);return;}
 veMode=(veMode+1)%VE_MODES;veModeAt=millis();prefs.putInt("vemode",veMode);
}
// Serial: SOUND -> the current band levels, for tuning.
void soundCommand(){
 Serial.printf("SOUND %s BLOCKS=%lu BASS=%.2f BANDS",soundRx?"ON":"OFF",(unsigned long)soundBlocks,soundBass);
 for(int b=0;b<SOUND_BANDS;b++)Serial.printf(" %.2f",soundRaw[b]);Serial.println();
}
