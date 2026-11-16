import * as cheerio from 'cheerio';
import type { ProductConfig, RetailerAdapter, Offer, ScanResult } from './types';

const categoryUrl = 'https://www.costco.co.uk/TVs-Electronics-Security/Apple-Devices/iPhone/c/cos_26.9.1';
const baseUrl = 'https://www.costco.co.uk';
const timeoutMs = 15000;

function modelSlug(model: string) {
  return model.toLowerCase().replace(/^iphone\s*/, 'iphone-').replace(/\s+/g, '-');
}
function slugColour(colour: string) {
  return colour.toLowerCase().replace(/\s+/g, '-');
}
function colourFrom(name: string) {
  const match = name.match(/\bin\s+(.+?)(?:,\s*[A-Z0-9]{5,}|$)/i);
  return match?.[1]?.trim() || 'Unknown';
}
async function readPage(url: string) {
  const response = await fetch(url, { headers: { 'user-agent': 'PriceScout/1.0 (local UK price monitor)', accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Retailer returned HTTP ${response.status}; access restrictions are not bypassed.`);
  return await response.text();
}
function jsonLd(html: string) {
  const $ = cheerio.load(html);
  const data: any[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try { const parsed = JSON.parse($(el).text()); data.push(...(Array.isArray(parsed) ? parsed : [parsed])); } catch { /* Ignore malformed JSON-LD. */ }
  });
  return data;
}

export const costcoAdapter: RetailerAdapter = {
  id: 'costco-uk',
  supports: product=>/^iphone\s/i.test(product.model),
  async scan(product: ProductConfig): Promise<ScanResult> {
    try {
      const $ = cheerio.load(await readPage(categoryUrl));
      const slug = modelSlug(product.model);
      const candidates = new Set<string>();
      $('a[href*="/p/"]').each((_i, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const lower = href.toLowerCase();
        const modelAt = lower.indexOf(slug);
        if (modelAt < 0) return;
        const afterModel = lower.slice(modelAt + slug.length);
        if (!new RegExp(`^-${product.storage}gb(?:-|/|%2d)`, 'i').test(afterModel)) return;
        if (!lower.includes('sim-free')) return;
        // Prefer colour-specific product pages so "Any" can retain distinct variants.
        if (lower.includes('-in-')) candidates.add(new URL(href, baseUrl).toString());
      });
      if (!candidates.size) return { offers: [], status: 'success' };

      const offers: Offer[] = [];
      for (const url of candidates) {
        const products = jsonLd(await readPage(url)).filter(item => String(item?.['@type']).toLowerCase() === 'product');
        for (const item of products) {
          const name = String(item.name ?? '');
          if (!name.toLowerCase().includes(product.model.toLowerCase()) || !new RegExp(`\\b${product.storage}\\s*GB\\b`, 'i').test(name) || !/sim.free/i.test(name)) continue;
          const colour = colourFrom(name);
          if (product.colour !== 'Any' && slugColour(colour) !== slugColour(product.colour)) continue;
          const choices = Array.isArray(item.offers) ? item.offers : item.offers ? [item.offers] : [];
          const offer = choices.find((o: any) => o.priceCurrency === 'GBP' && Number.isFinite(Number(o.price)) && Number(o.price) > 0 && /NewCondition$/i.test(String(o.itemCondition)));
          if (!offer) continue;
          const price = Number(offer.price);
          const delivery = Number(offer.shippingDetails?.shippingRate?.value);
          const shipping = Number.isFinite(delivery) ? delivery : null;
          const offerUrl = typeof offer.url === 'string' && offer.url.startsWith('https://www.costco.co.uk/') ? offer.url : url;
          offers.push({ model: product.model, storage: product.storage, colour, condition: 'New', unlocked: true,
            basePrice: price, delivery: shipping, totalPrice: price + (shipping ?? 0), currency: 'GBP',
            stock: /InStock$/i.test(String(offer.availability)) ? 'In stock' : /OutOfStock$/i.test(String(offer.availability)) ? 'Out of stock' : 'Unknown',
            channel: 'Online', url: offerUrl, verifiedAt: new Date().toISOString() });
        }
      }
      return { offers: [...new Map(offers.map(o => [o.colour, o])).values()], status: 'success' };
    } catch (error) {
      return { offers: [], status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }
};
