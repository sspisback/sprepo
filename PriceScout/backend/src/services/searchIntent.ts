import { z } from 'zod';
import { phoneModels } from '../config/models';

const productIntentSchema = z.object({
  model: z.string().trim().min(1).max(80).nullable(),
  storage: z.number().int().positive().nullable(),
  colour: z.string().trim().max(40).nullable(),
  condition: z.enum(['New', 'Refurbished']).nullable(),
  unlocked: z.boolean().nullable()
}).strict();

export const searchCriteriaSchema = z.object({
  intent: z.enum(['live', 'historical', 'comparison', 'combined']),
  analysis: z.enum(['lowest', 'lowest-in-period', 'biggest-drop', 'compare-periods', 'price-changes']),
  products: z.array(productIntentSchema).min(1).max(12),
  maximumPrice: z.number().positive().max(1_000_000).nullable(),
  retailerPreferences: z.array(z.string().trim().min(1).max(50)).max(10),
  onlineOrInStore: z.enum(['online', 'in-store', 'any']),
  dateRange: z.object({
    days: z.number().int().positive().max(3650).nullable(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
  }).strict().refine(value=>!value.from||!value.to||value.from<=value.to,{message:'Start date must be on or before end date.'}),
  sortOrder: z.enum(['price-asc', 'price-desc', 'recent']),
  requiresLiveScan: z.boolean(),
  clarificationNeeded: z.boolean(),
  clarificationQuestion: z.string().trim().max(300).nullable()
}).strict();

export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;

const ollamaBase = (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const defaultModel = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const timeoutMs = 90_000;
let interpretationActive = false;

export async function ollamaStatus() {
  try {
    const response = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { available: false, model: defaultModel, error: `Ollama returned HTTP ${response.status}.` };
    const body = await response.json() as { models?: Array<{ name?: string; details?: { family?: string } }> };
    const models = body.models ?? [];
    const selected = process.env.OLLAMA_MODEL
      ? models.find(item => item.name === process.env.OLLAMA_MODEL)
      : models.find(item => item.name === defaultModel) ?? models.find(item => item.details?.family === 'llama' || item.name?.toLowerCase().includes('llama'));
    return selected
      ? { available: true, model: selected.name ?? defaultModel, installedModels: models.map(item => item.name).filter(Boolean) as string[] }
      : { available: false, model: defaultModel, installedModels: models.map(item => item.name).filter(Boolean) as string[], error: process.env.OLLAMA_MODEL ? `Configured model ${process.env.OLLAMA_MODEL} is not installed.` : 'No installed Llama model was found.' };
  } catch {
    return { available: false, model: defaultModel, error: 'AI search interpretation is temporarily unavailable. Check that local Ollama is running.' };
  }
}

function systemPrompt() {
  const catalogue = phoneModels.map(item => `${item.model} (${item.storage.join(', ')}GB)`).join('; ');
  return `Convert a UK mobile phone price-search request to one JSON object only. Do not answer the user, invent prices, SQL, commands, APIs, or retailers. Supported phone catalogue: ${catalogue}. If the request is not supported by this catalogue, preserve its requested model name so the app can explain that. Ask for missing exact model or storage instead of guessing. Retailer IDs may only be selected from ["apple","john-lewis","amazon-uk","costco-uk","mobile-phones-direct"]; use [] if none were named. Keys: intent, analysis, products, maximumPrice, retailerPreferences, onlineOrInStore, dateRange, sortOrder, requiresLiveScan, clarificationNeeded, clarificationQuestion. intent must be exactly one of ["live","historical","comparison","combined"]. analysis must be exactly one of ["lowest","lowest-in-period","biggest-drop","compare-periods","price-changes"]. products is an array of 1 to 12 objects; each has model (string or null), storage (integer or null), colour (string or null), condition ("New", "Refurbished", or null), unlocked (boolean or null). maximumPrice is a number or null. onlineOrInStore is "online", "in-store", or "any". dateRange has days (integer or null), from (YYYY-MM-DD string or null), to (YYYY-MM-DD string or null). sortOrder is "price-asc", "price-desc", or "recent". clarificationQuestion is a short string or null. Use analysis biggest-drop for most reduced, compare-periods for against last week, price-changes for requests to show drops, lowest-in-period for a lowest historical price, and lowest otherwise. Use requiresLiveScan=true for current prices or comparisons against current prices. If not specified, condition and unlocked may be null; never guess model or storage.`;
}

export function normalizeObviousAnalysis(prompt: string, criteria: SearchCriteria) {
  const text=prompt.toLowerCase();
  const asksForLowest=/\b(cheapest|lowest price|least expensive)\b/.test(text);
  const historicalRequest=/\b(history|historical|saved|recorded|last week|last \d+ days|yesterday|price changes?|dropped|reduced)\b/.test(text);
  const explicitComparison=/\b(compare|comparison|versus|vs)\b/.test(text);
  if(asksForLowest&&!historicalRequest){
    criteria.analysis='lowest';
    criteria.sortOrder='price-asc';
    if(!explicitComparison&&criteria.products.length<=1){criteria.intent='live';criteria.requiresLiveScan=true;}
  }
  if(/\b(reduced the most|biggest drop|largest drop|most reduced)\b/.test(text))criteria.analysis='biggest-drop';
  if(/\b(show|list|find).{0,30}\b(prices? that dropped|price drops|price changes)\b/.test(text))criteria.analysis='price-changes';
  return criteria;
}

function modelWasExplicitlyNamed(prompt: string, modelName: string) {
  const candidate=phoneModels.find(model=>model.model.toLowerCase()===modelName.toLowerCase()||('aliases' in model&&model.aliases.some(alias=>alias.toLowerCase()===modelName.toLowerCase())));
  if(!candidate)return prompt.toLowerCase().replace(/[^a-z0-9]/g,'').includes(modelName.toLowerCase().replace(/[^a-z0-9]/g,''));
  const candidateTerms=[candidate.model,...('aliases' in candidate?candidate.aliases:[])];
  const otherTerms=phoneModels.filter(model=>model!==candidate).flatMap(model=>[model.model,...('aliases' in model?model.aliases:[])].map(term=>({model,term})));
  for(const term of candidateTerms){
    const pattern=term.split(/\s+/).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');
    const regex=new RegExp(`(^|[^a-z0-9])(${pattern})(?=$|[^a-z0-9])`,'gi');
    for(const match of prompt.matchAll(regex)){
      const start=(match.index??0)+match[1].length;
      const shadowed=otherTerms.some(({term:otherTerm})=>otherTerm.length>term.length&&termMatchesAtStart(prompt,otherTerm,start));
      if(!shadowed)return true;
    }
  }
  return false;
}

function termMatchesAtStart(prompt: string, term: string, start: number) {
  const pattern=term.split(/\s+/).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');
  const regex=new RegExp(`(^|[^a-z0-9])(${pattern})(?=$|[^a-z0-9])`,'gi');
  return [...prompt.matchAll(regex)].some(match=>(match.index??0)+match[1].length===start);
}

function catalogueModel(modelName: string | null) {
  if(!modelName)return undefined;
  return phoneModels.find(model=>model.model.toLowerCase()===modelName.toLowerCase()||('aliases' in model&&model.aliases.some(alias=>alias.toLowerCase()===modelName.toLowerCase())));
}

function storageWasExplicitlyNamed(prompt: string, storage: number) {
  const size=storage>=1024?storage/1024:storage,unit=storage>=1024?'tb':'gb';
  return new RegExp(`\\b${size}\\s*${unit}\\b`,'i').test(prompt);
}

function enforcePromptEvidence(prompt: string, criteria: SearchCriteria) {
  let unsupported=false;
  const explicitModels=phoneModels.filter(model=>modelWasExplicitlyNamed(prompt,model.model)).map(model=>model.model);
  const maximumMention=prompt.match(/\b(?:under|below|less than|maximum|max(?:imum)? price|budget|up to|no more than)\s*(?:GBP\s*|£\s*)?([\d,]+(?:\.\d{1,2})?)/i);
  const mentionedMaximum=maximumMention?Number(maximumMention[1].replace(/,/g,'')):null;
  for(const item of criteria.products){
    if(item.model&&!modelWasExplicitlyNamed(prompt,item.model)){
      item.model=explicitModels.length===1?explicitModels[0]:null;item.storage=null;
    }else if(!item.model&&explicitModels.length===1){
      item.model=explicitModels[0];
    }
    const model=catalogueModel(item.model);
    if(model){
      item.model=model.model;
      const mentionedCapacities=(model.storage as readonly number[]).filter(size=>storageWasExplicitlyNamed(prompt,size));
      if(item.storage!=null&&!storageWasExplicitlyNamed(prompt,item.storage))item.storage=null;
      if(item.storage==null&&mentionedCapacities.length===1)item.storage=mentionedCapacities[0];
    }else if(item.model&&!model){unsupported=true;}
    if(item.colour&&!prompt.toLowerCase().includes(item.colour.toLowerCase()))item.colour=null;
    if(/\brefurb(?:ished)?|renewed|used\b/i.test(prompt))item.condition='Refurbished';
    else if(/\bnew\b/i.test(prompt))item.condition='New';
    else item.condition=null;
    if(/\bunlocked\b|sim[ -]?free/i.test(prompt))item.unlocked=true;
    else if(/\blocked\b/i.test(prompt))item.unlocked=false;
    else item.unlocked=null;
  }
  if(criteria.maximumPrice!=null){
    criteria.maximumPrice=mentionedMaximum===criteria.maximumPrice?mentionedMaximum:null;
  }else if(mentionedMaximum!=null){
    criteria.maximumPrice=mentionedMaximum;
  }
  if(/\b(?:all|every) retailers\b/i.test(prompt))criteria.retailerPreferences=[];
  if(explicitModels.length===1&&/\b(cheapest|lowest price|least expensive)\b/i.test(prompt)&&!/\b(history|historical|saved|recorded|last week|last \d+ days|yesterday|price changes?|dropped|reduced)\b/i.test(prompt)){
    const model=catalogueModel(explicitModels[0]);
    const source=criteria.products.find(item=>item.model===model?.model)??criteria.products[0];
    const capacities=(model?.storage as readonly number[]|undefined)?.filter(size=>storageWasExplicitlyNamed(prompt,size))??[];
    const selectedCapacities=capacities.length?capacities:model?.storage??[];
    criteria.products=selectedCapacities.map(storage=>({...source,model:explicitModels[0],storage}));
    criteria.intent='live';criteria.analysis='lowest';criteria.requiresLiveScan=true;
    criteria.sortOrder='price-asc';
    criteria.clarificationNeeded=false;criteria.clarificationQuestion=null;
  }
  const names=criteria.products.map(item=>item.model).filter(Boolean);
  if(!names.length&&/\b(samsung|galaxy|pixel|motorola|oneplus|xiaomi|google)\b/i.test(prompt))unsupported=true;
  if(unsupported){criteria.clarificationNeeded=true;criteria.clarificationQuestion='That phone model is not in PriceScout’s catalogue yet. Choose a listed model or add it to the catalogue first.';}
  return criteria;
}

async function askModel(prompt: string, repair?: string, signal?: AbortSignal) {
  const status = await ollamaStatus();
  if (!status.available || !status.model) throw new Error(status.error ?? 'AI search interpretation is temporarily unavailable.');
  const userContent = repair
    ? `The prior response was not valid for the required JSON schema. Correct it and return JSON only. Validation issue: ${repair.slice(0, 500)}\nOriginal request: ${prompt}`
    : prompt;
  const response = await fetch(`${ollamaBase}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: status.model,
      messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: userContent }],
      format: z.toJSONSchema(searchCriteriaSchema), stream: false, keep_alive: '10m', options: { temperature: 0 }
    })
  });
  if (!response.ok) throw new Error(`Local Ollama returned HTTP ${response.status}.`);
  const body = await response.json() as { message?: { content?: string } };
  if (!body.message?.content) throw new Error('Local Ollama returned an empty response.');
  return body.message.content;
}

export function validateSearchProducts(criteria: SearchCriteria) {
  const clarification: string[] = [];
  for (const item of criteria.products) {
    if (!item.model) { clarification.push('Which phone model do you want to search for?'); continue; }
    const model = catalogueModel(item.model);
    if (!model) {
      clarification.push(`PriceScout currently supports these phone models: ${phoneModels.map(candidate => candidate.model).join(', ')}.`);
      continue;
    }
    if (item.storage == null) clarification.push(`Which storage size do you want for ${model.model} (${model.storage.map(size => `${size}GB`).join(', ')})?`);
    else if (!(model.storage as readonly number[]).includes(item.storage)) clarification.push(`${model.model} is listed with ${model.storage.map(size => `${size}GB`).join(', ')} storage. Which size should I use?`);
  }
  return clarification;
}

export async function interpretSearch(prompt: string, signal?: AbortSignal) {
  if(interpretationActive)throw new Error('A local AI interpretation is already in progress. Please wait for it to finish.');
  interpretationActive=true;
  let repair: string | undefined;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if(signal?.aborted)throw new DOMException('Interpretation cancelled.','AbortError');
      let raw: unknown;
      try { raw = JSON.parse(await askModel(prompt, repair, signal)); }
      catch (error) {
        if (error instanceof SyntaxError && attempt === 0) { repair = 'Response was not valid JSON.'; continue; }
        throw error;
      }
      const parsed = searchCriteriaSchema.safeParse(raw);
      if (parsed.success) {
        const criteria = enforcePromptEvidence(prompt,normalizeObviousAnalysis(prompt,parsed.data));
        const issues = validateSearchProducts(criteria);
        if (issues.length) {
          criteria.clarificationNeeded = true;
          criteria.clarificationQuestion = issues.join(' ');
        }
        return criteria;
      }
      if (attempt === 0) { repair = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '); continue; }
      const issues=parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new Error(`The local model returned criteria that failed validation (${issues}). Please rephrase the request and try again.`);
    }
    throw new Error('The local model did not return usable search criteria. Please rephrase the request and try again.');
  } finally {
    interpretationActive=false;
  }
}
