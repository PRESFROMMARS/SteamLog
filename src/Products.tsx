import {memo,useMemo,useState} from 'react';
import type {Product,ProductInput,ScannerId} from '../electron/types';
import {SCANNERS} from '../electron/types';
import {Dialog} from './Dialog';
import {Barcode} from './Barcode';
import {code128} from '../electron/code128';
import {money,scannerName} from './format';
import type {RunAction} from './Dashboard';
const blank:ProductInput={sku:'',name:'',category:'包子',price:'',sort_order:0,is_active:1};
const multipliers=[['MUL-02','×2'],['MUL-03','×3'],['MUL-05','×5'],['MUL-10','×10']];
const operations=[['ACT-UNDO','撤销上一笔'],['MOD-REFUND','退款模式'],['MOD-GIFT','赠送模式'],['MOD-WASTE','报损模式'],['ACT-RESET','重置状态']];
export const Products=memo(function Products({products,run}:{products:Product[];run:RunAction}){
 const [view,setView]=useState<'manage'|'sheet'>('manage');
 return <section className="products-view"><div className="page-title no-print"><h1>商品与条码板</h1><p>管理菜单，打印一张好用的柜台条码板。</p></div><div className="subnav no-print"><button aria-pressed={view==='manage'} onClick={()=>setView('manage')}>商品管理</button><button aria-pressed={view==='sheet'} onClick={()=>setView('sheet')}>柜台条码板</button></div>{view==='manage'?<Manager products={products} run={run}/>:<Sheet products={products} run={run}/>}</section>;
});
function Manager({products,run}:{products:Product[];run:RunAction}){
 const [query,setQuery]=useState(''),[active,setActive]=useState('ALL'),[category,setCategory]=useState('ALL');
 const [draft,setDraft]=useState<ProductInput|null>(null),[newCategory,setNewCategory]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const categories=useMemo(()=>Array.from(new Set(products.map(p=>p.category))),[products]);
 const rows=products.filter(p=>(active==='ALL'||p.is_active===Number(active))&&(category==='ALL'||p.category===category)&&`${p.sku} ${p.name} ${p.category}`.toLowerCase().includes(query.trim().toLowerCase()));
 const edit=(p?:Product)=>{setNotice('');setNewCategory(false);setDraft(p?{id:p.id,sku:p.sku,name:p.name,category:p.category,price:(p.price_cents/100).toFixed(2),sort_order:p.sort_order,is_active:p.is_active}:{...blank,category:categories[0]??'包子'});};
 const change=(patch:Partial<ProductInput>)=>setDraft(d=>d?{...d,...patch}:null);
 return <><div className="manager-tools"><div className="filters"><label>搜索商品<input placeholder="输入名称、条码或分类" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>商品分类<select value={category} onChange={e=>setCategory(e.target.value)}><option value="ALL">全部分类</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>商品状态<select value={active} onChange={e=>setActive(e.target.value)}><option value="ALL">全部状态</option><option value="1">启用</option><option value="0">已停用</option></select></label></div><button className="primary" onClick={()=>edit()}>+ 添加商品</button></div>
 {notice&&<p className="notice" role="status">{notice}</p>}
 {draft&&<Dialog title={draft.id?'修改商品':'添加商品'} onClose={()=>{if(!busy)setDraft(null);}}><form className="product-form" onSubmit={e=>{e.preventDefault();setBusy(true);void run(async()=>{await window.steam.saveProduct(draft);setDraft(null);setNotice('商品已保存，历史流水保持原样。');}).finally(()=>setBusy(false));}}><div className="form-grid">
  <label>商品条码<input required data-initial-focus maxLength={32} pattern="[A-Za-z0-9\-]+" value={draft.sku} onChange={e=>change({sku:e.target.value.toUpperCase()})} placeholder="B016"/><small>使用字母、数字或横线；不可与系统指令重复。</small></label>
  <label>商品名称<input required maxLength={120} value={draft.name} onChange={e=>change({name:e.target.value})} placeholder="招牌鲜肉包"/></label>
  <label>商品分类<select value={newCategory?'__NEW__':draft.category} onChange={e=>{if(e.target.value==='__NEW__'){setNewCategory(true);change({category:''});}else{setNewCategory(false);change({category:e.target.value});}}}>{Array.from(new Set([...categories,...(!newCategory?[draft.category]:[])])).map(c=><option key={c}>{c}</option>)}<option value="__NEW__">+ 新分类</option></select>{newCategory&&<input aria-label="新分类" required maxLength={60} value={draft.category} onChange={e=>change({category:e.target.value})} placeholder="输入新分类"/>}</label>
  <label>价格（人民币元）<input required inputMode="decimal" pattern="[0-9]{1,7}(\.[0-9]{1,2})?" value={draft.price} onChange={e=>change({price:e.target.value})} placeholder="2.50"/><small>例如 2.50，表示人民币 ¥2.50。</small></label>
  <label>显示顺序<input type="number" required min={-1000000} max={1000000} step={1} value={Number.isNaN(draft.sort_order)?'':draft.sort_order} onChange={e=>change({sort_order:e.target.value===''?NaN:Number(e.target.value)})}/></label>
  <label>状态<select value={draft.is_active} onChange={e=>change({is_active:Number(e.target.value)})}><option value={1}>启用</option><option value={0}>停用</option></select></label>
 </div><div className="form-actions"><button className="primary" disabled={busy}>{busy?'正在保存…':'保存商品'}</button><button type="button" disabled={busy} onClick={()=>setDraft(null)}>取消</button></div></form></Dialog>}
 <div className="panel"><div className="panel-heading"><h2>商品目录 <span>{rows.length} / {products.length} 款</span></h2></div><div className="table-wrap"><table><thead><tr>{['条码','商品名称','分类','价格','排序','状态','操作'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><span className="badge">{p.sku}</span></td><td className="name">{p.name}</td><td className="name">{p.category}</td><td>{money(p.price_cents)}</td><td>{p.sort_order}</td><td><span className={p.is_active?'status-active':'status-disabled'}>{p.is_active?'启用':'已停用'}</span></td><td className="row-actions"><button onClick={()=>edit(p)}>修改</button><button onClick={()=>void run(()=>window.steam.setProductActive(p.id,!p.is_active))}>{p.is_active?'停用':'启用'}</button><button className="danger-text" onClick={()=>void run(async()=>{const r=await window.steam.deleteProduct(p.id);if(draft?.id===p.id)setDraft(null);setNotice(r.archived?'此商品已有销售记录，已停用并保留全部历史流水。':'商品已删除。');})}>删除</button></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">没有找到商品，请试试其他关键词。</div>}</div><p className="note">停用后不能再扫码销售。已有流水的商品会保留历史记录，删除时仅作停用处理。</p></div></>;
}
function Sheet({products,run}:{products:Product[];run:RunAction}){
 const [columns,setColumns]=useState(4),[paper,setPaper]=useState('Letter'),[simulate,setSimulate]=useState(false),[scanner,setScanner]=useState<ScannerId>('SCANNER_1'),[printing,setPrinting]=useState(false),[exported,setExported]=useState('');
 const groups=useMemo(()=>{const map=new Map<string,Product[]>();for(const p of products.filter(p=>p.is_active)){if(!map.has(p.category))map.set(p.category,[]);map.get(p.category)!.push(p);}return [...map];},[products]);
 const card=(code:string,name:string,price?:number)=>{
  // Keep at least a 0.254 mm module on Letter/A4; long SKUs span extra columns.
  const span=Math.min(columns,Math.ceil((code128(code).width*.254+5)/(columns===4?47:64)));
  return <button type="button" key={code} className={'barcode-card '+(price===undefined?'control-card':'')} style={{gridColumn:`span ${span}`}} disabled={!simulate} onClick={()=>void run(()=>window.steam.scan(scanner,code))}><div className="card-label"><strong>{name}</strong>{price!==undefined&&<b>{money(price)}</b>}</div><Barcode value={code}/><span className="sku-text">{code}</span></button>;
 };
 return <><div className="sheet-tools no-print"><label>版式 <select value={columns} onChange={e=>setColumns(Number(e.target.value))}><option value={4}>紧凑 · 4 列</option><option value={3}>标准 · 3 列</option></select></label><label>纸张 <select value={paper} onChange={e=>setPaper(e.target.value)}><option>Letter</option><option>A4</option></select></label><label className="check"><input type="checkbox" checked={simulate} onChange={e=>setSimulate(e.target.checked)}/>点击条码进行测试</label>{simulate&&<label>测试通道<select value={scanner} onChange={e=>setScanner(e.target.value as ScannerId)}>{SCANNERS.map(id=><option key={id} value={id}>{scannerName(id)}</option>)}</select></label>}<button className="primary" disabled={printing} onClick={()=>{setPrinting(true);void run(()=>window.steam.printSheet()).finally(()=>setPrinting(false));}}>🖨️ 打印条码板</button><button disabled={printing} onClick={()=>{setPrinting(true);void run(async()=>setExported(await window.steam.exportSheet())).finally(()=>setPrinting(false));}}>保存 PDF</button></div>{exported&&<p className="notice no-print" role="status">PDF 已保存。<button className="text-button" onClick={()=>void run(()=>window.steam.showInFolder(exported))}>打开文件夹 ↗</button></p>}{simulate&&<p className="notice no-print">测试模式已开启：点击商品条码会记入真实流水，数量和模式指令对所选通道生效。</p>}
 <style>{`@page { size: ${paper}; margin: 8mm; }`}</style>
 <div className={'barcode-sheet '+(columns===4?'compact':'standard')} style={{'--sheet-columns':columns} as React.CSSProperties}><div className="sheet-title"><h2>STEAMLOG <span>柜台条码板</span></h2><p>先扫数量或操作，再扫商品 · 5 秒内有效</p></div>
 <section className="board-section"><h3>快捷数量条码</h3><div className="barcode-grid">{multipliers.map(([code,label])=>card(code,label))}</div></section>
 <section className="board-section"><h3>特殊操作条码</h3><div className="barcode-grid">{operations.map(([code,label])=>card(code,label))}</div></section>
 <section className="board-section"><h3>商品条码区</h3>{groups.map(([category,rows])=><div className="category-group" key={category}><h4>{category}</h4><div className="barcode-grid">{rows.map(p=>card(p.sku,p.name,p.price_cents))}</div></div>)}{!groups.length&&<p>还没有启用的商品，请先到商品管理中添加或启用。</p>}</section>
 </div><p className="note no-print">条码保持黑白打印。塑封前请先试扫，确认纸张尺寸和打印清晰度。PDF 保存在本机导出文件夹。</p></>;
}
