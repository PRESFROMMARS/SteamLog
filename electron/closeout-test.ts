import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {Ledger,businessTime} from './database';
import {ledgerPath} from './ledger-path';
import {ScannerEngine} from './engine';
import {BackupService,validateBackup} from './backup';
import {createCloseout} from './closeout';
import {preparationDay,savePreparationDay} from './preparation-records';
import {recommendPreparation} from './preparation';
import {CSVService} from './csv';
import type {EngineEvent} from './types';
const root=path.resolve('.cache',`closeout-tests-${process.pid}`),file=ledgerPath(root);fs.mkdirSync(path.dirname(file),{recursive:true});
async function test(){
 // Exercise migration of a real v3 file; preserve absolute timestamps, snapshots and guards.
 let ledger=new Ledger(file);const p=ledger.product('B001')!;
 const previous=ledger.record(p,'SCANNER_1',1,'SALE',new Date('2026-10-17T15:59:59Z'));
 const sale=ledger.record(p,'SCANNER_1',5,'SALE',new Date('2026-10-17T16:00:00Z'));
 ledger.record(p,'SCANNER_2',1,'REFUND',new Date('2026-10-17T16:01:00Z'));
 ledger.record(p,'SCANNER_2',2,'GIFT',new Date('2026-10-17T16:02:00Z'));
 ledger.record(p,'SCANNER_2',1,'WASTE',new Date('2026-10-17T16:03:00Z'));
 const voided=ledger.record(p,'KEYBOARD',1,'SALE',new Date('2026-10-17T16:04:00Z'));ledger.void(voided.id,new Date('2026-10-17T16:05:00Z'));
 ledger.db.exec("DROP TRIGGER immutable_tx; UPDATE transactions SET business_date='2026-10-17',hour_bucket=9; UPDATE settings SET value='America/Los_Angeles' WHERE key='business_timezone'; PRAGMA user_version=3;");
 const guardLedger=new Ledger(':memory:');const guard=guardLedger.db.prepare("SELECT sql FROM sqlite_master WHERE name='immutable_tx'").get() as {sql:string};ledger.db.exec(guard.sql);guardLedger.close();
 ledger.close();ledger=new Ledger(file);
 try{
  assert.deepEqual(businessTime(new Date('2026-10-17T15:59:59Z')),{date:'2026-10-17',hour:23});assert.deepEqual(businessTime(new Date('2026-10-17T16:00:00Z')),{date:'2026-10-18',hour:0});
  assert.equal(ledger.get(previous.id).business_date,'2026-10-17');assert.equal(ledger.get(sale.id).business_date,'2026-10-18');assert.equal(ledger.get(sale.id).hour_bucket,0);assert.equal(ledger.get(sale.id).created_at,sale.created_at);assert.equal(ledger.get(sale.id).tx_uid,sale.tx_uid);assert.equal(ledger.get(sale.id).subtotal_cents,1000);
  assert.throws(()=>ledger.db.prepare('UPDATE transactions SET hour_bucket=8 WHERE id=?').run(sale.id),/one-way void/);
  const backups=new BackupService(root,process.cwd(),()=>ledger);const safety=backups.list().filter(b=>b.trigger==='pre-timezone-safety');assert.equal(safety.length,1);validateBackup(path.join(root,'backups',safety[0].filename));
  const old=new Database(path.join(root,'backups',safety[0].filename),{readonly:true});assert.equal(old.pragma('user_version',{simple:true}),3);assert.equal((old.prepare('SELECT hour_bucket h FROM transactions WHERE id=?').get(sale.id) as {h:number}).h,9);old.close();
  const now=new Date('2026-10-17T17:00:00Z');
  assert.equal(recommendPreparation(ledger.db,0,now).includesToday,false);
  assert.equal(ledger.dashboard(now).closedOut,false);
  const summary=await createCloseout(ledger,backups,now);assert.equal(summary.date,'2026-10-18');assert.equal(summary.firstSale,sale.created_at);assert.equal(summary.lastSale,sale.created_at);assert.equal(summary.summary.units,4);assert.equal(summary.summary.revenue,800);assert.equal(summary.summary.validTransactions,4);assert.equal(summary.summary.voids,1);assert.equal(summary.summary.giftUnits,2);assert.equal(summary.summary.wasteUnits,1);assert.equal(summary.mirrorStatus,'unconfigured');assert.equal(summary.backup?.trigger,'closeout');
  assert(summary.includedInPreparation);
  assert.equal(ledger.dashboard(now).closedOut,true);
  assert.equal(ledger.dashboard(now).closeoutChanged,false);
  assert.equal(ledger.dashboard(new Date('2026-10-18T16:00:00Z')).closedOut,false);
  assert.equal(recommendPreparation(ledger.db,0,now).products.find(item=>item.id===p.id)?.recommended,3);
  const copy=new Database(path.join(root,'backups',summary.backup!.filename),{readonly:true});
  assert.equal((copy.prepare('SELECT count(*) n FROM transactions').get() as {n:number}).n,6);
  assert(preparationDay(copy,summary.date,now).completed);
  assert.equal(copy.prepare('SELECT value FROM settings WHERE key=?').pluck().get(`closeout:${summary.date}`),'4:1');
  copy.close();
  const afterCloseout=new Date(now.getTime()+1000);
  const lateSale=ledger.record(p,'SCANNER_1',2,'SALE',afterCloseout);
  assert.equal(ledger.dashboard(afterCloseout).closeoutChanged,true);
  assert.equal(recommendPreparation(ledger.db,0,afterCloseout).includesToday,true);
  ledger.void(lateSale.id,afterCloseout);
  assert.equal(ledger.dashboard(afterCloseout).closeoutChanged,true);
  ledger.close();ledger=new Ledger(file);
  assert.equal(ledger.dashboard(afterCloseout).closeoutChanged,true);
  const writeBackup=backups.backup.bind(backups);
  backups.backup=async()=>{throw Error('Synthetic backup failure');};
  assert.equal((await createCloseout(ledger,backups,afterCloseout)).backup,null);
  assert.equal(ledger.dashboard(afterCloseout).closeoutBackupPending,true);
  assert.equal(ledger.dashboard(afterCloseout).closeoutChanged,true);
  backups.backup=writeBackup;
  const updated=await createCloseout(ledger,backups,afterCloseout);
  assert(updated.backup);assert.equal(updated.summary.voids,2);
  assert.equal(ledger.dashboard(afterCloseout).closeoutChanged,false);
  ledger.void(sale.id,afterCloseout);
  assert.equal(ledger.dashboard(afterCloseout).closeoutChanged,true);
  const nextMorning=new Date('2026-10-18T16:00:00Z');
  assert.equal(ledger.dashboard(nextMorning).closeoutChanged,false);
  assert.equal(ledger.dashboard(nextMorning).yesterdayUnfinished,true);
  const yesterday=await createCloseout(ledger,backups,nextMorning,summary.date);
  assert(yesterday.backup);assert.equal(yesterday.summary.voids,3);
  assert.equal(ledger.dashboard(nextMorning).yesterdayUnfinished,false);
  assert.equal(ledger.dashboard(nextMorning).closedOut,false);
  await assert.rejects(()=>createCloseout(ledger,backups,nextMorning,'2026-10-20'),/今天或昨天/);
  await backups.restore(updated.backup.filename,next=>{ledger=next;});
  assert.equal(ledger.dashboard(afterCloseout).closeoutChanged,false);
  savePreparationDay(ledger.db,{date:summary.date,status:'open',completed:false,products:[{productId:p.id,prepared:8,remaining:3,stockout:false}]},now);
  const mirror=path.join(root,'usb');fs.mkdirSync(mirror);backups.setMirror(mirror);const mirrored=await createCloseout(ledger,backups,now);assert.equal(mirrored.mirrorStatus,'success');assert(fs.existsSync(path.join(mirror,mirrored.backup!.filename)));fs.rmSync(mirror,{recursive:true});const missing=await createCloseout(ledger,backups,now);assert.equal(missing.mirrorStatus,'failed');assert(missing.backup);assert(!fs.existsSync(mirror));backups.setMirror('');
  const completedDay=preparationDay(ledger.db,summary.date,now);
  assert(completedDay.completed);assert.equal(completedDay.status,'open');assert.equal(completedDay.products.find(row=>row.productId===p.id)?.remaining,3);
  savePreparationDay(ledger.db,{date:summary.date,status:'closed',completed:false,products:[]},now);
  assert.equal((await createCloseout(ledger,backups,now)).includedInPreparation,false);
  assert.equal(recommendPreparation(ledger.db,0,now).includesToday,false);
  const exporter=new CSVService(root,process.cwd(),()=>ledger);const csv=fs.readFileSync(await exporter.export('transactions',{start:'2026-10-18',end:'2026-10-18'}),'utf8');assert(csv.includes('Timestamp Taipei'));assert(csv.includes('2026-10-18T00:00:00.000+08:00'));assert(!csv.includes('Timestamp UTC'));
  // Reopen is idempotent: no second migration backup.
  ledger.close();ledger=new Ledger(file);assert.equal(backups.list().filter(b=>b.trigger==='pre-timezone-safety').length,1);
  await backups.restore(safety[0].filename,next=>{ledger=next;});assert.equal(ledger.get(sale.id).business_date,'2026-10-18');assert.equal(ledger.get(sale.id).hour_bucket,0);
  const originalBackup=backups.backup.bind(backups);backups.backup=async()=>{throw Error('Synthetic disk failure');};const failed=await createCloseout(ledger,backups,now);assert.equal(failed.summary.units,4);assert.equal(failed.backup,null);assert(failed.backupError?.includes('操作未完成'));backups.backup=originalBackup;
  const memory=new Ledger(':memory:');let tick=now.getTime();const events:EngineEvent[]=[];const engine=new ScannerEngine(memory,e=>events.push(e),()=>tick);
  try{
   assert.equal(engine.debounceMs,0);assert(engine.scan('SCANNER_1','B001'));assert(engine.scan('SCANNER_1','B001'));
   engine.setDebounce(250);assert(engine.scan('SCANNER_1',' b001 '));tick+=100;assert.equal(engine.scan('SCANNER_1','B001'),undefined);assert.equal(events.at(-1)?.code,'SCAN_DUPLICATE_IGNORED');assert(engine.scan('SCANNER_2','B001'));
   tick+=150;assert(engine.scan('SCANNER_1','B001')); // accepted at exact 250 ms boundary
   engine.scan('SCANNER_1','MUL-05');tick+=1;engine.scan('SCANNER_1','MUL-05');assert.equal(events.at(-1)?.code,'SCAN_DUPLICATE_IGNORED');assert.equal(engine.states.SCANNER_1.multiplier,5);assert.equal(engine.scan('SCANNER_1','B001')?.quantity,5);
   engine.scan('SCANNER_1','ACT-UNDO');const n=memory.today(now).summary.voids;tick+=10;engine.scan('SCANNER_1','ACT-UNDO');assert.equal(memory.today(now).summary.voids,n);
   assert(engine.dualFire().passed);engine.setDebounce(0);assert(engine.scan('SCANNER_1','B001'));assert(engine.scan('SCANNER_1','B001'));for(const bad of [-1,1,49,1001,1.5,NaN,'250'])assert.throws(()=>engine.setDebounce(bad as number));
   engine.setDebounce(350);const replacement=new ScannerEngine(memory,()=>{});assert.equal(replacement.debounceMs,350);replacement.close();
   engine.scan('SCANNER_1','MUL-03');
   memory.db.exec("CREATE TRIGGER test_scan_failure BEFORE INSERT ON transactions BEGIN SELECT RAISE(ABORT,'test scan failure'); END");
   assert.throws(()=>engine.scan('SCANNER_1','B001'),/test scan failure/);
   assert.equal(engine.states.SCANNER_1.multiplier,3);
   memory.db.exec('DROP TRIGGER test_scan_failure');
   assert.equal(engine.scan('SCANNER_1','B001')?.quantity,3);
   assert.equal(engine.scan('SCANNER_1','B001'),undefined);

   const diagnostics:unknown[]=[];
   const detached=new ScannerEngine(memory,()=>{throw Error('renderer unavailable');},()=>tick,(_,error)=>diagnostics.push(error));
   try{
    detached.scan('KEYBOARD','MUL-05');
    const committed=detached.scan('KEYBOARD','B001');
    assert.equal(committed?.quantity,5);
    assert.equal(detached.states.KEYBOARD.multiplier,1);
    assert.equal(diagnostics.length,2);
   }finally{detached.close();}
  }finally{engine.close();memory.close();}
  console.log('PASS closeout: Taipei migration/safety/idempotence, midnight buckets, full closeout backup and USB fallback, CNY/Taipei CSV, per-scanner debounce/controls/boundary/settings.');
 }finally{if(ledger.db.open)ledger.close();}
}
test().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
