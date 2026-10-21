import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Ledger,businessTime} from './database';
import {ScannerEngine} from './engine';
import type {EngineEvent} from './types';
const root=path.resolve('.cache/tests');fs.mkdirSync(root,{recursive:true});const file=path.join(root,`ledger-${process.pid}.sqlite3`);const ledger=new Ledger(file);let now=Date.parse('2026-10-18T15:00:00.000Z');const events:EngineEvent[]=[];const engine=new ScannerEngine(ledger,e=>events.push(e),()=>now);
async function test(){
 assert.equal(ledger.products().length,47);assert.equal(ledger.db.pragma('journal_mode',{simple:true}),'wal');assert.equal(ledger.db.pragma('foreign_keys',{simple:true}),1);
 const result=engine.dualFire();assert.equal(result.passed,true);assert.equal(ledger.today(new Date(now)).summary.revenue,1150);
 const rows=result.ids.map(id=>ledger.get(id));assert.equal(rows[0].created_at,rows[1].created_at);assert.equal(rows.find(t=>t.scanner_id==='SCANNER_1')?.quantity,5);assert.equal(engine.states.SCANNER_1.multiplier,1);
 engine.scan('SCANNER_1',' x2 ');engine.scan('SCANNER_1','mod-waste');engine.scan('SCANNER_2','X3');const waste=engine.scan('SCANNER_1','B001')!;assert.equal(waste.quantity,2);assert.equal(waste.tx_type,'WASTE');assert.equal(waste.subtotal_cents,0);assert.equal(waste.item_value_cents,400);assert.equal(engine.states.SCANNER_2.multiplier,3);
 engine.scan('SCANNER_2','ACT-RESET');engine.scan('KEYBOARD','MOD-REFUND');const refund=engine.scan('KEYBOARD','D001')!;assert.equal(refund.subtotal_cents,-300);
 engine.scan('KEYBOARD','MOD-GIFT');const gift=engine.scan('KEYBOARD','D006')!;assert.equal(gift.item_value_cents,200);assert.equal(gift.subtotal_cents,0);
 engine.scan('SCANNER_1','MUL-05');engine.scan('SCANNER_1','BAD');assert.equal(events.at(-1)?.code,'ERROR_UNKNOWN_SKU');assert.equal(engine.states.SCANNER_1.multiplier,5);now+=5001;const expired=engine.scan('SCANNER_1','B002')!;assert.equal(expired.quantity,1);
 assert.throws(()=>ledger.db.prepare('DELETE FROM transactions WHERE id=?').run(expired.id),/cannot be deleted/);
 assert.throws(()=>ledger.db.prepare('UPDATE transactions SET quantity=2 WHERE id=?').run(expired.id),/one-way void/);
 const own=engine.scan('SCANNER_2','ACT-UNDO')!;assert.equal(own.scanner_id,'SCANNER_2');assert.equal(own.is_voided,1);assert.throws(()=>ledger.db.prepare('UPDATE transactions SET is_voided=0,voided_at=NULL WHERE id=?').run(own.id),/one-way void/);
 now+=61000;const fallback=engine.scan('SCANNER_2','ACT-UNDO')!;assert.equal(fallback.id,expired.id);
 engine.manualUndo(gift.id);assert.equal(ledger.get(gift.id).is_voided,1);
 const previous=ledger.get(refund.id);ledger.db.prepare('UPDATE products SET price_cents=999 WHERE sku=?').run('D001');assert.equal(ledger.get(refund.id).unit_price_cents_snapshot,previous.unit_price_cents_snapshot);
 ledger.db.prepare('UPDATE products SET is_active=0 WHERE sku=?').run('D002');engine.scan('SCANNER_1','D002');assert.equal(events.at(-1)?.code,'ERROR_UNKNOWN_SKU');assert.throws(()=>engine.scan('BOGUS' as never,'B001'));
 assert.deepEqual(businessTime(new Date('2025-12-31T15:59:59Z')),{date:'2025-12-31',hour:23});assert.deepEqual(businessTime(new Date('2026-07-01T16:00:00Z')),{date:'2026-07-02',hour:0});
 const before=ledger.today(new Date(now)).summary.transactions;for(let i=0;i<250;i++)assert.equal(engine.dualFire().passed,true);assert.equal(ledger.today(new Date(now)).summary.transactions,before+500);
 engine.scan('KEYBOARD','X10');await new Promise(resolve=>setTimeout(resolve,5100));assert.equal(engine.states.KEYBOARD.multiplier,1);assert.match(events.at(-1)!.message,/已过期/);
 engine.close();ledger.close();const reopened=new Ledger(file);assert.equal(reopened.products().length,47);assert.equal(reopened.get(refund.id).subtotal_cents,-300);reopened.close();console.log('PASS: WAL, seeds, same-tick isolation, 500-sale stress, modes, unknown/inactive, immutable snapshots, one-way void, undo preference/fallback, Taipei dates, expiry event, persistence.');
}
test().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{engine.close();if(ledger.db.open)ledger.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(file+suffix,{force:true});});
