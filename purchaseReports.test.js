import test from 'node:test';
import assert from 'node:assert/strict';
import {DEMAND_MODEL_RULES, productDemandKey, lastPaidPrices, purchaseReport} from './purchaseReports.js';
import {purchaseDateLabel} from './purchases.js';
const rows = [
  {id: '1', client: 'Cliente A', seller: 'Cardoso', supplier: 'Master', sku: 'Toner', quantity: 10, purchasedQty: 2, unitCost: 10, status: 'Parcial', date: '2026-10-01', purchaseDate: '2026-11-02'},
  {id: '2', client: 'Cliente A', seller: 'Luiz', supplier: 'Potencial', sku: 'Papel', quantity: 3, purchasedQty: 3, unitCost: 5, status: 'Comprado', date: '2026-10-01', purchaseDate: '2026-11-03'},
  {id: '3', client: 'Cliente B', seller: 'Cardoso', supplier: 'Master', sku: 'Chip', quantity: 1, purchasedQty: 1, unitCost: 7, status: 'Comprado', date: '2026-11-01', purchaseDate: '2026-10-31'},
  {id: '4', client: 'Cliente A', seller: 'Cardoso', supplier: 'Master', purchasedQty: 10, unitCost: 999, status: 'Pendente'},
  {id: '5', client: 'Cliente A', seller: 'Cardoso', supplier: 'Master', purchasedQty: 10, unitCost: 999, status: 'Cancelado'},
];
test('Soma compras reais por cliente, vendedor e fornecedor usando apenas quantidades efetivas', () => {
  const report = purchaseReport(rows);
  assert.equal(report.total, 42);assert.equal(report.units, 6);
  assert.deepEqual(report.byClient.map(group => [group.name, group.total]), [['Cliente A', 35], ['Cliente B', 7]]);
  assert.deepEqual(report.bySeller.map(group => [group.name, group.total]), [['Cardoso', 27], ['Luiz', 15]]);
  assert.deepEqual(report.bySupplier.map(group => [group.name, group.total]), [['Master', 27], ['Potencial', 15]]);
});
test('Período usa data da compra, inclusive limites, nunca data da solicitação', () => {
  const report = purchaseReport(rows, {from: '2026-11-02', to: '2026-11-03'});
  assert.equal(report.total, 35);assert.deepEqual(report.purchases.map(row => row.sourceRequestId), ['2', '1']);
  assert.equal(purchaseReport(rows, {from: '2026-11-03', to: '2026-11-03'}).total, 15);
});
test('Cliente e vendedor podem ser combinados com fornecedor e pesquisa', () => {
  const report = purchaseReport(rows, {client: 'Cliente A', seller: 'Cardoso', supplier: 'Master', search: 'toner'});
  assert.equal(report.total, 20);assert.equal(report.purchases.length, 1);
  assert.equal(purchaseReport(rows, {seller: 'Inexistente'}).total, 0);
});
test('Compra antiga sem data não recebe data inventada e continua no histórico completo', () => {
  const legacy = {...rows[0], id: 'legacy', purchaseDate: ''};
  assert.equal(purchaseReport([legacy]).total, 20);
  assert.equal(purchaseReport([legacy], {from: '2026-11-01'}).total, 0);
  assert.equal(purchaseReport([legacy], {from: '2026-11-01'}).missingDates, 1);
  assert.equal(purchaseDateLabel(legacy), 'Não informada');
  assert.equal(purchaseDateLabel(rows[0]), '02/11/2026');
  assert.equal(purchaseDateLabel(rows[3]), '—');
});

