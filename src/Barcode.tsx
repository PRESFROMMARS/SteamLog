import type {Barcode as Code128} from '../electron/code128';

export function Barcode({value,code,moduleWidth}:{value:string;code:Code128;moduleWidth:number}){
 return <svg className="counter-barcode" style={{width:`${code.width*moduleWidth}mm`}}
  viewBox={`0 0 ${code.width} 52`} preserveAspectRatio="none" role="img" aria-label={`Code 128: ${value}`} xmlns="http://www.w3.org/2000/svg">
  <rect width={code.width} height="52" fill="white"/>
  {code.bars.map(bar=><rect key={bar.x} x={bar.x} y="2" width={bar.width} height="48" fill="black"/>)}
 </svg>;
}
