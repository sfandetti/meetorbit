import {deflateSync} from 'node:zlib';
// Orbit's screen as a PNG: the device sends its 8-bit frame (RGB332: rrrgggbb), one byte per pixel.
const CRC=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(buf){let c=0xffffffff;for(const b of buf)c=CRC[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){
  const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);out.write(type,4,'ascii');data.copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);return out;
}
export function rgb332ToPng(frame,width,height){
  if(frame.length!==width*height)throw Error(`Expected ${width*height} bytes, got ${frame.length}`);
  const raw=Buffer.alloc(height*(1+width*3));
  for(let y=0;y<height;y++){
    const row=y*(1+width*3);raw[row]=0;
    for(let x=0;x<width;x++){const v=frame[y*width+x],o=row+1+x*3;raw[o]=Math.round((v>>5)*255/7);raw[o+1]=Math.round((v>>2&7)*255/7);raw[o+2]=Math.round((v&3)*255/3);}
  }
  const head=Buffer.alloc(13);head.writeUInt32BE(width,0);head.writeUInt32BE(height,4);head[8]=8;head[9]=2;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
// Ask Orbit for its screen (optionally turned, on a page, in an AI view, after a tap) and return a PNG.
export async function orbitScreen({deviceIp,httpPort=8080,token,rot,page,view,tap},{fetcher=fetch}={}){
  const q=new URLSearchParams();for(const [k,v] of Object.entries({rot,page,view,tap}))if(v!==undefined&&v!==null&&v!=='')q.set(k,String(v));
  const response=await fetcher(`http://${deviceIp}:${httpPort}/screen${q.size?'?'+q:''}`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Orbit answered ${response.status}: ${(await response.text()).slice(0,80)}`);
  const width=Number(response.headers.get('x-width')),height=Number(response.headers.get('x-height'));
  return {width,height,rot:Number(response.headers.get('x-rot')),png:rgb332ToPng(Buffer.from(await response.arrayBuffer()),width,height)};
}
