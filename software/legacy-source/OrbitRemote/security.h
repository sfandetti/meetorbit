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
void drawSecurity(){
  header("ORBIT LOCKED");text("Enter your passcode",160,43,2,ink,MC_DATUM);
  for(unsigned i=0;i<pinEntry.length();i++)ui.fillCircle(160+(int(i)*14)-int(pinEntry.length()-1)*7,65,3,accent);
  const char *keys[]={"1","2","3","4","5","6","7","8","9","BACK","0","ENTER"};
  for(int i=0;i<12;i++)button(keys[i],16+(i%3)*98,80+(i/3)*36,92,false);
  bool blocked=int32_t(pinBlockedUntil-millis())>0;
  text(blocked?"Please wait "+String((pinBlockedUntil-millis()+999)/1000)+"s":pinNotice,160,234,1,muted,MC_DATUM);
}
void securityTap(int x,int y){
  securityLastTouch=millis();if(int32_t(pinBlockedUntil-millis())>0)return;
  if(x<16||x>=304||y<80||y>=222)return;
  int col=(x-16)/98,row=(y-80)/36;if(col>2||row>3||(x-16)%98>=92||(y-80)%36>=34)return;
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
  securityTap(50,95);securityTap(150,95);securityTap(250,95);securityTap(50,131);securityTap(250,203);bool ok=!securityLocked;
  securityLocked=true;for(int i=0;i<5;i++){securityTap(150,203);securityTap(250,203);}ok=ok&&securityLocked&&int32_t(pinBlockedUntil-millis())>0;
  pinHash=savedHash;pinSalt=savedSalt;pinEntry=savedEntry;pinNotice=savedNotice;securityLocked=savedLocked;securityLastTouch=savedTouch;pinBlockedUntil=savedBlocked;pinFailures=savedFailures;return ok;
}
