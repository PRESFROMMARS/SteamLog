import assert from 'node:assert/strict';
import {Ledger} from './database';
import {ScannerEngine} from './engine';
import {queryHistory} from './analytics';
import {OPENING_CATALOG} from './catalog';
import {priceToCents} from './products';
import {code128,CODE128_PATTERNS} from './code128';
import type {ProductInput} from './types';
const ledger=new Ledger(':memory:');
let now=Date.parse('2026-10-18T00:00:00Z'); // 08:00 in Taipei
const engine=new ScannerEngine(ledger,()=>{},()=>now);
const draft:ProductInput={sku:'QA001',name:'Test Bao',category:'Test',price:'2.55',sort_order:100,is_active:1};
try {
 assert.equal(OPENING_CATALOG.length,47);assert.equal(new Set(OPENING_CATALOG.map(p=>p.sku)).size,47);assert.equal(new Set(OPENING_CATALOG.map(p=>p.category)).size,8);assert.equal(OPENING_CATALOG.reduce((sum,p)=>sum+p.price_cents,0),14600);assert.equal(ledger.product('B001')?.name,'招牌鲜肉包');assert.equal(ledger.product('B006')?.price_cents,250);assert.equal(ledger.product('X004')?.price_cents,800);assert.equal(ledger.product('T002')?.price_cents,900);OPENING_CATALOG.forEach(p=>assert.doesNotThrow(()=>code128(p.sku)));
 assert.equal(priceToCents('2.55'),255);assert.equal(priceToCents('0.01'),1);assert.equal(priceToCents('10.1'),1010);assert.equal(priceToCents('0'),0);
 for(const p of ['-1','2.555','NaN','2e3','Infinity','',2.5])assert.throws(()=>priceToCents(p));
 for(const sku of ['MOD-ANY','MUL-07','ACT-ANY','X2','X3','X5','X10','bad sku','中文'])assert.throws(()=>ledger.saveProduct({...draft,sku}));
 const product=ledger.saveProduct({...draft,sku:' qa001 '});assert.equal(product.sku,'QA001');assert.equal(product.price_cents,255);
 assert.throws(()=>ledger.saveProduct(draft),/已被使用/);assert.throws(()=>ledger.saveProduct({...draft,sort_order:1.2}));
 const sale=engine.scan('SCANNER_1','QA001')!;assert.equal(sale.unit_price_cents_snapshot,255);
 ledger.saveProduct({...draft,id:product.id,sku:'QA002',name:'Renamed',category:'New category',price:'3.05'});
 assert.equal(ledger.get(sale.id).sku_snapshot,'QA001');assert.equal(ledger.get(sale.id).name_snapshot,'Test Bao');assert.equal(ledger.get(sale.id).unit_price_cents_snapshot,255);
 let d=ledger.dashboard(new Date(now));assert.equal(d.ranking.find(p=>p.product_id===product.id)?.sku,'QA001');assert.equal(d.summary.items,1);
 const deleted=ledger.deleteProduct(product.id);assert.equal(deleted.archived,true);assert.equal(ledger.product('QA002'),undefined);assert.equal(ledger.get(sale.id).subtotal_cents,255);
 ledger.setProductActive(product.id,true);assert.equal(ledger.product('QA002')?.is_active,1);
 const unused=ledger.saveProduct({...draft,sku:'UNUSED'});assert.equal(ledger.deleteProduct(unused.id).archived,false);assert(!ledger.products().some(p=>p.id===unused.id));assert.throws(()=>ledger.deleteProduct(unused.id));
 // Separate data set: sale/refund/gift/waste/void, cross-hour ranking and peak semantics.
 ledger.void(sale.id,new Date(now));engine.scan('SCANNER_1','MUL-05');engine.scan('SCANNER_1','B001');
 engine.scan('SCANNER_2','MOD-REFUND');engine.scan('SCANNER_2','B001');
 engine.scan('SCANNER_2','MOD-GIFT');engine.scan('SCANNER_2','MUL-02');engine.scan('SCANNER_2','S001');
 engine.scan('SCANNER_2','MOD-WASTE');engine.scan('SCANNER_2','S001');
 const voided=engine.scan('KEYBOARD','B002')!;engine.manualUndo(voided.id);
 d=ledger.dashboard(new Date(now));assert.equal(d.summary.revenue,800);assert.equal(d.summary.gross,1000);assert.equal(d.summary.refunds,200);assert.equal(d.summary.items,4);assert.equal(d.summary.validTransactions,4);assert.equal(d.summary.voids,2);
 assert.deepEqual(d.summary.gift,{quantity:2,value:300});assert.deepEqual(d.summary.waste,{quantity:1,value:150});assert.deepEqual(d.summary.refund,{quantity:1,value:200});
 assert.equal(d.bestSeller?.sku,'B001');assert.equal(d.bestSeller?.quantity,4);assert.equal(d.hours[8].quantity,4);assert.equal(d.hours[8].revenue,800);assert.equal(d.peak?.hour,8);
 assert.equal(ledger.recent(new Date(now),{type:'REFUND',scanner:'SCANNER_2'}).length,1);assert.equal(ledger.recent(new Date(now),{type:'VOID',scanner:'ALL'}).length,2);
 // Filter before limiting: even when older than the unfiltered latest 40 rows.
 for(let i=0;i<45;i++)engine.scan('KEYBOARD','D001');assert.equal(ledger.recent(new Date(now)).length,40);assert.equal(ledger.recent(new Date(now),{type:'GIFT',scanner:'SCANNER_2'}).length,1);
 now=Date.parse('2026-10-18T01:00:00Z');d=ledger.dashboard(new Date(now));assert.equal(d.currentHour,9);assert.equal(d.hours[9].quantity,0);
 assert.equal(ledger.dashboard(new Date('2026-10-18T16:00:00Z')).summary.revenue,0);
 // Out-of-shop-hours scans must reach every live/history series immediately.
 const lateLedger=new Ledger(':memory:');let lateNow=0;const updates:ReturnType<ScannerEngine['snapshot']>[]=[];
 const lateEngine=new ScannerEngine(lateLedger,event=>updates.push(event),()=>lateNow);
 try {
  for(const [stamp,hour] of [['2026-10-18T16:30:00Z',0],['2026-10-18T20:30:00Z',4],['2026-10-19T12:30:00Z',20],['2026-10-19T15:30:00Z',23]] as const){
   lateNow=Date.parse(stamp);lateEngine.scan('SCANNER_1','MUL-05');lateEngine.scan('SCANNER_1','B001');
   assert.equal(updates.at(-1)?.dashboard.hours[hour].quantity,5);
  }
  lateEngine.scan('SCANNER_2','MOD-REFUND');lateEngine.scan('SCANNER_2','B001');
  lateEngine.scan('SCANNER_2','MOD-GIFT');lateEngine.scan('SCANNER_2','B001');
  lateEngine.scan('SCANNER_2','MOD-WASTE');lateEngine.scan('SCANNER_2','B001');
  const removed=lateEngine.scan('KEYBOARD','B001')!;lateEngine.manualUndo(removed.id);
  const live=lateLedger.dashboard(new Date(lateNow));assert.equal(live.summary.items,19);assert.equal(live.hours[23].quantity,4);assert.equal(live.hours[23].revenue,800);
  for(const granularity of ['daily','weekly','monthly'] as const){
   const result=queryHistory(lateLedger.db,{start:'2026-10-19',end:'2026-10-19',granularity});
   assert.equal(result.hours.length,24);assert.equal(result.hours[20].quantity,5);assert.equal(result.hours[23].quantity,4);
   assert.equal(result.trend.reduce((n,p)=>n+p.units,0),19);assert.equal(result.summary.revenue,3800);
   const bao=result.products.find(p=>p.sku==='B001')!;assert.equal(result.productTrends[bao.id].reduce((n,p)=>n+p.units,0),19);assert.equal(result.productHours[bao.id][23].quantity,4);
   assert.equal(result.summary.giftUnits,1);assert.equal(result.summary.wasteUnits,1);assert.equal(result.summary.voids,1);
  }
 } finally {lateEngine.close();lateLedger.close();}
 // Standards vectors: Start-B, values for B001, weighted mod-103 checksum 80, Stop.
 assert.deepEqual(code128('B001').symbols,[104,34,16,16,17,80,106]);
 assert.deepEqual(code128('MUL-05').symbols,[104,45,53,44,13,16,21,27,106]);
 assert.equal(code128('B001').width,99);assert.equal(CODE128_PATTERNS[104],'211214');assert.equal(CODE128_PATTERNS[106],'2331112');
 assert.equal(CODE128_PATTERNS.length,107);CODE128_PATTERNS.forEach((p,i)=>{assert.equal([...p].reduce((a,b)=>a+Number(b),0),i===106?13:11);});
 const code=code128('ACT-UNDO');assert.equal(code.bars[0].x,10);assert.equal(code.width-(code.bars.at(-1)!.x+code.bars.at(-1)!.width),10);
 for(let i=0;i<128;i++)assert.doesNotThrow(()=>code128(String.fromCharCode(i)));
 assert.deepEqual(code128('\0').symbols.slice(0,3),[104,98,64]);assert.throws(()=>code128('包'));assert.throws(()=>code128(''));
 // Empty catalog stays intentionally empty across initialization, rather than reseeding.
 const empty=new Ledger(':memory:');empty.products().forEach(p=>empty.deleteProduct(p.id));assert.equal(empty.products().length,0);assert.equal((empty.db.prepare("SELECT value FROM settings WHERE key='products_seeded'").get() as {value:string}).value,'1');empty.close();
 console.log('PASS Phase 2: exact-cent CRUD, reserved/unique SKUs, archive/delete, immutable snapshots, net dashboard aggregates, filtered latest 40, Taipei hour rollover, Code 128 vectors / full ASCII / quiet zones.');
} finally {engine.close();ledger.close();}
