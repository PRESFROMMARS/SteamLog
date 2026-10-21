const assert = require('node:assert/strict');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
(async () => {
 const {buildSync} = require('esbuild');
 const Module = require('node:module');
 const path = require('node:path');
 const load = file => {
  const filename = path.resolve(file);
  const result = buildSync({entryPoints:[filename],bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react'],write:false});
  const compiled = new Module(filename,module);compiled.paths=module.paths;compiled._compile(result.outputFiles[0].text,filename);return compiled.exports;
 };
  const {Dashboard} = load('src/Dashboard.tsx');
  const {TrendChart} = load('src/HistoryCharts.tsx');
  const hours = Array.from({length:24}, (_,hour) => ({hour,quantity:hour===20?5:0,revenue:hour===20?1000:0}));
  const html = renderToStaticMarkup(React.createElement(Dashboard,{data:{currentHour:20,hours,ranking:[],bestSeller:null,summary:{revenue:1000,items:5}},recent:[],run:async()=>{}}));
  assert(html.includes('00:00 至 23:00'));
  assert(html.includes('20:00 至 21:00：5 件'));
  // Even during normal opening hours, past late-night activity must remain visible.
  assert(renderToStaticMarkup(React.createElement(Dashboard,{data:{currentHour:8,hours,ranking:[],bestSeller:null,summary:{revenue:1000,items:5}},recent:[],run:async()=>{}})).includes('20:00 至 21:00：5 件'));
  const points = Array.from({length:96}, (_,i) => ({key:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),units:i===95?7:0,revenue:i===95?1400:0}));
  for(const metric of ['units','revenue']) {
   const trend = renderToStaticMarkup(React.createElement(TrendChart,{series:[{id:1,name:'包子',points}],metric,title:'测试趋势'}));
   assert(trend.includes('最新时段'));
   assert(trend.includes('第 61 至 96 组'));
   assert(trend.includes('2026-04-06：7 件'));
   const compare = renderToStaticMarkup(React.createElement(TrendChart,{series:[{id:1,name:'包子',points},{id:2,name:'豆浆',points}],metric,title:'测试对比'}));
   assert(compare.includes('2026-04-06 · 包子：7 件'));
   assert(compare.includes('2026-04-06 · 豆浆：7 件'));
  }
  console.log('PASS charts: late-hour activity visible; long-range revenue, units and comparisons show latest page.');
})().catch(error=>{console.error(error);process.exitCode=1;});
