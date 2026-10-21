import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Ledger} from './database';
import {preparationDay,savePreparationDay} from './preparation-records';
import {recommendPreparation} from './preparation';
import {BackupService,validateBackup} from './backup';
import {clearTransactions} from './demo';
import type {PreparationDayInput,PreparationItemInput} from './types';
const now=new Date('2026-10-18T08:00:00Z'),root=path.resolve('.cache',`preparation-records-${process.pid}`),file=path.join(root,'db','ledger.db');fs.mkdirSync(path.dirname(file),{recursive:true});
let ledger=new Ledger(file);
const save=(date:string,products:PreparationItemInput[]=[],status:PreparationDayInput['status']='auto',completed=false)=>savePreparationDay(ledger.db,{date,status,completed,products},now);
const forecast=(buffer=10)=>recommendPreparation(ledger.db,buffer,now);
async function test(){try{
 const p=ledger.product('B001')!,q=ledger.product('S001')!;
 const stock=(productId:number,prepared:number|null,remaining:number|null,stockout=false)=>({productId,prepared,remaining,stockout});
 const row=()=>forecast().products.find(r=>r.id===p.id)!;
 const record=(date:string,qty:number,product=p)=>ledger.record(product,'KEYBOARD',qty,'SALE',new Date(date+'T08:00:00+08:00'));
 assert.equal(ledger.db.pragma('user_version',{simple:true}),5);assert.equal(preparationDay(ledger.db,'2026-10-18',now).completed,false);
 record('2026-10-17',50);save('2026-10-17',[stock(p.id,50,0,true)]);
 assert.equal(row().recentAverage,null);assert.equal(row().recommended,55);assert.equal(row().stockoutDays,1);assert.equal(row().method,'stockout');assert.equal(recommendPreparation(ledger.db,0,now).products.find(r=>r.id===p.id)!.recommended,55);assert.equal(recommendPreparation(ledger.db,50,now).products.find(r=>r.id===p.id)!.recommended,75);
 record('2026-10-18',100);save('2026-10-18',[stock(p.id,100,0,true)]);assert.equal(forecast().includesToday,false);assert.equal(row().recommended,55);
 save('2026-10-18',[stock(p.id,100,0,true)],'open',true);assert.equal(forecast().includesToday,true);assert.equal(forecast().end,'2026-10-18');assert.equal(row().recommended,110);
 save('2026-10-19',[],'closed');assert(forecast().targetClosed);assert.equal(forecast().total,0);assert(forecast().products.every(p=>p.recommended===0));save('2026-10-19',[],'auto');assert(!forecast().targetClosed);
 save('2026-10-17',[],'closed');assert.equal(forecast().closedDays,1);assert.equal(row().stockoutDays,1);assert.equal(ledger.get(1).quantity,50);save('2026-10-17',[],'auto');
 // Explicitly open zero-sale days are observations, without inventing pre-launch product history.
 save('2026-10-16',[stock(q.id,100,40)],'open');save('2026-10-15',[stock(q.id,100,30)],'open');
 const leftover=forecast().products.find(r=>r.id===q.id)!;assert.equal(leftover.advice,'reduce');assert.equal(leftover.recordedDays,2);assert.equal(leftover.remainingAverage,35);assert.equal(leftover.recommended,0);
 save('2026-10-16',[stock(q.id,100,null)],'open');assert.equal(forecast().products.find(r=>r.id===q.id)!.recordedDays,1);
 const before=preparationDay(ledger.db,'2026-10-18',now);
 for(const bad of [stock(p.id,-1,0),stock(p.id,2,3),stock(p.id,2,1,true),stock(p.id,1.5,0),stock(p.id,NaN,0),stock(p.id,1e6+1,0)])assert.throws(()=>save('2026-10-18',[bad]));
 assert.throws(()=>save('2026-10-18',[stock(p.id,1,0),stock(p.id,1,0)]));assert.throws(()=>save('2026-10-18',[stock(99999,1,0)],'closed'));assert.deepEqual(preparationDay(ledger.db,'2026-10-18',now),before);
 assert.throws(()=>save('2026-10-20',[],'closed'));assert.throws(()=>save('2026-10-19',[stock(p.id,1,0)]));assert.throws(()=>save('2026-10-19',[],'open',true));assert.throws(()=>save('2026-10-18',[],'closed',true));assert.throws(()=>save('2026-02-30'));
 const prepared=ledger.saveProduct({sku:'PREPONLY',name:'只记备货',category:'包子',price:'1',sort_order:1,is_active:1});save('2026-10-17',[stock(prepared.id,5,2)]);assert.equal(ledger.deleteProduct(prepared.id).archived,true);assert(preparationDay(ledger.db,'2026-10-17',now).products.some(r=>r.productId===prepared.id&&!r.active));
 ledger.close();ledger=new Ledger(file);assert.equal(preparationDay(ledger.db,'2026-10-18',now).completed,true);assert.equal(row().recommended,110);
 const backup=new BackupService(root,process.cwd(),()=>ledger);const copy=await backup.backup('manual');validateBackup(path.join(root,'backups',copy.filename));
 save('2026-10-18',[stock(p.id,100,0,false)],'auto',false);await backup.restore(copy.filename,next=>{ledger=next;});assert.equal(preparationDay(ledger.db,'2026-10-18',now).completed,true);assert.equal(row().recommended,110);
 clearTransactions(ledger);assert.equal((ledger.db.prepare('SELECT count(*) n FROM preparation_items').get() as {n:number}).n,0);assert.equal((ledger.db.prepare('SELECT count(*) n FROM preparation_days').get() as {n:number}).n,0);
 // A real old v4 file upgrades with empty daily records and its sales intact.
 const count=ledger.products().length;ledger.db.exec('DROP TABLE preparation_items; DROP TABLE preparation_days; PRAGMA user_version=4;');ledger.close();ledger=new Ledger(file);assert.equal(ledger.db.pragma('user_version',{simple:true}),5);assert.equal(ledger.products().length,count);assert.equal(preparationDay(ledger.db,'2026-10-18',now).status,'auto');
 console.log('PASS daily preparation: shortage floors/zero buffer, completed today, planned/historical closures, zero days, leftovers/nulls, atomic validation, future/date guards, archive, v4 migration, persistence, full backup/restore, clear.');
}finally{if(ledger.db.open)ledger.close();fs.rmSync(root,{recursive:true,force:true});}}
test().catch(error=>{console.error(error);process.exitCode=1;});
