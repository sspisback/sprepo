import { db } from '../database/db';
import { adapters } from '../scanners/registry';
import type { ProductConfig } from '../scanners/types';
import { runAdHocScan } from './scanner';
import type { SearchCriteria } from './searchIntent';
import { largestDropsFromObservations, lowestPricePerScan } from './historyMath';

type SearchProduct = NonNullable<SearchCriteria['products'][number]['model']>;
type ResultRow = Record<string, any>;

function configs(criteria: SearchCriteria): ProductConfig[] {
  const defaults = db.prepare('SELECT condition,unlocked FROM products WHERE id=1').get() as {condition:string;unlocked:number};
  return criteria.products.map(item => ({
    model: item.model as SearchProduct,
    storage: item.storage as number,
    colour: !item.colour || /^any(?:[ -]colou?r)?$/i.test(item.colour.trim()) ? 'Any' : item.colour.trim(),
    condition: item.condition ?? defaults.condition,
    unlocked: item.unlocked ?? Boolean(defaults.unlocked),
    exclude_contract: true,
    exclude_trade_in: true
  }));
}

function allObservationRows(criteria: SearchCriteria, start: string | null, end: string | null) {
  const products = configs(criteria), rows: ResultRow[] = [];
  const selectedRetailers = criteria.retailerPreferences;
  const statement = db.prepare(`SELECT o.*,r.name retailer,s.started_at scan_at
    FROM observations o JOIN retailers r ON r.id=o.retailer_id JOIN scan_runs s ON s.id=o.scan_run_id
    WHERE o.model=? AND o.storage=? AND o.condition=? AND o.unlocked=?
      AND (o.colour=? OR ?='Any')
      AND (? IS NULL OR o.verified_at>=?) AND (? IS NULL OR o.verified_at<=?)
      AND (?=0 OR o.retailer_id IN (SELECT value FROM json_each(?)))
    ORDER BY s.started_at DESC,o.total_price ASC LIMIT 5000`);
  const retailerJson = JSON.stringify(selectedRetailers);
  for (const product of products) rows.push(...statement.all(
    product.model,product.storage,product.condition,product.unlocked?1:0,product.colour,product.colour,
    start,start,end,end,selectedRetailers.length,retailerJson
  ) as ResultRow[]);
  return rows.filter(row => (criteria.maximumPrice == null || Number(row.total_price) <= criteria.maximumPrice) &&
    (criteria.onlineOrInStore === 'any' || (criteria.onlineOrInStore === 'online' ? row.channel !== 'In-store' : row.channel !== 'Online')));
}

function periodBounds(criteria: SearchCriteria) {
  const now = Date.now();
  const days = criteria.dateRange.days ?? (['biggest-drop','price-changes','compare-periods'].includes(criteria.analysis) ? 7 : null);
  const start = criteria.dateRange.from ? `${criteria.dateRange.from}T00:00:00.000Z` : days ? new Date(now-days*86400000).toISOString() : null;
  const end = criteria.dateRange.to ? `${criteria.dateRange.to}T23:59:59.999Z` : null;
  return { now, days: days ?? 7, start, end };
}

function sortRows<T extends ResultRow>(rows: T[], order: SearchCriteria['sortOrder']) {
  return rows.sort((a,b)=>order==='recent'
    ? Date.parse(b.verified_at??b.detected_at)-Date.parse(a.verified_at??a.detected_at)
    : order==='price-desc' ? Number(b.total_price??b.current_price)-Number(a.total_price??a.current_price)
    : Number(a.total_price??a.current_price)-Number(b.total_price??b.current_price));
}

