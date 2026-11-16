export interface ProductConfig { model: string; storage: number; colour: string; condition: string; unlocked: boolean; exclude_contract: boolean; exclude_trade_in: boolean }
export interface Offer { model: string; storage: number; colour?: string; condition: string; unlocked: boolean; basePrice: number; delivery: number | null; totalPrice: number; stock: 'In stock'|'Out of stock'|'Unknown'; channel: 'Online'|'In-store'|'Hybrid'; url: string; verifiedAt: string; currency: 'GBP' }
export interface ScanResult { offers: Offer[]; error?: string; status: 'success'|'failed'|'unsupported' }
export interface RetailerAdapter { id: string; supports?(product: ProductConfig): boolean; scan(product: ProductConfig): Promise<ScanResult> }
