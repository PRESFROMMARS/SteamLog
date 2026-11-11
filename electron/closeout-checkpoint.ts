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

export function hasCloseoutChanges(db:Database.Database,checkpoint:CloseoutCheckpoint){
 const saved=db.prepare('SELECT value FROM settings WHERE key=?').pluck().get(key(checkpoint));
 return saved!==undefined&&saved!==counts(checkpoint);
}
