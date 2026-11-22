import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {validateProduct} from './products';
import {CURRENCY,OPENING_CATALOG} from './catalog';
import {preparationSchema} from './preparation-records';
import {SCANNERS,type Dashboard,type HourActivity,type LedgerFilter,type ProductActivity,type ProductInput,type TodaySummary,type Mode,type Product,type ScannerId,type Transaction,type RefundableSale,type RefundSearch,type TodayTransactionFilter,type TodayTransactionPage} from './types';
import fs from 'node:fs';
import path from 'node:path';
import {contained,syncFile,syncDirectory} from './paths';
import {businessTime,BUSINESS_TIMEZONE} from './time';
import {closeoutCheckpointStatus} from './closeout-checkpoint';
import {addDays,validDate} from './ranges';
export {businessTime} from './time';
export const LEDGER_SCHEMA_VERSION=7;

export class LedgerVersionError extends Error {
 constructor(){super('账本由更新版本的程序创建，请先升级程序再打开。');}
}
export class LedgerUpgradeBackupError extends Error {
 constructor(cause:unknown){super('无法保存升级前的账本备份。请检查备份目录权限和磁盘空间，再启动软件。',{cause});}
}

const immutableGuard=(version=0)=>` CREATE TRIGGER IF NOT EXISTS immutable_tx BEFORE UPDATE ON transactions WHEN NOT (
 OLD.is_voided=0 AND NEW.is_voided=1 AND NEW.voided_at IS NOT NULL AND
 NEW.id=OLD.id AND NEW.tx_uid=OLD.tx_uid AND NEW.scanner_id=OLD.scanner_id AND NEW.product_id=OLD.product_id AND NEW.sku_snapshot=OLD.sku_snapshot AND NEW.name_snapshot=OLD.name_snapshot AND NEW.category_snapshot=OLD.category_snapshot AND NEW.unit_price_cents_snapshot=OLD.unit_price_cents_snapshot AND NEW.quantity=OLD.quantity AND NEW.tx_type=OLD.tx_type AND NEW.subtotal_cents=OLD.subtotal_cents AND NEW.item_value_cents=OLD.item_value_cents AND NEW.created_at=OLD.created_at AND NEW.business_date=OLD.business_date AND NEW.hour_bucket=OLD.hour_bucket
 ${version>=6?'AND NEW.half_price=OLD.half_price':''}
 ${version>=7?'AND NEW.refund_of IS OLD.refund_of':''}
 ) BEGIN SELECT RAISE(ABORT,'Only a one-way void is permitted'); END;`;