test('Último preço usa a parcela mais recente, não total, cotação ou custo médio', () => {
  const source = [{id:'product',sku:'CART. TONER TN-2340',supplier:'Master',status:'Comprado',quantity:15,purchasedQty:15,
    unitCost:32.29,referenceUnitPrice:99,purchaseDate:'2026-11-06',purchaseEntries:[
      {id:'old',quantity:10,unitCost:30,date:'2026-10-31',purchasedAt:'2026-10-31T12:00:00Z'},
      {id:'new',quantity:5,unitCost:36.87,date:'2026-11-06',purchasedAt:'2026-11-06T12:00:00Z'},
    ]}];
  const before=structuredClone(source), result=lastPaidPrices(source,{supplier:'Master',search:'tn2340'});
  assert.equal(result.length,1);assert.deepEqual(result[0].prices,[36.87]);assert.equal(result[0].purchasedQty,5);
  assert.equal(result[0].purchaseDate,'2026-11-06');assert.equal(result[0].ambiguous,false);
  assert.deepEqual(source,before);
});
test('Último preço respeita fornecedor e compara data/hora, ignorando atualizações cadastrais', () => {
  const source = [
    {id:'later',sku:'TN2340',supplier:'Master',status:'Comprado',purchasedQty:2,unitCost:20,purchaseDate:'2026-10-02',purchasedAt:'2026-10-02T15:00:00Z'},
    {id:'early',sku:'TN2340',supplier:'Master',status:'Comprado',purchasedQty:5,unitCost:18,purchaseDate:'2026-10-02',purchasedAt:'2026-10-02T12:00:00Z',updatedAt:'2026-11-06T20:00:00Z'},
    {id:'other',sku:'TN2340',supplier:'Potencial',status:'Comprado',purchasedQty:3,unitCost:17,purchaseDate:'2026-11-01'},
  ];
  assert.equal(lastPaidPrices(source,{supplier:'Master',search:'TN-2340'})[0].unitCost,20);
  assert.equal(lastPaidPrices(source,{supplier:'Todos',search:'tn2340'}).length,2);
  assert.deepEqual(lastPaidPrices(source,{supplier:'RHB',search:'tn2340'}),[]);
});
test('Último preço exclui pendentes, cancelados e parcelas desfeitas e não junta descrições distintas', () => {
  const source = [
    {id:'a',sku:'TN2340 ORIGINAL',supplier:'Master',status:'Comprado',purchasedQty:1,unitCost:20,purchaseDate:'2026-10-01'},
    {id:'b',sku:'TN2340 COMPATÍVEL',supplier:'Master',status:'Parcial',purchasedQty:1,unitCost:10,purchaseEntries:[
      {id:'void',quantity:1,unitCost:99,date:'2026-11-06',voidedAt:'2026-11-06T12:00:00Z'},
      {id:'ok',quantity:1,unitCost:10,date:'2026-10-01'},
    ]},
    {id:'c',sku:'TN2340 ORIGINAL',supplier:'Master',status:'Pendente',purchasedQty:1,unitCost:999,purchaseDate:'2026-11-06'},
    {id:'d',sku:'TN2340 ORIGINAL',supplier:'Master',status:'Cancelado',purchasedQty:1,unitCost:999,purchaseDate:'2026-11-06'},
  ];
  const matches=lastPaidPrices(source,{search:'tn2340'});
  assert.equal(matches.length,2);assert.ok(matches.every(row=>row.unitCost!==99&&row.unitCost!==999));
});
test('Compras sem horário ou data suficiente são sinalizadas, sem adivinhar o último preço', () => {
  const source=[10,12].map((cost,index)=>({id:String(index),sku:'TN2340',supplier:'Master',status:'Comprado',purchasedQty:1,unitCost:cost,purchaseDate:'2026-11-06'}));
  const match=lastPaidPrices(source,{search:'tn2340'})[0];assert.equal(match.ambiguous,true);assert.deepEqual(match.prices,[10,12]);
  assert.equal(lastPaidPrices([{...source[0],purchaseDate:''}],{search:'tn2340'})[0].hasUndated,true);
});


