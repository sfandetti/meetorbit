// Firmware updates over Wi-Fi, so the sealed case never needs the BOOT/RST buttons.
// POST /ota as a multipart file upload with "Authorization: Bearer <voice link token>" (the same
// 64-hex token the laptop paired over USB). Needs a two-slot OTA partition scheme (min_spiffs);
// a failed or interrupted upload leaves the running firmware untouched.
// POST /ota?role=speaker installs the separate Bluetooth "Orbit Speaker" program into the spare slot
// without switching to it; BT SPEAKER (speakerEnter) later boots it. The speaker program points the
// boot slot straight back here as it starts, so any restart returns to the main firmware.
#include <Update.h>
#include "esp_ota_ops.h"
bool otaSpeakerRole=false;
bool otaOk=false;size_t otaBytes=0;
RTC_NOINIT_ATTR uint32_t otaProgressMark,otaProgressBytes;  // survives a crash mid-upload, reported on reconnect
const uint32_t OTA_MARK=0x07A0B17E;
bool otaAuthorized(){
 if(voiceToken.length()!=64)return false;
 String given=companionServer.header("Authorization"),want="Bearer "+voiceToken;
 if(given.length()!=want.length())return false;
 uint8_t diff=0;for(size_t i=0;i<want.length();i++)diff|=given[i]^want[i];  // constant-time compare
 return diff==0;
}
// Sent to the laptop on each connect: last restart reason (esp_reset_reason: 3 software, 4 panic,
// 5-7 watchdogs, 9 brown-out), memory, and how far an update got if it crashed mid-upload.
String statusJson(){
 bool crashed=otaProgressMark==OTA_MARK;uint32_t bytes=crashed?otaProgressBytes:0;otaProgressMark=0;
 char b[220];snprintf(b,sizeof(b),"{\"type\":\"status\",\"firmware\":\"CYD-X-TALL2\",\"audioReady\":true,\"reset\":%d,\"heap\":%u,\"minHeap\":%u,\"otaCrashBytes\":%u,\"lastStep\":%u,\"httpPort\":%u}",
  (int)esp_reset_reason(),(unsigned)ESP.getFreeHeap(),(unsigned)ESP.getMinFreeHeap(),(unsigned)bytes,(unsigned)lastStep,(unsigned)ORBIT_HTTP_PORT);
 return String(b);
}
void otaScreen(const String &line){int cx=W/2,cy=H/2;ui.fillSprite(themeBg);text("Updating",cx,cy-34,4,accent,MC_DATUM);text("firmware",cx,cy-6,4,accent,MC_DATUM);wrapped(line,12,cy+20,W-24,2,ink);showFrame();}
void speakerStartingScreen(){int cx=W/2,cy=H/2;ui.fillSprite(themeBg);text("Bluetooth speaker",cx,cy-30,4,accent,MC_DATUM);text("Starting Orbit Speaker...",cx,cy+15,2,ink,MC_DATUM);text("Wi-Fi pauses in speaker mode",cx,cy+50,2,ink,MC_DATUM);showFrame();}
// BT SPEAKER: boot the installed Orbit Speaker program (Wi-Fi, voice and updates pause while it runs).
void speakerEnter(){
 String label=prefs.getString("spkslot","");
 const esp_partition_t *p=label.length()?esp_partition_find_first(ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_ANY,label.c_str()):nullptr;
 if(!p||p==esp_ota_get_running_partition()||esp_ota_set_boot_partition(p)!=ESP_OK){remoteResult="Speaker not installed yet";Serial.println("SPEAKER NOT INSTALLED");return;}
 Serial.println("SPEAKER: switching to Orbit Speaker");speakerStartingScreen();delay(200);ESP.restart();
}
void otaSetup(){
 companionServer.on("/ota",HTTP_POST,[](){
  if(!otaAuthorized()){companionServer.send(403,"text/plain","Pairing required");return;}
  otaProgressMark=0;bool ok=otaOk&&!Update.hasError();
  if(ok&&otaSpeakerRole){
   // Update.end() made the new slot the boot slot; point boot back at this main firmware.
   esp_ota_set_boot_partition(esp_ota_get_running_partition());
   companionServer.send(200,"text/plain","OK "+String(otaBytes)+" bytes, speaker installed");
   Serial.printf("OTA SPEAKER INSTALLED BYTES=%u\n",(unsigned)otaBytes);voiceRetryAt=0;return;
  }
  companionServer.send(ok?200:500,"text/plain",ok?"OK "+String(otaBytes)+" bytes, restarting":"FAILED "+String(Update.errorString()));
  Serial.printf("OTA %s BYTES=%u\n",ok?"DONE":"FAILED",(unsigned)otaBytes);
  if(ok){otaScreen("Restarting...");delay(400);ESP.restart();}
  otaScreen("Update failed. Old firmware kept.");voiceRetryAt=0;
 },[](){
  if(!otaAuthorized())return;
  HTTPUpload &up=companionServer.upload();
  if(up.status==UPLOAD_FILE_START){
   otaSpeakerRole=companionServer.arg("role")=="speaker";
   // Whatever is in the spare slot (an installed speaker program included) is about to be replaced.
   const esp_partition_t *target=esp_ota_get_next_update_partition(nullptr);
   if(target&&prefs.getString("spkslot","")==target->label)prefs.remove("spkslot");
   voiceDisconnect("Updating firmware...");otaBytes=0;otaOk=Update.begin(UPDATE_SIZE_UNKNOWN,U_FLASH);
   Serial.printf("OTA START OK=%d ROLE=%s\n",otaOk,otaSpeakerRole?"speaker":"main");otaScreen(!otaOk?"No update slot. Reflash over USB once.":otaSpeakerRole?"Installing Orbit Speaker...":"Receiving over Wi-Fi...");
  }else if(up.status==UPLOAD_FILE_WRITE){
   esp_task_wdt_reset();if(otaOk&&Update.write(up.buf,up.currentSize)!=up.currentSize)otaOk=false;otaBytes+=up.currentSize;
   otaProgressMark=OTA_MARK;otaProgressBytes=otaBytes;
  }else if(up.status==UPLOAD_FILE_END){
   if(otaOk)otaOk=Update.end(true);
   if(otaOk&&otaSpeakerRole){const esp_partition_t *p=esp_ota_get_next_update_partition(nullptr);if(p)prefs.putString("spkslot",p->label);}
  }else if(up.status==UPLOAD_FILE_ABORTED){Update.abort();otaOk=false;}
 });
}
