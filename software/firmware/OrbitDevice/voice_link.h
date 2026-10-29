// Hold-to-talk voice over Wi-Fi: Orbit mic -> laptop device link -> AI -> Orbit speaker.
// Audio is streamed in small pieces (24 kHz, 16-bit mono) and never stored on the device.
// Socket I/O stays in the main loop; capture and playback run in their own tasks so the
// display keeps refreshing while audio flows.
#include <freertos/stream_buffer.h>
#include <mbedtls/base64.h>

void ledFromJson(const char *json,size_t len);  // led_ring.h
String statusJson();                             // ota_update.h
void voiceSetup();                               // below: reloads the saved dashboard address
const uint32_t VOICE_RATE=24000;  // network PCM and microphone
const uint32_t VOICE_SPEAKER_RATE=48000;  // MAX98357A does not support 24 kHz LRCLK
const size_t VOICE_SEND=1920;  // 40 ms of mic audio per WebSocket frame
enum VoiceState {V_OFF,V_CONNECTING,V_IDLE,V_LISTENING,V_THINKING,V_SPEAKING};
VoiceState voiceState=V_OFF;
String voiceHost,voiceToken,voiceMode="openai",voiceNote="Not paired. Pair from the PC app.",voiceHeard,voiceReply,pairedName;
uint16_t voicePort=0;
NetworkClient voiceSock;
uint32_t voiceRetryAt=0,voiceTurnAt=0,voiceTouchAt=0,voicePeak=0;
float voiceVolume=0.6f;
volatile bool voiceDone=false,voiceMicRun=false,voicePlayRun=false;
volatile uint32_t voiceHeldAt=0;  // last time the mic task saw the pen-down line low
// CONSOLE view inside the AI page: the paired coding conversation (Codex on the PC) as sent by the
// laptop link, a spoken-command draft waiting for SEND / CANCEL, and the last result.
bool consoleOpen=false,conConnected=false,conPin=false,conDirty=true;
String conMsg[6],conDraft,conNote,conRuntime;char conRole[6];int conCount=0,conPending=0,conScroll=0;uint32_t conDraftAt=0;
// Console rows use the built-in 16 px font (a step up from the 6x8 one), wrapped to the panel width.
const int CON_ROWS=48,CON_LINE=15;
// The AI page's layout, lying down or standing up: the view button, the console panel, the talk bar.
int conWidth(){return W-24;}int conVisible(){return tall()?8:6;}
int viewY(){return tall()?60:36;}int conTop(){return tall()?116:64;}int conH(){return tall()?124:98;}
int talkTop(){return tall()?246:160;}int talkY(){return tall()?250:166;}String conRows[CON_ROWS];char conRowRole[CON_ROWS];int conRowCount=0;
// The AI page has three views, cycled by the button under the AI icon: 0 voice chat, 1 Codex console,
// 2 face: a full-screen cartoon character; hold it to talk, EXIT leaves.
int voiceView=0;void voiceSetView(int view);
// 3 ENGINE: who Orbit talks to (the engines set up on the PC). Voice, face and console all follow the choice.
String engIds[6],engNames[6],engSel="chatgpt",conTitle="CODEX CONSOLE";int engCount=0;
String engSelName(){for(int i=0;i<engCount;i++)if(engIds[i]==engSel)return engNames[i];return engSel=="chatgpt"?"ChatGPT":engSel;}
uint32_t faceEnteredAt=0,faceDownAt=0,faceSeenAt=0,faceQuietUntil=0,faceSpokeAt=0;
int faceDownX=0,faceDownY=0;
bool faceDown=false,faceHold=false;
String faceMood="neutral";  // mood of the current reply, from the PC: neutral, happy, angry, sad, surprised, love
volatile int32_t voiceOutPeak=0;  // loudness of the reply audio playing right now (mouth and lights)
StreamBufferHandle_t voiceMicBuf=nullptr,voicePlayBuf=nullptr;
TaskHandle_t voiceMicTask=nullptr,voicePlayTask=nullptr;
i2s_chan_handle_t voiceRx=nullptr,voiceTx=nullptr;

// ---- Minimal WebSocket client (RFC 6455): masked client frames, frames up to 4 KB ----
uint8_t wsRx[4100];size_t wsNeed=0,wsHave=0;uint8_t wsOp=0;bool wsInFrame=false,wsHeld=false;
bool wsReadLine(String &line,uint32_t timeoutMs){
 line="";uint32_t end=millis()+timeoutMs;
 while(int32_t(millis()-end)<0){while(voiceSock.available()){char c=voiceSock.read();if(c=='\n')return true;if(c!='\r'&&line.length()<200)line+=c;}delay(2);}
 return false;
}
bool wsSend(uint8_t op,const uint8_t *data,size_t len){
 if(!voiceSock.connected()||len>65535)return false;
 uint8_t head[8],mask[4];size_t n=0;head[n++]=0x80|op;
 if(len<126)head[n++]=0x80|len;else{head[n++]=0x80|126;head[n++]=len>>8;head[n++]=len&255;}
 esp_fill_random(mask,4);memcpy(head+n,mask,4);n+=4;
 if(voiceSock.write(head,n)!=n)return false;
 uint8_t chunk[256];
 for(size_t off=0;off<len;){size_t c=min((size_t)256,len-off);for(size_t i=0;i<c;i++)chunk[i]=data[off+i]^mask[(off+i)&3];if(voiceSock.write(chunk,c)!=c)return false;off+=c;}
 return true;
}
bool wsText(const String &s){return wsSend(1,(const uint8_t*)s.c_str(),s.length());}
bool wsConnect(){
 if(!voiceSock.connect(voiceHost.c_str(),voicePort,1500))return false;
 uint8_t key[16];char key64[32];size_t olen=0;esp_fill_random(key,16);mbedtls_base64_encode((unsigned char*)key64,sizeof(key64),&olen,key,16);key64[olen]=0;
 voiceSock.printf("GET /device HTTP/1.1\r\nHost: %s:%u\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer %s\r\n\r\n",voiceHost.c_str(),voicePort,key64,voiceToken.c_str());
 String line;if(!wsReadLine(line,3000)||!line.startsWith("HTTP/1.1 101")){voiceSock.stop();return false;}
 while(wsReadLine(line,1000)&&line.length()){}
 wsInFrame=false;wsHeld=false;return true;
}
// Returns true once a whole frame sits in wsRx. Never blocks for long.
bool wsPoll(){
 if(!wsInFrame){
  if(voiceSock.available()<2)return false;
  uint8_t b0=voiceSock.read(),b1=voiceSock.read();size_t len=b1&0x7f;wsOp=b0&0x0f;
  if(len==126){uint32_t end=millis()+300;while(voiceSock.available()<2&&int32_t(millis()-end)<0)delay(1);if(voiceSock.available()<2){voiceSock.stop();return false;}len=voiceSock.read()<<8;len|=voiceSock.read();}
  if(len==127||(b1&0x80)||len>sizeof(wsRx)){voiceSock.stop();return false;}
  wsNeed=len;wsHave=0;wsInFrame=true;
 }
 while(wsHave<wsNeed&&voiceSock.available()){int r=voiceSock.read(wsRx+wsHave,wsNeed-wsHave);if(r<=0)break;wsHave+=r;}
 if(wsHave<wsNeed)return false;
 wsInFrame=false;return true;
}
// Pull one string field out of a small JSON message (handles \" \\ \n; other escapes become '?').
String jsonField(const char *json,size_t len,const char *name){
 String key=String("\"")+name+"\":\"";const char *p=strstr(json,key.c_str());if(!p)return "";p+=key.length();
 String out;const char *end=json+len;
 while(p<end&&*p!='"'){if(*p=='\\'&&p+1<end){p++;out+=*p=='n'?' ':*p=='"'||*p=='\\'||*p=='/'?*p:'?';if(*p=='u')p+=min(4,int(end-p-1));}else out+=*p;p++;}
 return out;
}

