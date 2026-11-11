import {useEffect,useState} from 'react';
import type {PreparationResult} from '../electron/types';
import {readableError} from '../electron/errors';
import {productName} from './format';
import {DailyPreparation} from './DailyPreparation';

export function Preparation({today,revision,dirty,onDirty}:{today:string;revision:number;dirty:boolean;onDirty:(dirty:boolean)=>void}){
 const [buffer,setBuffer]=useState(10),[forecast,setForecast]=useState<PreparationResult>(),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 const result=forecast?.today===today&&forecast.bufferPercent===buffer?forecast:undefined;
 const productCount=result?.products.length??0;
 const pendingCount=result?.products.filter(product=>product.recommended===null).length??0;
 const suggestedCount=productCount-pendingCount;
 const [supplementOpen,setSupplementOpen]=useState(false);
 const [confirmDiscard,setConfirmDiscard]=useState(false);

 useEffect(()=>{
  let alive=true;
  setBusy(true);
  setError('');
  const timer=setTimeout(()=>{
   window.steam.preparation(buffer).then(value=>{if(alive)setForecast(value);})
    .catch(error=>{if(alive)setError(readableError(error));})
    .finally(()=>{if(alive)setBusy(false);});
  },150);
  return()=>{alive=false;clearTimeout(timer);};
 },[buffer,revision,today]);

 const toggleSupplement=()=>{
  if(supplementOpen&&dirty){setConfirmDiscard(true);return;}
  setSupplementOpen(!supplementOpen);
 };
 const average=(n:number|null)=>n===null?'暂无':`${n.toFixed(1)} 件`;

 return <div className="preparation-page">
  <div className="page-title">
   <h1>明日备货</h1>
   <button type="button" className="text-button preparation-supplement-toggle" aria-expanded={supplementOpen}
    aria-controls={supplementOpen?'preparation-supplement':undefined} onClick={toggleSupplement}>
    {supplementOpen?'收起补录':'补录缺货或休息日'}
   </button>
  </div>
  {supplementOpen&&<section id="preparation-supplement" className="panel preparation-supplement" aria-label="补录缺货或休息日">
   {confirmDiscard&&<div className="backup-warning" role="alert">还有未保存的补录。
    <button type="button" onClick={()=>{setConfirmDiscard(false);onDirty(false);setSupplementOpen(false);}}>放弃修改并收起</button>
    <button type="button" onClick={()=>setConfirmDiscard(false)}>继续填写</button>
   </div>}
   <DailyPreparation today={today} onDirty={onDirty} onSaved={()=>{onDirty(false);setConfirmDiscard(false);}}/>
  </section>}
  <section className="preparation" aria-label="明日备货建议" aria-busy={busy}>
  <div className="preparation-tools"><div><h3>{result?`${result.targetDate} · ${new Intl.DateTimeFormat('zh-CN',{weekday:'long',timeZone:'Asia/Taipei'}).format(new Date(result.targetDate+'T12:00:00+08:00'))}`:'正在读取历史销量…'}</h3><p className="note">{result?.includesToday?'今天已标记收工，今日记录已纳入推荐。':'收工后点今日看板的「收工日结」，即可纳入当天销量。'}</p></div><label>多备余量<select value={buffer} onChange={e=>setBuffer(Number(e.target.value))}>{[0,5,10,15,20,30,50].map(n=><option key={n} value={n}>{n}%{n===10?'（默认）':''}</option>)}</select></label></div>
  {error?<p className="error" role="alert">{error}</p>:!result?<p role="status">正在计算备货数量…</p>:<>
   {result.targetClosed&&<p className="notice">明天已标记为休息日，建议备货为 0。可在「补录缺货或休息日」选择明天修改。</p>}
   <div className="preparation-summary">
    {suggestedCount>0
     ? <strong>建议备货合计 <b>{result.total.toLocaleString()}</b> 件</strong>
     : <strong>暂无备货建议</strong>}
    {productCount>0&&<span className="preparation-coverage">
     已给出 {suggestedCount} / {productCount} 款商品的建议{pendingCount>0&&` · ${pendingCount} 款待积累`}
    </span>}
    <span>参考 {result.start} 至 {result.end} · {result.operatingDays} 个营业日 · 已排除 {result.closedDays} 个休息日</span>
   </div>
   {!result.operatingDays&&!result.targetClosed&&<p className="notice">还没有可参考的历史记录。先按经验少量备货，记录真实销售后，这里会自动给出建议。</p>}
   <div className="table-wrap preparation-table"><table><thead><tr><th>商品</th><th className="numeric">近期日均</th><th className="numeric">同星期日均</th><th className="numeric">建议备货</th><th>备货提示</th></tr></thead><tbody>{result.products.map(p=><tr key={p.id} data-product-id={p.id}><td className="product-name">{productName(p.name)}<small>{p.category}</small></td><td className="numeric">{average(p.recentAverage)}<small>{p.recentDays} 个未缺货营业日</small></td><td className="numeric">{average(p.weekdayAverage)}<small>{p.weekdayDays} 次未缺货记录</small></td><td className="numeric preparation-quantity">{p.recommended===null?'待积累':`${p.recommended} 件`}</td><td><span className={p.advice==='increase'?'stockout-advice':''}>{result.targetClosed?'明天休息':p.advice==='increase'?`近期 ${p.stockoutDays} 天缺货，可考虑增量`:p.advice==='reduce'?'近期剩余较多，可考虑减量':p.recommended===null?'暂无销量，按经验试备':p.confidence==='insufficient'?'数据较少，先少量试备':'按历史销量参考'}</span><small>{p.method==='stockout'&&p.stockoutFloor!==null?`缺货销量下限调整至 ${p.stockoutFloor} 件`:p.method==='weekday'?'同星期与近期销量综合':'参考近期未缺货销量'}{p.remainingAverage!==null?` · 日均剩余 ${p.remainingAverage.toFixed(1)} 件（${p.recordedDays} 天）`:''}</small></td></tr>)}</tbody></table>{!result.products.length&&<p className="empty">暂无启用的商品，请先在「商品与条码板」添加商品。</p>}</div>
   <details className="preparation-method"><summary>推荐怎么算？</summary><p>参考近 28 天，排除标记的休息日。自动判断时，有销售或每日备货记录才算营业；明确标记「正常营业」的日期也会纳入，即使销量为 0。商品明确记录备货为 0 且无销售的日期会跳过。打开「收工日结」后，会自动纳入当天销量。</p><p>缺货日的销量只作为需求下限。同星期的高峰或低谷重复出现时，优先参考该星期销量排序后居中的水平，并结合最近一周各营业日相对平时的变化调整。星期规律不明显或历史较少时，结合近期日均估算。最后加上所选余量。</p><p>最近 7 个营业日有缺货时，建议至少为其中最高缺货销量加 10%（至少加 1 件）；所选余量高于 10% 时采用该余量，不重复叠加。这只是试备下限，无法精确推断流失的订单。</p><p>最近 7 个营业日内，至少 2 天记录了正数备货和剩余、合计剩余占备货 20% 以上时，显示减量提示；不额外扣减推荐，避免重复压低。退款、赠送、报损不当作销售。实际预测误差需用真实营业记录逐日回测。现存库存、节假日、天气和团购需按实际情况调整。</p></details>
  </>}
 </section></div>;
}
