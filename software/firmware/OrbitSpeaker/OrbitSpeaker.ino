// Orbit Speaker: a separate, Bluetooth-only program that lives in Orbit's spare OTA slot.
// Main Orbit's BT SPEAKER button boots it; it shows up as "Orbit Speaker" for a phone or PC to play
// Spotify (or anything) to over Bluetooth A2DP. It points the boot slot straight back at main Orbit as
// it starts, so EXIT, a crash or a power cut always return to the main firmware. No Wi-Fi here.
// Install with Update-Orbit-WiFi.ps1 (sent through main Orbit as /ota?role=speaker).
#include <Arduino.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <Preferences.h>
#include "esp_ota_ops.h"
#include "esp_cpu.h"
#include "soc/gpio_reg.h"
#include <driver/i2s_std.h>
#include "BluetoothA2DPSink.h"

extern "C" bool btInUse(void){return true;}  // keep Bluetooth memory (released at boot otherwise)

TFT_eSPI tft;
TFT_eSprite ui(&tft);
SPIClass touchBus(VSPI);
XPT2046_Touchscreen touch(33,36);
Preferences prefs;
const uint16_t BG=0x0000,INK=0xEF7E,MUTED=0x8492,PANEL=0x10A3,ACCENT=0x07FF,PULSE=0xF81F;

// ---- Ring LEDs: same bit-banged WS2812 driver and saved settings as main Orbit ----
const int LED_COUNT=8,LED_CAP=60,ledPins[2]={16,17};
bool ledOn=true;int ledBright=65,ledPinMask=3;uint8_t ledRGB[3]={30,110,255};
portMUX_TYPE ledMux=portMUX_INITIALIZER_UNLOCKED;
void ledWrite(uint8_t px[][3]){
 uint8_t data[LED_COUNT*3];for(int i=0;i<LED_COUNT;i++){data[i*3]=px[i][1];data[i*3+1]=px[i][0];data[i*3+2]=px[i][2];}
 uint32_t mask=0;for(int p=0;p<2;p++)if(ledPinMask&(1<<p))mask|=1UL<<ledPins[p];
 const uint32_t mhz=ESP.getCpuFreqMHz(),t0=mhz*2/5,t1=mhz*4/5,period=mhz*5/4;
 for(int pass=0;pass<2;pass++){uint32_t m=pass?mask:0;portENTER_CRITICAL(&ledMux);uint32_t start=esp_cpu_get_cycle_count();
  for(int i=0;i<LED_COUNT*3;i++)for(int b=7;b>=0;b--){uint32_t high=data[i]>>b&1?t1:t0;while(esp_cpu_get_cycle_count()-start<period){}
   start=esp_cpu_get_cycle_count();REG_WRITE(GPIO_OUT_W1TS_REG,m);while(esp_cpu_get_cycle_count()-start<high){}REG_WRITE(GPIO_OUT_W1TC_REG,m);}
  portEXIT_CRITICAL(&ledMux);}
}

// ---- Audio: decoded 16-bit stereo PCM from the A2DP library straight to the amp ----
i2s_chan_handle_t tx=nullptr;
volatile uint32_t peak=0,currentRate=0,frames=0;
const float GAIN=0.8f;  // a little headroom for the amp and the shared 5 V supply
SemaphoreHandle_t txLock=nullptr;  // the A2DP task writes while the BT task may change the rate (created in setup)
bool i2sOpen(uint32_t rate){
 xSemaphoreTake(txLock,portMAX_DELAY);
 bool ok=true;
 if(rate!=currentRate||!tx){
  if(tx){i2s_channel_disable(tx);i2s_del_channel(tx);tx=nullptr;}
  ok=false;
  i2s_chan_config_t ch=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);ch.dma_desc_num=8;ch.dma_frame_num=256;ch.auto_clear=true;
  if(i2s_new_channel(&ch,&tx,nullptr)==ESP_OK){
   i2s_std_config_t cfg={};cfg.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(rate);
   cfg.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_STEREO);
   cfg.gpio_cfg.mclk=I2S_GPIO_UNUSED;cfg.gpio_cfg.bclk=GPIO_NUM_22;cfg.gpio_cfg.ws=GPIO_NUM_27;cfg.gpio_cfg.dout=GPIO_NUM_4;cfg.gpio_cfg.din=I2S_GPIO_UNUSED;
   if(i2s_channel_init_std_mode(tx,&cfg)==ESP_OK&&i2s_channel_enable(tx)==ESP_OK){ok=true;currentRate=rate;}
   else{i2s_del_channel(tx);tx=nullptr;}
  }else tx=nullptr;
 }
 xSemaphoreGive(txLock);
 Serial.printf("SPEAKER I2S %u Hz %s\n",(unsigned)rate,ok?"OK":"FAILED");
 return ok;
}
class AmpOut:public Print{
 public:
 size_t write(uint8_t)override{return 1;}
 size_t write(const uint8_t *data,size_t len)override{
  static int16_t buf[512];size_t done=0;frames+=len/4;
  xSemaphoreTake(txLock,portMAX_DELAY);
  while(tx&&done+1<len){size_t n=min((size_t)sizeof(buf),(len-done)&~size_t(1));const int16_t *in=(const int16_t*)(data+done);uint32_t p=0;
   for(size_t i=0;i<n/2;i++){int v=int(in[i]*GAIN);buf[i]=v;uint32_t a=abs(v);if(a>p)p=a;}if(p>peak)peak=p;
   size_t w=0;i2s_channel_write(tx,buf,n,&w,200);done+=n;}
  xSemaphoreGive(txLock);
  return len;
 }
};
AmpOut amp;
BluetoothA2DPSink sink(amp);
String track,artist;volatile bool connected=false;
void onMetadata(uint8_t id,const uint8_t *text){if(id==ESP_AVRC_MD_ATTR_TITLE)track=String((const char*)text).substring(0,60);if(id==ESP_AVRC_MD_ATTR_ARTIST)artist=String((const char*)text).substring(0,60);}
void onRate(uint16_t rate){i2sOpen(rate);}
void onConnection(esp_a2d_connection_state_t state,void*){connected=state==ESP_A2D_CONNECTION_STATE_CONNECTED;if(!connected){track="";artist="";}}

