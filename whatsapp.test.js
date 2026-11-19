import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_SELLERS, migrateSellers} from './sellers.js';
import {DEFAULT_RULES, applyBulkItems, blankItem, commitImport, importIssues, itemErrors, parseMessage, previewTotal, validDate} from './whatsapp.js';

const first = `MASTER BR
CRISTIANO
01- PLASTICO PARA PLASTIFICACAO A3 100PC / CX 303X426MM 125MIC R$ 82,30
01 -adesivo a3 20 fls 12,35`;
const second = `POTENCIAL BR
CRISTIANO
04- PAPEL FOTO AUTO ADESIVO GLOSSY 135G A4- 50 FLS R$ 15,32
01- MP- PLASTIFICACAO A4 100 FOLHAS125 MICRAS 0,05 ESPESSURA R$ 42,10`;
const third = `10 - CART. TONER COMP. C/ 414A COM / CHIP BK 2,4K R$ 36,58
10 - CHIP COMPATÍVEL C/ ELGIN/PANTUM TL-5120X 15K---4,45
06 - CART. TONER COMP . C/TN116 1K---11,75
80 - pacotes verge 50fls 8,98
70 - PAPEL FOTO GLOSSY 135G/M² A4 - 50FOLHAS 7,30
01 - PLASTICO PARA PLASTIFICACAO A3 100PC / CX 303X426MM 125MIC R$ 82,30
01 - adesivo a3 20 fls 12,35`;
const options = {sellers: DEFAULT_SELLERS, date: '2026-11-03'};
const corrected = () => {
  const parsed = parseMessage(first, options);
  return {...parsed, id: 'batch-1', originalMessage: first, mode: 'request',
    items: parsed.items.map(item => ({...item, seller: 'Cardoso', client: 'Cristiano'})),
    review: parsed.review.map(line => ({...line, resolution: 'Cliente conferido'}))};
};
const oldRequest = {id: 'old', seller: 'Luiz', quantity: 4, purchasedQty: 2, unitCost: 12, status: 'Parcial'};
const oldDb = () => ({sellers: DEFAULT_SELLERS, requests: [oldRequest], extra: {keep: true}});

