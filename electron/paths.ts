import fs from 'node:fs';
import path from 'node:path';
/** Resolve through existing ancestors so symlinks cannot escape containment. */
export function contained(root:string,target:string){
 const base=fs.realpathSync(root);const absolute=path.resolve(target);let parent=absolute;const missing:string[]=[];
 while(!fs.existsSync(parent)){missing.unshift(path.basename(parent));const next=path.dirname(parent);if(next===parent)throw Error('文件路径无效，请重新选择。');parent=next;}
 const actual=path.resolve(fs.realpathSync(parent),...missing);const relative=path.relative(base,actual);
 if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('请选择程序文件夹内的位置。U 盘第二备份请在专用设置中配置。');
 return actual;
}
export function syncFile(file:string){const fd=fs.openSync(file,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function syncDirectory(directory:string){if(process.platform==='win32')return;const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function durableJSON(file:string,value:unknown){const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value));syncFile(temporary);fs.renameSync(temporary,file);syncDirectory(path.dirname(file));}
