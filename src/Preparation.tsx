import {useEffect,useState} from 'react';
import type {PreparationResult} from '../electron/types';
import {readableError} from '../electron/errors';
import {productName} from './format';
import {Dialog} from './Dialog';
import {DailyPreparation} from './DailyPreparation';

export function Preparation({revision,today,onClose}:{revision:number;today:string;onClose:()=>void}){
 const [buffer,setBuffer]=useState(10),[result,setResult]=useState<PreparationResult>(),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 const [view,setView]=useState<'recommend'|'record'>('recommend'),[refresh,setRefresh]=useState(0),[dirty,setDirty]=useState(false),[pending,setPending]=useState<'close'|'recommend'|null>(null);
 useEffect(()=>{let alive=true;setBusy(true);setError('');const timer=setTimeout(()=>{window.steam.preparation(buffer).then(value=>{if(alive)setResult(value);}).catch(e=>{if(alive)setError(readableError(e));}).finally(()=>{if(alive)setBusy(false);});},150);return()=>{alive=false;clearTimeout(timer);};},[buffer,revision,today,refresh]);
 const navigate=(target:'close'|'recommend')=>{if(dirty){setPending(target);return;}if(target==='close')onClose();else setView('recommend');};
 const average=(n:number|null)=>n===null?'暂无':`${n.toFixed(1)} 件`;
 return <Dialog title="备货与每日记录" wide onClose={()=>navigate('close')}><div className="preparation" aria-busy={view==='recommend'&&busy}>
  <div className="subnav preparation-tabs"><button aria-pressed={view==='recommend'} onClick={()=>navigate('recommend')}>明日推荐</button><button aria-pressed={view==='record'} onClick={()=>setView('record')}>每日记录</button></div>
  {pending&&<div className="backup-warning" role="alert">还有未保存的每日记录。<button onClick={()=>{const target=pending;setPending(null);setDirty(false);if(target==='close')onClose();else setView('recommend');}}>放弃修改并继续</button><button onClick={()=>setPending(null)}>继续填写</button></div>}
  {view==='record'?<DailyPreparation today={today} onDirty={setDirty} onSaved={()=>{setDirty(false);setPending(null);setRefresh(n=>n+1);}}/>:<>
  <div className="preparation-tools"><div><h3>{result?`${result.targetDate} · ${new Intl.DateTimeFormat('zh-CN',{weekday:'long',timeZone:'Asia/Taipei'}).format(new Date(result.targetDate+'T12:00:00+08:00'))}`:'正在读取历史销量…'}</h3><p className="note">{result?.includesToday?'今天已标记收工，今日记录已纳入推荐。':'收工后到「每日记录」勾选已收工，今天的数据才会纳入推荐。'}</p></div><label>多备余量<select value={buffer} onChange={e=>setBuffer(Number(e.target.value))}>{[0,5,10,15,20,30,50].map(n=><option key={n} value={n}>{n}%{n===10?'（默认）':''}</option>)}</select></label></div>
  {error?<p className="error" role="alert">{error}</p>:busy?<p role="status">正在计算备货数量…</p>:result&&<>
   {result.demoData&&<p className="backup-warning" role="status">当前账本含模拟数据，以下仅供功能演示。请用真实营业记录积累备货依据。</p>}
   {result.targetClosed&&<p className="notice">明天已标记为休息日，建议备货为 0。可在「每日记录」选择明天修改。</p>}
   <div className="preparation-summary"><strong>建议备货合计 <b>{result.total.toLocaleString()}</b> 件</strong><span>参考 {result.start} 至 {result.end} · {result.operatingDays} 个营业日 · 已排除 {result.closedDays} 个休息日</span></div>
   {!result.operatingDays&&!result.targetClosed&&<p className="notice">还没有可参考的历史记录。先按经验少量备货，记录真实销售后，这里会自动给出建议。</p>}
   <div className="table-wrap preparation-table"><table><thead><tr><th>商品</th><th className="numeric">近期日均</th><th className="numeric">同星期日均</th><th className="numeric">建议备货</th><th>备货提示</th></tr></thead><tbody>{result.products.map(p=><tr key={p.id} data-product-id={p.id}><td className="product-name">{productName(p.name)}<small>{p.category}</small></td><td className="numeric">{average(p.recentAverage)}<small>{p.recentDays} 个未缺货营业日</small></td><td className="numeric">{average(p.weekdayAverage)}<small>{p.weekdayDays} 次未缺货记录</small></td><td className="numeric preparation-quantity">{p.recommended===null?'待积累':`${p.recommended} 件`}</td><td><span className={p.advice==='increase'?'stockout-advice':''}>{result.targetClosed?'明天休息':p.advice==='increase'?`近期 ${p.stockoutDays} 天缺货，可考虑增量`:p.advice==='reduce'?'近期剩余较多，可考虑减量':p.recommended===null?'暂无销量，按经验试备':p.confidence==='insufficient'?'数据较少，先少量试备':'按历史销量参考'}</span><small>{p.method==='stockout'&&p.stockoutFloor!==null?`缺货销量下限调整至 ${p.stockoutFloor} 件`:p.method==='weekday'?'同星期与近期销量综合':'参考近期未缺货销量'}{p.remainingAverage!==null?` · 日均剩余 ${p.remainingAverage.toFixed(1)} 件（${p.recordedDays} 天）`:''}</small></td></tr>)}</tbody></table>{!result.products.length&&<p className="empty">暂无启用的商品，请先在「商品与条码板」添加商品。</p>}</div>
   <details className="preparation-method"><summary>推荐怎么算？</summary><p>参考近 28 天，排除标记的休息日。自动判断时，有销售或每日备货记录才算营业；明确标记「正常营业」的日期也会纳入，即使销量为 0。今天只有勾选已收工后才会纳入，收工标记不锁账。</p><p>缺货日的销量只是需求下限，会从普通日均中排除。近期日均取最近最多 7 个未缺货营业日。同星期至少有 2 次未缺货记录时，按「同星期日均 × 60% ＋ 近期日均 × 40%」计算，再加所选余量。</p><p>最近 7 个营业日有缺货时，建议至少为其中最高缺货销量加 10%（至少加 1 件）；所选余量高于 10% 时采用该余量，不重复叠加。这只是试备下限，无法精确推断流失的订单。</p><p>最近 7 个营业日内，至少 2 天同时填写备货和剩余、合计剩余占备货 20% 以上时，显示减量提示；不额外扣减推荐，避免重复压低。退款、赠送、报损不当作销售。现存库存、节假日、天气和团购仍需人工考虑。</p></details>
  </>}
  <div className="form-actions"><button onClick={()=>setView('record')}>补录缺货与剩余</button><button className="primary" onClick={()=>navigate('close')}>知道了</button></div>
  </>}
 </div></Dialog>;
}
