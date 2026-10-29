
uint16_t vivid(float phase){return themePacks[themeIndex][5+(int(phase*2+10000)%5)];}
void segmentDigit(int x,int y,int digit,uint16_t c){
  static const uint8_t masks[]={0x3f,0x06,0x5b,0x4f,0x66,0x6d,0x7d,0x07,0x7f,0x6f};
  int pos[7][4]={{6,0,31,6},{37,6,6,33},{37,45,6,33},{6,78,31,6},{0,45,6,33},{0,6,6,33},{6,39,31,6}};
  for(int i=0;i<7;i++)if(themeIndex==3)ui.fillRoundRect(x+pos[i][0],y+pos[i][1],pos[i][2],pos[i][3],2,(masks[digit]&(1<<i))?c:themePanel);else ui.fillRect(x+pos[i][0],y+pos[i][1],pos[i][2],pos[i][3],(masks[digit]&(1<<i))?c:themePanel);
}
void prismClock(){
  header("PRISM",dateText());String clock=clockText();
  int digits[]={clock.substring(0,1).toInt(),clock.substring(1,2).toInt(),clock.substring(3,4).toInt(),clock.substring(4,5).toInt()};
  // Lying down: four digits in a row. Standing up: hours above minutes.
  for(int i=0;i<4;i++){int x=tall()?12+(i%2)*112:13+i*75,y=tall()?64+(i/2)*106:51,w=tall()?104:69,h=tall()?100:135;uint16_t c=i<2?themeColor(0x07ff):themeColor(0xf81f);
    ui.fillRect(x,y,w,h,themeColor(0x1083));ui.drawRect(x,y,w,h,c);segmentDigit(x+(w-43)/2,y+(h-84)/2,digits[i],c);}
  for(int i=0;i<60;i++){int x=tall()?12+i*36/10:13+i*5;ui.fillRect(x,tall()?280:203,tall()?2:3,7,i<=secondNow()?vivid(i*.08f):themeColor(0x18a4));}
}
// Home screen's SETTINGS button and the FOCUS / STOPWATCH hold buttons, shared by drawing and touch.
int homeSettingsY(){return tall()?252:183;}
bool homeSettingsAt(int x,int y){return y>=homeSettingsKeyY()-2&&y<homeSettingsKeyY()+36;}  // the SETTINGS key under the home tiles
int timerButtonY(){return tall()?248:181;}
void drawShowcase(int n){
  float t=millis()*.001f;int cx=W/2;bool up=tall();
  if(n==0){drawHome();  // HOME: shortcut tiles (home_keys.h)
  }else if(n==1){prismClock();
  }else if(n==2){
    header("SPLIT",dateText());String s=clockText();
    if(up){ui.fillRect(10,64,220,110,themeColor(0x07ff));ui.fillRect(10,182,220,110,themeColor(0xf81f));text(s.substring(0,2),cx,112,7,themeBg,MC_DATUM);text(s.substring(3),cx,230,7,ink,MC_DATUM);text("HOURS",cx,160,1,themeBg,MC_DATUM);text("MINUTES",cx,278,1,ink,MC_DATUM);}
    else{ui.fillRect(10,48,146,160,themeColor(0x07ff));ui.fillRect(164,48,146,160,themeColor(0xf81f));text(s.substring(0,2),83,107,7,themeBg,MC_DATUM);text(s.substring(3),237,107,7,ink,MC_DATUM);text("HOURS",83,181,1,themeBg,MC_DATUM);text("MINUTES",237,181,1,ink,MC_DATUM);}
  }else if(n>=3&&n<=11){drawPCCluster(n-3);
  }else if(n==12){
    header("TYPE / TIME",dateText());
    if(up){ui.fillRect(10,64,220,228,themeColor(0xfd20));String s=clockText();text(s.substring(0,2),cx,120,7,themeBg,MC_DATUM);ui.fillRect(40,176,160,3,themeBg);text(s.substring(3),cx,226,7,themeBg,MC_DATUM);text(String(secondNow())+" SECONDS",cx,276,2,themeBg,MC_DATUM);}
    else{ui.fillRect(10,48,300,161,themeColor(0xfd20));text(clockText(),160,109,7,themeBg,MC_DATUM);text(String(secondNow())+" SECONDS",160,181,2,themeBg,MC_DATUM);}
  }else if(n==13){
    header("BINARY / TIME",dateText());String s=clockText();int vals[]={s.substring(0,2).toInt(),s.substring(3).toInt(),secondNow()};const char *lbl[]={"HH","MM","SS"};
    for(int r=0;r<3;r++){int ly=up?88+r*78:64+r*55;text(lbl[r],up?8:12,ly,2,accents[r]);
      for(int c=0;c<6;c++){int x=up?42+c*33:56+c*42,y=up?66+r*78:47+r*55,w=up?29:35,h=up?62:39;bool on=vals[r]&(1<<(5-c));ui.fillRect(x,y,w,h,on?accents[r]:themeColor(0x18a4));text(String(1<<(5-c)),x+w/2,y+h/2,1,on?themeBg:muted,MC_DATUM);}}
  }else if(n==14){
    header("FOCUS",focusRunning?"RUNNING":"PAUSED");
    if(up){ui.drawRect(10,64,220,160,accent);text(duration(focusMs),cx,130,7,ink,MC_DATUM);ui.fillRect(16,204,208,9,panel);ui.fillRect(16,204,int(208*float(focusMs)/(25*60000)),9,accent);}
    else{ui.drawRect(10,47,300,119,accent);text(duration(focusMs),160,100,7,ink,MC_DATUM);ui.fillRect(14,153,292,9,panel);ui.fillRect(14,153,int(292*float(focusMs)/(25*60000)),9,accent);}
    button(focusRunning?"HOLD: PAUSE":focusMs?"HOLD: START":"HOLD: AGAIN",cx-80,timerButtonY(),160);
  }else if(n==15){
    header("STOPWATCH",watchRunning?"RUNNING":"READY");text(duration(watchMs),cx,up?130:93,7,themeColor(0xf81f),MC_DATUM);char cs[8];snprintf(cs,sizeof(cs),".%02lu",(unsigned long)(watchMs%1000/10));text(cs,cx,up?190:145,4,ink,MC_DATUM);
    int bw=up?106:146;button(watchRunning?"HOLD: STOP":"HOLD: START",10,timerButtonY(),bw);button("HOLD: RESET",W-10-bw,timerButtonY(),bw,false);
  }
}
