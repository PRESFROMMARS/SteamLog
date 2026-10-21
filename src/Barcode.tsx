import {useMemo} from 'react';
import {code128} from '../electron/code128';
export function Barcode({value}:{value:string}){
 const code=useMemo(()=>code128(value),[value]);
 return <svg className="barcode" viewBox={`0 0 ${code.width} 52`} role="img" aria-label={`Code 128: ${value}`} xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges"><rect width={code.width} height="52" fill="white"/>{code.bars.map(bar=><rect key={bar.x} x={bar.x} y="2" width={bar.width} height="48" fill="black"/>)}</svg>;
}
