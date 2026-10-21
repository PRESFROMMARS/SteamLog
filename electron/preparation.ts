import type Database from 'better-sqlite3';
import {businessTime} from './time';
import {addDays} from './ranges';
import type {PreparationResult,PreparationProduct,Product} from './types';

/** Completed-day demand with explicit closures and censored (sold-out) observations. */
export function recommendPreparation(db:Database.Database,bufferPercent=10,now=new Date()):PreparationResult {
 if(!Number.isInteger(bufferPercent)||bufferPercent<0||bufferPercent>50)throw Error('备货余量请输入 0～50 的整数百分比。');
 const today=businessTime(now).date,targetDate=addDays(today,1);
 const todayRecord=db.prepare('SELECT status,completed FROM preparation_days WHERE business_date=?').get(today) as {status:string;completed:number}|undefined;
 const includesToday=!!todayRecord?.completed&&todayRecord.status!=='closed',end=includesToday?today:addDays(today,-1),start=addDays(end,-27);
 const weekday=(date:string)=>new Date(date+'T12:00:00Z').getUTCDay();
 const calendar=db.prepare('SELECT business_date date,status,completed FROM preparation_days WHERE business_date BETWEEN ? AND ?').all(start,targetDate) as {date:string;status:string;completed:number}[];
 const closed=new Set(calendar.filter(r=>r.status==='closed').map(r=>r.date)),targetClosed=closed.has(targetDate);
 const salesDays=db.prepare("SELECT DISTINCT business_date date FROM transactions WHERE business_date BETWEEN ? AND ? AND is_voided=0 AND tx_type='SALE'").all(start,end) as {date:string}[];
 const notes=db.prepare('SELECT business_date date,product_id,stockout,prepared,remaining FROM preparation_items WHERE business_date BETWEEN ? AND ?').all(start,end) as {date:string;product_id:number;stockout:number;prepared:number|null;remaining:number|null}[];
 const days=[...new Set([...salesDays.map(r=>r.date),...calendar.filter(r=>(r.status==='open'||r.completed)&&r.status!=='closed'&&r.date<=end).map(r=>r.date),...notes.map(r=>r.date)])].filter(date=>!closed.has(date)).sort();
 const products=db.prepare('SELECT * FROM products WHERE is_active=1 ORDER BY category,sort_order,id').all() as Product[];
 const rows=db.prepare("SELECT product_id,business_date,sum(quantity) units FROM transactions WHERE business_date BETWEEN ? AND ? AND is_voided=0 AND tx_type='SALE' GROUP BY product_id,business_date").all(start,end) as {product_id:number;business_date:string;units:number}[];
 const firsts=new Map((db.prepare("SELECT product_id,min(date) date FROM (SELECT product_id,business_date date FROM transactions WHERE business_date<=? AND is_voided=0 AND tx_type='SALE' UNION ALL SELECT product_id,business_date date FROM preparation_items WHERE business_date<=?) GROUP BY product_id").all(end,end) as {product_id:number;date:string}[]).map(r=>[r.product_id,r.date]));
 const daily=new Map(rows.map(r=>[`${r.product_id}/${r.business_date}`,r.units]));
 const noteMap=new Map(notes.map(r=>[`${r.product_id}/${r.date}`,r]));
 const rounded=(n:number)=>Math.ceil(Number(n.toFixed(8)));
 const items:PreparationProduct[]=products.map(p=>{
  const first=firsts.get(p.id),observed=first?days.filter(day=>day>=first):[];
  const normal=observed.filter(date=>!noteMap.get(`${p.id}/${date}`)?.stockout);
  const recent=normal.slice(-7),matching=normal.filter(day=>weekday(day)===weekday(targetDate));
  const units=(date:string)=>daily.get(`${p.id}/${date}`)??0;
  const average=(dates:string[])=>dates.length?dates.reduce((n,date)=>n+units(date),0)/dates.length:null;
  const recentAverage=average(recent),weekdayAverage=average(matching);
  const baselineMethod=matching.length>=2?'weekday':'recent';
  const base=recentAverage===null?null:baselineMethod==='weekday'?weekdayAverage!*.6+recentAverage*.4:recentAverage;
  const shortage=observed.slice(-7).filter(date=>noteMap.get(`${p.id}/${date}`)?.stockout);
  // Stockout means observed sales are a lower bound, not measured lost demand.
  // Floor adds at least 10% (at least one unit), or the selected larger buffer, once.
  const maxShortage=Math.max(0,...shortage.map(units));
  const stockoutFloor=maxShortage>0?maxShortage+Math.max(1,rounded(maxShortage*Math.max(.1,bufferPercent/100))):null;
  const normalRecommendation=base===null?null:rounded(base*(1+bufferPercent/100));
  const recommended=targetClosed?0:normalRecommendation===null?stockoutFloor:Math.max(normalRecommendation,stockoutFloor??0);
  const inventory=observed.slice(-7).map(date=>noteMap.get(`${p.id}/${date}`)).filter((r):r is NonNullable<typeof r>=>!!r&&r.prepared!==null&&r.remaining!==null);
  const preparedTotal=inventory.reduce((n,r)=>n+r.prepared!,0),remainingTotal=inventory.reduce((n,r)=>n+r.remaining!,0);
  const advice=shortage.length?'increase':inventory.length>=2&&preparedTotal>0&&remainingTotal/preparedTotal>=.2?'reduce':inventory.length?'steady':'unknown';
  return {id:p.id,sku:p.sku,name:p.name,category:p.category,observedDays:normal.length,recentDays:recent.length,weekdayDays:matching.length,recentAverage,weekdayAverage,recommended,
   method:stockoutFloor!==null&&(normalRecommendation===null||stockoutFloor>normalRecommendation)?'stockout':baselineMethod,
   confidence:normal.length>=14&&matching.length>=2?'regular':normal.length>=7?'limited':'insufficient',
   stockoutDays:shortage.length,stockoutFloor,recordedDays:inventory.length,preparedAverage:inventory.length?preparedTotal/inventory.length:null,remainingAverage:inventory.length?remainingTotal/inventory.length:null,advice};
 });
 return {today,targetDate,start,end,bufferPercent,operatingDays:days.length,includesToday,closedDays:calendar.filter(r=>r.status==='closed'&&r.date<=end).length,targetClosed,products:items,total:items.reduce((n,p)=>n+(p.recommended??0),0),demoData:(db.prepare("SELECT value FROM settings WHERE key='demo_seeded'").get() as {value:string}|undefined)?.value==='1'};
}
