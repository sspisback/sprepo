import cron from 'node-cron';
import { db } from '../database/db';
import { adapters } from '../scanners/registry';
import type { Offer, ProductConfig } from '../scanners/types';

let active = false;
const iso = () => new Date().toISOString();
const product = (): ProductConfig => db.prepare('SELECT model,storage,colour,condition,unlocked,exclude_contract,exclude_trade_in FROM products WHERE id=1').get() as ProductConfig;
const latestForRetailer = db.prepare(`SELECT total_price FROM observations WHERE retailer_id=? AND model=? AND storage=? AND condition=? AND unlocked=? AND (colour=? OR ?='Any') ORDER BY verified_at DESC,id DESC LIMIT 1`);

async function executeScan(configs: ProductConfig[], selectedAdapters: typeof adapters, trigger: 'Manual'|'Scheduled'|'AdHoc') {
  if (active) return { ok: false, id: null, status: 'failed', checked: 0, succeeded: 0, errors: ['A scan is already in progress.'], checkedRetailers: [], successfulRetailers: [], offers: [] };
  active = true;
  const started = iso();
  const run = db.prepare('INSERT INTO scan_runs(started_at,trigger,status) VALUES(?,?,?)').run(started, trigger, 'running');
  const runId = Number(run.lastInsertRowid);
  let checked = 0, succeeded = 0;
  const errors: string[] = [];
  const checkedRetailers = new Set<string>(), successfulRetailers = new Set<string>();
  const offers: Array<Offer & { retailerId: string }> = [];
  try {
    for (const config of configs) {
      for (const adapter of selectedAdapters) {
        if (adapter.supports && !adapter.supports(config)) continue;
        checked++;
        checkedRetailers.add(adapter.id);
        db.prepare('UPDATE retailers SET last_attempt=?,last_error=NULL WHERE id=?').run(iso(), adapter.id);
        try {
          const result = await adapter.scan(config);
          if (result.status === 'success') {
            succeeded++;
            successfulRetailers.add(adapter.id);
            db.prepare('UPDATE retailers SET last_success=?,adapter_status=?,last_error=NULL WHERE id=?').run(iso(), 'Supported', adapter.id);
            for (const offer of result.offers) {
              if (saveOffer(offer, adapter.id, runId, config, trigger !== 'AdHoc')) offers.push({ ...offer, retailerId: adapter.id });
            }
          } else {
            errors.push(`${adapter.id}: ${result.error ?? result.status}`);
            db.prepare('UPDATE retailers SET adapter_status=?,last_error=? WHERE id=?').run(result.status === 'unsupported' ? 'Unsupported' : 'Failed', result.error ?? result.status, adapter.id);
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          errors.push(`${adapter.id}: ${message}`);
          db.prepare('UPDATE retailers SET adapter_status=?,last_error=? WHERE id=?').run('Failed', message, adapter.id);
        }
      }
    }
    const status = succeeded === checked ? 'success' : succeeded ? 'partial' : 'failed';
    db.prepare('UPDATE scan_runs SET completed_at=?,checked=?,succeeded=?,status=?,errors=? WHERE id=?').run(iso(), checked, succeeded, status, JSON.stringify(errors), runId);
    return { ok: true, id: runId, status, checked, succeeded, errors, checkedRetailers: [...checkedRetailers], successfulRetailers: [...successfulRetailers], offers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare('UPDATE scan_runs SET completed_at=?,checked=?,succeeded=?,status=?,errors=? WHERE id=?').run(iso(), checked, succeeded, 'failed', JSON.stringify([...errors, message]), runId);
    return { ok: false, id: runId, status: 'failed', checked, succeeded, errors: [...errors, message], checkedRetailers: [...checkedRetailers], successfulRetailers: [...successfulRetailers], offers };
  } finally { active = false; }
}

export function runScan(trigger: 'Manual'|'Scheduled' = 'Manual') {
  const config=product();
  return executeScan([config], adapters.filter(adapter=>!adapter.supports||adapter.supports(config)), trigger);
}

export function runAdHocScan(configs: ProductConfig[], retailerIds: string[]) {
  const selected = adapters.filter(adapter => retailerIds.includes(adapter.id));
  if (!configs.length || !selected.length) return Promise.resolve({ ok: false, id: null, status: 'failed', checked: 0, succeeded: 0, errors: ['Choose at least one supported product and retailer.'], checkedRetailers: [], successfulRetailers: [], offers: [] });
  return executeScan(configs, selected, 'AdHoc');
}

function saveOffer(offer: Offer, retailerId: string, runId: number, p: ProductConfig, recordChanges: boolean) {
  if (offer.model.toLowerCase() !== p.model.toLowerCase() || offer.storage !== p.storage) return false;
  if (offer.currency !== 'GBP' || offer.condition !== p.condition || (p.unlocked && !offer.unlocked)) return false;
  if (![offer.basePrice, offer.totalPrice].every(n => Number.isFinite(n) && n > 0) || !offer.url.startsWith('https://')) return false;
  const previous = latestForRetailer.get(retailerId,offer.model,offer.storage,offer.condition,offer.unlocked?1:0,p.colour,p.colour) as { total_price?: number } | undefined;
  db.prepare(`INSERT OR IGNORE INTO observations(retailer_id,model,storage,colour,condition,unlocked,base_price,delivery,total_price,stock,channel,product_url,verified_at,scan_run_id)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(retailerId,offer.model,offer.storage,offer.colour??'Unknown',offer.condition,offer.unlocked?1:0,offer.basePrice,offer.delivery,offer.totalPrice,offer.stock,offer.channel,offer.url,offer.verifiedAt,runId);
  if (recordChanges && previous?.total_price && offer.totalPrice < previous.total_price) addDrop('retailer', retailerId, previous.total_price, offer.totalPrice, runId);
  if (!recordChanges) return true;
  const comparable = `model=? AND storage=? AND condition=? AND unlocked=? AND (colour=? OR ?='Any')`;
  const priorBest = db.prepare(`SELECT MIN(total_price) AS price FROM observations WHERE scan_run_id<>? AND ${comparable}`).get(runId,offer.model,offer.storage,offer.condition,offer.unlocked?1:0,p.colour,p.colour) as { price: number|null };
  const currentBest = db.prepare(`SELECT MIN(total_price) AS price FROM observations WHERE scan_run_id=? AND ${comparable}`).get(runId,offer.model,offer.storage,offer.condition,offer.unlocked?1:0,p.colour,p.colour) as { price:number|null };
  if (priorBest.price && currentBest.price && currentBest.price < priorBest.price) {
    const already = db.prepare('SELECT 1 FROM price_changes WHERE scan_run_id=? AND kind=?').get(runId,'best-uk');
    if (!already) addDrop('best-uk', null, priorBest.price, currentBest.price, runId);
  }
  return true;
}
function addDrop(kind:string, retailerId:string|null, before:number, after:number, runId:number) {
  const p=product();
  db.prepare('INSERT INTO price_changes(kind,retailer_id,model,storage,colour,condition,unlocked,previous_price,current_price,difference,percent,detected_at,scan_run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(kind,retailerId,p.model,p.storage,p.colour,p.condition,p.unlocked?1:0,before,after,+(after-before).toFixed(2),+(((after-before)/before)*100).toFixed(2),iso(),runId);
}

// UK wall-clock time observes GMT/BST automatically. Scheduler runs only while this backend is alive.
const ukParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const nowParts = Object.fromEntries(ukParts.formatToParts(new Date()).map(p => [p.type, p.value]));
const todayUk = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
const scheduledToday = db.prepare("SELECT id FROM scan_runs WHERE trigger='Scheduled' AND substr(started_at,1,10)=?").get(todayUk);
if (Number(nowParts.hour) >= 19 && !scheduledToday) {
  const scheduledAt = new Date().toISOString();
  db.prepare("INSERT INTO scan_runs(started_at,completed_at,trigger,checked,succeeded,status,errors) VALUES(?,?,?,0,0,'missed',?)")
    .run(scheduledAt, scheduledAt, 'Scheduled', JSON.stringify(['The 18:00 Europe/London scan was missed because the backend was not running.']));
}
cron.schedule('0 18 * * *', () => { void runScan('Scheduled'); }, { timezone: 'Europe/London' });