test('Exemplo 1: Master, cliente reconhecido no cabeçalho, descrições e total 94,65', () => {
  const result = parseMessage(first, options);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].supplier, 'Master');
  assert.equal(result.items[0].supplierOriginal, 'MASTER BR');
  assert.equal(result.items[0].sku, 'PLASTICO PARA PLASTIFICACAO A3 100PC / CX 303X426MM 125MIC');
  assert.equal(result.items[1].sku, 'adesivo a3 20 fls');
  assert.deepEqual(result.items.map(item => item.price), [82.3, 12.35]);
  assert.equal(result.review.length, 0);
  assert.equal(result.items[0].seller, '');
  assert.equal(result.items[0].client, 'CRISTIANO');
  assert.equal(previewTotal(result.items), 94.65);
});
test('Exemplo 2: Potencial, quantidade e total 103,38', () => {
  const {items} = parseMessage(second, options);
  assert.equal(items[0].supplier, 'Potencial');
  assert.deepEqual(items.map(item => item.quantity), [4, 1]);
  assert.deepEqual(items.map(item => item.price), [15.32, 42.1]);
  assert.equal(items[1].sku, 'MP- PLASTIFICACAO A4 100 FOLHAS125 MICRAS 0,05 ESPESSURA');
  assert.equal(previewTotal(items), 103.38);
});
test('Exemplo 3: sete itens, SKUs preservados e soma real 1804,85', () => {
  const {items, review} = parseMessage(third, options);
  assert.equal(items.length, 7);
  assert.equal(review.length, 0);
  assert.deepEqual(items.map(item => item.quantity), [10, 10, 6, 80, 70, 1, 1]);
  assert.deepEqual(items.map(item => item.price), [36.58, 4.45, 11.75, 8.98, 7.3, 82.3, 12.35]);
  assert.equal(items[1].sku, 'CHIP COMPATÍVEL C/ ELGIN/PANTUM TL-5120X 15K');
  assert.ok(items.every(item => !item.seller && !item.client && !item.supplier));
  // The supplied expected total (1787.45) disagrees with the supplied quantities and prices.
  assert.equal(previewTotal(items), 1804.85);
});
test('Produtos sem preço e números na descrição não viram preços', () => {
  const {items} = parseMessage('06 - TN-1060 135G 50FOLHAS 2,4K 125MIC 0,05 ESPESSURA\n01 - PAPEL A4 50', options);
  assert.equal(items[0].quantity, 6);
  assert.equal(items[0].price, '');
  assert.equal(items[0].sku, 'TN-1060 135G 50FOLHAS 2,4K 125MIC 0,05 ESPESSURA');
  assert.equal(items[1].price, '');
});
test('Espaços irregulares, caixa, zeros à esquerda, milhares e delimitadores', () => {
  const {items} = parseMessage(' master br \r\n 001  -   SKU-123  R$ 1.234,56 \r\n02—SKU-2---4,45', options);
  assert.equal(items[0].supplier, 'Master');
  assert.equal(items[0].quantity, 1);
  assert.equal(items[0].sku, 'SKU-123');
  assert.equal(items[0].price, 1234.56);
  assert.equal(items[1].price, 4.45);
});
test('Cabeçalhos explícitos identificam vendedor, cliente, data e observações', () => {
  const {items, review} = parseMessage('Fornecedor: RHB\nVendedor: joão\nCliente: Master\nData: 02/11/2026\nObservações: urgente\n1 - TN-1060 5,00', options);
  assert.equal(review.length, 0);
  assert.equal(items[0].supplier, 'RHB');
  assert.equal(items[0].client, 'Master');
  assert.equal(items[0].seller, 'João');
  assert.equal(items[0].date, '2026-11-02');
  assert.equal(items[0].notes, 'urgente');
});
test('Todos os textos não identificados são apresentados para revisão', () => {
  const {items, review} = parseMessage('LISTA DE COMPRAS\nFornecedor: Desconhecido\nVendedor: Outro\nData: 31/02/2026\nlinha inválida 123\n1 - Papel', options);
  assert.equal(review.length, 5);
  assert.equal(review[1].text, 'Fornecedor: Desconhecido');
  assert.equal(items[0].supplier, '');
  assert.equal(items[0].seller, '');
});
test('Fornecedores desconhecidos e cabeçalhos de WhatsApp não são inventados', () => {
  const {items, review} = parseMessage('[03/11/2026, 10:00] Cristiano: BOM DIA\nFORNECEDOR XYZ\n1 - Produto 4,50', options);
  assert.equal(review.length, 2);
  assert.equal(items[0].supplier, '');
  assert.equal(items[0].client, '');
});
test('Regras configuráveis e nomes de vendedores cadastrados', () => {
  const rules = {...DEFAULT_RULES, aliases: 'MASTER DISTRIBUIDORA=Master', unidentifiedName: 'client'};
  const {items} = parseMessage('MASTER DISTRIBUIDORA\nLuiz\nCristiano\n1 - Papel 5,00', {...options, rules});
  assert.equal(items[0].supplier, 'Master');
  assert.equal(items[0].seller, 'Luiz');
  assert.equal(items[0].client, 'Cristiano');
  assert.throws(() => parseMessage('1 - Papel', {...options, rules: {aliases: 'Erro=Inexistente'}}));
  assert.throws(() => parseMessage('1 - Papel', {...options, rules: {aliases: 'Master=RHB'}}));
});
test('Cabeçalhos com fornecedores distintos afetam apenas produtos seguintes', () => {
  const {items} = parseMessage('MASTER BR\n1 - Papel\nPOTENCIAL BR\n2 - Adesivo', options);
  assert.deepEqual(items.map(item => item.supplier), ['Master', 'Potencial']);
});
test('Correções na prévia recalculam total e validação', () => {
  const batch = corrected();
  const item = {...batch.items[0], quantity: '3', price: '10.50', sku: 'Corrigido'};
  assert.deepEqual(itemErrors(item, {sellers: DEFAULT_SELLERS}), []);
  assert.equal(previewTotal([item]), 31.5);
  for (const changes of [{quantity: 0}, {quantity: 1.5}, {quantity: 'NaN'}, {price: -1}, {price: 'Infinity'}, {client: ' '}, {seller: 'Outro'}, {supplier: 'Outro'}, {sku: ''}, {date: '2026-02-31'}]) {
    assert.ok(itemErrors({...item, ...changes}, {sellers: DEFAULT_SELLERS}).length);
  }
});
test('Interpretação não grava nem modifica dados e migração preserva campos antigos', () => {
  const db = oldDb(); const snapshot = structuredClone(db);
  parseMessage(first, options);
  assert.deepEqual(db, snapshot);
  const migrated = migrateSellers({...db, sellers: ['Vendedor 01'], requests: [{...oldRequest, seller: 'Vendedor 01'}]});
  assert.equal(migrated.requests[0].seller, 'Cardoso');
  assert.equal(migrated.requests[0].purchasedQty, 2);
  assert.deepEqual(migrated.extra, {keep: true});
});
test('Salva vários pendentes em lote, preserva dados antigos e separa cotação', () => {
  const db = oldDb(); const batch = corrected();
  const next = commitImport(db, batch);
  assert.equal(next.requests.length, 3);
  assert.deepEqual(next.requests.at(-1), oldRequest);
  assert.deepEqual(next.extra, db.extra);
  assert.equal(db.requests.length, 1);
  for (const row of next.requests.slice(0, 2)) {
    assert.equal(row.status, 'Pendente'); assert.equal(row.purchasedQty, 0);
    assert.equal(row.unitCost, 0); assert.equal(row.purchaseDate, '');
    assert.equal(row.importId, batch.id);
  }
  assert.equal(next.requests[0].referenceUnitPrice, 82.3);
  assert.equal(next.imports[0].originalMessage, first);
  assert.ok(next.requests[0].originalLine.includes('PLASTICO'));
  const total = data => data.requests.reduce((sum, row) => sum + row.purchasedQty * row.unitCost, 0);
  assert.equal(total(next), total(db));
});
test('Prevenção de duplicidade por token, inclusive após recarregar', () => {
  const batch = corrected(); const next = commitImport(oldDb(), batch);
  assert.strictEqual(commitImport(next, batch), next);
  const reloaded = JSON.parse(JSON.stringify(next));
  assert.strictEqual(commitImport(reloaded, batch), reloaded);
});
test('Compra exige confirmação explícita, data válida e preço positivo', () => {
  const batch = {...corrected(), mode: 'purchase'};
  assert.throws(() => commitImport(oldDb(), batch));
  assert.throws(() => commitImport(oldDb(), {...batch, purchaseConfirmed: true, purchaseDate: '2026-02-31'}));
  const complete = {...batch, purchaseConfirmed: true, purchaseDate: '2026-11-03'};
  const next = commitImport(oldDb(), complete);
  assert.equal(next.requests[0].status, 'Comprado');
  assert.equal(next.requests[0].unitCost, 82.3);
  assert.equal(next.requests[0].purchasedQty, 1);
  assert.equal(next.requests[0].purchaseDate, '2026-11-03');
  assert.throws(() => commitImport(oldDb(), {...complete, items: [{...batch.items[0], price: ''}]}));
  assert.throws(() => commitImport(oldDb(), {...complete, items: [{...batch.items[0], price: 0}]}));
});
test('Não salva com campos inválidos ou lista vazia; revisão textual é opcional', () => {
  const batch = corrected();
  assert.throws(() => commitImport(oldDb(), {...batch, items: []}));
  assert.throws(() => commitImport(oldDb(), {...batch, items: [{...batch.items[0], client: ''}]}));
  assert.equal(commitImport(oldDb(), {...batch, review: [{text: 'Texto extra', resolution: ''}]}).requests.length, 3);
});

