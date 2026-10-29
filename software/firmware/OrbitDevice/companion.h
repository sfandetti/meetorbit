#include <FS.h>
using fs::FS;
#include <WebServer.h>
#include <ESPmDNS.h>

// Firmware updates and Sentry frames only. Port 8080, not 80: the old Python companion and its helper still
// knock on port 80, and every half-finished request there used to hold up the main loop for seconds.
const uint16_t ORBIT_HTTP_PORT=8080;
WebServer companionServer(ORBIT_HTTP_PORT);
String pairKey,feedTransport="NONE",aiId,aiTitle="Your desk companion",aiBody="No messages. Your display is ready.",aiReply="NONE";
bool aiExpired=false,aiAttention=false,mdnsReady=false;
uint32_t aiAlertAt=0,networkRetryAt=0;

String remoteAction="",remoteResult="Ready",remoteSession=String(esp_random(),HEX),appLabels[6]={"Not set","Not set","Not set","Not set","Not set","Not set"};
String cameraState="Off";bool sentryArmed=false;float cameraMotion=0;int cameraClips=0;
uint32_t remoteId=0,cameraAt=0,remoteStarted=0;
int cameraTop();  // remote.h
void setScreenRotation(int rot);void draw();void tap(int x,int y);void voiceSetView(int view);  // defined further on
bool remoteBusy(){return remoteAction.length()||millis()<feedbackUntil||(pendingY>=cameraTop()+3&&page==19&&(cameraState=="Starting"||cameraState=="Warming up"));}
uint8_t *cameraFrame=nullptr;size_t cameraBytes=0;bool cameraValid=false;
void requestRemote(const String &action){if(remoteAction.length())return;remoteAction=action;remotePage=page;remoteId++;remoteStarted=millis();pendingX=pressedX;pendingY=pressedY;remoteResult="Sending...";feedbackUntil=millis()+350;}
void companionMessage(const String &id,const String &title,const String &body,bool attention) {
  if(!id.length() || id==aiId)return;
  aiExpired=false;aiId=id.substring(0,64);aiTitle=title.substring(0,60);aiBody=body.substring(0,240);
  aiReply="NONE";aiAttention=attention;aiAlertAt=millis();
  if(attention)setPage(16);
}
// Companion settings, AI desk messages and button results from the PC. The same fields arrive as the
// "feed" message on the device link (voice_link.h) or, from the old Python companion, as HTTP POST /feed;
// has(name) / arg(name) read whichever one it was. Every value is a string.
template<class Has,class Arg> void companionApply(Has has,Arg arg) {
  if(has("pin_hash")&&has("pin_salt"))securityConfigure(arg("pin_hash"),arg("pin_salt"));
  // The device link's own readings include AMD/Intel GPUs; while they arrive, ignore the old
  // companion's NVIDIA-only copy so the two feeds don't take turns blanking the GPU gauges.
  if(has("pc")&&millis()-linkPcAt>5000){receivePC("PC "+arg("pc"));feedTransport="WI-FI";}
  if(has("ai_id"))companionMessage(arg("ai_id"),arg("ai_title"),arg("ai_body"),arg("ai_attention")=="1");
  if(has("command_ack")&&arg("command_ack").toInt()==remoteId&&arg("command_session")==remoteSession){remoteAction="";remoteResult=arg("command_result").substring(0,40);}
  for(int i=0;i<6;i++){String key="app"+String(i);if(has(key.c_str()))appLabels[i]=arg(key.c_str()).substring(0,18);}
  if(has("ai_clear")){aiId="";aiAttention=false;aiReply="NONE";}
  if(has("ai_expired")){aiExpired=arg("ai_expired")=="1";if(aiExpired)aiAttention=false;}
  for(int i=0;i<3;i++){String key="quick"+String(i);if(has(key.c_str())){int v=constrain(arg(key.c_str()).toInt(),-1,20);if(v==16)v=21;if(v!=quickTargets[i]){quickTargets[i]=v;prefs.putInt(key.c_str(),v);}}}
  if(has("media_state")){mediaPlaying=arg("media_state")=="Playing";mediaAt=millis();}
  if(has("privacy_folders"))privacyFolderCount=max(0,int(arg("privacy_folders").toInt()));
  if(has("privacy_browsers"))privacyBrowserCount=max(0,int(arg("privacy_browsers").toInt()));
  if(has("owner")){String v=arg("owner").substring(0,24);if(v.length()&&v!=ownerName){ownerName=v;prefs.putString("owner",v);}}
  if(has("startup_page")){int v=constrain(arg("startup_page").toInt(),0,20);if(v!=startupPage){startupPage=v;prefs.putInt("startupPage",v);}}
  if(has("enabled")){uint32_t v=((strtoul(arg("enabled").c_str(),nullptr,10)&((1UL<<21)-1))|(1UL<<21)|(1UL<<22)|(1UL<<23)|(1UL<<24)|(1UL<<25)|(1UL<<26)|(1UL<<27))&~(1UL<<16);if(v!=enabledPages){enabledPages=v;prefs.putUInt("enabled",v);if(page<count&&!(v&(1UL<<page)))nextPage(1);}}
  if(has("theme")){int v=constrain(arg("theme").toInt(),0,3);if(v!=themeIndex){themeIndex=v;prefs.putInt("theme",v);applyTheme();}}
  if(has("palette")){int v=constrain(arg("palette").toInt(),0,4);if(v!=colorIndex){colorIndex=v;applyTheme();prefs.putInt("color",v);}}
  if(has("brightness")){int v=constrain(arg("brightness").toInt(),5,100);if(v!=brightness){brightness=v;prefs.putInt("brightness",v);ledcWrite(21,v*255/100);}}
  if(has("tz")){String v=arg("tz").substring(0,80);if(v!=ownerTZ){ownerTZ=v;prefs.putString("tz",v);setenv("TZ",v.c_str(),1);tzset();}}
  if(has("camera_state"))cameraState=arg("camera_state").substring(0,24);
  if(has("camera_armed"))sentryArmed=arg("camera_armed")=="1";
  if(has("camera_motion"))cameraMotion=constrain(arg("camera_motion").toFloat(),0,100);
  if(has("camera_clips"))cameraClips=arg("camera_clips").toInt();
  if(has("home_keys"))homeSet(arg("home_keys"),true);
  if(has("screen"))setPage(arg("screen").toInt());
}
extern String voiceToken;  // voice_link.h: the device link token, also accepted for Sentry camera frames
bool cameraAuthorized(){String h=companionServer.header("Authorization");return (pairKey.length()>=32&&h=="Bearer "+pairKey)||(voiceToken.length()==64&&h=="Bearer "+voiceToken);}
// Reply to a link "feed": what Orbit is showing, whether it is locked, and the AI desk answer (if any).
String companionFeedStatus() {
  return String("{\"type\":\"feed-status\",\"page\":\"")+page+"\",\"pin_locked\":\""+(securityLocked?"1":"0")+"\",\"ai_id\":\""+aiId+"\",\"reply\":\""+aiReply+"\"}";
}
void companionSetup() {
  pairKey=prefs.getString("pair","");
  const char *headers[]={"Authorization"};
  companionServer.collectHeaders(headers,1);
  // The old Python companion's HTTP /feed and /frame are gone: settings arrive over the device link
  // ("feed" message). A leftover client polling /feed every second used to stall Orbit's main loop.
  companionServer.on("/camera",HTTP_POST,[](){
    if(!cameraAuthorized()){companionServer.send(403,"text/plain","Pairing required");return;}
    if(cameraBytes!=160*90*2){cameraValid=false;companionServer.send(400,"text/plain","Incomplete image");return;}
    cameraValid=true;cameraAt=millis();companionServer.send(200,"text/plain","Frame received");
  },[](){
    if(!cameraAuthorized())return;
    HTTPUpload &upload=companionServer.upload();
    if(upload.status==UPLOAD_FILE_START){cameraBytes=0;cameraValid=false;if(!cameraFrame)cameraFrame=(uint8_t*)malloc(160*90*2);}
    if(upload.status==UPLOAD_FILE_WRITE&&cameraFrame){if(cameraBytes+upload.currentSize<=160*90*2){memcpy(cameraFrame+cameraBytes,upload.buf,upload.currentSize);cameraBytes+=upload.currentSize;}else cameraBytes=160*90*2+1;}
    if(upload.status==UPLOAD_FILE_ABORTED){cameraValid=false;cameraBytes=0;}
  });
  // Screenshots for checking layouts from the PC: GET /screen with the link token. Optional ?rot=0-3
  // (turn the picture), ?page=n (show a screen), ?view=0-3 (AI page view) and ?tap=x,y (press there) are
  // applied first. Reply: the 8-bit frame (RGB332), row by row, with its size in X-Width / X-Height.
  companionServer.on("/screen",HTTP_GET,[](){
    if(!cameraAuthorized()){companionServer.send(403,"text/plain","Pairing required");return;}
    if(companionServer.hasArg("rot"))setScreenRotation(companionServer.arg("rot").toInt());
    if(companionServer.hasArg("page"))setPage(companionServer.arg("page").toInt());
    if(companionServer.hasArg("view"))voiceSetView(constrain(companionServer.arg("view").toInt(),0,3));
    if(companionServer.hasArg("tap")){int x,y;if(sscanf(companionServer.arg("tap").c_str(),"%d,%d",&x,&y)==2)tap(x,y);}
    draw();
    const uint8_t *frame=(const uint8_t*)ui.getPointer();size_t bytes=size_t(W)*H;
    if(!frame){companionServer.send(500,"text/plain","No frame");return;}
    extern uint8_t screenRot;companionServer.sendHeader("X-Rot",String(screenRot));companionServer.sendHeader("X-Width",String(W));companionServer.sendHeader("X-Height",String(H));
    companionServer.setContentLength(bytes);companionServer.send(200,"application/octet-stream","");
    for(size_t at=0;at<bytes;at+=4096){companionServer.sendContent((const char*)frame+at,min<size_t>(4096,bytes-at));esp_task_wdt_reset();}
  });
  companionServer.begin();
}
void companionLoop() {
  if(remoteAction.length()&&millis()-remoteStarted>75000){remoteAction="";remoteResult="No response. Try again.";}
  if(aiId.length()&&millis()-aiAlertAt>300000){aiExpired=true;aiAttention=false;}
  companionServer.handleClient();
  if(WiFi.isConnected()&&!mdnsReady){mdnsReady=MDNS.begin("seth-orbit");if(mdnsReady)MDNS.addService("http","tcp",ORBIT_HTTP_PORT);}
  if(!WiFi.isConnected()&&millis()-networkRetryAt>30000){networkRetryAt=millis();WiFi.reconnect();}
}
void wrapped(const String &s,int x,int y,int maxWidth,int maxLines,uint16_t c) {
  String line,word;int row=0;
  ui.setFreeFont(themeFont(2));
  for(unsigned i=0;i<=s.length();i++) {
    char ch=i<s.length()?s[i]:' ';
    if(ch==' '||ch=='\n') {
      String candidate=line.length()?line+" "+word:word;
      if(ui.textWidth(candidate)>maxWidth&&line.length()){text(line,x,y+row*21,2,c);row++;line=word;}else line=candidate;
      word="";
      if(row>=maxLines)return;
      if(ch=='\n'){text(line,x,y+row*21,2,c);line="";row++;if(row>=maxLines)return;}
    }else word+=ch;
  }
  if(line.length()&&row<maxLines)text(line,x,y+row*21,2,c);
}
// Where the YES / NO answer buttons start (AI inbox); the AI desk's own buttons sit just above.
int replyTop(){return tall()?256:190;}
void drawCompanion() {
  bool linked=pcLive();int t=tall()?62:48;
  header("AI / COMPANION",linked?feedTransport:"OFFLINE");
  float phase=millis()*.003f;
  ui.drawCircle(34,t+17,15,linked?accent:muted);ui.fillCircle(34,t+17,6+(linked?int(2*sinf(phase)):0),linked?accent:muted);
  text(aiAttention?"YOUR ATTENTION":"DESK INBOX",60,t,2,aiAttention?accents[3]:accent);
  wrapped(aiTitle,60,t+22,W-80,1,ink);text("HOLD TITLE TO CLOSE",60,t+42,1,muted);
  wrapped(aiBody,18,t+63,W-36,tall()?6:4,ink);
  int bw=tall()?100:136;
  if(aiId.length()&&!aiExpired) {
    button(aiReply=="YES"?"YES":"HOLD: YES",18,replyTop(),bw,aiReply=="NONE");
    button(aiReply=="NO"?"NO":"HOLD: NO",W-18-bw,replyTop(),bw,false);
  }else text(aiExpired?"REQUEST EXPIRED":"WAITING FOR A MESSAGE",W/2,replyTop()+15,2,muted,MC_DATUM);
  if(aiAttention&&millis()-aiAlertAt<4000&&(millis()/400)%2==0)ui.drawRoundRect(2,2,W-4,H-15,12,accents[3]);
}
