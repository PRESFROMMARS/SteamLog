import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {validateProduct} from './products';
import {CURRENCY,OPENING_CATALOG} from './catalog';
import {preparationSchema} from './preparation-records';
import type {Dashboard,HourActivity,LedgerFilter,ProductActivity,ProductInput,TodaySummary,Mode,Product,ScannerId,Transaction} from './types';
import fs from 'node:fs';
import path from 'node:path';
import {syncFile,syncDirectory} from './paths';
import {businessTime,BUSINESS_TIMEZONE} from './time';
export {businessTime} from './time';

const immutableGuard=` CREATE TRIGGER IF NOT EXISTS immutable_tx BEFORE UPDATE ON transactions WHEN NOT (
 OLD.is_voided=0 AND NEW.is_voided=1 AND NEW.voided_at IS NOT NULL AND
 NEW.id=OLD.id AND NEW.tx_uid=OLD.tx_uid AND NEW.scanner_id=OLD.scanner_id AND NEW.product_id=OLD.product_id AND NEW.sku_snapshot=OLD.sku_snapshot AND NEW.name_snapshot=OLD.name_snapshot AND NEW.category_snapshot=OLD.category_snapshot AND NEW.unit_price_cents_snapshot=OLD.unit_price_cents_snapshot AND NEW.quantity=OLD.quantity AND NEW.tx_type=OLD.tx_type AND NEW.subtotal_cents=OLD.subtotal_cents AND NEW.item_value_cents=OLD.item_value_cents AND NEW.created_at=OLD.created_at AND NEW.business_date=OLD.business_date AND NEW.hour_bucket=OLD.hour_bucket
 ) BEGIN SELECT RAISE(ABORT,'Only a one-way void is permitted'); END;`;

