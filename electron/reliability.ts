import {taipeiTimestamp} from './time';
import fs from 'node:fs';
import path from 'node:path';
/** Bounded local logs; logging errors must not recurse into uncaughtException. */
export function errorLogger(root:string){
 const file=path.join(root,'logs','error.log');
 return (context:string,error:unknown)=>{try{fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file)&&fs.statSync(file).size>2*1024*1024){fs.rmSync(file+'.1',{force:true});fs.renameSync(file,file+'.1');}fs.appendFileSync(file,`${taipeiTimestamp(new Date())} [${context}] ${error instanceof Error?error.stack:String(error)}\n`);}catch{}};
}
/** Back off after repeated failures; timers never busy-loop a broken renderer. */
export class RecoverySchedule {
 private failures=0;private last=0;
 next(now=Date.now()){if(now-this.last>60000)this.failures=0;this.last=now;return Math.min(30000,500*2**Math.min(this.failures++,6));}
}
