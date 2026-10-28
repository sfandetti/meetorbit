#include <FS.h>
using fs::FS;
#include <WebServer.h>
#include <ESPmDNS.h>

WebServer companionServer(80);
String pairKey,feedTransport="NONE",aiId,aiTitle="Your desk companion",aiBody="No messages. Your display is ready.",aiReply="NONE";
bool aiExpired=false,aiAttention=false,mdnsReady=false;
uint32_t aiAlertAt=0,networkRetryAt=0;

String remoteAction="",remoteResult="Ready",remoteSession=String(esp_random(),HEX),appLabels[6]={"Not set","Not set","Not set","Not set","Not set","Not set"};
String cameraState="Off";bool sentryArmed=false;float cameraMotion=0;int cameraClips=0;
uint32_t remoteId=0,cameraAt=0,remoteStarted=0;
bool remoteBusy(){return remoteAction.length()||millis()<feedbackUntil||(pendingY>=153&&page==19&&(cameraState=="Starting"||cameraState=="Warming up"));}
uint8_t *cameraFrame=nullptr;size_t cameraBytes=0;bool cameraValid=false;
void requestRemote(const String &action){if(remoteAction.length())return;remoteAction=action;remoteId++;remoteStarted=millis();pendingX=pressedX;pendingY=pressedY;remoteResult="Sending...";feedbackUntil=millis()+350;}
String companionStatus() {
  return String("{\"firmware\":\"CYD-K\",\"width\":320,\"height\":240,\"page\":")+page+
    ",\"pin_capable\":true,\"pin_locked\":"+(securityLocked?"true":"false")+",\"packets\":"+pcPackets+",\"live\":"+(pcLive()?"true":"false")+
    ",\"fps\":"+String(fps,1)+",\"reply\":\""+aiReply+"\",\"ai_id\":\""+aiId+"\",\"command_id\":"+remoteId+",\"command_session\":\""+remoteSession+"\",\"command\":\""+remoteAction+"\"}";
}
void companionMessage(const String &id,const String &title,const String &body,bool attention) {
  if(!id.length() || id==aiId)return;
  aiExpired=false;aiId=id.substring(0,64);aiTitle=title.substring(0,60);aiBody=body.substring(0,240);
  aiReply="NONE";aiAttention=attention;aiAlertAt=millis();
  if(attention)setPage(16);
}
void companionSetup() {
  pairKey=prefs.getString("pair","");
  const char *headers[]={"Authorization"};
  companionServer.collectHeaders(headers,1);
  companionServer.on("/feed",HTTP_POST,[](){
    if(pairKey.length()<32 || companionServer.header("Authorization")!="Bearer "+pairKey){companionServer.send(403,"text/plain","Pairing required");return;}
    if(companionServer.hasArg("pin_hash")&&companionServer.hasArg("pin_salt"))securityConfigure(companionServer.arg("pin_hash"),companionServer.arg("pin_salt"));
    if(companionServer.hasArg("pc")){receivePC("PC "+companionServer.arg("pc"));feedTransport="WI-FI";}
    if(companionServer.hasArg("ai_id"))companionMessage(companionServer.arg("ai_id"),companionServer.arg("ai_title"),companionServer.arg("ai_body"),companionServer.arg("ai_attention")=="1");
    if(companionServer.hasArg("command_ack")&&companionServer.arg("command_ack").toInt()==remoteId&&companionServer.arg("command_session")==remoteSession){remoteAction="";remoteResult=companionServer.arg("command_result").substring(0,40);}
    for(int i=0;i<6;i++){String key="app"+String(i);if(companionServer.hasArg(key))appLabels[i]=companionServer.arg(key).substring(0,18);}
    if(companionServer.hasArg("ai_clear")){aiId="";aiAttention=false;aiReply="NONE";}
    if(companionServer.hasArg("ai_expired")){aiExpired=companionServer.arg("ai_expired")=="1";if(aiExpired)aiAttention=false;}
    for(int i=0;i<3;i++){String key="quick"+String(i);if(companionServer.hasArg(key)){int v=constrain(companionServer.arg(key).toInt(),-1,20);if(v!=quickTargets[i]){quickTargets[i]=v;prefs.putInt(key.c_str(),v);}}}
    if(companionServer.hasArg("media_state")){mediaPlaying=companionServer.arg("media_state")=="Playing";mediaAt=millis();}
    if(companionServer.hasArg("privacy_folders"))privacyFolderCount=max(0,int(companionServer.arg("privacy_folders").toInt()));
    if(companionServer.hasArg("privacy_browsers"))privacyBrowserCount=max(0,int(companionServer.arg("privacy_browsers").toInt()));
    if(companionServer.hasArg("owner")){String v=companionServer.arg("owner").substring(0,24);if(v.length()&&v!=ownerName){ownerName=v;prefs.putString("owner",v);}}
    if(companionServer.hasArg("startup_page")){int v=constrain(companionServer.arg("startup_page").toInt(),0,20);if(v!=startupPage){startupPage=v;prefs.putInt("startupPage",v);}}
    if(companionServer.hasArg("enabled")){uint32_t v=strtoul(companionServer.arg("enabled").c_str(),nullptr,10)&((1UL<<21)-1);if(v&&v!=enabledPages){enabledPages=v;prefs.putUInt("enabled",v);if(page<count&&!(v&(1UL<<page)))nextPage(1);}}
    if(companionServer.hasArg("theme")){int v=constrain(companionServer.arg("theme").toInt(),0,3);if(v!=themeIndex){themeIndex=v;prefs.putInt("theme",v);applyTheme();}}
    if(companionServer.hasArg("palette")){int v=constrain(companionServer.arg("palette").toInt(),0,4);if(v!=colorIndex){colorIndex=v;applyTheme();prefs.putInt("color",v);}}
    if(companionServer.hasArg("brightness")){int v=constrain(companionServer.arg("brightness").toInt(),5,100);if(v!=brightness){brightness=v;prefs.putInt("brightness",v);ledcWrite(21,v*255/100);}}
    if(companionServer.hasArg("tz")){String v=companionServer.arg("tz").substring(0,80);if(v!=ownerTZ){ownerTZ=v;prefs.putString("tz",v);setenv("TZ",v.c_str(),1);tzset();}}
    if(companionServer.hasArg("camera_state"))cameraState=companionServer.arg("camera_state").substring(0,24);
    if(companionServer.hasArg("camera_armed"))sentryArmed=companionServer.arg("camera_armed")=="1";
    if(companionServer.hasArg("camera_motion"))cameraMotion=constrain(companionServer.arg("camera_motion").toFloat(),0,100);
    if(companionServer.hasArg("camera_clips"))cameraClips=companionServer.arg("camera_clips").toInt();
    if(companionServer.hasArg("screen"))setPage(companionServer.arg("screen").toInt());
    companionServer.send(200,"application/json",companionStatus());
  });
  companionServer.on("/frame",HTTP_GET,[](){
    if(pairKey.length()<32||companionServer.header("Authorization")!="Bearer "+pairKey){companionServer.send(403,"text/plain","Pairing required");return;}
    companionServer.setContentLength(320*240*2);
    companionServer.send(200,"application/octet-stream","");
    // Read colors through the sprite API so captures also work with the
    // smaller 8-bit framebuffer used when contiguous heap is limited.
    uint8_t row[640];
    for(int y=0;y<240;y++){
      for(int x=0;x<320;x++){uint16_t c=ui.readPixel(x,y);row[x*2]=c>>8;row[x*2+1]=c&255;}
      companionServer.sendContent((const char*)row,sizeof(row));
    }
  });
  companionServer.on("/camera",HTTP_POST,[](){
    if(pairKey.length()<32||companionServer.header("Authorization")!="Bearer "+pairKey){companionServer.send(403,"text/plain","Pairing required");return;}
    if(cameraBytes!=160*90*2){cameraValid=false;companionServer.send(400,"text/plain","Incomplete image");return;}
    cameraValid=true;cameraAt=millis();companionServer.send(200,"text/plain","Frame received");
  },[](){
    if(pairKey.length()<32||companionServer.header("Authorization")!="Bearer "+pairKey)return;
    HTTPUpload &upload=companionServer.upload();
    if(upload.status==UPLOAD_FILE_START){cameraBytes=0;cameraValid=false;if(!cameraFrame)cameraFrame=(uint8_t*)malloc(160*90*2);}
    if(upload.status==UPLOAD_FILE_WRITE&&cameraFrame){if(cameraBytes+upload.currentSize<=160*90*2){memcpy(cameraFrame+cameraBytes,upload.buf,upload.currentSize);cameraBytes+=upload.currentSize;}else cameraBytes=160*90*2+1;}
    if(upload.status==UPLOAD_FILE_ABORTED){cameraValid=false;cameraBytes=0;}
  });
  companionServer.begin();
}
void companionLoop() {
  if(remoteAction.length()&&millis()-remoteStarted>75000){remoteAction="";remoteResult="No response. Try again.";}
  if(aiId.length()&&millis()-aiAlertAt>300000){aiExpired=true;aiAttention=false;}
  companionServer.handleClient();
  if(WiFi.isConnected()&&!mdnsReady){mdnsReady=MDNS.begin("seth-orbit");if(mdnsReady)MDNS.addService("http","tcp",80);}
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
void drawCompanion() {
  bool linked=pcLive();
  header("AI / COMPANION",linked?feedTransport:"OFFLINE");
  float phase=millis()*.003f;
  ui.drawCircle(34,65,15,linked?accent:muted);ui.fillCircle(34,65,6+(linked?int(2*sinf(phase)):0),linked?accent:muted);
  text(aiAttention?"YOUR ATTENTION":"DESK INBOX",60,48,2,aiAttention?accents[3]:accent);
  wrapped(aiTitle,60,70,240,1,ink);text("HOLD TITLE TO CLOSE",60,90,1,muted);
  wrapped(aiBody,18,111,284,4,ink);
  if(aiId.length()&&!aiExpired) {
    button(aiReply=="YES"?"YES":"HOLD: YES",18,190,136,aiReply=="NONE");
    button(aiReply=="NO"?"NO":"HOLD: NO",166,190,136,false);
  }else text(aiExpired?"REQUEST EXPIRED":"WAITING FOR A MESSAGE",160,205,2,muted,MC_DATUM);
  if(aiAttention&&millis()-aiAlertAt<4000&&(millis()/400)%2==0)ui.drawRoundRect(2,2,316,225,12,accents[3]);
}