// ---- Audio: one I2S channel at a time on I2S0, same pins as the diagnostics ----
bool voiceOpen(bool tx){
 soundStop();
 i2s_chan_config_t ch=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);
 ch.dma_desc_num=4;ch.dma_frame_num=240;ch.auto_clear=true;  // 4 not 6: the 0.5 s stream buffer is the cushion; Wi-Fi needs the memory
 i2s_chan_handle_t *h=tx?&voiceTx:&voiceRx;
 if(i2s_new_channel(&ch,tx?h:nullptr,tx?nullptr:h)!=ESP_OK){*h=nullptr;return false;}
 i2s_std_config_t cfg={};cfg.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(tx?VOICE_SPEAKER_RATE:VOICE_RATE);
 // Speaker keeps the proven Philips 32-bit stereo format; the mic needs MSB timing (see audio_diag.h).
 cfg.slot_cfg=tx?(i2s_std_slot_config_t)I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO):(i2s_std_slot_config_t)I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO);
 cfg.gpio_cfg.mclk=I2S_GPIO_UNUSED;cfg.gpio_cfg.bclk=GPIO_NUM_22;cfg.gpio_cfg.ws=GPIO_NUM_27;
 cfg.gpio_cfg.dout=tx?GPIO_NUM_4:I2S_GPIO_UNUSED;cfg.gpio_cfg.din=tx?I2S_GPIO_UNUSED:GPIO_NUM_35;
 if(i2s_channel_init_std_mode(*h,&cfg)!=ESP_OK||i2s_channel_enable(*h)!=ESP_OK){i2s_del_channel(*h);*h=nullptr;return false;}
 return true;
}
void voiceMicFeed(void*){
 static int32_t frames[480];int16_t out[240];float dc=0;
 while(voiceMicRun){
  // Sample the finger here too: this task runs every 10 ms even when the main loop is busy
  // drawing or serving the companion app, so a long main-loop pause can't end the turn.
  if(digitalRead(36)==LOW)voiceHeldAt=millis();
  size_t bytes=0;if(i2s_channel_read(voiceRx,frames,sizeof(frames),&bytes,100)!=ESP_OK||!bytes)continue;
  size_t n=bytes/8;
  for(size_t i=0;i<n;i++){
   float s=float(frames[i*2]>>8);dc+=(s-dc)*0.0005f;  // 24-bit left slot, slow DC removal
   int v=constrain(int((s-dc)/64.f),-32767,32767);    // 24->16 bit with 4x gain
   out[i]=v;if(uint32_t(abs(v))>voicePeak)voicePeak=abs(v);
  }
  xStreamBufferSend(voiceMicBuf,out,n*2,0);
 }
 voiceMicTask=nullptr;vTaskDelete(nullptr);
}
volatile uint32_t vsWriteMax=0,vsPlayed=0;uint32_t vsHeldSince=0;  // health while speaking: slowest speaker write, bytes played
void voicePlayFeed(void*){
 static int16_t in[240];static int32_t out[960];
 int32_t previous=0;bool havePrevious=false;bool filling=true;uint32_t fillAt=millis();
 while(voicePlayRun){
  // A cushion: wait for 0.2 s of reply (or the end of it) before playing, and again after running dry,
  // so a late Wi-Fi packet makes one short pause instead of a stutter.
  if(filling){if(xStreamBufferBytesAvailable(voicePlayBuf)<9600&&!voiceDone&&millis()-fillAt<600){vTaskDelay(pdMS_TO_TICKS(10));continue;}filling=false;}
  size_t got=xStreamBufferReceive(voicePlayBuf,in,sizeof(in),pdMS_TO_TICKS(40));size_t n=got/2;
  if(!n){if(voiceDone)break;if(havePrevious)vsUnder++;filling=true;fillAt=millis();continue;}
  // Stateful 2x linear interpolation: retain the previous sample across network chunks.
  // Two 48 kHz stereo frames per 24 kHz mono sample preserve pitch and duration.
  int32_t loudest=0;
  for(size_t i=0;i<n;i++){
   int32_t current=in[i];if(!havePrevious){previous=current;havePrevious=true;}if(abs(current)>loudest)loudest=abs(current);
   int32_t midpoint=(previous+current)/2;
   int32_t a=int32_t(midpoint*voiceVolume)*65536,b=int32_t(current*voiceVolume)*65536;
   out[i*4]=out[i*4+1]=a;out[i*4+2]=out[i*4+3]=b;previous=current;
  }
  voiceOutPeak=loudest;
  size_t written=0;uint32_t wt=millis();i2s_channel_write(voiceTx,out,n*16,&written,200);wt=millis()-wt;if(wt>vsWriteMax)vsWriteMax=wt;vsPlayed+=n*2;
 }
 voiceOutPeak=0;
 if(voicePlayRun)vTaskDelay(pdMS_TO_TICKS(120));  // let the last DMA buffers play out
 voicePlayTask=nullptr;vTaskDelete(nullptr);
}
void voiceMicStop(){
 voiceMicRun=false;while(voiceMicTask)delay(2);
 if(voiceRx){i2s_channel_disable(voiceRx);i2s_del_channel(voiceRx);voiceRx=nullptr;audioPinsIdle();}
}
void voicePlayStop(){
 voicePlayRun=false;while(voicePlayTask)delay(2);
 if(voiceTx){i2s_channel_disable(voiceTx);i2s_del_channel(voiceTx);voiceTx=nullptr;pinMode(4,OUTPUT);digitalWrite(4,HIGH);audioPinsIdle();}
 if(voicePlayBuf){vStreamBufferDelete(voicePlayBuf);voicePlayBuf=nullptr;}
}
bool voicePlayStart(){
 if(voiceTx)return true;
 voicePlayBuf=xStreamBufferCreate(24000,1);  // half a second of reply audio
 if(!voicePlayBuf||!voiceOpen(true)){voicePlayStop();voiceNote="Speaker unavailable";return false;}
 voiceDone=false;voicePlayRun=true;
 if(xTaskCreate(voicePlayFeed,"voice-play",4096,nullptr,3,&voicePlayTask)!=pdPASS){voicePlayTask=nullptr;voicePlayStop();return false;}
 return true;
}
// Send whatever mic audio is waiting, in 40 ms frames (or everything when flushing).
void voiceSendMic(bool flush){
 static uint8_t frame[VOICE_SEND];
 while(voiceMicBuf){
  size_t ready=xStreamBufferBytesAvailable(voiceMicBuf);if(ready<VOICE_SEND&&!(flush&&ready))return;
  size_t got=xStreamBufferReceive(voiceMicBuf,frame,min(ready,VOICE_SEND)&~size_t(1),0);if(!got)return;
  if(!wsSend(2,frame,got)){voiceSock.stop();return;}
 }
}

