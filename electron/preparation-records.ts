import type Database from 'better-sqlite3';
import {validDate,addDays} from './ranges';
import {businessTime} from './time';
import type {PreparationDay,PreparationDayInput,PreparationDayStatus} from './types';

export function preparationSchema(db:Database.Database){
 db.transaction(()=>{
  db.exec(`CREATE TABLE IF NOT EXISTS preparation_days(business_date TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN('auto','open','closed')),completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS preparation_items(business_date TEXT NOT NULL,product_id INTEGER NOT NULL REFERENCES products(id),stockout INTEGER NOT NULL DEFAULT 0 CHECK(stockout IN(0,1)),prepared INTEGER CHECK(prepared IS NULL OR (typeof(prepared)='integer' AND prepared BETWEEN 0 AND 1000000)),remaining INTEGER CHECK(remaining IS NULL OR (typeof(remaining)='integer' AND remaining BETWEEN 0 AND 1000000)),updated_at TEXT NOT NULL,PRIMARY KEY(business_date,product_id),CHECK(prepared IS NULL OR remaining IS NULL OR remaining<=prepared),CHECK(stockout=0 OR remaining IS NULL OR remaining=0));
   PRAGMA user_version=5;`);
 })();
}
function validateDay(date:unknown,now:Date){if(!validDate(date)||date>addDays(businessTime(now).date,1))throw Error('请选择有效日期，最晚可提前标记到明天。');}
export function preparationDay(db:Database.Database,date:string,now=new Date()):PreparationDay {
 validateDay(date,now);
 const day=db.prepare('SELECT status,completed FROM preparation_days WHERE business_date=?').get(date) as {status:PreparationDayStatus;completed:number}|undefined;
 const status=day?.status??'auto';
 const products=db.prepare(`SELECT p.id productId,p.name,p.category,p.is_active active,i.stockout, i.prepared,i.remaining,
  coalesce((SELECT sum(t.quantity) FROM transactions t WHERE t.product_id=p.id AND t.business_date=? AND t.is_voided=0 AND t.tx_type='SALE'),0) sold
  FROM products p LEFT JOIN preparation_items i ON i.product_id=p.id AND i.business_date=?
  WHERE p.is_active=1 OR i.product_id IS NOT NULL ORDER BY p.category,p.sort_order,p.id`).all(date,date) as {productId:number;name:string;category:string;active:number;stockout:number|null;prepared:number|null;remaining:number|null;sold:number}[];
 return {date,status,completed:!!day?.completed,products:products.map(p=>({...p,stockout:!!p.stockout})),totalSales:(db.prepare("SELECT coalesce(sum(quantity),0) n FROM transactions WHERE business_date=? AND is_voided=0 AND tx_type='SALE'").get(date) as {n:number}).n};
}
export function savePreparationDay(db:Database.Database,input:PreparationDayInput,now=new Date()){
 if(!input||typeof input!=='object')throw Error('备货记录格式无效，请重新填写。');
 validateDay(input.date,now);
 if(typeof input.completed!=='boolean'||!['auto','open','closed'].includes(input.status)||!Array.isArray(input.products)||input.products.length>5000)throw Error('请选择营业状态并检查商品记录。');
 const ids=new Set<number>();const today=businessTime(now).date;
 if(input.date>today&&input.completed)throw Error('明天还未营业，不能标记为已收工。');
 if(input.status==='closed'&&input.completed)throw Error('休息日不用标记收工，请取消收工勾选。');
 for(const row of input.products){
  if(!row||!Number.isSafeInteger(row.productId)||row.productId<1||ids.has(row.productId))throw Error('商品记录无效或重复，请刷新后重试。');
  ids.add(row.productId);
  if(typeof row.stockout!=='boolean')throw Error('请选择商品是否缺货。');
  for(const n of [row.prepared,row.remaining])if(n!==null&&(!Number.isInteger(n)||n<0||n>1000000))throw Error('备货量和剩余量须为 0～1000000 的整数，未知时请留空。');
  if(row.prepared!==null&&row.remaining!==null&&row.remaining>row.prepared)throw Error('剩余量不能超过实际备货量，请把当天补货也计入备货量。');
  if(row.stockout&&row.remaining!==null&&row.remaining>0)throw Error('标记缺货时剩余量应为 0 或留空，请核对记录。');
  if(input.date>today&&(row.stockout||row.prepared!==null||row.remaining!==null))throw Error('明天只能预先设置营业或休息，实际备货和缺货请当天再记录。');
 }
 db.transaction(()=>{
  for(const id of ids)if(!db.prepare('SELECT id FROM products WHERE id=?').get(id))throw Error('商品不存在，请刷新后重试。');
  if(input.status==='auto'&&!input.completed)db.prepare('DELETE FROM preparation_days WHERE business_date=?').run(input.date);
  else db.prepare('INSERT INTO preparation_days(business_date,status,completed,updated_at) VALUES(?,?,?,?) ON CONFLICT(business_date) DO UPDATE SET status=excluded.status,completed=excluded.completed,updated_at=excluded.updated_at').run(input.date,input.status,input.completed?1:0,now.toISOString());
  const remove=db.prepare('DELETE FROM preparation_items WHERE business_date=? AND product_id=?');
  const save=db.prepare('INSERT INTO preparation_items(business_date,product_id,stockout,prepared,remaining,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(business_date,product_id) DO UPDATE SET stockout=excluded.stockout,prepared=excluded.prepared,remaining=excluded.remaining,updated_at=excluded.updated_at');
  for(const row of input.products){if(!row.stockout&&row.prepared===null&&row.remaining===null)remove.run(input.date,row.productId);else save.run(input.date,row.productId,row.stockout?1:0,row.prepared,row.remaining,now.toISOString());}
 })();
 return preparationDay(db,input.date,now);
}
