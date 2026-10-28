// Real PC telemetry over Wi-Fi or USB. All motion interpolates received measurements.
// No invented sensor readings; a stale/disconnected bridge displays --.
struct PCMetrics {
  float cpu=-1,ram=-1,gpu=-1,temp=-1,vram=-1,watts=-1,fan=-1,drive=-1;
  float down=0,up=0,disk=0,ramUsed=0,ramTotal=0,driveFree=0,readMB=0,writeMB=0;
};
PCMetrics pc,shown;
uint32_t pcReceived=0,pcPackets=0,linkPcAt=0;  // linkPcAt: last reading from the laptop device link
float cpuTrace[60]={},gpuTrace[60]={},ramTrace[60]={},tempTrace[60]={},downTrace[60]={},upTrace[60]={};
int traceCount=0;
#define pcCyan themeColor(0x6e5f)
#define pcViolet themeColor(0xb4ff)
#define pcAmber themeColor(0xfd2c)
bool pcLive(){return pcPackets>0 && millis()-pcReceived<6000;}
String pcNumber(float v,int digits=0){return v>=0?String(v,digits):"--";}
void receivePC(const String &line) {
  PCMetrics next;
  int fields=sscanf(line.c_str()+3,"%f %f %f %f %f %f %f %f %f %f %f %f %f %f %f %f",
    &next.cpu,&next.ram,&next.gpu,&next.temp,&next.vram,&next.watts,&next.fan,&next.drive,
    &next.down,&next.up,&next.disk,&next.ramUsed,&next.ramTotal,&next.driveFree,&next.readMB,&next.writeMB);
  if(fields!=16 || !isfinite(next.cpu) || !isfinite(next.ram) || next.cpu>100 || next.ram>100)return;
  pc=next;pcReceived=millis();pcPackets++;
  for(int i=0;i<59;i++){cpuTrace[i]=cpuTrace[i+1];downTrace[i]=downTrace[i+1];upTrace[i]=upTrace[i+1];gpuTrace[i]=gpuTrace[i+1];ramTrace[i]=ramTrace[i+1];tempTrace[i]=tempTrace[i+1];}
  gpuTrace[59]=max(0.f,pc.gpu);ramTrace[59]=max(0.f,pc.ram);tempTrace[59]=max(0.f,pc.temp);cpuTrace[59]=max(0.f,pc.cpu);downTrace[59]=max(0.f,pc.down);upTrace[59]=max(0.f,pc.up);traceCount=min(60,traceCount+1);
  if(pcPackets==1)shown=pc;
}
void interpolatePC() {
  float *dest=(float*)&shown;const float *src=(const float*)&pc;
  for(unsigned i=0;i<sizeof(PCMetrics)/sizeof(float);i++) {
    if(src[i]<0)dest[i]=-1;else if(dest[i]<0)dest[i]=src[i];else dest[i]+=(src[i]-dest[i])*.16f;
  }
}

