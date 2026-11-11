import {readableError} from './errors';
import {ledgerPath} from './ledger-path';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {businessTime,Ledger} from './database';
import {contained,durableJSON,syncFile,syncDirectory} from './paths';
import {accessibleMirror,configuredMirror,saveMirror} from './mirror';
import type {BackupEntry,BackupTrigger,SystemInfo} from './types';
import {saveCloseoutCheckpoint,type CloseoutCheckpoint} from './closeout-checkpoint';
const automatic=new Set<BackupTrigger>(['startup','auto-100','shutdown']);
const pattern=/^(\d{13})_(startup|auto-100|manual|shutdown|pre-restore-safety|pre-clear-safety|pre-demo-safety|pre-timezone-safety|closeout)_([a-f0-9-]+)\.db$/;
/** Completed snapshots use rollback-journal mode so each backup is a standalone file. */
export function sealSnapshot(file:string,closeout?:CloseoutCheckpoint){
 const snapshot=new Database(file,{fileMustExist:true});
 try{
  snapshot.pragma('journal_mode = DELETE');
  if(closeout)saveCloseoutCheckpoint(snapshot,closeout);
 }finally{snapshot.close();}
}
export function validateBackup(file:string){
 const db=new Database(file,{readonly:true,fileMustExist:true});
 try{
  if(db.pragma('integrity_check',{simple:true})!=='ok')throw Error('备份完整性检查未通过，请选择其他备份。');
  if((db.pragma('foreign_key_check') as unknown[]).length)throw Error('备份中的商品关联已损坏，请选择其他备份。');
  for(const [table,columns] of Object.entries({products:['id','sku','name','category','price_cents','is_active','sort_order','created_at','updated_at'],transactions:['id','tx_uid','scanner_id','product_id','sku_snapshot','name_snapshot','category_snapshot','unit_price_cents_snapshot','quantity','tx_type','subtotal_cents','item_value_cents','is_voided','voided_at','created_at','business_date','hour_bucket'],settings:['key','value']})){
   if(!(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)))throw Error('这个文件不是有效的本程序账本备份。');
   const found=(db.pragma(`table_info(${table})`) as {name:string}[]).map(c=>c.name);if(columns.some(c=>!found.includes(c)))throw Error('备份格式不兼容，请选择其他备份或升级程序。');
  }
  const references=db.pragma('foreign_key_list(transactions)') as {table:string;from:string;to:string}[];if(!references.some(r=>r.table==='products'&&r.from==='product_id'&&r.to==='id'))throw Error('备份缺少商品关联保护，不能恢复，请选择其他备份。');
  for(const trigger of ['immutable_tx','no_tx_delete'])if(!db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger))throw Error('备份缺少流水保护，不能恢复，请选择其他备份。');
  const version=Number(db.pragma('user_version',{simple:true}));
  if(version>5)throw Error('备份由更新版本的程序创建，请先升级程序。');
  if(version>=5)for(const [table,columns] of Object.entries({preparation_days:['business_date','status','completed','updated_at'],preparation_items:['business_date','product_id','stockout','prepared','remaining','updated_at']})){
   const found=(db.pragma(`table_info(${table})`) as {name:string}[]).map(c=>c.name);if(columns.some(c=>!found.includes(c)))throw Error('备份缺少完整的备货记录，不能恢复，请选择其他备份。');
  }
 }finally{db.close();}
}
/** Incomplete restore always rolls back before the application opens SQLite. */
export function recoverInterruptedRestore(runtimeRoot:string){
 const journal=path.join(runtimeRoot,'restore-intent.json');if(!fs.existsSync(journal))return;
 const intent=JSON.parse(fs.readFileSync(journal,'utf8')) as {database?:string};
 const main=intent.database==='db/ledger.db'?ledgerPath(runtimeRoot):path.join(runtimeRoot,'steamlog.sqlite3'),rollback=path.join(runtimeRoot,'restore-rollback.db'),stage=path.join(runtimeRoot,'restore-staged.db');
 if(fs.existsSync(rollback)){validateBackup(rollback);for(const suffix of ['','-wal','-shm'])fs.rmSync(main+suffix,{force:true});fs.renameSync(rollback,main);}
 else if(!fs.existsSync(main))throw Error('恢复操作未完成且找不到账本，请联系家人使用恢复前的安全备份。');
 syncDirectory(path.dirname(main));syncDirectory(runtimeRoot);fs.rmSync(stage,{force:true});fs.rmSync(journal,{force:true});syncDirectory(runtimeRoot);
}
export class BackupService {
 private tail:Promise<unknown>=Promise.resolve();private pending=0;private lastAutoCounter=0;
 backupError:string|null=null;mirrorError:string|null=null;lastBackup:string|null=null;maintenance=false;integrity='尚未校验';
 readonly directory:string;
 constructor(readonly runtimeRoot:string,readonly projectRoot:string,private getLedger:()=>Ledger,private changed:()=>void=()=>{}){this.directory=contained(projectRoot,path.join(runtimeRoot,'backups'));this.resetCounter();}
 private setting(key:string){return (this.getLedger().db.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value:string}|undefined)?.value??'';}
 list():BackupEntry[]{
  const directory=contained(this.projectRoot,this.directory);
  let filenames:string[];
  try{filenames=fs.readdirSync(directory);}
  catch(error){if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))return [];throw error;}
  return filenames.flatMap(filename=>{
   const match=pattern.exec(filename);
   if(!match)return [];
   const stat=fs.lstatSync(path.join(directory,filename),{throwIfNoEntry:false});
   return stat?.isFile()?[{filename,createdAt:new Date(Number(match[1])).toISOString(),size:stat.size,trigger:match[2] as BackupTrigger}]:[];
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.filename.localeCompare(a.filename));
 }
 info():SystemInfo {const ledger=this.getLedger(),backups=this.list();return {runtimeRoot:this.runtimeRoot,databasePath:ledger.db.name,backups,mirrorPath:this.mirrorPath(),mirrorError:this.mirrorError,backupError:this.backupError,lastBackup:this.lastBackup??backups[0]?.createdAt??null,busy:this.pending>0,maintenance:this.maintenance,transactionCount:(ledger.db.prepare('SELECT count(*) n FROM transactions').get() as {n:number}).n,demoSeeded:this.setting('demo_seeded')==='1',integrity:this.integrity,debounceMs:Number(this.setting('scan_debounce_ms'))||0,schemaVersion:Number(ledger.db.pragma('user_version',{simple:true}))};}
 private mirrorPath(){try{return configuredMirror(this.runtimeRoot)?.folder??'';}catch(error){this.mirrorError=readableError(error);return '';}}
 setMirror(folder:string){saveMirror(this.runtimeRoot,this.projectRoot,folder);this.mirrorError=null;this.changed();}
 backup(trigger:BackupTrigger,closeout?:CloseoutCheckpoint):Promise<BackupEntry>{
  this.pending++;
  const operation=this.tail.then(()=>this.perform(trigger,closeout)).finally(()=>{this.pending--;this.changed();});
  this.tail=operation.catch(()=>{});
  this.changed();
  return operation;
 }
 private async perform(trigger:BackupTrigger,closeout?:CloseoutCheckpoint){
  const filename=`${Date.now()}_${trigger}_${randomUUID()}.db`,file=contained(this.projectRoot,path.join(this.directory,filename)),partial=file+'.partial';
  try{
   fs.mkdirSync(path.dirname(file),{recursive:true});
   await this.getLedger().db.backup(partial);sealSnapshot(partial,closeout);validateBackup(partial);syncFile(partial);fs.renameSync(partial,file);syncDirectory(this.directory);
   this.integrity='ok';this.lastBackup=new Date().toISOString();this.backupError=null;
   this.mirrorError=null;
   try{const config=configuredMirror(this.runtimeRoot);if(config){const folder=accessibleMirror(config),destination=path.join(folder,filename);await fs.promises.copyFile(file,destination+'.partial',fs.constants.COPYFILE_EXCL);syncFile(destination+'.partial');accessibleMirror(config);fs.renameSync(destination+'.partial',destination);}}
   catch(error){this.mirrorError=readableError(error);}

   const saved=this.list();
   const entry=saved.find(e=>e.filename===filename);
   if(!entry)throw Error('刚创建的备份已不在备份目录，请检查文件夹后重试。');
   const old=saved.filter(e=>automatic.has(e.trigger)&&e.filename!==filename).slice(automatic.has(trigger)?39:40);
   for(const expired of old)fs.rmSync(path.join(this.directory,expired.filename),{force:true});
   return entry;
  }catch(error){
   this.backupError=readableError(error);
   try{fs.rmSync(partial,{force:true});}catch{/* Preserve the original backup error. */}
   throw error;
  }
 }
 async startup(now=new Date()){const today=businessTime(now).date;let valid=false;for(const entry of this.list().filter(e=>businessTime(new Date(e.createdAt)).date===today))try{validateBackup(path.join(this.directory,entry.filename));valid=true;this.integrity='ok';break;}catch{}if(!valid)await this.backup('startup');}
 resetCounter(){this.lastAutoCounter=Math.floor(Number(this.setting('recorded_total'))/100)*100;}
 recorded(now=new Date()){const total=Number(this.setting('recorded_total'));const hour=businessTime(now).hour;if(total>this.lastAutoCounter&&total%100===0&&hour>=5&&hour<=19){this.lastAutoCounter=total;void this.backup('auto-100').catch(()=>{});}}
 async idle(){await this.tail;}
 async restore(filename:string,replace:(ledger:Ledger)=>void){
  if(typeof filename!=='string'||path.basename(filename)!==filename||!this.list().some(e=>e.filename===filename))throw Error('请从本机历史备份列表中选择一个备份。');
  const source=contained(this.projectRoot,path.join(this.directory,filename));validateBackup(source);
  const main=ledgerPath(this.runtimeRoot),stage=path.join(this.runtimeRoot,'restore-staged.db'),rollback=path.join(this.runtimeRoot,'restore-rollback.db'),journal=path.join(this.runtimeRoot,'restore-intent.json');
  // Pin the selected immutable snapshot before queued automatic pruning can run.
  const old=this.getLedger();
  try{
   fs.copyFileSync(source,stage);sealSnapshot(stage);syncFile(stage);validateBackup(stage);
   await this.backup('pre-restore-safety');await this.idle();
   const checkpoint=old.db.pragma('wal_checkpoint(TRUNCATE)') as {busy:number}[];
   if(checkpoint.some(row=>row.busy))throw Error('账本正在使用中，请关闭其他读取账本的程序后重试恢复。');
   old.close();
  }catch(error){fs.rmSync(stage,{force:true});throw error;}
  let next:Ledger|undefined;
  try{
   durableJSON(journal,{operation:'restore',source:filename,database:'db/ledger.db'});fs.renameSync(main,rollback);fs.renameSync(stage,main);syncDirectory(path.dirname(main));syncDirectory(this.runtimeRoot);
   next=new Ledger(main);validateBackup(main);
   replace(next);fs.rmSync(rollback,{force:true});fs.rmSync(journal,{force:true});syncDirectory(path.dirname(main));syncDirectory(this.runtimeRoot);this.integrity='ok';
  }catch(error){
   if(next?.db.open)next.close();
   if(fs.existsSync(rollback)){for(const suffix of ['','-wal','-shm'])fs.rmSync(main+suffix,{force:true});fs.renameSync(rollback,main);}
   replace(new Ledger(main));fs.rmSync(stage,{force:true});fs.rmSync(journal,{force:true});syncDirectory(path.dirname(main));syncDirectory(this.runtimeRoot);throw error;
  }
  this.changed();
 }
}
