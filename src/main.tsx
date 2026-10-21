import {readableError} from '../electron/errors';
import React,{memo,useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SCANNERS,type Snapshot,type SteamAPI,type RawInputStatus,type Transaction} from '../electron/types';
import {play,unlockAudio} from './sound';
import {Dashboard,type RunAction} from './Dashboard';
import {Products} from './Products';
import {Simulator} from './Simulator';
import {Analytics} from './Analytics';
import {System} from './System';
import {presetRange} from './HistoryControls';
import type {AnalyticsRequest} from '../electron/types';
import {taipeiClock,taipeiHour,scannerName,labels} from './format';
import {Dialog} from './Dialog';
import './style.css';
declare global {interface Window {steam:SteamAPI}}
type Tab='live'|'analytics'|'products'|'system';
const tabs:[Tab,string][]=[['live','今日看板'],['analytics','销售统计'],['products','商品与条码板'],['system','备份与设置']];
function App(){
 const initialToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(Date.now());
 const [historyRequest,setHistoryRequest]=useState<AnalyticsRequest>(()=>({...presetRange('30',initialToday,null),granularity:'daily'})),[historyPreset,setHistoryPreset]=useState('30'),[earliest,setEarliest]=useState<string|null>(null);
 const updateEarliest=useCallback((value:string|null)=>setEarliest(value),[]);
 useEffect(()=>{window.steam.historyBounds().then(value=>setEarliest(value.earliest)).catch(()=>{});},[]);
 const [data,setData]=useState<Snapshot>(),[revision,setRevision]=useState(0),[tab,setTab]=useState<Tab>('live');
 const [muted,setMuted]=useState(false),[simulator,setSimulator]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [backupNotice,setBackupNotice]=useState(''),[rawStatus,setRawStatus]=useState<RawInputStatus>(),[fullscreen,setFullscreen]=useState(false);
 const rawActive=useRef(false);
 const [lastTransaction,setLastTransaction]=useState<Transaction>(),[scanWarning,setScanWarning]=useState('');
 useEffect(()=>{if(historyPreset!=='custom'){const range=presetRange(historyPreset,data?.dashboard.businessDate??initialToday,earliest);setHistoryRequest(r=>r.start===range.start&&r.end===range.end?r:{...r,...range});}},[data?.dashboard.businessDate,historyPreset,earliest]);
 const muteRef=useRef(muted);muteRef.current=muted;
 const run:RunAction=useCallback(async fn=>{setError('');try{void unlockAudio().catch(()=>{});await fn();}catch(e){setError(readableError(e));}},[]);
 useEffect(()=>{
  let alive=true,eventVersion=0;
  const refresh=()=>{const version=eventVersion;window.steam.snapshot().then(s=>{if(alive&&version===eventVersion){setData(s);setLastTransaction(old=>old&&s.recent.some(t=>t.tx_uid===old.tx_uid)?old:undefined);setRevision(r=>r+1);}}).catch(e=>{if(alive)setError(readableError(e));});};
  const off=window.steam.onEvent(e=>{eventVersion++;if(!alive)return;setData(e);setRevision(r=>r+1);setMessage(e.code==='SCAN_DUPLICATE_IGNORED'?`已忽略${scannerName(e.scannerId??'KEYBOARD')}的极速重复扫码`:e.transaction?`${e.transaction.is_voided?'已撤销':labels[e.transaction.tx_type]} · ${e.transaction.name_snapshot} × ${e.transaction.quantity}`:e.cue==='MODIFIER_SET'?'扫描设置已就绪，请扫描商品':e.message.startsWith('维护完成')?'维护完成，已恢复扫码':e.code==='ACT-RESET'?'扫码枪已重置':e.message);if(e.message.startsWith('本次扫码未完成')||e.message.startsWith('开机备份未完成'))setError(e.message);setScanWarning(e.cue==='ERROR_UNKNOWN_SKU'?e.message:'');if(e.transaction)setLastTransaction(e.transaction);else setLastTransaction(old=>old&&e.recent.some(t=>t.tx_uid===old.tx_uid)?e.recent.find(t=>t.tx_uid===old.tx_uid):undefined);if(e.transaction)setEarliest(old=>!old||e.transaction!.business_date<old?e.transaction!.business_date:old);if(e.message.startsWith('维护完成'))void window.steam.historyBounds().then(bounds=>{if(alive)setEarliest(bounds.earliest);}).catch(()=>{});if(e.cue&&!muteRef.current)play(e.cue);});
  const systemStatus=(info:import('../electron/types').SystemInfo)=>{if(alive)setBackupNotice(info.backupError?'本机备份未完成，请到「备份与设置」查看。':info.mirrorError?'U盘备份暂时不可用，本机备份已完成。':'');};
  const offSystem=window.steam.onSystem(systemStatus);
  const fullStatus=(value:boolean)=>{if(alive)setFullscreen(value);};const offFullscreen=window.steam.onFullscreen(fullStatus);void window.steam.isFullscreen().then(fullStatus).catch(()=>{});void window.steam.systemInfo().then(systemStatus).catch(()=>{});
  refresh();let hourKey=taipeiHour.format(Date.now());
  // Only request fresh data when the Taipei hour/date changes, not on every clock tick.
  const timer=setInterval(()=>{const key=taipeiHour.format(Date.now());if(key!==hourKey){hourKey=key;refresh();}},1000);
  let buffer='',last=0;
  const clear=()=>{buffer='';last=0;};
  const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&(!!target.closest('input,textarea,select')||target.isContentEditable);
  const key=(e:KeyboardEvent)=>{
   if(editable(e.target)){clear();return;}
   if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey){clear();return;}
   if(Date.now()-last>1000)buffer='';last=Date.now();
   if((e.key==='Enter'||e.key==='Tab')&&buffer){e.preventDefault();const text=buffer;clear();if(!rawActive.current)void run(()=>window.steam.scan('KEYBOARD',text,'keyboard'));}
   else if(e.key.length===1){e.preventDefault();if(buffer.length>=128){clear();setError('条码过长，请重新扫描。');}else buffer+=e.key;}
   else if(e.key==='Escape')clear();
  };
  // Focusing an editor discards an unfinished scan rather than carrying it across tabs.
  const focus=(e:FocusEvent)=>{if(editable(e.target))clear();};
  let rawVersion=0;const rawUpdate=(value:RawInputStatus)=>{rawVersion++;if(alive){if(rawActive.current!==value.active)clear();rawActive.current=value.active;setRawStatus(value);}};const offRaw=window.steam.onRawInput(rawUpdate);const rawInitial=rawVersion;void window.steam.rawInputInfo().then(value=>{if(rawVersion===rawInitial)rawUpdate(value);}).catch(()=>{});
  window.addEventListener('keydown',key);window.addEventListener('blur',clear);window.addEventListener('focusin',focus);
  return()=>{alive=false;off();offSystem();offRaw();offFullscreen();clearInterval(timer);window.removeEventListener('keydown',key);window.removeEventListener('blur',clear);window.removeEventListener('focusin',focus);};
 },[run]);
 return <main><Telemetry states={data?.states} muted={muted} simulator={simulator} toggleMute={()=>void run(async()=>setMuted(v=>!v))} toggleSimulator={()=>setSimulator(v=>!v)} fullscreen={fullscreen} toggleFullscreen={()=>void run(async()=>{await window.steam.toggleFullscreen();})} tab={tab} onTab={setTab}/>
 <div className="workspace">{rawStatus?.platform==='win32'&&!rawStatus.active&&<div className="backup-warning no-print" role="status">扫码枪连接中，暂时使用键盘扫码。请在「备份与设置」查看连接状态。<details><summary>连接详情</summary>{rawStatus.message}</details></div>}{backupNotice&&<div className="backup-warning no-print" role="status">{backupNotice}</div>}{scanWarning&&<div className="error no-print" role="alert">{scanWarning}<button onClick={()=>setScanWarning('')} aria-label="关闭提示">×</button></div>}{error&&<div className="error no-print" role="alert">操作未完成：{error}<button onClick={()=>setError('')} aria-label="关闭错误提示">×</button></div>}{(tab!=='live'||message.startsWith('已忽略'))&&message&&<p className="action-feedback no-print" role="status">{message}</p>}
 {!data?<div className="loading-layout" role="status" aria-label="正在打开本机账本"><div className="skeleton hero-skeleton"/><div className="loading-cards">{[0,1,2].map(i=><div key={i} className="skeleton"/>)}</div><span>正在打开本机账本…</span></div>:<div className="tab-content" key={tab}>{tab==='live'?<Dashboard revision={revision} data={data.dashboard} recent={data.recent} last={lastTransaction} run={run}/>:tab==='products'?<Products products={data.products} run={run}/>:tab==='analytics'?<Analytics request={historyRequest} onChange={setHistoryRequest} preset={historyPreset} onPreset={setHistoryPreset} today={data.dashboard.businessDate} earliest={earliest} onEarliest={updateEarliest} revision={revision} run={run}/>:<System request={historyRequest} onChange={setHistoryRequest} preset={historyPreset} onPreset={setHistoryPreset} today={data.dashboard.businessDate} earliest={earliest} revision={revision} run={run}/>}</div>}
 </div>{simulator&&data&&<Dialog title="扫码模拟测试" wide onClose={()=>setSimulator(false)}><Simulator products={data.products} run={run}/></Dialog>}</main>;
}
const Telemetry=memo(function Telemetry({states,muted,simulator,toggleMute,toggleSimulator,fullscreen,toggleFullscreen,tab,onTab}:{states?:Snapshot['states'];muted:boolean;simulator:boolean;toggleMute:()=>void;toggleSimulator:()=>void;fullscreen:boolean;toggleFullscreen:()=>void;tab:Tab;onTab:(tab:Tab)=>void}){
 const [now,setNow]=useState(Date.now());useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(t);},[]);
 const armed=SCANNERS.flatMap(id=>{const s=states?.[id];return s&&(s.multiplier!==1||s.mode!=='SALE')?[{id,...s}]:[];});
 return <header className="app-header no-print"><div className="brand"><span className="wordmark">SteamLog</span><time>{taipeiClock.format(now)}</time></div><nav className="navigation" aria-label="主导航">{tabs.map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>onTab(id)}>{label}</button>)}</nav><div className="header-actions"><div className="scanner-status" aria-live="polite">{armed.length?armed.map(s=><span className="armed-pill" key={s.id}><span>{scannerName(s.id)}</span><b>{s.mode==='SALE'?`×${s.multiplier} 待命`:`${labels[s.mode]}${s.multiplier>1?` ×${s.multiplier}`:'模式'}`}</b><span>{Math.max(0,Math.ceil(((s.expiresAt??now)-now)/1000))}s</span></span>):<span className="scanner-ready"><i/>扫码就绪</span>}</div><button className="header-icon" onClick={toggleMute} aria-pressed={muted} aria-label={muted?'开启声音':'静音'} title={muted?'开启声音':'静音'}>{muted?'🔇':'🔊'}</button><button className="header-icon fullscreen-button" onClick={toggleFullscreen} aria-pressed={fullscreen} aria-label={fullscreen?'退出全屏':'全屏模式'} title="全屏模式 (F11)">⛶</button><button className="simulator-toggle" onClick={toggleSimulator} aria-expanded={simulator}>🛠️ 模拟测试</button></div></header>;
});
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
