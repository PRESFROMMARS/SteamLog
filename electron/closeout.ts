import {readableError} from './errors';
import type {Ledger} from './database';
import type {BackupService} from './backup';
import type {CloseoutResult} from './types';
import {businessTime} from './time';
import {queryRangeSummary} from './analytics';
import {completePreparationForCloseout} from './preparation-records';
import {beginCloseout,saveCloseoutCheckpoint} from './closeout-checkpoint';
import {addDays} from './ranges';
/** Caller holds the maintenance gate so summary and full backup share one cutoff. */
export async function createCloseout(ledger:Ledger,backups:BackupService,now=new Date(),date=businessTime(now).date):Promise<CloseoutResult>{
 const today=businessTime(now).date;
 if(date!==today&&date!==addDays(today,-1))throw Error('请选择台北时间的今天或昨天重新日结。');
 const summary=queryRangeSummary(ledger.db,{start:date,end:date});
 const bounds=ledger.db.prepare("SELECT min(created_at) firstSale,max(created_at) lastSale FROM transactions WHERE business_date=? AND is_voided=0 AND tx_type='SALE'").get(date) as {firstSale:string|null;lastSale:string|null};
 const checkpoint={date,validTransactions:summary.validTransactions,voids:summary.voids};
 const includedInPreparation=ledger.db.transaction(()=>{
  beginCloseout(ledger.db,checkpoint);
  return completePreparationForCloseout(ledger.db,date,now);
 })();
 let backup:CloseoutResult['backup']=null,backupError:string|null=null;
 try{
  backup=await backups.backup('closeout',checkpoint);
  saveCloseoutCheckpoint(ledger.db,checkpoint);
 }catch(error){backupError=readableError(error);backup=null;}
 const info=backups.info();
 return {date,generatedAt:now.toISOString(),...bounds,summary,includedInPreparation,backup,backupError,mirrorStatus:!info.mirrorPath?'unconfigured':info.mirrorError||!backup?'failed':'success',mirrorError:info.mirrorError};
}
