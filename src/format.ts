export const money=(c:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',currencyDisplay:'narrowSymbol'}).format(c/100);
export const taipeiClock=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const taipeiHour=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
export const time=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export const labels={SALE:'销售',REFUND:'退款',GIFT:'赠送',WASTE:'报损'};
export const hourLabel=(h:number)=>`${String(h).padStart(2,'0')}:00`;
export const productName=(name:string)=>/[\u3400-\u9fff]/.test(name)?name.replace(/\s+[A-Za-z&].*$/,''):name;
export const scannerName=(id:string)=>id==='SCANNER_1'?'1 号枪':id==='SCANNER_2'?'2 号枪':'键盘';
export const backupTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
