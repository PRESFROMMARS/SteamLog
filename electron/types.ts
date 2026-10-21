export const SCANNERS = ['SCANNER_1','SCANNER_2','KEYBOARD'] as const;
export type ScannerId = typeof SCANNERS[number];
export type Mode = 'SALE'|'REFUND'|'GIFT'|'WASTE';
export type Cue = 'SUCCESS_SALE'|'SPECIAL_RECORDED'|'MODIFIER_SET'|'UNDO_OK'|'ERROR_UNKNOWN_SKU';
export interface ScannerState {multiplier:number;mode:Mode;expiresAt:number|null}
export interface Product {id:number;sku:string;name:string;category:string;price_cents:number;is_active:number;sort_order:number;created_at:string;updated_at:string}
export interface Transaction {id:number;tx_uid:string;scanner_id:ScannerId;product_id:number;sku_snapshot:string;name_snapshot:string;category_snapshot:string;unit_price_cents_snapshot:number;quantity:number;tx_type:Mode;subtotal_cents:number;item_value_cents:number;is_voided:number;voided_at:string|null;created_at:string;business_date:string;hour_bucket:number}
export interface Snapshot {products:Product[];recent:Transaction[];summary:TodaySummary;dashboard:Dashboard;states:Record<ScannerId,ScannerState>}
export interface EngineEvent extends Snapshot {message:string;cue?:Cue;transaction?:Transaction;scannerId?:ScannerId;code?:string}
export type GunId='SCANNER_1'|'SCANNER_2';
export type ScanSource='keyboard'|'manual'|'quick';
export interface RawDevice {deviceName:string;hDevice:string;channel:GunId|null;lastBarcode:string;burstMs:number;lastSeen:number;connected:boolean}
export interface RawInputStatus {platform:string;active:boolean;state:'standard'|'starting'|'ready'|'retrying'|'stopped';message:string;devices:RawDevice[];mappings:Record<GunId,string>;calibrating:GunId|null;calibrationExpiresAt:number|null}
export interface SteamAPI {snapshot():Promise<Snapshot>;preparation(bufferPercent:number):Promise<PreparationResult>;preparationDay(date:string):Promise<PreparationDay>;savePreparationDay(input:PreparationDayInput):Promise<PreparationDay>;closeout():Promise<CloseoutResult>;setDebounce(ms:number):Promise<void>;scan(id:ScannerId,barcode:string,source?:ScanSource):Promise<void>;undo(id:number):Promise<void>;dualFire():Promise<{passed:boolean;ids:number[]}>;saveProduct(input:ProductInput):Promise<Product>;setProductActive(id:number,active:boolean):Promise<void>;deleteProduct(id:number):Promise<{archived:boolean}>;recent(filter:LedgerFilter):Promise<Transaction[]>;printSheet():Promise<void>;exportSheet():Promise<string>;history(request:AnalyticsRequest):Promise<HistoryResult>;historyBounds():Promise<{today:string;earliest:string|null}>;exportCSV(kind:ExportKind,range:DateRange):Promise<string>;showInFolder(file:string):Promise<void>;systemInfo():Promise<SystemInfo>;backupNow():Promise<void>;setMirror(folder:string):Promise<void>;restoreBackup(filename:string):Promise<boolean>;seedDemo():Promise<DemoResult|null>;clearLedger():Promise<boolean>;rawInputInfo():Promise<RawInputStatus>;calibrateScanner(channel:GunId|null):Promise<void>;swapScanners():Promise<void>;toggleFullscreen():Promise<boolean>;isFullscreen():Promise<boolean>;onFullscreen(cb:(fullscreen:boolean)=>void):()=>void;onRawInput(cb:(info:RawInputStatus)=>void):()=>void;onSystem(cb:(info:SystemInfo)=>void):()=>void;onEvent(cb:(e:EngineEvent)=>void):()=>void}

