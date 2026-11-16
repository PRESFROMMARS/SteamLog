import type {CloseoutResult} from '../electron/types';
import {Dialog} from './Dialog';
import {money,time,backupTime} from './format';
export function Closeout({date,result,changed,busy,error,onClose,onRefresh}:{date:string;result?:CloseoutResult;changed:boolean;busy:boolean;error:string;onClose:()=>void;onRefresh:()=>void}){
 const summary=result?.summary;
 return <Dialog title="收工日结" onClose={onClose}><div className="closeout-card" aria-busy={busy}>
 <p className="closeout-date">{date} <span>台北营业日</span></p>
 {busy?<p className="closeout-loading" role="status">正在汇总并安全备份，请稍候…</p>:error?<p className="error" role="alert">{error}</p>:result&&summary?<>
 {changed&&result.backup&&<p className="notice" role="status">日结后有变动。更新汇总并备份后，即可查看最新结果。</p>}
 <p className="note">{result.includedInPreparation?'当天扫码销量已纳入备货计算。':'当天已标记为休息日，备货计算会跳过当天销量。'}</p>
 <div className="closeout-revenue"><h3>当日净营业额</h3><strong>{money(summary.revenue)}</strong></div>
 <div className="closeout-main"><div><span>净售出</span><strong>{summary.units.toLocaleString()} 件</strong></div><div><span>有效扫码记录</span><strong>{summary.validTransactions.toLocaleString()} 笔</strong></div></div>
 <div className="closeout-times"><p>第一笔销售 <b>{result.firstSale?time.format(new Date(result.firstSale)):'当天暂无销售'}</b></p><p>最后一笔销售 <b>{result.lastSale?time.format(new Date(result.lastSale)):'当天暂无销售'}</b></p></div>
 <div className="closeout-special">{[['退款',summary.refundUnits,summary.refundValue],['赠送',summary.giftUnits,summary.giftValue],['报损',summary.wasteUnits,summary.wasteValue]].map(([label,qty,value])=><p key={label}><span>{label}</span><b>{qty} 件 · {money(Number(value))}</b></p>)}<p><span>已撤销</span><b>{summary.voids} 笔</b></p></div>
 <div className={result.backup?'notice closeout-backup':'error closeout-backup'} role="status"><strong>{result.backup?'✓ 完整账本已备份到本机':'本机备份未完成，请重试'}</strong><p>{result.backup?(result.mirrorStatus==='success'?'✓ U盘第二备份已同步':result.mirrorStatus==='unconfigured'?'尚未配置U盘备份，本机备份已完成。':'U盘未连接或暂时无法写入，本机备份已完成。'):result.backupError}</p></div>
 <p className="note">截至 {backupTime.format(new Date(result.generatedAt))}。记录数不是顾客订单数；日结不会清零或锁账，之后仍可正常扫码。</p>
 </>:null}
 <div className="form-actions"><button disabled={busy} onClick={onRefresh}>{result?'更新汇总并备份':'重试'}</button><button className="primary" onClick={onClose}>知道了</button></div>
 </div></Dialog>;
}
