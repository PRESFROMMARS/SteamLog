import {readableError} from './errors';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {contained} from './paths';
import {HardwareChannels,parseRawPacket,standardStatus,type MappingStore,type RawScan} from './raw-input';
import type {GunId,RawInputStatus} from './types';
const execute=promisify(execFile);
export class WinRawScannerService {
 private child:ChildProcess|null=null;private stopped=false;private retry:ReturnType<typeof setTimeout>|null=null;private readyTimer:ReturnType<typeof setTimeout>|null=null;private heartbeat:ReturnType<typeof setInterval>|null=null;private failures=0;
 private status:RawInputStatus=standardStatus(process.platform);
 readonly channels:HardwareChannels;
 constructor(private root:string,private project:string,private source:string,store:MappingStore,private scan:(gun:GunId,code:string)=>void,private seen:(code:string)=>void,private changed:(status:RawInputStatus)=>void,private log:(context:string,error:unknown)=>void){this.channels=new HardwareChannels(store,()=>this.publish());}
 info():RawInputStatus{return {...this.status,devices:this.channels.list(),mappings:this.channels.mappings(),calibrating:this.channels.calibrating,calibrationExpiresAt:this.channels.calibrationExpiresAt};}
 private publish(){this.changed(this.info());}
 calibrate(gun:GunId|null){if(!this.status.active)throw Error('扫码枪尚未连接，请等待连接成功后再绑定。');this.channels.calibrate(gun);}
 swap(){if(!this.status.active)throw Error('扫码枪尚未连接，请等待连接成功后再互换。');this.channels.swap();}
 refreshMappings(){this.channels.reload();this.channels.calibrate(null);this.publish();}
 start(){if(process.platform!=='win32'){this.publish();return;}this.heartbeat=setInterval(()=>this.channels.expire(),1000);void this.launch();}
 private environment(){return {...process.env,TEMP:path.join(this.root,'temp'),TMP:path.join(this.root,'temp'),TMPDIR:path.join(this.root,'temp'),APPDATA:path.join(this.root,'userData'),LOCALAPPDATA:path.join(this.root,'userData'),HOME:this.root,USERPROFILE:this.root};}
 private async binary(){
  const folder=contained(this.project,path.join(this.root,'bin'));fs.mkdirSync(folder,{recursive:true});const binary=contained(this.project,path.join(folder,'RawScannerListener.exe'));const source=contained(this.project,this.source);
  if(fs.existsSync(binary)&&fs.statSync(binary).mtimeMs>=fs.statSync(source).mtimeMs)return binary;
  const windows=process.env.SystemRoot||'C:\\Windows';const compiler=['Framework64','Framework'].map(f=>path.join(windows,'Microsoft.NET',f,'v4.0.30319','csc.exe')).find(f=>fs.existsSync(f));
  if(!compiler)throw Error('电脑缺少扫码枪监听所需的系统组件，请联系家人检查 .NET Framework 4.x。');
  const temporary=contained(this.project,path.join(folder,'RawScannerListener.build.exe'));
  try{await execute(compiler,['/nologo','/noconfig','/target:exe','/platform:anycpu','/optimize+','/debug-',...['System.dll','System.Core.dll'].map(name=>'/reference:'+path.join(path.dirname(compiler),name)),'/out:'+temporary,source],{cwd:folder,env:this.environment(),windowsHide:true,timeout:30000,maxBuffer:256*1024});fs.renameSync(temporary,binary);}finally{fs.rmSync(temporary,{force:true});}
  return binary;
 }
 private async launch(){
  if(this.stopped)return;this.status={...this.status,active:false,state:'starting',message:'正在准备并连接扫码枪监听程序…'};this.publish();
  try{
   const binary=await this.binary();if(this.stopped)return;
   const child=spawn(binary,[String(process.pid)],{cwd:path.dirname(binary),env:this.environment(),windowsHide:true,stdio:['ignore','pipe','pipe']});this.child=child;
   let input='',failed=false,lastPulse=Date.now();let watchdog:ReturnType<typeof setInterval>|undefined;
   const fail=(error:unknown)=>{if(failed||this.stopped)return;failed=true;if(watchdog)clearInterval(watchdog);if(this.readyTimer)clearTimeout(this.readyTimer);this.readyTimer=null;this.child=null;child.kill();this.fallback(error);};
   this.readyTimer=setTimeout(()=>fail(Error('扫码枪监听程序连接超时，正在重试。')),10000);
   watchdog=setInterval(()=>{if(this.stopped){if(watchdog)clearInterval(watchdog);}else if(Date.now()-lastPulse>15000)fail(Error('扫码枪监听程序失去响应，正在重新连接。'));},5000);
   child.stdout!.setEncoding('utf8');child.stdout!.on('data',(chunk:string)=>{
    if(failed||this.stopped)return;
    input+=chunk;if(input.length>65536){fail(Error('扫码枪监听数据异常，正在重新连接。'));return;}
    let end:number;while((end=input.indexOf('\n'))>=0){const line=input.slice(0,end).replace(/\r$/,'');input=input.slice(end+1);if(!line)continue;
     try{const p=parseRawPacket(line);lastPulse=Date.now();if(p.type==='heartbeat')continue;if(p.type==='ready'){if(this.readyTimer)clearTimeout(this.readyTimer);this.readyTimer=null;this.status={...this.status,active:true,state:'ready',message:'两把扫码枪已连接，各自的数量和操作模式独立生效。'};this.publish();}
      else if(p.type==='removed')this.channels.remove(p.deviceName,p.hDevice);
      else if(this.status.active)this.receive(p);
     }catch(error){this.log('raw-input packet',error);this.status.message=`已忽略异常的扫码数据：${readableError(error)}`;this.publish();}
    }
   });
   child.stderr!.setEncoding('utf8');child.stderr!.on('data',(chunk:string)=>{if(failed||this.stopped)return;this.log('raw-input helper',chunk.slice(0,8192));this.status.message='扫码枪监听程序出现异常，请联系家人查看本机日志。';this.publish();});
   child.once('error',fail);child.once('exit',(code,signal)=>fail(Error(`扫码枪监听程序已退出，正在尝试重连。`)));
  }catch(error){this.fallback(error);}
 }
 private receive(p:RawScan){this.seen(p.barcode);const result=this.channels.receive(p);this.failures=0;if(result.calibrated){this.status.message=`${result.channel==='SCANNER_1'?'1 号枪':'2 号枪'}已绑定，本次绑定扫码没有记入销售。`;this.publish();return;}if(result.channel)this.scan(result.channel,p.barcode);else{this.status.message='检测到未绑定的设备，请先绑定扫码枪再使用。';this.publish();}}
 private fallback(error:unknown){if(this.stopped)return;this.log('raw-input disconnected',error);this.status={...this.status,active:false,state:'retrying',message:`扫码枪独立通道暂不可用：${readableError(error)} 当前仅支持窗口内键盘扫码，重连前两把枪不能独立工作。`};this.channels.disconnected();this.publish();const delay=Math.min(30000,1000*2**Math.min(this.failures++,5));this.retry=setTimeout(()=>void this.launch(),delay);}
 stop(){this.stopped=true;if(this.retry)clearTimeout(this.retry);if(this.readyTimer)clearTimeout(this.readyTimer);if(this.heartbeat)clearInterval(this.heartbeat);this.child?.kill();this.child=null;this.status={...this.status,active:false,state:'stopped',message:'扫码枪监听已停止。'};this.channels.disconnected();this.publish();}
}
