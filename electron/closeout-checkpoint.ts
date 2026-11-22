import type Database from 'better-sqlite3';
import type {RangeSummary} from './types';

export type CloseoutCheckpoint = Pick<RangeSummary,'validTransactions'|'voids'> & {date:string};

// Ledger rows are append-only and each row can be voided once. These two counts detect either change.
const key = ({date}:CloseoutCheckpoint) => `closeout:${date}`;
const counts = ({validTransactions,voids}:CloseoutCheckpoint) => `${validTransactions}:${voids}`;

export function saveCloseoutCheckpoint(db:Database.Database,checkpoint:CloseoutCheckpoint){
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
  .run(key(checkpoint),counts(checkpoint));
}

export function beginCloseout(db:Database.Database,checkpoint:CloseoutCheckpoint){
 db.prepare(`INSERT INTO settings(key,value) VALUES(?,'pending')
  ON CONFLICT(key) DO UPDATE SET value='pending:' || settings.value
  WHERE settings.value NOT LIKE 'pending%'`).run(key(checkpoint));
}

export function closeoutCheckpointStatus(db:Database.Database,checkpoint:CloseoutCheckpoint){
 const saved=db.prepare('SELECT value FROM settings WHERE key=?').pluck().get(key(checkpoint)) as string|undefined;
 const backupPending=saved==='pending'||!!saved?.startsWith('pending:');
 const previous=saved?.replace(/^pending:?/,'');
 return {
  started:saved!==undefined,
  backupPending,
  completed:!!previous&&!backupPending,
  changed:!!previous&&previous!==counts(checkpoint),
 };
}