const digitalMessage = readFileSync(new URL('./fixtures/digital-message.txt', import.meta.url), 'utf8');
test('DIGITAL EMPREENDIMENTO: três produtos, cliente livre e apenas fornecedor/vendedor pendentes', () => {
  const parsed = parseMessage(digitalMessage, options);
  assert.equal(parsed.review.length, 0);
  assert.equal(parsed.items.length, 3);
  assert.ok(parsed.items.every(item => item.client === 'DIGITAL EMPREENDIMENTO'));
  assert.deepEqual(parsed.items.map(item => item.quantity), [2, 10, 5]);
  assert.deepEqual(parsed.items.map(item => item.price), [34.97, 33.4, 38.75]);
  assert.equal(parsed.items[0].sku, 'CART. TONER COMP. C/ CB541A/CE321A/CF211A CYAN');
  assert.equal(previewTotal(parsed.items), 597.69);
  const batch = {...parsed, id: 'digital', mode: 'request', originalMessage: digitalMessage};
  assert.ok(importIssues(batch, options).every(issue => issue.endsWith('fornecedor, vendedor.')));
  const items = applyBulkItems(parsed.items, {supplier: 'Master', seller: 'Cardoso', client: ''});
  assert.ok(items.every(item => item.supplier === 'Master' && item.seller === 'Cardoso' && item.client === 'DIGITAL EMPREENDIMENTO'));
  assert.deepEqual(importIssues({...batch, items}, options), []);
  const saved = commitImport(oldDb(), {...batch, items});
  assert.equal(saved.requests.length, 4);
  assert.deepEqual(saved.requests.at(-1), oldRequest);
  assert.deepEqual(saved.requests.slice(0, 3).map(item => item.referenceUnitPrice), [34.97, 33.4, 38.75]);
});

