import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Ledger} from './database';
import {ScannerEngine} from './engine';
import {ForegroundScanGuard,HardwareChannels,parseRawPacket,type RawScan} from './raw-input';
import {WinRawScannerService} from './win-raw-scanner';
import {ledgerPath,migrateLegacyLedger} from './ledger-path';
import {recoverInterruptedRestore,validateBackup} from './backup';
import {errorLogger,RecoverySchedule} from './reliability';
import type {GunId} from './types';
const root=path.resolve('.cache',`phase4-tests-${process.pid}`);fs.mkdirSync(root,{recursive:true});
let db:Ledger|undefined;
async function test(){
 const legacy=path.join(root,'steamlog.sqlite3');db=new Ledger(legacy);db.record(db.product('B001')!,'SCANNER_1',3,'SALE',new Date());db.close();migrateLegacyLedger(root,process.cwd());assert(!fs.existsSync(legacy));db=new Ledger(ledgerPath(root));assert.equal((db.db.prepare('SELECT quantity FROM transactions').get() as {quantity:number}).quantity,3);assert.equal(db.db.pragma('journal_mode',{simple:true}),'wal');db.close();migrateLegacyLedger(root,process.cwd());validateBackup(ledgerPath(root));
 // Phase 3 restore-intent compatibility before the portable-path migration.
 const oldRoot=path.join(root,'old-restore');fs.mkdirSync(oldRoot);let old=new Ledger(path.join(oldRoot,'steamlog.sqlite3'));old.close();fs.renameSync(path.join(oldRoot,'steamlog.sqlite3'),path.join(oldRoot,'restore-rollback.db'));fs.writeFileSync(path.join(oldRoot,'restore-intent.json'),'{}');recoverInterruptedRestore(oldRoot);migrateLegacyLedger(oldRoot,process.cwd());validateBackup(ledgerPath(oldRoot));
 db=new Ledger(ledgerPath(root));let notifications=0;const store={get:(key:string)=>(db!.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value:string}|undefined)?.value??'',save:(values:Record<string,string>)=>db!.db.transaction(()=>{for(const [key,value] of Object.entries(values))db!.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);})()};
 let clock=1000;const channels=new HardwareChannels(store,()=>notifications++,()=>clock);const engine=new ScannerEngine(db,()=>{});
 const packet=(device:number,barcode:string,handle=device):RawScan=>({type:'scan',hDevice:'0x'+handle.toString(16),deviceName:'\\\\?\\HID#VID_1234&PID_5678#SERIAL_'+device,barcode,burstMs:18,ts:Date.now()});
 const route=(p:RawScan)=>{const decoded=parseRawPacket(JSON.stringify(p));assert.equal(decoded.type,'scan');const result=channels.receive(decoded as RawScan);if(result.channel&&!result.calibrated)engine.scan(result.channel,p.barcode);return result;};
 route(packet(1,'MUL-05'));route(packet(2,'S001'));route(packet(1,'B001'));
 const rows=db.db.prepare('SELECT scanner_id,sku_snapshot,quantity FROM transactions ORDER BY id DESC LIMIT 2').all() as {scanner_id:string;sku_snapshot:string;quantity:number}[];assert.deepEqual(rows,[{scanner_id:'SCANNER_1',sku_snapshot:'B001',quantity:5},{scanner_id:'SCANNER_2',sku_snapshot:'S001',quantity:1}]);
 const count=()=>Number((db!.db.prepare('SELECT count(*) n FROM transactions').get() as {n:number}).n);const before=count();route(packet(3,'B001'));assert.equal(count(),before);assert.equal(channels.list().find(d=>d.deviceName.endsWith('_3'))!.channel,null);
 channels.calibrate('SCANNER_1');assert(route(packet(2,'B001')).calibrated);assert.equal(count(),before);assert(channels.mappings().SCANNER_1.endsWith('_2'));assert(channels.mappings().SCANNER_2.endsWith('_1'));
 channels.swap();assert(channels.mappings().SCANNER_1.endsWith('_1'));channels.calibrate('SCANNER_2');clock+=30001;channels.expire();assert.equal(channels.calibrating,null);
 const restarted=new HardwareChannels(store,()=>{});assert.equal(restarted.list().length,3);assert(restarted.list().every(d=>!d.connected));assert.equal(restarted.receive(packet(1,'B001',999)).channel,'SCANNER_1');assert.equal(restarted.list()[0].hDevice,'0x3e7');restarted.remove(packet(1,'').deviceName,'0x3e7');assert.equal(restarted.list()[0].connected,false);assert(notifications>0);
 for(const line of ['null','{}',JSON.stringify({...packet(1,'B001'),burstMs:-1}),JSON.stringify({...packet(1,'B001'),barcode:'A'.repeat(129)}),JSON.stringify({...packet(1,'B001'),deviceName:'not hardware'})])assert.throws(()=>parseRawPacket(line));
 assert.deepEqual(parseRawPacket('{"type":"ready","platform":"win32-raw-input"}'),{type:'ready'});assert.deepEqual(parseRawPacket('{"type":"heartbeat"}'),{type:'heartbeat'});
 const guard=new ForegroundScanGuard();let delivered=0;guard.raw('B001');await guard.foreground('KEYBOARD','b001',true,()=>{delivered++;});assert.equal(delivered,0);
 const waiting=guard.foreground('KEYBOARD','S001',true,()=>{delivered++;});guard.raw('S001');await waiting;assert.equal(delivered,0);
 const formEntry=guard.foreground('SCANNER_1','B002',true,()=>{delivered++;},true);guard.raw('B002');await formEntry;assert.equal(delivered,0);
 await guard.foreground('KEYBOARD','D001',true,()=>{delivered++;});await guard.foreground('SCANNER_1','B001',true,()=>{delivered++;});await guard.foreground('KEYBOARD','B001',false,()=>{delivered++;});assert.equal(delivered,3);await guard.idle();
 if(process.platform!=='win32'){const service=new WinRawScannerService(root,process.cwd(),'missing-source.cs',store,()=>assert.fail('Mac must not spawn helper'),()=>{},()=>{},()=>{});service.start();assert.equal(service.info().active,false);assert.equal(service.info().state,'standard');assert.throws(()=>service.calibrate('SCANNER_1'));service.stop();assert(!fs.existsSync(path.join(root,'bin')));}
 const schedule=new RecoverySchedule();assert.deepEqual([schedule.next(1000),schedule.next(2000),schedule.next(3000)],[500,1000,2000]);for(let i=0;i<20;i++)assert(schedule.next(4000+i)<=30000);assert.equal(schedule.next(100000),500);
 const log=errorLogger(root);log('test',Error('local error'));assert(fs.readFileSync(path.join(root,'logs','error.log'),'utf8').includes('local error'));fs.writeFileSync(path.join(root,'logs','error.log'),'x'.repeat(2*1024*1024+1));log('rotate','ok');assert(fs.existsSync(path.join(root,'logs','error.log.1')));
 const builder=JSON.parse(fs.readFileSync('electron-builder.json','utf8'));assert.equal(builder.appId,'com.steamlog.ledger');assert.equal(builder.productName,'SteamLog');assert.equal(builder.npmRebuild,false);assert.equal(builder.win.target[0].target,'dir');assert.equal(builder.extraResources[0].to,'win-raw-scanner/RawScannerListener.cs');
 const {assertPE,safeOutput}=require(path.resolve('scripts/pack-win.cjs')) as {assertPE:(f:string)=>void;safeOutput:(f:string)=>void};safeOutput(path.join(root,'build'));fs.mkdirSync(path.join(root,'build','data'),{recursive:true});assert.throws(()=>safeOutput(path.join(root,'build')),/runtime data/);const fake=path.join(root,'fake.node');fs.writeFileSync(fake,Buffer.alloc(128));assert.throws(()=>assertPE(fake));const pe=Buffer.alloc(128);pe.write('MZ');pe.writeUInt32LE(64,0x3c);pe.write('PE\0\0',64);pe.writeUInt16LE(0x8664,68);fs.writeFileSync(fake,pe);assertPE(fake);pe.writeUInt16LE(0xAA64,68);fs.writeFileSync(fake,pe);assert.throws(()=>assertPE(fake));
 engine.close();db.close();db=undefined;
 console.log('PASS Phase 4: portable DB migration / legacy restore, persistent per-device channels, same-tick isolation, calibration consumption / swap / expiry, unassigned devices, packet validation, both-order duplicate suppression, Mac helper skip, recovery backoff, local log rotation, Windows PE / x64 packaging guards.');
}
test().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(db?.db.open)db.close();fs.rmSync(root,{recursive:true,force:true});});
