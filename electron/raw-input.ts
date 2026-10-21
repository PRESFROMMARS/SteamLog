import type {GunId,RawDevice,RawInputStatus,ScannerId} from './types';
export interface RawScan {type:'scan';hDevice:string;deviceName:string;barcode:string;burstMs:number;ts:number}
export interface MappingStore {get(key:string):string;save(values:Record<string,string>):void}
const guns:GunId[]=['SCANNER_1','SCANNER_2'];
const key=(gun:GunId)=>gun==='SCANNER_1'?'scanner_1_device':'scanner_2_device';
const identity=(name:string)=>name.toUpperCase();
export function parseRawPacket(line:string):RawScan|{type:'ready'}|{type:'heartbeat'}|{type:'removed';deviceName:string;hDevice:string}{
 const p:unknown=JSON.parse(line);if(!p||typeof p!=='object')throw Error('Invalid Raw Input packet.');const v=p as Record<string,unknown>;
 if(v.type==='heartbeat')return {type:'heartbeat'};
 if(v.type==='ready'&&v.platform==='win32-raw-input')return {type:'ready'};
 if(typeof v.hDevice!=='string'||!/^0x[0-9a-f]{1,16}$/i.test(v.hDevice)||typeof v.deviceName!=='string'||!v.deviceName.startsWith('\\\\')||v.deviceName.length>4096)throw Error('Invalid hardware identity.');
 if(v.type==='removed')return {type:'removed',hDevice:v.hDevice,deviceName:v.deviceName};
 if(v.type!=='scan'||typeof v.barcode!=='string'||!/^[-_A-Z0-9!@#$%^&*()]{2,128}$/i.test(v.barcode)||typeof v.burstMs!=='number'||!Number.isFinite(v.burstMs)||v.burstMs<0||v.burstMs>4515||typeof v.ts!=='number'||!Number.isSafeInteger(v.ts))throw Error('Invalid scan packet.');
 return v as unknown as RawScan;
}
/** Hardware path (including serial/interface), not a transient handle or VID/PID alone. */
export class HardwareChannels {
 private devices=new Map<string,RawDevice>();
 calibrating:GunId|null=null;calibrationExpiresAt:number|null=null;
 constructor(private store:MappingStore,private changed:()=>void,private now=Date.now){
  try{const saved=JSON.parse(store.get('scanner_detected_devices')||'[]') as unknown;if(Array.isArray(saved))for(const value of saved.slice(0,64)){if(!value||typeof value!=='object')continue;const v=value as RawDevice;try{parseRawPacket(JSON.stringify({type:'scan',deviceName:v.deviceName,hDevice:v.hDevice,barcode:v.lastBarcode,burstMs:v.burstMs,ts:v.lastSeen}));this.devices.set(identity(v.deviceName),{...v,channel:null,connected:false});}catch{}}}catch{}
  this.refresh(false);
 }
 mappings():Record<GunId,string>{const a=this.store.get(key('SCANNER_1')),b=this.store.get(key('SCANNER_2'));return {SCANNER_1:a,SCANNER_2:identity(a)===identity(b)?'':b};}
 private save(mapping:Record<GunId,string>){this.store.save({[key('SCANNER_1')]:mapping.SCANNER_1,[key('SCANNER_2')]:mapping.SCANNER_2});}
 private refresh(notify=true){const mappings=this.mappings();for(const device of this.devices.values())device.channel=guns.find(g=>identity(mappings[g])===identity(device.deviceName))??null;if(notify)this.changed();}
 reload(){this.refresh();}
 calibrate(gun:GunId|null){if(gun!==null&&!guns.includes(gun))throw Error('扫码枪通道无效，请重新选择。');this.calibrating=gun;this.calibrationExpiresAt=gun?this.now()+30000:null;this.changed();}
 expire(){if(this.calibrationExpiresAt!==null&&this.now()>=this.calibrationExpiresAt)this.calibrate(null);}
 swap(){const m=this.mappings();this.save({SCANNER_1:m.SCANNER_2,SCANNER_2:m.SCANNER_1});this.calibrate(null);this.refresh();}
 disconnected(){for(const d of this.devices.values())d.connected=false;this.calibrate(null);}
 remove(name:string,handle:string){const d=this.devices.get(identity(name));if(d?.hDevice===handle){d.connected=false;this.changed();}}
 list(){return [...this.devices.values()].map(d=>({...d}));}
 receive(p:RawScan):{channel:GunId|null;calibrated:boolean}{
  this.expire();const id=identity(p.deviceName);let d=this.devices.get(id);
  if(!d){if(this.devices.size>=64){const evict=[...this.devices].find(([,v])=>!v.channel);if(evict)this.devices.delete(evict[0]);else throw Error('Hardware device limit reached.');}d={deviceName:p.deviceName,hDevice:p.hDevice,channel:null,lastBarcode:'',burstMs:0,lastSeen:0,connected:true};this.devices.set(id,d);}
  Object.assign(d,{hDevice:p.hDevice,lastBarcode:p.barcode,burstMs:p.burstMs,lastSeen:this.now(),connected:true});
  const mappings=this.mappings(),binding=this.calibrating;
  if(binding){const other:GunId=binding==='SCANNER_1'?'SCANNER_2':'SCANNER_1';if(identity(mappings[other])===id)mappings[other]=mappings[binding];mappings[binding]=p.deviceName;this.save(mappings);this.calibrate(null);}
  else if(!guns.some(g=>identity(mappings[g])===id)){const free=guns.find(g=>!mappings[g]);if(free){mappings[free]=p.deviceName;this.save(mappings);}}
  this.refresh();this.store.save({scanner_detected_devices:JSON.stringify(this.list())});return {channel:d.channel,calibrated:!!binding};
 }
}
/** Suppress the focused keyboard-wedge copy in either IPC/WM_INPUT delivery order. */
export class ForegroundScanGuard {
 private recent:{code:string;at:number}[]=[];
 private pending=new Set<{code:string;at:number;timer:ReturnType<typeof setTimeout>;resolve:()=>void}>();
 constructor(private now=Date.now){}
 raw(code:string){const at=this.now();code=code.trim().toUpperCase();this.recent=this.recent.filter(r=>at-r.at<80);this.recent.push({code,at});if(this.recent.length>256)this.recent.shift();for(const p of this.pending)if(p.code===code&&Math.abs(at-p.at)<=80){clearTimeout(p.timer);this.pending.delete(p);p.resolve();}}
 async foreground(id:ScannerId,code:string,active:boolean,deliver:()=>unknown,formEntry=false){
  if(!active||(id!=='KEYBOARD'&&!formEntry)){await deliver();return;}
  const at=this.now(),normalized=code.trim().toUpperCase();if(this.recent.some(r=>r.code===normalized&&Math.abs(at-r.at)<=80))return;
  await new Promise<void>((resolve,reject)=>{const pending={code:normalized,at,timer:setTimeout(()=>{this.pending.delete(pending);Promise.resolve().then(deliver).then(()=>resolve(),reject);},80),resolve};this.pending.add(pending);});
 }
 async idle(){while(this.pending.size)await new Promise(resolve=>setTimeout(resolve,10));}
}
export function standardStatus(platform:string):RawInputStatus{return {platform,active:false,state:'standard',message:'当前使用普通键盘扫码模式，多把扫码枪会共用键盘通道。',devices:[],mappings:{SCANNER_1:'',SCANNER_2:''},calibrating:null,calibrationExpiresAt:null};}
