import {useState} from 'react';
import type {AnalyticsRequest,DateRange} from '../electron/types';
import {addDays} from '../electron/ranges';
import type {RunAction} from './Dashboard';
export const presets=[['today','今天'],['yesterday','昨天'],['7','近 7 天'],['30','近 30 天'],['week','本周'],['month','本月'],['all','全部历史']] as const;
export function presetRange(preset:string,today:string,earliest:string|null):DateRange{
 let start=today,end=today;if(preset==='yesterday')start=end=addDays(today,-1);else if(preset==='7'||preset==='30')start=addDays(today,1-Number(preset));else if(preset==='week')start=addDays(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));else if(preset==='month')start=today.slice(0,7)+'-01';else if(preset==='all'){start=earliest&&earliest<today?earliest:today;if(earliest&&earliest>today)end=earliest;}return {start,end};
}
export function RangeControls({request,onChange,today,earliest,preset,onPreset,granularity=false}:{request:AnalyticsRequest;onChange:(r:AnalyticsRequest)=>void;today:string;earliest:string|null;preset:string;onPreset:(p:string)=>void;granularity?:boolean}){
 return <div className="range-controls"><div className="range-pills" role="group" aria-label="选择日期范围">{presets.map(([value,label])=><button key={value} aria-pressed={preset===value} onClick={()=>{onPreset(value);onChange({...request,...presetRange(value,today,earliest)});}}>{label}</button>)}</div><div className="date-pickers"><label><span className="sr-only">开始日期</span><input aria-label="开始日期" type="date" min="1900-01-01" max="2199-12-31" value={request.start} onChange={e=>{onPreset('custom');onChange({...request,start:e.target.value});}}/></label><span className="muted">至</span><label><span className="sr-only">结束日期</span><input aria-label="结束日期" type="date" min="1900-01-01" max="2199-12-31" value={request.end} onChange={e=>{onPreset('custom');onChange({...request,end:e.target.value});}}/></label></div>{granularity&&<GranularityControls request={request} onChange={onChange}/>}</div>;
}
export function GranularityControls({request,onChange}:{request:AnalyticsRequest;onChange:(r:AnalyticsRequest)=>void}){return <div className="segmented" role="group" aria-label="趋势周期">{([['daily','按日'],['weekly','按周'],['monthly','按月']] as const).map(([value,label])=><button key={value} aria-pressed={request.granularity===value} onClick={()=>onChange({...request,granularity:value})}>{label}</button>)}</div>;}
export function ExportButtons({range,run}:{range:DateRange;run:RunAction}){
 const [file,setFile]=useState(''),[busy,setBusy]=useState(false);
 const exportFile=(kind:'transactions'|'products')=>{setBusy(true);void run(async()=>setFile(await window.steam.exportCSV(kind,range))).finally(()=>setBusy(false));};
 return <div className="export-controls"><div className="export-buttons"><button className="primary" disabled={busy} onClick={()=>exportFile('transactions')}>{busy?'正在导出…':'导出明细 CSV'}</button><button className="primary outline" disabled={busy} onClick={()=>exportFile('products')}>导出商品汇总 CSV</button></div>{file&&<div className="export-result" role="status"><span>已导出，可直接用 Excel 打开。</span><button className="text-button" onClick={()=>void run(()=>window.steam.showInFolder(file))}>打开文件夹 ↗</button><details><summary>文件位置</summary><code>{file}</code></details></div>}</div>;
}
