// ORBIT SWEEP page (26): a tap puzzle in space. Black holes hide in a starfield; tap a square to scan it (it
// shows how many black holes touch it, and an empty patch opens up on its own), hold one to drop a probe
// where you think a black hole is. The first tap is always safe. Clear every safe square to win: best
// times are kept, one for each way up (10 x 6 lying down, 8 x 8 standing up, 10 black holes each).
const int SW_MAXC=10,SW_MAXR=8,SW_HOLES=10;
uint8_t swHole[SW_MAXR][SW_MAXC],swShown[SW_MAXR][SW_MAXC],swProbe[SW_MAXR][SW_MAXC];  // swShown: 1 scanned
int swState=0,swHitR=-1,swHitC=-1,swCols=0,swRows=0;  // 0 new board (holes laid on the first tap), 1 playing, 2 lost, 3 won
uint32_t swStart=0,swTime=0,swFxAt=0;int swFx=0;  // swFx: light ring effect 1 scan, 2 black hole, 3 win
int swCell(){return tall()?29:31;}int swX0(){return (W-swCols*swCell())/2;}int swY0(){return tall()?62:36;}
void swNew(){swCols=tall()?8:10;swRows=tall()?8:6;memset(swHole,0,sizeof(swHole));memset(swShown,0,sizeof(swShown));memset(swProbe,0,sizeof(swProbe));swState=0;swHitR=swHitC=-1;}
uint32_t swBest(){return prefs.getUInt(tall()?"swbest_t":"swbest_l",0);}
int swCount(int r,int c){int n=0;for(int dr=-1;dr<=1;dr++)for(int dc=-1;dc<=1;dc++){int rr=r+dr,cc=c+dc;if((dr||dc)&&rr>=0&&rr<swRows&&cc>=0&&cc<swCols)n+=swHole[rr][cc];}return n;}
// Lay the black holes, keeping the first square and its neighbours clear.
void swLay(int r0,int c0){int placed=0;while(placed<SW_HOLES){int r=random(swRows),c=random(swCols);if(swHole[r][c]||(abs(r-r0)<=1&&abs(c-c0)<=1))continue;swHole[r][c]=1;placed++;}}
// Scan a square; an empty one opens its neighbours too (a small stack instead of recursion).
void swOpen(int r0,int c0){
 int stack[SW_MAXR*SW_MAXC],top=0;stack[top++]=r0*SW_MAXC+c0;
 while(top){int v=stack[--top],r=v/SW_MAXC,c=v%SW_MAXC;if(swShown[r][c]||swProbe[r][c])continue;swShown[r][c]=1;
  if(swCount(r,c)==0)for(int dr=-1;dr<=1;dr++)for(int dc=-1;dc<=1;dc++){int rr=r+dr,cc=c+dc;if(rr>=0&&rr<swRows&&cc>=0&&cc<swCols&&!swShown[rr][cc]&&top<SW_MAXR*SW_MAXC)stack[top++]=rr*SW_MAXC+cc;}}
}
bool swCleared(){for(int r=0;r<swRows;r++)for(int c=0;c<swCols;c++)if(!swHole[r][c]&&!swShown[r][c])return false;return true;}
int swProbes(){int n=0;for(int r=0;r<swRows;r++)for(int c=0;c<swCols;c++)n+=swProbe[r][c];return n;}
bool swAt(int x,int y,int &r,int &c){int s=swCell();if(x<swX0()||y<swY0())return false;c=(x-swX0())/s;r=(y-swY0())/s;return c<swCols&&r<swRows;}

