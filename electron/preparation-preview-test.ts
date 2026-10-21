/** User-visible preview with separate demo data. Excluded from packaged applications. */
import {app,type BrowserWindow} from 'electron';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {Ledger} from './database';
import {ledgerPath} from './ledger-path';
import {seedHistory} from './demo';
import {preparationDay,savePreparationDay} from './preparation-records';
import {businessTime} from './time';
import {addDays} from './ranges';
process.env.STEAMLOG_TEST_DATA='.cache/preparation-preview-v2';
const file=ledgerPath(path.resolve(process.env.STEAMLOG_TEST_DATA));
if(!fs.existsSync(file)){
 fs.mkdirSync(path.dirname(file),{recursive:true});const ledger=new Ledger(file);
 try{
  const now=new Date(),today=businessTime(now).date;seedHistory(ledger,now);
  const p=ledger.product('B001')!,q=ledger.product('B002')!;
  let day=preparationDay(ledger.db,today,now);const sold=day.products.find(r=>r.productId===p.id)!.sold;
  if(sold<50)ledger.record(p,'KEYBOARD',50-sold,'SALE',now);
  for(const date of [addDays(today,-1),today]){
   day=preparationDay(ledger.db,date,now);const product=day.products.find(r=>r.productId===q.id)!;
   savePreparationDay(ledger.db,{date,status:'open',completed:date===today,products:[{productId:q.id,stockout:false,prepared:product.sold+15,remaining:15},...(date===today?[{productId:p.id,stockout:true,prepared:Math.max(50,sold),remaining:0}]:[])]},now);
  }
  savePreparationDay(ledger.db,{date:addDays(today,-3),status:'closed',completed:false,products:[]},now);
 }finally{ledger.close();}
}
app.once('browser-window-created',(_event,window:BrowserWindow)=>{void(async()=>{
 await once(window.webContents,'did-finish-load');window.setTitle('SteamLog · 备货功能演示（独立演示账本）');
 for(let i=0;i<80;i++){
  const opened=await window.webContents.executeJavaScript("(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='明日备货推荐');if(!button)return false;button.click();return true;})()");
  if(opened)break;await new Promise(r=>setTimeout(r,100));
 }
 window.show();window.focus();app.focus({steal:true});console.log('OPENED preparation preview: independent demo ledger, recommendation and daily records are ready.');
 })().catch(console.error);});
require('./main');
