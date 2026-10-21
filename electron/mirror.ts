import fs from 'node:fs';
import path from 'node:path';
import {contained,durableJSON} from './paths';
export interface MirrorConfig {folder:string;device:string;inode:string}
export function configuredMirror(runtimeRoot:string):MirrorConfig|null{
 const file=path.join(runtimeRoot,'mirror-config.json');if(!fs.existsSync(file))return null;
 const value=JSON.parse(fs.readFileSync(file,'utf8')) as MirrorConfig|null;
 if(value===null)return null;if(typeof value?.folder!=='string'||typeof value.device!=='string'||typeof value.inode!=='string')throw Error('U 盘备份设置无法读取，请重新选择备份文件夹。');return value;
}
function identity(folder:string):MirrorConfig {const stat=fs.statSync(folder,{bigint:true});if(!stat.isDirectory())throw Error('U 盘备份位置必须是文件夹。');return {folder:fs.realpathSync(folder),device:stat.dev.toString(),inode:stat.ino.toString()};}
export function saveMirror(runtimeRoot:string,projectRoot:string,input:string){
 if(typeof input!=='string')throw Error('备份文件夹路径无效，请重新填写。');const text=input.trim();if(!text){durableJSON(path.join(runtimeRoot,'mirror-config.json'),null);return;}
 let folder=path.resolve(projectRoot,text),internal=true;
 try{folder=contained(projectRoot,folder);}catch{internal=false;}
 if(internal)fs.mkdirSync(folder,{recursive:true});
 else {
  // External writes are restricted to the one existing folder explicitly configured in the UI.
  if(folder===path.parse(folder).root||/(^|[\\/])(Library|AppData|Windows|ProgramData|Program Files(?: \(x86\))?|System|usr|private|var|tmp)([\\/]|$)/i.test(folder))throw Error('请选择 U 盘或备用磁盘上的文件夹，不能选择系统或用户资料目录。');
  if(!fs.existsSync(folder))throw Error('找不到第二备份文件夹，请插好 U 盘，并事先建好文件夹后重新选择。');
 }
 const config=identity(folder);if(!internal&&(config.folder===path.parse(config.folder).root||/(^|[\\/])(Library|AppData|Windows|ProgramData|Program Files(?: \(x86\))?|System|usr|private|var|tmp)([\\/]|$)/i.test(config.folder)))throw Error('这个备份位置实际指向系统或用户资料目录，请另选文件夹。');if(config.folder===path.join(runtimeRoot,'backups'))throw Error('第二备份不能和本机备份使用同一个文件夹。');fs.accessSync(config.folder,fs.constants.W_OK);
 durableJSON(path.join(runtimeRoot,'mirror-config.json'),config);
}
export function accessibleMirror(config:MirrorConfig){
 const actual=identity(config.folder);if(actual.folder!==config.folder||actual.device!==config.device||actual.inode!==config.inode)throw Error('U 盘或备份文件夹已变更，请确认后重新选择备份位置。');fs.accessSync(actual.folder,fs.constants.W_OK);return actual.folder;
}