// ---- Conversation turn ----
void voiceDisconnect(const String &why){
 voiceMicStop();voicePlayStop();if(voiceMicBuf){vStreamBufferDelete(voiceMicBuf);voiceMicBuf=nullptr;}
 voiceSock.stop();voiceState=V_OFF;voiceNote=why;voiceRetryAt=millis()+5000;
}
// Start the microphone task (diagnostic audio off first). False if the mic could not start.
bool voiceMicOpen(){
 micStop();speakerStop();
 voiceMicBuf=xStreamBufferCreate(16000,1);  // a third of a second of mic audio
 if(!voiceMicBuf||!voiceOpen(false)){voiceMicStop();if(voiceMicBuf){vStreamBufferDelete(voiceMicBuf);voiceMicBuf=nullptr;}voiceNote="Microphone unavailable";return false;}
 voicePeak=0;voiceHeldAt=millis();voiceMicRun=true;
 if(xTaskCreate(voiceMicFeed,"voice-mic",4096,nullptr,3,&voiceMicTask)!=pdPASS){voiceMicTask=nullptr;voiceMicStop();vStreamBufferDelete(voiceMicBuf);voiceMicBuf=nullptr;return false;}
 return true;
}
void voiceMicClose(){voiceMicStop();if(voiceMicBuf){vStreamBufferDelete(voiceMicBuf);voiceMicBuf=nullptr;}}
void voiceBegin(){
 uint32_t t0=millis(),t1=t0,t2=t0;  // how long each part of starting a turn takes (reported when slow)
 if(voiceState==V_SPEAKING||voiceState==V_THINKING){voicePlayStop();t1=millis();wsText("{\"type\":\"cancel\"}");}
 t1=t1==t0?millis():t1;t2=millis();
 if(!voiceMicOpen()){voiceState=V_IDLE;return;}
 uint32_t t3=millis();
 // In the console view the turn is a command for the coding chat: transcribed only, then reviewed.
 // With Codex chosen, a turn is a command for the coding chat: transcribed only, then reviewed (SEND/CANCEL).
 bool command=engSel=="codex";
 wsText(command?"{\"type\":\"begin\",\"console\":true}":"{\"type\":\"begin\"}");if(command){conDraft="";conNote="";}
 voiceHeard="";voiceReply="";voiceNote="";voiceTurnAt=millis();voiceState=V_LISTENING;
 uint32_t t4=millis();if(t4-t0>150){char j[120];snprintf(j,sizeof(j),"{\"type\":\"slow-begin\",\"stop\":%lu,\"cancel\":%lu,\"mic\":%lu,\"send\":%lu}",(unsigned long)(t1-t0),(unsigned long)(t2-t1),(unsigned long)(t3-t2),(unsigned long)(t4-t3));wsText(j);}
 Serial.println("VOICE LISTENING");
}
void voiceEnd(){
 voiceMicStop();voiceSendMic(true);voiceMicClose();
 // The relay needs at least 100 ms of audio; a quick tap just cancels.
 if(millis()-voiceTurnAt<750){wsText("{\"type\":\"cancel\"}");voiceState=V_IDLE;voiceNote="Hold longer while you speak.";Serial.println("VOICE TOO SHORT");return;}
 wsText("{\"type\":\"end\"}");voiceDone=false;voiceState=V_THINKING;voiceTurnAt=millis();vsMaxGap=vsLoopMax=vsUnder=0;
 Serial.printf("VOICE SENT PEAK=%lu\n",(unsigned long)voicePeak);
}

