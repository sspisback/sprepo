import express from 'express';
import { db } from './database/db';
import { runScan } from './services/scanner';
import { phoneModels } from './config/models';
import { executeAdHocSearch } from './services/adHocSearch';
import { interpretSearch, ollamaStatus, searchCriteriaSchema, validateSearchProducts } from './services/searchIntent';

const app = express(); app.use(express.json());
app.get('/api/health', (_req,res)=>res.json({ok:true}));
app.get('/api/models', (_req,res)=>res.json(phoneModels));
app.get('/api/product', (_req,res)=>res.json(db.prepare('SELECT * FROM products WHERE id=1').get()));
app.put('/api/product', (req,res)=>{
 const {model,storage,colour,condition,unlocked,exclude_contract,exclude_trade_in}=req.body??{};
 const modelChoice=phoneModels.find(option=>option.model===model);
 if(!modelChoice||!modelChoice.storage.some(capacity=>capacity===Number(storage))) return res.status(400).json({error:'Choose a listed phone model and one of its supported storage capacities.'});
 db.prepare('UPDATE products SET model=?,storage=?,colour=?,condition=?,unlocked=?,exclude_contract=?,exclude_trade_in=?,updated_at=? WHERE id=1')
 .run(model.trim(),Number(storage),String(colour??'Any'),String(condition??'New'),unlocked===false?0:1,exclude_contract===false?0:1,exclude_trade_in===false?0:1,new Date().toISOString());
 res.json(db.prepare('SELECT * FROM products WHERE id=1').get());
});
app.get('/api/summary',(_req,res)=>{
 const product=db.prepare('SELECT * FROM products WHERE id=1').get();
 const best=db.prepare("SELECT o.*,r.name retailer FROM observations o JOIN retailers r ON r.id=o.retailer_id WHERE o.model=? AND o.storage=? AND o.condition=? AND o.unlocked=? AND (o.colour=? OR ?='Any') AND o.stock='In stock' ORDER BY o.total_price LIMIT 1").get((product as any).model,(product as any).storage,(product as any).condition,(product as any).unlocked,(product as any).colour,(product as any).colour);
 const latest=db.prepare('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1').get();
 const counts=db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN adapter_status='Supported' THEN 1 ELSE 0 END) supported FROM retailers").get();
 const drops=db.prepare('SELECT COUNT(*) count FROM price_changes').get();
 res.json({product,best,latest,counts,drops,nextScan:'18:00 Europe/London'});
});
app.get('/api/retailers',(_req,res)=>res.json(db.prepare('SELECT * FROM retailers ORDER BY name').all()));
app.get('/api/results',(_req,res)=>{const p=db.prepare('SELECT model,storage,colour,condition,unlocked FROM products WHERE id=1').get() as any;res.json(db.prepare(`SELECT r.id retailer_id,r.name retailer,r.type retailer_type,r.adapter_status,r.last_error,o.* FROM retailers r LEFT JOIN observations o ON o.retailer_id=r.id AND o.model=? AND o.storage=? AND (o.colour=? OR ?='Any') AND o.condition=? AND o.unlocked=? ORDER BY o.total_price IS NULL,o.total_price`).all(p.model,p.storage,p.colour,p.colour,p.condition,p.unlocked))});
app.get('/api/runs',(_req,res)=>res.json(db.prepare('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 100').all()));
app.get('/api/history',(_req,res)=>{
 const product=db.prepare('SELECT model,storage,colour,condition,unlocked FROM products WHERE id=1').get() as any;
 res.json({observations:db.prepare("SELECT o.*,r.name retailer,s.started_at scan_at FROM observations o JOIN retailers r ON r.id=o.retailer_id JOIN scan_runs s ON s.id=o.scan_run_id WHERE o.model=? AND o.storage=? AND o.condition=? AND o.unlocked=? AND (o.colour=? OR ?='Any') ORDER BY s.started_at,o.retailer_id").all(product.model,product.storage,(product as any).condition,(product as any).unlocked,(product as any).colour,(product as any).colour),changes:db.prepare("SELECT c.*,r.name retailer FROM price_changes c LEFT JOIN retailers r ON r.id=c.retailer_id WHERE c.model=? AND c.storage=? AND c.condition=? AND c.unlocked=? AND (c.colour=? OR ?='Any') ORDER BY c.detected_at DESC").all(product.model,product.storage,(product as any).condition,(product as any).unlocked,(product as any).colour,(product as any).colour)});
});
app.post('/api/scan',async(_req,res)=>{const result=await runScan('Manual');res.status(result.ok?200:409).json(result);});
app.get('/api/search/ai-status',async(_req,res)=>res.json(await ollamaStatus()));
app.post('/api/search/interpret',async(req,res)=>{
 const prompt=String(req.body?.prompt??'').trim();
 if(!prompt||prompt.length>1000)return res.status(400).json({error:'Enter a search request of 1 to 1,000 characters.'});
 const createdAt=new Date().toISOString();
 const inserted=db.prepare("INSERT INTO search_history(prompt,created_at,status) VALUES(?,?,'interpreting')").run(prompt,createdAt);
 const id=Number(inserted.lastInsertRowid);
 const controller=new AbortController();
 res.on('close',()=>{if(!res.writableEnded)controller.abort()});
 try{
  const criteria=await interpretSearch(prompt,controller.signal);
  db.prepare('UPDATE search_history SET criteria_json=?,intent=?,status=? WHERE id=?').run(JSON.stringify(criteria),criteria.intent,criteria.clarificationNeeded?'clarification':'ready',id);
  res.json({id,prompt,criteria,status:criteria.clarificationNeeded?'clarification':'ready'});
 }catch(error){
  const message=error instanceof Error?error.message:'AI search interpretation is temporarily unavailable.';
  if(controller.signal.aborted){db.prepare("UPDATE search_history SET status='cancelled',summary=?,completed_at=? WHERE id=?").run('Interpretation cancelled by the user.',new Date().toISOString(),id);return}
  db.prepare("UPDATE search_history SET status='failed',summary=?,completed_at=? WHERE id=?").run(message,new Date().toISOString(),id);
  const unavailable=/ollama|temporarily unavailable|fetch failed|timeout|timed out|aborted/i.test(message);
  res.status(unavailable?503:422).json({id,error:unavailable?'AI search interpretation is temporarily unavailable.':message});
 }
});
app.post('/api/search/run',async(req,res)=>{
 const id=Number(req.body?.searchId),row=Number.isInteger(id)?db.prepare('SELECT id,prompt FROM search_history WHERE id=?').get(id) as {id:number;prompt:string}|undefined:undefined;
 if(!row)return res.status(404).json({error:'Search not found. Interpret a request first.'});
 const parsed=searchCriteriaSchema.safeParse(req.body?.criteria);
 if(!parsed.success)return res.status(400).json({error:`Search criteria are invalid: ${parsed.error.issues.map(issue=>issue.message).join('; ')}`});
 const criteria=parsed.data,issues=validateSearchProducts(criteria);
 if(criteria.clarificationNeeded||issues.length)return res.status(422).json({error:criteria.clarificationQuestion||issues.join(' '),clarificationNeeded:true});
 db.prepare("UPDATE search_history SET criteria_json=?,intent=?,status='running',summary=NULL,results_json=NULL,scan_run_id=NULL,completed_at=NULL WHERE id=?").run(JSON.stringify(criteria),criteria.intent,id);
 try{
  const executed=await executeAdHocSearch(criteria);
  const state=executed.result.failures.length?'partial':'complete';
  db.prepare('UPDATE search_history SET scan_run_id=?,results_json=?,summary=?,status=?,completed_at=? WHERE id=?').run(executed.runId,JSON.stringify(executed.result),executed.result.summary,state,new Date().toISOString(),id);
  res.json({id,scanRunId:executed.runId,status:state,...executed.result});
 }catch(error){
  const message=error instanceof Error?error.message:'Search could not be completed.';
  db.prepare("UPDATE search_history SET status='failed',summary=?,completed_at=? WHERE id=?").run(message,new Date().toISOString(),id);
  res.status(422).json({id,error:message});
 }
});
app.post('/api/search/:id/rerun',(req,res)=>{
 const id=Number(req.params.id),original=Number.isInteger(id)?db.prepare('SELECT * FROM search_history WHERE id=?').get(id) as any:undefined;
 if(!original||!original.criteria_json)return res.status(404).json({error:'Saved interpreted search not found.'});
 const inserted=db.prepare("INSERT INTO search_history(prompt,created_at,criteria_json,intent,status,parent_id) VALUES(?,?,?,?, 'ready',?)").run(original.prompt,new Date().toISOString(),original.criteria_json,original.intent,id);
 res.json({id:Number(inserted.lastInsertRowid),prompt:original.prompt,criteria:JSON.parse(original.criteria_json),status:'ready'});
});
app.get('/api/search/history',(_req,res)=>{
 const rows=db.prepare('SELECT * FROM search_history ORDER BY id DESC LIMIT 100').all() as any[];
 res.json(rows.map(row=>({...row,criteria:row.criteria_json?JSON.parse(row.criteria_json):null,results:row.results_json?JSON.parse(row.results_json):null,criteria_json:undefined,results_json:undefined})));
});
app.post('/api/search', (req,res)=>{const prompt=String(req.body?.prompt??'').trim();if(!prompt)return res.status(400).json({error:'Enter a search prompt.'});db.prepare('INSERT INTO search_history(prompt,created_at,status) VALUES(?,?,?)').run(prompt,new Date().toISOString(),'saved');res.json({message:'Search prompt saved.'});});
const port=Number(process.env.PORT??3001);
app.listen(port,'127.0.0.1',()=>console.log(`PriceScout API listening at http://127.0.0.1:${port}`));
