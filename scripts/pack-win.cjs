// Called only through local.cjs, after its local cache/home/temp environment is installed.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function safeOutput(folder){if(fs.existsSync(path.join(folder,'data')))throw Error('This build output contains runtime data. Preserve that deployment and build in a clean project/output folder. SteamLog will not erase its data directory.');}
function run(script,args,cwd=root){const r=spawnSync(process.execPath,[script,...args],{cwd,stdio:'inherit',env:process.env});if(r.status!==0)throw Error(`Windows staging command failed (${r.status}). No source-build fallback or system tooling is installed. Check connectivity / prebuilt availability; see DEPLOYMENT_WINDOWS.md.`);}
function assertPE(file){const bytes=fs.readFileSync(file);if(bytes.toString('ascii',0,2)!=='MZ'||bytes.length<64)throw Error('Windows native addon is not PE. Refusing to package a macOS/Linux SQLite binary.');const pe=bytes.readUInt32LE(0x3c);if(pe+6>bytes.length||bytes.toString('ascii',pe,pe+4)!=='PE\0\0'||bytes.readUInt16LE(pe+4)!==0x8664)throw Error('Expected a Windows AMD64 native addon.');}
function embedAppIcon(file){
 const {Data,NtExecutable,NtExecutableResource,Resource}=require('resedit');
 const exe=NtExecutable.from(fs.readFileSync(file));
 const resources=NtExecutableResource.from(exe);
 const icon=Data.IconFile.from(fs.readFileSync(path.join(root,'resources','icons','steamlog.ico')));
 const images=icon.icons.map(item=>item.data);
 const groups=Resource.IconGroupEntry.fromEntries(resources.entries);
 if(!groups.length)throw Error('Windows executable has no icon group to replace.');
 for(const {id,lang} of groups)Resource.IconGroupEntry.replaceIconsForResource(resources.entries,id,lang,images);
 resources.outputResource(exe);
 fs.writeFileSync(file,Buffer.from(exe.generate()));
}
module.exports=async function packWindows(){
 for(const name of ['win-unpacked','SteamLog-win32-x64'])safeOutput(path.join(root,'release',name));
 const stage=path.join(root,'.cache','win-app');fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
 for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(root,name),path.join(stage,name));
 const npm=process.env.npm_execpath;if(!npm||!fs.existsSync(npm))throw Error('Run npm run pack:win-dir through scripts/npm-local.sh or npm-local.ps1.');
 run(npm,['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--cache='+path.join(root,'.cache','npm'),'--prefix='+stage],stage);
 // The SQLite package ships Node-API binaries for several platforms. Keep only the Windows x64 one in this bundle.
 const version=require(path.join(root,'node_modules/electron/package.json')).version;
 const sqliteBinary=path.join('node_modules','better-sqlite3','prebuilds','win32-x64.node');
 assertPE(path.join(stage,sqliteBinary));
 const prebuilds=path.dirname(path.join(stage,sqliteBinary));
 for(const name of fs.readdirSync(prebuilds)){
  if(name.endsWith('.node')&&name!=='win32-x64.node')fs.unlinkSync(path.join(prebuilds,name));
 }
 for(const name of ['dist','dist-electron'])fs.cpSync(path.join(root,name),path.join(stage,name),{recursive:true,filter:source=>!source.endsWith('test.js')});
 const {build,Platform,Arch}=require('electron-builder');
 await build({targets:Platform.WINDOWS.createTarget(['dir'],Arch.x64),config:{extends:path.join(root,'electron-builder.json'),electronVersion:version},publish:'never'});
 const unpacked=path.join(root,'release','win-unpacked'),destination=path.join(root,'release','SteamLog-win32-x64');
 embedAppIcon(path.join(unpacked,'SteamLog.exe'));
 safeOutput(destination);
 fs.rmSync(destination,{recursive:true,force:true});
 fs.renameSync(unpacked,destination);
 assertPE(path.join(destination,'SteamLog.exe'));
 const native=path.join(destination,'resources','app.asar.unpacked',sqliteBinary);assertPE(native);
 if(!fs.existsSync(path.join(destination,'resources','win-raw-scanner','RawScannerListener.cs')))throw Error('Packaged Raw Input source is missing.');
 console.log('Portable Windows x64 folder verified: '+destination);
};
module.exports.assertPE=assertPE;
module.exports.safeOutput=safeOutput;
