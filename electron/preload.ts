import {contextBridge,ipcRenderer} from 'electron';
import type {SteamAPI,EngineEvent,SystemInfo} from './types';
const api:SteamAPI={
 setPreparationDirty:dirty=>ipcRenderer.send('preparation:dirty',dirty),
 snapshot:()=>ipcRenderer.invoke('engine:snapshot'),preparation:bufferPercent=>ipcRenderer.invoke('ledger:preparation',bufferPercent),preparationDay:date=>ipcRenderer.invoke('preparation:day',date),savePreparationDay:(input,revision)=>ipcRenderer.invoke('preparation:save',input,revision),closeout:date=>ipcRenderer.invoke('ledger:closeout',date),setDebounce:ms=>ipcRenderer.invoke('system:debounce',ms),scan:(id,barcode,source)=>ipcRenderer.invoke('engine:scan',id,barcode,source),undo:(id,txUid)=>ipcRenderer.invoke('engine:undo',id,txUid),
 saveProduct:input=>ipcRenderer.invoke('products:save',input),setProductActive:(id,active)=>ipcRenderer.invoke('products:active',id,active),deleteProduct:id=>ipcRenderer.invoke('products:delete',id),recent:filter=>ipcRenderer.invoke('ledger:recent',filter),todayTransactions:filter=>ipcRenderer.invoke('ledger:today-transactions',filter),
 printSheet:paper=>ipcRenderer.invoke('sheet:print',paper),exportSheet:()=>ipcRenderer.invoke('sheet:export'),
 history:request=>ipcRenderer.invoke('history:query',request),historyBounds:()=>ipcRenderer.invoke('history:bounds'),exportCSV:(kind,range)=>ipcRenderer.invoke('csv:export',kind,range),showInFolder:file=>ipcRenderer.invoke('files:show',file),
 systemInfo:()=>ipcRenderer.invoke('system:info'),backupNow:()=>ipcRenderer.invoke('system:backup'),setMirror:folder=>ipcRenderer.invoke('system:mirror',folder),restoreBackup:filename=>ipcRenderer.invoke('system:restore',filename),clearLedger:()=>ipcRenderer.invoke('system:clear'),
 rawInputInfo:()=>ipcRenderer.invoke('raw-input:info'),calibrateScanner:gun=>ipcRenderer.invoke('raw-input:calibrate',gun),swapScanners:()=>ipcRenderer.invoke('raw-input:swap'),toggleFullscreen:()=>ipcRenderer.invoke('toggle-fullscreen'),isFullscreen:()=>ipcRenderer.invoke('window:is-fullscreen'),
 onFullscreen:cb=>{const listener=(_event:Electron.IpcRendererEvent,value:boolean)=>cb(value);ipcRenderer.on('window:fullscreen',listener);return()=>ipcRenderer.removeListener('window:fullscreen',listener);},
 onRawInput:cb=>{const listener=(_event:Electron.IpcRendererEvent,value:import('./types').RawInputStatus)=>cb(value);ipcRenderer.on('raw-input:event',listener);return()=>ipcRenderer.removeListener('raw-input:event',listener);},
 onSystem:cb=>{const listener=(_event:Electron.IpcRendererEvent,data:SystemInfo)=>cb(data);ipcRenderer.on('system:event',listener);return()=>ipcRenderer.removeListener('system:event',listener);},
 onEvent:cb=>{const listener=(_event:Electron.IpcRendererEvent,data:EngineEvent)=>cb(data);ipcRenderer.on('engine:event',listener);return()=>ipcRenderer.removeListener('engine:event',listener);}
};
contextBridge.exposeInMainWorld('steam',api);
