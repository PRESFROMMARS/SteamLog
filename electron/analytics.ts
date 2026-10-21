import type Database from 'better-sqlite3';
import {bucketKeys,dayCount,validateHistory} from './ranges';
import type {AnalyticsRequest,HistoryResult,HourActivity,RangeProduct,RangeSummary,TrendBucket} from './types';
const netUnits="CASE WHEN is_voided=0 THEN CASE tx_type WHEN 'SALE' THEN quantity WHEN 'REFUND' THEN -quantity ELSE 0 END ELSE 0 END";
const netRevenue='CASE WHEN is_voided=0 THEN subtotal_cents ELSE 0 END';
export function queryHistory(db:Database.Database,request:AnalyticsRequest):HistoryResult {
 validateHistory(request);const {start,end,granularity}=request;const args=[start,end];
 const summary=db.prepare(`SELECT coalesce(sum(${netRevenue}),0) revenue,coalesce(sum(${netUnits}),0) units,
 coalesce(sum(is_voided=0),0) validTransactions,coalesce(sum(is_voided),0) voids,coalesce(sum(CASE WHEN is_voided=1 THEN item_value_cents ELSE 0 END),0) voidValue,
 coalesce(sum(CASE WHEN is_voided=0 AND tx_type='SALE' THEN item_value_cents ELSE 0 END),0) gross,
 ${['REFUND','GIFT','WASTE'].map(type=>['Count','Units','Value'].map((suffix,i)=>`coalesce(sum(CASE WHEN is_voided=0 AND tx_type='${type}' THEN ${['1','quantity','item_value_cents'][i]} ELSE 0 END),0) ${type.toLowerCase()}${suffix}`).join(',')).join(',')}
 FROM transactions WHERE business_date BETWEEN ? AND ?`).get(...args) as RangeSummary;
 const products=db.prepare(`SELECT p.id,p.sku,p.name,p.category,p.price_cents,p.is_active,
 coalesce(sum(${netUnits.replaceAll('is_voided','t.is_voided').replaceAll('tx_type','t.tx_type').replaceAll('quantity','t.quantity')}),0) units,
 coalesce(sum(CASE WHEN t.is_voided=0 THEN t.subtotal_cents ELSE 0 END),0) revenue,
 coalesce(sum(CASE WHEN t.is_voided=0 AND t.tx_type='SALE' THEN t.item_value_cents ELSE 0 END),0) gross,
 ${['REFUND','GIFT','WASTE'].map(type=>['Units','Value'].map((suffix,i)=>`coalesce(sum(CASE WHEN t.is_voided=0 AND t.tx_type='${type}' THEN ${['t.quantity','t.item_value_cents'][i]} ELSE 0 END),0) ${type.toLowerCase()}${suffix}`).join(',')).join(',')}
 FROM products p LEFT JOIN transactions t ON t.product_id=p.id AND t.business_date BETWEEN ? AND ? GROUP BY p.id ORDER BY units DESC,revenue DESC,p.id`).all(...args) as RangeProduct[];
 const key=granularity==='daily'?'business_date':granularity==='monthly'?"substr(business_date,1,7)":"date(business_date, '-' || ((cast(strftime('%w', business_date) as integer)+6)%7) || ' days')";
 const rawTrend=db.prepare(`SELECT ${key} key,sum(${netUnits}) units,sum(${netRevenue}) revenue FROM transactions WHERE business_date BETWEEN ? AND ? GROUP BY key ORDER BY key`).all(...args) as TrendBucket[];
 const keys=bucketKeys(request,granularity);if(keys.length>4000)throw Error('统计范围过长，请改用按周或按月查看。');
 const fill=(rows:TrendBucket[])=>{const map=new Map(rows.map(row=>[row.key,row]));return keys.map(key=>map.get(key)??{key,units:0,revenue:0});};
 const byProduct=db.prepare(`SELECT product_id,${key} key,sum(${netUnits}) units,sum(${netRevenue}) revenue FROM transactions WHERE business_date BETWEEN ? AND ? GROUP BY product_id,key ORDER BY key`).all(...args) as (TrendBucket&{product_id:number})[];
 const hourRows=db.prepare(`SELECT product_id,hour_bucket hour,sum(${netUnits}) quantity,sum(${netRevenue}) revenue FROM transactions WHERE business_date BETWEEN ? AND ? GROUP BY product_id,hour_bucket`).all(...args) as (HourActivity&{product_id:number})[];
 const productTrends:HistoryResult['productTrends']={},productHours:HistoryResult['productHours']={};
 const volume=products.reduce((n,p)=>n+Math.max(0,p.units),0),revenue=products.reduce((n,p)=>n+Math.max(0,p.revenue),0);
 for(const p of products){productTrends[p.id]=fill(byProduct.filter(row=>row.product_id===p.id));productHours[p.id]=Array.from({length:24},(_,hour)=>hourRows.find(row=>row.product_id===p.id&&row.hour===hour)??{hour,quantity:0,revenue:0});p.unitShare=volume?Math.max(0,p.units)/volume*100:0;p.revenueShare=revenue?Math.max(0,p.revenue)/revenue*100:0;p.peakHour=productHours[p.id].filter(h=>h.quantity>0).sort((a,b)=>b.quantity-a.quantity||b.revenue-a.revenue||a.hour-b.hour)[0]?.hour??null;}
 const active=products.filter(p=>p.is_active);const min=Math.min(...active.map(p=>p.units));
 return {...request,days:dayCount(request),summary,products,trend:fill(rawTrend),productTrends,productHours,hours:Array.from({length:24},(_,hour)=>({hour,quantity:hourRows.filter(r=>r.hour===hour).reduce((n,r)=>n+r.quantity,0),revenue:hourRows.filter(r=>r.hour===hour).reduce((n,r)=>n+r.revenue,0)})),topUnits:products.find(p=>p.units>0)?.id??null,topRevenue:[...products].sort((a,b)=>b.revenue-a.revenue||a.id-b.id).find(p=>p.revenue>0)?.id??null,worstIds:active.filter(p=>p.units===min).map(p=>p.id),earliest:(db.prepare('SELECT min(business_date) date FROM transactions').get() as {date:string|null}).date};
}
