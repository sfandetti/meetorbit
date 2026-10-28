
uint16_t vivid(float phase){return themePacks[themeIndex][5+(int(phase*2+10000)%5)];}
void segmentDigit(int x,int y,int digit,uint16_t c){
  static const uint8_t masks[]={0x3f,0x06,0x5b,0x4f,0x66,0x6d,0x7d,0x07,0x7f,0x6f};
  int pos[7][4]={{6,0,31,6},{37,6,6,33},{37,45,6,33},{6,78,31,6},{0,45,6,33},{0,6,6,33},{6,39,31,6}};
  for(int i=0;i<7;i++)if(themeIndex==3)ui.fillRoundRect(x+pos[i][0],y+pos[i][1],pos[i][2],pos[i][3],2,(masks[digit]&(1<<i))?c:themePanel);else ui.fillRect(x+pos[i][0],y+pos[i][1],pos[i][2],pos[i][3],(masks[digit]&(1<<i))?c:themePanel);
}
void prismClock(){
  header("PRISM",dateText());String clock=clockText();
  int digits[]={clock.substring(0,1).toInt(),clock.substring(1,2).toInt(),clock.substring(3,4).toInt(),clock.substring(4,5).toInt()};
  for(int i=0;i<4;i++){int x=13+i*75;ui.fillRect(x,51,69,135,themeColor(0x1083));ui.drawRect(x,51,69,135,i<2?themeColor(0x07ff):themeColor(0xf81f));segmentDigit(x+13,75,digits[i],i<2?themeColor(0x07ff):themeColor(0xf81f));}
  for(int i=0;i<60;i++)ui.fillRect(13+i*5,203,3,7,i<=secondNow()?vivid(i*.08f):themeColor(0x18a4));
}
void drawShowcase(int n){
  float t=millis()*.001f;
  if(n==0){
    ui.fillRect(0,33,320,190,themeBg);ui.drawFastVLine(12,45,125,themeBorder);
    for(int i=0;i<22;i++){int x=(i*83+int(t*12))%320,y=38+(i*47)%176;ui.fillRect(x,y,3+i%4,3+i%4,vivid(i*.41f+t*.25f));}
    header("YOUR DESK");
    if(WiFi.isConnected()){big("Hello,",26,86,ink,ML_DATUM);ui.setTextFont(4);text(ownerName+".",26,133,ui.textWidth(ownerName+".")>270?2:4,accent);text(dateText(),26,198,1,ink);ui.fillRect(251,96,32,32,themeColor(0xf81f));ui.fillRect(274,119,20,20,themeColor(0x07ff));}
    else{big("Connecting",160,95,ink);text("WI-FI",160,142,2,themeColor(0x07ff),MC_DATUM);text(millis()>20000?"Open Settings to check Wi-Fi":"",160,188,2,muted,MC_DATUM);}
  button("SETTINGS",165,183,145,false);
  }else if(n==1){prismClock();
  }else if(n==2){
    header("SPLIT",dateText());String s=clockText();ui.fillRect(10,48,146,160,themeColor(0x07ff));ui.fillRect(164,48,146,160,themeColor(0xf81f));text(s.substring(0,2),83,107,7,themeBg,MC_DATUM);text(s.substring(3),237,107,7,ink,MC_DATUM);text("HOURS",83,181,1,themeBg,MC_DATUM);text("MINUTES",237,181,1,ink,MC_DATUM);
  }else if(n>=3&&n<=11){drawPCCluster(n-3);
  }else if(n==12){
    header("TYPE / TIME",dateText());ui.fillRect(10,48,300,161,themeColor(0xfd20));text(clockText(),160,109,7,themeBg,MC_DATUM);text(String(secondNow())+" SECONDS",160,181,2,themeBg,MC_DATUM);
  }else if(n==13){
    header("BINARY / TIME",dateText());String s=clockText();int vals[]={s.substring(0,2).toInt(),s.substring(3).toInt(),secondNow()};const char *lbl[]={"HH","MM","SS"};
    for(int r=0;r<3;r++){text(lbl[r],12,64+r*55,2,accents[r]);for(int c=0;c<6;c++){int x=56+c*42,y=47+r*55;bool on=vals[r]&(1<<(5-c));ui.fillRect(x,y,35,39,on?accents[r]:themeColor(0x18a4));text(String(1<<(5-c)),x+17,y+19,1,on?themeBg:muted,MC_DATUM);}}
  }else if(n==14){
    header("FOCUS",focusRunning?"RUNNING":"PAUSED");ui.drawRect(10,47,300,119,accent);text(duration(focusMs),160,100,7,ink,MC_DATUM);ui.fillRect(14,153,292,9,panel);ui.fillRect(14,153,int(292*float(focusMs)/(25*60000)),9,accent);button(focusRunning?"HOLD: PAUSE":focusMs?"HOLD: START":"HOLD: AGAIN",80,181,160);
  }else if(n==15){
    header("STOPWATCH",watchRunning?"RUNNING":"READY");text(duration(watchMs),160,93,7,themeColor(0xf81f),MC_DATUM);char cs[8];snprintf(cs,sizeof(cs),".%02lu",(unsigned long)(watchMs%1000/10));text(cs,160,145,4,ink,MC_DATUM);button(watchRunning?"HOLD: STOP":"HOLD: START",10,181,146);button("HOLD: RESET",164,181,146,false);
  }else if(n==29){
    header("QUIET",dateText());for(int x=14;x<310;x+=14)ui.drawFastVLine(x,43,172,themeColor(0x0821));big(clockText(),160,117,themeColor(0x73ae));ui.fillRect(80,175,160,2,themeColor(0x31a6));
  }
}
