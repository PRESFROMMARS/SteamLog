import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {contained,durableJSON,syncDirectory,syncFile} from './paths';
export const ledgerPath=(root:string)=>path.join(root,'db','ledger.db');
/** Run only after the single-instance lock. A durable checkpoint precedes the atomic move. */
export function migrateLegacyLedger(root:string,project:string){
 const destination=contained(project,ledgerPath(root)),legacy=contained(project,path.join(root,'steamlog.sqlite3'));
 const journal=contained(project,path.join(root,'ledger-migration.json'));
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 if(fs.existsSync(journal)){
  if(fs.existsSync(destination)&&!fs.existsSync(legacy)){fs.rmSync(journal);syncDirectory(root);return;}
  if(fs.existsSync(destination)&&fs.existsSync(legacy))throw Error('发现两份旧账本，无法确定应使用哪份。原文件均已保留，请联系家人检查。');
  for(const suffix of ['-wal','-shm'])if(fs.existsSync(destination+suffix)&&!fs.existsSync(legacy+suffix))fs.renameSync(destination+suffix,legacy+suffix);
 }
 if(fs.existsSync(destination)||!fs.existsSync(legacy))return;
 // A corrupt legacy file is moved with its WAL so the normal recovery flow can preserve it.
 try{const db=new Database(legacy,{fileMustExist:true});try{const result=db.pragma('wal_checkpoint(TRUNCATE)') as {busy:number}[];if(result.some(r=>r.busy))throw Error('旧账本正在使用，请先关闭旧版程序。');}finally{db.close();}}
 catch(error){if(String(error).includes('正在使用')||String(error).includes('locked'))throw error;}
 durableJSON(journal,{operation:'legacy-to-db'});
 for(const suffix of ['-wal','-shm'])if(fs.existsSync(legacy+suffix)){fs.renameSync(legacy+suffix,destination+suffix);}
 syncFile(legacy);fs.renameSync(legacy,destination);syncDirectory(path.dirname(destination));syncDirectory(root);fs.rmSync(journal);syncDirectory(root);
}
