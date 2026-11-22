import type Database from 'better-sqlite3';
import {businessTime} from './time';
import {addDays} from './ranges';
import type {PreparationDayStatus,PreparationProduct,PreparationResult,Product} from './types';

type CalendarDay = {date:string;status:PreparationDayStatus;completed:number};
type SalesDay = {date:string;productId:number;units:number;halfPriceUnits:number};
type PreparationNote = {date:string;productId:number;stockout:number;prepared:number|null;remaining:number|null};
type Observation = {date:string;weekday:number;units:number;promotionHeavy:boolean;note:PreparationNote|undefined};

const weekday = (date:string) => new Date(date+'T12:00:00Z').getUTCDay();
const ceilUnits = (units:number) => Math.ceil(Number(units.toFixed(8)));
const averageSales = (days:Observation[]) =>
 days.length ? days.reduce((sum,day)=>sum+day.units,0)/days.length : null;

function median(values:number[]){
 const sorted=[...values].sort((a,b)=>a-b);
 const middle=Math.floor(sorted.length/2);
 return (sorted[middle]+sorted[Math.floor((sorted.length-1)/2)])/2;
}

function planningAverage(days:Observation[]){
 if(days.length<3)return averageSales(days);
 const typical=median(days.map(day=>day.units));
 if(typical===0)return averageSales(days);
 const deviation=median(days.map(day=>Math.abs(day.units-typical)));
 const ceiling=typical+Math.max(4,typical*.5,3*deviation);
 return days.reduce((total,day)=>total+Math.min(day.units,ceiling),0)/days.length;
}

function weekdayBaseline(days:Observation[], targetWeekday:number, recentWeekStart:string){
 const salesByWeekday=Array.from({length:7},()=>[] as number[]);
 for(const day of days)salesByWeekday[day.weekday].push(day.units);

 const typicalSales=salesByWeekday.map(sales=>sales.length>=3 ? median(sales) : null);
 const typicalTarget=typicalSales[targetWeekday];
 // Keep the average-based estimate for intermittent items whose median is zero.
 if(typicalTarget===null||typicalTarget===0)return null;

 const comparableWeekdays=typicalSales.filter(value=>value!==null);
 if(comparableWeekdays.length<2)return null;
 const typicalDay=median(comparableWeekdays);
 const comparisons=days.flatMap(day=>{
  const typical=typicalSales[day.weekday];
  return typical===null ? [] : [{date:day.date,change:day.units-typical}];
 });
 // Look for a recurring difference large enough to stand out from day-to-day noise.
 const noise=median(comparisons.map(day=>Math.abs(day.change)));
 const minGap=Math.max(1,typicalDay*.2,noise*3);
 const hasWeekdayPattern=salesByWeekday.some(sales=>
  sales.filter(units=>units>typicalDay+minGap).length>=3||
  sales.filter(units=>units<typicalDay-minGap).length>=3);
 if(!hasWeekdayPattern)return null;

 // Compare each recent day with its own weekday so a normal peak is not mistaken for growth.
 const changes=comparisons.filter(day=>day.date>=recentWeekStart).map(day=>day.change);
 return Math.max(0,typicalTarget+(changes.length>=3 ? median(changes) : 0));
}

function recommendProduct(product:Product, days:Observation[], targetWeekday:number, recentWeekStart:string, targetClosed:boolean, buffer:number):PreparationProduct {
 const normal=days.filter(({units,note,promotionHeavy})=>!promotionHeavy&&!note?.stockout&&(units>0||note?.prepared!==0));
 const recent=normal.slice(-7);
 const matching=normal.filter(day=>day.weekday===targetWeekday);
 const recentAverage=averageSales(recent);
 const weekdayAverage=averageSales(matching);
 const matchingBaseline=matching.length>=2?planningAverage(matching):null;
 const recentBaseline=planningAverage(recent);
 const fallback=recentBaseline===null||matchingBaseline===null?recentBaseline:matchingBaseline*.6+recentBaseline*.4;
 const seasonal=matching.length>=3 ? weekdayBaseline(normal,targetWeekday,recentWeekStart) : null;
 const baseline=seasonal??fallback;
 const normalRecommendation=baseline===null ? null : ceilUnits(baseline*(1+buffer));

 const recentOperatingDays=days.slice(-7);
 const shortagesByWeekday=Array.from({length:7},()=>0);
 for(const day of days)if(day.note?.stockout&&!day.promotionHeavy)shortagesByWeekday[day.weekday]++;
 const stockouts=recentOperatingDays.filter(day=>{
  if(!day.note?.stockout||day.promotionHeavy)return false;
  if(day.weekday===targetWeekday)return true;
  // Repeated sell-outs can leave no clean observations from a peak weekday.
  return seasonal===null&&(matching.length<2||shortagesByWeekday[day.weekday]<2);
 });
 // Sales on a sold-out day only show how much demand was served.
 const peakStockoutSales=Math.max(0,...stockouts.map(day=>day.units));
 const stockoutFloor=peakStockoutSales>0
  ? peakStockoutSales+Math.max(1,ceilUnits(peakStockoutSales*Math.max(.1,buffer)))
  : null;
 const useFloor=stockoutFloor!==null&&(normalRecommendation===null||stockoutFloor>normalRecommendation);

 let recordedDays=0,preparedTotal=0,remainingTotal=0;
 for(const {note} of recentOperatingDays){
  if(!note?.prepared||note.remaining===null)continue;
  recordedDays++;
  preparedTotal+=note.prepared;
  remainingTotal+=note.remaining;
 }
 const highLeftovers=recordedDays>=2&&remainingTotal/preparedTotal>=.2;
 const advice=stockouts.length ? 'increase' : highLeftovers ? 'reduce' : recordedDays ? 'steady' : 'unknown';

 return {
  id:product.id,sku:product.sku,name:product.name,category:product.category,
  observedDays:normal.length,recentDays:recent.length,weekdayDays:matching.length,
  recentAverage,weekdayAverage,
  recommended:targetClosed ? 0 : useFloor ? stockoutFloor : normalRecommendation,
  method:useFloor ? 'stockout' : matchingBaseline!==null ? 'weekday' : 'recent',
  confidence:normal.length>=14&&matchingBaseline!==null ? 'regular' : normal.length>=7 ? 'limited' : 'insufficient',
  stockoutDays:stockouts.length,stockoutFloor,recordedDays,
  promotionDays:days.filter(day=>day.promotionHeavy).length,
  preparedAverage:recordedDays ? preparedTotal/recordedDays : null,
  remainingAverage:recordedDays ? remainingTotal/recordedDays : null,
  advice
 };
}

