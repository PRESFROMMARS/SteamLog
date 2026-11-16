import {useEffect,useRef,useState} from 'react';
import type {LoadedPreparationDay,PreparationDay,PreparationDayStatus} from '../electron/types';
import {readableError} from '../electron/errors';
import {addDays,validDate} from '../electron/ranges';
import {productName} from './format';

type DraftItem=PreparationDay['products'][number]&{preparedText:string;remainingText:string};
export function DailyPreparation({today,revision,onDirty,onSaved}:{today:string;revision:number;onDirty:(dirty:boolean)=>void;onSaved:()=>void}){
 const [date,setDate]=useState(today),[status,setStatus]=useState<PreparationDayStatus>('auto'),[completed,setCompleted]=useState(false),[rows,setRows]=useState<DraftItem[]>([]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0),[totalSales,setTotalSales]=useState(0);
 const ledgerRevision=useRef(-1);
 const [completedEdited,setCompletedEdited]=useState(false),[loadedDate,setLoadedDate]=useState('');
 const loaded=useRef({date:'',reload:-1,revision:-1});
 const editing=useRef({dirty,saving,completedEdited});editing.current={dirty,saving,completedEdited};
 const apply=(data:LoadedPreparationDay)=>{ledgerRevision.current=data.ledgerRevision;setStatus(data.status);setCompleted(data.completed);setCompletedEdited(false);setTotalSales(data.totalSales);setLoadedDate(data.date);setRows(data.products.map(p=>({...p,preparedText:p.prepared===null?'':String(p.prepared),remainingText:p.remaining===null?'':String(p.remaining)})));};
 useEffect(()=>{
  const full=loaded.current.date!==date||loaded.current.reload!==reload;
  if(full){setLoading(true);setError('');setMessage('');setRows([]);setLoadedDate('');}
  if(!validDate(date)){setError('请选择有效的记录日期。');setLoading(false);return;}
  if(saving||(!full&&loaded.current.revision===revision))return;
  let alive=true;
  window.steam.preparationDay(date).then(data=>{
   if(!alive||editing.current.saving)return;
   loaded.current={date,reload,revision};
   if(!editing.current.dirty){apply(data);return;}
   if(data.ledgerRevision!==ledgerRevision.current){setError('账本已更换，请先放弃这份补录并重新读取。');return;}
   setTotalSales(data.totalSales);
   if(!editing.current.completedEdited)setCompleted(data.completed);
   const sold=new Map(data.products.map(p=>[p.productId,p.sold]));
   setRows(previous=>previous.map(p=>({...p,sold:sold.get(p.productId)??p.sold})));
  }).catch(e=>{if(alive&&full)setError(readableError(e));}).finally(()=>{if(alive&&full)setLoading(false);});
  return()=>{alive=false;};
 },[date,reload,revision,saving]);
 const change=()=>{setDirty(true);onDirty(true);setMessage('');setError('');};
 const selectDate=(value:string)=>{if(dirty){setError('还有未保存的记录，请先保存或放弃修改，再切换日期。');return;}setDate(value);};
 const update=(id:number,patch:Partial<DraftItem>)=>{change();setRows(old=>old.map(p=>p.productId===id?{...p,...patch}:p));};
 const save=async()=>{if(saving||loading||!dirty||date!==loadedDate)return;setSaving(true);setError('');try{const value=await window.steam.savePreparationDay({date,status,completed:status==='closed'?false:completedEdited?completed:undefined,products:rows.map(p=>({productId:p.productId,stockout:p.stockout,prepared:p.preparedText.trim()===''?null:Number(p.preparedText),remaining:p.remainingText.trim()===''?null:Number(p.remainingText)}))},ledgerRevision.current);apply(value);setDirty(false);onSaved();setMessage(value.date===today&&value.completed?'已保存，今日销量已纳入明日备货。':'补录已保存。');}catch(e){setError(readableError(e));}finally{setSaving(false);}};
 const future=date>today,unavailable=loading||saving||date!==loadedDate,disabled=unavailable||status==='closed'||future;
 return <form className="daily-preparation" onSubmit={e=>{e.preventDefault();void save();}} aria-busy={loading||saving}>
  <div className="daily-record-tools"><label>记录日期<input type="date" aria-label="记录日期" value={date} min="1900-01-01" max={addDays(today,1)} required disabled={saving} onChange={e=>selectDate(e.target.value)}/></label><div className="daily-date-shortcuts"><button type="button" disabled={saving} onClick={()=>selectDate(today)}>今天</button><button type="button" disabled={saving} onClick={()=>selectDate(addDays(today,-1))}>昨天</button><button type="button" disabled={saving} onClick={()=>selectDate(addDays(today,1))}>明天</button></div><label>营业状态<select aria-label="营业状态" value={status} disabled={unavailable} onChange={e=>{change();setStatus(e.target.value as PreparationDayStatus);if(e.target.value==='closed')setCompleted(false);}}><option value="auto">自动判断</option><option value="open">正常营业</option><option value="closed">休息日</option></select></label></div>
  {date===today&&<label className="check completed-day"><input type="checkbox" checked={completed&&status!=='closed'} disabled={unavailable||status==='closed'} onChange={e=>{change();setCompletedEdited(true);setCompleted(e.target.checked);}}/>今日已收工，将今天纳入明日推荐</label>}
  {status==='closed'?<p className="notice">这天会从备货计算中排除。已有销售和每日记录仍然保留。{totalSales>0?`当天有 ${totalSales} 件有效销售，请确认休息标记无误。`:''}</p>:future?<p className="notice">可提前标记明天是否休息；实际备货、剩余和缺货请到当天再填写。</p>:<p className="note">实际备货请含当天补货；剩余量请在收工后填写。不知道就留空，0 代表确实没有。缺货表示营业期间想卖却没货。</p>}
  {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
  {loading?<p role="status">正在读取补录信息…</p>:<div className="table-wrap daily-record-table"><table><thead><tr><th>商品</th><th className="numeric">已售</th><th>实际备货（选填）</th><th>收工剩余（选填）</th><th>是否缺货</th></tr></thead><tbody>{rows.map(p=><tr key={p.productId} data-product-id={p.productId}><td className="product-name">{productName(p.name)}<small>{p.category}{!p.active?' · 已停用':''}</small></td><td className="numeric">{p.sold} 件</td><td><input type="number" inputMode="numeric" min="0" max="1000000" step="1" placeholder="未填写" aria-label={`${productName(p.name)}实际备货`} disabled={disabled} value={p.preparedText} onChange={e=>update(p.productId,{preparedText:e.target.value})}/></td><td><input type="number" inputMode="numeric" min="0" max="1000000" step="1" placeholder="未填写" aria-label={`${productName(p.name)}收工剩余`} disabled={disabled} value={p.remainingText} onChange={e=>update(p.productId,{remainingText:e.target.value})}/></td><td><label className="check"><input type="checkbox" aria-label={`${productName(p.name)}缺货`} disabled={disabled} checked={p.stockout} onChange={e=>update(p.productId,{stockout:e.target.checked})}/>缺货</label></td></tr>)}</tbody></table>{!rows.length&&<p className="empty">暂无商品，请先添加商品后再记录。</p>}</div>}
  <div className="form-actions daily-save"><span role="status">{dirty?'有未保存的修改':'记录保存在本机账本，随账本备份'}</span><button type="button" disabled={loading||saving||!dirty} onClick={()=>{setDirty(false);onDirty(false);setReload(n=>n+1);}}>放弃修改</button><button className="primary" disabled={unavailable||!dirty}>{saving?'正在保存…':'保存补录'}</button></div>
 </form>;
}
