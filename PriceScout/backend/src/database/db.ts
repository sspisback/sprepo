import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'pricescout.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY CHECK(id=1), model TEXT NOT NULL, storage INTEGER NOT NULL, colour TEXT NOT NULL DEFAULT 'Any',
 condition TEXT NOT NULL DEFAULT 'New', unlocked INTEGER NOT NULL DEFAULT 1, exclude_contract INTEGER NOT NULL DEFAULT 1,
 exclude_trade_in INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS retailers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, website TEXT NOT NULL, type TEXT NOT NULL, method TEXT NOT NULL,
 adapter_status TEXT NOT NULL, last_attempt TEXT, last_success TEXT, last_error TEXT
);
CREATE TABLE IF NOT EXISTS scan_runs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, completed_at TEXT, trigger TEXT NOT NULL,
 checked INTEGER NOT NULL DEFAULT 0, succeeded INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'running', errors TEXT
);
CREATE TABLE IF NOT EXISTS observations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL DEFAULT 1, retailer_id TEXT NOT NULL REFERENCES retailers(id),
 model TEXT NOT NULL, storage INTEGER NOT NULL, colour TEXT NOT NULL DEFAULT 'Unknown', condition TEXT NOT NULL, unlocked INTEGER NOT NULL, base_price REAL NOT NULL,
 delivery REAL, total_price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'GBP', stock TEXT NOT NULL, channel TEXT NOT NULL,
 product_url TEXT NOT NULL, verified_at TEXT NOT NULL, scan_run_id INTEGER NOT NULL REFERENCES scan_runs(id),
 UNIQUE(retailer_id, model, storage, colour, condition, unlocked, total_price, stock, verified_at)
);
CREATE TABLE IF NOT EXISTS price_changes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, retailer_id TEXT, model TEXT NOT NULL DEFAULT '', storage INTEGER NOT NULL DEFAULT 0,
 colour TEXT NOT NULL DEFAULT 'Any', condition TEXT NOT NULL DEFAULT 'New', unlocked INTEGER NOT NULL DEFAULT 1, previous_price REAL NOT NULL,
 current_price REAL NOT NULL, difference REAL NOT NULL, percent REAL NOT NULL, detected_at TEXT NOT NULL,
 scan_run_id INTEGER NOT NULL REFERENCES scan_runs(id)
);
CREATE TABLE IF NOT EXISTS search_history (id INTEGER PRIMARY KEY AUTOINCREMENT, prompt TEXT NOT NULL, created_at TEXT NOT NULL);
`);
const searchColumns = new Set((db.pragma('table_info(search_history)') as {name:string}[]).map(column => column.name));
for (const [name,definition] of [
 ['criteria_json','TEXT'], ['intent','TEXT'], ['scan_run_id','INTEGER'], ['results_json','TEXT'],
 ['summary','TEXT'], ['status',"TEXT NOT NULL DEFAULT 'saved'"], ['completed_at','TEXT'], ['parent_id','INTEGER']
] as const) {
 if (!searchColumns.has(name)) db.exec(`ALTER TABLE search_history ADD COLUMN ${name} ${definition}`);
}
const observationColumns = new Set((db.pragma('table_info(observations)') as {name:string}[]).map(c=>c.name));
if (!observationColumns.has('colour')) db.exec("ALTER TABLE observations ADD COLUMN colour TEXT NOT NULL DEFAULT 'Unknown'");
const changeColumns = new Set((db.pragma('table_info(price_changes)') as {name:string}[]).map(c=>c.name));
for (const [name,definition] of [['model',"TEXT NOT NULL DEFAULT ''"],['storage','INTEGER NOT NULL DEFAULT 0'],['colour',"TEXT NOT NULL DEFAULT 'Any'"],['condition',"TEXT NOT NULL DEFAULT 'New'"],['unlocked','INTEGER NOT NULL DEFAULT 1']] as const) {
 if (!changeColumns.has(name)) db.exec(`ALTER TABLE price_changes ADD COLUMN ${name} ${definition}`);
}
const observationSchema=(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='observations'").get() as {sql:string}).sql;
if(!/UNIQUE\s*\(\s*retailer_id\s*,\s*model\s*,\s*storage\s*,\s*colour\s*,\s*condition\s*,\s*unlocked/i.test(observationSchema)){
 db.exec(`CREATE TABLE observations_rebuild(
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL DEFAULT 1, retailer_id TEXT NOT NULL REFERENCES retailers(id),
  model TEXT NOT NULL, storage INTEGER NOT NULL, colour TEXT NOT NULL DEFAULT 'Unknown', condition TEXT NOT NULL, unlocked INTEGER NOT NULL,
  base_price REAL NOT NULL, delivery REAL, total_price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'GBP', stock TEXT NOT NULL,
  channel TEXT NOT NULL, product_url TEXT NOT NULL, verified_at TEXT NOT NULL, scan_run_id INTEGER NOT NULL REFERENCES scan_runs(id),
  UNIQUE(retailer_id,model,storage,colour,condition,unlocked,total_price,stock,verified_at));
  INSERT OR IGNORE INTO observations_rebuild(id,product_id,retailer_id,model,storage,colour,condition,unlocked,base_price,delivery,total_price,currency,stock,channel,product_url,verified_at,scan_run_id)
   SELECT id,product_id,retailer_id,model,storage,colour,condition,unlocked,base_price,delivery,total_price,currency,stock,channel,product_url,verified_at,scan_run_id FROM observations;
  DROP TABLE observations;
  ALTER TABLE observations_rebuild RENAME TO observations;`);
}
db.prepare(`INSERT OR IGNORE INTO products(id,model,storage,colour,condition,unlocked,exclude_contract,exclude_trade_in,updated_at)
 VALUES(1,'iPhone 17e',256,'Any','New',1,1,1,?)`).run(new Date().toISOString());
const retailerSeed = [
 ['apple','Apple UK','https://www.apple.com/uk/','Online','Public product page data','Ready'],
 ['john-lewis','John Lewis','https://www.johnlewis.com/','Hybrid','Public product JSON-LD','Ready'],
 ['currys','Currys','https://www.currys.co.uk/','Hybrid','Public page unavailable','Unsupported'],
 ['argos','Argos','https://www.argos.co.uk/','Hybrid','Public page unavailable','Unsupported'],
 ['amazon-uk','Amazon UK','https://www.amazon.co.uk/','Online','Public search and product page','Ready'],
 ['costco-uk','Costco UK','https://www.costco.co.uk/','Online','Public product JSON-LD','Ready'],
 ['mobile-phones-direct','MobilePhonesDirect','https://www.mobilephonesdirect.co.uk/','Online','SIM-free outright product data','Ready'],
 ['onbuy','OnBuy','https://www.onbuy.com/gb/','Online','Public page unavailable','Unsupported'],
 ['mobiles','Mobiles.co.uk','https://www.mobiles.co.uk/','Online','Public page unavailable','Unsupported'],
 ['very','Very','https://www.very.co.uk/','Online','Public page unavailable','Unsupported']
];
const insertRetailer = db.prepare('INSERT OR IGNORE INTO retailers(id,name,website,type,method,adapter_status) VALUES(?,?,?,?,?,?)');
for (const row of retailerSeed) insertRetailer.run(...row);
db.prepare("UPDATE retailers SET method='Public product JSON-LD' WHERE id='john-lewis'").run();
db.prepare("UPDATE retailers SET method='Public product page data' WHERE id='apple'").run();
db.prepare("UPDATE retailers SET method='Public search and product page' WHERE id='amazon-uk'").run();
db.prepare("UPDATE retailers SET method='Public product JSON-LD' WHERE id='costco-uk'").run();
db.prepare("UPDATE retailers SET method='SIM-free outright product data' WHERE id='mobile-phones-direct'").run();
db.prepare("UPDATE retailers SET method='Public page unavailable' WHERE id IN ('currys','argos')").run();
db.prepare("UPDATE retailers SET method='Public page unavailable' WHERE id IN ('onbuy','mobiles','very')").run();