export function recommendPreparation(db:Database.Database,bufferPercent=10,now=new Date()):PreparationResult {
 if(!Number.isInteger(bufferPercent)||bufferPercent<0||bufferPercent>50)throw Error('备货余量请输入 0～50 的整数百分比。');

 const today=businessTime(now).date;
 const targetDate=addDays(today,1);
 const calendar=db.prepare(`
  SELECT business_date AS date,status,completed FROM preparation_days
  WHERE business_date BETWEEN ? AND ?
 `).all(addDays(today,-28),targetDate) as CalendarDay[];
 const includesToday=calendar.some(day=>day.date===today&&day.completed===1&&day.status!=='closed');
 const end=includesToday ? today : addDays(today,-1);
 const start=addDays(end,-27);
 const recentWeekStart=addDays(end,-6);
 const closed=new Set(calendar.filter(day=>day.status==='closed').map(day=>day.date));
 const targetClosed=closed.has(targetDate);
 const targetWeekday=weekday(targetDate);
 const recordedOpenDays=calendar.filter(day=>day.date>=start&&day.date<=end&&(day.status==='open'||day.completed===1));

 const sales=db.prepare(`
  SELECT business_date AS date,product_id AS productId,sum(quantity) AS units,
   sum(CASE WHEN half_price=1 THEN quantity ELSE 0 END) AS halfPriceUnits
  FROM transactions
  WHERE business_date BETWEEN ? AND ? AND is_voided=0 AND tx_type='SALE'
  GROUP BY business_date,product_id
 `).all(start,end) as SalesDay[];
 const notes=db.prepare(`
  SELECT business_date AS date,product_id AS productId,stockout,prepared,remaining
  FROM preparation_items WHERE business_date BETWEEN ? AND ?
 `).all(start,end) as PreparationNote[];
 const dates=new Set([...sales,...notes,...recordedOpenDays].map(day=>day.date));
 const operatingDays=[...dates].filter(date=>!closed.has(date)).sort().map(date=>({date,weekday:weekday(date)}));
 const dailySales=new Map(sales.map(row=>[`${row.productId}/${row.date}`,row]));
 const dailyNotes=new Map(notes.map(row=>[`${row.productId}/${row.date}`,row]));

 // Begin zero-day observations after regular sales or a record of stock being offered.
 const products=db.prepare(`
  SELECT p.*,
   (SELECT t.business_date FROM transactions t
    WHERE t.product_id=p.id AND t.business_date<=? AND t.is_voided=0 AND t.tx_type='SALE'
    AND NOT EXISTS (SELECT 1 FROM preparation_days d WHERE d.business_date=t.business_date AND d.status='closed')
    GROUP BY t.business_date
    HAVING 2*sum(CASE WHEN t.half_price=1 THEN t.quantity ELSE 0 END)<sum(t.quantity)
    ORDER BY t.business_date LIMIT 1) AS firstSale,
   (SELECT i.business_date FROM preparation_items i
    WHERE i.product_id=p.id AND i.business_date<=? AND (i.prepared IS NOT 0 OR i.stockout=1)
    AND NOT EXISTS (SELECT 1 FROM preparation_days d WHERE d.business_date=i.business_date AND d.status='closed')
    ORDER BY i.business_date LIMIT 1) AS firstNote
  FROM products p WHERE p.is_active=1 ORDER BY p.category,p.sort_order,p.id
 `).all(end,end) as (Product&{firstSale:string|null;firstNote:string|null})[];
 const items=products.map(({firstSale,firstNote,...product})=>{
  const first=firstSale&&firstNote ? (firstSale<firstNote ? firstSale : firstNote) : firstSale??firstNote;
  const days=operatingDays.flatMap(day=>{
   const key=`${product.id}/${day.date}`;
   const sales=dailySales.get(key);
   const units=sales?.units??0;
   const promotionHeavy=!!sales&&sales.halfPriceUnits*2>=units;
   if(!promotionHeavy&&(!first||day.date<first))return [];
   return [{...day,units,promotionHeavy,note:dailyNotes.get(key)}];
  });
  return recommendProduct(product,days,targetWeekday,recentWeekStart,targetClosed,bufferPercent/100);
 });
 const demo=db.prepare("SELECT value FROM settings WHERE key='demo_seeded'").get() as {value:string}|undefined;

 return {
  today,targetDate,start,end,bufferPercent,operatingDays:operatingDays.length,includesToday,
  closedDays:[...closed].filter(date=>date>=start&&date<=end).length,targetClosed,
  products:items,total:items.reduce((sum,item)=>sum+(item.recommended??0),0),demoData:demo?.value==='1'
 };
}