function summarizeHistory(criteria: SearchCriteria, rows: ResultRow[], bounds: ReturnType<typeof periodBounds>) {
  const byScan=lowestPricePerScan(rows);
  if (criteria.analysis === 'biggest-drop') {
    const drops=largestDropsFromObservations(rows);
    return { rows:drops, explanation:drops.length?'Price reductions are calculated from the earliest and latest verified scan in the selected period for each retailer and product.':'There are not enough saved scans in this period to calculate verified price reductions.' };
  }
  if (criteria.analysis === 'compare-periods') {
    const cutoff=bounds.now-bounds.days*86400000, freshSince=bounds.now-86400000;
    const groups=new Map<string,ResultRow[]>();
    for(const row of byScan){const key=`${row.retailer_id}|${row.model}|${row.storage}`;groups.set(key,[...(groups.get(key)??[]),row]);}
    const comparisons=[...groups.values()].map(group=>{
      const current=group.filter(row=>Date.parse(row.verified_at)>=freshSince).sort((a,b)=>Date.parse(b.verified_at)-Date.parse(a.verified_at))[0];
      const previous=group.filter(row=>Date.parse(row.verified_at)<=cutoff).sort((a,b)=>Date.parse(b.verified_at)-Date.parse(a.verified_at))[0];
      return {retailer:(current??previous)?.retailer,model:(current??previous)?.model,storage:(current??previous)?.storage,current_price:current?Number(current.total_price):null,previous_price:previous?Number(previous.total_price):null,difference:current&&previous?+(Number(current.total_price)-Number(previous.total_price)).toFixed(2):null,current_at:current?.verified_at??null,previous_at:previous?.verified_at??null,product_url:current?.product_url??previous?.product_url??null,missing:!current?'No observation was recorded in the last 24 hours.':!previous?`No observation was recorded at least ${bounds.days} days ago.`:null};
    }).sort((a,b)=>(a.difference??Infinity)-(b.difference??Infinity));
    return {rows:comparisons,explanation:comparisons.length?'Current values use only observations verified in the last 24 hours; comparison values use the latest observation at or before the requested earlier date.':'No saved observations are available for this comparison.'};
  }
  if (criteria.analysis === 'price-changes') {
    const products=configs(criteria);
    const events=db.prepare(`SELECT c.*,r.name retailer FROM price_changes c LEFT JOIN retailers r ON r.id=c.retailer_id
      WHERE c.detected_at>=? AND (? IS NULL OR c.detected_at<=?)
      AND (?=0 OR c.retailer_id IN (SELECT value FROM json_each(?)))
      ORDER BY c.difference ASC LIMIT 5000`).all(bounds.start??new Date(bounds.now-7*86400000).toISOString(),bounds.end,bounds.end,criteria.retailerPreferences.length,JSON.stringify(criteria.retailerPreferences)) as ResultRow[];
    const filtered=events.filter(row=>products.some(product=>product.model===row.model&&product.storage===row.storage&&product.condition===row.condition&&Number(product.unlocked)==Number(row.unlocked)))
      .filter(row=>criteria.maximumPrice==null||Number(row.current_price)<=criteria.maximumPrice)
      .filter(row=>criteria.onlineOrInStore!=='in-store');
    return {rows:filtered,explanation:filtered.length?'These are saved price-change events; arithmetic is calculated by PriceScout.':'No saved price-change events match this period. Historical events may only exist for scans made after PriceScout began recording them.'};
  }
  const sorted=sortRows(rows,criteria.sortOrder);
  if(criteria.analysis==='lowest-in-period')return {rows:sorted.slice(0,100),explanation:sorted.length?'Historical observations in the selected period, sorted by verified total price.':'No saved observations match this period.'};
  return {rows:sorted.slice(0,100),explanation:sorted.length?'Saved observations only. Their timestamps are shown; they are not represented as current prices.':'No saved observations match these products and filters.'};
}

function appliedFilters(criteria: SearchCriteria) {
  const filters=criteria.products.map(p=>`${p.model??'model not selected'} ${p.storage?`${p.storage}GB`:'storage not selected'}`);
  filters.push(criteria.products.some(p=>p.colour&& !/^any(?:[ -]colou?r)?$/i.test(p.colour))?`Colour: ${criteria.products.map(p=>p.colour).filter(Boolean).join(', ')}`:'Colour: any');
  filters.push(`Condition: ${criteria.products.map(p=>p.condition??'saved preference').join(', ')}`);
  filters.push(`Network: ${criteria.products.map(p=>p.unlocked==null?'saved preference':p.unlocked?'SIM-free':'any').join(', ')}`);
  if(criteria.maximumPrice!=null)filters.push(`Maximum total price: £${criteria.maximumPrice.toFixed(2)}`);
  if(criteria.retailerPreferences.length)filters.push(`Retailers: ${criteria.retailerPreferences.join(', ')}`);
  if(criteria.onlineOrInStore!=='any')filters.push(`Availability: ${criteria.onlineOrInStore}`);
  if(criteria.dateRange.days)filters.push(`Period: last ${criteria.dateRange.days} days`);
  return filters;
}

