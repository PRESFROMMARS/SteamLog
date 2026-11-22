import {app,BrowserWindow,dialog,ipcMain,Menu,shell} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {businessTime,Ledger} from './database';
import {createCloseout} from './closeout';
import {recommendPreparation} from './preparation';
import {preparationDay,savePreparationDay} from './preparation-records';
import {readableError} from './errors';
import {ScannerEngine} from './engine';
import {queryHistory} from './analytics';
import {BackupService,recoverInterruptedRestore} from './backup';
import {CSVService} from './csv';
import {openWithRecovery} from './recovery';
import {clearTransactions} from './demo';
import {contained} from './paths';
import {migrateLegacyLedger} from './ledger-path';
import {errorLogger,RecoverySchedule} from './reliability';
import {WinRawScannerService} from './win-raw-scanner';
import {ForegroundScanGuard,scannerMappingKey} from './raw-input';
import type {AnalyticsRequest,CounterPaper,DateRange,ExportKind,GunId,LedgerFilter,ProductInput,RefundSearch,ScannerId,ScanSource,TodayTransactionFilter} from './types';
const projectRoot=app.isPackaged?path.dirname(app.getPath('exe')):process.cwd();
const runtimeRoot=contained(projectRoot,!app.isPackaged&&process.env.STEAMLOG_TEST_DATA?path.resolve(projectRoot,process.env.STEAMLOG_TEST_DATA):path.join(projectRoot,app.isPackaged?'data':'.dev-data'));
for(const name of ['userData','sessionData','logs','temp'] as const){const dir=contained(projectRoot,path.join(runtimeRoot,name));fs.mkdirSync(dir,{recursive:true});app.setPath(name,dir);}
app.setPath('appData',runtimeRoot);
for(const [key,relative] of Object.entries({ELECTRON_CACHE:'.cache/electron',ELECTRON_BUILDER_CACHE:'.cache/electron-builder',npm_config_cache:'.cache/npm'})){process.env[key]=contained(projectRoot,path.join(projectRoot,relative));}
for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=path.join(runtimeRoot,'temp');
app.setPath('crashDumps',contained(projectRoot,path.join(runtimeRoot,'crashDumps')));
app.commandLine.appendSwitch('lang','zh-CN');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');app.commandLine.appendSwitch('disable-http-cache');app.setName('SteamLog');
const logError=errorLogger(runtimeRoot);
process.on('uncaughtException',error=>logError('uncaughtException',error));
process.on('unhandledRejection',error=>logError('unhandledRejection',error));
let ledger:Ledger,engine:ScannerEngine,backups:BackupService,csv:CSVService,window:BrowserWindow|null=null;
let preparationDirty=false,discardPreparation:Promise<boolean>|undefined;
let ledgerRevision=0;
let raw:WinRawScannerService|undefined,recoveryTimer:ReturnType<typeof setTimeout>|undefined;
const foregroundGuard=new ForegroundScanGuard();
let quitting=false,exiting=false,gate:Promise<void>|null=null;
let sheetTask:Promise<unknown>|undefined;
async function withSheet<T>(task:()=>Promise<T>){
 if(sheetTask||quitting)throw Error('条码板正在处理，请稍候。');
 const current=Promise.resolve().then(task);
 sheetTask=current;
 try{return await current;}
 finally{sheetTask=undefined;}
}
function sendSystem(){
 try{if(window&&!window.isDestroyed()&&backups)window.webContents.send('system:event',backups.info());}
 catch(error){logError('backup status',error);}
}
function recordBackupProgress(at:Date){
 try{backups.recorded(at);}
 catch(error){logError('auto backup scheduling',error);}
}
const write=<T>(fn:()=>T):T=>{if(quitting||gate)throw Error('账本正在维护或程序正在退出，请稍后重试。');return fn();};
function writeScan(id:ScannerId,barcode:string,acceptedAt=Date.now(),revision=ledgerRevision,alreadyAccepted=false){
 if(quitting&&!alreadyAccepted)throw Error('程序正在退出，请等待备份完成。');
 const record=()=>{
  if(revision!==ledgerRevision)throw Error('账本已更换，本次扫码未记入，请重新扫描。');
  return engine.scan(id,barcode,acceptedAt);
 };
 return gate?gate.then(record):record();
}
async function maintain<T>(fn:()=>Promise<T>):Promise<T>{
 if(gate||quitting)throw Error('账本正在维护，请稍候再操作。');let release!:()=>void;gate=new Promise(resolve=>{release=resolve;});
 engine.pauseScanTimers();
 backups.maintenance=true;sendSystem();
 try{await csv.idle();await backups.idle();return await fn();}
 finally{
  release();
  // Reconcile queued scans in arrival order before allowing wall-clock expiry again.
  await Promise.resolve();
  engine.resumeScanTimers();
  backups.maintenance=false;gate=null;sendSystem();engine.notify('维护完成，已恢复扫码。');
 }
}
function bindLedger(next:Ledger){ledger=next;ledgerRevision++;engine.replaceLedger(next);ledger.onRecorded=recordBackupProgress;backups.resetCounter();raw?.refreshMappings();}
function isWindowSender(event:Electron.IpcMainEvent|Electron.IpcMainInvokeEvent,target:BrowserWindow|null){
 return !!target&&!target.isDestroyed()&&event.sender===target.webContents&&event.senderFrame===target.webContents.mainFrame;
}
function confirmPendingDiscard(target:BrowserWindow){
 const pendingRefunds=engine?.pendingRefundCount??0;
 const pending=[preparationDirty?'未保存的每日记录':'',pendingRefunds?`${pendingRefunds} 笔未确认的退款`:''].filter(Boolean);
 if(!pending.length)return Promise.resolve(true);
 discardPreparation??=dialog.showMessageBox(target,{
  type:'warning',title:'SteamLog · 有操作待处理',message:`还有${pending.join('和')}。`,
  detail:'可以返回继续处理。退出后，未保存的记录和未确认的退款请求会丢失。',
  buttons:['继续填写','放弃修改'],defaultId:0,cancelId:0,noLink:true
 }).then(result=>result.response===1).finally(()=>{discardPreparation=undefined;});
 return discardPreparation;
}
async function confirmation(message:string,detail:string){if(!window||quitting)return false;const result=await dialog.showMessageBox(window,{type:'warning',title:'SteamLog · 操作确认',message,detail,buttons:['取消','确认'],defaultId:0,cancelId:0,noLink:true});return result.response===1;}
if(!app.requestSingleInstanceLock())app.quit();else {
 app.on('second-instance',()=>{if(window?.isMinimized())window.restore();window?.show();window?.focus();});
 app.whenReady().then(async()=>{
  const icon=app.isPackaged?path.join(process.resourcesPath,'steamlog.png'):path.join(projectRoot,'resources','icons','steamlog.png');
  app.dock?.setIcon(icon);
  recoverInterruptedRestore(runtimeRoot);migrateLegacyLedger(runtimeRoot,projectRoot);ledger=await openWithRecovery(runtimeRoot,projectRoot,async details=>(await dialog.showMessageBox({type:'warning',title:'SteamLog · 账本恢复',message:'当前账本无法打开，需要从备份恢复。',detail:details,buttons:['退出并保留原文件','从已校验备份恢复'],defaultId:0,cancelId:0,noLink:true})).response===1);
  engine=new ScannerEngine(ledger,event=>{if(window&&!window.isDestroyed())window.webContents.send('engine:event',event);},undefined,logError);
  backups=new BackupService(runtimeRoot,projectRoot,()=>ledger,sendSystem);ledger.onRecorded=recordBackupProgress;csv=new CSVService(runtimeRoot,projectRoot,()=>ledger);
  const webPreferences={preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false};
  window=new BrowserWindow({width:1440,height:960,minWidth:960,minHeight:680,title:'SteamLog · 早餐店账本',icon,backgroundColor:'#f4f5f4',webPreferences});
  window.removeMenu();if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'SteamLog',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]}]));
  window.on('close',event=>{if(!exiting){event.preventDefault();app.quit();}});
  const recovery=new RecoverySchedule();
  const recoverRenderer=(reason:string)=>{logError('renderer recovery',reason);if(quitting||recoveryTimer)return;recoveryTimer=setTimeout(()=>{recoveryTimer=undefined;if(window&&!window.isDestroyed()&&!quitting){preparationDirty=false;window.webContents.reload();}},recovery.next());};
  window.webContents.on('render-process-gone',(_event,details)=>recoverRenderer(`${details.reason} (${details.exitCode})`));
  window.on('unresponsive',()=>recoverRenderer('Renderer unresponsive'));
  window.on('responsive',()=>{if(recoveryTimer){clearTimeout(recoveryTimer);recoveryTimer=undefined;}});
  const toggleFullscreen=()=>{if(!window)throw Error('程序窗口暂时无法使用，请重启程序。');window.setFullScreen(!window.isFullScreen());return window.isFullScreen();};
  const fullscreenChanged=()=>window?.webContents.send('window:fullscreen',window.isFullScreen());
  window.on('enter-full-screen',fullscreenChanged);window.on('leave-full-screen',fullscreenChanged);
  window.webContents.on('before-input-event',(event,input)=>{if(input.key==='F11'){event.preventDefault();if(input.type==='keyDown'&&!input.isAutoRepeat)toggleFullscreen();}});
  raw=new WinRawScannerService(runtimeRoot,projectRoot,app.isPackaged?path.join(process.resourcesPath,'win-raw-scanner','RawScannerListener.cs'):path.join(projectRoot,'resources','win-raw-scanner','RawScannerListener.cs'),{
   get:key=>(ledger.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value:string}|undefined)?.value??'',
   save:values=>write(()=>{
    const guns=['SCANNER_1','SCANNER_2'] as const;
    for(const gun of ledger.saveScannerMappings(values,guns.map(id=>[id,scannerMappingKey(id)] as const)))engine.resetRemappedScanner(gun);
   })
  },(gun,code,acceptedAt)=>{
   const failed=(error:unknown)=>{
    logError('hardware scan',error);
    engine.reportScanFailure(`本次扫码未记录。${readableError(error)} 请重新扫描。`,gun);
   };
   try{void Promise.resolve(writeScan(gun,code,acceptedAt)).catch(failed);}
   catch(error){failed(error);}
  },code=>foregroundGuard.raw(code),status=>{
   if(window&&!window.isDestroyed())window.webContents.send('raw-input:event',status);
  },logError,message=>engine.reportScanFailure(message));
  const handle=(channel:string,fn:(...args:any[])=>unknown)=>ipcMain.handle(channel,async(event,...args)=>{
   if(!isWindowSender(event,window))throw Error('请求来源无效，请关闭并重新打开程序。');
   try{return await fn(...args);}catch(error){logError(channel,error);throw Error(readableError(error));}
  });
  ipcMain.on('preparation:dirty',(event,dirty:unknown)=>{
   if(isWindowSender(event,window)&&typeof dirty==='boolean')preparationDirty=dirty;
  });
  handle('engine:snapshot',()=>engine.snapshot());handle('engine:scan',(id:ScannerId,barcode:string,source:ScanSource='manual')=>{
   if(quitting)throw Error('程序正在退出，请稍候。');
   if(typeof barcode!=='string'||barcode.length>128)throw Error('条码无效或过长，请重新扫描。');
   if(source!=='keyboard'&&source!=='manual'&&source!=='quick')throw Error('扫码来源无效，请重新扫描。');
   // Reject stale renderer key-capture requests immediately when Raw Input owns hardware.
   if(source==='keyboard'&&raw?.info().active)return;
   if(source==='manual')return writeScan(id,barcode);
   const acceptedAt=Date.now(),revision=ledgerRevision;
   return foregroundGuard.foreground(id,barcode,raw?.info().active??false,()=>writeScan(id,barcode,acceptedAt,revision,true),source==='quick');
  });
  handle('raw-input:info',()=>raw!.info());handle('raw-input:calibrate',(gun:GunId|null)=>write(()=>raw!.calibrate(gun)));handle('raw-input:swap',()=>write(()=>raw!.swap()));
  handle('toggle-fullscreen',toggleFullscreen);handle('window:is-fullscreen',()=>window!.isFullScreen());
  handle('engine:undo',(id:number,txUid:string)=>write(()=>{
   if(typeof txUid!=='string'||!txUid)throw Error('流水编号无效，请重新选择记录。');
   engine.manualUndo(id,txUid);
  }));
  handle('products:save',(input:ProductInput)=>write(()=>{const result=ledger.saveProduct(input);engine.notify('商品已保存，历史销售记录保持原样。');return result;}));
  handle('products:active',(id:number,active:boolean)=>write(()=>{ledger.setProductActive(id,active);engine.notify(active?'商品已启用，可以扫码记账。':'商品已停用，不再接受新的扫码。');}));
  handle('products:delete',(id:number)=>write(()=>{const result=ledger.deleteProduct(id);engine.notify(result.archived?'商品已归档，历史销售记录仍然保留。':'未使用过的商品已删除。');return result;}));
  handle('ledger:recent',(filter:LedgerFilter)=>ledger.recent(new Date(),filter));
  handle('refund:find',(search:RefundSearch)=>ledger.findRefundSales(search));
  handle('refund:open',()=>write(()=>engine.openRefund()));
  handle('refund:dismiss',(requestId:number)=>write(()=>engine.dismissRefund(requestId)));
  handle('refund:record',(requestId:number,id:number,txUid:string,quantity:number)=>write(()=>engine.confirmRefund(requestId,id,txUid,quantity)));
  handle('ledger:today-transactions',(filter:TodayTransactionFilter)=>ledger.todayTransactions(new Date(Date.now()),filter));
  handle('history:query',(request:AnalyticsRequest)=>queryHistory(ledger.db,request));
  handle('history:bounds',()=>({today:businessTime(new Date()).date,earliest:(ledger.db.prepare('SELECT min(business_date) date FROM transactions').get() as {date:string|null}).date}));
  handle('csv:export',(kind:ExportKind,range:DateRange)=>{if(gate||quitting)throw Error('账本正在维护，请完成后再导出。');return csv.export(kind,range);});
  handle('files:show',(file:string)=>{if(typeof file!=='string')throw Error('文件路径无效，请重新选择。');const real=contained(projectRoot,file);const allowed=[path.join(runtimeRoot,'exports'),path.join(runtimeRoot,'backups')].some(folder=>{const rel=path.relative(folder,real);return rel!==''&&!rel.startsWith('..')&&!path.isAbsolute(rel);});if(!allowed||!fs.existsSync(real))throw Error('只能打开本机现有的导出文件或备份文件。');shell.showItemInFolder(real);});
  handle('ledger:closeout',(date?:string)=>{
   const cutoff=new Date(Date.now());
   return maintain(()=>createCloseout(ledger,backups,cutoff,date));
  });
  handle('ledger:preparation',(bufferPercent:number)=>recommendPreparation(ledger.db,bufferPercent));
  handle('preparation:day',(date:string)=>({...preparationDay(ledger.db,date),ledgerRevision}));
  handle('preparation:save',(input:import('./types').PreparationDayInput,revision:number)=>write(()=>{
   if(revision!==ledgerRevision)throw Error('账本已更换，请放弃当前修改并重新读取这一天的记录。');
   const result=savePreparationDay(ledger.db,input);
   engine.notify('每日备货记录已保存，已更新推荐依据。');
   return {...result,ledgerRevision};
  }));
  handle('system:debounce',(ms:number)=>write(()=>{engine.setDebounce(ms);sendSystem();}));
  handle('system:info',()=>backups.info());handle('system:backup',()=>{if(gate||quitting)throw Error('账本正在维护，请稍后重试。');return backups.backup('manual');});
  handle('system:mirror',(folder:string)=>write(()=>backups.setMirror(folder)));
  handle('system:restore',async(filename:string)=>{if(!await confirmation('确认恢复这个备份？',`${filename}\n恢复会替换当前账本、商品和设置。程序会先完成恢复前安全备份；请暂停扫码，恢复完成后再继续。`))return false;await maintain(async()=>{await backups.restore(filename,bindLedger);});return true;});
  handle('system:clear',async()=>{if(!await confirmation('确认清空所有流水？', '此操作会删除全部流水和每日备货记录，包括真实销售、缺货、剩余和休息日标记，但保留商品。程序会先完成安全备份，需要时可以恢复。请核对账本，并在清空完成后再继续扫码。'))return false;await maintain(async()=>{await backups.backup('pre-clear-safety');clearTransactions(ledger);ledgerRevision++;backups.resetCounter();engine.replaceLedger(ledger);});return true;});
  handle('sheet:print',(paper:CounterPaper='Letter')=>withSheet(async()=>{
   if(paper!=='Letter'&&paper!=='A4')throw Error('请选择 Letter 或 A4 纸张。');
   await new Promise<void>((resolve,reject)=>{
    window!.webContents.print({silent:false,printBackground:false,pageSize:paper,scaleFactor:100},(success,reason)=>{
     if(success)resolve();
     else reject(Error(reason?.includes('No printers')?'没有找到可用打印机，请改用「保存 PDF」保存条码板。':'打印未完成，请检查打印机连接，或改用「保存 PDF」。'));
    });
   });
  }));
  handle('sheet:export',()=>withSheet(async()=>{
   const bytes=await window!.webContents.printToPDF({printBackground:false,preferCSSPageSize:true,displayHeaderFooter:false});
   const folder=contained(projectRoot,path.join(runtimeRoot,'exports'));
   fs.mkdirSync(folder,{recursive:true});
   const file=path.join(folder,`steamlog-counter-sheet-${Date.now()}-${randomUUID()}.pdf`),partial=file+'.partial';
   try{fs.writeFileSync(partial,bytes,{flag:'wx',flush:true});fs.renameSync(partial,file);}
   finally{fs.rmSync(partial,{force:true});}
   return file;
  }));
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  if(!app.isPackaged&&process.env.VITE_DEV_SERVER_URL)void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(__dirname,'../dist/index.html'));
  raw.start();
  void backups.startup().catch(error=>engine.notify(`开机备份未完成：${readableError(error)} 请到「备份与设置」查看。`));
 }).catch(error=>{logError('startup',error);if(!String(error).includes('已取消恢复'))dialog.showErrorBox('SteamLog · 启动未完成',readableError(error));exiting=true;raw?.stop();app.exit(1);});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{
  if(exiting)return;
  event.preventDefault();
  if(quitting)return;
  if(window&&(preparationDirty||engine?.pendingRefundCount)){
   void confirmPendingDiscard(window).then(discard=>{
    if(discard){preparationDirty=false;engine?.clearRefunds();app.quit();}
   }).catch(error=>logError('pending work on quit',error));
   return;
  }
  raw?.stop();if(recoveryTimer)clearTimeout(recoveryTimer);quitting=true;
  void(async()=>{
   await foregroundGuard.idle();if(gate)await gate;await sheetTask?.catch(()=>{});await csv?.idle();await backups?.idle();
   while(backups)try{await backups.backup('shutdown');break;}catch(error){const result=await dialog.showMessageBox({type:'error',title:'SteamLog · 退出备份未完成',message:'退出前的备份未完成，请重试。',detail:readableError(error),buttons:['重试备份','跳过本次备份并退出'],defaultId:0,cancelId:0,noLink:true});if(result.response===1)break;}
   engine?.close();if(ledger?.db.open)ledger.close();exiting=true;app.exit(0);
  })().catch(error=>{logError('shutdown',error);quitting=false;});
 });
}