export class Ledger {
 readonly db:Database.Database;
 onRecorded?:(at:Date)=>void;
 constructor(file:string){this.db=new Database(file);try{
 const version=Number(this.db.pragma('user_version',{simple:true}));
 if(version>LEDGER_SCHEMA_VERSION)throw new LedgerVersionError();
 if(version>0&&version<LEDGER_SCHEMA_VERSION&&file!==':memory:')this.saveMigrationBackup(file,'pre-upgrade-safety');
 this.db.pragma('journal_mode = WAL');
 // Flush each acknowledged commit to the WAL so a sudden power loss is less likely to lose recent sales.
 this.db.pragma('synchronous = FULL');
 this.db.pragma('foreign_keys = ON');this.db.exec(`
 CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,sku TEXT UNIQUE NOT NULL CHECK(sku=upper(sku)),name TEXT NOT NULL,category TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents>=0),is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,tx_uid TEXT UNIQUE NOT NULL,scanner_id TEXT NOT NULL,product_id INTEGER NOT NULL REFERENCES products(id),sku_snapshot TEXT NOT NULL,name_snapshot TEXT NOT NULL,category_snapshot TEXT NOT NULL,unit_price_cents_snapshot INTEGER NOT NULL CHECK(unit_price_cents_snapshot>=0),quantity INTEGER NOT NULL CHECK(quantity>0 AND typeof(quantity)='integer'),tx_type TEXT NOT NULL CHECK(tx_type IN('SALE','REFUND','GIFT','WASTE')),subtotal_cents INTEGER NOT NULL,item_value_cents INTEGER NOT NULL,is_voided INTEGER NOT NULL DEFAULT 0 CHECK(is_voided IN(0,1)),voided_at TEXT,created_at TEXT NOT NULL,business_date TEXT NOT NULL,hour_bucket INTEGER NOT NULL CHECK(hour_bucket BETWEEN 0 AND 23),CHECK(item_value_cents=unit_price_cents_snapshot*quantity),CHECK(subtotal_cents=CASE tx_type WHEN 'SALE' THEN item_value_cents WHEN 'REFUND' THEN -item_value_cents ELSE 0 END),CHECK((is_voided=0 AND voided_at IS NULL) OR (is_voided=1 AND voided_at IS NOT NULL)));
 CREATE INDEX IF NOT EXISTS idx_tx_date_void ON transactions(business_date,is_voided);
 CREATE INDEX IF NOT EXISTS idx_tx_sku_date ON transactions(sku_snapshot,business_date);
 CREATE INDEX IF NOT EXISTS idx_tx_product_date ON transactions(product_id,business_date,id);
 CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS no_tx_delete BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT,'Ledger rows cannot be deleted'); END;
 ${immutableGuard(version)}`);
 this.migrateTimezone(file);
 preparationSchema(this.db);
 this.migrateTransactions();
 this.db.transaction(()=>{if(!this.db.prepare("SELECT value FROM settings WHERE key='products_seeded'").get() && (this.db.prepare('SELECT count(*) n FROM products').get() as {n:number}).n===0){const stmt=this.db.prepare('INSERT INTO products(sku,name,category,price_cents,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');const now=new Date().toISOString();OPENING_CATALOG.forEach(p=>stmt.run(p.sku,p.name,p.category,p.price_cents,p.sort_order,now,now));this.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('currency',?)").run(CURRENCY);}this.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('products_seeded','1')").run();})();}catch(error){if(this.db.open)this.db.close();throw error;} }
 private migrateTimezone(file:string){
  const marker=(this.db.prepare("SELECT value FROM settings WHERE key='business_timezone'").get() as {value:string}|undefined)?.value;
  if(marker===BUSINESS_TIMEZONE){if(Number(this.db.pragma('user_version',{simple:true}))<4)this.db.pragma('user_version = 4');return;}
  const rows=this.db.prepare('SELECT id,created_at FROM transactions ORDER BY id').all() as {id:number;created_at:string}[];
  // Complete, durable pre-migration snapshot before changing any historical bucket.
  // VACUUM INTO is synchronous SQLite snapshotting; ordinary hot backups still use db.backup.
  if(rows.length&&file!==':memory:')this.saveMigrationBackup(file,'pre-timezone-safety');
  this.db.transaction(()=>{
   this.db.exec('DROP TRIGGER immutable_tx');
   const update=this.db.prepare('UPDATE transactions SET business_date=?,hour_bucket=? WHERE id=?');
   for(const row of rows){const clock=businessTime(new Date(row.created_at));update.run(clock.date,clock.hour,row.id);}
   this.db.exec(immutableGuard());
   this.db.prepare("INSERT INTO settings(key,value) VALUES('business_timezone',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(BUSINESS_TIMEZONE);
   this.db.pragma('user_version = 4');
  })();
 }
 private saveMigrationBackup(file:string,kind:'pre-upgrade-safety'|'pre-timezone-safety'){
  const parent=path.dirname(path.resolve(file));
  const root=path.basename(parent)==='db'?path.dirname(parent):parent;
  let partial:string|undefined;
  try{
   const directory=contained(root,path.join(root,'backups'));
   const target=path.join(directory,`${Date.now()}_${kind}_${randomUUID()}.db`);
   partial=target+'.partial';
   fs.mkdirSync(directory,{recursive:true});
   this.db.prepare('VACUUM INTO ?').run(partial);
   const snapshot=new Database(partial,{readonly:true,fileMustExist:true});
   try{
    if(snapshot.pragma('integrity_check',{simple:true})!=='ok'||(snapshot.pragma('foreign_key_check') as unknown[]).length||
     snapshot.pragma('user_version',{simple:true})!==this.db.pragma('user_version',{simple:true}))
     throw Error('升级前备份校验失败。');
   }finally{snapshot.close();}
   syncFile(partial);
   fs.renameSync(partial,target);
   syncDirectory(directory);
  }catch(error){
   if(partial)try{fs.rmSync(partial,{force:true});}catch{/* Preserve the backup failure that prevented migration. */}
   throw new LedgerUpgradeBackupError(error);
  }
 }
 private migrateTransactions(){
  if(this.db.pragma('user_version',{simple:true})===LEDGER_SCHEMA_VERSION)return;
  this.db.transaction(()=>{
   const columns=this.db.pragma('table_info(transactions)') as {name:string}[];
   if(!columns.some(column=>column.name==='half_price')){
    this.db.exec(`ALTER TABLE transactions ADD COLUMN half_price INTEGER NOT NULL DEFAULT 0
     CHECK(half_price IN(0,1) AND (half_price=0 OR tx_type IN('SALE','REFUND')))`);
   }
   if(!columns.some(column=>column.name==='refund_of')){
    this.db.exec('ALTER TABLE transactions ADD COLUMN refund_of INTEGER REFERENCES transactions(id) CHECK(refund_of IS NULL OR tx_type=\'REFUND\')');
   }
   this.db.exec('CREATE INDEX IF NOT EXISTS idx_tx_refund_of ON transactions(refund_of) WHERE refund_of IS NOT NULL; DROP TRIGGER immutable_tx;'+immutableGuard(LEDGER_SCHEMA_VERSION));
   this.db.pragma(`user_version = ${LEDGER_SCHEMA_VERSION}`);
  })();
 }
 products(){return this.db.prepare('SELECT * FROM products ORDER BY sort_order,id').all() as Product[];}
 product(sku:string){return this.db.prepare('SELECT * FROM products WHERE sku=? AND is_active=1').get(sku) as Product|undefined;}
 record(p:Product,scanner:ScannerId,quantity:number,mode:Mode,now:Date,halfPrice=false){
  const unitPrice=halfPrice?Math.ceil(p.price_cents/2):p.price_cents;
  const result=this.db.transaction(()=>this.insertTransaction(
   {product_id:p.id,sku_snapshot:p.sku,name_snapshot:p.name,category_snapshot:p.category,unit_price_cents_snapshot:unitPrice,half_price:halfPrice?1:0},
   scanner,quantity,mode,now,null
  ))();
  this.onRecorded?.(now);
  return result;
 }
 private insertTransaction(item:Pick<Transaction,'product_id'|'sku_snapshot'|'name_snapshot'|'category_snapshot'|'unit_price_cents_snapshot'|'half_price'>,scanner:ScannerId,quantity:number,mode:Mode,now:Date,refundOf:number|null){
  const {date,hour}=businessTime(now);
  const value=item.unit_price_cents_snapshot*quantity;
  const subtotal=mode==='SALE'?value:mode==='REFUND'?-value:0;
  const inserted=this.db.prepare(`INSERT INTO transactions(tx_uid,scanner_id,product_id,sku_snapshot,name_snapshot,category_snapshot,unit_price_cents_snapshot,quantity,tx_type,half_price,subtotal_cents,item_value_cents,created_at,business_date,hour_bucket,refund_of) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .run(randomUUID(),scanner,item.product_id,item.sku_snapshot,item.name_snapshot,item.category_snapshot,item.unit_price_cents_snapshot,quantity,mode,item.half_price,subtotal,value,now.toISOString(),date,hour,refundOf);
  if(hour>=5&&hour<=19)this.db.prepare("INSERT INTO settings(key,value) VALUES('recorded_total','1') ON CONFLICT(key) DO UPDATE SET value=cast(cast(value as integer)+1 as text)").run();
  return this.get(Number(inserted.lastInsertRowid));
 }
 private refundedQuantity(saleId:number){
  return Number(this.db.prepare('SELECT coalesce(sum(quantity),0) FROM transactions WHERE refund_of=? AND is_voided=0').pluck().get(saleId));
 }
 findRefundSales(search:RefundSearch){
  if(!search||!validDate(search.date)||typeof search.query!=='string'||search.query.length>128||typeof search.halfOnly!=='boolean'||
   !Number.isSafeInteger(search.page)||search.page<0||search.page>1_000_000)throw Error('请选择有效的退款查询条件。');
  const query=search.query.trim().toUpperCase();
  const size=30;
  const rows=this.db.prepare(`
   SELECT sale.*, sale.quantity-coalesce((SELECT sum(r.quantity) FROM transactions r WHERE r.refund_of=sale.id AND r.is_voided=0),0) AS refundable,
    EXISTS(SELECT 1 FROM transactions r WHERE r.product_id=sale.product_id AND r.tx_type='REFUND'
     AND r.is_voided=0 AND r.refund_of IS NULL AND r.id>sale.id) AS review_required
   FROM transactions sale
   WHERE sale.business_date=? AND sale.tx_type='SALE' AND sale.is_voided=0 AND (?=0 OR sale.half_price=1)
   AND (?='' OR instr(sale.sku_snapshot,?)>0 OR instr(upper(sale.name_snapshot),?)>0)
   ORDER BY sale.id DESC LIMIT ? OFFSET ?
  `).all(search.date,search.halfOnly?1:0,query,query,query,size+1,search.page*size) as RefundableSale[];
  return {rows:rows.slice(0,size),more:rows.length>size};
 }
 refundSale(id:number,txUid:string,quantity:number,scanner:ScannerId,now:Date){
  if(!Number.isSafeInteger(id)||id<1||typeof txUid!=='string'||!txUid||!Number.isSafeInteger(quantity)||quantity<1||!SCANNERS.includes(scanner))
   throw Error('请选择原销售流水和有效的退款件数。');
  const result=this.db.transaction(()=>{
   const sale=this.get(id);
   if(!sale||sale.tx_uid!==txUid||sale.tx_type!=='SALE'||sale.is_voided)throw Error('原销售流水已变更或撤销，请重新选择。');
   const legacy=this.db.prepare(`SELECT 1 FROM transactions
    WHERE product_id=? AND tx_type='REFUND' AND is_voided=0 AND refund_of IS NULL AND id>? LIMIT 1
   `).get(sale.product_id,id);
   if(legacy)throw Error('这笔销售之后有同商品的旧退款记录，无法确认已退款件数。请先核对旧账。');
   if(quantity>sale.quantity-this.refundedQuantity(id))throw Error('退款件数超过原流水剩余可退件数，请重新选择。');
   return this.insertTransaction(sale,scanner,quantity,'REFUND',now,sale.id);
  }).immediate();
  this.onRecorded?.(now);
  return result;
 }
 get(id:number){return this.db.prepare('SELECT * FROM transactions WHERE id=?').get(id) as Transaction;}
 undo(scanner:ScannerId,now:Date){
  const earliest=new Date(now.getTime()-60_000).toISOString();
  return this.db.transaction(()=>{
   const row=this.db.prepare(`
    SELECT id FROM transactions
    WHERE is_voided=0 AND scanner_id=? AND created_at BETWEEN ? AND ?
    AND id>coalesce((SELECT cast(value AS INTEGER) FROM settings WHERE key=?),0)
    ORDER BY created_at DESC,id DESC LIMIT 1
   `).get(scanner,earliest,now.toISOString(),`scanner_undo_floor:${scanner}`) as {id:number}|undefined;
   return row?this.void(row.id,now):undefined;
  })();
 }
 saveScannerMappings(values:Record<string,string>,keys:ReadonlyArray<readonly [ScannerId,string]>) {
  const get=this.db.prepare('SELECT value FROM settings WHERE key=?').pluck();
  const put=this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  return this.db.transaction(()=>{
   const changed=keys.filter(([,key])=>values[key]!==undefined&&values[key].toUpperCase()!==String(get.get(key)??'').toUpperCase());
   for(const [key,value] of Object.entries(values))put.run(key,value);
   if(changed.length){
    const latest=this.db.prepare('SELECT coalesce(max(id),0) FROM transactions').pluck().get();
    for(const [scanner] of changed)put.run(`scanner_undo_floor:${scanner}`,String(latest));
   }
   return changed.map(([scanner])=>scanner);
  })();
 }
 void(id:number,now:Date,txUid?:string){
  return this.db.transaction(()=>{
   const row=this.get(id);
   if(!row||row.is_voided||(txUid!==undefined&&row.tx_uid!==txUid))return undefined;
   if(row.tx_type==='SALE'&&this.refundedQuantity(id)>0)throw Error('这笔销售已有退款，请先撤销对应的退款流水。');
   this.db.prepare('UPDATE transactions SET is_voided=1,voided_at=? WHERE id=?').run(now.toISOString(),id);
   return this.get(id);
  })();
 }
 saveProduct(input:ProductInput){
  const p=validateProduct(input);
  return this.db.transaction(()=>{
   const duplicate=this.db.prepare('SELECT id FROM products WHERE sku=? AND id!=?').get(p.sku,p.id??-1);
   if(duplicate)throw Error('这个商品条码已被使用，停用商品的条码也不能重复。');
   const now=new Date().toISOString();let id=p.id;
   const previous=id===undefined?undefined:this.db.prepare('SELECT sku FROM products WHERE id=?').pluck().get(id) as string|undefined;
   if(id!==undefined&&!previous)throw Error('找不到这个商品，请刷新后重试。');
   if(p.sku!==previous){
    const retired=this.db.prepare('SELECT value FROM settings WHERE key=?').pluck().get(`retired_sku:${p.sku}`);
    const historical=this.db.prepare('SELECT 1 FROM transactions WHERE sku_snapshot=? AND product_id!=? LIMIT 1').get(p.sku,id??-1);
    if((retired!==undefined&&retired!==String(id))||historical)throw Error('这个条码曾用于其他商品，旧打印板仍可能被扫描，请换一个条码。');
    if(previous)this.retireSKU(previous,id!);
   }
   if(id!==undefined){const r=this.db.prepare('UPDATE products SET sku=?,name=?,category=?,price_cents=?,sort_order=?,is_active=?,updated_at=? WHERE id=?').run(p.sku,p.name,p.category,p.price_cents,p.sort_order,p.is_active,now,id);if(!r.changes)throw Error('找不到这个商品，请刷新后重试。');}
   else{id=Number(this.db.prepare('INSERT INTO products(sku,name,category,price_cents,sort_order,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(p.sku,p.name,p.category,p.price_cents,p.sort_order,p.is_active,now,now).lastInsertRowid);}
   return this.db.prepare('SELECT * FROM products WHERE id=?').get(id) as Product;
  })();
 }
 setProductActive(id:number,active:boolean){this.productId(id);if(typeof active!=='boolean')throw Error('商品启用状态无效，请重新选择。');const result=this.db.prepare('UPDATE products SET is_active=?,updated_at=? WHERE id=?').run(active?1:0,new Date().toISOString(),id);if(!result.changes)throw Error('找不到这个商品，请刷新后重试。');}
 private productId(id:number){if(!Number.isSafeInteger(id)||id<1)throw Error('商品编号无效，请重新选择商品。');}
 private retireSKU(sku:string,id:number){this.db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(`retired_sku:${sku}`,String(id));}
 deleteProduct(id:number){this.productId(id);return this.db.transaction(()=>{
  const sku=this.db.prepare('SELECT sku FROM products WHERE id=?').pluck().get(id) as string|undefined;
  if(!sku)throw Error('找不到这个商品，请刷新后重试。');
  const historical=this.db.prepare('SELECT id FROM transactions WHERE product_id=? LIMIT 1').get(id)??this.db.prepare('SELECT product_id FROM preparation_items WHERE product_id=? LIMIT 1').get(id);
  if(historical){this.setProductActive(id,false);return {archived:true};}
  this.retireSKU(sku,id);
  this.db.prepare('DELETE FROM products WHERE id=?').run(id);return {archived:false};
 })();}
 recent(now:Date,filter:LedgerFilter={type:'ALL',scanner:'ALL'}){
  if(!filter||!['ALL','SALE','REFUND','GIFT','WASTE','VOID'].includes(filter.type)||!['ALL','SCANNER_1','SCANNER_2','KEYBOARD'].includes(filter.scanner))throw Error('流水筛选条件无效，请重新选择。');
  const conditions=['business_date=?'];const values:(string|number)[]=[businessTime(now).date];
  if(filter.type==='VOID')conditions.push('is_voided=1');else if(filter.type!=='ALL'){conditions.push('is_voided=0 AND tx_type=?');values.push(filter.type);}
  if(filter.scanner!=='ALL'){conditions.push('scanner_id=?');values.push(filter.scanner);}
  return this.db.prepare(`SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 40`).all(...values) as Transaction[];
 }
 todayTransactions(now:Date,filter:TodayTransactionFilter):TodayTransactionPage {
  const pageSize=30;
  const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if(!filter||(filter.scanner!=='ALL'&&!SCANNERS.includes(filter.scanner))||typeof filter.product!=='string'||filter.product.length>128||!Number.isSafeInteger(filter.page*pageSize)||!Number.isSafeInteger(filter.page)||filter.page<0)throw Error('流水筛选条件无效，请重新选择。');
  const {scanner,from,to,page,day='today',upperId}=filter;
  if(!['today','yesterday'].includes(day)||(upperId!==undefined&&(!Number.isSafeInteger(upperId)||upperId<1)))throw Error('流水筛选条件无效，请重新选择。');
  if(typeof from!=='string'||typeof to!=='string'||(from&&!clock.test(from))||(to&&!clock.test(to))||(from&&to&&from>to))throw Error('请选择有效时间，结束时间不能早于开始时间。');
  const today=businessTime(now).date;
  const date=day==='today'?today:addDays(today,-1),product=filter.product.trim();
  const conditions=['business_date=?'];
  const values:(string|number)[]=[date];
  if(upperId!==undefined){conditions.push('id<=?');values.push(upperId);}
  if(scanner!=='ALL'){conditions.push('scanner_id=?');values.push(scanner);}
  if(product){
   conditions.push('(instr(lower(name_snapshot),lower(?))>0 OR instr(lower(sku_snapshot),lower(?))>0)');
   values.push(product,product);
  }
  if(from){conditions.push('created_at>=?');values.push(new Date(`${date}T${from}:00.000+08:00`).toISOString());}
  if(to){conditions.push('created_at<=?');values.push(new Date(`${date}T${to}:59.999+08:00`).toISOString());}
  const rows=this.db.prepare(`SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...values,pageSize+1,page*pageSize) as Transaction[];
  return {rows:rows.slice(0,pageSize),hasNext:rows.length>pageSize};
 }
 dashboard(now:Date):Dashboard {
  const {date,hour}=businessTime(now);
  const preparationCompleted=!!this.db.prepare("SELECT 1 FROM preparation_days WHERE business_date=? AND completed=1 AND status<>'closed'").get(date);
  const flat=this.db.prepare(`SELECT
   coalesce(sum(CASE WHEN is_voided=0 THEN subtotal_cents ELSE 0 END),0) revenue,
   coalesce(sum(CASE WHEN is_voided=0 AND tx_type='SALE' THEN item_value_cents ELSE 0 END),0) gross,
   coalesce(sum(CASE WHEN is_voided=0 AND tx_type='REFUND' THEN item_value_cents ELSE 0 END),0) refunds,
   coalesce(sum(CASE WHEN is_voided=0 THEN CASE tx_type WHEN 'SALE' THEN quantity WHEN 'REFUND' THEN -quantity ELSE 0 END ELSE 0 END),0) items,
   count(*) transactions,coalesce(sum(is_voided=0),0) validTransactions,
   coalesce(sum(is_voided=1 OR tx_type!='SALE'),0) special,coalesce(sum(is_voided),0) voids,
   coalesce(sum(CASE WHEN is_voided=0 AND tx_type='REFUND' THEN quantity ELSE 0 END),0) refundQty,
   coalesce(sum(CASE WHEN is_voided=0 AND tx_type='GIFT' THEN quantity ELSE 0 END),0) giftQty,
   coalesce(sum(CASE WHEN is_voided=0 AND tx_type='GIFT' THEN item_value_cents ELSE 0 END),0) giftValue,
   coalesce(sum(CASE WHEN is_voided=0 AND tx_type='WASTE' THEN quantity ELSE 0 END),0) wasteQty,
   coalesce(sum(CASE WHEN is_voided=0 AND tx_type='WASTE' THEN item_value_cents ELSE 0 END),0) wasteValue
   FROM transactions WHERE business_date=?`).get(date) as TodaySummary & {refundQty:number;giftQty:number;giftValue:number;wasteQty:number;wasteValue:number};
  const summary:TodaySummary={...flat,refund:{quantity:flat.refundQty,value:flat.refunds},gift:{quantity:flat.giftQty,value:flat.giftValue},waste:{quantity:flat.wasteQty,value:flat.wasteValue}};
  // Identify products by immutable ID; today's most recent snapshot supplies historical labels.
  const ranking=this.db.prepare(`SELECT p.id product_id,coalesce(last.sku_snapshot,p.sku) sku,coalesce(last.name_snapshot,p.name) name,coalesce(last.category_snapshot,p.category) category,p.is_active,
   count(t.id) activity,
   coalesce(sum(CASE WHEN t.is_voided=0 THEN CASE t.tx_type WHEN 'SALE' THEN t.quantity WHEN 'REFUND' THEN -t.quantity ELSE 0 END ELSE 0 END),0) quantity,
   coalesce(sum(CASE WHEN t.is_voided=0 THEN t.subtotal_cents ELSE 0 END),0) revenue,
   coalesce(sum(CASE WHEN t.is_voided=0 AND t.tx_type='REFUND' THEN t.quantity ELSE 0 END),0) refund,
   coalesce(sum(CASE WHEN t.is_voided=0 AND t.tx_type='GIFT' THEN t.quantity ELSE 0 END),0) gift,
   coalesce(sum(CASE WHEN t.is_voided=0 AND t.tx_type='WASTE' THEN t.quantity ELSE 0 END),0) waste
   FROM products p LEFT JOIN transactions t ON t.product_id=p.id AND t.business_date=?
   LEFT JOIN transactions last ON last.id=(SELECT max(id) FROM transactions WHERE product_id=p.id AND business_date=?)
   GROUP BY p.id HAVING count(t.id)>0 OR p.is_active=1 ORDER BY quantity DESC,revenue DESC,p.id`).all(date,date) as ProductActivity[];
  const buckets=this.db.prepare(`SELECT hour_bucket hour,
   coalesce(sum(CASE tx_type WHEN 'SALE' THEN quantity WHEN 'REFUND' THEN -quantity ELSE 0 END),0) quantity,
   coalesce(sum(subtotal_cents),0) revenue FROM transactions WHERE business_date=? AND is_voided=0 GROUP BY hour_bucket`).all(date) as HourActivity[];
  const hours=Array.from({length:24},(_,h)=>buckets.find(b=>b.hour===h)??{hour:h,quantity:0,revenue:0});
  const peak=hours.filter(h=>h.quantity>0).sort((a,b)=>b.quantity-a.quantity||b.revenue-a.revenue||a.hour-b.hour)[0]??null;
  const {completed,backupPending,changed}=closeoutCheckpointStatus(this.db,{date,validTransactions:summary.validTransactions,voids:summary.voids});
  const yesterday=addDays(date,-1);
  const previous=this.db.prepare('SELECT count(*) total,coalesce(sum(is_voided),0) voids FROM transactions WHERE business_date=?').get(yesterday) as {total:number;voids:number};
  const previousCloseout=closeoutCheckpointStatus(this.db,{date:yesterday,validTransactions:previous.total-previous.voids,voids:previous.voids});
  const yesterdayUnfinished=previousCloseout.backupPending||previousCloseout.changed||(previous.total>0&&!previousCloseout.started);
  return {businessDate:date,currentHour:hour,closedOut:completed||(preparationCompleted&&!backupPending),closeoutBackupPending:backupPending,closeoutChanged:changed,yesterdayUnfinished,summary,ranking,hours,peak,bestSeller:ranking.find(p=>p.quantity>0)??null};
 }
 today(now:Date){const dashboard=this.dashboard(now);return {recent:this.recent(now),summary:dashboard.summary,dashboard};}
 close(){this.db.close();}
}
