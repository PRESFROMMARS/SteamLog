import type Database from 'better-sqlite3';
import {bucketKeys,dayCount,validateHistory,validateRange} from './ranges';
import type {AnalyticsRequest,DateRange,HistoryResult,HourActivity,RangeProduct,RangeSummary,TrendBucket} from './types';

const netUnits=(prefix='')=>`CASE WHEN ${prefix}is_voided=0 THEN CASE ${prefix}tx_type WHEN 'SALE' THEN ${prefix}quantity WHEN 'REFUND' THEN -${prefix}quantity ELSE 0 END ELSE 0 END`;
const netRevenue='CASE WHEN is_voided=0 THEN subtotal_cents ELSE 0 END';

export function queryRangeSummary(db:Database.Database,range:DateRange):RangeSummary {
 const {start,end}=validateRange(range);
 return db.prepare(`SELECT coalesce(sum(${netRevenue}),0) revenue,coalesce(sum(${netUnits()}),0) units,
 coalesce(sum(is_voided=0),0) validTransactions,coalesce(sum(is_voided),0) voids,coalesce(sum(CASE WHEN is_voided=1 THEN item_value_cents ELSE 0 END),0) voidValue,
 coalesce(sum(CASE WHEN is_voided=0 AND tx_type='SALE' THEN item_value_cents ELSE 0 END),0) gross,
 ${['REFUND','GIFT','WASTE'].map(type=>['Count','Units','Value'].map((suffix,i)=>`coalesce(sum(CASE WHEN is_voided=0 AND tx_type='${type}' THEN ${['1','quantity','item_value_cents'][i]} ELSE 0 END),0) ${type.toLowerCase()}${suffix}`).join(',')).join(',')}
 FROM transactions WHERE business_date BETWEEN ? AND ?`).get(start,end) as RangeSummary;
}

export function queryRangeProducts(db:Database.Database,range:DateRange):RangeProduct[] {
 const {start,end}=validateRange(range);
 const products=db.prepare(`SELECT p.id,p.sku,p.name,p.category,p.price_cents,p.is_active,
 coalesce(sum(${netUnits('t.')}),0) units,
 coalesce(sum(CASE WHEN t.is_voided=0 THEN t.subtotal_cents ELSE 0 END),0) revenue,
 coalesce(sum(CASE WHEN t.is_voided=0 AND t.tx_type='SALE' THEN t.item_value_cents ELSE 0 END),0) gross,
 ${['REFUND','GIFT','WASTE'].map(type=>['Units','Value'].map((suffix,i)=>`coalesce(sum(CASE WHEN t.is_voided=0 AND t.tx_type='${type}' THEN ${['t.quantity','t.item_value_cents'][i]} ELSE 0 END),0) ${type.toLowerCase()}${suffix}`).join(',')).join(',')}
 FROM products p LEFT JOIN transactions t ON t.product_id=p.id AND t.business_date BETWEEN ? AND ? GROUP BY p.id ORDER BY units DESC,revenue DESC,p.id`).all(start,end) as Omit<RangeProduct,'unitShare'|'revenueShare'|'peakHour'>[];
 const volume=products.reduce((n,p)=>n+Math.max(0,p.units),0);
 const revenue=products.reduce((n,p)=>n+Math.max(0,p.revenue),0);
 return products.map(p=>({...p,
  unitShare:volume?Math.max(0,p.units)/volume*100:0,
  revenueShare:revenue?Math.max(0,p.revenue)/revenue*100:0,
  peakHour:null
 }));
}

export function queryHistory(db:Database.Database,request:AnalyticsRequest):HistoryResult {
 const {start,end,granularity}=validateHistory(request);
 const keys=bucketKeys(request,granularity,4001);
 if(keys.length>4000)throw Error('统计范围过长，请改用按周或按月查看。');
 const summary=queryRangeSummary(db,request);
 const products=queryRangeProducts(db,request);
 const key=granularity==='daily'?'business_date':granularity==='monthly'?"substr(business_date,1,7)":"date(business_date, '-' || ((cast(strftime('%w', business_date) as integer)+6)%7) || ' days')";
 const rawTrend=db.prepare(`SELECT ${key} key,sum(${netUnits()}) units,sum(${netRevenue}) revenue FROM transactions WHERE business_date BETWEEN ? AND ? GROUP BY key ORDER BY key`).all(start,end) as TrendBucket[];
 const fill=(map:ReadonlyMap<string,TrendBucket>|undefined)=>keys.map(key=>map?.get(key)??{key,units:0,revenue:0});

 const byProduct=new Map<number,Map<string,TrendBucket>>();
 const trendRows=db.prepare(`SELECT product_id,${key} key,sum(${netUnits()}) units,sum(${netRevenue}) revenue FROM transactions WHERE business_date BETWEEN ? AND ? GROUP BY product_id,key`).iterate(start,end) as Iterable<TrendBucket&{product_id:number}>;
 for(const row of trendRows){
  let trend=byProduct.get(row.product_id);
  if(!trend){trend=new Map();byProduct.set(row.product_id,trend);}
  trend.set(row.key,row);
 }
 const hours=emptyHours();
 const byProductHours=new Map<number,HourActivity[]>();
 const hourRows=db.prepare(`SELECT product_id,hour_bucket hour,sum(${netUnits()}) quantity,sum(${netRevenue}) revenue FROM transactions WHERE business_date BETWEEN ? AND ? GROUP BY product_id,hour_bucket`).iterate(start,end) as Iterable<HourActivity&{product_id:number}>;
 for(const row of hourRows){
  if(!hours[row.hour])continue;
  let activity=byProductHours.get(row.product_id);
  if(!activity){activity=emptyHours();byProductHours.set(row.product_id,activity);}
  activity[row.hour]=row;
  hours[row.hour].quantity+=row.quantity;
  hours[row.hour].revenue+=row.revenue;
 }
 const productTrends:HistoryResult['productTrends']={},productHours:HistoryResult['productHours']={};
 for(const p of products){
  productTrends[p.id]=fill(byProduct.get(p.id));
  productHours[p.id]=byProductHours.get(p.id)??emptyHours();
  p.peakHour=productHours[p.id].filter(h=>h.quantity>0).sort((a,b)=>b.quantity-a.quantity||b.revenue-a.revenue||a.hour-b.hour)[0]?.hour??null;
 }
 const active=products.filter(p=>p.is_active);
 const min=active.reduce((least,p)=>Math.min(least,p.units),Infinity);
 return {...request,days:dayCount(request),summary,products,trend:fill(new Map(rawTrend.map(row=>[row.key,row]))),productTrends,productHours,hours,topUnits:products.find(p=>p.units>0)?.id??null,topRevenue:[...products].sort((a,b)=>b.revenue-a.revenue||a.id-b.id).find(p=>p.revenue>0)?.id??null,worstIds:active.filter(p=>p.units===min).map(p=>p.id),earliest:(db.prepare('SELECT min(business_date) date FROM transactions').get() as {date:string|null}).date};
}

function emptyHours():HourActivity[]{
 return Array.from({length:24},(_,hour)=>({hour,quantity:0,revenue:0}));
}
