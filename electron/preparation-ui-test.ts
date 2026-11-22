/** Real-window acceptance with disposable sales, never the shop ledger. */
import {app,dialog,BrowserWindow,type MessageBoxOptions} from 'electron';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {Ledger} from './database';
import {ledgerPath} from './ledger-path';
import {seedHistory} from './demo';

process.env.STEAMLOG_TEST_DATA='.cache/preparation-ui';
const root=path.resolve(process.env.STEAMLOG_TEST_DATA);fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(path.dirname(ledgerPath(root)),{recursive:true});
const ledger=new Ledger(ledgerPath(root));
const noHistoryProduct=ledger.product('B015')!;
ledger.setProductActive(noHistoryProduct.id,false);
seedHistory(ledger);
ledger.setProductActive(noHistoryProduct.id,true);
ledger.close();
const prompts:MessageBoxOptions[]=[];
const draftPrompts:MessageBoxOptions[]=[];
(dialog as any).showMessageBox=async(...args:any[])=>{
 const options=args.at(-1) as MessageBoxOptions;
 if(options.buttons?.includes('放弃修改')){
  draftPrompts.push(options);
  return {response:0,checkboxChecked:false};
 }
 prompts.push(options);
 return {response:0,checkboxChecked:false};
};
const deadline=setTimeout(()=>{console.error('UI acceptance timed out');app.exit(1);},45000);
app.once('browser-window-created',(_event,window)=>{void acceptance(window).catch(error=>{console.error(error);app.exit(1);});});
async function acceptance(window:BrowserWindow){
 await once(window.webContents,'did-finish-load');
 const js=async(code:string)=>{
  try{return await window.webContents.executeJavaScript(code);}
  catch(error){throw Error('Failed renderer script: '+code,{cause:error});}
 };
 const eventually=async(check:()=>unknown|Promise<unknown>,description:string)=>{
  for(let i=0;i<80;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}
  throw Error('UI condition timed out: '+description);
 };
 const navigationButton="[...document.querySelectorAll('nav button')].find(b=>b.textContent==='明日备货')";
 const dashboardButton="[...document.querySelectorAll('button')].find(b=>b.textContent==='明日备货推荐')";
 const waitFor=(condition:string)=>eventually(()=>js(condition),condition);
 await waitFor('!!'+navigationButton);
 assert.equal(await js("document.querySelectorAll('nav button').length"),5);
 assert.equal(await js("document.querySelector('.app-header').textContent.includes('模拟测试')"),false);
 assert.equal(await js("typeof window.steam.dualFire"),'undefined');
 assert.equal(await js("typeof window.steam.seedDemo"),'undefined');
 window.setSize(960,720);
 await waitFor('innerWidth<=960');
 await js(navigationButton+'.click()');
 await waitFor("document.querySelector('nav button[aria-current=page]')?.textContent==='明日备货'");
 assert.equal(BrowserWindow.getAllWindows().length,1);
 await waitFor("!!document.querySelector('.preparation-quantity') && document.querySelector('.preparation').getAttribute('aria-busy')==='false'");
 const count=await js("document.querySelectorAll('.preparation-table tbody tr').length");assert.equal(count,47);
 assert.match(await js("document.querySelector('.preparation-coverage').textContent"),/46 \/ 47 款商品的建议 · 1 款待积累/);
 assert.equal(await js(`document.querySelector('tr[data-product-id="${noHistoryProduct.id}"] .preparation-quantity').textContent`),'待积累');
 assert.equal(await js("document.querySelector('.preparation').textContent.includes('当前账本含模拟数据')"),false);
 assert.equal(await js("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='每日记录')"),false);
 assert.equal(await js("document.querySelector('.preparation-supplement-toggle').textContent.trim()"),'补录缺货或休息日');
 assert.equal(await js("!!document.querySelector('.daily-preparation')"),false);
 const salesOnly=await js('window.steam.preparation(10)');assert(salesOnly.total>0);assert.equal(salesOnly.includesToday,false);
 await js("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='今日看板').click()");
 assert.equal(await js("document.querySelector('.closeout-status').textContent"),'');
 await js("[...document.querySelectorAll('.dashboard-tools button')].find(b=>b.textContent==='收工日结').click()");
 await waitFor("document.querySelector('.closeout-card')?.textContent.includes('当天扫码销量已纳入备货计算')");
 await js("document.querySelector('.closeout-card .form-actions .primary').click()");
 await waitFor("document.querySelector('.closeout-status')?.textContent==='今日已收工'");
 await js(navigationButton+'.click()');
 await waitFor("document.querySelector('.preparation-tools .note')?.textContent.includes('今日记录已纳入推荐')");
 const before=await js('window.steam.preparation(10)');
 assert(before.includesToday);assert.equal(before.end,before.today);
 await js("(()=>{const select=document.querySelector('.preparation select');select.value='50';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await waitFor("document.querySelector('.preparation select').value==='50' && document.querySelector('.preparation').getAttribute('aria-busy')==='false'");
 const total=await js("document.querySelector('.preparation-summary b').textContent");assert.equal(Number(total.replaceAll(',','')),(await js('window.steam.preparation(50)')).total);assert(Number(total.replaceAll(',',''))>=before.total);
 // Edit the daily form through actual React inputs; no test sales enter the shop ledger.
 await js("document.querySelector('.preparation-supplement-toggle').click()");
 await waitFor("!!document.querySelector('.daily-record-table tbody tr') && document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false'");
 const snapshot=await js('window.steam.snapshot()'),product=snapshot.products.find((p:any)=>p.sku==='B001'),today=snapshot.dashboard.businessDate;
 assert.equal(await js("document.querySelector('.completed-day input').checked"),true);
 await js(`(()=>{const row=document.querySelector('.daily-record-table tr[data-product-id="${product.id}"]');const inputs=row.querySelectorAll('input[type=number]');const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};set(inputs[0],'50');set(inputs[1],'0');row.querySelector('input[type=checkbox]').click();})()`);
 await js("[...document.querySelectorAll('.daily-date-shortcuts button')].find(b=>b.textContent==='昨天').click()");
 assert.match(await js("document.querySelector('.daily-preparation .error').textContent"),/先保存或放弃/);
 const optionalProduct=snapshot.products.find((p:any)=>p.sku==='B002');
 await js(`document.querySelector('.daily-record-table tr[data-product-id="${optionalProduct.id}"] input[type=checkbox]').click()`);
 await js("document.querySelector('.preparation-supplement-toggle').click()");
 await waitFor("document.querySelector('.preparation-supplement [role=alert]')?.textContent.includes('未保存的补录')");
 await js("[...document.querySelectorAll('.preparation-supplement button')].find(b=>b.textContent==='继续填写').click()");
 await js("document.querySelector('.daily-save .primary').click()");
 await waitFor("!!document.querySelector('.daily-preparation .notice[role=status]') && document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false'");
 const saved=await js(`window.steam.preparationDay(${JSON.stringify(today)})`);assert(saved.completed);const savedItem=saved.products.find((r:any)=>r.productId===product.id);assert.equal(savedItem.prepared,50);assert.equal(savedItem.remaining,0);assert(savedItem.stockout);
 const optionalItem=saved.products.find((row:any)=>row.productId===optionalProduct.id);
 assert(optionalItem.stockout);assert.equal(optionalItem.prepared,null);assert.equal(optionalItem.remaining,null);
 window.setSize(1440,960);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(root,'daily-records-desktop.png'),(await window.webContents.capturePage()).toPNG());
 // Changing a date to a closure must ignore incomplete edits to the now-hidden quantity fields.
 await js("[...document.querySelectorAll('.daily-date-shortcuts button')].find(b=>b.textContent==='昨天').click()");
 await waitFor("!!document.querySelector('.daily-record-table tbody tr') && document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false'");
 const yesterday=await js("document.querySelector('.daily-record-tools input').value");
 await js(`(()=>{const row=document.querySelector('.daily-record-table tr[data-product-id="${product.id}"]');const inputs=row.querySelectorAll('input[type=number]');const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};set(inputs[0],'1');set(inputs[1],'10');})()`);
 const dailyStatus=(status:string)=>js(`(()=>{const select=document.querySelector('select[aria-label=营业状态]');select.value='${status}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await dailyStatus('closed');
 await js("document.querySelector('.daily-save .primary').click()");
 await waitFor("!!document.querySelector('.daily-preparation .notice[role=status]')");
 const closedDay=await js(`window.steam.preparationDay(${JSON.stringify(yesterday)})`);
 assert.equal(closedDay.status,'closed');assert.equal(closedDay.products.find((p:any)=>p.productId===product.id).prepared,null);
 await dailyStatus('auto');
 await js("document.querySelector('.daily-save .primary').click()");
 await waitFor("!!document.querySelector('.daily-preparation .notice[role=status]')");

 await js("[...document.querySelectorAll('.daily-date-shortcuts button')].find(b=>b.textContent==='明天').click()");await waitFor("document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false' && document.querySelector('.daily-record-tools input').value!=="+JSON.stringify(today));
 await js("(()=>{const select=document.querySelector('select[aria-label=营业状态]');select.value='closed';select.dispatchEvent(new Event('change',{bubbles:true}));})()");await js("document.querySelector('.daily-save .primary').click()");await waitFor("!!document.querySelector('.daily-preparation .notice[role=status]') && document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false'");assert.equal((await js('window.steam.preparation(10)')).total,0);
 await js("(()=>{const select=document.querySelector('select[aria-label=营业状态]');select.value='auto';select.dispatchEvent(new Event('change',{bubbles:true}));})()");await js("document.querySelector('.daily-save .primary').click()");await waitFor("!!document.querySelector('.daily-preparation .notice[role=status]') && document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false'");
 await js("document.querySelector('.preparation-supplement-toggle').click()");await waitFor("!!document.querySelector('.preparation-quantity') && document.querySelector('.preparation').getAttribute('aria-busy')==='false'");
 const updated=await js('window.steam.preparation(10)');assert(updated.includesToday);assert(updated.products.some((p:any)=>p.id===product.id));assert.equal((await js('window.steam.snapshot()')).summary.transactions,snapshot.summary.transactions);
 window.setSize(1440,960);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(root,'preparation-desktop.png'),(await window.webContents.capturePage()).toPNG());
 window.setSize(960,720);await new Promise(r=>setTimeout(r,150));
 const fits=await js("document.documentElement.scrollWidth<=innerWidth && document.querySelector('.preparation-page h1').textContent==='明日备货'");
 assert(fits);
 fs.writeFileSync(path.join(root,'preparation-small.png'),(await window.webContents.capturePage()).toPNG());

 if(!(await js('window.steam.rawInputInfo()')).active){
  await js(`(()=>{
   document.activeElement.blur();
   for(const key of ['B','0','0','1','Enter']){
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
   }
  })()`);
  await eventually(async()=>(await js('window.steam.snapshot()')).summary.transactions===snapshot.summary.transactions+1,'scan from the preparation page');
 }
 const newQuantity=`document.querySelector('.preparation-table tr[data-product-id="${noHistoryProduct.id}"] .preparation-quantity')?.textContent`;
 assert.equal(await js(newQuantity),'待积累');
 await js(`window.steam.scan('SCANNER_1',${JSON.stringify(noHistoryProduct.sku)})`);
 const livePreparation=await js("window.steam.preparation(Number(document.querySelector('.preparation select').value))");
 const recommendation=livePreparation.products.find((p:any)=>p.id===noHistoryProduct.id).recommended;
 assert(recommendation>0);
 await waitFor(`${newQuantity}===${JSON.stringify(`${recommendation} 件`)} && document.querySelector('.preparation').getAttribute('aria-busy')==='false'`);

 await js("document.querySelector('.preparation-supplement-toggle').click()");
 await waitFor("document.querySelector('.daily-preparation')?.getAttribute('aria-busy')==='false'");
 await js(`document.querySelector('.daily-record-table tr[data-product-id="${product.id}"] input[type=checkbox]').click()`);
 app.quit();
 await eventually(()=>draftPrompts.length===1,'unsaved changes prompt on quit');
 assert(!window.isDestroyed());
 assert.equal(await js("document.querySelector('.daily-save .primary').disabled"),false);

 const liveTab="[...document.querySelectorAll('nav button')].find(b=>b.textContent==='今日看板')";
 await js(liveTab+'.click()');
 await waitFor("document.querySelector('dialog[open] h2')?.textContent.includes('未保存')");
 await js("[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='继续填写').click()");
 await waitFor("!document.querySelector('dialog[open]')");
 assert.equal(await js("document.querySelector('.daily-save .primary').disabled"),false);
 await js(liveTab+'.click()');
 await waitFor("!!document.querySelector('dialog[open]')");
 await js("[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='放弃修改并切换').click()");
 await waitFor("!!document.querySelector('.dashboard') && !document.querySelector('.preparation-page')");
 await js(dashboardButton+'.click()');
 await waitFor("!!document.querySelector('.preparation-page')");
 assert.equal(BrowserWindow.getAllWindows().length,1);
 const persisted=await js(`window.steam.preparationDay(${JSON.stringify(today)})`);
 assert(persisted.products.find((row:any)=>row.productId===product.id).stockout);

 await js("[...document.querySelectorAll('nav button')].find(b=>b.textContent==='备份与设置').click()");
 await waitFor("!!document.querySelector('.maintenance-actions')");
 assert.equal(await js("document.querySelector('.maintenance-actions').textContent.includes('生成 30 天模拟数据')"),false);
 await js('window.steam.backupNow()');const backup=(await js('window.steam.systemInfo()')).backups[0];
 assert.equal(await js('window.steam.clearLedger()'),false);assert.equal(await js(`window.steam.restoreBackup(${JSON.stringify(backup.filename)})`),false);
 assert.equal(prompts.length,2);for(const prompt of prompts){assert.match(prompt.message,/[\u3400-\u9fff]/);assert.match(prompt.detail!,/[\u3400-\u9fff]/);assert.deepEqual(prompt.buttons,['取消','确认']);assert.equal(prompt.defaultId,0);}
 const invalid=await js("window.steam.preparation(-1).then(()=>'',e=>e.message)");assert.match(invalid,/0～50/);
 const productError=await js("window.steam.saveProduct({sku:'B001',name:'测试',category:'包子',price:'2',sort_order:0,is_active:1}).then(()=>'',e=>e.message)");assert.match(productError,/条码已被使用/);
 console.log('PASS preparation UI: single-window navigation, sales-only recommendation, live scan updates, draft protection on navigation and quit, optional supplement, buffer, planned closure, and main-window confirmation flows.');
 clearTimeout(deadline);app.quit();
}
require('./main');
