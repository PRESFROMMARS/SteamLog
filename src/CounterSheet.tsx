import {useMemo,useState,type CSSProperties} from 'react';
import {code128} from '../electron/code128';
import type {CounterPaper,Product} from '../electron/types';
import {Barcode} from './Barcode';
import type {RunAction} from './Dashboard';
import {productName} from './format';
import './counter-sheet.css';

const quantities=[['MUL-02','×2'],['MUL-03','×3'],['MUL-05','×5'],['MUL-10','×10']];
const operations=[['MOD-REFUND','退款'],['MOD-GIFT','赠送'],['MOD-WASTE','报损'],['ACT-UNDO','撤销本枪上一笔'],['ACT-RESET','重置数量和模式']];
const paperWidths={Letter:215.9,A4:210};
const margin=8,gap=2.5,cardPadding=2,cardBorder=.2;

function barcodeSpan(width:number,columns:number,paperWidth:number){
 const cellWidth=(paperWidth-2*margin-(columns-1)*gap)/columns;
 return Math.ceil((width+2*(cardPadding+cardBorder)+gap)/(cellWidth+gap));
}

type Card={value:string;name:string;code:ReturnType<typeof code128>;moduleWidth:number;span:number};
type Category={name:string;cards:Card[]};
type CategoryRow=Category[];

function makeCard(value:string,name:string,moduleWidth:number,columns:number,paperWidth:number):Card {
 const code=code128(value);
 return {value,name,code,moduleWidth,span:barcodeSpan(code.width*moduleWidth,columns,paperWidth)};
}

function productPages(products:Product[],columns:number,paperWidth:number){
 const byCategory=new Map<string,Category>();
 for(const product of products){
  if(!product.is_active)continue;
  let group=byCategory.get(product.category);
  if(!group){group={name:product.category,cards:[]};byCategory.set(product.category,group);}
  group.cards.push(makeCard(product.sku,productName(product.name),.36,columns,paperWidth));
 }
 const groups=[...byCategory.values()];
 const slotCount=(group:Category)=>group.cards.reduce((sum,card)=>sum+card.span,0);
 const pages:CategoryRow[][]=[[]];
 let usedHeight=0;
 for(let i=0;i<groups.length;i++){
  const group=groups[i];
  const next=groups[i+1];
  const pair=columns===4&&next&&slotCount(group)<=2&&slotCount(next)<=2;
  const row=pair?[group,groups[++i]]:[group];
  let lines=1,usedSlots=0;
  if(!pair)for(const card of group.cards){
   if(usedSlots+card.span>columns){lines++;usedSlots=0;}
   usedSlots+=card.span;
  }
  // Keep categories together in the built-in catalog on both paper sizes. Print can flow
  // across another page for unusually long names or user-added categories.
  const blockHeight=lines*26+(lines-1)*gap+9;
  if(usedHeight&&usedHeight+blockHeight>242){pages.push([]);usedHeight=0;}
  pages.at(-1)!.push(row);
  usedHeight+=blockHeight;
 }
 return pages;
}

function CounterCard({value,name,code,moduleWidth,span}:Card){
 const style={'--counter-span':span,'--counter-small-span':span>1?2:1} as CSSProperties;
 return <div className="counter-card" style={style}>
  <strong className="counter-card-name">{name}</strong>
  <Barcode value={value} code={code} moduleWidth={moduleWidth}/>
  <span className="counter-card-code">{value}</span>
 </div>;
}

export function CounterSheet({products,run}:{products:Product[];run:RunAction}){
 const [columns,setColumns]=useState(4);
 const [paper,setPaper]=useState<CounterPaper>('Letter');
 const [printing,setPrinting]=useState(false);
 const [exported,setExported]=useState('');
 const paperWidth=paperWidths[paper];
 const pages=useMemo(()=>productPages(products,columns,paperWidth),[products,columns,paperWidth]);
 const print=(save:boolean)=>{
  setPrinting(true);
  void run(async()=>{
   if(save)setExported(await window.steam.exportSheet());
   else await window.steam.printSheet(paper);
  }).finally(()=>setPrinting(false));
 };
 const controlCards=(entries:string[][],count:number)=>entries.map(([value,name])=><CounterCard key={value} {...makeCard(value,name,.34,count,paperWidth)}/>);

 return <>
  <div className="sheet-tools no-print">
   <label>版式<select value={columns} onChange={e=>setColumns(Number(e.target.value))}>
    <option value={4}>柜台版 · 4 列</option><option value={3}>大字版 · 3 列</option>
   </select></label>
   <label>纸张<select value={paper} onChange={e=>setPaper(e.target.value as CounterPaper)}>
    <option>Letter</option><option>A4</option>
   </select></label>
   <button type="button" className="primary" disabled={printing} onClick={()=>print(false)}>打印条码板</button>
   <button type="button" disabled={printing} onClick={()=>print(true)}>保存 PDF</button>
  </div>
  <p className="note no-print">打印时选择实际大小（100%）。建议先用店里的扫码枪试扫，再塑封。</p>
  {exported&&<p className="notice no-print" role="status">PDF 已保存。<button className="text-button" onClick={()=>void run(()=>window.steam.showInFolder(exported))}>打开文件夹</button></p>}
  <style>{`@page { size: ${paper} portrait; margin: ${margin}mm; }`}</style>
  <div className={'counter-sheet'+(columns===3?' counter-large':'')} style={{'--counter-columns':columns} as CSSProperties}>
   {pages.map((page,index)=><div className="counter-page counter-products" key={index}>
    <header className="counter-heading">
     <div><span className="counter-brand">SteamLog</span><h2>商品条码板</h2></div>
     <div className="counter-index">
      <span>商品页 {index+1} / {pages.length}</span>
      <p>{page.flat().map(group=>group.name).join(' · ')}</p>
     </div>
    </header>
    {page.map(row=><div key={row[0].name} className={'counter-category-row'+(row.length===2?' counter-pair':'')}>
     {row.map(group=><section className="counter-group" key={group.name}>
      <h3>{group.name}</h3>
      <div className="counter-grid">{group.cards.map(card=><CounterCard key={card.value} {...card}/>)}</div>
     </section>)}
    </div>)}
    {!page.length&&<p>暂无启用商品。请在商品管理中启用要打印的商品。</p>}
   </div>)}
   <div className="counter-page counter-controls">
    <header className="counter-heading"><div><span className="counter-brand">SteamLog</span><h2>数量与操作条码</h2></div></header>
    <section className="counter-group">
     <h3>数量</h3>
     <p>先扫数量，再在 5 秒内扫商品。</p>
     <div className="counter-grid counter-quantities">{controlCards(quantities,4)}</div>
    </section>
    <section className="counter-group">
     <h3>退款、赠送与报损</h3>
     <p>先扫所需模式，再在 5 秒内扫商品。</p>
     <div className="counter-grid counter-commands">{controlCards(operations.slice(0,3),3)}</div>
    </section>
    <section className="counter-group">
     <h3>撤销与重置</h3>
     <p>直接扫操作码。撤销仅处理本枪最近 60 秒内的流水。</p>
     <div className="counter-grid counter-commands">{controlCards(operations.slice(3),3)}</div>
    </section>
   </div>
  </div>
 </>;
}