// ---- Sound effects: a short sound on Orbit's speaker, only when nothing else is using it ----
volatile int sfxKind=0;
void sfxFeed(void*){
 int32_t *out=(int32_t*)malloc(512*4);if(!out){speakerTaskHandle=nullptr;vTaskDelete(nullptr);}  // borrowed while playing
 uint32_t n=0,len=sfxKind==2?16000:sfxKind==3?16000:2400;float lp=0,ph=0;uint32_t seed=0x9e3779b9;
 while(n<len&&!speakerTaskStop){
  for(int i=0;i<256;i++,n++){float v=0,t=n/16000.f;
   if(n<len){
    if(sfxKind==2){seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;lp=lp*0.96f+(int32_t(seed)/2147483648.f)*0.04f;  // whoom: a falling tone in a rush of noise
     ph+=2*PI*(320-260*t)/16000;v=(sinf(ph)*0.6f+lp*6)*expf(-t*3.2f);}
    else if(sfxKind==3){const float notes[5]={523,659,784,1047,1319};int k=min(4,int(t/0.14f));float e=fmodf(t,0.14f);  // a little fanfare
     ph+=2*PI*notes[k]/16000;v=(sinf(ph)>0?0.5f:-0.5f)*(k<4?expf(-e*14):expf(-(t-0.56f)*3))*0.8f;}
    else{ph+=2*PI*(900+2000*t)/16000;v=sinf(ph)*expf(-t*40)*0.6f;}  // blip
   }
   int32_t q=int32_t(v*14000*(alarmVolPct/100.f))*65536;out[i*2]=q;out[i*2+1]=q;}
  size_t w=0;i2s_channel_write(speakerTx,out,512*4,&w,100);
 }
 free(out);speakerTaskHandle=nullptr;vTaskDelete(nullptr);  // speakerLoop closes the speaker
}
void sfxPlay(int kind){
 if(speakerTx||speakerTaskHandle||voiceTx||voiceRx||alarmRinging)return;  // never cut into other sound
 soundStop();micStop();
 i2s_chan_config_t ch=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);ch.dma_desc_num=4;ch.dma_frame_num=128;
 if(i2s_new_channel(&ch,&speakerTx,nullptr)!=ESP_OK){speakerTx=nullptr;return;}
 i2s_std_config_t cfg={};cfg.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(16000);
 cfg.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO);
 cfg.gpio_cfg.mclk=I2S_GPIO_UNUSED;cfg.gpio_cfg.bclk=GPIO_NUM_22;cfg.gpio_cfg.ws=GPIO_NUM_27;cfg.gpio_cfg.dout=GPIO_NUM_4;cfg.gpio_cfg.din=I2S_GPIO_UNUSED;
 if(i2s_channel_init_std_mode(speakerTx,&cfg)!=ESP_OK||i2s_channel_enable(speakerTx)!=ESP_OK){i2s_del_channel(speakerTx);speakerTx=nullptr;return;}
 sfxKind=kind;speakerTaskStop=false;speakerStopAt=millis()+3000;
 if(xTaskCreate(sfxFeed,"sfx",3072,nullptr,3,&speakerTaskHandle)!=pdPASS){speakerTaskHandle=nullptr;speakerStop();}
}

