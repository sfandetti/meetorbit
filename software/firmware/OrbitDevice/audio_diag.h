// Explicitly started diagnostics only. No recording or audio output at boot.
#include <driver/i2s_std.h>
// With no I2S channel running, hold the shared clock lines (GPIO22 BCLK, GPIO27 WS/LRC) firmly LOW.
// Left floating, crosstalk from the LED data wire looked like clock edges, woke the amp and was heard
// as crackle whenever the ring animated. (GPIO4, the amp data line, is already driven HIGH when idle.)
void audioPinsIdle(){pinMode(22,OUTPUT);digitalWrite(22,LOW);pinMode(27,OUTPUT);digitalWrite(27,LOW);}
i2s_chan_handle_t micRx=nullptr;
i2s_chan_handle_t speakerTx=nullptr;
uint32_t speakerStopAt=0,speakerPhase=0;
TaskHandle_t speakerTaskHandle=nullptr;
volatile bool speakerTaskStop=false;
bool speakerRepeating=false;
TaskHandle_t audioLoopTaskHandle=nullptr;
volatile bool audioLoopCancel=false;
void audioLoopStop(){audioLoopCancel=true;while(audioLoopTaskHandle)delay(2);}
void speakerStop(){audioLoopStop();speakerTaskStop=true;while(speakerTaskHandle)delay(2);if(speakerTx){i2s_channel_disable(speakerTx);i2s_del_channel(speakerTx);speakerTx=nullptr;pinMode(4,OUTPUT);digitalWrite(4,HIGH);audioPinsIdle();Serial.println("SPEAKER TEST COMPLETE");}}
bool micTesting=false;
uint32_t micReportAt=0,micFrames=0,micPeak[2]={0,0},micNonzero[2]={0,0};
uint32_t micRawMask[2]={0,0},micRawNonzero[2]={0,0};
double micSquare[2]={0,0};
void micStop(){audioLoopStop();if(micRx){i2s_channel_disable(micRx);i2s_del_channel(micRx);micRx=nullptr;audioPinsIdle();}micTesting=false;Serial.println("MIC STOPPED");}
bool micStart(int rate=16000){
 soundStop();speakerStop();
 if(micTesting)return true;
 i2s_chan_config_t channel=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);
 channel.dma_desc_num=4;channel.dma_frame_num=128;
 esp_err_t result=i2s_new_channel(&channel,nullptr,&micRx);
 if(result!=ESP_OK){Serial.printf("MIC ERROR ALLOC=%d\n",result);micRx=nullptr;return false;}
 i2s_std_config_t cfg={};cfg.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(rate);
 // RX uses MSB timing: in Philips mode the mic's sign bit landed one bit early (in the previous slot).
 cfg.slot_cfg=I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO);
 cfg.gpio_cfg.mclk=I2S_GPIO_UNUSED;cfg.gpio_cfg.bclk=GPIO_NUM_22;cfg.gpio_cfg.ws=GPIO_NUM_27;
 cfg.gpio_cfg.dout=I2S_GPIO_UNUSED;cfg.gpio_cfg.din=GPIO_NUM_35;
 result=i2s_channel_init_std_mode(micRx,&cfg);
 if(result==ESP_OK)result=i2s_channel_enable(micRx);
 if(result!=ESP_OK){Serial.printf("MIC ERROR INIT=%d\n",result);i2s_del_channel(micRx);micRx=nullptr;return false;}
 micTesting=true;micReportAt=millis();micFrames=0;
 for(int c=0;c<2;c++){micPeak[c]=micNonzero[c]=micRawMask[c]=micRawNonzero[c]=0;micSquare[c]=0;}
 Serial.printf("MIC STARTED RATE=%d BCLK=22 WS=27 DATA=35 SLOTS=STEREO OUTPUT=DISABLED\n",rate);return true;
}
void micLoop(){
 if(!micTesting)return;
 int32_t samples[256];size_t bytes=0;
 esp_err_t readResult=i2s_channel_read(micRx,samples,sizeof(samples),&bytes,0);
 if((readResult==ESP_OK||readResult==ESP_ERR_TIMEOUT)&&bytes){
  for(size_t i=0;i+1<bytes/sizeof(int32_t);i+=2){
   for(int c=0;c<2;c++){uint32_t raw=uint32_t(samples[i+c]);micRawMask[c]|=raw;if(raw)micRawNonzero[c]++;int32_t v=samples[i+c]>>16;uint32_t a=abs(v);micPeak[c]=max(micPeak[c],a);micSquare[c]+=double(v)*v;if(v)micNonzero[c]++;}micFrames++;
  }
 }
 if(millis()-micReportAt>=1000){
  Serial.printf("MIC FRAMES=%lu LEFT_RMS=%.2f LEFT_PEAK=%lu LEFT_NONZERO=%lu RIGHT_RMS=%.2f RIGHT_PEAK=%lu RIGHT_NONZERO=%lu HEAP=%u\n",(unsigned long)micFrames,sqrt(micSquare[0]/max(1UL,(unsigned long)micFrames)),(unsigned long)micPeak[0],(unsigned long)micNonzero[0],sqrt(micSquare[1]/max(1UL,(unsigned long)micFrames)),(unsigned long)micPeak[1],(unsigned long)micNonzero[1],ESP.getFreeHeap());
  Serial.printf("MIC RAW_LEFT=%08lx RAW_RIGHT=%08lx RAW_NONZERO_LEFT=%lu RAW_NONZERO_RIGHT=%lu\n",(unsigned long)micRawMask[0],(unsigned long)micRawMask[1],(unsigned long)micRawNonzero[0],(unsigned long)micRawNonzero[1]);
  micFrames=0;micReportAt=millis();for(int c=0;c<2;c++){micPeak[c]=micNonzero[c]=micRawMask[c]=micRawNonzero[c]=0;micSquare[c]=0;}
 }
}
void speakerFeed(void*){
 int32_t samples[512];
 while(!speakerTaskStop && int32_t(millis()-speakerStopAt)<0){
  for(int i=0;i<256;i++){
   uint32_t phase=speakerPhase+i, beat=phase%8000;
   float envelope=1.f;
   if(speakerRepeating){
    envelope=beat<4000?min(1.f,min(beat/160.f,(4000-beat)/160.f)):0.f;
   }
   int32_t v=int32_t(sinf(phase*2.f*PI*440.f/16000.f)*(speakerRepeating?2600.f:655.f)*envelope)*65536;
   samples[i*2]=v;samples[i*2+1]=v;
  }
  size_t written=0;
  esp_err_t result=i2s_channel_write(speakerTx,samples,sizeof(samples),&written,100);
  speakerPhase+=written/8;
  if(result!=ESP_OK && result!=ESP_ERR_TIMEOUT){Serial.printf("SPEAKER WRITE ERROR=%d\n",result);break;}
 }
 speakerTaskHandle=nullptr;vTaskDelete(nullptr);
}
bool speakerTest(bool repeating=false){
 soundStop();micStop();speakerStop();
 i2s_chan_config_t channel=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);
 channel.dma_desc_num=4;channel.dma_frame_num=128;
 esp_err_t result=i2s_new_channel(&channel,&speakerTx,nullptr);
 if(result!=ESP_OK){speakerTx=nullptr;Serial.printf("SPEAKER ERROR ALLOC=%d\n",result);return false;}
 i2s_std_config_t cfg={};cfg.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(16000);
 cfg.slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO);
 cfg.gpio_cfg.mclk=I2S_GPIO_UNUSED;cfg.gpio_cfg.bclk=GPIO_NUM_22;cfg.gpio_cfg.ws=GPIO_NUM_27;
 cfg.gpio_cfg.dout=GPIO_NUM_4;cfg.gpio_cfg.din=I2S_GPIO_UNUSED;
 result=i2s_channel_init_std_mode(speakerTx,&cfg);if(result==ESP_OK)result=i2s_channel_enable(speakerTx);
 if(result!=ESP_OK){Serial.printf("SPEAKER ERROR INIT=%d\n",result);i2s_del_channel(speakerTx);speakerTx=nullptr;return false;}
 speakerPhase=0;speakerRepeating=repeating;speakerTaskStop=false;
 speakerStopAt=millis()+(repeating?60000:650);
 if(xTaskCreate(speakerFeed,"speaker-feed",4096,nullptr,2,&speakerTaskHandle)!=pdPASS){speakerTaskHandle=nullptr;speakerStop();Serial.println("SPEAKER ERROR TASK");return false;}
 Serial.println(repeating?"SPEAKER REPEAT STARTED 60S 250MS BEEP 250MS SILENCE":"SPEAKER TEST STARTED 440HZ LOW LEVEL 650MS");return true;
}
void speakerLoop(){
 if(audioLoopTaskHandle)return;
 if(speakerTx && !speakerTaskHandle)speakerStop();
}

