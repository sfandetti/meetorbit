// ORBIT RUN page (27): fly a little ship up a winding canyon on an alien planet. Hold the left or right half
// of the screen to steer (holds read better than swipes on this touchscreen). Dodge rocks and drones, grab
// green fuel cells before the gauge runs dry; the canyon narrows and speeds up the further you get. Tap to
// start, tap after a crash to fly again. Leaving the page pauses the run. Best distance is kept.
const int RUN_OBJS=10;
struct RunObj{float x,wy,vx;uint8_t kind;bool live;};  // kind 0 rock, 1 drone, 2 fuel cell
RunObj runObj[RUN_OBJS];
int runState=0;  // 0 title, 1 flying, 2 paused, 3 crashed
float runWorld=0,runSpeed=0,runShipX=0,runShipV=0,runFuel=100,runNextObj=0;uint32_t runLastAt=0,runFxAt=0;int runFx=0;  // runFx: 1 fuel, 2 crash
int runTop(){return tall()?60:32;}  // below the header (standing up the title has its own row)
int runShipY(){return H-(tall()?70:52);}
// The canyon at a height in the world: its middle and half-width (it winds, and narrows as you go).
float runMid(float wy){return W/2+W*0.22f*sinf(wy*0.0042f)+W*0.1f*sinf(wy*0.0113f+1.3f);}
float runHalf(float wy){float base=W*(tall()?0.36f:0.3f)-wy*0.0035f;return max(W*(tall()?0.16f:0.13f),base)+8*sinf(wy*0.02f);}
float runWorldAt(int sy){return runWorld+(runShipY()-sy);}  // screen row -> world height (the ship sits at runWorld)
uint32_t runBest(){return prefs.getUInt("runbest",0);}
void runReset(){runWorld=0;runSpeed=70;runShipX=runMid(0);runShipV=0;runFuel=100;runNextObj=260;for(auto &o:runObj)o.live=false;}
void runSpawn(){
 for(auto &o:runObj)if(!o.live){
  float wy=runWorld+H+20,mid=runMid(wy),half=runHalf(wy);long r=random(100);
  o.kind=r<28?2:r<55&&runWorld>600?1:0;o.wy=wy;o.x=mid+random(-int(half*0.7f),int(half*0.7f)+1);o.vx=o.kind==1?(random(2)?40:-40):0;o.live=true;
  break;}
 runNextObj=runWorld+max(70.f,170-runWorld*0.01f)+random(60);
}
void runCrash(){runState=3;runFx=2;runFxAt=millis();ledDirty=true;sfxPlay(2);uint32_t d=uint32_t(runWorld/10);if(d>runBest())prefs.putUInt("runbest",d);}
// One step of the game: steering from a held finger, scrolling, objects, fuel, crashes.
void runStep(float dt){
 bool pen=digitalRead(36)==LOW&&buttonPressed&&pressedY>=runTop();
 float steer=pen?(pressedX<W/2?-1:1):0;
 runShipV+=steer*520*dt;runShipV*=powf(0.06f,dt);runShipX+=runShipV*dt;  // push, with drag so it settles
 runSpeed=min(240.f,runSpeed+3.5f*dt);runWorld+=runSpeed*dt;runFuel-=dt*(3+runSpeed/80);
 if(runWorld>=runNextObj)runSpawn();
 float mid=runMid(runWorld),half=runHalf(runWorld);
 if(runShipX-5<mid-half||runShipX+5>mid+half||runFuel<=0){runFuel=max(0.f,runFuel);runCrash();return;}
 for(auto &o:runObj){if(!o.live)continue;
  if(o.kind==1){o.x+=o.vx*dt;float m=runMid(o.wy),h=runHalf(o.wy);if(o.x<m-h+8||o.x>m+h-8)o.vx=-o.vx;}
  if(o.wy<runWorld-40){o.live=false;continue;}
  float dx=o.x-runShipX,dy=o.wy-runWorld,r=o.kind==2?11:o.kind==1?10:9;
  if(dx*dx+dy*dy<r*r){if(o.kind==2){runFuel=min(100.f,runFuel+35);o.live=false;runFx=1;runFxAt=millis();ledDirty=true;sfxPlay(1);}else{runCrash();return;}}}
}
// Leaving the page pauses a run (called every loop).
void runLoop(){if(page!=27&&runState==1)runState=2;}
bool runTap(int x,int y){
 if(y<runTop())return false;
 if(runState==0||runState==3){runReset();runState=1;runLastAt=millis();}
 else if(runState==2){runState=1;runLastAt=millis();}
 return true;  // taps on the canyon never change page
}
bool runOwnsTouch(int x,int y){return page==27&&y>=runTop();}
void drawRun(){
 uint32_t now=millis();header("ORBIT RUN");
 if(runState==1){float dt=min(0.1f,(now-runLastAt)/1000.f);runLastAt=now;runStep(dt);}
 if(runState==0&&runShipX==0)runReset();
 int top=runTop();ui.fillRect(0,top,W,H-top,ui.color565(40,18,30));  // the canyon floor
 uint16_t rock=ui.color565(150,70,40),rim=ui.color565(230,140,70),dark=ui.color565(90,40,25);
 for(int y=top;y<H;y+=4){float wy=runWorldAt(y),m=runMid(wy),h=runHalf(wy);int l=int(m-h),r=int(m+h);
  ui.fillRect(0,y,max(0,l),4,(int(wy/24)%2)?rock:dark);if(r<W)ui.fillRect(r,y,W-r,4,(int(wy/24)%2)?rock:dark);
  ui.fillRect(l-2,y,2,4,rim);ui.fillRect(r,y,2,4,rim);
  if((int(wy)%36)<4)ui.fillRect(int(m)-1,y,2,2,ui.color565(90,50,70));}  // little marks on the floor show the speed
 for(auto &o:runObj){if(!o.live)continue;int sx=int(o.x),sy=runShipY()-int(o.wy-runWorld);if(sy<top-12||sy>H+12)continue;
  if(o.kind==2){ui.fillRoundRect(sx-5,sy-8,10,16,3,ui.color565(60,230,110));ui.fillRect(sx-2,sy-4,4,8,0xffff);}  // fuel cell
  else if(o.kind==1){ui.fillTriangle(sx,sy-9,sx-9,sy,sx+9,sy,ui.color565(230,40,60));ui.fillTriangle(sx,sy+9,sx-9,sy,sx+9,sy,ui.color565(160,20,40));ui.fillCircle(sx,sy,3,(now/150)%2?0xffff:ui.color565(255,220,0));}  // drone
  else{ui.fillCircle(sx,sy,9,ui.color565(110,100,110));ui.fillCircle(sx-3,sy-3,3,ui.color565(160,150,160));}}  // rock
 int sx=int(runShipX),sy=runShipY();  // the ship: a little rocket with a flickering flame
 if(runState!=3){ui.fillTriangle(sx,sy-12,sx-7,sy+6,sx+7,sy+6,ui.color565(200,220,255));ui.fillRect(sx-2,sy-5,4,4,ui.color565(60,140,255));
  ui.fillTriangle(sx-4,sy+6,sx+4,sy+6,sx,sy+10+int(random(6)),ui.color565(255,160,0));}
 else{for(int k=0;k<10;k++){float a=k*0.628f,d=6+(now-runFxAt)/30%18;ui.fillCircle(sx+int(cosf(a)*d),sy+int(sinf(a)*d),2,k%2?ui.color565(255,200,0):ui.color565(255,60,0));}}
 // The gauge and the distance along the top of the canyon.
 int gw=tall()?90:110;ui.fillRect(6,top+4,gw,8,0x0000);ui.fillRect(7,top+5,int((gw-2)*runFuel/100),6,runFuel<25&&(now/250)%2?ui.color565(255,40,40):ui.color565(60,230,110));
 text("FUEL",8+gw,top+8,1,0xffff,ML_DATUM);text(String(int(runWorld/10))+" m",W-6,top+8,2,0xffff,MR_DATUM);
 if(runState!=1){int bw=tall()?210:240,bh=70,bx=(W-bw)/2,by=top+(H-top)/2-bh/2;
  ui.fillRect(bx,by,bw,bh,0x0000);ui.drawRect(bx,by,bw,bh,rim);ui.drawRect(bx+1,by+1,bw-2,bh-2,rim);
  if(runState==0){text("ORBIT RUN",W/2,by+16,4,rim,MC_DATUM);text("Hold left or right to steer",W/2,by+38,1,0xffff,MC_DATUM);}
  else if(runState==2){text("PAUSED",W/2,by+18,4,rim,MC_DATUM);text("Tap to keep flying",W/2,by+40,1,0xffff,MC_DATUM);}
  else{text(runFuel<=0?"OUT OF FUEL":"CRASHED!",W/2,by+16,4,ui.color565(255,70,70),MC_DATUM);uint32_t d=uint32_t(runWorld/10),best=runBest();
   text(String(d)+" m"+(d>=best?"  NEW BEST!":"  BEST "+String(best)+" m"),W/2,by+38,2,0xffff,MC_DATUM);}
  text(runState==2?"":"TAP TO FLY",W/2,by+58,1,muted,MC_DATUM);}
}
// The light ring: green on a fuel cell, red flashes on a crash, otherwise warmer the faster you fly.
bool runLedFrame(uint8_t px[][3]){
 if(page!=27)return false;uint32_t t=millis()-runFxAt;
 if(runFx==2&&t<1500){bool on=(t/150)%2==0;for(int i=0;i<LED_COUNT;i++){px[i][0]=on?255:40;px[i][1]=on?40:0;px[i][2]=0;}return true;}
 if(runFx==1&&t<400){for(int i=0;i<LED_COUNT;i++){px[i][0]=0;px[i][1]=255;px[i][2]=80;}return true;}
 if(runState!=1)return false;
 float k=(runSpeed-70)/170;for(int i=0;i<LED_COUNT;i++){bool lit=(i+int(runWorld/40))%4==0;px[i][0]=uint8_t(lit?80+175*k:10);px[i][1]=uint8_t(lit?120-80*k:5);px[i][2]=uint8_t(lit?255-200*k:10);}return true;
}
