export type HistoricalObservation = Record<string, any>;

export function lowestPricePerScan(rows: HistoricalObservation[]) {
  const lowest=new Map<string,HistoricalObservation>();
  for(const row of rows){
    const key=`${row.retailer_id}|${row.model}|${row.storage}|${row.scan_run_id}`;
    const prior=lowest.get(key);
    if(!prior||Number(row.total_price)<Number(prior.total_price))lowest.set(key,row);
  }
  return [...lowest.values()];
}

export function largestDropsFromObservations(rows: HistoricalObservation[]) {
  const groups=new Map<string,HistoricalObservation[]>();
  for(const row of lowestPricePerScan(rows)){const key=`${row.retailer_id}|${row.model}|${row.storage}`;groups.set(key,[...(groups.get(key)??[]),row]);}
  return [...groups.values()].flatMap(group=>{
    const ordered=group.sort((a,b)=>Date.parse(a.scan_at)-Date.parse(b.scan_at));
    if(ordered.length<2)return[];
    const first=ordered[0],last=ordered[ordered.length-1],difference=+(Number(last.total_price)-Number(first.total_price)).toFixed(2);
    return difference<0?[{retailer:last.retailer,model:last.model,storage:last.storage,previous_price:Number(first.total_price),current_price:Number(last.total_price),difference,detected_at:last.verified_at,previous_at:first.verified_at,product_url:last.product_url}]:[];
  }).sort((a,b)=>a.difference-b.difference);
}
