import {Ledger} from './database';
import {businessTime} from './time';
import {HALF_PRICE_BARCODE,SCANNERS,type ScannerId,type ScannerState,type EngineEvent,type RefundRequest,type Transaction} from './types';
const gunName=(id:ScannerId)=>id==='SCANNER_1'?'1 号枪':id==='SCANNER_2'?'2 号枪':'键盘';
const modeName={SALE:'销售',REFUND:'退款',GIFT:'赠送',WASTE:'报损'};
const neutral=():ScannerState=>({multiplier:1,mode:'SALE',halfPrice:false,expiresAt:null});
export class ScannerEngine {
 states=Object.fromEntries(SCANNERS.map(id=>[id,neutral()])) as Record<ScannerId,ScannerState>;
 private batchTime:number|null=null;
 private accepted=new Map<ScannerId,{code:string;at:number}>();
 private pendingRefunds:RefundRequest[]=[];
 private nextRefundId=1;
 get debounceMs(){const value=Number((this.ledger.db.prepare("SELECT value FROM settings WHERE key='scan_debounce_ms'").get() as {value:string}|undefined)?.value??0);return Number.isInteger(value)&&value>=50&&value<=1000?value:0;}
 setDebounce(ms:number){if(!Number.isInteger(ms)||(ms!==0&&(ms<50||ms>1000)))throw Error('防重扫间隔须为 50～1000 毫秒，或 0 表示关闭。');this.ledger.db.prepare("INSERT INTO settings(key,value) VALUES('scan_debounce_ms',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(ms));this.accepted.clear();}

 private timestamp(){return this.batchTime??this.now();}
 private buffers=Object.fromEntries(SCANNERS.map(id=>[id,{text:'',at:0}])) as Record<ScannerId,{text:string;at:number}>;
 private timers=new Map<ScannerId,ReturnType<typeof setTimeout>>();
 private scanTimersPaused=false;
 constructor(public ledger:Ledger,private emit:(e:EngineEvent)=>void,private now=()=>Date.now(),private log:(context:string,error:unknown)=>void=()=>{}){}
 snapshot(){return {products:this.ledger.products(),...this.ledger.today(new Date(this.timestamp())),states:structuredClone(this.states),pendingRefunds:structuredClone(this.pendingRefunds)};}
 replaceLedger(ledger:Ledger){this.close();this.accepted.clear();this.clearRefunds();for(const id of SCANNERS){this.reset(id);this.buffers[id]={text:'',at:0};}this.ledger=ledger;}
 notify(message:string){this.publish(message,{refresh:true});}
 reportScanFailure(message:string,id?:ScannerId){
  this.publish(id?`${gunName(id)}：${message}`:message,{scannerId:id,cue:'SCAN_FAILED',code:'SCAN_NOT_RECORDED'});
 }
 private publish(message:string,feedback:Omit<EngineEvent,'message'|'states'>={}){
  try{this.emit({...feedback,states:structuredClone(this.states),message});}
  catch(error){this.log('scan feedback',error);}
 }
 private valid(id:ScannerId){if(!SCANNERS.includes(id))throw Error('扫码通道无效，请重新选择扫码枪。');}
 reset(id:ScannerId){clearTimeout(this.timers.get(id));this.timers.delete(id);this.states[id]=neutral();}
 resetRemappedScanner(id:ScannerId){
  this.reset(id);
  this.accepted.delete(id);
  this.buffers[id]={text:'',at:0};
  this.publish(`${gunName(id)}：已更换设备，数量和模式已重置。`,{scannerId:id});
 }
 pauseScanTimers(){
  this.scanTimersPaused=true;
  this.close();
 }
 resumeScanTimers(){
  this.scanTimersPaused=false;
  for(const id of SCANNERS)this.scheduleExpiry(id);
 }
 private scheduleExpiry(id:ScannerId){
  clearTimeout(this.timers.get(id));
  const expiresAt=this.states[id].expiresAt;
  if(this.scanTimersPaused||expiresAt===null)return;
  this.timers.set(id,setTimeout(()=>{
   this.reset(id);
   this.publish(`${gunName(id)}：数量和模式已过期，已恢复为销售 1 件。`,{scannerId:id});
  },Math.max(0,expiresAt-this.now())));
 }
 private arm(id:ScannerId,at:number){
  this.states[id].expiresAt=at+5000;
  this.scheduleExpiry(id);
 }
 scan(id:ScannerId,raw:string,at=this.timestamp()){this.valid(id);if(typeof raw!=='string'||raw.length>128)throw Error('条码无效或过长，请重新扫描。');const code=raw.trim().toUpperCase();if(!code)return;
 if(code==='ACT-UNDO'&&id==='KEYBOARD'){
  this.publish('当前无法识别枪号，条码撤销已暂停。请在今日看板点选要撤销的流水。',{scannerId:id,code:'UNDO_SCANNER_UNAVAILABLE'});
  return;
 }
 const last=this.accepted.get(id),interval=this.debounceMs;
 if(interval&&last?.code===code&&at>=last.at&&at-last.at<interval){this.publish(`${gunName(id)}：已忽略 ${interval} 毫秒内的重复扫码 ${code}`,{scannerId:id,code:'SCAN_DUPLICATE_IGNORED'});return;}
 const result=this.processScan(id,code,at);
 this.accepted.set(id,{code,at});
 return result;
 }
 private processScan(id:ScannerId,code:string,at:number){
 const {expiresAt}=this.states[id];
 if(expiresAt!==null&&at>=expiresAt)this.reset(id);
 const state=this.states[id];
 const mul=/^(?:MUL-0?(2|3|5|10)|X(2|3|5|10))$/.exec(code);
 if(mul||code===HALF_PRICE_BARCODE||['MOD-REFUND','MOD-GIFT','MOD-WASTE'].includes(code)){
  if(mul)state.multiplier=Number(mul[1]??mul[2]);
  else if(code===HALF_PRICE_BARCODE){
   if(state.mode!=='REFUND')state.mode='SALE';
   state.halfPrice=true;
  }else{
   state.mode=code.slice(4) as ScannerState['mode'];
   if(state.mode!=='REFUND')state.halfPrice=false;
  }
  this.arm(id,at);
  this.publish(`${gunName(id)}：已准备${state.halfPrice?'半价':''}${modeName[state.mode]} ${state.multiplier} 件，请扫描商品。`,{scannerId:id,cue:'MODIFIER_SET'});
  return;
 }
 if(code==='ACT-RESET'){this.reset(id);this.buffers[id]={text:'',at:0};this.publish(`${gunName(id)}：已重置为销售 1 件。`,{scannerId:id,cue:'MODIFIER_SET'});return;}
 if(code==='ACT-UNDO'){
  const tx=this.ledger.undo(id,new Date(at));
  if(tx)this.publish(`${gunName(id)}：已撤销第 ${tx.id} 笔，${tx.name_snapshot} × ${tx.quantity}。`,{scannerId:id,cue:'UNDO_OK',transaction:tx});
  else this.publish(`${gunName(id)}：最近 60 秒内没有可撤销的记录。可在看板点选要撤销的流水。`,{scannerId:id,code:'UNDO_NOT_FOUND'});
  return tx;
 }
 if(state.mode==='REFUND'){
  this.enqueueRefund(id,code,state.multiplier,state.halfPrice,at);
  this.reset(id);
  this.notify(`${gunName(id)}：已收到退款请求，请核对原销售流水。`);
  return;
 }
 const p=this.ledger.product(code);if(!p){this.publish(`${gunName(id)}：未识别条码「${code}」，请检查商品是否启用。`,{scannerId:id,cue:'ERROR_UNKNOWN_SKU',code:'ERROR_UNKNOWN_SKU'});return;}
 const tx=this.ledger.record(p,id,state.multiplier,state.mode,new Date(at),state.halfPrice);
 this.reset(id);
 this.publish(`${gunName(id)}：${tx.half_price?'半价':''}${modeName[tx.tx_type]} · ${tx.name_snapshot} × ${tx.quantity} · ¥${(tx.subtotal_cents/100).toFixed(2)}`,{scannerId:id,cue:tx.tx_type==='SALE'?'SUCCESS_SALE':'SPECIAL_RECORDED',transaction:tx});
 return tx;
 }
 character(id:ScannerId,char:string){this.valid(id);const b=this.buffers[id];if(this.timestamp()-b.at>1000)b.text='';b.at=this.timestamp();if(char==='\n'||char==='\r'){const text=b.text;b.text='';return this.scan(id,text);}if(char.length!==1)throw Error('扫码输入格式无效，请重新扫描。');if(b.text.length>=128){b.text='';throw Error('条码过长，请重新扫描。');}b.text+=char;}
 dualFire(){this.batchTime=this.now();try {this.reset('SCANNER_1');this.reset('SCANNER_2');this.accepted.delete('SCANNER_1');this.accepted.delete('SCANNER_2');this.buffers.SCANNER_1.text='';this.buffers.SCANNER_2.text='';const a='MUL-05\nB001\n',b='S001\n';const rows:Transaction[]=[];for(let i=0;i<Math.max(a.length,b.length);i++){if(a[i]){const tx=this.character('SCANNER_1',a[i]);if(tx)rows.push(tx);}if(b[i]){const tx=this.character('SCANNER_2',b[i]);if(tx)rows.push(tx);}}return {passed:rows.length===2&&rows.some(t=>t.scanner_id==='SCANNER_1'&&t.sku_snapshot==='B001'&&t.quantity===5)&&rows.some(t=>t.scanner_id==='SCANNER_2'&&t.sku_snapshot==='S001'&&t.quantity===1),ids:rows.map(t=>t.id)};} finally {this.batchTime=null;}}
 private enqueueRefund(scannerId:ScannerId,sku:string,quantity:number,halfOnly:boolean,at:number){
  this.pendingRefunds.push({id:this.nextRefundId++,date:businessTime(new Date(at)).date,sku,quantity,scannerId,halfOnly});
 }
 get pendingRefundCount(){return this.pendingRefunds.length;}
 clearRefunds(){this.pendingRefunds=[];}
 openRefund(){
  if(this.pendingRefundCount)return;
  this.enqueueRefund('KEYBOARD','',1,false,this.timestamp());
  this.notify('请选择原销售流水，核对退款金额。');
 }
 private activeRefund(requestId:number){
  const request=this.pendingRefunds[0];
  if(!request||request.id!==requestId)throw Error('退款请求已经处理或失效，请重新选择。');
  return request;
 }
 dismissRefund(requestId:number){
  this.activeRefund(requestId);
  this.pendingRefunds.shift();
  this.notify('已取消本次退款请求。');
 }
 confirmRefund(requestId:number,id:number,txUid:string,quantity:number){
  const request=this.activeRefund(requestId);
  const tx=this.ledger.refundSale(id,txUid,quantity,request.scannerId,new Date(this.timestamp()));
  this.pendingRefunds.shift();
  return this.refundRecorded(tx);
 }
 refundSale(id:number,txUid:string,quantity:number,scannerId:ScannerId){
  return this.refundRecorded(this.ledger.refundSale(id,txUid,quantity,scannerId,new Date(this.timestamp())));
 }
 private refundRecorded(tx:Transaction){
  this.publish(`已记录退款 · ${tx.name_snapshot} × ${tx.quantity}`,{scannerId:tx.scanner_id,cue:'SPECIAL_RECORDED',transaction:tx});
  return tx;
 }
 manualUndo(id:number,txUid?:string){
  if(!Number.isSafeInteger(id)||id<1)throw Error('流水编号无效，请重新选择记录。');
  const tx=this.ledger.void(id,new Date(this.timestamp()),txUid);
  if(!tx&&txUid!==undefined&&this.ledger.get(id)?.tx_uid!==txUid)throw Error('这笔流水已发生变化，请从当前账本重新选择。');
  this.publish(tx?`已撤销第 ${tx.id} 笔 · ${tx.name_snapshot}`:'这笔流水已经撤销或不存在。',{cue:tx?'UNDO_OK':undefined,transaction:tx});
 }
 close(){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
}
