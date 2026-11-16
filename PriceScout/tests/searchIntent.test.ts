import { afterEach, describe, expect, it, vi } from 'vitest';
import { largestDropsFromObservations } from '../backend/src/services/historyMath';
import { interpretSearch, normalizeObviousAnalysis, searchCriteriaSchema, validateSearchProducts } from '../backend/src/services/searchIntent';

const validCriteria = {
  intent: 'live', analysis: 'lowest',
  products: [{ model: 'iPhone 17e', storage: 256, colour: null, condition: 'New', unlocked: true }],
  maximumPrice: 600, retailerPreferences: [], onlineOrInStore: 'online',
  dateRange: { days: null, from: null, to: null }, sortOrder: 'price-asc',
  requiresLiveScan: true, clarificationNeeded: false, clarificationQuestion: null
};
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const tags = () => response({ models: [{ name: process.env.OLLAMA_MODEL ?? 'llama3.2:3b', details: { family: 'llama' } }] });
afterEach(() => vi.unstubAllGlobals());

describe('ad hoc search intent', () => {
  it('validates the basic iPhone 17e live search and price ceiling', () => {
    expect(searchCriteriaSchema.safeParse(validCriteria).success).toBe(true);
    expect(validateSearchProducts(validCriteria as any)).toEqual([]);
    expect(validCriteria.maximumPrice).toBe(600);
  });

  it('asks for storage instead of assuming it', () => {
    const criteria = { ...validCriteria, products: [{ ...validCriteria.products[0], storage: null }] };
    expect(validateSearchProducts(criteria as any)[0]).toContain('Which storage size');
  });

  it('explains phone models outside the catalogue', () => {
    const criteria = { ...validCriteria, products: [{ ...validCriteria.products[0], model: 'Google Pixel 99 Pro' }] };
    expect(validateSearchProducts(criteria as any)[0]).toContain('currently supports these phone models');
  });

  it('normalizes obvious current cheapest and recent price-drop questions', () => {
    expect(normalizeObviousAnalysis('Find the cheapest iPhone 17e now.', { ...validCriteria, analysis: 'biggest-drop' } as any).analysis).toBe('lowest');
    expect(normalizeObviousAnalysis('Show iPhone 17e prices that dropped last week.', { ...validCriteria, analysis: 'lowest' } as any).analysis).toBe('price-changes');
  });

  it('asks the installed local Llama model for criteria and validates the JSON response', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api/tags')) return tags();
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(process.env.OLLAMA_MODEL ?? 'llama3.2:3b');
      expect(body.stream).toBe(false);
      return response({ message: { content: JSON.stringify(validCriteria) } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const criteria = await interpretSearch('Find the cheapest new unlocked iPhone 17e 256GB under £600.');
    expect(criteria.maximumPrice).toBe(600);
    expect(criteria.products[0]).toMatchObject({ model: 'iPhone 17e', storage: 256, unlocked: true });
  });

  it('retries invalid model JSON once, then returns validated criteria', async () => {
    let chatCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/tags')) return tags();
      chatCount++;
      return response({ message: { content: chatCount === 1 ? 'not JSON' : JSON.stringify(validCriteria) } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(interpretSearch('Find the cheapest iPhone 17e 256GB under £600.')).resolves.toMatchObject({ maximumPrice: 600 });
    expect(chatCount).toBe(2);
  });

  it('does not silently accept a storage size the user did not request', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/api/tags')
      ? tags()
      : response({ message: { content: JSON.stringify(validCriteria) } }));
    vi.stubGlobal('fetch', fetchMock);
    const criteria=await interpretSearch('Find a new unlocked iPhone 17e under £600.');
    expect(criteria.products[0]).toMatchObject({model:'iPhone 17e',storage:null,condition:'New',unlocked:true});
    expect(criteria.clarificationNeeded).toBe(true);
    expect(criteria.maximumPrice).toBe(600);
  });

  it('turns a clear cheapest iPhone request into a direct all retailer search across its storage sizes', async () => {
    const hallucinated = { ...validCriteria, intent: 'comparison', analysis: 'compare-periods', requiresLiveScan: false,
      products: [1, 2, 3].map(() => ({ model: null, storage: null, colour: null, condition: null, unlocked: null })),
      retailerPreferences: ['apple'], clarificationNeeded: true, clarificationQuestion: 'Which iPhone model do you want to search for?' };
    const fetchMock = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/api/tags')
      ? tags()
      : response({ message: { content: JSON.stringify(hallucinated) } }));
    vi.stubGlobal('fetch', fetchMock);
    const criteria = await interpretSearch('Find the cheapest iPhone 16e from all retailers.');
    expect(criteria).toMatchObject({ intent: 'live', analysis: 'lowest', requiresLiveScan: true, retailerPreferences: [], clarificationNeeded: false });
    expect(criteria.products.map(item => item.storage)).toEqual([128, 256, 512]);
    expect(criteria.products.every(item => item.model === 'iPhone 16e')).toBe(true);
  });

  it('recognizes a Pixel alias and searches its listed storage variants', async () => {
    const pixelCriteria = { ...validCriteria, maximumPrice: null, products: [{ ...validCriteria.products[0], model: 'Pixel 10 Pro XL', storage: 256 }] };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).endsWith('/api/tags')
      ? tags()
      : response({ message: { content: JSON.stringify(pixelCriteria) } })));
    const criteria = await interpretSearch('Find the cheapest Pixel 10 Pro XL from all retailers.');
    expect(criteria).toMatchObject({ intent: 'live', requiresLiveScan: true, retailerPreferences: [], clarificationNeeded: false });
    expect(criteria.products.map(item => item.model)).toEqual(['Google Pixel 10 Pro XL','Google Pixel 10 Pro XL','Google Pixel 10 Pro XL']);
    expect(criteria.products.map(item => item.storage)).toEqual([256,512,1024]);
  });

  it('resolves a Galaxy S26 Ultra request to the exact catalogue model and storage', async () => {
    const galaxyCriteria = { ...validCriteria, maximumPrice: null, products: [{ ...validCriteria.products[0], model: 'Galaxy S26', storage: 256 }] };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => String(input).endsWith('/api/tags')
      ? tags()
      : response({ message: { content: JSON.stringify(galaxyCriteria) } })));
    const criteria = await interpretSearch('Find the cheapest Galaxy S26 Ultra 512GB from all retailers.');
    expect(criteria).toMatchObject({ intent: 'live', requiresLiveScan: true, retailerPreferences: [], clarificationNeeded: false });
    expect(criteria.products).toHaveLength(1);
    expect(criteria.products[0]).toMatchObject({model:'Samsung Galaxy S26 Ultra',storage:512});
  });

  it('reports local Ollama unavailable without falling back to a cloud model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(interpretSearch('Find an iPhone')).rejects.toThrow('AI search interpretation is temporarily unavailable');
  });

  it('rejects unexpected executable fields in model output', () => {
    expect(searchCriteriaSchema.safeParse({ ...validCriteria, sql: 'DROP TABLE observations' }).success).toBe(false);
  });
});

