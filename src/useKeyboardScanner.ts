import {useEffect,useState} from 'react';
import type {RawInputStatus} from '../electron/types';

export function useKeyboardScanner(onScan:(barcode:string)=>void,onError:(message:string)=>void){
 const [rawStatus,setRawStatus]=useState<RawInputStatus>();
 useEffect(()=>{
  let alive=true;
  let rawActive=false;
  let buffer='',last=0;
  const clear=()=>{buffer='';last=0;};
  const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&(!!target.closest('input,textarea,select')||target.isContentEditable);
  const key=(e:KeyboardEvent)=>{
   if(editable(e.target)){clear();return;}
   if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey){clear();return;}
   if(Date.now()-last>1000)buffer='';last=Date.now();
   if((e.key==='Enter'||e.key==='Tab')&&buffer){e.preventDefault();const text=buffer;clear();if(!rawActive)onScan(text);}
   else if(e.key.length===1){e.preventDefault();if(buffer.length>=128){clear();onError('条码过长，请重新扫描。');}else buffer+=e.key;}
   else if(e.key==='Escape')clear();
  };
  // Focusing an editor discards an unfinished scan rather than carrying it across tabs.
  const focus=(e:FocusEvent)=>{if(editable(e.target))clear();};
  let rawVersion=0;const rawUpdate=(value:RawInputStatus)=>{rawVersion++;if(alive){if(rawActive!==value.active)clear();rawActive=value.active;setRawStatus(value);}};const offRaw=window.steam.onRawInput(rawUpdate);const rawInitial=rawVersion;void window.steam.rawInputInfo().then(value=>{if(rawVersion===rawInitial)rawUpdate(value);}).catch(()=>{});
  window.addEventListener('keydown',key);window.addEventListener('blur',clear);window.addEventListener('focusin',focus);
  return()=>{
   alive=false;
   offRaw();
   window.removeEventListener('keydown',key);
   window.removeEventListener('blur',clear);
   window.removeEventListener('focusin',focus);
  };
 },[onScan,onError]);
 return rawStatus;
}
