#include <mbedtls/sha256.h>
String pinHash,pinSalt,pinEntry,pinNotice;
bool securityLocked=false;
uint32_t securityLastTouch=0,pinBlockedUntil=0;
int pinFailures=0;
void securityLoad(){pinHash=prefs.getString("pinHash","");pinSalt=prefs.getString("pinSalt","");securityLocked=pinHash.length()==64;securityLastTouch=millis();}
void securityConfigure(const String &hash,const String &salt){
  if(hash.length()&& (hash.length()!=64||salt.length()!=32))return;
  for(unsigned i=0;i<hash.length();i++)if(!isxdigit(hash[i]))return;
  for(unsigned i=0;i<salt.length();i++)if(!isxdigit(salt[i]))return;
  if(hash==pinHash&&salt==pinSalt)return;
  pinHash=hash;pinSalt=salt;prefs.putString("pinHash",pinHash);prefs.putString("pinSalt",pinSalt);
  securityLocked=pinHash.length();pinEntry="";pinNotice="";pinFailures=0;pinBlockedUntil=0;securityLastTouch=millis();
}
void securityLoop(){if(pinHash.length()&&!securityLocked&&millis()-securityLastTouch>60000){securityLocked=true;pinEntry="";pinNotice="";}}
// The 12 keys: 3 x 4. Standing up they are narrower and spaced further apart down the screen.
int pinKeyX(){return tall()?10:16;}int pinKeyY(){return tall()?112:80;}int pinColStep(){return tall()?76:98;}int pinRowStep(){return tall()?46:36;}int pinKeyW(){return tall()?68:92;}
void drawSecurity(){
  int cx=W/2;
  if(tall()){ui.fillRect(10,13,4,12,accent);text("ORBIT LOCKED",22,10,2,ink);}else header("ORBIT LOCKED");
  text("Enter your passcode",cx,tall()?66:43,2,ink,MC_DATUM);
  for(unsigned i=0;i<pinEntry.length();i++)ui.fillCircle(cx+(int(i)*14)-int(pinEntry.length()-1)*7,tall()?92:65,3,accent);
  const char *keys[]={"1","2","3","4","5","6","7","8","9","BACK","0","ENTER"};
  for(int i=0;i<12;i++)button(keys[i],pinKeyX()+(i%3)*pinColStep(),pinKeyY()+(i/3)*pinRowStep(),pinKeyW(),false);
  bool blocked=int32_t(pinBlockedUntil-millis())>0;
  text(blocked?"Please wait "+String((pinBlockedUntil-millis()+999)/1000)+"s":pinNotice,cx,H-6,1,muted,MC_DATUM);
}
// Middle of a key (0-8 = 1-9, 9 BACK, 10 = 0, 11 ENTER), for the self-test.
void pinKeyCentre(int key,int &x,int &y){x=pinKeyX()+(key%3)*pinColStep()+pinKeyW()/2;y=pinKeyY()+(key/3)*pinRowStep()+17;}
void securityTap(int x,int y){
  securityLastTouch=millis();if(int32_t(pinBlockedUntil-millis())>0)return;
  int kx=x-pinKeyX(),ky=y-pinKeyY();if(kx<0||ky<0)return;
  int col=kx/pinColStep(),row=ky/pinRowStep();if(col>2||row>3||kx%pinColStep()>=pinKeyW()||ky%pinRowStep()>=34)return;
  int key=row*3+col;
  if(key==9){if(pinEntry.length())pinEntry.remove(pinEntry.length()-1);return;}
  if(key==11){
    uint8_t digest[32];String value=pinSalt+pinEntry;mbedtls_sha256((const unsigned char*)value.c_str(),value.length(),digest,0);
    char hex[65];for(int i=0;i<32;i++)sprintf(hex+i*2,"%02x",digest[i]);hex[64]=0;
    bool correct=pinEntry.length()>=4&&pinEntry.length()<=6;uint8_t different=0;
    for(int i=0;i<64;i++)different|=uint8_t(hex[i])^uint8_t(pinHash[i]);correct=correct&&!different;
    pinEntry="";
    if(correct){securityLocked=false;pinFailures=0;pinNotice="";}
    else{pinNotice="Incorrect passcode";if(++pinFailures>=5){pinBlockedUntil=millis()+30000;pinFailures=0;}}
    return;
  }
  if(pinEntry.length()<6){pinEntry+=key==10?'0':char('1'+key);pinNotice="";}
}

bool securitySelfTest(){
  String savedHash=pinHash,savedSalt=pinSalt,savedEntry=pinEntry,savedNotice=pinNotice;
  bool savedLocked=securityLocked;uint32_t savedTouch=securityLastTouch,savedBlocked=pinBlockedUntil;int savedFailures=pinFailures;
  pinHash="ae60819222c8c4c5e7a63dd250d88f4913926c0ca96d4fcd0accb1b14b34fc7e";pinSalt="0123456789abcdef0123456789abcdef";pinEntry="";pinFailures=0;pinBlockedUntil=0;securityLocked=true;
  auto press=[](int key){int x,y;pinKeyCentre(key,x,y);securityTap(x,y);};
  press(0);press(1);press(2);press(3);press(11);bool ok=!securityLocked;
  securityLocked=true;for(int i=0;i<5;i++){press(10);press(11);}ok=ok&&securityLocked&&int32_t(pinBlockedUntil-millis())>0;
  pinHash=savedHash;pinSalt=savedSalt;pinEntry=savedEntry;pinNotice=savedNotice;securityLocked=savedLocked;securityLastTouch=savedTouch;pinBlockedUntil=savedBlocked;pinFailures=savedFailures;return ok;
}
