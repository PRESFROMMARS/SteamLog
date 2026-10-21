import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {businessTime,Ledger} from './database';
import {addDays} from './ranges';
import type {Mode} from './types';
export function seedHistory(ledger:Ledger,now=new Date()){
 if((ledger.db.prepare("SELECT value FROM settings WHERE key='demo_seeded'").get() as {value:string}|undefined)?.value==='1')throw Error('已生成过模拟数据，请先清理测试流水再试。');
 const products=ledger.products().filter(p=>p.is_active);if(!products.length)throw Error('请先启用至少一个商品。');
 let seed=17391;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
 const today=businessTime(now);const end=today.hour<5?addDays(today.date,-1):today.date;const batch=randomUUID();
 const offsetFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',timeZoneName:'shortOffset'});
 const rows:unknown[][]=[];
 for(let day=0;day<30;day++){
  const date=addDays(end,day-29),weekday=new Date(date+'T12:00:00Z').getUTCDay(),count=weekday===0||weekday===6?60:47;
  const offsetText=offsetFormatter.formatToParts(new Date(date+'T12:00:00Z')).find(p=>p.type==='timeZoneName')!.value;const offset=Number(offsetText.replace('GMT',''));
  for(let i=0;i<count;i++){
   const r=random(),hour=r<.06?5:r<.14?6:r<.34?7:r<.57?8:r<.76?9:r<.89?10:r<.95?11:r<.98?12:14;
   let product=products[Math.floor(random()*products.length)];const preferred=hour===7?'D001':hour===9?'S001':hour===10?'S003':'B001';if(random()<.36)product=products.find(p=>p.sku===preferred)??product;
   const chance=random(),mode:Mode=chance<.025?'REFUND':chance<.05?'GIFT':chance<.07?'WASTE':'SALE',quantity=random()<.2?2:1,value=product.price_cents*quantity;
   const stamp=new Date(`${date}T00:00:00Z`);stamp.setUTCHours(hour-offset,Math.floor(random()*60),Math.floor(random()*60));if(stamp>now)stamp.setTime(now.getTime());const clock=businessTime(stamp);
   const voided=random()<.01?1:0;rows.push([`DEMO-${batch}-${day}-${i}`,i%2?'SCANNER_1':'SCANNER_2',product.id,product.sku,product.name,product.category,product.price_cents,quantity,mode,mode==='SALE'?value:mode==='REFUND'?-value:0,value,voided,voided?stamp.toISOString():null,stamp.toISOString(),clock.date,clock.hour]);
  }
 }
 const insert=ledger.db.prepare('INSERT INTO transactions(tx_uid,scanner_id,product_id,sku_snapshot,name_snapshot,category_snapshot,unit_price_cents_snapshot,quantity,tx_type,subtotal_cents,item_value_cents,is_voided,voided_at,created_at,business_date,hour_bucket) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 const start=performance.now();ledger.db.transaction(()=>{for(const row of rows)insert.run(...row);ledger.db.prepare("INSERT INTO settings(key,value) VALUES('demo_seeded','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();})();return {inserted:rows.length,elapsedMs:performance.now()-start};
}
export function clearTransactions(ledger:Ledger){
 ledger.db.transaction(()=>{
  // Only this confirmed, safety-backed maintenance path may remove ledger rows.
  ledger.db.exec('DROP TRIGGER no_tx_delete; DELETE FROM transactions; DELETE FROM preparation_items; DELETE FROM preparation_days;');
  ledger.db.exec("CREATE TRIGGER no_tx_delete BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT,'Ledger rows cannot be deleted'); END;");
  ledger.db.prepare("DELETE FROM settings WHERE key IN ('demo_seeded','recorded_total')").run();
 })();
}
