/** Real-window acceptance with disposable sales, never the shop ledger. */
import {app,dialog,type BrowserWindow,type MessageBoxOptions} from 'electron';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {Ledger} from './database';
import {ledgerPath} from './ledger-path';
import {seedHistory} from './demo';

process.env.STEAMLOG_TEST_DATA='.cache/preparation-ui';
const root=path.resolve(process.env.STEAMLOG_TEST_DATA);fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(path.dirname(ledgerPath(root)),{recursive:true});
const ledger=new Ledger(ledgerPath(root));seedHistory(ledger);ledger.close();
const prompts:MessageBoxOptions[]=[];
(dialog as any).showMessageBox=async(...args:any[])=>{prompts.push(args.at(-1));return {response:0,checkboxChecked:false};};
const deadline=setTimeout(()=>{console.error('UI acceptance timed out');app.exit(1);},45000);
app.once('browser-window-created',(_event,window)=>{void acceptance(window).catch(error=>{console.error(error);app.exit(1);});});
async function acceptance(window:BrowserWindow){
 await once(window.webContents,'did-finish-load');
 const js=(code:string)=>window.webContents.executeJavaScript(code);
 const waitFor=async(condition:string)=>{for(let i=0;i<80;i++){if(await js(condition))return;await new Promise(r=>setTimeout(r,100));}throw Error('UI condition timed out: '+condition);};
 await waitFor("!![...document.querySelectorAll('button')].find(b=>b.textContent==='明日备货推荐')");
 await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='明日备货推荐').click()");
 await waitFor("!!document.querySelector('.preparation-quantity') && document.querySelector('.preparation').getAttribute('aria-busy')==='false'");
 const count=await js("document.querySelectorAll('.preparation-table tbody tr').length");assert.equal(count,47);
 assert.match(await js("document.querySelector('.preparation .backup-warning').textContent"),/模拟数据/);
 const before=await js('window.steam.preparation(10)');
 await js("(()=>{const select=document.querySelector('.preparation select');select.value='50';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await waitFor("document.querySelector('.preparation select').value==='50' && document.querySelector('.preparation').getAttribute('aria-busy')==='false'");
 const total=await js("document.querySelector('.preparation-summary b').textContent");assert.equal(Number(total.replaceAll(',','')),(await js('window.steam.preparation(50)')).total);assert(Number(total.replaceAll(',',''))>=before.total);
 // Edit the daily form through actual React inputs; no test sales enter the shop ledger.
 await js("[...document.querySelectorAll('.preparation-tabs button')].find(b=>b.textContent==='每日记录').click()");
 await waitFor("!!document.querySelector('.daily-record-table tbody tr') && document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false'");
 const snapshot=await js('window.steam.snapshot()'),product=snapshot.products.find((p:any)=>p.sku==='B001'),today=snapshot.dashboard.businessDate;
 await js(`(()=>{const row=document.querySelector('.daily-record-table tr[data-product-id="${product.id}"]');const inputs=row.querySelectorAll('input[type=number]');const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};set(inputs[0],'50');set(inputs[1],'0');row.querySelector('input[type=checkbox]').click();document.querySelector('.completed-day input').click();})()`);
 await js("[...document.querySelectorAll('.daily-date-shortcuts button')].find(b=>b.textContent==='昨天').click()");
 assert.match(await js("document.querySelector('.daily-preparation .error').textContent"),/先保存或放弃/);
 await js("document.querySelector('.daily-save .primary').click()");
 await waitFor("!!document.querySelector('.daily-preparation .notice[role=status]') && document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false'");
 const saved=await js(`window.steam.preparationDay(${JSON.stringify(today)})`);assert(saved.completed);const savedItem=saved.products.find((r:any)=>r.productId===product.id);assert.equal(savedItem.prepared,50);assert.equal(savedItem.remaining,0);assert(savedItem.stockout);
 window.setSize(1440,960);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(root,'daily-records-desktop.png'),(await window.webContents.capturePage()).toPNG());
 await js("[...document.querySelectorAll('.daily-date-shortcuts button')].find(b=>b.textContent==='明天').click()");await waitFor("document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false' && document.querySelector('.daily-record-tools input').value!=="+JSON.stringify(today));
 await js("(()=>{const select=document.querySelector('select[aria-label=营业状态]');select.value='closed';select.dispatchEvent(new Event('change',{bubbles:true}));})()");await js("document.querySelector('.daily-save .primary').click()");await waitFor("!!document.querySelector('.daily-preparation .notice[role=status]') && document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false'");assert.equal((await js('window.steam.preparation(10)')).total,0);
 await js("(()=>{const select=document.querySelector('select[aria-label=营业状态]');select.value='auto';select.dispatchEvent(new Event('change',{bubbles:true}));})()");await js("document.querySelector('.daily-save .primary').click()");await waitFor("!!document.querySelector('.daily-preparation .notice[role=status]') && document.querySelector('.daily-preparation').getAttribute('aria-busy')==='false'");
 await js("[...document.querySelectorAll('.preparation-tabs button')].find(b=>b.textContent==='明日推荐').click()");await waitFor("!!document.querySelector('.preparation-quantity') && document.querySelector('.preparation').getAttribute('aria-busy')==='false'");
 const updated=await js('window.steam.preparation(10)');assert(updated.includesToday);assert(updated.products.find((p:any)=>p.id===product.id).stockoutDays>=1);assert.equal((await js('window.steam.snapshot()')).summary.transactions,snapshot.summary.transactions);
 window.setSize(1440,960);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(root,'preparation-desktop.png'),(await window.webContents.capturePage()).toPNG());
 window.setSize(960,720);await new Promise(r=>setTimeout(r,150));
 const bounds=await js("(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight};})()");assert(bounds.x>=0&&bounds.y>=0&&bounds.right<=bounds.w&&bounds.bottom<=bounds.h);
 fs.writeFileSync(path.join(root,'preparation-small.png'),(await window.webContents.capturePage()).toPNG());
 await js("document.querySelector('dialog .icon-button').click()");
 await js('window.steam.backupNow()');const backup=(await js('window.steam.systemInfo()')).backups[0];
 assert.equal(await js('window.steam.seedDemo()'),null);assert.equal(await js('window.steam.clearLedger()'),false);assert.equal(await js(`window.steam.restoreBackup(${JSON.stringify(backup.filename)})`),false);
 assert.equal(prompts.length,3);for(const prompt of prompts){assert.match(prompt.message,/[\u3400-\u9fff]/);assert.match(prompt.detail!,/[\u3400-\u9fff]/);assert.deepEqual(prompt.buttons,['取消','确认']);assert.equal(prompt.defaultId,0);}
 const invalid=await js("window.steam.preparation(-1).then(()=>'',e=>e.message)");assert.match(invalid,/0～50/);
 const productError=await js("window.steam.saveProduct({sku:'B001',name:'测试',category:'包子',price:'2',sort_order:0,is_active:1}).then(()=>'',e=>e.message)");assert.match(productError,/条码已被使用/);
 console.log('PASS preparation UI: real IPC, 47 rows, demo warning, buffer recalculation, desktop/small-window captures, Chinese demo/clear/restore confirmations cancel safely, Chinese validation errors, daily form saves, unsaved-date guard, completed today, shortage and planned closure integration.');
 clearTimeout(deadline);app.quit();
}
require('./main');
