import {useEffect,useRef,type ReactNode} from 'react';
/** Native dialog provides focus trapping, Escape, and focus restoration without another dependency. */
export function Dialog({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current!;dialog.showModal();dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus();return()=>dialog.close();},[]);
 return <dialog ref={ref} className={'app-dialog no-print'+(wide?' wide':'')} aria-labelledby="dialog-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="关闭弹窗" autoFocus>×</button></div>{children}</dialog>;
}