test('DIGITAL com fornecedor e vendedor cadastrados preenche tudo sem conferência adicional', () => {
  const parsed = parseMessage(`BOM DIA\n master - br \n CARdoso \n${digitalMessage}`, options);
  assert.equal(parsed.review.length, 1, 'Saudação preservada como texto opcional');
  assert.ok(parsed.items.every(item => item.supplier === 'Master' && item.seller === 'Cardoso' && item.client === 'DIGITAL EMPREENDIMENTO'));
  assert.deepEqual(importIssues({...parsed, mode: 'request'}, options), []);
  const saved = commitImport(oldDb(), {...parsed, id: 'automatic-digital', mode: 'request'});
  assert.equal(saved.requests.length, 4);
  assert.equal(saved.imports[0].review[0].text, 'BOM DIA');
});

test('Em lote: seleção explícita altera só selecionados; sem seleção aplica a todos imediatamente', () => {
  const parsed = parseMessage(digitalMessage, options);
  const updated = applyBulkItems(parsed.items, {supplier: 'RHB', seller: 'João', client: ' Novo cliente '}, [parsed.items[1].id]);
  assert.deepEqual(updated[0], parsed.items[0]);
  assert.equal(updated[1].client, 'Novo cliente');
  assert.equal(updated[1].supplier, 'RHB');
  assert.equal(updated[1].seller, 'João');
  assert.deepEqual(updated[2], parsed.items[2]);
  const all = applyBulkItems(updated, {supplier: 'Master', seller: 'Luiz', client: ''}, []);
  assert.ok(all.every(item => item.supplier === 'Master' && item.seller === 'Luiz'));
  assert.equal(all[1].client, 'Novo cliente');
  assert.equal(parsed.items[1].client, 'DIGITAL EMPREENDIMENTO');
});
test('Produto manual sem preço pode ser solicitação, mas não compra', () => {
  const item = blankItem({seller: 'Cardoso', client: 'Teste', supplier: 'Master', sku: 'Papel'});
  assert.equal(itemErrors(item, {sellers: DEFAULT_SELLERS}).length, 0);
  assert.ok(itemErrors(item, {sellers: DEFAULT_SELLERS, mode: 'purchase'}).length);
  const next = commitImport(oldDb(), {...corrected(), items: [item]});
  assert.equal(next.requests[0].referenceUnitPrice, null);
});
test('Datas reais e mensagens vazias', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.deepEqual(parseMessage(' \n\n', options).items, []);
});

