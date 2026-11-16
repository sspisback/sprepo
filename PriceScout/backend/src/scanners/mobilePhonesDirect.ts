import * as cheerio from 'cheerio';
import type { ProductConfig, RetailerAdapter, Offer, ScanResult } from './types';

const baseUrl = 'https://www.mobilephonesdirect.co.uk';
const timeoutMs = 15000;
type ProductData = { productName?: string; colour?: string; capacity?: string; upfrontCost?: number; monthlyCost?: number; isInStock?: string; refurb?: string };

function modelSlug(model: string) {
  return model.toLowerCase().replace(/^iphone\s*/, 'iphone-').replace(/\s+/g, '-');
}
function parseProductData(html: string): ProductData | undefined {
  const $ = cheerio.load(html);
  let found: ProductData | undefined;
  $('script').each((_i, el) => {
    const source = $(el).text().trim();
    if (!source.includes('dLPrep') || !source.includes('upfrontCost')) return;
    const match = source.match(/\{\s*"event"\s*:\s*"dLPrep"[\s\S]*?\}\s*\}/);
    if (!match) return;
    try { found = JSON.parse(match[0]).page?.product; } catch { /* Ignore unrelated page scripts. */ }
  });
  return found;
}
async function fetchPage(url: string) {
  const response = await fetch(url, { headers: { 'user-agent': 'PriceScout/1.0 (local UK price monitor)', accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Retailer returned HTTP ${response.status}; access restrictions are not bypassed.`);
  return await response.text();
}
function matches(data: ProductData | undefined, product: ProductConfig) {
  return !!data && String(data.productName ?? '').toLowerCase().includes(product.model.toLowerCase()) &&
    String(data.capacity ?? '').toLowerCase().replace(/\s/g, '') === `${product.storage}gb` &&
    (product.colour === 'Any' || String(data.colour ?? '').toLowerCase() === product.colour.toLowerCase());
}

export const mobilePhonesDirectAdapter: RetailerAdapter = {
  id: 'mobile-phones-direct',
  supports: product=>/^iphone\s/i.test(product.model),
  async scan(product: ProductConfig): Promise<ScanResult> {
    try {
      const listingUrl = `${baseUrl}/apple/${modelSlug(product.model)}-deals?simfree=1`;
      const listingHtml = await fetchPage(listingUrl);
      const $ = cheerio.load(listingHtml);
      let selectedHtml = listingHtml;
      let data = parseProductData(listingHtml);

      if (!matches(data, product)) {
        const links = new Set<string>();
        $('a[href]').each((_i, el) => {
          const href = $(el).attr('href');
          if (!href || !href.toLowerCase().includes(modelSlug(product.model)) || !href.toLowerCase().includes(`${product.storage}gb`)) return;
          if (product.colour !== 'Any' && !href.toLowerCase().includes(product.colour.toLowerCase().replace(/\s+/g, '-'))) return;
          links.add(new URL(href, baseUrl).toString().replace(/([?&])simfree=1(&|$)/, '$1').replace(/[?&]$/, '') + '?simfree=1');
        });
        for (const url of links) {
          const html = await fetchPage(url);
          const variant = parseProductData(html);
          if (matches(variant, product)) { selectedHtml = html; data = variant; break; }
        }
      }
      if (!matches(data, product)) return { offers: [], status: 'success' };
      const price = Number(data!.upfrontCost);
      if (!Number.isFinite(price) || price <= 0 || Number(data!.monthlyCost) !== 0 || String(data!.refurb).toLowerCase() === 'yes') {
        return { offers: [], status: 'failed', error: 'Could not verify an outright, new SIM-free GBP price on the product page.' };
      }
      const $selected = cheerio.load(selectedHtml);
      const link = $selected('link[rel="canonical"]').attr('href');
      const url = link?.startsWith(`${baseUrl}/`) ? link : listingUrl;
      const stock = String(data!.isInStock).toLowerCase() === 'yes' ? 'In stock' : String(data!.isInStock).toLowerCase() === 'no' ? 'Out of stock' : 'Unknown';
      const offer: Offer = { model: product.model, storage: product.storage, colour: data!.colour || 'Unknown', condition: 'New', unlocked: true,
        basePrice: price, delivery: null, totalPrice: price, currency: 'GBP', stock, channel: 'Online', url, verifiedAt: new Date().toISOString() };
      return { offers: [offer], status: 'success' };
    } catch (error) {
      return { offers: [], status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }
};