export interface ProductInput {id?:number;sku:string;name:string;category:string;price:string;sort_order:number;is_active:number}
export type LedgerFilter={type:'ALL'|Mode|'VOID';scanner:'ALL'|ScannerId};
export interface SpecialTotals {quantity:number;value:number}
export interface TodaySummary {
 revenue:number;gross:number;refunds:number;items:number;transactions:number;validTransactions:number;special:number;voids:number;
 refund:SpecialTotals;gift:SpecialTotals;waste:SpecialTotals;
}
export interface ProductActivity {product_id:number;sku:string;name:string;category:string;is_active:number;activity:number;quantity:number;revenue:number;refund:number;gift:number;waste:number}
export interface HourActivity {hour:number;quantity:number;revenue:number}
export interface Dashboard {businessDate:string;currentHour:number;summary:TodaySummary;ranking:ProductActivity[];hours:HourActivity[];peak:HourActivity|null;bestSeller:ProductActivity|null}

export type Granularity='daily'|'weekly'|'monthly';
export interface DateRange {start:string;end:string}
export interface AnalyticsRequest extends DateRange {granularity:Granularity}
export interface TrendBucket {key:string;units:number;revenue:number}
export interface RangeProduct {id:number;sku:string;name:string;category:string;price_cents:number;is_active:number;units:number;revenue:number;gross:number;refundUnits:number;refundValue:number;giftUnits:number;giftValue:number;wasteUnits:number;wasteValue:number;unitShare:number;revenueShare:number;peakHour:number|null}
export interface RangeSummary {revenue:number;gross:number;refundValue:number;units:number;validTransactions:number;voids:number;voidValue:number;refundCount:number;refundUnits:number;giftCount:number;giftUnits:number;giftValue:number;wasteCount:number;wasteUnits:number;wasteValue:number}
export interface HistoryResult extends AnalyticsRequest {days:number;summary:RangeSummary;products:RangeProduct[];trend:TrendBucket[];productTrends:Record<number,TrendBucket[]>;productHours:Record<number,HourActivity[]>;hours:HourActivity[];topUnits:number|null;topRevenue:number|null;worstIds:number[];earliest:string|null}
export type BackupTrigger='startup'|'auto-100'|'manual'|'shutdown'|'pre-restore-safety'|'pre-clear-safety'|'pre-demo-safety'|'pre-timezone-safety'|'closeout';
export interface BackupEntry {filename:string;createdAt:string;size:number;trigger:BackupTrigger}
export interface SystemInfo {runtimeRoot:string;databasePath:string;backups:BackupEntry[];mirrorPath:string;mirrorError:string|null;backupError:string|null;lastBackup:string|null;busy:boolean;maintenance:boolean;transactionCount:number;demoSeeded:boolean;integrity:string;schemaVersion:number;debounceMs:number}
export type ExportKind='transactions'|'products';
export interface DemoResult {inserted:number;elapsedMs:number}

export interface CloseoutResult {date:string;generatedAt:string;firstSale:string|null;lastSale:string|null;summary:RangeSummary;backup:BackupEntry|null;backupError:string|null;mirrorStatus:'success'|'unconfigured'|'failed';mirrorError:string|null}

export interface PreparationProduct {id:number;sku:string;name:string;category:string;observedDays:number;recentDays:number;weekdayDays:number;recentAverage:number|null;weekdayAverage:number|null;recommended:number|null;method:'weekday'|'recent'|'stockout';confidence:'regular'|'limited'|'insufficient';stockoutDays:number;stockoutFloor:number|null;recordedDays:number;preparedAverage:number|null;remainingAverage:number|null;advice:'increase'|'reduce'|'steady'|'unknown'}
export interface PreparationResult {today:string;targetDate:string;start:string;end:string;bufferPercent:number;operatingDays:number;closedDays:number;targetClosed:boolean;includesToday:boolean;products:PreparationProduct[];total:number;demoData:boolean}
export type PreparationDayStatus='auto'|'open'|'closed';
export interface PreparationItemInput {productId:number;stockout:boolean;prepared:number|null;remaining:number|null}
export interface PreparationDayInput {date:string;status:PreparationDayStatus;completed:boolean;products:PreparationItemInput[]}
export interface PreparationDay extends PreparationDayInput {products:(PreparationItemInput&{name:string;category:string;active:number;sold:number})[];totalSales:number}