void faceTap(int x,int y,uint32_t now);  // below, with the face drawing
void voiceMessage(){
 if(wsOp==0x9){wsSend(0xA,wsRx,wsNeed);return;}
 if(wsOp==0x8){voiceDisconnect("Laptop closed the voice link.");return;}
 if(wsOp!=0x1||wsNeed>=sizeof(wsRx))return;
 wsRx[wsNeed]=0;const char *j=(const char*)wsRx;String type=jsonField(j,wsNeed,"type");
 if(type=="hello"){String name=jsonField(j,wsNeed,"name").substring(0,24);if(name.length()&&name!=pairedName){pairedName=name;prefs.putString("vname",name);}return;}
 if(type=="leds"){ledFromJson(j,wsNeed);return;}
 if(type=="hue"){hueFromJson(j,wsNeed);return;}
 // The voice controlling Orbit itself (orbit-tools.mjs): rotate the picture, the ring lights on or off.
 if(type=="orbit-do"){String a=jsonField(j,wsNeed,"action");if(a=="rotate")rotateScreen();else if(a=="ring-on"||a=="ring-off"){ledOn=a=="ring-on";ledSave(true);}return;}
 // Speaker test tone over Wi-Fi (the 60 s, 440 Hz repeating beep from audio_diag.h); "beep-stop" ends it.
 if(type=="beep"){if(voiceState==V_IDLE){speakerTest(true);wsText("{\"type\":\"beep-started\"}");}return;}
 if(type=="beep-stop"){speakerStop();return;}
 // Move Orbit to another PC's dashboard over the authenticated link (no USB): save the new host, port and
 // 64-hex token exactly like the USB VOICELINK command, confirm, then reconnect to the new PC.
 if(type=="relink"){
  String host=jsonField(j,wsNeed,"host"),token=jsonField(j,wsNeed,"token");const char *pp=strstr(j,"\"port\":");unsigned port=pp?atoi(pp+7):0;
  bool ok=host.length()>=7&&host.length()<40&&port>0&&port<65536&&token.length()==64;for(unsigned i=0;ok&&i<token.length();i++)if(!isxdigit((unsigned char)token[i]))ok=false;
  wsText(String("{\"type\":\"relinked\",\"ok\":")+(ok?"true":"false")+"}");
  if(!ok){Serial.println("RELINK REJECTED");return;}
  prefs.putString("vhost",host);prefs.putUShort("vport",port);prefs.putString("vtok",token);voiceSetup();
  Serial.printf("RELINK -> %s:%u\n",host.c_str(),port);voiceDisconnect("Moving to the new PC...");voiceRetryAt=millis()+1500;return;
 }
 // Companion pairing over the authenticated laptop link (no USB or Wi-Fi password needed):
 // the same 32-hex key the PC companion uses as its Bearer token for /feed.
 if(type=="companion-pair"){String key=jsonField(j,wsNeed,"key");bool ok=key.length()==32;for(unsigned i=0;i<key.length();i++)if(!isxdigit((unsigned char)key[i]))ok=false;
  if(ok){pairKey=key;prefs.putString("pair",key);}wsText(String("{\"type\":\"companion-paired\",\"ok\":")+(ok?"true":"false")+"}");Serial.printf("COMPANION PAIR %s\n",ok?"SAVED":"REJECTED");return;}
 // Companion settings, AI desk messages and button results (companion.h); answer with what Orbit shows.
 if(type=="feed"){
  size_t len=wsNeed;
  companionApply([j](const char *k){return strstr(j,(String("\"")+k+"\":\"").c_str())!=nullptr;},[j,len](const char *k){return jsonField(j,len,k);});
  wsText(companionFeedStatus());return;
 }
 if(type=="pc"){String line=jsonField(j,wsNeed,"line");if(line.startsWith("PC ")){receivePC(line);linkPcAt=millis();feedTransport="WI-FI";}return;}
 // The mood of the reply being spoken: the face's eyebrows and the rings' colour.
 if(type=="mood"){faceMood=jsonField(j,wsNeed,"mood").substring(0,12);return;}
 if(type=="media-result"){remoteResult=jsonField(j,wsNeed,"text").substring(0,40);return;}
 if(type=="volume"){const char *p=strstr(j,"\"level\":");if(p&&volDrag<0)pcVolume=constrain(atoi(p+8),0,100);return;}
 if(type=="console"){
  conConnected=strstr(j,"\"connected\":true")!=nullptr;conRuntime=jsonField(j,wsNeed,"runtime").substring(0,20);
  String title=jsonField(j,wsNeed,"title");conTitle=title.length()?title.substring(0,24):String("CODEX CONSOLE");
  const char *p=strstr(j,"\"pending\":");conPending=p?atoi(p+10):0;p=strstr(j,"\"n\":");conCount=p?constrain(atoi(p+4),0,6):0;
  for(int i=0;i<conCount;i++){String k=String(i);String r=jsonField(j,wsNeed,("r"+k).c_str());conRole[i]=r.length()?r[0]:'a';conMsg[i]=jsonField(j,wsNeed,("t"+k).c_str());}
  conDirty=true;return;
 }
 // The engines set up on the PC, for the ENGINE view: n, then i0/t0 (id/name)..., and the current choice.
 if(type=="engines"){
  engCount=constrain(jsonField(j,wsNeed,"n").toInt(),0,6);
  for(int i=0;i<engCount;i++){String k=String(i);engIds[i]=jsonField(j,wsNeed,("i"+k).c_str()).substring(0,12);engNames[i]=jsonField(j,wsNeed,("t"+k).c_str()).substring(0,14);}
  String sel=jsonField(j,wsNeed,"sel");if(sel.length())engSel=sel.substring(0,12);
  return;
 }
 // A spoken Codex command to check: shown in the console view, whichever view it was said in.
 if(type=="review"){if(voiceView!=1)voiceSetView(1);conDraft=jsonField(j,wsNeed,"text").substring(0,300);conPin=strstr(j,"\"pinRequired\":true")!=nullptr;conNote="";conDraftAt=millis();return;}
 if(type=="command-result"||type=="console-note"){conNote=jsonField(j,wsNeed,"text").substring(0,120);conDraft="";return;}
 if(type=="ready")voiceNote="";
 else if(type=="transcript")voiceHeard=jsonField(j,wsNeed,"text");
 else if(type=="reply")voiceReply=jsonField(j,wsNeed,"text");
 else if(type=="speaking"&&voiceState==V_THINKING)voiceState=V_SPEAKING;
 else if(type=="think"&&voiceState==V_IDLE){voiceDone=false;voiceState=V_THINKING;voiceTurnAt=millis();vsMaxGap=vsLoopMax=vsUnder=0;}  // a typed question from the PC
 else if(type=="done"){voiceDone=true;if(!voiceTx&&voiceState!=V_LISTENING)voiceState=V_IDLE;}
 else if(type=="error"){voiceNote=jsonField(j,wsNeed,"text");if(voiceState==V_THINKING){voiceState=V_IDLE;voicePlayStop();}}
 if(type.length()&&type!="task"&&type!="requests")Serial.printf("VOICE %s\n",type.c_str());
}
// Reply audio: queue into the playback buffer; if it's full, hold the frame and stop reading the socket.
String slowWhat;  // what the voice link was doing in its last slow moment (sent with the freeze report)
uint32_t voiceAudioAt=0;  // when reply audio last arrived
// While Orbit talks the screen ignores touches (wait for the end). If the audio stops coming for 2 s the
// screen works again, so a reply that never finishes can't lock it.
bool voiceBusy(){return voiceState==V_SPEAKING&&millis()-voiceAudioAt<2000;}
bool voiceAudio(){
 if(voiceState==V_LISTENING||voiceState==V_IDLE)return true;  // stale audio from a cancelled reply
 if(!voiceTx&&!voicePlayStart())return true;
 voiceState=V_SPEAKING;voiceAudioAt=millis();
 if(xStreamBufferSpacesAvailable(voicePlayBuf)<wsNeed)return false;
 xStreamBufferSend(voicePlayBuf,wsRx,wsNeed&~size_t(1),0);return true;
}
void voiceLoop(){
 uint32_t now=millis();
 if(voiceState==V_OFF){
  if(!voiceHost.length()||!WiFi.isConnected()||int32_t(now-voiceRetryAt)<0)return;
  voiceState=V_CONNECTING;voiceNote="Connecting to laptop...";
  if(!wsConnect()){voiceState=V_OFF;voiceNote="Laptop not reachable. Is the dashboard running?";voiceRetryAt=millis()+15000;return;}
  wsText(statusJson());
  wsText("{\"type\":\"voice\",\"mode\":\""+voiceMode+"\"}");
  voiceState=V_IDLE;voiceNote="";Serial.println("VOICE CONNECTED");return;
 }
 if(!voiceSock.connected()){voiceDisconnect("Voice link dropped. Reconnecting...");return;}
 // Buttons pressed on Orbit (App launcher, Sentry, Privacy guard, AI desk) go to the PC straight away and
 // again every 5 s until a feed acknowledges them (the PC ignores repeats). A YES/NO answer is sent once.
 static uint32_t commandSentId=0,commandSentAt=0;static String replySent;
 if(remoteAction.length()&&(commandSentId!=remoteId||now-commandSentAt>5000)&&wsText(String("{\"type\":\"command\",\"id\":\"")+remoteId+"\",\"session\":\""+remoteSession+"\",\"command\":\""+remoteAction+"\"}")){commandSentId=remoteId;commandSentAt=now;}
 if(aiId.length()&&aiReply!="NONE"&&replySent!=aiId+aiReply&&wsText("{\"type\":\"desk-reply\",\"id\":\""+aiId+"\",\"reply\":\""+aiReply+"\"}"))replySent=aiId+aiReply;
 // Hold-to-talk on the bottom bar of the voice page. The touch library stops reporting a held
 // finger after one weak pressure sample (it only re-arms on a new IRQ edge), so read the
 // XPT2046 pen-down line (GPIO36, low while touched) directly and allow a 400 ms release gap.
 // Once listening, the finger may drift anywhere; a new turn needs a real release first.
 static bool needRelease=false;bool touching=false;
 if(voiceState==V_SPEAKING)faceSpokeAt=now;  // the reply's mood colour lingers a few seconds after this
 // FACE view: hold anywhere but EXIT to talk, like the voice page: listening starts after a short press
 // and the turn is sent 0.5 s after you let go (code below).
 bool pen=digitalRead(36)==LOW&&!voiceBusy();
 if(page==21&&voiceView==2&&!securityLocked){
  bool exitCorner=faceDownX<60&&faceDownY>=H-40;  // the EXIT button
  if(pen){if(!faceDown){faceDown=true;faceDownAt=now;faceHold=false;}faceSeenAt=now;faceDownX=touchX;faceDownY=touchY;
   if(!faceHold&&!exitCorner&&now-faceDownAt>=150){faceHold=true;voiceBegin();}}
  else if(faceDown&&now-faceSeenAt>120){faceDown=false;needRelease=true;if(!faceHold)faceTap(faceDownX,faceDownY,now);faceHold=false;}
 }else faceDown=faceHold=false;
 // While a console draft waits for SEND / CANCEL, the bottom bar is those two buttons, not talk.
 if(page==21&&voiceView<2&&!securityLocked&&pen)touching=voiceState==V_LISTENING||(touchY>=talkTop()&&!(consoleOpen&&conDraft.length()));
 if(touching)voiceTouchAt=now;else if(now-voiceTouchAt>400)needRelease=false;
 if(touching&&!needRelease&&voiceState!=V_LISTENING&&voiceState!=V_CONNECTING)voiceBegin();
 if(voiceState==V_LISTENING){
  voiceSendMic(false);
  // Read the clock again: voiceBegin() stamps voiceTurnAt/voiceHeldAt after `now` was taken, and
  // unsigned "now - later" wraps to ~49 days, which ended every turn instantly.
  now=millis();
  static uint32_t lastPass=now;uint32_t heldAt=max(voiceTouchAt,(uint32_t)voiceHeldAt);
  // Only count a release the loop actually observed: after a long pause, sample once more first.
  if((int32_t(now-heldAt)>500&&now-lastPass<250)||int32_t(now-voiceTurnAt)>29000){
   Serial.printf("VOICE END held_ms=%lu since_finger=%lu pen=%d loop_gap=%lu\n",(unsigned long)(now-voiceTurnAt),(unsigned long)(now-heldAt),digitalRead(36)==LOW,(unsigned long)(now-lastPass));
   voiceEnd();needRelease=true;
  }
  lastPass=now;
 }
 uint32_t secAt=millis();if(secAt-now>200&&!slowWhat.length())slowWhat=String(secAt-now)+" ms before messages";
 loopStep=55;for(int i=0;i<8;i++){
  if(wsHeld){if(!voiceAudio())break;wsHeld=false;continue;}
  uint32_t t=millis();if(!wsPoll())break;
  if(t-secAt>200&&!slowWhat.length())slowWhat=String(t-secAt)+" ms reading";
  t=millis();String what;
  if(wsOp==0x2){if(!voiceAudio()){wsHeld=true;break;}what="audio";}else{what=wsOp==1?jsonField((const char*)wsRx,wsNeed,"type").substring(0,16):String("op ")+wsOp;voiceMessage();}
  if(millis()-t>150&&!slowWhat.length())slowWhat=String(millis()-t)+" ms on "+what;
  if(voiceState==V_OFF)return;
  secAt=millis();
 }
 if(stallMs&&voiceState>=V_IDLE){char j[170];snprintf(j,sizeof(j),"{\"type\":\"stall\",\"ms\":%lu,\"step\":%lu,\"vs\":%d,\"ago\":%lu,\"what\":\"%s\"}",(unsigned long)stallMs,(unsigned long)stallStep,voiceState,(unsigned long)(millis()-stallAt),slowWhat.c_str());stallMs=0;slowWhat="";wsText(j);}
 uint32_t endAt=millis();
 // While speaking, every 2 s: how full the playback buffer is, whether the link is held, the slowest speaker write.
 static uint32_t healthAt=0;if(wsHeld&&!vsHeldSince)vsHeldSince=endAt;if(!wsHeld)vsHeldSince=0;
 if(voiceState==V_SPEAKING&&endAt-healthAt>=2000){healthAt=endAt;char j[200];snprintf(j,sizeof(j),"{\"type\":\"voice-health\",\"buf\":%u,\"held\":%lu,\"task\":%d,\"done\":%d,\"wmax\":%lu,\"played\":%lu,\"heap\":%u}",
  voicePlayBuf?(unsigned)xStreamBufferBytesAvailable(voicePlayBuf):0u,(unsigned long)(vsHeldSince?endAt-vsHeldSince:0),voicePlayTask!=nullptr,voiceDone,(unsigned long)vsWriteMax,(unsigned long)vsPlayed,ESP.getFreeHeap());vsWriteMax=0;vsPlayed=0;wsText(j);}
 loopStep=56;// Playback finished: release the speaker so the mic or diagnostics can use I2S again.
 if(voiceTx&&!voicePlayTask){uint32_t t=millis();voicePlayStop();if(voiceState==V_SPEAKING)voiceState=V_IDLE;
  char j[150];snprintf(j,sizeof(j),"{\"type\":\"voice-stats\",\"gap\":%lu,\"step\":%lu,\"loop\":%lu,\"under\":%lu,\"stopMs\":%lu,\"heap\":%u}",
   (unsigned long)vsMaxGap,(unsigned long)vsGapStep,(unsigned long)vsLoopMax,(unsigned long)vsUnder,(unsigned long)(millis()-t),ESP.getFreeHeap());wsText(j);
  vsMaxGap=vsLoopMax=vsUnder=0;}
 if(voiceState==V_THINKING&&int32_t(millis()-voiceTurnAt)>30000){voiceState=V_IDLE;voiceNote="No reply. Try again.";}
 if(millis()-endAt>200&&!slowWhat.length())slowWhat=String(millis()-endAt)+" ms closing the speaker";
}
void voiceSetup(){pairedName=prefs.getString("vname","");
 voiceHost=prefs.getString("vhost","");voicePort=prefs.getUShort("vport",0);voiceToken=prefs.getString("vtok","");
 voiceMode=prefs.getString("vmode","openai");if(!voiceHost.length()||!voicePort||voiceToken.length()!=64)voiceHost="";
}
// Serial: VOICELINK <host> <port> <token>  (sent once from the laptop over USB)
void voicePair(const String &line){
 char host[40];unsigned port;char token[80];
 if(sscanf(line.c_str()+10,"%39s %u %79s",host,&port,token)!=3||strlen(token)!=64||!port||port>65535){Serial.println("VOICELINK INVALID");return;}
 prefs.putString("vhost",host);prefs.putUShort("vport",port);prefs.putString("vtok",token);
 voiceSetup();voiceDisconnect("Paired. Connecting...");voiceRetryAt=0;Serial.println("VOICELINK SAVED");
}
void voiceSetMode(bool loopback){voiceMode=loopback?"loopback":"openai";prefs.putString("vmode",voiceMode);if(voiceState!=V_OFF)wsText("{\"type\":\"voice\",\"mode\":\""+voiceMode+"\"}");Serial.printf("VOICE MODE %s\n",voiceMode.c_str());}
// Music STOP and volume go through the laptop link (the PC companion app has no stop or set-volume command).
bool laptopSend(const String &json){if(voiceState==V_OFF||voiceState==V_CONNECTING)return false;return wsText(json);}
bool laptopMedia(const char *action){return laptopSend(String("{\"type\":\"media\",\"action\":\"")+action+"\"}");}
// Volume slider on the music page: ask for the PC volume on arrival; send the new level on release.
void musicLoop(){
 static int lastPage=-1;static uint32_t touchAt=0;
 if(page==17&&lastPage!=17)laptopSend("{\"type\":\"media\",\"action\":\"get-volume\"}");
 lastPage=page;
 if(page!=17){volDrag=-1;return;}
 if(digitalRead(36)==LOW&&buttonPressed&&volumeBarAt(pressedX,pressedY)){volDrag=constrain(map(pressedX,14,6+volW(),0,100),0,100);touchAt=millis();}
 else if(volDrag>=0&&millis()-touchAt>250){
  pcVolume=volDrag;remoteResult=laptopSend("{\"type\":\"media\",\"action\":\"volume\",\"level\":"+String(volDrag)+"}")?"Volume "+String(volDrag)+"%":"Laptop link offline";volDrag=-1;
 }
}
void voiceStatus(){Serial.printf("VOICE STATE=%d MODE=%s PAIRED=%d NOTE=%s HEAP=%u\n",voiceState,voiceMode.c_str(),voiceHost.length()>0,voiceNote.c_str(),ESP.getFreeHeap());}

