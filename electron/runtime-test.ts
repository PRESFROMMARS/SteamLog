/** Real Electron process acceptance: isolated data, crash/reload, hung-renderer recovery and single instance. */
import {app,type BrowserWindow} from 'electron';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
process.env.STEAMLOG_TEST_DATA='.cache/phase4-runtime';
const root=path.resolve(process.env.STEAMLOG_TEST_DATA);fs.rmSync(root,{recursive:true,force:true});
const deadline=setTimeout(()=>{console.error('Runtime test timed out');app.exit(1);},30000);
let secondInstances=0;app.on('second-instance',()=>secondInstances++);
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
 clearTimeout(deadline);console.log('PASS Runtime: real renderer crash + unresponsive reload preserve Main ledger / armed FSM, second launch exits and focuses existing instance, exception / rejection stay local, Mac helper skip. Shutdown backup follows.');app.quit();
}
require('./main');
