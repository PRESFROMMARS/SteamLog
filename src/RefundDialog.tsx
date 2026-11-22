import {useEffect,useState} from 'react';
import {readableError} from '../electron/errors';
import type {RefundableSale,RefundRequest,RefundSearch} from '../electron/types';
import {Dialog} from './Dialog';
import {money,productName,scannerName,time} from './format';

export function RefundDialog({request,today,pendingCount}:{request:RefundRequest;today:string;pendingCount:number}){
 const [search,setSearch]=useState<RefundSearch>({date:request.date,query:request.sku,halfOnly:request.halfOnly,page:0});
 const [result,setResult]=useState<{search:RefundSearch;rows:RefundableSale[];more:boolean}>();
 const [selected,setSelected]=useState<RefundableSale>();
 const [quantity,setQuantity]=useState(String(request.quantity));
 const [error,setError]=useState('');
 const [saving,setSaving]=useState(false);
 const current=result?.search===search?result:undefined;
 useEffect(()=>{
  if(!search.date)return;
  let active=true;
  window.steam.findRefundSales(search).then(value=>{
   if(active)setResult({...value,search});
  }).catch(error=>{
   if(active){setError(readableError(error));setResult({search,rows:[],more:false});}
  });
  return()=>{active=false;};
 },[search]);
 const update=(patch:Partial<RefundSearch>)=>{
  setSelected(undefined);setError('');setSearch(old=>({...old,page:0,...patch}));
 };
 const count=Number(quantity);
 const valid=!!selected&&Number.isSafeInteger(count)&&count>=1&&count<=selected.refundable;
 async function finish(action:()=>Promise<unknown>){
  if(saving)return;
  setSaving(true);setError('');
  try{await action();}
  catch(error){setError(readableError(error));setSaving(false);}
 }
 const dismiss=()=>void finish(()=>window.steam.dismissRefund(request.id));
 const confirm=()=>{if(selected&&valid)void finish(()=>window.steam.refundSale(request.id,selected.id,selected.tx_uid,count));};
 return <Dialog title="按原销售流水退款" wide onClose={dismiss}>
  <p className="note">{request.sku?scannerName(request.scannerId):'今日看板发起'}{pendingCount>1&&` · 另有 ${pendingCount-1} 笔退款待处理`}</p>
  <p>找到原销售流水后，核对可退件数和实际成交价。</p>
  <div className="scan-list-filters">
   <label>原营业日<input type="date" value={search.date} max={today} disabled={saving} onChange={e=>update({date:e.target.value})}/></label>
   <label>商品<input type="search" value={search.query} maxLength={128} disabled={saving} onChange={e=>update({query:e.target.value})}/></label>
   <label><span>成交方式</span><select value={search.halfOnly?'half':'all'} disabled={saving} onChange={e=>update({halfOnly:e.target.value==='half'})}>
    <option value="all">全部成交方式</option><option value="half">仅半价销售</option>
   </select></label>
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  {search.date&&!current&&!error&&<p role="status">正在查找销售流水…</p>}
  {current&&current.rows.length>0?<div className="table-wrap scan-list-table"><table>
   <thead><tr><th>时间 / 流水号</th><th>商品</th><th>成交单价</th><th>可退件数</th><th>操作</th></tr></thead>
   <tbody>{current.rows.map(sale=><tr key={sale.tx_uid}>
    <td>{time.format(new Date(sale.created_at))}<small>第 {sale.id} 笔</small></td>
    <td>{productName(sale.name_snapshot)}{sale.half_price===1&&<small>半价销售</small>}</td>
    <td>{money(sale.unit_price_cents_snapshot)}</td><td>{sale.review_required?'需核对旧账':sale.refundable}</td>
    <td><button type="button" className="text-button" aria-pressed={selected?.id===sale.id} disabled={saving||sale.refundable<1||sale.review_required===1}
     onClick={()=>{setSelected(sale);setQuantity(String(Math.min(request.quantity,sale.refundable)));setError('');}}>
     {selected?.id===sale.id?'已选':'选择'}
    </button></td>
   </tr>)}</tbody>
  </table></div>:current&&!error&&<p className="empty">未找到销售流水，请核对日期和商品。</p>}
  {(search.page>0||current?.more)&&<div className="scan-list-pagination">
   <button type="button" disabled={saving||search.page===0} onClick={()=>update({page:search.page-1})}>上一页</button>
   <span>第 {search.page+1} 页</span>
   <button type="button" disabled={saving||!current?.more} onClick={()=>update({page:search.page+1})}>下一页</button>
  </div>}
  {selected&&<div className="scan-list-filters refund-amount">
   <label>退款件数<input type="number" min={1} max={selected.refundable} step={1} value={quantity} disabled={saving} onChange={e=>setQuantity(e.target.value)}/></label>
   <p>第 {selected.id} 笔 · {productName(selected.name_snapshot)}<br/><strong>应退 {valid?money(selected.unit_price_cents_snapshot*count):'—'}</strong></p>
  </div>}
  <div className="form-actions">
   <button type="button" disabled={saving} onClick={dismiss}>取消</button>
   <button className="primary" type="button" disabled={!valid||saving} onClick={confirm}>{saving?'正在处理…':'确认记入退款'}</button>
  </div>
 </Dialog>;
}
