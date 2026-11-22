import {readableError} from '../electron/errors';
import React,{memo,useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SCANNERS,type ScannerId,type Snapshot,type SteamAPI,type Transaction} from '../electron/types';
import {play,unlockAudio} from './sound';
import {Dashboard,type RunAction} from './Dashboard';
import {Products} from './Products';
import {Analytics} from './Analytics';
import {System} from './System';
import {presetRange} from './HistoryControls';
import type {AnalyticsRequest} from '../electron/types';
import {taipeiClock,taipeiHour,scannerName,transactionLabel} from './format';
import {Dialog} from './Dialog';
import {Preparation} from './Preparation';
import {RefundDialog} from './RefundDialog';
import {useKeyboardScanner} from './useKeyboardScanner';
import './style.css';
declare global {interface Window {steam:SteamAPI}}
type Tab='live'|'analytics'|'products'|'system'|'preparation';
const tabs:[Tab,string][]=[['live','今日看板'],['analytics','销售统计'],['products','商品与条码板'],['system','备份与设置'],['preparation','明日备货']];
type ScanWarningSource=ScannerId|'UNASSIGNED';
const scanWarningCodes=new Set(['ERROR_UNKNOWN_SKU','UNDO_NOT_FOUND','UNDO_SCANNER_UNAVAILABLE','SCAN_NOT_RECORDED']);
function App(){
 const initialToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(Date.now());
 const [historyRequest,setHistoryRequest]=useState<AnalyticsRequest>(()=>({...presetRange('30',initialToday,null),granularity:'daily'})),[historyPreset,setHistoryPreset]=useState('30'),[earliest,setEarliest]=useState<string|null>(null);
 const updateEarliest=useCallback((value:string|null)=>setEarliest(value),[]);
 useEffect(()=>{window.steam.historyBounds().then(value=>setEarliest(value.earliest)).catch(()=>{});},[]);
 const [data,setData]=useState<Snapshot>(),[revision,setRevision]=useState(0),[tab,setTab]=useState<Tab>('live');
 const [reportRevision,setReportRevision]=useState(0),[sheetBusy,setSheetBusy]=useState(false);
 const currentRevision=useRef(revision),reportTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 currentRevision.current=revision;
 useEffect(()=>{
  if(revision===reportRevision||reportTimer.current!==null)return;
  reportTimer.current=setTimeout(()=>{reportTimer.current=null;setReportRevision(currentRevision.current);},250);
 },[revision,reportRevision]);
 useEffect(()=>()=>{if(reportTimer.current!==null)clearTimeout(reportTimer.current);reportTimer.current=null;},[]);
 const [muted,setMuted]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [backupNotice,setBackupNotice]=useState(''),[fullscreen,setFullscreen]=useState(false);
 const [lastTransaction,setLastTransaction]=useState<Transaction>();
 const [scanStates,setScanStates]=useState<Snapshot['states']>();
 const refund=data?.pendingRefunds[0];
 const [scanWarnings,setScanWarnings]=useState<Partial<Record<ScanWarningSource,string>>>({});
 const dismissScanWarning=useCallback((source:ScanWarningSource)=>setScanWarnings(previous=>{
  if(!previous[source])return previous;
  const next={...previous};
  delete next[source];
  return next;
 }),[]);
 const [preparationDirty,setPreparationDirty]=useState(false),[pendingTab,setPendingTab]=useState<Tab|null>(null);
 const updatePreparationDirty=useCallback((dirty:boolean)=>{
  setPreparationDirty(dirty);
  window.steam.setPreparationDirty(dirty);
 },[]);
 const selectTab=(next:Tab)=>{
  if(next===tab||sheetBusy)return;
  if(tab==='preparation'&&preparationDirty)setPendingTab(next);
  else setTab(next);
 };

 useEffect(()=>{if(historyPreset!=='custom'){const range=presetRange(historyPreset,data?.dashboard.businessDate??initialToday,earliest);setHistoryRequest(r=>r.start===range.start&&r.end===range.end?r:{...r,...range});}},[data?.dashboard.businessDate,historyPreset,earliest]);
 const muteRef=useRef(muted);muteRef.current=muted;
 const run:RunAction=useCallback(async fn=>{setError('');try{void unlockAudio().catch(()=>{});await fn();}catch(e){setError(readableError(e));}},[]);
 const scanKeyboard=useCallback((barcode:string)=>{
  void window.steam.scan('KEYBOARD',barcode,'keyboard').catch(error=>{
   setScanWarnings(previous=>({...previous,KEYBOARD:`键盘扫码未记录。${readableError(error)} 请重新扫描。`}));
   if(!muteRef.current)play('SCAN_FAILED');
  });
 },[]);
 const rawStatus=useKeyboardScanner(scanKeyboard,setError);
 useEffect(()=>{
  let alive=true,requestVersion=0;
  let refreshTimer:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{
   const version=++requestVersion;
   window.steam.snapshot().then(snapshot=>{
    if(!alive||version!==requestVersion)return;
    setData(snapshot);
    setRevision(value=>value+1);
   }).catch(error=>{if(alive)setError(readableError(error));});
  };
  const scheduleRefresh=()=>{
   if(refreshTimer!==undefined)return;
   refreshTimer=setTimeout(()=>{refreshTimer=undefined;refresh();},100);
  };
  const off=window.steam.onEvent(e=>{
   if(!alive)return;
   setScanStates(e.states);
   if(e.transaction||e.refresh)scheduleRefresh();
   const maintenanceFinished=e.message.startsWith('维护完成');
   if(e.code==='SCAN_DUPLICATE_IGNORED')setMessage(`已忽略${scannerName(e.scannerId??'KEYBOARD')}的极速重复扫码`);
   else if(e.transaction)setMessage(`${e.transaction.is_voided?'已撤销':transactionLabel(e.transaction.tx_type,e.transaction.half_price)} · ${e.transaction.name_snapshot} × ${e.transaction.quantity}`);
   else if(e.cue==='MODIFIER_SET')setMessage('扫描设置已就绪，请扫描商品');
   else setMessage(maintenanceFinished?'维护完成，已恢复扫码':e.message);

   if(e.message.startsWith('开机备份未完成'))setError(e.message);
   if(e.code&&scanWarningCodes.has(e.code)){
    const source=e.scannerId??'UNASSIGNED';
    setScanWarnings(previous=>({...previous,[source]:e.message}));
   }else if(e.transaction&&e.scannerId){
    dismissScanWarning(e.scannerId);
   }
   if(e.transaction){
    const transaction=e.transaction;
    setLastTransaction(transaction);
    setEarliest(old=>!old||transaction.business_date<old?transaction.business_date:old);
   }else if(maintenanceFinished){
    setLastTransaction(undefined);
   }
   if(maintenanceFinished)void window.steam.historyBounds().then(bounds=>{if(alive)setEarliest(bounds.earliest);}).catch(()=>{});
   if(e.cue&&!muteRef.current)play(e.cue);
  });
  const systemStatus=(info:import('../electron/types').SystemInfo)=>{if(alive)setBackupNotice(info.backupError?'本机备份未完成，请到「备份与设置」查看。':info.mirrorError?'U盘备份暂时不可用，本机备份已完成。':'');};
  const offSystem=window.steam.onSystem(systemStatus);
  const fullStatus=(value:boolean)=>{if(alive)setFullscreen(value);};const offFullscreen=window.steam.onFullscreen(fullStatus);void window.steam.isFullscreen().then(fullStatus).catch(()=>{});void window.steam.systemInfo().then(systemStatus).catch(()=>{});
  refresh();let hourKey=taipeiHour.format(Date.now());
  // Only request fresh data when the Taipei hour/date changes, not on every clock tick.
  const timer=setInterval(()=>{const key=taipeiHour.format(Date.now());if(key!==hourKey){hourKey=key;refresh();}},1000);
  return()=>{alive=false;off();offSystem();offFullscreen();clearInterval(timer);clearTimeout(refreshTimer);};
 },[dismissScanWarning]);
 return <main><Telemetry states={scanStates??data?.states} muted={muted} toggleMute={()=>void run(async()=>setMuted(v=>!v))} fullscreen={fullscreen} toggleFullscreen={()=>void run(async()=>{await window.steam.toggleFullscreen();})} tab={tab} onTab={selectTab} navigationLocked={sheetBusy}/>
 <div className="workspace">{rawStatus?.platform==='win32'&&!rawStatus.active&&<div className="backup-warning no-print" role="status">扫码枪独立通道暂不可用。请在本窗口只用一把枪扫码；撤销请在「今日看板」点选流水。<details><summary>连接详情</summary>{rawStatus.message}</details></div>}{rawStatus?.active&&(!rawStatus.mappings.SCANNER_1||!rawStatus.mappings.SCANNER_2)&&<div className="backup-warning no-print" role="status">还有扫码枪尚未绑定。请到「备份与设置 → 扫码枪设置」绑定后试扫。</div>}{backupNotice&&<div className="backup-warning no-print" role="status">{backupNotice}</div>}{([...SCANNERS,'UNASSIGNED'] as const).map(source=>scanWarnings[source]&&<div className="error no-print" role="alert" key={source}>{scanWarnings[source]}<button onClick={()=>dismissScanWarning(source)} aria-label="关闭提示">×</button></div>)}{error&&<div className="error no-print" role="alert">操作未完成：{error}<button onClick={()=>setError('')} aria-label="关闭错误提示">×</button></div>}{(tab!=='live'||message.startsWith('已忽略'))&&message&&<p className="action-feedback no-print" role="status">{message}</p>}
 {!data?<div className="loading-layout" role="status" aria-label="正在打开本机账本"><div className="skeleton hero-skeleton"/><div className="loading-cards">{[0,1,2].map(i=><div key={i} className="skeleton"/>)}</div><span>正在打开本机账本…</span></div>:<div className="tab-content" key={tab}>{tab==='live'?<Dashboard data={data.dashboard} recent={data.recent} revision={revision} last={lastTransaction?.business_date===data.dashboard.businessDate?lastTransaction:undefined} run={run} onRefund={()=>void run(()=>window.steam.openRefund())} onPreparation={()=>selectTab('preparation')}/>:tab==='products'?<Products products={data.products} run={run} sheetBusy={sheetBusy} onSheetBusy={setSheetBusy}/>:tab==='analytics'?<Analytics request={historyRequest} onChange={setHistoryRequest} preset={historyPreset} onPreset={setHistoryPreset} today={data.dashboard.businessDate} earliest={earliest} onEarliest={updateEarliest} revision={reportRevision} run={run}/>:tab==='preparation'?<Preparation today={data.dashboard.businessDate} revision={reportRevision} dirty={preparationDirty} onDirty={updatePreparationDirty}/>:<System request={historyRequest} onChange={setHistoryRequest} preset={historyPreset} onPreset={setHistoryPreset} today={data.dashboard.businessDate} earliest={earliest} revision={reportRevision} run={run}/>}</div>}
 </div>{refund&&<RefundDialog key={refund.id} request={refund} today={data?.dashboard.businessDate??initialToday} pendingCount={data?.pendingRefunds.length??1}/>}
 {pendingTab&&<Dialog title="还有未保存的每日记录" onClose={()=>setPendingTab(null)}>
  <p>切换页面前，可以返回保存当前记录。</p>
  <div className="form-actions">
   <button type="button" onClick={()=>{updatePreparationDirty(false);setTab(pendingTab);setPendingTab(null);}}>放弃修改并切换</button>
   <button type="button" className="primary" data-initial-focus onClick={()=>setPendingTab(null)}>继续填写</button>
  </div>
 </Dialog>}</main>;
}
const Telemetry=memo(function Telemetry({states,muted,toggleMute,fullscreen,toggleFullscreen,tab,onTab,navigationLocked}:{states?:Snapshot['states'];muted:boolean;toggleMute:()=>void;fullscreen:boolean;toggleFullscreen:()=>void;tab:Tab;onTab:(tab:Tab)=>void;navigationLocked:boolean}){
 const [now,setNow]=useState(Date.now());useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(t);},[]);
 const armed=SCANNERS.flatMap(id=>{const s=states?.[id];return s&&(s.multiplier!==1||s.mode!=='SALE'||s.halfPrice)?[{id,...s}]:[];});
 return <header className="app-header no-print"><div className="brand"><span className="wordmark">SteamLog</span><time>{taipeiClock.format(now)}</time></div><nav className="navigation" aria-label="主导航">{tabs.map(([id,label])=><button key={id} disabled={navigationLocked} aria-current={tab===id?'page':undefined} onClick={()=>onTab(id)}>{label}</button>)}</nav><div className="header-actions"><div className="scanner-status" aria-live="polite">{armed.length?armed.map(s=><span className="armed-pill" key={s.id}><span>{scannerName(s.id)}</span><b>{s.mode==='SALE'&&!s.halfPrice?`×${s.multiplier} 待命`:`${transactionLabel(s.mode,s.halfPrice)}${s.multiplier>1?` ×${s.multiplier}`:'模式'}`}</b><span>{Math.max(0,Math.ceil(((s.expiresAt??now)-now)/1000))}s</span></span>):<span className="scanner-ready"><i/>扫码就绪</span>}</div><button className="header-icon" onClick={toggleMute} aria-pressed={muted} aria-label={muted?'开启声音':'静音'} title={muted?'开启声音':'静音'}>{muted?'🔇':'🔊'}</button><button className="header-icon fullscreen-button" onClick={toggleFullscreen} aria-pressed={fullscreen} aria-label={fullscreen?'退出全屏':'全屏模式'} title="全屏模式 (F11)">⛶</button></div></header>;
});
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
