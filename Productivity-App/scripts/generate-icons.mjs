import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const sizes = [16, 32, 64, 80, 128];
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function icon(size) {
  const px = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 80;
  const circle = (x, y, r, color) => {
    for (let py = Math.max(0, Math.floor(y-r)); py < Math.min(size, Math.ceil(y+r)); py++)
      for (let pxx = Math.max(0, Math.floor(x-r)); pxx < Math.min(size, Math.ceil(x+r)); pxx++)
        if ((pxx-x)**2 + (py-y)**2 <= r*r) set(pxx, py, color);
  };
  const set = (x, y, rgba) => { const i = y*(size*4+1)+1+x*4; px[i]=rgba[0];px[i+1]=rgba[1];px[i+2]=rgba[2];px[i+3]=rgba[3]; };
  const bg1=[126,117,245,255], bg2=[83,71,203,255];
  for(let y=0;y<size;y++){px[y*(size*4+1)]=0;for(let x=0;x<size;x++){
    const edge=Math.min(x,y,size-1-x,size-1-y), radius=15*scale;
    if(edge>=radius || (x-radius)**2+(y-radius)**2<=radius**2 || (x-(size-1-radius))**2+(y-radius)**2<=radius**2 || (x-radius)**2+(y-(size-1-radius))**2<=radius**2 || (x-(size-1-radius))**2+(y-(size-1-radius))**2<=radius**2){
      const t=y/Math.max(1,size-1);set(x,y,bg1.map((v,i)=>Math.round(v+(bg2[i]-v)*t)));
    }
  }}
  const white=[255,255,255,255], s=(n)=>n*scale;
  // A compact, friendly brain mark made from overlapping lobes.
  circle(s(35),s(34),s(15),white);circle(s(48),s(34),s(15),white);
  circle(s(34),s(47),s(12),white);circle(s(47),s(47),s(12),white);
  for(let y=Math.round(s(27));y<Math.round(s(53));y++)for(let x=Math.round(s(39));x<Math.round(s(43));x++)set(x,y,[112,101,224,255]);
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(px)),chunk("IEND",Buffer.alloc(0))]);
}
await mkdir("public/assets", { recursive: true });
for (const size of sizes) await writeFile(`public/assets/icon-${size}.png`, icon(size));
