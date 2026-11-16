import type { RetailerAdapter } from './types';
import { johnLewisAdapter } from './johnLewis';
import { appleAdapter } from './apple';
import { amazonAdapter } from './amazon';
import { costcoAdapter } from './costco';
import { mobilePhonesDirectAdapter } from './mobilePhonesDirect';

// A retailer is supported only after its public source, exact variant matching,
// and extraction have been verified. No guessed prices or access-control bypasses.
const unavailable: Record<string, string> = {
  currys: 'Cloudflare returned HTTP 403 with “Sorry, you have been blocked” and “Please enable cookies” for the product and category pages. PriceScout does not bypass this protection.',
  argos: 'Akamai returned HTTP 403 Access Denied for the product and category pages. PriceScout does not bypass this protection.',
  onbuy: 'Cloudflare returned HTTP 403 (“Just a moment…”) for the public iPhone listing. PriceScout does not bypass this protection.',
  mobiles: 'Cloudflare returned HTTP 403 for the public site. PriceScout does not bypass this protection.',
  very: 'The public product listing returned HTTP 403 Access Denied. PriceScout does not bypass this protection.'
};
const unconfigured: RetailerAdapter[] = Object.keys(unavailable).map(id => ({
  id,
  async scan() {
    return { offers: [], status: 'unsupported', error: unavailable[id] } as const;
  }
}));
export const adapters: RetailerAdapter[] = [johnLewisAdapter, appleAdapter, amazonAdapter, costcoAdapter, mobilePhonesDirectAdapter, ...unconfigured];