test('Cabeçalho usa os cadastros atuais, ignorando caixa, acentos e espaços', () => {
  const suppliers = ['Distribuidora São José'];
  const sellers = ['Cristiano', 'João'];
  const parsed = parseMessage(' DISTRIBUIDORA  SAO JOSE BR\n cRiStIaNo \nCliente: Loja 123 & Filhos / Unidade 2\n1 - SKU-100 12,50', {suppliers, sellers});
  assert.equal(parsed.items[0].supplier, suppliers[0]);
  assert.equal(parsed.items[0].seller, 'Cristiano');
  assert.equal(parsed.items[0].client, 'Loja 123 & Filhos / Unidade 2');
  assert.equal(parsed.review.length, 0);
  assert.equal(itemErrors(parsed.items[0], {suppliers, sellers}).length, 0);
  const db = {suppliers, sellers, requests: []};
  const saved = commitImport(db, {...parsed, id: 'custom', mode: 'request', originalMessage: 'original'});
  assert.equal(saved.requests[0].supplier, suppliers[0]);
  assert.throws(() => commitImport({...db, suppliers: ['Outro']}, {...parsed, id: 'custom', mode: 'request'}), /fornecedor/);
});

test('Cristiano cadastrado como vendedor não é inventado como cliente', () => {
  const result = parseMessage(first, {...options, sellers: [...DEFAULT_SELLERS, 'Cristiano']});
  assert.ok(result.items.every(row => row.seller === 'Cristiano' && row.client === ''));
  assert.deepEqual(itemErrors(result.items[0], {sellers: [...DEFAULT_SELLERS, 'Cristiano']}), ['cliente']);
});

test('Nome livre do cliente é propagado para todos os produtos e regra antiga não bloqueia', () => {
  const result = parseMessage(first, {...options, rules: {aliases: 'MASTER BR=Master', unidentifiedName: 'review'}});
  assert.ok(result.items.every(row => row.client === 'CRISTIANO' && row.supplier === 'Master'));
  assert.equal(result.review.length, 0);
});

test('Descrições sem quantidade e textos após produtos nunca viram nomes de clientes', () => {
  const result = parseMessage('MASTER BR\nPAPEL FOTO GLOSSY\n1 - SKU-100 12,50\nFulano de Tal', options);
  assert.equal(result.items[0].client, '');
  assert.equal(result.review.length, 2);
});

test('Nome presente em ambos cadastros fica para revisão, sem inventar papel', () => {
  const result = parseMessage('Master\n1 - Produto 12,50', {...options, sellers: ['Master']});
  assert.equal(result.items[0].supplier, '');
  assert.equal(result.items[0].seller, '');
  assert.equal(result.items[0].client, '');
  assert.equal(result.review.length, 1);
});

test('Correção direta dos campos resolve validação compartilhada e permite salvar', () => {
  const parsed = parseMessage(first, options);
  const batch = {...parsed, id: 'corrected', mode: 'request'};
  assert.equal(importIssues(batch, options).length, 2);
  assert.ok(importIssues(batch, options).every(text => text.includes('vendedor')));
  const edited = {...batch, items: batch.items.map(item => ({...item, seller: 'Cardoso', client: 'Cliente livre conferido'}))};
  edited.items[0].quantity = '2'; edited.items[0].price = '80';
  assert.deepEqual(importIssues(edited, options), []);
  const next = commitImport(oldDb(), edited);
  assert.equal(next.requests[0].quantity, 2);
  assert.equal(next.requests[0].referenceUnitPrice, 80);
  assert.equal(next.requests[0].client, 'Cliente livre conferido');
});


