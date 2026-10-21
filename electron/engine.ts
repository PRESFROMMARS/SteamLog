import {Ledger} from './database';
import {SCANNERS,type ScannerId,type ScannerState,type EngineEvent,type Cue,type Transaction} from './types';
const gunName=(id:ScannerId)=>id==='SCANNER_1'?'1 号枪':id==='SCANNER_2'?'2 号枪':'键盘';
const modeName={SALE:'销售',REFUND:'退款',GIFT:'赠送',WASTE:'报损'};
const neutral=():ScannerState=>({multiplier:1,mode:'SALE',expiresAt:null});
export class ScannerEngine {
 states=Object.fromEntries(SCANNERS.map(id=>[id,neutral()])) as Record<ScannerId,ScannerState>;
 private batchTime:number|null=null;
 private accepted=new Map<ScannerId,{code:string;at:number}>();
 get debounceMs(){const value=Number((this.ledger.db.prepare("SELECT value FROM settings WHERE key='scan_debounce_ms'").get() as {value:string}|undefined)?.value??0);return Number.isInteger(value)&&value>=50&&value<=1000?value:0;}
 setDebounce(ms:number){if(!Number.isInteger(ms)||(ms!==0&&(ms<50||ms>1000)))throw Error('防重扫间隔须为 50～1000 毫秒，或 0 表示关闭。');this.ledger.db.prepare("INSERT INTO settings(key,value) VALUES('scan_debounce_ms',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(ms));this.accepted.clear();}

 private timestamp(){return this.batchTime??this.now();}
 private buffers=Object.fromEntries(SCANNERS.map(id=>[id,{text:'',at:0}])) as Record<ScannerId,{text:string;at:number}>;
 private timers=new Map<ScannerId,ReturnType<typeof setTimeout>>();
 constructor(public ledger:Ledger,private emit:(e:EngineEvent)=>void,private now=()=>Date.now()){}
 snapshot(){return {products:this.ledger.products(),...this.ledger.today(new Date(this.timestamp())),states:structuredClone(this.states)};}
 replaceLedger(ledger:Ledger){this.close();this.accepted.clear();for(const id of SCANNERS){this.reset(id);this.buffers[id]={text:'',at:0};}this.ledger=ledger;}
 notify(message:string){this.publish(message);}
 private publish(message:string,scannerId?:ScannerId,cue?:Cue,transaction?:Transaction,code?:string){this.emit({...this.snapshot(),message,scannerId,cue,transaction,code});}
 private valid(id:ScannerId){if(!SCANNERS.includes(id))throw Error('扫码通道无效，请重新选择扫码枪。');}
 reset(id:ScannerId){clearTimeout(this.timers.get(id));this.timers.delete(id);this.states[id]=neutral();}
 private arm(id:ScannerId){clearTimeout(this.timers.get(id));this.states[id].expiresAt=this.timestamp()+5000;this.timers.set(id,setTimeout(()=>{this.reset(id);this.publish(`${gunName(id)}：数量和模式已过期，已恢复为销售 1 件。`,id);},5000));}
 scan(id:ScannerId,raw:string){this.valid(id);if(typeof raw!=='string'||raw.length>128)throw Error('条码无效或过长，请重新扫描。');const code=raw.trim().toUpperCase();if(!code)return;
 const at=this.timestamp(),last=this.accepted.get(id),interval=this.debounceMs;
 if(interval&&last?.code===code&&at>=last.at&&at-last.at<interval){this.publish(`${gunName(id)}：已忽略 ${interval} 毫秒内的重复扫码 ${code}`,id,undefined,undefined,'SCAN_DUPLICATE_IGNORED');return;}
 this.accepted.set(id,{code,at});
 if(this.states[id].expiresAt!==null && this.timestamp()>=this.states[id].expiresAt!)this.reset(id);
 const mul=/^(?:MUL-0?(2|3|5|10)|X(2|3|5|10))$/.exec(code);
 if(mul){this.states[id].multiplier=Number(mul[1]??mul[2]);this.arm(id);this.publish(`${gunName(id)}：已准备${modeName[this.states[id].mode]} ${this.states[id].multiplier} 件，请扫描商品。`,id,'MODIFIER_SET');return;}
 if(['MOD-REFUND','MOD-GIFT','MOD-WASTE'].includes(code)){this.states[id].mode=code.slice(4) as ScannerState['mode'];this.arm(id);this.publish(`${gunName(id)}：已准备${modeName[this.states[id].mode]} ${this.states[id].multiplier} 件，请扫描商品。`,id,'MODIFIER_SET');return;}
 if(code==='ACT-RESET'){this.reset(id);this.buffers[id]={text:'',at:0};this.publish(`${gunName(id)}：已重置为销售 1 件。`,id,'MODIFIER_SET');return;}
 if(code==='ACT-UNDO'){const tx=this.ledger.undo(id,new Date(this.timestamp()));this.publish(tx?`${gunName(id)}：已撤销第 ${tx.id} 笔，${tx.name_snapshot} × ${tx.quantity}。`:`${gunName(id)}：没有可撤销的记录。`,id,tx?'UNDO_OK':undefined,tx);return tx;}
 const p=this.ledger.product(code);if(!p){this.publish(`${gunName(id)}：未识别条码「${code}」，请检查商品是否启用。`,id,'ERROR_UNKNOWN_SKU',undefined,'ERROR_UNKNOWN_SKU');return;}
 const state=this.states[id];const tx=this.ledger.record(p,id,state.multiplier,state.mode,new Date(this.timestamp()));this.reset(id);this.publish(`${gunName(id)}：${modeName[tx.tx_type]} · ${tx.name_snapshot} × ${tx.quantity} · ¥${(tx.subtotal_cents/100).toFixed(2)}`,id,tx.tx_type==='SALE'?'SUCCESS_SALE':'SPECIAL_RECORDED',tx);return tx;
 }
 character(id:ScannerId,char:string){this.valid(id);const b=this.buffers[id];if(this.timestamp()-b.at>1000)b.text='';b.at=this.timestamp();if(char==='\n'||char==='\r'){const text=b.text;b.text='';return this.scan(id,text);}if(char.length!==1)throw Error('扫码输入格式无效，请重新扫描。');if(b.text.length>=128){b.text='';throw Error('条码过长，请重新扫描。');}b.text+=char;}
 dualFire(){this.batchTime=this.now();try {this.reset('SCANNER_1');this.reset('SCANNER_2');this.accepted.delete('SCANNER_1');this.accepted.delete('SCANNER_2');this.buffers.SCANNER_1.text='';this.buffers.SCANNER_2.text='';const a='MUL-05\nB001\n',b='S001\n';const rows:Transaction[]=[];for(let i=0;i<Math.max(a.length,b.length);i++){if(a[i]){const tx=this.character('SCANNER_1',a[i]);if(tx)rows.push(tx);}if(b[i]){const tx=this.character('SCANNER_2',b[i]);if(tx)rows.push(tx);}}return {passed:rows.length===2&&rows.some(t=>t.scanner_id==='SCANNER_1'&&t.sku_snapshot==='B001'&&t.quantity===5)&&rows.some(t=>t.scanner_id==='SCANNER_2'&&t.sku_snapshot==='S001'&&t.quantity===1),ids:rows.map(t=>t.id)};} finally {this.batchTime=null;}}
 manualUndo(id:number){if(!Number.isSafeInteger(id)||id<1)throw Error('流水编号无效，请重新选择记录。');const tx=this.ledger.void(id,new Date(this.timestamp()));this.publish(tx?`已撤销第 ${tx.id} 笔 · ${tx.name_snapshot}`:'这笔流水已经撤销或不存在。',undefined,tx?'UNDO_OK':undefined,tx);}
 close(){for(const timer of this.timers.values())clearTimeout(timer);}
}