test('Ranking de produtos ordena por quantidade real e soma descrições iguais entre vendedores e fornecedores',()=>{
const source=[
{id:'a',sku:'TONER TN750',supplier:'Master',seller:'Luiz',quantity:100,purchasedQty:2,unitCost:100,status:'Parcial',purchaseDate:'2026-11-01'},
{id:'b',sku:' toner  tn750 ',supplier:'Potencial',seller:'João',quantity:3,purchasedQty:3,unitCost:20,status:'Comprado',purchaseDate:'2026-11-02'},
{id:'c',sku:'PAPEL A4',supplier:'Master',seller:'Luiz',quantity:10,purchasedQty:10,unitCost:1,status:'Comprado',purchaseDate:'2026-11-02'},
{id:'d',sku:'TONER TN750 COM CHIP',supplier:'Master',quantity:1,purchasedQty:1,unitCost:10,status:'Comprado',purchaseDate:'2026-11-02'},
{id:'e',sku:'PAPEL A4',quantity:999,purchasedQty:999,unitCost:1,status:'Cancelado'},
{id:'f',sku:'PAPEL A4',quantity:999,purchasedQty:999,unitCost:1,status:'Pendente'}];
const before=structuredClone(source),report=purchaseReport(source);
assert.deepEqual(report.byProduct.map(p=>[p.units,p.total]),[[10,10],[6,270]]);
assert.equal(report.byProduct.reduce((n,p)=>n+p.units,0),report.units);
assert.equal(purchaseReport(source,{supplier:'Potencial',seller:'João',search:'tn750',from:'2026-11-02',to:'2026-11-02'}).byProduct[0].units,3);
assert.deepEqual(purchaseReport(source,{search:'inexistente'}).byProduct,[]);assert.deepEqual(source,before);
});
test('Ranking de produtos conta parcelas apenas na data da compra e ignora lançamentos anulados',()=>{
const source=[{id:'p',sku:'Toner',quantity:20,purchasedQty:5,status:'Parcial',purchaseEntries:[
{id:'one',quantity:2,unitCost:10,date:'2026-10-31'},
{id:'two',quantity:3,unitCost:12,date:'2026-11-02'},
{id:'void',quantity:8,unitCost:10,date:'2026-11-02',voidedAt:'2026-11-03'}]}];
const report=purchaseReport(source,{from:'2026-11-01',to:'2026-11-30'});
assert.equal(report.byProduct[0].units,3);assert.equal(report.byProduct[0].total,36);
});


test('Ranking unifica as três variações de TN2340 do exemplo sem alterar registros originais',()=>{
const descriptions=['CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K -','--CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K','-CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K -'];
const source=descriptions.map((sku,i)=>({id:String(i),sku,supplier:'Master',seller:'João',status:'Comprado',quantity:[62,30,19][i],purchasedQty:[62,30,19][i],unitCost:15.42,purchaseDate:'2026-11-10'}));
const before=structuredClone(source), report=purchaseReport(source);
assert.equal(report.byProduct.length,1);assert.equal(report.byProduct[0].units,111);assert.equal(report.byProduct[0].total,1711.62);
assert.equal(report.total,1711.62);assert.deepEqual(source,before);
assert.equal(purchaseReport(source,{from:'2026-11-11'}).byProduct.length,0);
});
test('Agrupamento por demanda unifica diferenças de descrição pelo modelo do toner',()=>{
const descriptions=['TONER TN-2340 2.6K BK','toner tn2340 2,6k bk -','TONER TN2370 2.6K BK','TONER TN2340 26K BK','TONER TN2340 2.6K CYAN','TONER TN2340 2.6K BK COM CHIP'];
const source=descriptions.map((sku,i)=>({id:String(i),sku,status:'Comprado',quantity:1,purchasedQty:1,unitCost:10}));
const report=purchaseReport(source);assert.equal(report.byProduct.length,2);assert.equal(report.byProduct[0].units,5);
});


test('Tipo e código unificam toner curto e listas de compatibilidade sem misturar chips ou outros modelos',()=>{
const descriptions=['CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K -','TONER TN2340','Toner TN2370 / TN2340','TONER TN-2340 COM CHIP','CHIP PARA TONER TN2340','FOTOCONDUTOR TN2340','TONER TN750','Cartucho CF258A original','CART. CF258A COMPATÍVEL'];
const source=descriptions.map((sku,i)=>({id:String(i),sku,status:'Comprado',quantity:1,purchasedQty:1,unitCost:10}));
const before=structuredClone(source),report=purchaseReport(source);
assert.equal(report.byProduct.length,5);assert.equal(report.byProduct[0].units,4);assert.equal(report.byProduct[1].units,2);
assert.equal(report.total,90);assert.equal(report.units,9);assert.deepEqual(source,before);
});