test('Formato vendedor, cliente e produtos preserva cliente livre mesmo igual a fornecedor ou vendedor',()=>{
for(const client of ['DIGITAL EMPREENDIMENTO','Master','João','Loja 123 / Filial: Centro']){
const parsed=parseMessage('  cardoso  \n'+client+'\n02 - TONER CYAN R$ 34,97\n10 - TN750 R$ 33,40',{sellers:['Cardoso','João']});
assert.equal(parsed.items.length,2);assert.equal(parsed.review.length,0);
assert.ok(parsed.items.every(item=>item.seller==='Cardoso'&&item.client===client&&item.supplier===''));
assert.deepEqual(parsed.items.map(item=>item.quantity),[2,10]);assert.deepEqual(parsed.items.map(item=>item.price),[34.97,33.4]);
}
});
test('Formato simples aceita linhas vazias e orienta seleção de vendedor não cadastrado',()=>{
const parsed=parseMessage('\nNovo vendedor\n\nCliente 123 & Filhos\n01 - Produto 12,35',{sellers:['Cardoso']});
assert.equal(parsed.items[0].client,'Cliente 123 & Filhos');assert.equal(parsed.items[0].seller,'');assert.equal(parsed.review.length,1);
const items=applyBulkItems(parsed.items,{seller:'Cardoso',supplier:'Master'});
assert.deepEqual(importIssues({...parsed,items,mode:'request'},{sellers:['Cardoso']}),[]);
});


test('Lista por fornecedor, vendedores e clientes mantém cada produto no bloco correto',()=>{
const message='MASTER BR\nADRIANA\nST SUPRIMENTOS\n01- CARTUCHO 122 BK R$ 51,80\n01- CARTUCHO 122 CL R$ 57,00\nJOÃO\nLOJA 123 / FILIAL\n02 - TONER R$ 33,40\nOUTRO CLIENTE\n03 - PAPEL R$ 9,80\nPOTENCIAL BR\nADRIANA\nCLIENTE FINAL\n04 - ADESIVO R$ 12,35';
const parsed=parseMessage(message,{sellers:['Adriana','João']});
assert.equal(parsed.review.length,0);
assert.deepEqual(parsed.items.map(({supplier,seller,client,quantity,price})=>({supplier,seller,client,quantity,price})),[
{supplier:'Master',seller:'Adriana',client:'ST SUPRIMENTOS',quantity:1,price:51.8},
{supplier:'Master',seller:'Adriana',client:'ST SUPRIMENTOS',quantity:1,price:57},
{supplier:'Master',seller:'João',client:'LOJA 123 / FILIAL',quantity:2,price:33.4},
{supplier:'Master',seller:'João',client:'OUTRO CLIENTE',quantity:3,price:9.8},
{supplier:'Potencial',seller:'Adriana',client:'CLIENTE FINAL',quantity:4,price:12.35}]);
const batch={...parsed,id:'multiple-sellers',originalMessage:message,mode:'request'};
const saved=commitImport({sellers:['Adriana','João'],requests:[]},batch);
assert.equal(saved.requests.length,5);assert.ok(saved.requests.every(row=>row.importId==='multiple-sellers'));
});
test('Novo vendedor sem cliente não herda cliente do vendedor anterior',()=>{
const parsed=parseMessage('MASTER BR\nAdriana\nCliente A\n1 - Produto 10,00\nJoão\n2 - Produto 12,00',{sellers:['Adriana','João']});
assert.equal(parsed.items[1].seller,'João');assert.equal(parsed.items[1].client,'');
});
