import {readableError} from '../electron/errors';
import {memo,useState} from 'react';
import {Closeout} from './Closeout';
import {RecentScans} from './RecentScans';
import type {Dashboard as DashboardData,Transaction,CloseoutResult} from '../electron/types';
import {hourLabel,labels,money,productName,scannerName,time} from './format';
import {addDays} from '../electron/ranges';
export type RunAction=(fn:()=>Promise<unknown>)=>Promise<void>;
export const Dashboard=memo(function Dashboard({data,recent,revision,last,run,onPreparation}:{data:DashboardData;recent:Transaction[];revision:number;last?:Transaction;run:RunAction;onPreparation:()=>void}){
 const [closeoutDate,setCloseoutDate]=useState<string>(),[closing,setClosing]=useState(false),[closeout,setCloseout]=useState<CloseoutResult>(),[closeError,setCloseError]=useState('');
 const openCloseout=async(date:string)=>{setCloseoutDate(date);setClosing(true);setCloseError('');try{setCloseout(await window.steam.closeout(date));}catch(error){setCloseError(readableError(error));}finally{setClosing(false);}};
 const latest=last??recent[0],ranked=data.ranking.filter(p=>p.quantity!==0||p.revenue!==0),max=Math.max(1,...ranked.map(p=>Math.max(0,p.quantity)));
 const s=data.summary,fullDay=data.currentHour<6||data.currentHour>18||data.hours.some(h=>(h.hour<6||h.hour>18)&&(h.quantity!==0||h.revenue!==0));
 const closeoutNeedsAction=data.closeoutBackupPending||data.closeoutChanged;
 const closeoutStatus=data.closeoutBackupPending?'日结备份待完成':data.closeoutChanged?'日结后有变动':data.closedOut?'今日已收工':'';
 return <div className="dashboard"><div className="dashboard-tools no-print">
  <button onClick={onPreparation}>明日备货推荐</button>
  <button className={closeoutNeedsAction?'closeout-update':'text-button'} disabled={closing} onClick={()=>void openCloseout(data.businessDate)}>{data.closeoutBackupPending?'重试日结备份':data.closeoutChanged?'更新日结并备份':'收工日结'}</button>
  {data.yesterdayUnfinished&&<button className="closeout-update" disabled={closing} onClick={()=>void openCloseout(addDays(data.businessDate,-1))}>补做昨日日结</button>}
  <span className={'closeout-status'+(closeoutNeedsAction?' closeout-changed':'')} role="status">{closeoutStatus}</span>
 </div>
  <section className={'last-scan '+(latest?.is_voided?'last-void':'')} aria-label="最近扫码" aria-live="polite"><div className="last-scan-content"><span className="scan-label">{latest?(latest.is_voided?'已撤销':latest.tx_type==='SALE'?'刚刚扫入':labels[latest.tx_type]):'随时开单'}</span>{latest?<><h1 title={latest.name_snapshot}>{productName(latest.name_snapshot)} <span>× {latest.quantity}</span></h1><p>{time.format(new Date(latest.created_at))} · {scannerName(latest.scanner_id)} · {latest.is_voided?'此笔已撤销，金额不计入营业额':latest.name_snapshot.replace(productName(latest.name_snapshot),'').trim()||'已记入今日账本'}</p></>:<><h1>扫一下，就记好了。</h1><p>扫码枪已就绪，直接扫描商品条码即可。</p></>}</div><div className="last-scan-amount">{latest&&<strong className={latest.is_voided?'struck':''}>{money(latest.subtotal_cents)}</strong>}</div></section>
  <section className="dashboard-kpis" aria-label="今日汇总"><article className="revenue-card"><h2>今日营业额</h2><strong className={money(s.revenue).length>9?'long-number':undefined}>{money(s.revenue)}</strong></article><article><h2>今日卖出总件数</h2><strong>{s.items.toLocaleString()} <span>件</span></strong></article><article className="bestseller-card"><h2>今日销冠</h2>{data.bestSeller?<><strong title={data.bestSeller.name}>{productName(data.bestSeller.name)}</strong><p><b>{data.bestSeller.quantity.toLocaleString()}</b> 件</p></>:<strong className="empty-kpi">等第一笔好生意</strong>}</article></section>
  <section className="dashboard-middle"><article className="panel sales-ranking"><div className="section-title"><h2>今日各商品销量</h2></div><div className="table-wrap"><table><thead><tr><th className="rank-cell">排名</th><th>商品名称</th><th>今日销量</th><th className="numeric">销售额</th></tr></thead><tbody>{ranked.map((p,i)=><tr key={p.product_id}><td className="rank-cell"><span className={'rank-number '+(i===0&&p.quantity>0?'first':'')}>{String(i+1).padStart(2,'0')}</span></td><td className="product-name" title={p.name}>{productName(p.name)}</td><td className="qty-cell"><div className="qty-line"><b>{p.quantity}</b><span className="volume-bar"><i style={{width:`${Math.max(0,p.quantity)/max*100}%`}}/></span></div></td><td className="numeric">{money(p.revenue)}</td></tr>)}</tbody></table>{!ranked.length&&<div className="empty">今日还没有销售记录<br/><span>扫入第一件商品，销量就会出现在这里。</span></div>}</div></article><article className="panel hourly"><div className="section-title"><h2>今日每小时销量</h2><span>{fullDay?'00:00 至 23:00':'06:00 至 18:00'}</span></div><HourlyChart data={data} fullDay={fullDay}/></article></section>
  <RecentScans key={data.businessDate} recent={recent} revision={revision} run={run}/>
  <footer className="dashboard-signature no-print" lang="en">
   <p className="dashboard-credit">Developed By <strong>PRES</strong> Coding On MacBookPro</p>
   <p className="dashboard-dedication">Shout Out To <strong lang="zh-CN">球球王</strong></p>
  </footer>
 {closeoutDate&&<Closeout date={closeoutDate} result={closeout?.date===closeoutDate?closeout:undefined} changed={closeoutDate===data.businessDate?data.closeoutChanged:closeoutDate===addDays(data.businessDate,-1)&&data.yesterdayUnfinished} busy={closing} error={closeError} onClose={()=>setCloseoutDate(undefined)} onRefresh={()=>void openCloseout(closeoutDate)}/>}</div>;
});
function HourlyChart({data,fullDay}:{data:DashboardData;fullDay:boolean}){
 const hours=data.hours.filter(h=>fullDay||h.hour>=6&&h.hour<=18),w=720,h=330,left=22,right=12,top=44,bottom=278,slot=(w-left-right)/hours.length,max=Math.max(1,...hours.map(v=>v.quantity)),min=Math.min(0,...hours.map(v=>v.quantity)),y=(n:number)=>bottom-(n-min)/(max-min)*(bottom-top),baseline=y(0);
 return <div className="hourly-chart"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={fullDay?'今日全天每小时净销量':'今日 06 时到 18 时每小时净销量'}><title>今日每小时销量，销售减退款，撤销不计入</title>{[.25,.5,.75,1].map(n=><line key={n} x1={left} x2={w-right} y1={top+(bottom-top)*(1-n)} y2={top+(bottom-top)*(1-n)} className="chart-grid"/>)}<line x1={left} x2={w-right} y1={baseline} y2={baseline} className="chart-baseline"/>{hours.map((v,i)=>{const x=left+slot*(i+.22),barY=y(v.quantity);return <g key={v.hour}><rect x={x} y={Math.min(barY,baseline)} width={slot*.56} height={Math.abs(barY-baseline)} rx="5" fill={v.quantity<0?'#A83A18':'#FF5A00'}><title>{`${hourLabel(v.hour)} 至 ${hourLabel(v.hour+1)}：${v.quantity} 件，${money(v.revenue)}`}</title></rect><text x={left+slot*(i+.5)} y={v.quantity<0?barY+20:barY-12} textAnchor="middle" className="hour-count">{v.quantity}</text>{(!fullDay||v.hour%2===0||v.hour===data.currentHour)&&<text x={left+slot*(i+.5)} y={bottom+30} textAnchor="middle" className="hour-label">{String(v.hour).padStart(2,'0')}</text>}</g>;})}</svg><p className="chart-caption">时间</p></div>;
}