export async function executeAdHocSearch(criteria: SearchCriteria) {
  const products=configs(criteria), {now,days,start,end}=periodBounds(criteria);
  let runId:number|null=null, checkedRetailers:string[]=[], successfulRetailers:string[]=[], failures:string[]=[], offers:ResultRow[]=[], historyRows:ResultRow[]=[], explanation:string|undefined;
  if(criteria.requiresLiveScan){
    const statuses=new Map((db.prepare('SELECT id,adapter_status,last_error FROM retailers').all() as Array<{id:string;adapter_status:string;last_error:string|null}>).map(row=>[row.id,row]));
    const available=adapters.filter(adapter=>statuses.get(adapter.id)?.adapter_status!=='Unsupported'&&products.some(product=>!adapter.supports||adapter.supports(product)));
    const requested=criteria.retailerPreferences.length?criteria.retailerPreferences:available.map(adapter=>adapter.id);
    const invalid=requested.filter(id=>!available.some(adapter=>adapter.id===id));
    if(invalid.length)throw new Error(`These retailers are not currently available for ad hoc scanning: ${invalid.join(', ')}.`);
    const scan=await runAdHocScan(products,requested);
    runId=scan.id;
    if(!scan.ok)throw new Error(scan.errors[0]??'The live scan could not start.');
    checkedRetailers=scan.checkedRetailers;
    successfulRetailers=scan.successfulRetailers;
    failures=scan.errors;
    offers=scan.offers.map(offer=>{
      const retailer=(db.prepare('SELECT name FROM retailers WHERE id=?').get(offer.retailerId) as {name:string}|undefined)?.name??offer.retailerId;
      return {...offer,retailer};
    }).filter(row=>criteria.maximumPrice==null||row.totalPrice<=criteria.maximumPrice)
      .filter(row=>criteria.onlineOrInStore==='any'||(criteria.onlineOrInStore==='online'?row.channel!=='In-store':row.channel!=='Online'));
    offers.sort((a,b)=>criteria.sortOrder==='price-desc'?b.totalPrice-a.totalPrice:criteria.sortOrder==='recent'?Date.parse(b.verifiedAt)-Date.parse(a.verifiedAt):a.totalPrice-b.totalPrice);
    if(criteria.intent==='combined'||criteria.intent==='historical'){
      historyRows=allObservationRows(criteria,criteria.analysis==='compare-periods'?null:start,end);
      const historical=summarizeHistory(criteria,historyRows,{now,days,start,end});
      historyRows=historical.rows;
      explanation=historical.explanation;
    }
  }else{
    historyRows=allObservationRows(criteria,criteria.analysis==='compare-periods'?null:start,end);
    const historical=summarizeHistory(criteria,historyRows,{now,days,start,end});
    historyRows=historical.rows;
    explanation=historical.explanation;
  }
  const lowest=offers[0];
  const summary=criteria.requiresLiveScan
    ? lowest?`Lowest verified price is £${lowest.totalPrice.toFixed(2)} at ${lowest.retailer}, among ${successfulRetailers.length} successfully checked retailers. Prices were checked just now.`:`No offers matched the selected filters among ${successfulRetailers.length} successfully checked retailers.`
    : explanation ?? 'Historical analysis complete.';
  const unavailable=(db.prepare("SELECT name,last_error FROM retailers WHERE adapter_status='Unsupported'").all() as Array<{name:string;last_error:string|null}>).map(row=>({retailer:row.name,error:row.last_error??'Unsupported by the current public-page scanner.'}));
  const result={summary,liveResults:offers,historyResults:historyRows,checkedRetailers,successfulRetailers,failures,unsupportedRetailers:unavailable,appliedFilters:appliedFilters(criteria),generatedAt:new Date().toISOString(),explanation};
  return {runId,result};
}
