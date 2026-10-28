void drawPrivacy(){
 header("PRIVACY GUARD",pcLive()?"READY":"PC OFFLINE");
 text("Emergency cleanup",14,47,4,themeChart(1));
 text(String(privacyBrowserCount)+" browser categories",14,82,2,ink);
 text(String(privacyFolderCount)+" personal folders",14,105,2,ink);
 text(remoteResult=="Ready"?"Only your configured targets.":remoteResult.substring(0,45),14,129,1,muted);
 button("HOLD: REVIEW DELETE",10,153,300,false,0xf800);
 button("LOCK PC",10,193,145,false);button("SIGN OUT",165,193,145,false);
 if(!privacyBrowserCount&&!privacyFolderCount)text("Select targets in the PC app first.",160,143,1,muted,MC_DATUM);
}
void drawRemote(){
  if(page==20){drawPrivacy();return;}
  if(page==16){
    if(aiId.length()){drawCompanion();return;}
    header("AI DESK",pcLive()?"WI-FI":"OFFLINE");
    text("A little intelligence.",18,52,4,accent);
    wrapped("Ask for a PC health summary, or send a question from Orbit Setup on your PC.",18,92,284,3,ink);
    button("PC HEALTH",12,166,145);button("CHECK IN",166,166,142,false);
    text(remoteResult,160,211,1,muted,MC_DATUM);
  }else if(page==17){
    header("MUSIC REMOTE",pcLive()?"PC AUDIO":"OFFLINE");
    text("Keep it playing.",18,49,4,accent);
    button("PREVIOUS",10,99,92,false);button("PLAY/PAUSE",112,99,98);button("NEXT",220,99,90,false);
    button("VOL -",10,151,92,false);button("MUTE",112,151,98,false);button("VOL +",220,151,90,false);
    text("TAP A CONTROL",160,194,1,muted,MC_DATUM);text(remoteResult,160,211,1,ink,MC_DATUM);
    if(pcLive())for(int i=0;i<20;i++)ui.fillRect(12+i*15,80,11,3,accents[(i+millis()/200)%5]);
  }else if(page==18){
    header("APP LAUNCHER",pcLive()?"YOUR PC":"OFFLINE");
    for(int i=0;i<6;i++){int x=10+(i%2)*155,y=47+(i/2)*50;button(appLabels[i].substring(0,16),x,y,145,false);ui.fillRect(x,y,4,34,accents[i%5]);}
    text(""+remoteResult,160,210,1,muted,MC_DATUM);
  }else if(page==19){
    if(cameraFullscreen){
      if(cameraValid&&cameraFrame){for(int y=0;y<180;y++)for(int x=0;x<320;x++){int i=((y/2)*160+x/2)*2;ui.drawPixel(x,30+y,uint16_t(cameraFrame[i]<<8|cameraFrame[i+1]));}}
      text(cameraState,8,8,2,ink);text("TAP TO EXIT",310,222,1,ink,TR_DATUM);return;
    }
    header("SENTRY",pcLive()?cameraState:"PC OFFLINE");
    text(sentryArmed?"MOTION WATCH ON":"CAMERA ON DEMAND",8,35,1,sentryArmed?accents[1]:muted);
    text(String(cameraClips)+" CLIPS",310,35,1,muted,TR_DATUM);
    if(cameraValid&&cameraFrame){for(int y=0;y<90;y++)for(int x=0;x<160;x++){int i=(y*160+x)*2;ui.drawPixel(80+x,50+y,uint16_t(cameraFrame[i]<<8|cameraFrame[i+1]));}ui.drawRect(78,48,164,94,accent);}
    else wrapped("Preview your webcam, record manually, or arm Sentry for motion clips.",18,61,284,3,ink);
    ui.fillRect(10,146,300,4,panel);ui.fillRect(10,146,constrain(int(cameraMotion*3),0,300),4,accent);
    button("SNAP",6,157,97);button("PREVIEW",112,157,97,false);button("STOP",218,157,96,false);
    button("RECORD",6,194,97,false,cameraState=="Recording"&&(millis()/400)%2?0x7800:0xf800);button(sentryArmed?"ARMED":"ARM",112,194,97,sentryArmed);button("FULL",218,194,96,false);
    if(cameraState=="Recording"&&(millis()/400)%2==0)ui.fillCircle(300,17,3,accents[1]);

  }
}
bool remoteHold(int x,int y){
  if(page==20){if(y>=193&&y<227){requestRemote(x<160?"privacy:lock":"privacy:signout");return true;}if(y>=153&&y<187){remoteResult="Hold to review deletion";return true;}return false;}
  if(page==16){
    if(y>=166&&y<200&&!aiId.length()){requestRemote(x<160?"ai:health":"ai:checkin");return true;}
    if(aiId.length()&&y>32&&y<80){requestRemote("ai:dismiss");return true;}
  }
  if(page==17){int col=x<107?0:x<215?1:2;if(y>=99&&y<=133){const char *c[]={"media:previous","media:play","media:next"};requestRemote(c[col]);return true;}if(y>=151&&y<=185){const char *c[]={"media:quieter","media:mute","media:louder"};requestRemote(c[col]);return true;}}
  if(page==18&&y>=47&&y<197){int i=((y-47)/50)*2+(x>=160?1:0);if(appLabels[i]!="Not set")requestRemote("app:"+String(i));return true;}
  if(page==19&&cameraFullscreen){cameraFullscreen=false;return true;}
  if(page==19&&y>=150&&y<192){requestRemote(x<107?"camera:snap":x<215?"camera:live":"camera:stop");return true;}
  if(page==19&&y>=192&&y<=228){if(x>=215){cameraFullscreen=true;return true;}requestRemote(x<107?"camera:record":sentryArmed?"camera:disarm":"camera:arm");return true;}
  return false;
}
