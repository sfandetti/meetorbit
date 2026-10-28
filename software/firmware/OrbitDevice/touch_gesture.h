#pragma once

// End one contact only after a sustained release. Resistive-touch IRQ dropouts
// must not turn one finger press into several page transitions.
struct TouchGesture {
  enum Kind {NONE,TAP,HOLD,SWIPE_LEFT,SWIPE_RIGHT,DRAG,SWIPE_UP,SWIPE_DOWN};
  struct Event {Kind kind;int x,y,startY;};
  bool down=false;
  int startX=0,startY=0,lastX=0,lastY=0,startPage=0,samples=0,swipeSamples=0,verticalSamples=0,maxTravel=0;
  uint32_t started=0,lastContact=0;
  Event update(bool pressed,int x,int y,uint32_t now,int currentPage) {
    if(pressed){
      if(!down){
        down=true;startX=lastX=x;startY=lastY=y;started=now;
        startPage=currentPage;samples=0;swipeSamples=0;verticalSamples=0;maxTravel=0;
      }
      lastContact=now;samples++;
      lastX=(lastX*2+x)/3;lastY=(lastY*2+y)/3;
      int dx=abs(lastX-startX),dy=abs(lastY-startY);
      maxTravel=max(maxTravel,max(dx,dy));
      if(dx>=80&&dx>dy*3/2)swipeSamples++;else swipeSamples=0;
      if(dy>=65&&dy>dx*3/2)verticalSamples++;else verticalSamples=0;
      return {NONE,lastX,lastY,startY};
    }
    // The dedicated icon must resolve the release between two quick taps.
    // Keep the stronger noise filter everywhere else on the screen.
    uint32_t releaseMs=(startX>=W-144||startX<38)&&startY<32?60:120;
    if(!down||uint32_t(now-lastContact)<releaseMs)return {NONE,0,0,0};
    down=false;
    // A remotely displayed attention message cancels the gesture begun on
    // the previous page, so releasing a finger cannot skip the new message.
    if(samples<1||currentPage!=startPage)return {NONE,0,0,0};
    if(startPage==101&&abs(startY-(barY()+9))<32&&maxTravel>=18)return {DRAG,lastX,lastY,startY};
    if(swipeSamples>=2)return {lastX<startX?SWIPE_LEFT:SWIPE_RIGHT,lastX,lastY,startY};
    if(verticalSamples>=2)return {lastY<startY?SWIPE_UP:SWIPE_DOWN,lastX,lastY,startY};
    if(uint32_t(lastContact-started)>=650&&maxTravel<30)return {HOLD,lastX,lastY,startY};
    return {TAP,lastX,lastY,startY};
  }
};

// Dedicated icon avoids delaying ordinary single-tap page navigation.
struct QuickTapIcon {
  bool armed=false;uint32_t at=0;int onPage=-1;
  void cancel(){armed=false;}
  bool tap(uint32_t now,int page){
    if(armed&&page==onPage&&uint32_t(now-at)<=550){armed=false;return true;}
    armed=true;at=now;onPage=page;return false;
  }
};

bool quickTapSelfTest(){
  QuickTapIcon q;if(q.tap(100,0)||!q.tap(450,0)||q.tap(600,0))return false;
  q.cancel();if(q.tap(1000,0)||q.tap(1600,0)||!q.tap(1800,0))return false;
  q.cancel();if(q.tap(2000,0)||q.tap(2200,3))return false;
  q.cancel();if(q.tap(2400,3))return false;
  TouchGesture icon;icon.update(true,300,16,100,3);icon.update(true,300,16,140,3);
  if(icon.update(false,0,0,205,3).kind!=TouchGesture::TAP)return false;
  icon.update(true,300,16,240,3);icon.update(true,300,16,280,3);
  if(icon.update(false,0,0,345,3).kind!=TouchGesture::TAP)return false;
  TouchGesture up;up.update(true,160,205,100,3);
  for(int i=0;i<6;i++)up.update(true,160,30,140+i*40,3);
  if(up.update(false,0,0,460,3).kind!=TouchGesture::SWIPE_UP)return false;
  TouchGesture down;down.update(true,160,40,100,3);
  for(int i=0;i<6;i++)down.update(true,160,210,140+i*40,3);
  if(down.update(false,0,0,460,3).kind!=TouchGesture::SWIPE_DOWN)return false;
  return true;
}

// Exercise the actual gesture parser on the device, without injecting touches
// or changing pages. Includes the brief release noise that caused double taps.
bool gestureSelfTest() {
  using G=TouchGesture;
  G quick;quick.update(true,160,120,100,0);
  if(quick.update(false,0,0,220,0).kind!=G::TAP)return false;
  if(quick.update(false,0,0,400,0).kind!=G::NONE)return false;
  G g;
  g.update(true,160,120,100,0);g.update(true,161,121,140,0);
  if(g.update(false,0,0,180,0).kind!=G::NONE)return false;
  if(g.update(false,0,0,260,0).kind!=G::TAP)return false;
  if(g.update(false,0,0,500,0).kind!=G::NONE)return false;
  g=G();g.update(true,160,120,100,5);g.update(true,161,121,140,5);
  if(g.update(false,0,0,180,5).kind!=G::NONE)return false;
  g.update(true,159,120,220,5);
  if(g.update(false,0,0,280,5).kind!=G::NONE)return false;
  if(g.update(false,0,0,340,5).kind!=G::TAP)return false;
  g=G();g.update(true,160,200,100,3);g.update(true,160,200,800,3);
  if(g.update(false,0,0,920,3).kind!=G::HOLD)return false;
  g=G();g.update(true,250,100,100,0);g.update(true,180,100,140,0);
  g.update(true,100,100,180,0);g.update(true,50,100,220,0);g.update(true,20,100,260,0);
  if(g.update(false,0,0,380,0).kind!=G::SWIPE_LEFT)return false;
  g=G();g.update(true,50,157,100,101);g.update(true,150,157,140,101);g.update(true,250,157,180,101);
  if(g.update(false,0,0,300,101).kind!=G::DRAG)return false;
  g=G();g.update(true,160,120,100,0);g.update(true,160,120,140,0);
  if(g.update(false,0,0,260,3).kind!=G::NONE)return false;
  return true;
}