// Word-wrap the console messages to the panel width in the 16 px font; the oldest rows drop off first.
void consoleBuild(){
 ui.setFreeFont(nullptr);ui.setTextFont(2);conRowCount=0;
 for(int i=0;i<conCount;i++){
  String s=String(conRole[i]=='u'?"YOU: ":"CODEX: ")+conMsg[i];
  while(s.length()){
   int cut=s.length();
   while(cut>1&&ui.textWidth(s.substring(0,cut))>conWidth()){int space=s.lastIndexOf(' ',cut-1);cut=space>0?space:cut-1;}
   if(conRowCount==CON_ROWS){for(int r=1;r<CON_ROWS;r++){conRows[r-1]=conRows[r];conRowRole[r-1]=conRowRole[r];}conRowCount--;}
   conRows[conRowCount]=s.substring(0,cut);conRowRole[conRowCount++]=conRole[i];s=s.substring(cut);s.trim();
  }
 }
 conScroll=0;conDirty=false;
}
// The AI page's view button (under the AI icon): VOICE -> CONSOLE -> FACE -> ENGINE. The dots show which.
// Lying down it sits under the AI icon; standing up it is a full-width strip under the title.
void viewButton(){
 const char *names[]={"VOICE","CONSOLE","FACE","ENGINE"};
 int x=tall()?10:222,y=viewY(),w=tall()?W-20:88,cx=tall()?x+w/2-20:x+44,dx=tall()?x+w-50:251,dy=tall()?y+13:57;
 ui.fillRoundRect(x,y,w,26,6,panel);ui.drawRoundRect(x,y,w,26,6,accent);text(tall()?String("VIEW: ")+names[voiceView]:names[voiceView],cx,y+(tall()?13:10),2,accent,MC_DATUM);
 for(int i=0;i<4;i++){int px=dx+i*10;if(i==voiceView)ui.fillCircle(px,dy,2,accent);else ui.drawCircle(px,dy,2,muted);}
}
bool viewButtonAt(int x,int y){return tall()?y>=viewY()-2&&y<viewY()+28:x>=218&&y>=34&&y<66;}
// ENGINE buttons: 2 columns; lying down they start under the view button, standing up under the strip.
void engineBox(int i,int &x,int &y,int &w,int &h){w=tall()?106:146;h=42;x=10+(i%2)*(w+(tall()?8:8));y=(tall()?98:72)+(i/2)*48;}
// ENGINE view: a button per engine set up on the PC; the chosen one is filled. Tap one to talk to it.
void drawEngines(){
 header("TALK TO",voiceState==V_OFF||voiceState==V_CONNECTING?"OFFLINE":"");viewButton();
  if(!engCount){wrapped("Add AI keys in the Orbit console on your PC (AI desk). They appear here.",18,tall()?104:84,W-36,4,muted);return;}
 for(int i=0;i<engCount;i++){int x,y,w,h;engineBox(i,x,y,w,h);bool sel=engIds[i]==engSel;
  ui.fillRoundRect(x,y,w,h,8,sel?accent:panel);ui.drawRoundRect(x,y,w,h,8,accent);text(engNames[i],x+w/2,y+h/2,2,sel?themeBg:ink,MC_DATUM);}
 if(tall())wrapped("Tap who Orbit talks to. Add keys on your PC.",12,248,W-24,2,muted);
}
void drawConsole(){
 bool linked=voiceState!=V_OFF&&voiceState!=V_CONNECTING,codex=engSel=="codex";
 header(conTitle,!linked?"OFFLINE":!codex?"AI":conConnected?"LIVE":"NO CODEX");viewButton();
 uint16_t ok=themeColor(0x07e0),warn=themeColor(0xfd20);
 // Two status lines above the panel (lying down beside the view button, standing up below it).
 int n1=tall()?92:40,n2=n1+12,chars=tall()?37:34;
 if(conDraft.length()&&conPin){text("Passcode is on: SEND may be refused.",10,n1,1,warn);text("Send from the PC console instead.",10,n2,1,muted);}
 else if(conNote.length()){
  int cut=conNote.length()<=chars?conNote.length():conNote.lastIndexOf(' ',chars);if(cut<=0)cut=min((int)conNote.length(),chars);
  text(conNote.substring(0,cut),10,n1,1,accent);String rest=conNote.substring(cut);rest.trim();text(rest.substring(0,chars),10,n2,1,accent);
 }else{
  if(!codex)text(!linked?"PC link offline":"Talking with "+engSelName(),10,n1,1,linked?ok:muted);
  else text((!linked?String("PC link offline"):conConnected?"Codex: "+(conRuntime.length()?conRuntime:String("connected")):"Codex not connected on "+(pairedName.length()?pairedName:String("this PC"))).substring(0,chars+4),10,n1,1,linked&&conConnected?ok:muted);
  if(conScroll)text(tall()?"OLDER - TAP LOWER HALF: NEWER":"OLDER - TAP LOWER HALF FOR NEWER",10,n2,1,warn);
  else if(conPending)text(String(conPending)+(conPending==1?" REQUEST":" REQUESTS")+" - ANSWER ON PC",10,n2,1,warn);
 }
 int top=conTop(),h=conH();
 ui.fillRect(6,top,W-12,h,panel);ui.drawRect(6,top,W-12,h,themeBorder);
 if(conDraft.length()){text("SEND THIS TO CODEX?",12,top+6,1,warn);wrapped(conDraft,12,top+20,W-28,tall()?4:4,ink);}
 else{
  if(conDirty)consoleBuild();
  if(!conRowCount)text(linked?"No messages yet.":"Waiting for the PC...",12,top+6,1,muted);
  int last=conRowCount-1-conScroll,first=max(0,last-conVisible()+1);
  ui.setFreeFont(nullptr);ui.setTextFont(2);ui.setTextDatum(TL_DATUM);
  for(int r=first,y=top+3;r<=last;r++,y+=CON_LINE){ui.setTextColor(conRowRole[r]=='u'?accent:ink);ui.drawString(conRows[r],10,y);}
 }
 int ty=talkY(),th=tall()?52:50;
 if(conDraft.length()){
  int half=W/2;
  ui.fillRoundRect(10,ty,half-15,th,10,panel);ui.drawRoundRect(10,ty,half-15,th,10,muted);text("CANCEL",10+(half-15)/2,ty+th/2,2,ink,MC_DATUM);
  ui.fillRoundRect(half,ty,half-10,th,10,accent);text("SEND",half+(half-10)/2,ty+th/2,2,themeBg,MC_DATUM);
  return;
 }
 bool talking=voiceState==V_LISTENING;uint16_t bg=talking?accents[1]:!linked?panel:accent;
 ui.fillRoundRect(10,ty,W-20,th,10,bg);
 text(talking?"RELEASE TO SEND":voiceState==V_THINKING?(codex?"WRITING IT DOWN...":"THINKING..."):codex?(tall()?"HOLD: SPEAK A COMMAND":"HOLD TO SPEAK A COMMAND"):"HOLD TO TALK",W/2,ty+th/2,2,talking?0x0000:themeBg,MC_DATUM);
}
void voiceSetView(int view){
 voiceView=view;consoleOpen=view==1;
 if(view==1){conScroll=0;conNote="";laptopSend("{\"type\":\"console\"}");}
 if(view==2)faceEnteredAt=millis();
}
// Taps on the AI page: the view button, the draft's CANCEL / SEND, and scrolling the log.
// (In the face view voiceLoop handles every touch itself.)
bool voiceTap(int x,int y){
 if(page!=21||voiceView==2)return false;
 if(viewButtonAt(x,y)){voiceSetView((voiceView+1)%4);return true;}
 if(voiceView==3){  // ENGINE: tap a button to choose who Orbit talks to
  int i=-1;for(int k=0;k<engCount;k++){int bx,by,bw,bh;engineBox(k,bx,by,bw,bh);if(x>=bx&&x<bx+bw&&y>=by&&y<by+bh)i=k;}
  if(i<0)return false;
  if(laptopSend("{\"type\":\"engine\",\"id\":\""+engIds[i]+"\"}"))engSel=engIds[i];
  return true;
 }
 if(!consoleOpen)return false;
 if(conDraft.length()&&y>=talkTop()){
  if(millis()-conDraftAt<600)return true;  // the finger that just spoke the command is still lifting
  if(x<W/2-3){laptopSend("{\"type\":\"cancel-review\"}");conNote="Cancelled. Nothing was sent.";}
  else{conNote=laptopSend("{\"type\":\"confirm\"}")?"Sending to Codex...":"PC link offline";}
  conDraft="";return true;
 }
 if(y>=conTop()&&y<conTop()+conH()&&!conDraft.length()){
  int v=conVisible();
  if(y<conTop()+conH()/2)conScroll=min(conScroll+v-1,max(0,conRowCount-v));else conScroll=max(0,conScroll-(v-1));
  return true;
 }
 return false;
}

