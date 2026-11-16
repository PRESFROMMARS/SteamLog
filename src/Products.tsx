import {memo,useMemo,useState} from 'react';
import type {Product,ProductInput} from '../electron/types';
import {Dialog} from './Dialog';
import {CounterSheet} from './CounterSheet';
import {money} from './format';
import type {RunAction} from './Dashboard';
import {readableError} from '../electron/errors';
const blank:ProductInput={sku:'',name:'',category:'包子',price:'',sort_order:0,is_active:1};
export const Products=memo(function Products({products,run,sheetBusy,onSheetBusy}:{products:Product[];run:RunAction;sheetBusy:boolean;onSheetBusy:(busy:boolean)=>void}){
 const [view,setView]=useState<'manage'|'sheet'>('manage');
 return <section className="products-view"><div className="page-title no-print"><h1>商品与条码板</h1><p>管理菜单，打印柜台条码板。</p></div><div className="subnav no-print"><button disabled={sheetBusy} aria-pressed={view==='manage'} onClick={()=>setView('manage')}>商品管理</button><button disabled={sheetBusy} aria-pressed={view==='sheet'} onClick={()=>setView('sheet')}>柜台条码板</button></div>{view==='manage'?<Manager products={products} run={run}/>:<CounterSheet products={products} run={run} printing={sheetBusy} onPrinting={onSheetBusy}/>}</section>;
});
function Manager({products,run}:{products:Product[];run:RunAction}){
 const [query,setQuery]=useState(''),[active,setActive]=useState('ALL'),[category,setCategory]=useState('ALL');
 const [draft,setDraft]=useState<ProductInput|null>(null),[newCategory,setNewCategory]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [formError,setFormError]=useState(''),[remove,setRemove]=useState<Product|null>(null);
 const categories=useMemo(()=>Array.from(new Set(products.map(p=>p.category))),[products]);
 const rows=products.filter(p=>(active==='ALL'||p.is_active===Number(active))&&(category==='ALL'||p.category===category)&&`${p.sku} ${p.name} ${p.category}`.toLowerCase().includes(query.trim().toLowerCase()));
 const edit=(p?:Product)=>{setNotice('');setFormError('');setNewCategory(false);setDraft(p?{id:p.id,sku:p.sku,name:p.name,category:p.category,price:(p.price_cents/100).toFixed(2),sort_order:p.sort_order,is_active:p.is_active}:{...blank,category:categories[0]??'包子'});};
 const change=(patch:Partial<ProductInput>)=>{setFormError('');setDraft(d=>d?{...d,...patch}:null);};
 const save=async()=>{
  if(!draft||busy)return;
  setBusy(true);setFormError('');
  try{
   const saved=await window.steam.saveProduct(draft);
   const previous=products.find(product=>product.id===saved.id);
   setDraft(null);
   setNotice(previous&&previous.sku!==saved.sku?'商品已保存，条码已更新。请更换柜台打印板。':'商品已保存。');
  }catch(error){setFormError(readableError(error));}
  finally{setBusy(false);}
 };
 const deleteSelected=async()=>{
  if(!remove||busy)return;
  setBusy(true);setFormError('');
  try{
   const result=await window.steam.deleteProduct(remove.id);
   setRemove(null);
   setNotice(result.archived?'商品已停用，销售和备货历史已保留。':'商品已删除。');
  }catch(error){setFormError(readableError(error));}
  finally{setBusy(false);}
 };
 return <><div className="manager-tools"><div className="filters"><label>搜索商品<input placeholder="输入名称、条码或分类" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>商品分类<select value={category} onChange={e=>setCategory(e.target.value)}><option value="ALL">全部分类</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>商品状态<select value={active} onChange={e=>setActive(e.target.value)}><option value="ALL">全部状态</option><option value="1">启用</option><option value="0">已停用</option></select></label></div><button className="primary" onClick={()=>edit()}>+ 添加商品</button></div>
 {notice&&<p className="notice" role="status">{notice}</p>}
 {draft&&<Dialog title={draft.id?'修改商品':'添加商品'} onClose={()=>{if(!busy)setDraft(null);}}><form className="product-form" onSubmit={e=>{e.preventDefault();void save();}}><fieldset className="form-grid" disabled={busy}>
  <label>商品条码<input required data-initial-focus maxLength={32} pattern="[A-Za-z0-9\-]+" value={draft.sku} onChange={e=>change({sku:e.target.value.toUpperCase()})} placeholder="B016"/><small>使用字母、数字或横线；不可与系统指令重复。</small></label>
  <label>商品名称<input required maxLength={120} value={draft.name} onChange={e=>change({name:e.target.value})} placeholder="招牌鲜肉包"/></label>
  <label>商品分类<select value={newCategory?'__NEW__':draft.category} onChange={e=>{if(e.target.value==='__NEW__'){setNewCategory(true);change({category:''});}else{setNewCategory(false);change({category:e.target.value});}}}>{Array.from(new Set([...categories,...(!newCategory?[draft.category]:[])])).map(c=><option key={c}>{c}</option>)}<option value="__NEW__">+ 新分类</option></select>{newCategory&&<input aria-label="新分类" required maxLength={60} value={draft.category} onChange={e=>change({category:e.target.value})} placeholder="输入新分类"/>}</label>
  <label>价格（人民币元）<input required inputMode="decimal" pattern="[0-9]{1,7}(\.[0-9]{1,2})?" value={draft.price} onChange={e=>change({price:e.target.value})} placeholder="2.50"/><small>例如 2.50，表示人民币 ¥2.50。</small></label>
  <label>显示顺序<input type="number" required min={-1000000} max={1000000} step={1} value={Number.isNaN(draft.sort_order)?'':draft.sort_order} onChange={e=>change({sort_order:e.target.value===''?NaN:Number(e.target.value)})}/></label>
  <label>状态<select value={draft.is_active} onChange={e=>change({is_active:Number(e.target.value)})}><option value={1}>启用</option><option value={0}>停用</option></select></label>
 </fieldset>{formError&&<p className="error" role="alert">{formError}</p>}<div className="form-actions"><button className="primary" disabled={busy}>{busy?'正在保存…':'保存商品'}</button><button type="button" disabled={busy} onClick={()=>setDraft(null)}>取消</button></div></form></Dialog>}
 {remove&&<Dialog title="确认移除商品" onClose={()=>{if(!busy)setRemove(null);}}>
  <p>要移除「{remove.name}」（{remove.sku}）吗？有历史记录的商品会停用，无记录的商品会从目录删除。请同步更换柜台条码板。</p>
  {formError&&<p className="error" role="alert">{formError}</p>}
  <div className="form-actions"><button className="danger-text" disabled={busy} onClick={()=>void deleteSelected()}>确认移除</button><button className="primary" data-initial-focus disabled={busy} onClick={()=>setRemove(null)}>取消</button></div>
 </Dialog>}
 <div className="panel"><div className="panel-heading"><h2>商品目录 <span>{rows.length} / {products.length} 款</span></h2></div><div className="table-wrap"><table><thead><tr>{['条码','商品名称','分类','价格','排序','状态','操作'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><span className="badge">{p.sku}</span></td><td className="name">{p.name}</td><td className="name">{p.category}</td><td>{money(p.price_cents)}</td><td>{p.sort_order}</td><td><span className={p.is_active?'status-active':'status-disabled'}>{p.is_active?'启用':'已停用'}</span></td><td className="row-actions"><button onClick={()=>edit(p)}>修改</button><button onClick={()=>void run(()=>window.steam.setProductActive(p.id,!p.is_active))}>{p.is_active?'停用':'启用'}</button><button className="danger-text" onClick={()=>{setNotice('');setFormError('');setRemove(p);}}>删除</button></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">没有找到商品，请试试其他关键词。</div>}</div><p className="note">停用后不能再扫码销售。已有流水的商品会保留历史记录，删除时仅作停用处理。</p></div></>;
}
