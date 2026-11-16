import * as cheerio from 'cheerio';
import type { ProductConfig, RetailerAdapter, Offer, ScanResult } from './types';

function priceOf(text:string){const m=text.replace(/\s/g,'').match(/([\d,]+(?:\.\d{2})?)/);if(!m)return null;const n=Number(m[1].replace(/,/g,''));return Number.isFinite(n)&&n>0?n:null}
function colourFrom(title:string){const match=title.match(/;\s*(Black|White|Soft\s+Pink|Pink|Blue|Green|Purple|Silver|Gold|Natural\s+Titanium|Desert\s+Titanium|White\s+Titanium|Black\s+Titanium)(?:\s+Options\b.*)?\s*$/i);return match?match[1].replace(/\s+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()):'Unknown'}
export const amazonAdapter:RetailerAdapter={
 id:'amazon-uk',
 async scan(product:ProductConfig):Promise<ScanResult>{
  try{
   const query=encodeURIComponent(`${product.model} ${product.storage}GB unlocked`),searchUrl=`https://www.amazon.co.uk/s?k=${query}`;
   const searchResponse=await fetch(searchUrl,{headers:{'user-agent':'PriceScout/1.0 (local price monitor)',accept:'text/html'},signal:AbortSignal.timeout(12000)});
   if(!searchResponse.ok)throw new Error(`Retailer returned HTTP ${searchResponse.status}.`);
   const searchHtml=await searchResponse.text(),$=cheerio.load(searchHtml),cards:any[]=[];
   $('[data-component-type="s-search-result"]').each((_i,el)=>{
    const card=$(el),title=card.find('h2').text().replace(/\s+/g,' ').trim(),href=card.find('a[href*="/dp/"]').first().attr('href');
    const text=card.text().replace(/\s+/g,' '),price=priceOf(card.find('.a-price .a-offscreen').first().text());
    if(!title||!href||!price)return;
    if(!title.toLowerCase().includes(product.model.toLowerCase())||!new RegExp(`\\b${product.storage}\\s*GB\\b`,'i').test(title))return;
    if(/renewed|refurbished|contract|trade.?in/i.test(title))return;
    const colour=colourFrom(title);
    if(product.colour!=='Any'&&!colour.toLowerCase().includes(product.colour.toLowerCase()))return;
    const match=href.match(/\/dp\/([A-Z0-9]{10})/i);if(!match)return;
    cards.push({asin:match[1],title,colour,listingPrice:price,listingText:text,url:`https://www.amazon.co.uk/dp/${match[1]}`});
   });
   const unique=[...new Map(cards.map(c=>[c.asin,c])).values()].slice(0,5),offers:Offer[]=[];
   for(const item of unique){
    const response=await fetch(item.url,{headers:{'user-agent':'PriceScout/1.0 (local price monitor)',accept:'text/html'},signal:AbortSignal.timeout(12000)});
    if(!response.ok)continue;
    const page=cheerio.load(await response.text()),title=page('#productTitle').text().replace(/\s+/g,' ').trim();
    const seller=page('#merchantInfoFeature_feature_div .offer-display-feature-text-message').last().text().replace(/\s+/g,' ').trim();
    if(!title.toLowerCase().includes(product.model.toLowerCase())||!new RegExp(`\\b${product.storage}\\s*GB\\b`,'i').test(title))continue;
    if(seller.toLowerCase()!=='amazon')continue; // Exclude unverified third-party marketplace sellers.
    const carrier=page('tr.po-wireless_provider .po-break-word').text().replace(/\s+/g,' ').trim();
    if(product.unlocked&&!/unlocked|sim.?free/i.test(`${carrier} ${title}`))continue;
    const basePrice=priceOf(page('#corePrice_feature_div .a-offscreen').first().text());
    if(!basePrice)continue;
    const stockText=page('#availability').text().replace(/\s+/g,' ').trim();
    const stock= /\bin stock\b/i.test(stockText)?'In stock':/out of stock|currently unavailable/i.test(stockText)?'Out of stock':'Unknown';
    const delText=item.listingText;
    const delivery=/free delivery/i.test(delText)?0:null;
    const colour=colourFrom(title);
    if(product.colour!=='Any'&&!colour.toLowerCase().includes(product.colour.toLowerCase()))continue;
    offers.push({model:product.model,storage:product.storage,colour,condition:'New',unlocked:true,basePrice,delivery,totalPrice:basePrice+(delivery??0),currency:'GBP',stock,channel:'Online',url:item.url,verifiedAt:new Date().toISOString()});
   }
   return{offers,status:'success'};
  }catch(error){return{offers:[],status:'failed',error:error instanceof Error?error.message:String(error)}}
 }
};