test('Todos os códigos solicitados prevalecem sobre tipo e resto do descritivo',()=>{
for(const [code] of DEMAND_MODEL_RULES){
assert.equal(productDemandKey('TONER '+code+' COMPATÍVEL'),productDemandKey('Outro descritivo '+code.toLowerCase()+' original'));
}
for(const [a,b] of [['CE310','CE310A'],['CE311','CE311A'],['CE312','CE312A'],['CE313','CE313A'],['CE314','CE314A'],['W1810','W1810X'],['CB540','CB540A'],['CB541','CB541A'],['CB542','CB542A'],['CB543','CB543A'],['CF279','CF279A']]){
assert.equal(productDemandKey('Cartucho '+a),productDemandKey('TONER COMP. '+b));
}
assert.notEqual(productDemandKey('CE310A'),productDemandKey('CE311A'));
assert.notEqual(productDemandKey('TN750'),productDemandKey('TN7500'));
assert.notEqual(productDemandKey('CF226X'),productDemandKey('CF226A'));
assert.notEqual(productDemandKey('1332'),productDemandKey('13320'));
});
test('Equivalências somam quantidades reais e valores, preservando filtros e originais',()=>{
const source=['TONER CE310','CARTUCHO CE310A'].map((sku,i)=>({id:String(i),sku,supplier:['Master','Potencial'][i],quantity:100,purchasedQty:[2,3][i],unitCost:[10,12][i],status:'Parcial',purchaseDate:'2026-11-11'}));
const before=structuredClone(source),report=purchaseReport(source);
assert.equal(report.byProduct.length,1);assert.equal(report.byProduct[0].units,5);assert.equal(report.byProduct[0].total,56);
assert.equal(purchaseReport(source,{supplier:'Master'}).byProduct[0].units,2);assert.deepEqual(source,before);
});


test('Memória permanente TN2340 reúne as doze descrições reais em compras atuais e futuras',()=>{
const descriptions=[
'CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K -',
'--CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K',
'CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K -',
'-CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K',
'CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K',
'CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K -',
'CART. TONER COMP. C/ TN2340 -',
'-CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K -',
'-CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K -',
'CART. TONER COMP. C/ TN2340',
'CART. TONER COMP. P/ TN2340 -',
'CART. TONER COMP. C/ TN2340'];
const source=descriptions.map((sku,index)=>({id:String(index),sku,status:'Comprado',quantity:index+1,purchasedQty:index+1,unitCost:10,purchaseDate:'2026-11-11'}));
const before=structuredClone(source),report=purchaseReport(source);
assert.equal(new Set(descriptions.map(productDemandKey)).size,1);
assert.equal(report.byProduct.length,1);assert.equal(report.byProduct[0].units,78);assert.equal(report.byProduct[0].total,780);
const reloaded=JSON.parse(JSON.stringify(source));reloaded.push({id:'future',sku:'Cartucho compatível TN-2340',status:'Comprado',quantity:2,purchasedQty:2,unitCost:11,purchaseDate:'2026-12-01'});
const future=purchaseReport(reloaded);assert.equal(future.byProduct.length,1);assert.equal(future.byProduct[0].units,80);assert.equal(future.byProduct[0].total,802);
assert.deepEqual(source,before);
});


test('TN2340 curto, com espaço e descritivos completos somam todas as unidades e valores',()=>{
const source=[
{sku:'CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K -',purchasedQty:62},
{sku:'--CART. TONER COMP. C/ TN2340/TN2370/TN630/TN660 2.6K',purchasedQty:30},
{sku:'TN2340',purchasedQty:19},
{sku:'TONER TN 2340',purchasedQty:4},
{sku:'TONER TN-2340',purchasedQty:5}].map((row,i)=>({...row,id:String(i),quantity:100,status:'Parcial',unitCost:10,purchaseDate:'2026-11-11'}));
const before=structuredClone(source),report=purchaseReport(source);
assert.equal(report.byProduct.length,1);assert.equal(report.byProduct[0].name,'TONER TN2340');
assert.equal(report.byProduct[0].units,120);assert.equal(report.byProduct[0].items,5);assert.equal(report.byProduct[0].total,1200);
assert.equal(report.byProduct.reduce((sum,g)=>sum+g.units,0),report.units);assert.deepEqual(source,before);
});
test('Qualquer equivalência conserva a soma de todas as parcelas compradas sem duplicar acumulados',()=>{
const source=[{id:'1',sku:'TONER CE310',quantity:100,purchasedQty:5,status:'Parcial',purchaseEntries:[{id:'a',quantity:2,unitCost:10,date:'2026-11-01'},{id:'b',quantity:3,unitCost:12,date:'2026-11-11'}]},
{id:'2',sku:'Cartucho CE310A',quantity:100,purchasedQty:7,status:'Parcial',unitCost:10,purchaseDate:'2026-11-11'}];
const report=purchaseReport(source);assert.equal(report.byProduct.length,1);assert.equal(report.byProduct[0].units,12);assert.equal(report.byProduct[0].total,126);
assert.equal(purchaseReport(source,{from:'2026-11-11',to:'2026-11-11'}).byProduct[0].units,10);
});
