import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { db } from './database/db';
import { phoneModels } from './config/models';
import { runAdHocScan } from './services/scanner';
import { adapters } from './scanners/registry';
import type { ProductConfig } from './scanners/types';

const server = new McpServer({ name: 'pricescout', version: '1.0.0' });
const model = z.string().trim().min(1).max(100);
const storage = z.number().int().positive().optional();
const days = z.number().int().min(1).max(3650).default(7);
const retailer = z.string().trim().min(1).max(100).optional();
function product(modelName: string, capacity?: number, condition = 'New', unlocked = true): ProductConfig {
  const choice = phoneModels.find(p => p.model.toLowerCase() === modelName.trim().toLowerCase());
  if (!choice) throw new Error(`Unsupported model. Choose one of: ${phoneModels.map(p => p.model).join(', ')}`);
  const selectedStorage = capacity ?? choice.storage[0];
  if (!(choice.storage as readonly number[]).includes(selectedStorage)) throw new Error(`Unsupported storage for ${choice.model}. Supported: ${choice.storage.join(', ')} GB.`);
  return { model: choice.model, storage: selectedStorage, colour: 'Any', condition, unlocked, exclude_contract: true, exclude_trade_in: true };
}
function result(data: unknown, message?: string) { return { content: [{ type: 'text' as const, text: JSON.stringify({ ...(message ? { message } : {}), data }, null, 2) }], structuredContent: { data } }; }
const common = { model, storage, days, retailer };

server.registerTool('get_price_history', { description: 'Retrieve historical saved PriceScout price observations. Does not perform a retailer scan.', inputSchema: common }, async ({ model: m, storage: s, days: d, retailer: r }) => {
  const p = product(m, s); const since = new Date(Date.now() - d * 86400000).toISOString();
  const rows = db.prepare(`SELECT o.model,o.storage,r.name retailer,o.total_price price_gbp,o.verified_at,o.product_url FROM observations o JOIN retailers r ON r.id=o.retailer_id WHERE o.model=? AND o.storage=? AND o.verified_at>=? AND (? IS NULL OR r.name LIKE ?) ORDER BY o.verified_at DESC`).all(p.model,p.storage,since,r??null,r?`%${r}%`:null);
  return result({ model:p.model,storage:p.storage,observations:rows,count:rows.length }, rows.length ? undefined : 'No matching saved observations in this period.');
});
server.registerTool('get_price_drops', { description: 'Retrieve verified saved price reductions calculated by PriceScout. Does not scan retailers.', inputSchema: common }, async ({ model:m,storage:s,days:d,retailer:r }) => {
  const p=product(m,s); const since=new Date(Date.now()-d*86400000).toISOString();
  const rows=db.prepare(`SELECT r.name retailer,c.model,c.storage,c.previous_price,c.current_price,c.difference,c.percent,c.detected_at,c.scan_run_id FROM price_changes c LEFT JOIN retailers r ON r.id=c.retailer_id WHERE c.model=? AND c.storage=? AND c.detected_at>=? AND (? IS NULL OR r.name LIKE ?) ORDER BY c.detected_at DESC`).all(p.model,p.storage,since,r??null,r?`%${r}%`:null);
  return result({ drops:rows,count:rows.length },rows.length?undefined:'No matching verified price reductions in this period.');
});
server.registerTool('compare_retailers', { description: 'Compare each retailer’s latest saved offer for the same model and storage. Prices are observations, not live quotes.', inputSchema: { model,storage,condition:z.string().default('New'),unlocked:z.boolean().default(true) } }, async ({model:m,storage:s,condition:c,unlocked:u}) => {
  const p=product(m,s,c,u); const rows=db.prepare(`SELECT r.name retailer,o.base_price,o.delivery,o.total_price,o.stock,o.verified_at,o.product_url FROM observations o JOIN retailers r ON r.id=o.retailer_id WHERE o.model=? AND o.storage=? AND o.condition=? AND o.unlocked=? AND o.currency='GBP' AND o.id IN (SELECT MAX(i.id) FROM observations i WHERE i.model=o.model AND i.storage=o.storage AND i.condition=o.condition AND i.unlocked=o.unlocked AND i.retailer_id=o.retailer_id GROUP BY i.retailer_id) ORDER BY o.total_price`).all(p.model,p.storage,p.condition,p.unlocked?1:0) as any[];
  return result({ offers:rows,lowest:rows[0]??null,count:rows.length },rows.length?undefined:'No comparable saved offers.');
});
server.registerTool('search_prices', { description: 'Run retailer website requests using configured PriceScout adapters and save verified observations. May cause external requests and database writes; unsupported or failed retailers are reported.', inputSchema: { model,storage,maxPrice:z.number().positive().optional(),condition:z.string().default('New'),unlocked:z.boolean().default(true) } }, async ({model:m,storage:s,maxPrice,condition:c,unlocked:u}) => {
  const p=product(m,s,c,u); const scan=await runAdHocScan([p],adapters.map(a=>a.id));
  const offers=(scan.offers??[]).filter((o:any)=>maxPrice===undefined||o.totalPrice<=maxPrice);
  return result({status:scan.status,offers,failures:scan.errors??[],checked:scan.checked,succeeded:scan.succeeded});
});

const transport = new StdioServerTransport();
server.connect(transport).catch(error => { console.error('PriceScout MCP startup failed:', error); process.exitCode=1; });