// ---- Playing ----
void swEnd(bool won){
 swState=won?3:2;swTime=millis()-swStart;swFx=won?3:2;swFxAt=millis();sfxPlay(won?3:2);ledDirty=true;
 if(won){uint32_t best=swBest();if(!best||swTime<best)prefs.putUInt(tall()?"swbest_t":"swbest_l",swTime);}
}
bool swTap(int x,int y){
 if(!swCols||swCols!=(tall()?8:10))swNew();
 if(swState>=2){swNew();return true;}  // after a game, a tap starts the next one
 int r,c;
 if(!swAt(x,y,r,c)){if(y<swY0()&&y>=(tall()?36:0)&&x>40&&x<(tall()?W:W-150)){swNew();return true;}return false;}  // the title: a new board
 if(swProbe[r][c]||swShown[r][c])return true;
 if(swState==0){swLay(r,c);swState=1;swStart=millis();}
 if(swHole[r][c]){swHitR=r;swHitC=c;for(int rr=0;rr<swRows;rr++)for(int cc=0;cc<swCols;cc++)if(swHole[rr][cc])swShown[rr][cc]=1;swEnd(false);return true;}
 swOpen(r,c);swFx=1;swFxAt=millis();ledDirty=true;
 if(swCleared())swEnd(true);
 return true;
}
// Hold: drop or lift a probe.
bool swHold(int x,int y){int r,c;if(swState>=2||!swAt(x,y,r,c))return false;if(!swShown[r][c]){swProbe[r][c]^=1;sfxPlay(1);}return true;}
bool swOwnsTouch(int x,int y){int r,c;return page==26&&swAt(x,y,r,c);}
String swClock(uint32_t ms){char s[12];snprintf(s,sizeof(s),"%lu:%02lu",(unsigned long)(ms/60000),(unsigned long)(ms/1000%60));return String(s);}
void drawSweep(){
 if(!swCols||swCols!=(tall()?8:10))swNew();
 uint32_t t=swState==1?millis()-swStart:swState>=2?swTime:0;
 String status=String(SW_HOLES-swProbes())+" HOLES  "+swClock(t);header("ORBIT SWEEP",tall()?status:"");
 if(!tall())text(String(SW_HOLES-swProbes())+" left "+swClock(t),4,H-11,1,muted);  // lying down the title leaves no room beside it
 int s=swCell(),x0=swX0(),y0=swY0();uint32_t now=millis();
 const uint16_t numCol[9]={0,ui.color565(80,200,255),ui.color565(90,230,110),ui.color565(255,220,60),ui.color565(255,150,40),ui.color565(255,70,70),ui.color565(255,70,200),ui.color565(200,120,255),0xffff};
 for(int r=0;r<swRows;r++)for(int c=0;c<swCols;c++){int x=x0+c*s,y=y0+r*s;
  if(swShown[r][c]&&swHole[r][c]){  // a black hole: a dark disc with a swirling purple rim
   bool hit=r==swHitR&&c==swHitC;ui.fillRect(x,y,s-1,s-1,hit?ui.color565(170,0,30):ui.color565(15,5,30));
   ui.fillCircle(x+s/2,y+s/2,s/3,0x0000);for(int k=0;k<6;k++){float a=k*1.047f+now*(hit?0.012f:0.004f);ui.fillRect(x+s/2+int(cosf(a)*(s/3+1))-1,y+s/2+int(sinf(a)*(s/3+1))-1,2,2,ui.color565(190,90,255));}
   if(swState==2&&swProbe[r][c])ui.drawRect(x+1,y+1,s-3,s-3,ui.color565(90,230,110));  // a probe that was right
  }else if(swShown[r][c]){  // scanned: open space, with a number if black holes are near
   ui.fillRect(x,y,s-1,s-1,ui.color565(6,6,18));ui.drawRect(x,y,s-1,s-1,ui.color565(25,25,50));int n=swCount(r,c);if(n)text(String(n),x+s/2,y+s/2,2,numCol[n],MC_DATUM);
  }else{  // unscanned: deep blue with a couple of stars
   ui.fillRect(x,y,s-1,s-1,ui.color565(40,70,170));ui.drawFastHLine(x,y,s-1,ui.color565(120,150,240));ui.drawFastVLine(x,y,s-1,ui.color565(120,150,240));  // raised: light top and left,
   ui.drawFastHLine(x,y+s-2,s-1,ui.color565(15,25,80));ui.drawFastVLine(x+s-2,y,s-1,ui.color565(15,25,80));  // dark bottom and right
   uint32_t h=(r*31+c*17)*2654435761u;ui.fillRect(x+4+(h>>8)%(s-8),y+4+(h>>16)%(s-8),1,1,ui.color565(200,200,255));ui.fillRect(x+4+(h>>20)%(s-8),y+4+(h>>4)%(s-8),1,1,ui.color565(120,120,200));
   if(swProbe[r][c]){int cx=x+s/2,cy=y+s/2;  // a probe: a little rocket marker
    ui.fillTriangle(cx,cy-9,cx-5,cy+4,cx+5,cy+4,ui.color565(255,90,60));ui.fillRect(cx-2,cy+4,5,4,ui.color565(255,200,60));ui.fillCircle(cx,cy-2,2,0xffff);
    if(swState==2&&!swHole[r][c]){ui.drawLine(x+3,y+3,x+s-5,y+s-5,0xffff);ui.drawLine(x+s-5,y+3,x+3,y+s-5,0xffff);}}}  // a probe that was wrong
 }
 if(swState>=2){  // the result, over the board
  int bw=tall()?220:260,bh=74,bx=(W-bw)/2,by=y0+swRows*s/2-bh/2;
  ui.fillRect(bx,by,bw,bh,0x0000);ui.drawRect(bx,by,bw,bh,swState==3?ui.color565(90,230,110):ui.color565(255,70,70));ui.drawRect(bx+1,by+1,bw-2,bh-2,swState==3?ui.color565(90,230,110):ui.color565(255,70,70));
  if(swState==3){text("SECTOR CLEARED!",W/2,by+16,2,ui.color565(90,230,110),MC_DATUM);uint32_t best=swBest();
   text(swClock(swTime)+(best==swTime?"  NEW BEST!":"  BEST "+swClock(best)),W/2,by+38,2,0xffff,MC_DATUM);}
  else{text("SWALLOWED BY",W/2,by+16,2,ui.color565(255,70,70),MC_DATUM);text("A BLACK HOLE",W/2,by+36,2,ui.color565(255,70,70),MC_DATUM);}
  text("TAP TO PLAY AGAIN",W/2,by+60,1,muted,MC_DATUM);
 }else if(swState==0&&tall())text("Tap to scan. Hold for a probe.",W/2,H-19,1,muted,MC_DATUM);
}
// The light ring: a blue sparkle on a scan, red pulses for a black hole, a spinning rainbow for a win.
bool swLedFrame(uint8_t px[][3]){
 if(page!=26||!swFx)return false;uint32_t t=millis()-swFxAt;
 if(swFx==1&&t<300){for(int i=0;i<LED_COUNT;i++){float k=(1-t/300.f)*((i+t/40)%3==0);px[i][0]=0;px[i][1]=uint8_t(120*k);px[i][2]=uint8_t(255*k);}return true;}
 if(swFx==2&&t<1500){bool on=(t/150)%2==0;for(int i=0;i<LED_COUNT;i++){px[i][0]=on?255:40;px[i][1]=0;px[i][2]=on?30:0;}return true;}
 if(swFx==3&&t<3000){for(int i=0;i<LED_COUNT;i++)ledHue(uint8_t(i*32+t/4),px[i]);return true;}
 swFx=0;ledDirty=true;return false;
}
