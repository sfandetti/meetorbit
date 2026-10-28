// Physical 320x240 views. Backgrounds and layouts render on the ESP32.
int wallpaperIndex=0;bool deviceUiOverride=false;float deviceNetworkMbps=1000,deviceThermalWarm=70,deviceThermalHigh=90;
const char* deviceThemeNames[]={"Corporate","Arcade","Flight Deck","Pocket Pal","Field Notes"};
void deviceBackdrop(){
 if(!wallpaperIndex)return;
 for(int y=0;y<240;y++){
  uint16_t a=wallpaperIndex==3?0x2008:0x0126,b=wallpaperIndex==3?0xcb88:0x2351;
  ui.drawFastHLine(0,y,320,themeBlend(a,b,y*75/240));
 }
 if(wallpaperIndex==2){for(int x=0;x<320;x+=20)ui.drawFastVLine(x,0,240,0x1949);for(int y=0;y<240;y+=20)ui.drawFastHLine(0,y,320,0x1949);}
 if(wallpaperIndex==1)for(int x=0;x<320;x+=3){int y=95+int(sinf(x*.019f)*24);ui.drawFastVLine(x,y,40,themeBlend(0x064c,0x0110,(x/4)%100));}
}
void deviceArc(int cx,int cy,int r,float fraction,uint16_t c,int thick=4){
 for(int n=0;n<55;n++){float a=(135+n*270.f/54)*PI/180;uint16_t col=n<=fraction*54?c:themeBorder;for(int k=0;k<thick;k++)ui.fillCircle(cx+cosf(a)*(r-k),cy+sinf(a)*(r-k),1,col);}
}
void deviceGauge(int x,int y,int w,int h,const String& label,float value,const String& suffix,uint16_t color){
 if(themeIndex==4){ui.drawFastHLine(x,y+h-1,w,themeBorder);text(label,x+3,y+2,1,themeInk);text(String(value,0)+suffix,x+w-3,y+19,2,color,TR_DATUM);for(int n=0;n<10;n++)ui.drawFastVLine(x+n*w/10,y+h-7,n%2?3:6,themeMuted);}
 else if(themeIndex==1||themeIndex==2){int r=min(w/2-3,h/2-6);deviceArc(x+w/2,y+h/2+3,r,constrain(value/100.f,0.f,1.f),color,themeIndex==1?6:2);if(themeIndex==2){float a=(135+constrain(value,0.f,100.f)*2.7f)*PI/180;ui.drawLine(x+w/2,y+h/2+3,x+w/2+cosf(a)*(r-4),y+h/2+3+sinf(a)*(r-4),color);}text(label,x+w/2,y+2,1,themeInk,TC_DATUM);text(String(value,0)+suffix,x+w/2,y+h/2+6,1,color,MC_DATUM);}
 else{ui.fillRoundRect(x,y,w,h,themeIndex==3?12:3,themePanel);text(label,x+5,y+5,1,themeMuted);text(String(value,0)+suffix,x+5,y+20,2,color);ui.fillRoundRect(x+5,y+h-10,w-10,5,2,themeBorder);ui.fillRoundRect(x+5,y+h-10,max(1,int((w-10)*constrain(value/100.f,0.f,1.f))),5,2,color);}
}
bool drawDeviceView(int n){
 if(n==21||n==0){drawDeviceFace();return true;}
 if(n==22){drawDeviceTerminal();return true;}
 if(n==1||n==12){
  deviceBackdrop();text(dateText(),160,34,2,themeInk,MC_DATUM);
  if(themeIndex==2){int cx=160,cy=131,r=72;ui.drawCircle(cx,cy,r,themeInk);for(int i=0;i<12;i++){float a=i*PI/6;ui.fillCircle(cx+sinf(a)*(r-5),cy-cosf(a)*(r-5),2,themeInk);}String c=clockText();float h=c.substring(0,2).toInt()%12,m=c.substring(3).toInt();for(int k=0;k<2;k++){float a=(k?m/60.f:(h+m/60)/12.f)*2*PI;ui.drawLine(cx,cy,cx+sinf(a)*(k?58:40),cy-cosf(a)*(k?58:40),k?themeInk:accent);}}
  else{ui.setFreeFont(nullptr);ui.setTextFont(7);ui.setTextColor(themeInk);ui.setTextDatum(MC_DATUM);ui.drawString(clockText(),160,125);ui.setTextFont(1);if(themeIndex==4){ui.drawFastHLine(18,78,284,themeBorder);ui.drawFastHLine(18,170,284,themeBorder);}if(themeIndex==3){ui.drawRoundRect(8,60,304,130,18,accent);ui.fillCircle(22,61,12,accent);ui.fillCircle(298,61,12,accent);}}
  return true;
 }
 if(n==3||n==6||n==7||n==11){
  deviceBackdrop();int focus=n==6?3:n==7?4:0;float vals[]={pc.cpu,pc.gpu,pc.ram,pc.temp,pc.rx,pc.tx};const char* labels[]={"CPU","GPU","RAM","THERMAL","DOWN","UP"};
  if(n==11){for(int i=0;i<6;i++){uint16_t c=i==3?(vals[i]>=deviceThermalHigh?0xf800:vals[i]>=deviceThermalWarm?0xffe0:0x07e0):themeChart(i);deviceGauge(8+(i%3)*104,38+(i/3)*85,96,78,labels[i],vals[i],i==3?" C":i>3?" MB/s":"%",c);}text("DISK "+String(pc.disk,0)+"%",10,218,1,themeInk);text("POWER "+String(pc.power,0)+"W",310,218,1,themeInk,TR_DATUM);return true;}
  for(int i=0,k=0;i<6;i++)if(i!=focus){int x=k<3?6:238,y=40+(k%3)*55;deviceGauge(x,y,76,50,labels[i],vals[i],i==3?"C":i>3?"M":"%",themeChart(i));k++;}
  float pct=focus==3?constrain((vals[3]-20)/90.f,0.f,1.f):focus==4?constrain(vals[4]*8/max(1.f,deviceNetworkMbps),0.f,1.f):vals[0]/100.f;
  uint16_t c=focus==3?(vals[3]>=deviceThermalHigh?0xf800:vals[3]>=deviceThermalWarm?0xffe0:0x07e0):focus==4?(pct>.8?0xf800:pct>.5?0xffe0:0x07ff):accent;
  deviceArc(160,119,67,pct,c,themeIndex==1?9:themeIndex==4?2:5);text(labels[focus],160,76,2,c,MC_DATUM);text(String(vals[focus],0),160,120,7,themeInk,MC_DATUM);text(focus==3?"C":focus==4?"MB/s":"%",160,155,2,c,MC_DATUM);text("POWER "+String(pc.power,0)+"W",160,208,1,themeInk,MC_DATUM);return true;
 }
 if(n==14){deviceBackdrop();text(focusRunning?"ONE THING AT A TIME":"25-MINUTE WORK SESSION",160,48,1,themeInk,MC_DATUM);text(duration(focusMs),160,114,7,themeInk,MC_DATUM);deviceArc(160,113,92,1-float(focusMs)/(25*60000.f),accent,3);button(focusRunning?"PAUSE":"START FOCUS",30,180,260);return true;}
 return false;
}
