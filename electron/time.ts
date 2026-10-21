/** One accounting/display timezone for every installation, independent of OS settings. */
export const BUSINESS_TIMEZONE='Asia/Taipei';
const clock=new Intl.DateTimeFormat('en-US',{timeZone:BUSINESS_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
export function businessTime(now:Date){const p=Object.fromEntries(clock.formatToParts(now).map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour)};}
/** Storage keeps absolute ISO instants; human-readable exports/logs explicitly carry UTC+08:00. */
export function taipeiTimestamp(now:Date){return new Date(now.getTime()+8*60*60*1000).toISOString().replace('Z','+08:00');}