export class Ledger {
 readonly db:Database.Database;
 onRecorded?:()=>void;
 constructor(file:string){this.db=new Database(file);try{this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = NORMAL');this.db.pragma('foreign_keys = ON');if(Number(this.db.pragma('user_version',{simple:true}))>5){this.db.close();throw Error('账本由更新版本的程序创建，请先升级程序再打开。');}this.db.exec(`
 CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,sku TEXT UNIQUE NOT NULL CHECK(sku=upper(sku)),name TEXT NOT NULL,category TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents>=0),is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN(0,1)),sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,tx_uid TEXT UNIQUE NOT NULL,scanner_id TEXT NOT NULL,product_id INTEGER NOT NULL REFERENCES products(id),sku_snapshot TEXT NOT NULL,name_snapshot TEXT NOT NULL,category_snapshot TEXT NOT NULL,unit_price_cents_snapshot INTEGER NOT NULL CHECK(unit_price_cents_snapshot>=0),quantity INTEGER NOT NULL CHECK(quantity>0 AND typeof(quantity)='integer'),tx_type TEXT NOT NULL CHECK(tx_type IN('SALE','REFUND','GIFT','WASTE')),subtotal_cents INTEGER NOT NULL,item_value_cents INTEGER NOT NULL,is_voided INTEGER NOT NULL DEFAULT 0 CHECK(is_voided IN(0,1)),voided_at TEXT,created_at TEXT NOT NULL,business_date TEXT NOT NULL,hour_bucket INTEGER NOT NULL CHECK(hour_bucket BETWEEN 0 AND 23),CHECK(item_value_cents=unit_price_cents_snapshot*quantity),CHECK(subtotal_cents=CASE tx_type WHEN 'SALE' THEN item_value_cents WHEN 'REFUND' THEN -item_value_cents ELSE 0 END),CHECK((is_voided=0 AND voided_at IS NULL) OR (is_voided=1 AND voided_at IS NOT NULL)));
 CREATE INDEX IF NOT EXISTS idx_tx_date_void ON transactions(business_date,is_voided);
 CREATE INDEX IF NOT EXISTS idx_tx_sku_date ON transactions(sku_snapshot,business_date);
 CREATE INDEX IF NOT EXISTS idx_tx_product_date ON transactions(product_id,business_date,id);
 CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS no_tx_delete BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT,'Ledger rows cannot be deleted'); END;
 ${immutableGuard}`);
 this.migrateTimezone(file);
 preparationSchema(this.db);
 this.db.transaction(()=>{if(!this.db.prepare("SELECT value FROM settings WHERE key='products_seeded'").get() && (this.db.prepare('SELECT count(*) n FROM products').get() as {n:number}).n===0){const stmt=this.db.prepare('INSERT INTO products(sku,name,category,price_cents,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');const now=new Date().toISOString();OPENING_CATALOG.forEach(p=>stmt.run(p.sku,p.name,p.category,p.price_cents,p.sort_order,now,now));this.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('currency',?)").run(CURRENCY);}this.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('products_seeded','1')").run();})();}catch(error){if(this.db.open)this.db.close();throw error;} }
 private migrateTimezone(file:string){
  const marker=(this.db.prepare("SELECT value FROM settings WHERE key='business_timezone'").get() as {value:string}|undefined)?.value;
  if(marker===BUSINESS_TIMEZONE){if(Number(this.db.pragma('user_version',{simple:true}))<4)this.db.pragma('user_version = 4');return;}
  const rows=this.db.prepare('SELECT id,created_at FROM transactions ORDER BY id').all() as {id:number;created_at:string}[];
  // Complete, durable pre-migration snapshot before changing any historical bucket.
  // VACUUM INTO is synchronous SQLite snapshotting; ordinary hot backups still use db.backup.
  if(rows.length&&file!==':memory:'){
   const parent=path.dirname(path.resolve(file)),root=path.basename(parent)==='db'?path.dirname(parent):parent;
   const directory=path.join(root,'backups');fs.mkdirSync(directory,{recursive:true});
   const target=path.join(directory,`${Date.now()}_pre-timezone-safety_${randomUUID()}.db`),partial=target+'.partial';
   try{this.db.prepare('VACUUM INTO ?').run(partial);syncFile(partial);fs.renameSync(partial,target);syncDirectory(directory);}catch(error){fs.rmSync(partial,{force:true});throw error;}
  }
  this.db.transaction(()=>{
   this.db.exec('DROP TRIGGER immutable_tx');
   const update=this.db.prepare('UPDATE transactions SET business_date=?,hour_bucket=? WHERE id=?');
   for(const row of rows){const clock=businessTime(new Date(row.created_at));update.run(clock.date,clock.hour,row.id);}
   this.db.exec(immutableGuard);
   this.db.prepare("INSERT INTO settings(key,value) VALUES('business_timezone',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(BUSINESS_TIMEZONE);
   this.db.pragma('user_version = 4');
  })();
 }
 products(){return this.db.prepare('SELECT * FROM products ORDER BY sort_order,id').all() as Product[];}
 product(sku:string){return this.db.prepare('SELECT * FROM products WHERE sku=? AND is_active=1').get(sku) as Product|undefined;}
 record(p:Product,scanner:ScannerId,quantity:number,mode:Mode,now:Date){const {date,hour}=businessTime(now);const value=p.price_cents*quantity;const result=this.db.transaction(()=>{const r=this.db.prepare(`INSERT INTO transactions(tx_uid,scanner_id,product_id,sku_snapshot,name_snapshot,category_snapshot,unit_price_cents_snapshot,quantity,tx_type,subtotal_cents,item_value_cents,created_at,business_date,hour_bucket) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),scanner,p.id,p.sku,p.name,p.category,p.price_cents,quantity,mode,mode==='SALE'?value:mode==='REFUND'?-value:0,value,now.toISOString(),date,hour);if(hour>=5&&hour<=19)this.db.prepare("INSERT INTO settings(key,value) VALUES('recorded_total','1') ON CONFLICT(key) DO UPDATE SET value=cast(cast(value as integer)+1 as text)").run();return this.get(Number(r.lastInsertRowid));})();this.onRecorded?.();return result;}
 get(id:number){return this.db.prepare('SELECT * FROM transactions WHERE id=?').get(id) as Transaction;}
 undo(scanner:ScannerId,now:Date){return this.db.transaction(()=>{const row=this.db.prepare('SELECT * FROM transactions WHERE is_voided=0 AND scanner_id=? AND created_at>=? AND created_at<=? ORDER BY id DESC LIMIT 1').get(scanner,new Date(now.getTime()-60000).toISOString(),now.toISOString()) as Transaction|undefined;const fallback=row??this.db.prepare('SELECT * FROM transactions WHERE is_voided=0 AND business_date=? ORDER BY id DESC LIMIT 1').get(businessTime(now).date) as Transaction|undefined;return fallback?this.void(fallback.id,now):undefined;})();}
 void(id:number,now:Date){const r=this.db.prepare('UPDATE transactions SET is_voided=1,voided_at=? WHERE id=? AND is_voided=0').run(now.toISOString(),id);return r.changes?this.get(id):undefined;}
 saveProduct(input:ProductInput){
  const p=validateProduct(input);
  return this.db.transaction(()=>{
   const duplicate=this.db.prepare('SELECT id FROM products WHERE sku=? AND id!=?').get(p.sku,p.id??-1);
   if(duplicate)throw Error('这个商品条码已被使用，停用商品的条码也不能重复。');
   const now=new Date().toISOString();let id=p.id;
   if(id!==undefined){const r=this.db.prepare('UPDATE products SET sku=?,name=?,category=?,price_cents=?,sort_order=?,is_active=?,updated_at=? WHERE id=?').run(p.sku,p.name,p.category,p.price_cents,p.sort_order,p.is_active,now,id);if(!r.changes)throw Error('找不到这个商品，请刷新后重试。');}
   else{id=Number(this.db.prepare('INSERT INTO products(sku,name,category,price_cents,sort_order,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(p.sku,p.name,p.category,p.price_cents,p.sort_order,p.is_active,now,now).lastInsertRowid);}
   return this.db.prepare('SELECT * FROM products WHERE id=?').get(id) as Product;
  })();
 }
 setProductActive(id:number,active:boolean){this.productId(id);if(typeof active!=='boolean')throw Error('商品启用状态无效，请重新选择。');const result=this.db.prepare('UPDATE products SET is_active=?,updated_at=? WHERE id=?').run(active?1:0,new Date().toISOString(),id);if(!result.changes)throw Error('找不到这个商品，请刷新后重试。');}
 private productId(id:number){if(!Number.isSafeInteger(id)||id<1)throw Error('商品编号无效，请重新选择商品。');}
 deleteProduct(id:number){this.productId(id);return this.db.transaction(()=>{
  if(!this.db.prepare('SELECT id FROM products WHERE id=?').get(id))throw Error('找不到这个商品，请刷新后重试。');
  const historical=this.db.prepare('SELECT id FROM transactions WHERE product_id=? LIMIT 1').get(id)??this.db.prepare('SELECT product_id FROM preparation_items WHERE product_id=? LIMIT 1').get(id);
  if(historical){this.setProductActive(id,false);return {archived:true};}
  this.db.prepare('DELETE FROM products WHERE id=?').run(id);return {archived:false};
 })();}
 recent(now:Date,filter:LedgerFilter={type:'ALL',scanner:'ALL'}){
  if(!filter||!['ALL','SALE','REFUND','GIFT','WASTE','VOID'].includes(filter.type)||!['ALL','SCANNER_1','SCANNER_2','KEYBOARD'].includes(filter.scanner))throw Error('流水筛选条件无效，请重新选择。');
  const conditions=['business_date=?'];const values:(string|number)[]=[businessTime(now).date];
  if(filter.type==='VOID')conditions.push('is_voided=1');else if(filter.type!=='ALL'){conditions.push('is_voided=0 AND tx_type=?');values.push(filter.type);}
  if(filter.scanner!=='ALL'){conditions.push('scanner_id=?');values.push(filter.scanner);}
  return this.db.prepare(`SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 40`).all(...values) as Transaction[];
 }
 dashboard(now:Date):Dashboard {
  const {date,hour}=businessTime(now);
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
  return {businessDate:date,currentHour:hour,summary,ranking,hours,peak,bestSeller:ranking.find(p=>p.quantity>0)??null};
 }
 today(now:Date){const dashboard=this.dashboard(now);return {recent:this.recent(now),summary:dashboard.summary,dashboard};}
 close(){this.db.close();}
}
