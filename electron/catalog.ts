/** Opening menu. All amounts are integer RMB fen; no currency conversion is applied. */
const groups=[
 {category:'包子',prefix:'B',items:[['招牌鲜肉包',200],['奥尔良鸡肉包',200],['梅菜肉包',200],['牛肉粉丝包',200],['酱香肉丁包',200],['虾仁鲜肉包',250],['鹌鹑三鲜包',250],['红油牛肉包',250],['花菇青菜包',150],['麻辣串串包',150],['韭菜鸡蛋包',150],['香辣外婆菜包',150],['香辣茄子包',150],['萝卜鸡蛋包',150],['绵甜豆沙包',150]]},
 {category:'点心小食',prefix:'S',items:[['糯米大烧麦',150],['乡巴佬茶叶蛋',150],['热狗卷',200],['海苔饭团',250],['奥尔良鸡肉卷',250],['蒸饺',600],['流心奶黄包',200],['紫薯包',200],['香蕉包',200],['红糖开花馒头',200],['红豆卷',200]]},
 {category:'小笼包',prefix:'X',items:[['招牌鲜肉小笼',600],['翡翠素三鲜小笼',600],['经典酱肉小笼',700],['红油牛肉小笼',800],['超值全家福小笼',700]]},
 {category:'汤粉馄饨',prefix:'T',items:[['鸡汤馄炖',600],['原汤牛骨米线',900]]},
 {category:'生煎',prefix:'J',items:[['生煎鲜肉包',600],['生煎韭菜包',500]]},
 {category:'粥品',prefix:'Z',items:[['红枣小米粥',200],['招牌八宝粥',300],['南瓜玉米粥',300],['牛奶燕麦粥',300]]},
 {category:'汤羹',prefix:'Q',items:[['古法豆腐脑',300],['浓香胡辣汤',300]]},
 {category:'豆浆饮品',prefix:'D',items:[['浓香豆奶',300],['现磨原味豆浆',200],['现磨红枣豆浆',300],['现磨五谷豆浆',300],['老北京酸梅汤',200],['冰糖绿豆汤',200]]}
] as const;
export const OPENING_CATALOG=groups.flatMap(group=>group.items.map(([name,price_cents],index)=>({sku:`${group.prefix}${String(index+1).padStart(3,'0')}`,name,category:group.category,price_cents}))).map((product,sort_order)=>({...product,sort_order}));
export const CURRENCY='CNY';
