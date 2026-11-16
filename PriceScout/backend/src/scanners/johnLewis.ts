import * as cheerio from 'cheerio';
import type { ProductConfig, RetailerAdapter, Offer, ScanResult } from './types';

type ProductVariant = { name?: string; url?: string; color?: string; offers?: Record<string, any>|Record<string, any>[] };
const timeoutMs = 12000;
async function readPublicPage(url: string) {
  const response = await fetch(url, { headers: { 'user-agent': 'PriceScout/1.0 (local UK price monitor)', accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Retailer returned HTTP ${response.status}; no access restrictions are bypassed.`);
  return await response.text();
}
function structuredData(html: string): any[] {
  const $ = cheerio.load(html);
  const output: any[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      output.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* Ignore malformed or non-JSON scripts. */ }
  });
  return output;
}
function normalizedColour(value: string) { return value.toLowerCase().replace('soft pink', 'pink').trim(); }
function variants(data: any[]): ProductVariant[] {
  for (const entry of data) {
    if (entry?.['@type'] === 'ProductGroup' && Array.isArray(entry.hasVariant)) return entry.hasVariant;
  }
  return [];
}

export const johnLewisAdapter: RetailerAdapter = {
  id: 'john-lewis',
  async scan(product: ProductConfig): Promise<ScanResult> {
    try {
      const query = encodeURIComponent(`${product.model} ${product.storage}GB SIM Free`);
      const searchUrl = `https://www.johnlewis.com/search?search-term=${query}`;
      const listing = structuredData(await readPublicPage(searchUrl));
      const urls = listing.flatMap(item => item?.['@type'] === 'ItemList' && Array.isArray(item.itemListElement) ? item.itemListElement.map((x: any) => x.url).filter((u: unknown): u is string => typeof u === 'string') : []);
      const modelSlug = product.model.toLowerCase().replace(/^iphone\s*/, 'iphone-').replace(/\s+/g, '-');
      const candidate = urls.find(url => {
        const slug = url.toLowerCase();
        return slug.includes(modelSlug) && slug.includes(`${product.storage}gb`) && slug.includes('sim-free');
      });
      if (!candidate) return { offers: [], status: 'success' };

      const productData = structuredData(await readPublicPage(candidate));
      const exactVariants = variants(productData).filter(v => {
        const name = (v.name ?? '').toLowerCase();
        return name.includes(product.model.toLowerCase()) && name.includes(`${product.storage}gb`) && name.includes('sim free');
      });
      const offers: Offer[] = [];
      for (const variant of exactVariants) {
        const colour = String(variant.color ?? 'Unknown');
        if (product.colour !== 'Any' && normalizedColour(colour) !== normalizedColour(product.colour)) continue;
        const choices = Array.isArray(variant.offers) ? variant.offers : variant.offers ? [variant.offers] : [];
        const choice = choices.find(o => o.priceCurrency === 'GBP' && Number.isFinite(Number(o.price)) && /InStock$/i.test(String(o.availability)));
        if (!choice) continue;
        const freeStandard = (choice.shippingDetails ?? []).some((d: any) => /free standard delivery/i.test(String(d.name)) && Number(d.shippingRate?.value) === 0);
        if (!freeStandard) continue;
        const basePrice = Number(choice.price);
        const url = typeof choice.url === 'string' && choice.url.startsWith('https://www.johnlewis.com/') ? choice.url : variant.url;
        if (!url?.startsWith('https://www.johnlewis.com/')) continue;
        offers.push({ model: product.model, storage: product.storage, colour, condition: 'New', unlocked: true,
          basePrice, delivery: 0, totalPrice: basePrice, currency: 'GBP', stock: 'In stock', channel: 'Online', url, verifiedAt: new Date().toISOString() });
      }
      return { offers, status: 'success' };
    } catch (error) {
      return { offers: [], status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }
};
