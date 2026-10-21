import type {ProductInput} from './types';
/** Parse decimal RMB yuan without any floating point multiplication. */
export function priceToCents(price:unknown):number {
 if(typeof price!=='string'||!/^\d{1,7}(?:\.\d{1,2})?$/.test(price.trim()))throw Error('价格请输入人民币元，最多保留两位小数。');
 const [yuan,fraction='']=price.trim().split('.');
 return Number(yuan)*100+Number(fraction.padEnd(2,'0'));
}
export function validateProduct(input:ProductInput){
 if(!input||typeof input!=='object')throw Error('商品资料无效，请重新填写。');
 const sku=typeof input.sku==='string'?input.sku.trim().toUpperCase():'';
 if(!/^[A-Z0-9-]{1,32}$/.test(sku))throw Error('商品条码须为 1～32 位英文字母、数字或短横线。');
 if(/^(MUL|MOD|ACT)-/.test(sku)||/^X(?:2|3|5|10)$/.test(sku))throw Error('这个条码已保留给数量、模式或撤销操作，请换一个商品条码。');
 const name=typeof input.name==='string'?input.name.trim():'';
 const category=typeof input.category==='string'?input.category.trim():'';
 if(!name||name.length>120)throw Error('请填写商品名称，最多 120 个字。');
 if(!category||category.length>60)throw Error('请填写商品分类，最多 60 个字。');
 if(!Number.isSafeInteger(input.sort_order)||Math.abs(input.sort_order)>1000000)throw Error('排序须为 -1000000～1000000 之间的整数。');
 if(input.is_active!==0&&input.is_active!==1)throw Error('商品启用状态无效，请重新选择。');
 if(input.id!==undefined&&(!Number.isSafeInteger(input.id)||input.id<1))throw Error('商品编号无效，请重新选择商品。');
 return {...input,sku,name,category,price_cents:priceToCents(input.price)};
}