describe('historical calculations', () => {
  it('compares each retailer minimum per scan and reports only verified reductions', () => {
    const rows = [
      { retailer_id: 'john-lewis', retailer: 'John Lewis', model: 'iPhone 17e', storage: 256, scan_run_id: 1, scan_at: '2026-11-01T12:00:00Z', verified_at: '2026-11-01T12:01:00Z', total_price: 599, product_url: 'https://example.test/black' },
      { retailer_id: 'john-lewis', retailer: 'John Lewis', model: 'iPhone 17e', storage: 256, scan_run_id: 1, scan_at: '2026-11-01T12:00:00Z', verified_at: '2026-11-01T12:01:01Z', total_price: 579, product_url: 'https://example.test/pink' },
      { retailer_id: 'john-lewis', retailer: 'John Lewis', model: 'iPhone 17e', storage: 256, scan_run_id: 2, scan_at: '2026-11-08T12:00:00Z', verified_at: '2026-11-08T12:01:00Z', total_price: 549, product_url: 'https://example.test/pink' },
      { retailer_id: 'amazon-uk', retailer: 'Amazon UK', model: 'iPhone 17e', storage: 256, scan_run_id: 1, scan_at: '2026-11-01T12:00:00Z', verified_at: '2026-11-01T12:02:00Z', total_price: 650, product_url: 'https://example.test/amazon' },
      { retailer_id: 'amazon-uk', retailer: 'Amazon UK', model: 'iPhone 17e', storage: 256, scan_run_id: 2, scan_at: '2026-11-08T12:00:00Z', verified_at: '2026-11-08T12:02:00Z', total_price: 669, product_url: 'https://example.test/amazon' }
    ];
    expect(largestDropsFromObservations(rows as any)).toMatchObject([{ retailer: 'John Lewis', previous_price: 579, current_price: 549, difference: -30 }]);
  });
});