// ---- FACE view: Orbit as a cartoon character: big goofy eyes and a big mouth, in the rings' colour. ----
extern uint8_t ledRGB[3];extern bool ledOn;  // led_ring.h
// The reply's mood colours the face and the rings while Orbit talks and for a few seconds after.
bool moodColor(uint8_t out[3]){
 if(!faceMood.length()||faceMood=="neutral"||(voiceState!=V_SPEAKING&&voiceState!=V_THINKING&&millis()-faceSpokeAt>5000))return false;
 static const struct{const char *name;uint8_t rgb[3];}moods[]={{"happy",{255,190,0}},{"angry",{255,0,0}},{"sad",{0,90,255}},{"surprised",{255,0,255}},{"love",{255,40,140}}};
 for(auto &m:moods)if(faceMood==m.name){memcpy(out,m.rgb,3);return true;}
 return false;
}
void faceLine(int x0,int y0,int x1,int y1,int thick,uint16_t c){for(int i=-thick/2;i<=thick/2;i++)ui.drawLine(x0,y0+i,x1,y1+i,c);}
// One lip: a thick curve across w pixels at height y. bend: how far the middle sits below the ends
// (+ smile-shaped, - frown-shaped); tilt: how much higher the left end is than the right.
void faceLip(int cx,int y,int w,float bend,float tilt,uint16_t c){
 for(int x=-w/2;x<=w/2;x+=2){float u=2.f*x/w;ui.fillCircle(cx+x,y+int(bend*(1-u*u)+tilt*u),3,c);}
}
// One big cartoon eye: a white eyeball with an outline, an iris and pupil that roam (look -1..1), and lids
// in the face colour: lid 0 open .. 1 shut from the top, low 0..1 from the bottom (a happy squint).
void faceEye(int cx,int cy,int rx,int ry,float lookX,float lookY,int iris,float lid,float low,uint16_t c){
 ui.fillEllipse(cx,cy,rx+4,ry+4,c);ui.fillEllipse(cx,cy,rx,ry,0xffff);
 int px=cx+int(lookX*(rx-iris-3)),py=cy+int(lookY*(ry-iris-3));
 ui.fillCircle(px,py,iris,c);ui.fillCircle(px,py,iris*11/20,0x0000);ui.fillCircle(px-iris/3,py-iris/3,max(3,iris/4),0xffff);ui.fillCircle(px+iris/4,py+iris/4,2,0xffff);
 if(lid<=0&&low<=0)return;
 int top=cy-ry-4,h=2*ry+8,lidY=top+int(h*lid),lowY=top+h-int(h*low);
 for(int y=top;y<=top+h;y++){
  if(y>lidY&&y<lowY)continue;
  float d=float(y-cy)/(ry+4);if(d*d>=1)continue;int w=int((rx+4)*sqrtf(1-d*d));ui.drawFastHLine(cx-w,y,2*w+1,c);
 }
}
// A quick tap on the face stops a reply that is playing; EXIT also leaves the face.
void faceTap(int x,int y,uint32_t now){
 if(voiceState==V_SPEAKING||voiceState==V_THINKING){voicePlayStop();wsText("{\"type\":\"cancel\"}");voiceState=V_IDLE;}
 if(y>=H-40&&x<60){voiceSetView(0);faceQuietUntil=now+400;}
}
enum FaceMood {F_IDLE,F_SLEEP,F_LISTEN,F_THINK,F_SPEAK,F_HAPPY,F_CURIOUS};
// FACE view: a calm blue character with big roaming eyes and a two-line mouth that opens as Orbit speaks.
// Standing up the face is narrower and taller: eyes a little smaller and higher, the mouth lower.
void drawFace(){
 uint32_t now=millis();float t=now/1000.f;ui.fillSprite(0x0000);
 const uint16_t c=ui.color565(40,150,255),grey=ui.color565(150,150,150);
 static VoiceState last=V_OFF;static uint32_t happyUntil=0,stateAt=0;
 if(voiceState!=last){if(last==V_SPEAKING&&voiceState==V_IDLE)happyUntil=now+2500;last=voiceState;stateAt=now;}
 bool offline=voiceState==V_OFF||voiceState==V_CONNECTING;
 FaceMood mood=offline?F_SLEEP:voiceState==V_THINKING?F_THINK:voiceState==V_SPEAKING?F_SPEAK
  :voiceState==V_LISTENING?F_LISTEN:int32_t(happyUntil-now)>0?F_HAPPY
  :voiceNote.length()&&now-stateAt<8000?F_CURIOUS:F_IDLE;
 // The reply's mood (from its words) shapes the eyebrows; the rings show its colour.
 uint8_t shown[3];bool moody=moodColor(shown);
 bool angry=moody&&faceMood=="angry",sad=moody&&faceMood=="sad",surprised=moody&&faceMood=="surprised",glad=(moody&&(faceMood=="happy"||faceMood=="love"))||mood==F_HAPPY;
 // Where the pupils look: they wander (now and then each its own way, for a goofy moment), roll while
 // thinking, look at you while listening or talking, and droop while dozing or sad.
 static float lx=0,ly=0,rx2=0,ry2=0,tlx=0,tly=0,trx=0,try_=0;static uint32_t nextLook=0;
 if(int32_t(now-nextLook)>0){nextLook=now+600+random(1900);tlx=random(-100,101)/100.f;tly=random(-70,71)/100.f;
  int goof=random(8);trx=goof==0?-tlx:tlx;try_=goof==1?-tly:tly;}
 float alx=tlx,aly=tly,arx=trx,ary=try_;
 if(mood==F_THINK){alx=arx=cosf(t*3)*0.85f;aly=ary=sinf(t*3)*0.6f-0.3f;}
 else if(mood==F_LISTEN||mood==F_SPEAK||surprised){alx=arx=0;aly=ary=mood==F_SPEAK?0.1f*sinf(t*9):-0.1f;}
 else if(mood==F_SLEEP||sad){alx=arx=0.2f*sinf(t*0.4f);aly=ary=0.6f;}
 float k=mood==F_THINK?0.5f:0.3f;lx+=(alx-lx)*k;ly+=(aly-ly)*k;rx2+=(arx-rx2)*k;ry2+=(ary-ry2)*k;
 // Eyes and lids.
 const bool up=tall();const int fx=W/2;
 int cy=(up?118:86)+int(3*sinf(t*1.25f)),ex=up?56:64,erx=up?42:48,ery=up?54:56,iris=up?19:22;float lid=0,low=0;
 if(mood==F_THINK)cy+=int(3*sinf(t*2));
 if(surprised){erx+=6;ery+=6;iris=15;}
 if(mood==F_LISTEN)iris=24;
 if(mood==F_SLEEP)lid=0.93f;
 if(sad)lid=0.35f;if(angry)lid=0.28f;if(glad)low=0.3f;
 if(!surprised&&mood!=F_LISTEN&&mood!=F_SLEEP&&now%4700<140)lid=1;  // blink
 faceEye(fx-ex,cy,erx,ery,lx,ly,iris,lid,low,c);faceEye(fx+ex,cy,erx,ery,rx2,ry2,iris,lid,low,c);
 int by=cy-ery-16;
 if(angry){faceLine(fx-ex-46,by-8,fx-ex+30,by+12,7,c);faceLine(fx+ex+46,by-8,fx+ex-30,by+12,7,c);}
 else if(sad){faceLine(fx-ex-42,by+10,fx-ex+30,by-8,7,c);faceLine(fx+ex+42,by+10,fx+ex-30,by-8,7,c);}
 else if(surprised){faceLine(fx-ex-34,by-4,fx-ex,by-12,6,c);faceLine(fx-ex,by-12,fx-ex+34,by-4,6,c);faceLine(fx+ex-34,by-4,fx+ex,by-12,6,c);faceLine(fx+ex,by-12,fx+ex+34,by-4,6,c);}
 else if(mood==F_CURIOUS)faceLine(fx+ex-30,by-10,fx+ex+34,by-4,6,c);
 // The mouth: two lips. At rest they are two straight lines; they curve into shapes: open as Orbit talks
 // (with the loudness of its voice), a smile, a frown, a round "oh", or a lopsided "hmm".
 // Bends are how far the middle of a lip sits below its ends; tilt raises one side.
 float tu=0,td=0,tt=0;int w=up?96:100,my=up?232:188;
 if(mood==F_SPEAK){float o=min(1.f,voiceOutPeak/11000.f);tu=-3-17*o;td=5+31*o;}
 else if(mood==F_LISTEN){float o=min(1.f,voicePeak/20000.f);voicePeak=voicePeak*3/4;tu=-2-4*o;td=3+8*o;}
 else if(surprised){tu=-14;td=20;w=64;}
 else if(sad){tu=-10;td=-8;w=84;}
 else if(angry){td=-5;}
 else if(glad){tu=11;td=13;}
 else if(mood==F_CURIOUS){tu=3;td=6;tt=-10;w=84;}
 else if(mood==F_THINK){tt=8*sinf(t*2);w=80;}  // pondering: the lips see-saw
 else if(mood==F_SLEEP)w=60;
 static float bu=0,bd=0,bt=0;float k2=mood==F_SPEAK?0.6f:0.25f;bu+=(tu-bu)*k2;bd+=(td-bd)*k2;bt+=(tt-bt)*k2;
 faceLip(fx,my-4,w,bu,bt,c);faceLip(fx,my+4,w,bd,bt,c);
 // Little extras.
 if(mood==F_THINK)for(int i=0;i<3;i++){float a=t*2.6f+i*2.09f;ui.fillCircle(W-26+int(12*cosf(a)),22+int(12*sinf(a)),5-i,c);}
 if(mood==F_SLEEP)for(int i=0;i<3;i++){float p=fmodf(t/3.f+i/3.f,1.f);text("z",W-36+int(16*p)+i*4,64-int(48*p),i==2?4:2,c);}
 if(mood==F_CURIOUS)text("?",W-22,30+int(4*sinf(t*2)),4,c,MC_DATUM);
 // EXIT in the bottom-left corner, and one line of help.
 ui.drawRoundRect(4,H-30,54,26,6,grey);text("EXIT",31,H-17,1,grey,MC_DATUM);
 String help;
 if(offline)help="WAITING FOR THE PC";
 else if(mood==F_SPEAK)help="TAP TO STOP ME";
 else if(mood==F_LISTEN)help="LISTENING...";
 else if(mood==F_IDLE)help="HOLD ME TO TALK";
 if(help.length())text(help,W/2+30,H-17,1,grey,MC_DATUM);
}
void drawVoice(){
 if(voiceView==2){drawFace();return;}
 if(voiceView==3){drawEngines();return;}
 if(consoleOpen){drawConsole();return;}
 viewButton();
 const char *right=voiceState==V_OFF||voiceState==V_CONNECTING?"OFFLINE":voiceMode=="loopback"?"ECHO TEST":"AI";
 String who=engSelName();who.toUpperCase();
 header("ORBIT / "+who,right);
 const char *title=voiceState==V_LISTENING?"Listening...":voiceState==V_THINKING?"Thinking...":voiceState==V_SPEAKING?"Speaking...":voiceState==V_IDLE?"Hold to talk":"Not connected";
 bool up=tall();int lw=W-36;
 text(title,up?12:18,up?94:44,4,voiceState==V_LISTENING?accents[1]:accent);
 int ly=up?126:80;
 if(voiceState==V_LISTENING){int level=constrain(int(voicePeak/110),0,lw);ui.fillRect(18,ly,lw,6,panel);ui.fillRect(18,ly,level,6,accents[1]);voicePeak=voicePeak*7/8;}
 // What you said and Orbit's answer. Standing up each gets a label line and the full width under it.
 int y=up?138:92;
 if(up){
  if(voiceHeard.length()){text("YOU",12,y,1,muted);wrapped(voiceHeard,12,y+10,W-24,2,ink);y+=56;}
  if(voiceReply.length()){text("ORBIT",12,y,1,muted);wrapped(voiceReply,12,y+10,W-24,voiceHeard.length()?2:4,ink);}
  else if(voiceNote.length())wrapped(voiceNote,12,y,W-24,3,muted);
 }else{
  if(voiceHeard.length()){text("YOU",18,y,1,muted);wrapped(voiceHeard,48,y-4,254,2,ink);y+=44;}
  if(voiceReply.length()){text("ORBIT",18,y,1,muted);wrapped(voiceReply,58,y-4,244,3-(y>92),ink);}
  else if(voiceNote.length())wrapped(voiceNote,18,y,284,2,muted);
 }
 bool talking=voiceState==V_LISTENING;uint16_t bg=talking?accents[1]:voiceState==V_OFF||voiceState==V_CONNECTING?panel:accent;
 int ty=talkY(),th=up?52:50;
 ui.fillRoundRect(10,ty,W-20,th,10,bg);
 text(talking?"RELEASE TO SEND":voiceState==V_SPEAKING?"HOLD TO INTERRUPT":"HOLD TO TALK",W/2,ty+th/2,2,talking?0x0000:themeBg,MC_DATUM);
}