void spark(float *data,int x,int y,int w,int h,uint16_t color,bool fixed=false) {
  float maximum=fixed?100.f:1.f;
  for(int i=60-traceCount;i<60;i++)maximum=max(maximum,data[i]);
  for(int j=1;j<4;j++)ui.drawFastHLine(x,y+j*h/4,w,themeColor(0x18c3));
  if(!pcLive())return;
  for(int i=max(1,60-traceCount);i<60;i++) {
    int x0=x+(i-1)*w/59,x1=x+i*w/59;
    int y0=y+h-data[i-1]/maximum*h,y1=y+h-data[i]/maximum*h;
    ui.drawLine(x0,y0,x1,y1,color);
    ui.drawFastVLine(x1,y1,max(1,y+h-y1),themeBlend(themePanel,color,25));
  }
}
String rate(float kb) {if(kb<0||!pcLive())return "--";return kb>=1024?String(kb/1024,1)+"M":String(kb,0)+"K";}
void meter(int x,int y,int w,int h,float value,uint16_t c,int segments=20) {
  int gap=2,sw=max(1,(w-gap*(segments-1))/segments);
  int filled=pcLive()&&value>=0?constrain(int(value*segments/100+.5f),0,segments):0;
  for(int i=0;i<segments;i++)ui.fillRect(x+i*(sw+gap),y,sw,h,i<filled?c:themeColor(0x18c4));
}
void metricTile(int x,int y,int w,int h,const char *label,float value,const String &unit,float scale,uint16_t c) {
  themeTile(x,y,w,h);ui.fillRect(x,y,3,h,c);
  text(label,x+8,y+6,1,c);
  String v=pcLive()?pcNumber(value):"--";
  text(v,x+8,y+17,v.length()>5?2:4,ink);
  text(unit,x+w-6,y+28,1,muted,TR_DATUM);
  meter(x+8,y+h-9,w-16,4,value>=0?100*value/scale:-1,c,12);
}
// Standing up the description line sits under the title and is cut to the narrower screen.
void pcHeader(const String &title,const String &model) {
  header(title,pcLive()?"LIVE":"OFFLINE");
  if(!tall()){text(model,12,29,1,muted);return;}
  String s=model;if(s.length()>37){int cut=s.lastIndexOf(' ',37);s=s.substring(0,cut>0?cut:37);s.trim();}
  text(s,12,58,1,muted);
}
// A big reading with its unit just after it (standing up, where the number's width varies).
void bigReading(const String &v,const char *unit,int y,uint16_t c){text(v,12,y,7,c);ui.setFreeFont(themeFont(7));int w=ui.textWidth(v);text(unit,12+w+8,y+24,4,c);}
void drawPCCluster(int section) {
  interpolatePC();bool live=pcLive(),up=tall();
  if(section==0){
    pcHeader("PC / MATRIX",tall()?"LIVE FROM YOUR PC  /  -- = NOT REPORTED":"LIVE FROM YOUR PC  -  --  =  NOT REPORTED");
    float values[]={shown.cpu,shown.gpu,shown.ram,shown.temp,shown.vram,shown.watts,shown.fan,shown.drive,shown.disk};
    const char *labels[]={"CPU LOAD","GPU LOAD","RAM USED","GPU TEMP","VRAM USED","GPU POWER","GPU FAN","C: USED","DISK BUSY"};
    const char *units[]={"%","%","%","C","%","W","%","%","%"};
    uint16_t colors[]={themeColor(0x07ff),themeColor(0xf81f),themeColor(0x87e0),themeColor(0xfd20),themeColor(0xaaff),themeColor(0xfa80),themeColor(0x07b5),themeColor(0xffe0),themeColor(0x3bff)};
    for(int i=0;i<9;i++){if(up)metricTile(6+(i%3)*78,72+(i/3)*76,74,70,labels[i],values[i],units[i],i==5?400:100,colors[i]);else metricTile(8+(i%3)*103,44+(i/3)*58,98,53,labels[i],values[i],units[i],i==5?400:100,colors[i]);}
  }else if(section==1){
    pcHeader("CPU / PULSE","16 REAL SAMPLES / ALL CORES");
    if(up){
      bigReading(live?pcNumber(shown.cpu):"--","%",72,themeColor(0x07ff));
      text("GPU "+(live?pcNumber(shown.gpu)+"%":"--"),12,134,2,themeColor(0xf81f));text("RAM "+(live?pcNumber(shown.ram)+"%":"--"),128,134,2,themeColor(0x87e0));
      for(int i=0;i<16;i++){int x=12+i*27/2,bh=live?int(cpuTrace[44+i]*1.2f):0;ui.fillRect(x,168,10,120,themeColor(0x1083));if(bh)ui.fillRect(x,288-bh,10,bh,themeChart(i/4));}
      text("CPU LOAD HISTORY",12,293,1,muted);
    }else{
      text(live?pcNumber(shown.cpu):"--",12,45,7,themeColor(0x07ff));text("%",145,72,4,themeColor(0x07ff));
      text("GPU "+(live?pcNumber(shown.gpu)+"%":"--"),205,51,2,themeColor(0xf81f));
      text("RAM "+(live?pcNumber(shown.ram)+"%":"--"),205,77,2,themeColor(0x87e0));
      for(int i=0;i<16;i++){int bh=live?int(cpuTrace[44+i]*.83f):0;ui.fillRect(12+i*19,116,14,86,themeColor(0x1083));if(bh)ui.fillRect(12+i*19,202-bh,14,bh,themeChart(i/4));}
      text("CPU LOAD HISTORY",12,210,1,muted);
    }
  }else if(section==2){
    pcHeader("GPU / ENGINE","MAIN GRAPHICS CARD  -  0% WHEN IDLE");
    const char *labels[]={"GPU LOAD","VRAM","BOARD POWER","FAN SPEED"};float values[]={shown.gpu,shown.vram,shown.watts,shown.fan};
    const char *units[]={"%","%","W","%"};uint16_t colors[]={themeColor(0xf81f),themeColor(0xaaff),themeColor(0xfd20),themeColor(0x07ff)};
    for(int i=0;i<4;i++){if(up)metricTile(8+(i%2)*116,72+(i/2)*112,108,104,labels[i],values[i],units[i],i==2?400:100,colors[i]);else metricTile(8+(i%2)*155,45+(i/2)*85,149,76,labels[i],values[i],units[i],i==2?400:100,colors[i]);}
  }else if(section==3){
    pcHeader("THERMAL / STRIP","GPU TEMPERATURE / CELSIUS");
    if(up){
      bigReading(live?pcNumber(shown.temp):"--","C",72,themeColor(0xffe0));
      text("CPU TEMP",12,136,1,muted);text("--",70,130,2,muted);
      for(int i=0;i<25;i++){uint16_t c=i<12?themeColor(0x87e0):i<19?themeColor(0xfd20):themeColor(0xf920);ui.fillRect(12+i*864/100,160,7,30,live&&shown.temp>=i*4?c:themeColor(0x1083));}
      spark(tempTrace,12,206,216,84,themeColor(0xfd20),true);
    }else{
      text(live?pcNumber(shown.temp):"--",12,48,7,themeColor(0xffe0));text("C",170,74,4,themeColor(0xffe0));
      text("CPU TEMP",223,53,1,muted);text("--",223,72,4,muted);
      for(int i=0;i<25;i++){uint16_t c=i<12?themeColor(0x87e0):i<19?themeColor(0xfd20):themeColor(0xf920);ui.fillRect(12+i*12,113,9,25,live&&shown.temp>=i*4?c:themeColor(0x1083));}
      spark(tempTrace,12,153,296,51,themeColor(0xfd20),true);
    }
  }else if(section==4){
    pcHeader("NETWORK / STREAM","KB/s / MB/s  -  DEFAULT PC ADAPTER");
    if(up){
      text("RECEIVE",12,72,1,themeColor(0x07ff));text(rate(shown.down)+"B/s",12,84,4,ink);spark(downTrace,12,116,216,62,themeColor(0x07ff));
      text("SEND",12,190,1,themeColor(0xf81f));text(rate(shown.up)+"B/s",12,202,4,ink);spark(upTrace,12,234,216,56,themeColor(0xf81f));
    }else{
      text("RECEIVE",12,47,1,themeColor(0x07ff));text(rate(shown.down)+"B/s",12,63,4,ink);
      text("SEND",172,47,1,themeColor(0xf81f));text(rate(shown.up)+"B/s",172,63,4,ink);
      spark(downTrace,12,104,136,97,themeColor(0x07ff));spark(upTrace,172,104,136,97,themeColor(0xf81f));
    }
  }else if(section==5){
    pcHeader("MEMORY / BLOCKS","RAM + VIDEO MEMORY");
    if(up){
      metricTile(8,72,108,96,"RAM USED",shown.ram,"%",100,themeColor(0x87e0));
      metricTile(124,72,108,96,"VRAM USED",shown.vram,"%",100,themeColor(0xaaff));
      text(live?pcNumber(shown.ramUsed,1)+" / "+pcNumber(shown.ramTotal,1):"--",12,184,4,ink);text("GiB OF RAM IN USE",12,214,1,muted);
      spark(ramTrace,12,232,216,58,themeColor(0x87e0),true);
    }else{
      metricTile(8,46,149,85,"RAM USED",shown.ram,"%",100,themeColor(0x87e0));
      metricTile(163,46,149,85,"VRAM USED",shown.vram,"%",100,themeColor(0xaaff));
      text(live?pcNumber(shown.ramUsed,1)+" / "+pcNumber(shown.ramTotal,1)+" GiB":"--",12,148,4,ink);
      spark(ramTrace,12,184,296,24,themeColor(0x87e0),true);
    }
  }else if(section==6){
    pcHeader("STORAGE / TRAFFIC","SYSTEM DRIVE CAPACITY + PHYSICAL DISK I/O");
    if(up){
      metricTile(8,72,108,86,"C: USED",shown.drive,"%",100,themeColor(0xffe0));
      metricTile(124,72,108,86,"FREE SPACE",shown.driveFree,"GiB",2048,themeColor(0x07ff));
      text("READ",12,170,1,themeColor(0x07ff));text(live?pcNumber(shown.readMB,1)+" MB/s":"--",12,182,4,ink);
      text("WRITE",12,220,1,themeColor(0xf81f));text(live?pcNumber(shown.writeMB,1)+" MB/s":"--",12,232,4,ink);
      text("DISK BUSY",12,266,1,muted);meter(12,278,216,12,shown.disk,themeColor(0xfd20),18);
    }else{
      metricTile(8,45,149,74,"C: USED",shown.drive,"%",100,themeColor(0xffe0));
      metricTile(163,45,149,74,"FREE SPACE",shown.driveFree,"GiB",2048,themeColor(0x07ff));
      text("READ",12,136,1,themeColor(0x07ff));text(live?pcNumber(shown.readMB,1)+" MB/s":"--",12,154,4,ink);
      text("WRITE",171,136,1,themeColor(0xf81f));text(live?pcNumber(shown.writeMB,1)+" MB/s":"--",171,154,4,ink);
      meter(12,194,296,12,shown.disk,themeColor(0xfd20),25);
    }
  }else if(section==7){
    pcHeader("POWER / DRIVE","GPU BOARD POWER / 0-400 W SCALE");
    if(up){
      bigReading(live?pcNumber(shown.watts):"--","W",72,themeColor(0xfd20));
      for(int i=0;i<24;i++){int bh=40+i*6;ui.fillRect(12+i*9,290-bh,7,bh,live&&shown.watts/400.f*24>i?themeChart(i/5):themeColor(0x1083));}
    }else{
      text(live?pcNumber(shown.watts):"--",12,50,7,themeColor(0xfd20));text("W",200,74,4,themeColor(0xfd20));
      for(int i=0;i<24;i++){int bh=25+i*3;ui.fillRect(12+i*12,204-bh,9,bh,live&&shown.watts/400.f*24>i?themeChart(i/5):themeColor(0x1083));}
    }
  }else{
    pcHeader("PC / SIX CHANNELS","60 SAMPLES / ACTUAL PC HISTORY");
    const char *labels[]={"CPU","GPU","RAM","TEMP","RX","TX"};
    float *traces[]={cpuTrace,gpuTrace,ramTrace,tempTrace,downTrace,upTrace};
    uint16_t cs[]={themeColor(0x07ff),themeColor(0xf81f),themeColor(0x87e0),themeColor(0xfd20),themeColor(0x3bff),themeColor(0xaaff)};
    for(int i=0;i<6;i++){int x=up?8+(i%2)*116:8+(i%2)*156,y=up?72+(i/2)*76:45+(i/2)*57,w=up?108:148,h=up?70:51;themeTile(x,y,w,h);text(labels[i],x+5,y+4,1,cs[i]);spark(traces[i],x+5,y+18,w-10,h-24,cs[i],i<4);}
  }
}
