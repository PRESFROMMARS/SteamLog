/** Real Electron process acceptance: isolated data, crash/reload, hung-renderer recovery and single instance. */
import {app,dialog,type BrowserWindow} from 'electron';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {BackupService} from './backup';
import {businessTime} from './time';
import type {BackupTrigger} from './types';
process.env.STEAMLOG_TEST_DATA='.cache/phase4-runtime';
const root=path.resolve(process.env.STEAMLOG_TEST_DATA);fs.rmSync(root,{recursive:true,force:true});
const deadline=setTimeout(()=>{console.error('Runtime test timed out');app.exit(1);},30000);
let secondInstances=0;app.on('second-instance',()=>secondInstances++);
let failNextCloseout=false;
let heldBackup:{trigger:BackupTrigger;enter:()=>void;resume:Promise<void>}|undefined;
function holdNextBackup(trigger:BackupTrigger){
 let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>{enter=resolve;});
 const resume=new Promise<void>(resolve=>{release=resolve;});
 heldBackup={trigger,enter,resume};
 return {entered,release};
}
const backup=BackupService.prototype.backup;
BackupService.prototype.backup=function(trigger,checkpoint){
 if(trigger==='closeout'&&failNextCloseout){
  failNextCloseout=false;
  return Promise.reject(Error('ENOSPC'));
 }
 if(heldBackup?.trigger===trigger){
  const next=heldBackup;
  heldBackup=undefined;
  next.enter();
  return next.resume.then(()=>backup.call(this,trigger,checkpoint));
 }
 return backup.call(this,trigger,checkpoint);
};
app.once('browser-window-created',(_event,window)=>{void acceptance(window).catch(error=>{console.error(error);app.exit(1);});});
async function acceptance(window:BrowserWindow){
 await once(window.webContents,'did-finish-load');
 const state=()=>window.webContents.executeJavaScript('window.steam.snapshot()');
 await window.webContents.executeJavaScript("window.steam.scan('SCANNER_1','B001')");
 const before=await state();assert.equal(before.summary.transactions,1);assert.equal(before.recent[0].quantity,1);
 await window.webContents.executeJavaScript("window.steam.scan('SCANNER_1','MUL-05')");
 const reloaded=once(window.webContents,'did-finish-load');window.webContents.forcefullyCrashRenderer();await reloaded;
 const after=await state();assert.equal(after.summary.transactions,1);assert.equal(after.states.SCANNER_1.multiplier,5);
 const recovered=once(window.webContents,'did-finish-load');window.emit('unresponsive');await recovered;assert.equal((await state()).summary.transactions,1);
 const child=spawn(process.execPath,[process.cwd()],{env:process.env,stdio:'ignore'});const [code]=await once(child,'exit');assert.equal(code,0);assert.equal(secondInstances,1);
 process.emit('uncaughtException',Error('Runtime-test synthetic exception'));
 process.emit('unhandledRejection',Error('Runtime-test synthetic rejection'),Promise.resolve());
 const log=fs.readFileSync(path.join(root,'logs','error.log'),'utf8');assert(log.includes('renderer recovery'));assert(log.includes('synthetic exception'));assert(log.includes('synthetic rejection'));
 assert(fs.existsSync(path.join(root,'db','ledger.db')));if(process.platform!=='win32')assert.equal((await window.webContents.executeJavaScript('window.steam.rawInputInfo()')).active,false);
 const evaluate=(code:string)=>window.webContents.executeJavaScript(code);
 const waitFor=async(condition:string)=>{
  for(let i=0;i<80;i++){if(await evaluate(condition))return;await new Promise(resolve=>setTimeout(resolve,50));}
  throw Error('UI condition not reached: '+condition);
 };
 await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent==='销售统计').click()");
 await waitFor("!!document.querySelector('.range-kpis')");
 await evaluate("[...document.querySelectorAll('.export-buttons button')][0].click()");
 await waitFor("!!document.querySelector('.export-result')");
 await evaluate("[...document.querySelectorAll('.range-pills button')].find(button=>button.textContent==='今天').click()");
 await waitFor("!document.querySelector('.export-result')");
 await evaluate(`(()=>{
  const input=document.querySelector('input[aria-label="开始日期"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1900-01-01');
  input.dispatchEvent(new Event('input',{bubbles:true}));
 })()`);
 await waitFor("document.querySelector('.analytics-view [role=alert]')?.textContent.includes('统计范围过长')");
 await evaluate("[...document.querySelectorAll('.analytics-controls button')].find(button=>button.textContent==='按月').click()");
 await waitFor("!!document.querySelector('.range-kpis') && !document.querySelector('.analytics-view [role=alert]')");
 await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent==='今日看板').click()");
 const firstId=before.recent[0].id;
 const row=(id:number)=>`document.querySelector('.recent-scans tr[data-transaction-id="${id}"]')`;
 await waitFor(`${row(firstId)}?.querySelector('.transaction-scanner').textContent==='1 号枪'`);
 await evaluate(`(()=>{
  const original=AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator=function(){window.testScanTone=true;return original.call(this)};
 })()`);
 await evaluate("window.steam.scan('SCANNER_1','TEST-UNRECOGNIZED')");
 await waitFor("window.testScanTone===true && [...document.querySelectorAll('[role=alert]')].some(alert=>alert.textContent.includes('1 号枪')&&alert.textContent.includes('未识别条码'))");
 await evaluate("window.steam.scan('SCANNER_2','ACT-UNDO')");
 await waitFor("[...document.querySelectorAll('[role=alert]')].some(alert=>alert.textContent.includes('2 号枪')&&alert.textContent.includes('最近 60 秒内没有可撤销'))");
 assert.equal((await state()).recent[0].is_voided,0);
 await evaluate("window.steam.scan('SCANNER_2','S001')");
 const secondId=(await state()).recent[0].id;
 await waitFor(`${row(secondId)}?.querySelector('.transaction-scanner').textContent==='2 号枪'`);
 assert(await evaluate("[...document.querySelectorAll('[role=alert]')].some(alert=>alert.textContent.includes('1 号枪')&&alert.textContent.includes('未识别条码'))"));
 assert.equal(await evaluate("[...document.querySelectorAll('[role=alert]')].some(alert=>alert.textContent.includes('2 号枪'))"),false);
 const keyboardSource=(await evaluate('window.steam.rawInputInfo()')).active?'manual':'keyboard';
 if(keyboardSource==='keyboard'){
  for(const key of ['D','0','0','1','Enter'])window.webContents.sendInputEvent({type:'keyDown',keyCode:key});
  await waitFor("document.querySelector('.last-scan')?.textContent.includes('键盘')");
 }else await evaluate("window.steam.scan('KEYBOARD','D001','manual')");
 const keyboardId=(await state()).recent[0].id;
 assert.equal((await state()).recent[0].scanner_id,'KEYBOARD');
 if(keyboardSource==='keyboard'){
  const count=(await state()).summary.transactions;
  await evaluate(`document.activeElement.blur();for(const key of 'A'.repeat(129)+'B001'){
   document.body.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  }
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));true`);
  await waitFor("[...document.querySelectorAll('[role=alert]')].some(alert=>alert.textContent.includes('条码过长'))");
  assert.equal((await state()).summary.transactions,count);
 }
 await evaluate(`window.steam.scan('KEYBOARD','ACT-UNDO','${keyboardSource}')`);
 await waitFor("[...document.querySelectorAll('[role=alert]')].some(alert=>alert.textContent.includes('条码撤销已暂停'))");
 assert.equal((await state()).recent[0].is_voided,0);
 await evaluate("(async()=>{for(let i=0;i<43;i++)await window.steam.scan('SCANNER_2','B002')})()");
 await waitFor(`!${row(firstId)}`);
 await evaluate("document.querySelector('.scan-list-actions button').click()");
 const nextPage="[...document.querySelectorAll('.scan-list-pagination button')].find(button=>button.textContent==='下一页')";
 await waitFor(`${nextPage} && !${nextPage}.disabled`);
 await evaluate(`${nextPage}.click()`);
 await waitFor(`!!${row(firstId)}`);
 await evaluate(`(()=>{
  const select=document.querySelector('.scan-list-filters select:not([aria-label])');
  select.value='SCANNER_1';select.dispatchEvent(new Event('change',{bubbles:true}));
  const product=document.querySelector('.scan-list-filters input[type=search]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(product,'b001');
  product.dispatchEvent(new Event('input',{bubbles:true}));
 })()`);
 await waitFor(`!!${row(firstId)} && !${row(secondId)} && !document.querySelector('.scan-list-pagination')`);
 await evaluate(`${row(firstId)}.querySelector('button').click()`);
 await waitFor(`${row(firstId)}?.classList.contains('voided')`);
 const rows=(await evaluate("window.steam.todayTransactions({scanner:'ALL',product:'',from:'',to:'',page:1})")).rows;
 assert.equal(rows.find((tx:{id:number})=>tx.id===firstId).is_voided,1);
 assert.equal(rows.find((tx:{id:number})=>tx.id===secondId).is_voided,0);
 assert.equal(rows.find((tx:{id:number})=>tx.id===keyboardId).is_voided,0);
 failNextCloseout=true;
 await evaluate("[...document.querySelectorAll('.dashboard-tools button')].find(b=>b.textContent==='收工日结').click()");
 await waitFor("document.querySelector('.closeout-backup.error')?.textContent.includes('磁盘空间不足') && document.querySelector('.closeout-status')?.textContent==='日结备份待完成'");
 await evaluate("[...document.querySelectorAll('.closeout-card button')].find(b=>b.textContent==='知道了').click()");
 await evaluate("[...document.querySelectorAll('.dashboard-tools button')].find(b=>b.textContent==='重试日结备份').click()");
 await waitFor("!!document.querySelector('.closeout-backup.notice')");
 const previousBackup=(await evaluate('window.steam.systemInfo()')).backups.find((b:{trigger:string})=>b.trigger==='closeout').filename;
 await evaluate("[...document.querySelectorAll('.closeout-card button')].find(b=>b.textContent==='知道了').click()");
 await evaluate("window.steam.scan('SCANNER_1','B003')");
 await waitFor("document.querySelector('.closeout-status')?.textContent==='日结后有变动'");
 await evaluate("[...document.querySelectorAll('.dashboard-tools button')].find(b=>b.textContent==='更新日结并备份').click()");
 await waitFor("!!document.querySelector('.closeout-backup.notice') && document.querySelector('.closeout-status')?.textContent==='今日已收工'");
 let updatedBackup=(await evaluate('window.steam.systemInfo()')).backups.find((b:{trigger:string})=>b.trigger==='closeout').filename;
 assert.notEqual(updatedBackup,previousBackup);

 const openingDate=businessTime(new Date()).date;
 const realNow=Date.now;
 let receipt=Date.parse(openingDate+'T23:59:57+08:00');
 Date.now=()=>receipt;
 const midnightBackup=holdNextBackup('closeout');
 try{
  await evaluate("window.steam.scan('SCANNER_1','MUL-05')");
  await evaluate("window.testCloseout=window.steam.closeout();true");
  await midnightBackup.entered;
  receipt+=1000;
  await evaluate("window.testQueued=window.steam.scan('SCANNER_1','B004');true");
  const beforeReplay=await state();
  assert(!beforeReplay.recent.some((row:{sku_snapshot:string})=>row.sku_snapshot==='B004'));
  receipt+=9000;
  midnightBackup.release();
  await evaluate("Promise.all([window.testCloseout,window.testQueued])");
  assert.equal((await state()).summary.transactions,0);
  const recorded=await evaluate(`window.steam.history({start:'${openingDate}',end:'${openingDate}',granularity:'daily'})`);
  assert.equal(recorded.products.find((row:{sku:string})=>row.sku==='B004').units,5);
  const yesterdayButton="[...document.querySelectorAll('.dashboard-tools button')].find(b=>b.textContent==='补做昨日日结')";
  await evaluate("[...document.querySelectorAll('.closeout-card button')].find(b=>b.textContent==='知道了').click()");
  await waitFor(`!!${yesterdayButton}`);
  await evaluate(`${yesterdayButton}.click()`);
  await waitFor("!!document.querySelector('.closeout-backup.notice')");
  const backups=(await evaluate('window.steam.systemInfo()')).backups;
  assert(!backups.some((b:{filename:string})=>b.filename===updatedBackup));
  updatedBackup=backups.find((b:{closeoutDate:string})=>b.closeoutDate===openingDate).filename;
  assert.match(await evaluate("document.querySelector('.closeout-date').textContent"),new RegExp(openingDate));
  assert.equal((await state()).summary.transactions,0);
  await waitFor(`!${yesterdayButton}`);
  await evaluate("[...document.querySelectorAll('.closeout-card button')].find(b=>b.textContent==='知道了').click()");
  await evaluate("document.querySelector('.scan-list-actions button').click()");
  await evaluate("(()=>{const select=document.querySelector('.scan-list-filters select[aria-label=营业日]');select.value='yesterday';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelector('.recent-scans h2')?.textContent==='昨日全部流水' && document.querySelector('.recent-scans tbody tr .numeric')?.textContent==='×5'");
 }finally{
  midnightBackup.release();
  Date.now=realNow;
 }

 // A queued barcode must not replay against a restored catalog or restored scanner bindings.
 const restoreBackup=holdNextBackup('pre-restore-safety');
 const showMessageBox=dialog.showMessageBox;
 dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as typeof showMessageBox;
 try{
  const date=JSON.stringify(openingDate);
  const draft=await evaluate(`window.steam.preparationDay(${date})`);
  await evaluate(`window.testRestore=window.steam.restoreBackup(${JSON.stringify(updatedBackup)});true`);
  await restoreBackup.entered;
  await evaluate("window.testRestoreScan=window.steam.scan('SCANNER_2','D006').then(()=>'',e=>e.message);true");
  await state();
  restoreBackup.release();
  assert.equal(await evaluate("window.testRestore"),true);
  assert.match(await evaluate("window.testRestoreScan"),/账本已更换/);
  assert(!(await state()).recent.some((row:{sku_snapshot:string})=>row.sku_snapshot==='D006'));
  assert.notEqual((await evaluate(`window.steam.preparationDay(${date})`)).ledgerRevision,draft.ledgerRevision);
  const stale=await evaluate(`window.steam.savePreparationDay({date:${date},status:'closed',products:[]},${draft.ledgerRevision}).then(()=>'',e=>e.message)`);
  assert.match(stale,/账本已更换/);
 }finally{
  restoreBackup.release();
  dialog.showMessageBox=showMessageBox;
 }
 await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='今日看板').click()");
 const beforeHalfPrice=(await state()).summary;
 await evaluate("window.steam.scan('SCANNER_1','MOD-HALF')");
 await waitFor("document.querySelector('.armed-pill')?.textContent.includes('半价销售')");
 await evaluate("window.steam.scan('SCANNER_1','MUL-03').then(()=>window.steam.scan('SCANNER_1','B001'))");
 await waitFor("document.querySelector('.last-scan .scan-label')?.textContent==='半价销售' && !document.querySelector('.armed-pill')");
 const discounted=await state();
 assert.equal(discounted.summary.revenue-beforeHalfPrice.revenue,300);
 assert.equal(discounted.summary.items-beforeHalfPrice.items,3);
 assert.equal(discounted.recent[0].half_price,1);
 const date=discounted.dashboard.businessDate;
 const exportedCSV=await evaluate(`window.steam.exportCSV('transactions',${JSON.stringify({start:date,end:date})})`);
 assert.match(fs.readFileSync(exportedCSV,'utf8'),/"SALE","VALID","B001"[^\r\n]*"1\.00","3","3\.00","3\.00","HALF_PRICE"/);
 const original=discounted.recent[0];
 await evaluate("window.steam.scan('SCANNER_1','MOD-REFUND').then(()=>window.steam.scan('SCANNER_1','MOD-HALF')).then(()=>window.steam.scan('SCANNER_1','B001'))");
 await waitFor("document.querySelector('dialog[open] h2')?.textContent==='按原销售流水退款'");
 assert.equal((await state()).summary.revenue,discounted.summary.revenue);
 await evaluate("window.steam.scan('SCANNER_2','MOD-REFUND').then(()=>window.steam.scan('SCANNER_2','S001'))");
 await waitFor("document.querySelector('dialog[open] .note')?.textContent.includes('另有 1 笔退款待处理')");
 const pendingReload=once(window.webContents,'did-finish-load');
 window.webContents.forcefullyCrashRenderer();
 await pendingReload;
 await waitFor("document.querySelector('dialog[open] .note')?.textContent.includes('1 号枪') && document.querySelector('dialog[open] input[type=search]')?.value==='B001'");
 await waitFor("Array.from(document.querySelectorAll('dialog[open] tbody button')).some(b=>b.textContent==='选择')");
 await evaluate("Array.from(document.querySelectorAll('dialog[open] tbody button')).find(b=>b.textContent==='选择').click()");
 await waitFor("document.querySelector('dialog[open] .refund-amount')?.textContent.includes('1.00')");
 await evaluate("Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent==='确认记入退款').click()");
 await waitFor("document.querySelector('dialog[open] input[type=search]')?.value==='S001' && document.querySelector('.last-scan .scan-label')?.textContent==='半价退款'");
 const refunded=await state();
 assert.equal(refunded.summary.revenue,discounted.summary.revenue-100);
 assert.equal(refunded.recent[0].refund_of,original.id);
 assert.equal(refunded.recent[0].scanner_id,'SCANNER_1');
 assert.equal(refunded.pendingRefunds.length,1);
 assert.equal(refunded.pendingRefunds[0].scannerId,'SCANNER_2');
 await waitFor("document.querySelector('dialog[open] tbody button')?.textContent==='选择'");
 await evaluate("document.querySelector('dialog[open] tbody button').click()");
 await evaluate("Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent==='确认记入退款').click()");
 await waitFor("!document.querySelector('dialog[open]')");
 const bothRefunded=await state();
 assert.equal(bothRefunded.pendingRefunds.length,0);
 assert.equal(bothRefunded.recent[0].refund_of,secondId);
 assert.equal(bothRefunded.recent[0].scanner_id,'SCANNER_2');
 const refundCSV=await evaluate(`window.steam.exportCSV('transactions',${JSON.stringify({start:date,end:date})})`);
 assert(fs.readFileSync(refundCSV,'utf8').includes(`"HALF_PRICE","${original.tx_uid}"`));
 const closedDraft=await evaluate(`window.steam.preparationDay(${JSON.stringify(date)})`);
 await evaluate(`window.steam.savePreparationDay(${JSON.stringify({date,status:'closed',products:[]})},${closedDraft.ledgerRevision})`);
 const closeout=await evaluate("window.steam.closeout()");
 assert(closeout.backup);
 assert.equal(closeout.includedInPreparation,false);
 assert.equal(closeout.summary.revenue,bothRefunded.summary.revenue);
 assert.equal(closeout.summary.units,bothRefunded.summary.items);
 await waitFor("document.querySelector('.closeout-status')?.textContent==='今日已收工'");
 await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='商品与条码板').click()");
 await waitFor("!!document.querySelector('.manager-tools')");
 await evaluate("document.querySelector('.manager-tools .primary').click()");
 await evaluate(`(()=>{
  const edit=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
  const form=document.querySelector('.product-form');
  edit(form.querySelector('[data-initial-focus]'),'B001');
  edit(form.querySelector('[placeholder="招牌鲜肉包"]'),'重复条码测试');
  edit(form.querySelector('[placeholder="2.50"]'),'2.50');
 })()`);
 await evaluate("document.querySelector('.product-form .primary').click()");
 await waitFor("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('条码已被使用')");
 await evaluate("document.querySelector('.product-form button[type=button]').click()");
 await evaluate("document.querySelector('.products-view .row-actions .danger-text').click()");
 await waitFor("document.querySelector('dialog[open] h2')?.textContent==='确认移除商品'");
 await evaluate("document.querySelector('dialog[open] [data-initial-focus]').click()");
 assert.equal((await state()).products.length,47);
 await evaluate("[...document.querySelectorAll('.subnav button')].find(b=>b.textContent==='柜台条码板').click()");
 await waitFor("document.querySelectorAll('.counter-barcode').length===57 && !!document.querySelector('.counter-controls svg[aria-label=\"Code 128: MOD-HALF\"]')");
 const printToPDF=window.webContents.printToPDF.bind(window.webContents);
 for(const [paper,columns] of [['Letter',4],['A4',4],['Letter',3],['A4',3]]){
  await evaluate(`(()=>{
   const [layout,paper]=document.querySelectorAll('.sheet-tools select');
   layout.value='${columns}';layout.dispatchEvent(new Event('change',{bubbles:true}));
   paper.value='${paper}';paper.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(`document.querySelector('.counter-sheet').style.getPropertyValue('--counter-columns')==='${columns}' && [...document.querySelectorAll('style')].some(s=>s.textContent.includes('size: ${paper} portrait'))`);
  let unlock!:()=>void;
  const held=new Promise<void>(resolve=>{unlock=resolve;});
  window.webContents.printToPDF=async options=>{await held;return printToPDF(options);};
  const before=new Set(fs.existsSync(path.join(root,'exports'))?fs.readdirSync(path.join(root,'exports')):[]);
  try{
   await evaluate("[...document.querySelectorAll('.sheet-tools button')].find(b=>b.textContent==='保存 PDF').click()");
   await waitFor("[...document.querySelectorAll('nav button,.subnav button,.sheet-tools select')].every(b=>b.disabled)");
  }finally{unlock();}
  await waitFor("document.querySelector('.products-view [role=status]')?.textContent.includes('PDF 已保存')");
  const output=fs.readdirSync(path.join(root,'exports')).filter(file=>file.endsWith('.pdf')&&!before.has(file));
  assert.equal(output.length,1);
  fs.copyFileSync(path.join(root,'exports',output[0]),path.join(root,`${paper}-${columns}.pdf`));
 }
 window.webContents.printToPDF=printToPDF;
 clearTimeout(deadline);console.log('PASS Runtime: scanner warnings and overflow, CSV range, Taipei midnight closeout, stale drafts after restore, product dialogs and all four PDF exports. Shutdown backup follows.');app.quit();
}
require('./main');
