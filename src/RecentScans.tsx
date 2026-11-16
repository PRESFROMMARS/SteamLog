import {useEffect,useState} from 'react';
import {readableError} from '../electron/errors';
import {SCANNERS,type TodayTransactionFilter,type TodayTransactionPage,type Transaction} from '../electron/types';
import type {RunAction} from './Dashboard';
import {labels,money,productName,scannerName,time} from './format';

const initialFilter:TodayTransactionFilter={scanner:'ALL',product:'',from:'',to:'',page:0};

export function RecentScans({recent,revision,run}:{recent:Transaction[];revision:number;run:RunAction}){
 const [expanded,setExpanded]=useState(false);
 const [filter,setFilter]=useState(initialFilter);
 const [response,setResponse]=useState<{filter:TodayTransactionFilter;page?:TodayTransactionPage;error?:string}>();
 const current=response?.filter===filter?response:undefined;

 useEffect(()=>{
  if(!expanded)return;
  let active=true;
  window.steam.todayTransactions(filter).then(page=>{
   if(active)setResponse({filter,page});
  }).catch(error=>{
   if(active)setResponse({filter,error:readableError(error)});
  });
  return()=>{active=false;};
 },[expanded,filter,revision]);

 const updateFilters=(patch:Partial<Omit<TodayTransactionFilter,'page'|'upperId'>>)=>setFilter(old=>({...old,...patch,page:0,upperId:undefined}));
 const turnPage=(step:number)=>setFilter(old=>({...old,page:old.page+step,upperId:old.upperId??current?.page?.rows[0]?.id}));
 const rows=expanded?current?.page?.rows??[]:recent.slice(0,15);
 const dayLabel=filter.day==='yesterday'?'昨日':'今日';

 return <section className="panel recent-scans">
  <div className="section-title">
   <h2>{expanded?`${dayLabel}全部流水`:'最近扫码记录'}</h2>
   <div className="scan-list-actions">
    {!expanded&&<span className="muted">最近 15 笔</span>}
    <button type="button" className="text-button" aria-expanded={expanded} aria-controls="scan-list" onClick={()=>{if(expanded)setFilter(initialFilter);setExpanded(!expanded);}}>
     {expanded?'返回最近 15 笔':'查看今日全部'}
    </button>
   </div>
  </div>
  <div id="scan-list" aria-busy={expanded&&!current}>
   {expanded&&<div className="scan-list-filters" role="group" aria-label="筛选流水">
    <label>营业日<select aria-label="营业日" value={filter.day??'today'} onChange={e=>updateFilters({day:e.target.value==='yesterday'?'yesterday':'today'})}>
     <option value="today">今天</option><option value="yesterday">昨天</option>
    </select></label>
    <label>枪号<select value={filter.scanner} onChange={e=>updateFilters({scanner:e.target.value as TodayTransactionFilter['scanner']})}>
     <option value="ALL">全部枪号</option>
     {SCANNERS.map(id=><option key={id} value={id}>{scannerName(id)}</option>)}
    </select></label>
    <label>商品<input type="search" placeholder="商品名称或条码" value={filter.product} maxLength={128} onChange={e=>updateFilters({product:e.target.value})}/></label>
    <label>开始时间<input type="time" value={filter.from} onChange={e=>updateFilters({from:e.target.value})}/></label>
    <label>结束时间<input type="time" value={filter.to} onChange={e=>updateFilters({to:e.target.value})}/></label>
   </div>}
   {current?.error&&expanded?<p className="error" role="alert">{current.error}</p>:<>
    <div className={'table-wrap'+(expanded?' scan-list-table':'')}><table>
     <thead><tr><th>时间</th><th>枪号</th><th>类型</th><th>商品</th><th className="numeric">数量</th><th className="numeric">金额</th><th className="action-cell"><span className="sr-only">操作</span></th></tr></thead>
     <tbody>{rows.map(t=><tr key={t.tx_uid} data-transaction-id={t.id} className={t.is_voided?'voided':''}>
      <td className="muted number">{time.format(new Date(t.created_at))}</td>
      <td className="transaction-scanner">{scannerName(t.scanner_id)}</td>
      <td><span className={'type-badge '+(t.is_voided?'void-type':t.tx_type)}>{t.is_voided?'已撤销':labels[t.tx_type]}</span></td>
      <td className="product-name" title={t.name_snapshot}>{productName(t.name_snapshot)}</td>
      <td className="numeric">×{t.quantity}</td>
      <td className="numeric">{money(t.subtotal_cents)}</td>
      <td className="action-cell"><button type="button" className="text-button" disabled={!!t.is_voided} onClick={()=>void run(()=>window.steam.undo(t.id,t.tx_uid))}>撤销</button></td>
     </tr>)}</tbody>
    </table></div>
    {expanded&&!current?<p className="scan-list-loading skeleton" role="status">正在读取流水…</p>:
     !rows.length&&<div className="empty">{expanded?'没有符合条件的流水':'等待第一笔扫码记录'}</div>}
   </>}
   {expanded&&(filter.page>0||current?.page?.hasNext||filter.upperId!==undefined)&&<div className="scan-list-pagination">
    <button type="button" disabled={filter.page===0} onClick={()=>turnPage(-1)}>上一页</button>
    <span>第 {filter.page+1} 页</span>
    <button type="button" disabled={!current?.page?.hasNext} onClick={()=>turnPage(1)}>下一页</button>
    {filter.upperId!==undefined&&<button type="button" onClick={()=>updateFilters({})}>刷新至最新</button>}
   </div>}
  </div>
 </section>;
}
