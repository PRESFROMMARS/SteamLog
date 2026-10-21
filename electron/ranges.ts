import type {AnalyticsRequest,DateRange,Granularity} from './types';
export function validDate(value:unknown):value is string {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'2199-12-31')return false;const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function validateRange(range:DateRange){if(!range||!validDate(range.start)||!validDate(range.end)||range.start>range.end)throw Error('请选择有效的起止日期（1900～2199 年），结束日期不能早于开始日期。');return range;}
export const addDays=(date:string,n:number)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export const dayCount=(range:DateRange)=>Math.round((Date.parse(range.end+'T12:00:00Z')-Date.parse(range.start+'T12:00:00Z'))/86400000)+1;
export function bucket(date:string,g:Granularity){if(g==='monthly')return date.slice(0,7);if(g==='daily')return date;const d=new Date(date+'T12:00:00Z');return addDays(date,-((d.getUTCDay()+6)%7));}
export function bucketKeys(range:DateRange,g:Granularity){const result:string[]=[];let prev='';for(let date=range.start;date<=range.end;date=addDays(date,1)){const key=bucket(date,g);if(key!==prev){result.push(key);prev=key;}}return result;}
export function validateHistory(request:AnalyticsRequest){validateRange(request);if(!['daily','weekly','monthly'].includes(request.granularity))throw Error('请选择按天、按周或按月统计。');return request;}