// Bench-only local echo: no network, API key, or persistent recording.
// Capture runs in its own task so display work cannot starve the RX DMA.
bool loopOpen(bool output){
 i2s_chan_config_t channel=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0,I2S_ROLE_MASTER);
 channel.dma_desc_num=4;channel.dma_frame_num=128;
 esp_err_t result=output?i2s_new_channel(&channel,&speakerTx,nullptr):i2s_new_channel(&channel,nullptr,&micRx);
 if(result!=ESP_OK)return false;
 i2s_std_config_t cfg={};cfg.clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(16000);
 // Speaker keeps Philips timing; mic RX uses MSB timing (see micStart).
 cfg.slot_cfg=output?(i2s_std_slot_config_t)I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO):(i2s_std_slot_config_t)I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,I2S_SLOT_MODE_STEREO);
 cfg.gpio_cfg.mclk=I2S_GPIO_UNUSED;cfg.gpio_cfg.bclk=GPIO_NUM_22;cfg.gpio_cfg.ws=GPIO_NUM_27;
 cfg.gpio_cfg.dout=output?GPIO_NUM_4:I2S_GPIO_UNUSED;cfg.gpio_cfg.din=output?I2S_GPIO_UNUSED:GPIO_NUM_35;
 i2s_chan_handle_t handle=output?speakerTx:micRx;
 result=i2s_channel_init_std_mode(handle,&cfg);
 if(result==ESP_OK)result=i2s_channel_enable(handle);
 if(result!=ESP_OK){i2s_del_channel(handle);if(output)speakerTx=nullptr;else micRx=nullptr;return false;}
 return true;
}
void loopClose(){
 if(micRx){i2s_channel_disable(micRx);i2s_del_channel(micRx);micRx=nullptr;}
 if(speakerTx){i2s_channel_disable(speakerTx);i2s_del_channel(speakerTx);speakerTx=nullptr;}
 pinMode(4,OUTPUT);digitalWrite(4,HIGH);audioPinsIdle();
}
// Small blocks avoid requiring one large contiguous allocation alongside the display.
struct LoopRecording {
 int16_t *blocks[12]={};
 int16_t &at(size_t index){return blocks[index/2000][index%2000];}
 void clear(){for(auto &block:blocks){if(block){memset(block,0,4000);free(block);block=nullptr;}}}
};
void audioLoopFeed(void *argument){
 LoopRecording *recording=(LoopRecording*)argument;
 int32_t frames[256];size_t captured=0;uint32_t peak=0;bool good=true;int32_t pairValue=0;
 good=loopOpen(false);
 if(!good)Serial.println("AUDIO LOOPBACK ERROR RX INIT");
 if(good&&!audioLoopCancel){
  Serial.println("AUDIO LOOPBACK READY 5S");uint32_t warmUntil=millis()+5000;
  while(!audioLoopCancel&&int32_t(millis()-warmUntil)<0){
   size_t bytes=0;esp_err_t result=i2s_channel_read(micRx,frames,sizeof(frames),&bytes,100);
   if(result!=ESP_OK&&result!=ESP_ERR_TIMEOUT){good=false;Serial.println("AUDIO LOOPBACK ERROR RX WARMUP");break;}
  }
 }
 if(!audioLoopCancel&&good){
  Serial.println("AUDIO LOOPBACK RECORDING 3S");uint32_t deadline=millis()+5000;
  while(captured<48000&&!audioLoopCancel&&int32_t(millis()-deadline)<0){
   size_t bytes=0;esp_err_t result=i2s_channel_read(micRx,frames,sizeof(frames),&bytes,100);
   if(result!=ESP_OK&&result!=ESP_ERR_TIMEOUT){good=false;break;}
   for(size_t i=0;i+1<bytes/sizeof(int32_t)&&captured<48000;i+=2){
    int32_t value=frames[i]>>16;
    if((captured&1)==0)pairValue=value;else{value=(pairValue+value)/2;recording->at(captured/2)=(int16_t)value;peak=max(peak,(uint32_t)abs(value));}captured++;
   }
  }
  if(!audioLoopCancel&&captured!=48000){good=false;Serial.println("AUDIO LOOPBACK ERROR INCOMPLETE CAPTURE");}
  if(micRx){i2s_channel_disable(micRx);i2s_del_channel(micRx);micRx=nullptr;}
 }
 if(!audioLoopCancel&&good){
  Serial.printf("AUDIO LOOPBACK CAPTURED FRAMES=%u PEAK=%lu\n",(unsigned)captured,(unsigned long)peak);
  if(peak<3){good=false;Serial.println("AUDIO LOOPBACK ERROR NO SIGNAL");}
  else if(!loopOpen(true)){good=false;Serial.println("AUDIO LOOPBACK ERROR TX INIT");}
 }
 if(!audioLoopCancel&&good){
  Serial.println("AUDIO LOOPBACK PLAYING 3S");float gain=min(4.f,6000.f/peak);uint32_t deadline=millis()+5000;
  for(size_t offset=0;offset<captured&&!audioLoopCancel&&good;){
   size_t count=min((size_t)128,captured-offset);
   for(size_t i=0;i<count;i++){
    size_t n=offset+i;float fade=min(1.f,min(n/80.f,(captured-1-n)/80.f));
    int32_t value=(int32_t)(recording->at(n/2)*gain*fade)*65536;frames[i*2]=value;frames[i*2+1]=value;
   }
   size_t total=count*8,sent=0;
   while(sent<total&&!audioLoopCancel){
    size_t bytes=0;esp_err_t result=i2s_channel_write(speakerTx,((uint8_t*)frames)+sent,total-sent,&bytes,100);
    sent+=bytes;
    if((result!=ESP_OK&&result!=ESP_ERR_TIMEOUT)||int32_t(millis()-deadline)>=0){good=false;Serial.println("AUDIO LOOPBACK ERROR TX WRITE");break;}
   }
   offset+=count;
  }
  // Let queued DMA frames drain before deleting the TX channel.
  if(good&&!audioLoopCancel)vTaskDelay(pdMS_TO_TICKS(80));
 }
 loopClose();recording->clear();delete recording;
 Serial.println(audioLoopCancel?"AUDIO LOOPBACK STOPPED":good?"AUDIO LOOPBACK COMPLETE":"AUDIO LOOPBACK FAILED");
 audioLoopTaskHandle=nullptr;vTaskDelete(nullptr);
}
bool audioLoopbackTest(){
 soundStop();micStop();speakerStop();LoopRecording *recording=new(std::nothrow) LoopRecording;
 if(!recording){Serial.println("AUDIO LOOPBACK ERROR MEMORY");return false;}
 for(auto &block:recording->blocks){block=(int16_t*)malloc(4000);if(!block){recording->clear();delete recording;Serial.println("AUDIO LOOPBACK ERROR MEMORY");return false;}}
 audioLoopCancel=false;
 if(xTaskCreate(audioLoopFeed,"audio-loop",6144,recording,2,&audioLoopTaskHandle)!=pdPASS){recording->clear();delete recording;audioLoopTaskHandle=nullptr;Serial.println("AUDIO LOOPBACK ERROR TASK");return false;}
 return true;
}
