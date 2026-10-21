/** Code 128 run widths, values 0–106. Final stop symbol has seven runs.
 * Encoding: ISO/IEC 15417, start B (104), weighted mod-103 check, stop (106).
 * ASCII controls use one-character SHIFT to set A; printable ASCII stays in B.
 * No runtime dependencies, fonts, images, HTML interpolation, or network calls.
 */
export const CODE128_PATTERNS = [
 '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212',
 '112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131',
 '311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321',
 '112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121',
 '313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
 '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114',
 '122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212',
 '124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113',
 '114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'
] as const;
export interface Barcode {symbols:number[];width:number;quietZone:number;bars:{x:number;width:number}[]}
export function code128(text:string):Barcode {
 if(!text.length||text.length>128)throw Error('条码须包含 1～128 个英文字母、数字或半角符号。');
 const data:number[]=[];
 for(const char of text){const n=char.charCodeAt(0);if(n>127)throw Error('条码只支持英文字母、数字或半角符号，不支持中文。');if(n<32)data.push(98,n+64);else data.push(n-32);}
 const check=(104+data.reduce((sum,value,i)=>sum+value*(i+1),0))%103;
 const symbols=[104,...data,check,106];
 const quietZone=10;let x=quietZone;const bars:{x:number;width:number}[]=[];
 for(const symbol of symbols){[...CODE128_PATTERNS[symbol]].forEach((run,i)=>{const width=Number(run);if(i%2===0)bars.push({x,width});x+=width;});}
 return {symbols,width:x+quietZone,quietZone,bars};
}
