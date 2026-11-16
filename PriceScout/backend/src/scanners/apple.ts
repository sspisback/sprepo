import * as cheerio from 'cheerio';
import type { ProductConfig, RetailerAdapter, Offer, ScanResult } from './types';

type AppleVariant = { name?: string; price?: { fullPrice?: number }; sku?: string };
function arrayAfterKey(text: string, key: string): any[] {
  const keyAt=text.indexOf(key); if(keyAt<0)return [];
  const start=text.indexOf('[',keyAt);if(start<0)return[];
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<text.length;i++){
    const c=text[i];
    if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
    if(c==='"'){inString=true;continue;}
    if(c==='[')depth++;
    if(c===']'&&--depth===0){try{const parsed=JSON.parse(text.slice(start,i+1));return Array.isArray(parsed)?parsed:[]}catch{return[]}}
  }
  return[];
}
function colourMatches(preference:string,name:string){return preference==='Any'||name.toLowerCase().includes(preference.toLowerCase());}
export const appleAdapter: RetailerAdapter = {
 id:'apple',
 supports: product=>/^iphone\s/i.test(product.model),
 async scan(product:ProductConfig):Promise<ScanResult>{
  try{
   const modelSlug=product.model.toLowerCase().trim().replace(/^iphone\s*/, 'iphone-').replace(/\s+/g,'-');
   const url=`https://www.apple.com/uk/shop/buy-iphone/${encodeURIComponent(modelSlug).replace(/%2D/gi,'-')}`;
   const response=await fetch(url,{headers:{'user-agent':'PriceScout/1.0 (local price monitor)',accept:'text/html'},signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw new Error(`Retailer returned HTTP ${response.status}.`);
   const html=await response.text(),$=cheerio.load(html);let variants:AppleVariant[]=[];
   $('script').each((_i,e)=>{const text=$(e).text();if(text.includes('"products"')&&text.includes('"fullPrice"')){const found=arrayAfterKey(text,'"products"');if(found.some((v:any)=>typeof v?.price?.fullPrice==='number'))variants=found;}});
   const expectedModel=product.model.toLowerCase();
   const selected=variants.filter(v=>typeof v.name==='string'&&v.name.toLowerCase().includes(expectedModel)&&v.name.toLowerCase().includes(`${product.storage}gb`)&&colourMatches(product.colour,v.name)&&Number.isFinite(Number(v.price?.fullPrice)));
   if(!variants.some(v=>typeof v.price?.fullPrice==='number'))return{offers:[],status:'failed',error:'Could not read numeric Apple product prices from the public page.'};
   if(!selected.length)return{offers:[],status:'success'};
   const freeDelivery=$('script[type="application/ld+json"]').toArray().some(el=>{
    try{const d=JSON.parse($(el).text()),offers=Array.isArray(d.offers)?d.offers:[d.offers];return offers.some((o:any)=>Number(o?.shippingDetails?.shippingRate?.value)===0&&o?.priceCurrency==='GBP')}catch{return false}
   });
   const offers:Offer[]=selected.map(v=>({model:product.model,storage:product.storage,colour:v.name!.replace(new RegExp(`^${product.model}\\s*${product.storage}GB\\s*`,'i'),'').trim()||'Unknown',condition:'New',unlocked:true,basePrice:Number(v.price!.fullPrice),delivery:freeDelivery?0:null,totalPrice:Number(v.price!.fullPrice),currency:'GBP',stock:'Unknown',channel:'Online',url,verifiedAt:new Date().toISOString()}));
   return{offers,status:'success'};
  }catch(error){return{offers:[],status:'failed',error:error instanceof Error?error.message:String(error)}}
 }
};
