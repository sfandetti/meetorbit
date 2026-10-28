// Coordinated semantic colors and fonts. No per-frame gradients or allocations.
#include "theme_fonts.h"
int themeIndex=0;
const uint16_t themePacks[4][10]={{0xef9e,0xffff,0xa5b8,0x1148,0x4b0e,0x1351,0x7a14,0x13cb,0x9ac1,0x32b4},{0x8c2,0x1144,0x43aa,0xd7f8,0x95ef,0xa7ad,0xfdaa,0x5e96,0xfbcb,0xe6cf},{0x88aa,0x2064,0xfbb8,0xff9f,0xfe1d,0xfc19,0x579f,0xd7e8,0xff2b,0xbcbf},{0xff1d,0xffbf,0xbbd5,0x5109,0x828e,0xa94d,0x2ad7,0x13cd,0xa2e2,0x79d7}};
const uint16_t themeBackgrounds[4][5]={{0xef9e,0xf77e,0xefbd,0xf79c,0xef9f},{0x8c2,0x20c1,0x904,0x2881,0x2101},{0x88aa,0xa0a,0x3240,0x5121,0x48ad},{0xff1d,0xdf7f,0xdfbd,0xff99,0xef1f}};
uint16_t themeBg=0xef7d,themePanel=0xffff,themeBorder=0xc638,themeInk=0x1826,themeMuted=0x526c;
uint16_t themeChart(int slot){return themePacks[themeIndex][5+(slot+colorIndex)%5];}
uint16_t themeBlend(uint16_t a,uint16_t b,int weight){int r=((a>>11)&31)*(100-weight)+((b>>11)&31)*weight,g=((a>>5)&63)*(100-weight)+((b>>5)&63)*weight,bl=(a&31)*(100-weight)+(b&31)*weight;return ((r/100)<<11)|((g/100)<<5)|(bl/100);}
uint16_t themeColor(uint16_t c){
 if(c==0)return themeBg;if(c==0xffff)return themeInk;
 if(c==0x07ff||c==0x6e5f||c==0x3bff)return themeChart(0);
 if(c==0xf81f||c==0xf920||c==0xfa80)return themeChart(1);
 if(c==0x87e0||c==0x07b5)return themeChart(2);
 if(c==0xfd20||c==0xfd2c||c==0xffe0)return themeChart(3);
 if(c==0xaaff||c==0xb4ff)return themeChart(4);
 int rr=((c>>11)&31)*255/31,gg=((c>>5)&63)*255/63,bb=(c&31)*255/31;
 int hi=max(rr,max(gg,bb)),lo=min(rr,min(gg,bb));
 if(hi<42)return themePanel;if(hi<95)return themeBorder;
 if(hi-lo<45)return hi>175?themeInk:themeMuted;
 if(rr>gg*13/10&&rr>bb*12/10)return themeChart(1);
 if(rr>110&&gg>rr*6/10&&bb<gg*7/10)return themeChart(3);
 if(gg>rr*13/10&&gg>bb*12/10)return themeChart(2);
 if(bb>gg*13/10&&rr>gg*11/10)return themeChart(4);
 return themeChart(0);
}
const GFXfont* themeFont(int size){
 if(size==1)return nullptr;
 const GFXfont* small[]={&OrbitOfficeSmall,&OrbitRetroSmall,&OrbitCyberSmall,&OrbitBubbleSmall};
 const GFXfont* medium[]={&OrbitOfficeMedium,&OrbitRetroMedium,&OrbitCyberMedium,&OrbitBubbleMedium};
 const GFXfont* large[]={&OrbitOfficeLarge,&OrbitRetroLarge,&OrbitCyberLarge,&OrbitBubbleLarge};
 return size>=7?large[themeIndex]:size>=4?medium[themeIndex]:small[themeIndex];
}
void applyTheme(){themeBg=themeBackgrounds[themeIndex][colorIndex];themePanel=themePacks[themeIndex][1];themeBorder=themePacks[themeIndex][2];themeInk=themePacks[themeIndex][3];themeMuted=themePacks[themeIndex][4];for(int i=0;i<5;i++)accents[i]=themePacks[themeIndex][5+i];accent=themeChart(0);ink=themeInk;muted=themeMuted;panel=themePanel;}
void themeTile(int x,int y,int w,int h){if(themeIndex==3){ui.fillRoundRect(x,y,w,h,6,themePanel);ui.drawRoundRect(x,y,w,h,6,themeBorder);}else{ui.fillRect(x,y,w,h,themePanel);ui.drawRect(x,y,w,h,themeBorder);if(themeIndex==2){ui.drawLine(x+w-9,y,x+w-1,y+8,themeChart(0));}if(themeIndex==1)ui.drawFastHLine(x+3,y+h-3,w-6,themeBlend(themePanel,themeChart(0),35));}}
