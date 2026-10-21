const path = require('node:path');
const fs = require('node:fs');
const {spawn, spawnSync} = require('node:child_process');
process.chdir(path.join(__dirname, '..'));
for (const [key, value] of Object.entries({ELECTRON_CACHE:'.cache/electron',ELECTRON_BUILDER_CACHE:'.cache/electron-builder',npm_config_cache:'.cache/npm',npm_config_devdir:'.cache/node-gyp',npm_config_prefix:'.cache/npm-global',TMPDIR:'.cache/tmp',TMP:'.cache/tmp',TEMP:'.cache/tmp',XDG_CACHE_HOME:'.cache/xdg',HOME:'.cache/home',USERPROFILE:'.cache/home',APPDATA:'.cache/appdata',LOCALAPPDATA:'.cache/localappdata'})) {process.env[key]=path.resolve(value);fs.mkdirSync(process.env[key],{recursive:true});}
const run=(file,args=[])=>{const r=spawnSync(process.execPath,[file,...args],{stdio:'inherit',env:process.env});if(r.status!==0) process.exit(r.status||1);};
const tsc='node_modules/typescript/bin/tsc';
const build=()=>{run(tsc,['--noEmit']);run(tsc,['-p','tsconfig.electron.json']);run('node_modules/vite/bin/vite.js',['build']);};
(async()=>{switch(process.argv[2]){
case 'setup:electron':run('node_modules/electron/install.js');break;
case 'typecheck':run(tsc,['--noEmit']);run(tsc,['-p','tsconfig.electron.json','--noEmit']);break;
case 'rebuild':run('node_modules/@electron/rebuild/lib/cli.js',['-f','-w','better-sqlite3']);break;
case 'build':build();break;
case 'pack:win-dir':build();await require('./pack-win.cjs')();break;
case 'test':run(tsc,['-p','tsconfig.electron.json']);run('scripts/test-charts.cjs');process.env.ELECTRON_RUN_AS_NODE='1';run('node_modules/electron/cli.js',['dist-electron/test.js']);run('node_modules/electron/cli.js',['dist-electron/phase2-test.js']);run('node_modules/electron/cli.js',['dist-electron/phase3-test.js']);run('node_modules/electron/cli.js',['dist-electron/phase4-test.js']);run('node_modules/electron/cli.js',['dist-electron/closeout-test.js']);run('node_modules/electron/cli.js',['dist-electron/preparation-test.js']);run('node_modules/electron/cli.js',['dist-electron/preparation-records-test.js']);break;
case 'test:runtime':build();run('node_modules/electron/cli.js',['dist-electron/runtime-test.js']);break;
case 'test:preparation-ui':build();run('node_modules/electron/cli.js',['dist-electron/preparation-ui-test.js']);break;
case 'preview:preparation':build();run('node_modules/electron/cli.js',['dist-electron/preparation-preview-test.js']);break;
case 'start':run('node_modules/electron/cli.js',['.']);break;
case 'dev': {run(tsc,['-p','tsconfig.electron.json']);const {createServer}=await import('vite');const server=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true}});await server.listen();process.env.VITE_DEV_SERVER_URL='http://127.0.0.1:5173';const child=spawn(process.execPath,['node_modules/electron/cli.js','.'],{stdio:'inherit',env:process.env});child.on('exit',async c=>{await server.close();process.exit(c||0)});break;}
default:throw Error('Unknown command');}})();
