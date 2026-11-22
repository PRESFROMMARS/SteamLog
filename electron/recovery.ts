import {readableError} from './errors';
import {ledgerPath} from './ledger-path';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {Ledger,LedgerUpgradeBackupError,LedgerVersionError} from './database';
import {sealSnapshot,validateBackup} from './backup';
import {contained,syncFile} from './paths';

function checkExistingLedger(file:string){
 if(fs.statSync(file).size===0)throw Error('当前账本文件为空。');
 const db=new Database(file,{readonly:true,fileMustExist:true});
 try{
  const schema=db.prepare("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('products','transactions','settings')").pluck().get();
  if(schema!==3)throw Error('当前文件缺少 SteamLog 账本的核心数据表。');
 }finally{db.close();}
}

/** Recovery UI is available even if SQLite cannot open the live file. */
export async function openWithRecovery(runtimeRoot:string,projectRoot:string,choose:(details:string)=>Promise<boolean>){
 const main=contained(projectRoot,ledgerPath(runtimeRoot));
 fs.mkdirSync(path.dirname(main),{recursive:true});
 const directory=path.join(runtimeRoot,'backups');
 const legacy=path.join(runtimeRoot,'steamlog.sqlite3');
 let candidates:string[]|undefined;
 const availableBackups=()=>candidates??=(fs.existsSync(directory)?fs.readdirSync(directory).filter(n=>/^\d{13}_[a-z0-9-]+_[a-f0-9-]+\.db$/.test(n)).sort().reverse():[]);
 try{
  if(fs.existsSync(main))checkExistingLedger(main);
  else if([main,legacy].some(file=>fs.existsSync(file+'-wal')||fs.existsSync(file+'-shm'))||fs.existsSync(path.join(runtimeRoot,'ledger-migration.json'))||availableBackups().length)
   throw Error('当前账本缺失，发现历史备份或未合并的账本文件。');
  return new Ledger(main);
 }catch(original){
  const code=(original as NodeJS.ErrnoException).code??'';
  if(original instanceof LedgerVersionError||original instanceof LedgerUpgradeBackupError||/^(?:SQLITE_(?:BUSY|LOCKED|READONLY|CANTOPEN|FULL|IOERR)(?:_|$)|EACCES$|EPERM$|ENOSPC$|EROFS$)/.test(code))throw original;
  let source:string|undefined;
  for(const name of availableBackups()){try{const candidate=contained(projectRoot,path.join(directory,name));validateBackup(candidate);source=candidate;break;}catch{}}
  if(!source)throw Error(`当前账本无法打开，也没有找到可用的已校验备份。原文件已保留。${readableError(original)}`);
  if(!await choose(`当前账本无法打开。\n${readableError(original)}\n\n是否从已校验的备份 ${path.basename(source)} 恢复？\n程序会先把无法读取的账本及附属文件保存在本机 recovery-quarantine 文件夹。备份之后尚未保存的流水可能无法找回。`))throw Error('已取消恢复，原账本文件保持不变。');
  const quarantine=contained(projectRoot,path.join(runtimeRoot,'recovery-quarantine',String(Date.now())));fs.mkdirSync(quarantine,{recursive:true});
  for(const suffix of ['','-wal','-shm'])if(fs.existsSync(main+suffix)){const target=path.join(quarantine,'ledger.db'+suffix);fs.copyFileSync(main+suffix,target);syncFile(target);}
  for(const suffix of ['-wal','-shm'])if(!fs.existsSync(legacy)&&fs.existsSync(legacy+suffix)){const target=path.join(quarantine,'steamlog.sqlite3'+suffix);fs.copyFileSync(legacy+suffix,target);syncFile(target);}
  const stage=contained(projectRoot,path.join(runtimeRoot,'startup-recovery.db'));fs.copyFileSync(source,stage);sealSnapshot(stage);syncFile(stage);validateBackup(stage);
  for(const suffix of ['-wal','-shm'])fs.rmSync(main+suffix,{force:true});fs.renameSync(stage,main);return new Ledger(main);
 }
}
