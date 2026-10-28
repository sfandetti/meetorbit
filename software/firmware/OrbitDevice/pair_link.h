// "Pair Orbit with this PC" over Wi-Fi. A PC's dashboard broadcasts an invitation on UDP 8791 (its name,
// address, a 4-digit code and a nonce; never its token). Orbit shows "Pair with <name>? Code 1234"; on YES
// it fetches that PC's device-link token from http://<host>:<port>/pair?code&nonce (valid once, for 60 s),
// saves it like the USB VOICELINK command and reconnects to that PC. The tap on Orbit's own screen is the
// consent: nobody else on the network can take Orbit over without touching it.
#include <WiFiUdp.h>
#include <HTTPClient.h>
WiFiUDP pairUdp;bool pairUdpOn=false;
struct PairInvite{bool active=false;String name,host,code,nonce;uint16_t port=0;uint32_t until=0;}pairInvite;
String pairResult;uint32_t pairResultUntil=0;
// Ignore queued broadcasts after YES or NO; the server grants a code only once.
String pairHandledNonce;

bool pairPromptActive(){return pairInvite.active;}
void pairLoop(){
 if(!WiFi.isConnected())return;
 if(!pairUdpOn)pairUdpOn=pairUdp.begin(8791);
 int n=pairUdp.parsePacket();
 if(n>0){char buf[320];int len=pairUdp.read(buf,sizeof(buf)-1);
  if(len>0){buf[len]=0;
   if(jsonField(buf,len,"orbit")=="pair"){
    String nonce=jsonField(buf,len,"nonce"),host=jsonField(buf,len,"host"),code=jsonField(buf,len,"code");
    const char *pp=strstr(buf,"\"port\":");unsigned port=pp?atoi(pp+7):0;
    bool ok=nonce.length()==16&&code.length()==4&&host.length()>=7&&host.length()<40&&port>0&&port<65536;
    if(ok&&nonce!=pairHandledNonce&&!(pairInvite.active&&nonce==pairInvite.nonce)){
     pairInvite.active=true;pairInvite.nonce=nonce;pairInvite.host=host;pairInvite.code=code;pairInvite.port=port;
     pairInvite.name=jsonField(buf,len,"name").substring(0,24);pairInvite.until=millis()+60000;
     Serial.printf("PAIR INVITE from %s (%s)\n",pairInvite.name.c_str(),host.c_str());
    }
   }
  }
 }
 if(pairInvite.active&&int32_t(millis()-pairInvite.until)>0)pairInvite.active=false;
}
void pairAccept(){
 pairHandledNonce=pairInvite.nonce;pairInvite.active=false;
 HTTPClient http;http.setTimeout(4000);
 String url="http://"+pairInvite.host+":"+String(pairInvite.port)+"/pair?code="+pairInvite.code+"&nonce="+pairInvite.nonce;
 int status=http.begin(url)?http.GET():-1;String body=status==200?http.getString():"";http.end();
 String token=jsonField(body.c_str(),body.length(),"token");bool ok=token.length()==64;
 for(unsigned i=0;ok&&i<token.length();i++)if(!isxdigit((unsigned char)token[i]))ok=false;
 if(!ok){pairResult="Pairing failed. Try again from the PC.";pairResultUntil=millis()+5000;Serial.printf("PAIR FAILED %d\n",status);return;}
 prefs.putString("vhost",pairInvite.host);prefs.putUShort("vport",pairInvite.port);prefs.putString("vtok",token);prefs.putString("vname",pairInvite.name);
 voiceSetup();pairedName=pairInvite.name;voiceDisconnect("Pairing with "+pairInvite.name+"...");voiceRetryAt=0;
 pairResult="Paired with "+pairInvite.name;pairResultUntil=millis()+5000;Serial.printf("PAIRED WITH %s\n",pairInvite.name.c_str());
}
// A tap while the prompt is up: YES (right) pairs, NO (left) dismisses; anywhere else is ignored.
int pairButtonsY(){return tall()?200:152;}
void pairTouch(int x,int y){if(y>=pairButtonsY()-2&&y<=pairButtonsY()+48){if(x>=W/2+5)pairAccept();else if(x<=W/2-5){pairHandledNonce=pairInvite.nonce;pairInvite.active=false;}}}
// Drawn over whatever page is showing, last thing before the frame is pushed.
void drawPairOverlay(){
 if(pairInvite.active){
  int cx=W/2,top=tall()?56:30,by=pairButtonsY(),bw=tall()?96:128;
  ui.fillRoundRect(8+(tall()?0:8),top,W-16-(tall()?0:16),by+56-top,12,panel);ui.drawRoundRect(8+(tall()?0:8),top,W-16-(tall()?0:16),by+56-top,12,accent);
  text("Pair Orbit with this PC?",cx,top+20,2,ink,MC_DATUM);
  text(pairInvite.name,cx,top+(tall()?56:50),4,accent,MC_DATUM);
  text("Code "+pairInvite.code,cx,top+(tall()?94:82),4,ink,MC_DATUM);
  text(tall()?"Check it matches the PC's code":"Check it matches the code on the PC",cx,top+(tall()?122:104),1,muted,MC_DATUM);
  ui.fillRoundRect(cx-6-bw,by,bw,44,8,themeBg);ui.drawRoundRect(cx-6-bw,by,bw,44,8,muted);text("NO",cx-6-bw/2,by+22,2,ink,MC_DATUM);
  ui.fillRoundRect(cx+6,by,bw,44,8,accent);text("YES",cx+6+bw/2,by+22,2,themeBg,MC_DATUM);
 }else if(pairResult.length()&&int32_t(millis()-pairResultUntil)<0){
  int y=H/2-28;ui.fillRoundRect(10,y,W-20,40,8,panel);ui.drawRoundRect(10,y,W-20,40,8,accent);text(pairResult,W/2,y+20,2,ink,MC_DATUM);
 }
}
// Home screen line: which PC Orbit is paired with, and whether it's connected right now.
String pairStatusText(){
 // Fits left of the home page's SETTINGS button (about 21 characters).
 if(!voiceHost.length())return "NOT PAIRED WITH A PC";
 String name=(pairedName.length()?pairedName:voiceHost).substring(0,14);
 return (voiceState==V_OFF||voiceState==V_CONNECTING?"OFFLINE: ":"PAIRED: ")+name;
}
uint16_t pairStatusColor(){return voiceHost.length()&&voiceState!=V_OFF&&voiceState!=V_CONNECTING?themeColor(0x07e0):muted;}
