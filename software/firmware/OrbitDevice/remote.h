int pcVolume=-1,volDrag=-1;  // PC master volume 0-100 (-1 unknown) and the level being dragged
// Where each page's controls sit, lying down or standing up. Drawing and touch both use these.
int privacyDeleteY(){return tall()?190:153;}
int privacyLowerY(){return tall()?236:193;}
int musicTop(){return tall()?98:99;}
int musicRow(int r){return tall()?98+r*42:99;}  // standing up the four music keys are two rows of two
int volY(){return tall()?186:151;}int volW(){return tall()?160:240;}
bool volumeBarAt(int x,int y){return y>=volY()-6&&y<=volY()+40&&x<10+volW()+2;}
// Two small keys on the music page, each w wide: BT (a speaker icon; boots the Orbit Speaker program)
// and VE in rainbow colours (the full-screen VISUALS page).
void musicExtras(int x,int y,int w){
  button("",x,y,w,false);uint16_t c=buttonPressed&&pressedX>=x&&pressedX<x+w&&pressedY>=y&&pressedY<y+34?0x0000:ink;
  int ix=x+w/2-16;ui.fillRect(ix,y+13,5,8,c);ui.fillTriangle(ix+4,y+17,ix+11,y+9,ix+11,y+25,c);
  ui.drawLine(ix+14,y+12,ix+16,y+17,c);ui.drawLine(ix+16,y+17,ix+14,y+22,c);text("BT",ix+21,y+17,2,c,ML_DATUM);
  int vx=x+w+4;
  for(int i=0;i<w;i++){uint8_t h[3];ledHue(uint8_t(i*255/w+millis()/12),h);ui.drawFastVLine(vx+i,y,34,ui.color565(h[0],h[1],h[2]));}
  ui.drawRect(vx,y,w,34,ink);text("VE",vx+w/2+1,y+18,4,0x0000,MC_DATUM);text("VE",vx+w/2,y+17,4,0xffff,MC_DATUM);
}
int appTop(){return tall()?60:47;}int appStep(){return tall()?38:50;}
int cameraTop(){return tall()?176:150;}
int cameraRow(int r){return tall()?182+r*40:157+r*37;}  // Sentry buttons: 2 x 3 standing up, 3 x 2 lying down
void drawPrivacy(){
 header("PRIVACY GUARD",pcLive()?"READY":"PC OFFLINE");
 int t=topY();bool up=tall();
 if(up){text("Emergency",12,t+4,4,themeChart(1));text("cleanup",12,t+30,4,themeChart(1));}else text("Emergency cleanup",14,47,4,themeChart(1));
 int y=up?t+64:82;
 text(String(privacyBrowserCount)+" browser categories",up?12:14,y,2,ink);
 text(String(privacyFolderCount)+" personal folders",up?12:14,y+23,2,ink);
 text(remoteResult=="Ready"?"Only your configured targets.":remoteResult.substring(0,up?36:45),up?12:14,y+47,1,muted);
 button("HOLD: REVIEW DELETE",10,privacyDeleteY(),W-20,false,0xf800);
 int bw=up?106:145;button("LOCK PC",10,privacyLowerY(),bw,false);button("SIGN OUT",W-10-bw,privacyLowerY(),bw,false);
 if(!privacyBrowserCount&&!privacyFolderCount)text("Select targets in the PC app first.",W/2,up?284:143,1,muted,MC_DATUM);
}
void drawRemote(){
  if(page==20){drawPrivacy();return;}
  if(page==21){drawVoice();return;}
  if(page==22){drawLights();return;}
  if(page==23){drawHue();return;}
  bool up=tall();int cx=W/2;
  if(page==16){
    if(aiId.length()){drawCompanion();return;}
    header("AI DESK",pcLive()?"WI-FI":"OFFLINE");
    if(up){text("A little",18,72,4,accent);text("intelligence.",18,98,4,accent);wrapped("Ask for a PC health summary, or send a question from Orbit Setup on your PC.",18,136,204,4,ink);}
    else{text("A little intelligence.",18,52,4,accent);wrapped("Ask for a PC health summary, or send a question from Orbit Setup on your PC.",18,92,284,3,ink);}
    int by=replyTop()-24,bw=up?106:145;button("PC HEALTH",up?10:12,by,bw);button("CHECK IN",W-12-bw,by,bw,false);
    text(remoteResult,cx,up?290:211,1,muted,MC_DATUM);
  }else if(page==17){
    header("MUSIC REMOTE",pcLive()?"PC AUDIO":"OFFLINE");
    int shown=volDrag>=0?volDrag:pcVolume,vy=volY(),vw=volW();
    if(up){
      text("Keep it playing.",12,64,2,accent);
      button("PREV",10,musicRow(0),106,false);button("NEXT",124,musicRow(0),106,false);
      button("PLAY/PAUSE",10,musicRow(1),106);button("STOP",124,musicRow(1),106,false);
    }else{
      text("Keep it playing.",18,49,2,accent);
      musicExtras(170,47,68);
      button("PREV",10,99,70,false);button("PLAY/PAUSE",84,99,80);button("STOP",168,99,66,false);button("NEXT",238,99,72,false);
    }
    // Volume meter: slide a finger along it to set the PC's volume (sent when you let go).
    ui.fillRect(10,vy,vw,34,panel);ui.drawRect(10,vy,vw,34,accent);
    if(shown>0)ui.fillRect(12,vy+2,(vw-4)*shown/100,30,accent);
    for(int i=1;i<10;i++)ui.drawFastVLine(10+i*vw/10,vy+29,5,muted);
    text(shown>=0?"VOLUME "+String(shown)+"%":"VOLUME",10+vw/2,vy+17,2,shown>45?themeBg:ink,MC_DATUM);
    button("MUTE",W-62,vy,52,false);
    text("SLIDE THE BAR FOR VOLUME",cx,vy+43,1,muted,MC_DATUM);text(remoteResult,cx,vy+60,1,ink,MC_DATUM);
    if(up)musicExtras(10,258,106);
    if(pcLive())for(int i=0;i<(up?14:20);i++)ui.fillRect(12+i*15,up?86:80,11,3,accents[(i+millis()/200)%5]);
  }else if(page==18){
    header("APP LAUNCHER",pcLive()?"YOUR PC":"OFFLINE");
    for(int i=0;i<6;i++){int x=up?10:10+(i%2)*155,y=up?appTop()+i*appStep():appTop()+(i/2)*appStep(),w=up?220:145;button(appLabels[i].substring(0,up?20:16),x,y,w,false);ui.fillRect(x,y,4,34,accents[i%5]);}
    text(""+remoteResult,cx,up?293:210,1,muted,MC_DATUM);
  }else if(page==19){
    if(cameraFullscreen){
      // Lying down: 2x (320 x 180). Standing up: 1.5x across the width (240 x 135), in the middle.
      if(cameraValid&&cameraFrame){
        if(up){for(int y=0;y<135;y++)for(int x=0;x<240;x++){int i=((y*2/3)*160+x*2/3)*2;ui.drawPixel(x,92+y,uint16_t(cameraFrame[i]<<8|cameraFrame[i+1]));}}
        else{for(int y=0;y<180;y++)for(int x=0;x<320;x++){int i=((y/2)*160+x/2)*2;ui.drawPixel(x,30+y,uint16_t(cameraFrame[i]<<8|cameraFrame[i+1]));}}
      }
      text(cameraState,8,8,2,ink);text("TAP TO EXIT",W-10,H-18,1,ink,TR_DATUM);return;
    }
    header("SENTRY",pcLive()?cameraState:"PC OFFLINE");
    int sy=up?62:35,py=up?74:50;
    text(sentryArmed?"MOTION WATCH ON":"CAMERA ON DEMAND",8,sy,1,sentryArmed?accents[1]:muted);
    text(String(cameraClips)+" CLIPS",W-10,sy,1,muted,TR_DATUM);
    if(cameraState=="Recording"&&(millis()/400)%2==0)ui.fillCircle(W-70,sy+3,3,accents[1]);
    if(cameraValid&&cameraFrame){int px=(W-160)/2;for(int y=0;y<90;y++)for(int x=0;x<160;x++){int i=(y*160+x)*2;ui.drawPixel(px+x,py+y,uint16_t(cameraFrame[i]<<8|cameraFrame[i+1]));}ui.drawRect(px-2,py-2,164,94,accent);}
    else wrapped("Preview your webcam, record manually, or arm Sentry for motion clips.",18,py+11,W-36,3,ink);
    int my=cameraTop()-4;ui.fillRect(10,my,W-20,4,panel);ui.fillRect(10,my,constrain(int(cameraMotion*(W-20)/100),0,W-20),4,accent);
    uint16_t rec=cameraState=="Recording"&&(millis()/400)%2?0x7800:0xf800;
    if(up){
      button("SNAP",10,cameraRow(0),106);button("PREVIEW",124,cameraRow(0),106,false);
      button("STOP",10,cameraRow(1),106,false);button("RECORD",124,cameraRow(1),106,false,rec);
      button(sentryArmed?"ARMED":"ARM",10,cameraRow(2),106,sentryArmed);button("FULL",124,cameraRow(2),106,false);
    }else{
      button("SNAP",6,157,97);button("PREVIEW",112,157,97,false);button("STOP",218,157,96,false);
      button("RECORD",6,194,97,false,rec);button(sentryArmed?"ARMED":"ARM",112,194,97,sentryArmed);button("FULL",218,194,96,false);
    }
  }
}
bool remoteHold(int x,int y){
  bool up=tall();int half=W/2;
  if(page==20){if(y>=privacyLowerY()&&y<privacyLowerY()+34){requestRemote(x<half?"privacy:lock":"privacy:signout");return true;}if(y>=privacyDeleteY()&&y<privacyDeleteY()+34){remoteResult="Hold to review deletion";return true;}return false;}
  if(page==16){
    int by=replyTop()-24;
    if(y>=by&&y<by+34&&!aiId.length()){requestRemote(x<half?"ai:health":"ai:checkin");return true;}
    if(aiId.length()&&y>topY()-4&&y<topY()+(up?52:44)){requestRemote("ai:dismiss");return true;}
  }
  if(page==17){
    // All music keys go through the laptop link, which presses the Windows media keys, so the
    // music page works without the PC companion app. Lying down: PREV | PLAY/PAUSE | STOP | NEXT;
    // standing up: PREV | NEXT over PLAY/PAUSE | STOP, and BT | VE along the bottom.
    const char *action=nullptr;
    if(up){
      if(y>=258&&y<292){if(x<half)speakerEnter();else setPage(109);return true;}
      if(y>=musicRow(0)&&y<musicRow(0)+34)action=x<half?"previous":"next";
      else if(y>=musicRow(1)&&y<musicRow(1)+34)action=x<half?"play":"stop";
    }else{
      if(y>=47&&y<81&&x>=170){if(x<240)speakerEnter();else setPage(109);return true;}
      if(y>=99&&y<=133){const char *keys[]={"previous","play","stop","next"};action=keys[x<82?0:x<166?1:x<236?2:3];}
    }
    if(!action&&y>=volY()&&y<=volY()+34&&x>=W-64)action="mute";
    if(action){pendingX=pressedX;pendingY=pressedY;remotePage=page;remoteResult=laptopMedia(action)?"Sending...":"Laptop link offline";feedbackUntil=millis()+350;return true;}}
  if(page==18&&y>=appTop()){
    int i=up?(y-appTop())/appStep():((y-appTop())/appStep())*2+(x>=half?1:0);
    if(up?i>=6:y>=appTop()+3*appStep())return false;
    if(appLabels[i]!="Not set")requestRemote("app:"+String(i));return true;}
  if(page==19&&cameraFullscreen){cameraFullscreen=false;return true;}
  if(page==19&&y>=cameraTop()){
    // Which button: SNAP PREVIEW STOP / RECORD ARM FULL, in reading order either way up.
    int i=-1;
    if(up){for(int r=0;r<3;r++)if(y>=cameraRow(r)-3&&y<cameraRow(r)+37)i=r*2+(x>=half?1:0);}
    else{int r=y<192?0:1;if(y<=228)i=r*3+(x<107?0:x<215?1:2);}
    const char *order[]={"camera:snap","camera:live","camera:stop","camera:record","arm","full"};
    if(i<0)return false;
    const char *a=order[i];
    if(!strcmp(a,"full")){cameraFullscreen=true;return true;}
    if(!strcmp(a,"arm")){requestRemote(sentryArmed?"camera:disarm":"camera:arm");return true;}
    requestRemote(a);return true;
  }
  return false;
}
