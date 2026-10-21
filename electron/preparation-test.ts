import assert from 'node:assert/strict';
import {Ledger} from './database';
import {recommendPreparation} from './preparation';
import {readableError} from './errors';
import {addDays} from './ranges';

const ledger=new Ledger(':memory:');
const now=new Date('2026-10-18T08:00:00Z');
const p=ledger.product('B001')!,q=ledger.product('S001')!;
const record=(date:string,quantity:number,product=p,type:'SALE'|'REFUND'|'GIFT'|'WASTE'='SALE')=>ledger.record(product,'SCANNER_1',quantity,type,new Date(date+'T08:00:00+08:00'));
const item=(buffer=10)=>recommendPreparation(ledger.db,buffer,now).products.find(row=>row.id===p.id)!;
try{
 const empty=recommendPreparation(ledger.db,10,now);assert.equal(empty.targetDate,'2026-10-19');assert.equal(empty.operatingDays,0);assert.equal(empty.total,0);assert.equal(item().recommended,null);
 // Exactly 28 completed days. Mondays sell 20, other days 10.
 for(let i=0;i<28;i++){const date=addDays('2026-09-20',i);record(date,new Date(date+'T12:00:00Z').getUTCDay()===1?20:10);}
 const enough=item();assert.equal(enough.observedDays,28);assert.equal(enough.weekdayDays,4);assert.equal(enough.weekdayAverage,20);assert.equal(enough.recentAverage,80/7);assert.equal(enough.recommended,19);assert.equal(item(0).recommended,17);assert.equal(item(50).recommended,25);assert.equal(enough.confidence,'regular');
 const before=item();record('2026-10-18',999);record('2026-10-19',999);record('2026-09-19',999);record('2026-10-17',100,p,'REFUND');record('2026-10-17',100,p,'GIFT');record('2026-10-17',100,p,'WASTE');const voided=record('2026-10-17',999);ledger.void(voided.id,now);assert.deepEqual(item(),before);
 record('2026-10-17',3,q);const newly=recommendPreparation(ledger.db,10,now).products.find(row=>row.id===q.id)!;assert.equal(newly.observedDays,1);assert.equal(newly.recentAverage,3);assert.equal(newly.recommended,4);assert.equal(newly.confidence,'insufficient');assert.equal(newly.method,'recent');
 ledger.setProductActive(q.id,false);assert(!recommendPreparation(ledger.db,10,now).products.some(row=>row.id===q.id));
 const n=ledger.db.prepare('SELECT count(*) n FROM transactions').get();recommendPreparation(ledger.db,10,now);assert.deepEqual(ledger.db.prepare('SELECT count(*) n FROM transactions').get(),n);
 for(const bad of [-1,51,NaN,Infinity,1.5,'10',null])assert.throws(()=>recommendPreparation(ledger.db,bad as number,now),/0～50/);
 const midnight=recommendPreparation(ledger.db,10,new Date('2026-10-18T16:00:00Z'));assert.equal(midnight.today,'2026-10-19');assert.equal(midnight.end,'2026-10-18');assert.equal(midnight.targetDate,'2026-10-20');
 ledger.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('demo_seeded','1')").run();assert(recommendPreparation(ledger.db,10,now).demoData);
 // Closed/unrecorded dates are excluded, but an observed day's unsold products count as zero.
 const sparse=new Ledger(':memory:');try{
  const a=sparse.product('B001')!,b=sparse.product('S001')!;
  sparse.record(a,'KEYBOARD',10,'SALE',new Date('2026-10-15T08:00:00+08:00'));
  sparse.record(b,'KEYBOARD',2,'SALE',new Date('2026-10-17T08:00:00+08:00'));
  const result=recommendPreparation(sparse.db,0,now);const value=result.products.find(row=>row.id===a.id)!;
  assert.equal(result.operatingDays,2);assert.equal(value.recentAverage,5);assert.equal(value.recommended,5);assert.equal(value.weekdayAverage,null);
 }finally{sparse.close();}
 // No native English or Electron invocation wrapper reaches user alerts.
 assert.equal(readableError(Error("Error invoking remote method 'products:save': Error: 请填写商品名称。")),'请填写商品名称。');
 assert.match(readableError(Error('ENOSPC: no space left on device')),/空间不足/);
 assert.match(readableError(Error('SQLITE_BUSY: database is locked')),/正在使用/);
 assert.match(readableError(Error('EACCES: permission denied')),/权限/);
 assert.match(readableError(Error('SQLITE_NOTADB: file is not a database')),/备份恢复/);
 assert.match(readableError(Error('Unexpected failure at 中文路径')),/^操作未完成/);
 console.log('PASS preparation/localization: exact weighted demand, buffers/ceil, 28-day window, unfinished/future/void/refund/gift/waste exclusions, cold start, new/disabled items, zero-fill/closed days, Taipei midnight, read-only query, demo warning and Chinese native/IPC errors.');
}finally{ledger.close();}
