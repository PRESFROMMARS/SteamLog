import {readableError} from './errors';
import type {Ledger} from './database';
import type {BackupService} from './backup';
import type {CloseoutResult} from './types';
import {businessTime} from './time';
import {queryHistory} from './analytics';
/** Caller holds the maintenance gate so summary and full backup share one cutoff. */
export async function createCloseout(ledger:Ledger,backups:BackupService,now=new Date()):Promise<CloseoutResult>{
 const date=businessTime(now).date;
 const summary=queryHistory(ledger.db,{start:date,end:date,granularity:'daily'}).summary;
 const bounds=ledger.db.prepare("SELECT min(created_at) firstSale,max(created_at) lastSale FROM transactions WHERE business_date=? AND is_voided=0 AND tx_type='SALE'").get(date) as {firstSale:string|null;lastSale:string|null};
 let backup:CloseoutResult['backup']=null,backupError:string|null=null;
 try{backup=await backups.backup('closeout');}catch(error){backupError=readableError(error);}
 const info=backups.info();
 return {date,generatedAt:now.toISOString(),...bounds,summary,backup,backupError,mirrorStatus:!info.mirrorPath?'unconfigured':info.mirrorError||!backup?'failed':'success',mirrorError:info.mirrorError};
}
