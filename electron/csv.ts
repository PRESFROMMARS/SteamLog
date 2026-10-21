import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import type {Ledger} from './database';
import {taipeiTimestamp} from './time';
import {queryHistory} from './analytics';
import {sealSnapshot} from './backup';
import {validateRange} from './ranges';
import {contained,syncFile} from './paths';
import type {DateRange,ExportKind,Transaction} from './types';
type Cell=string|number|{decimal:string};
export function csvCell(value:Cell){let text=typeof value==='object'?value.decimal:String(value);if(typeof value==='string'&&/^[\s]*[=+@-]|^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
const yuan=(c:number)=>({decimal:(c/100).toFixed(2)});
const yieldTurn=()=>new Promise<void>(resolve=>setImmediate(resolve));
export class CSVService {
 private jobs=new Set<Promise<string>>();
 constructor(private root:string,private projectRoot:string,private ledger:()=>Ledger){}
 export(kind:ExportKind,range:DateRange){validateRange(range);if(!['transactions','products'].includes(kind))throw Error('请选择要导出的流水或商品汇总。');const job=this.write(kind,range);this.jobs.add(job);void job.finally(()=>this.jobs.delete(job)).catch(()=>{});return job;}
 async idle(){await Promise.allSettled([...this.jobs]);}
 private async write(kind:ExportKind,range:DateRange){
  const folder=contained(this.projectRoot,path.join(this.root,'exports'));fs.mkdirSync(folder,{recursive:true});const token=randomUUID();const snapshot=path.join(folder,`.export-${token}.db`),file=path.join(folder,`steamlog-${kind}-${range.start}_${range.end}-${token}.csv`),partial=file+'.partial';let db:Database.Database|undefined,fd:number|undefined;
  try{
   // An online SQLite snapshot keeps CSV coherent while the live database accepts scans.
   await this.ledger().db.backup(snapshot);sealSnapshot(snapshot);db=new Database(snapshot,{readonly:true});fd=fs.openSync(partial,'wx');fs.writeSync(fd,'\uFEFF');
   const row=(cells:Cell[])=>fs.writeSync(fd!,cells.map(csvCell).join(',')+'\r\n');
   if(kind==='transactions'){
    row(['Timestamp Taipei','Business Date Taipei','Hour Taipei','Tx UID','Scanner ID','Type','Status','SKU','Product Name','Category','Unit Price CNY','Quantity','Subtotal CNY','Item Value CNY']);let n=0;
    for(const item of db.prepare('SELECT * FROM transactions WHERE business_date BETWEEN ? AND ? ORDER BY created_at,id').iterate(range.start,range.end) as IterableIterator<Transaction>){row([taipeiTimestamp(new Date(item.created_at)),item.business_date,item.hour_bucket,item.tx_uid,item.scanner_id,item.tx_type,item.is_voided?'VOIDED':'VALID',item.sku_snapshot,item.name_snapshot,item.category_snapshot,yuan(item.unit_price_cents_snapshot),item.quantity,yuan(item.subtotal_cents),yuan(item.item_value_cents)]);if(++n%1000===0)await yieldTurn();}
   }else{
    row(['Rank','SKU','Product Name','Category','Net Units Sold','Gross Revenue CNY','Refund Units','Refund CNY','Net Revenue CNY','Gift Units','Waste Units','Revenue Share %','Unit Share %']);
    queryHistory(db,{...range,granularity:'monthly'}).products.forEach((p,i)=>row([i+1,p.sku,p.name,p.category,p.units,yuan(p.gross),p.refundUnits,yuan(p.refundValue),yuan(p.revenue),p.giftUnits,p.wasteUnits,{decimal:p.revenueShare.toFixed(4)},{decimal:p.unitShare.toFixed(4)}]));
   }
   fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;syncFile(partial);fs.renameSync(partial,file);return file;
  }finally{if(fd!==undefined)fs.closeSync(fd);db?.close();fs.rmSync(partial,{force:true});for(const suffix of ['','-wal','-shm'])fs.rmSync(snapshot+suffix,{force:true});}
 }
}