void text(const String &s,int x,int y,int font,uint16_t c,uint8_t datum=TL_DATUM){ui.setTextFont(font);ui.setTextColor(c);ui.setTextDatum(datum);ui.drawString(s,x,y);}
void exitToOrbit(){ui.fillSprite(BG);text("Back to Orbit...",160,120,4,ACCENT,MC_DATUM);ui.pushSprite(0,0);delay(150);ESP.restart();}

void setup(){
 Serial.begin(115200);
 // One-shot: the next restart (EXIT, crash or power cut) boots main Orbit again.
 const esp_partition_t *main=esp_ota_get_next_update_partition(nullptr);
 if(main)esp_ota_set_boot_partition(main);
 Serial.println("ORBIT SPEAKER BOOT");
 prefs.begin("orbit-cyd",true);
 ledOn=prefs.getBool("ledon",true);ledBright=constrain(prefs.getInt("ledbr",65),0,100);ledPinMask=constrain(prefs.getInt("ledpin",3),1,3);
 uint32_t c=prefs.getUInt("ledrgb",(30<<16)|(110<<8)|255);ledRGB[0]=c>>16;ledRGB[1]=c>>8;ledRGB[2]=c;
 int backlight=constrain(prefs.getInt("brightness",70),5,100);prefs.end();
 for(int p=0;p<2;p++){pinMode(ledPins[p],OUTPUT);digitalWrite(ledPins[p],ledPinMask&(1<<p)?LOW:HIGH);}
 tft.init();tft.setRotation(1);tft.fillScreen(BG);ledcAttach(21,5000,8);ledcWrite(21,backlight*255/100);
 ui.setColorDepth(8);ui.createSprite(320,240);
 touchBus.begin(25,39,32,33);touch.begin(touchBus);touch.setRotation(1);
 txLock=xSemaphoreCreateMutex();
 i2sOpen(44100);
 sink.set_avrc_metadata_attribute_mask(ESP_AVRC_MD_ATTR_TITLE|ESP_AVRC_MD_ATTR_ARTIST);
 sink.set_avrc_metadata_callback(onMetadata);
 sink.set_sample_rate_callback(onRate);
 sink.set_on_connection_state_changed(onConnection);
 sink.start("Orbit Speaker");
 Serial.printf("ORBIT SPEAKER READY HEAP=%u\n",ESP.getFreeHeap());
}

void loop(){
 uint32_t now=millis();
 // Hold the bottom bar (or anywhere, for 1.5 s) to go back to Orbit.
 static uint32_t pressStart=0,lastTouch=0;
 if(digitalRead(36)==LOW&&touch.touched()){TS_Point p=touch.getPoint();int y=constrain(map(p.y,240,3800,0,239),0,239);
  if(!pressStart)pressStart=now;lastTouch=now;if((y>=178&&now-pressStart>300)||now-pressStart>1500)exitToOrbit();}
 else if(now-lastTouch>200)pressStart=0;
 // LEDs pulse with the music in the saved colour.
 static uint32_t ledAt=0;
 if(now-ledAt>30){ledAt=now;uint8_t px[LED_COUNT][3]={};
  if(ledOn){float level=ledBright/100.f*LED_CAP/100.f*(connected?0.15f+0.85f*min(1.f,peak/22000.f):0.25f+0.2f*sinf(now*0.003f));
   for(int i=0;i<LED_COUNT;i++)for(int c=0;c<3;c++)px[i][c]=uint8_t(ledRGB[c]*level);}
  ledWrite(px);peak=peak*9/10;}
 static uint32_t drawAt=0;if(now-drawAt<100){delay(2);return;}drawAt=now;
 ui.fillSprite(BG);
 ui.fillRect(10,13,4,12,ACCENT);text("ORBIT SPEAKER",22,10,2,INK);text(connected?"CONNECTED":"WAITING",310,13,1,MUTED,TR_DATUM);
 if(connected){
  text(track.length()?track:"Connected",18,52,4,ACCENT);text(artist,18,92,2,INK);
  int level=constrain(int(peak/77),0,284);ui.fillRect(18,124,284,10,PANEL);ui.fillRect(18,124,level,10,PULSE);
  text("Play, skip and volume: on your phone or PC",160,148,1,MUTED,MC_DATUM);
  // Diagnostics: audio frames received, current sample rate, and whether the amp output is open.
  char d[64];snprintf(d,sizeof(d),"AUDIO %luK FRAMES  %lu HZ  AMP %s",(unsigned long)(frames/1000),(unsigned long)currentRate,tx?"ON":"OFF");text(d,160,164,1,MUTED,MC_DATUM);
 }else{
  text("Pair me",18,48,4,ACCENT);
  text("On your phone or PC, open Bluetooth",18,92,2,INK);text("and choose \"Orbit Speaker\".",18,114,2,INK);text("Then play Spotify.",18,136,2,INK);
 }
 ui.fillRoundRect(10,178,300,44,10,PANEL);ui.drawRoundRect(10,178,300,44,10,ACCENT);text("HOLD TO GO BACK TO ORBIT",160,200,2,INK,MC_DATUM);
 ui.pushSprite(0,0);
}
