import {readableError} from './errors';
import {ledgerPath} from './ledger-path';
import fs from 'node:fs';
import path from 'node:path';
import {Ledger} from './database';
import {sealSnapshot,validateBackup} from './backup';
import {contained,syncFile} from './paths';
/** Recovery UI is available even if SQLite cannot open the live file. */
export async function openWithRecovery(runtimeRoot:string,projectRoot:string,choose:(details:string)=>Promise<boolean>){
 const main=contained(projectRoot,ledgerPath(runtimeRoot));
 fs.mkdirSync(path.dirname(main),{recursive:true});
 const directory=path.join(runtimeRoot,'backups');const candidates=fs.existsSync(directory)?fs.readdirSync(directory).filter(n=>/^\d{13}_[a-z0-9-]+_[a-f0-9-]+\.db$/.test(n)).sort().reverse():[];
 try{if((!fs.existsSync(main)||fs.statSync(main).size===0)&&candidates.length)throw Error('当前账本缺失或为空，但找到了历史备份。');return new Ledger(main);}catch(original){
  let source:string|undefined;
  for(const name of candidates){try{const candidate=contained(projectRoot,path.join(directory,name));validateBackup(candidate);source=candidate;break;}catch{}}
  if(!source)throw Error(`当前账本无法打开，也没有找到可用的已校验备份。原文件已保留。${readableError(original)}`);
  if(!await choose(`当前账本无法打开。\n${readableError(original)}\n\n是否从已校验的备份 ${path.basename(source)} 恢复？\n程序会先把无法读取的账本及附属文件保存在本机 recovery-quarantine 文件夹。备份之后尚未保存的流水可能无法找回。`))throw Error('已取消恢复，原账本文件保持不变。');
  const quarantine=contained(projectRoot,path.join(runtimeRoot,'recovery-quarantine',String(Date.now())));fs.mkdirSync(quarantine,{recursive:true});
  for(const suffix of ['','-wal','-shm'])if(fs.existsSync(main+suffix)){const target=path.join(quarantine,'ledger.db'+suffix);fs.copyFileSync(main+suffix,target);syncFile(target);}
  const stage=contained(projectRoot,path.join(runtimeRoot,'startup-recovery.db'));fs.copyFileSync(source,stage);sealSnapshot(stage);syncFile(stage);validateBackup(stage);
  for(const suffix of ['-wal','-shm'])fs.rmSync(main+suffix,{force:true});fs.renameSync(stage,main);return new Ledger(main);
 }
}
