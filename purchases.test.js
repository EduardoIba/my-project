import test from 'node:test';
import assert from 'node:assert/strict';
import {generateOrders, isPurchased, prepareStatus, purchasedValue, summarizePurchases, validateRequest} from './purchases.js';

const request = (overrides = {}) => ({id: 'record-1', seller: 'Cardoso', client: 'Cliente interno',
  sku: 'CART. TONER COMP. C/ 414A COM / CHIP BK 2,4K', supplier: 'Master', quantity: 10,
  purchasedQty: 0, unitCost: 0, referenceUnitPrice: 36.58, date: '2026-11-03', purchaseDate: '',
  status: 'Pendente', notes: 'Informação interna', importId: 'old-import', ...overrides});

test('Uma mensagem por fornecedor contém todos os produtos selecionados do mesmo lote', () => {
  const rows = [request(), request({id: '2', quantity: 6, sku: 'CART. TONER COMP. C/TN116 1K', referenceUnitPrice: 11.75}),
    request({id: '3', supplier: 'Potencial', quantity: 80, sku: 'pacotes verge 50fls', referenceUnitPrice: 8.98})];
  const before = structuredClone(rows);
  const orders = generateOrders(rows);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].supplier, 'Master');
  assert.equal(orders[0].text, '10 - CART. TONER COMP. C/ 414A COM / CHIP BK 2,4K R$ 36,58\n06 - CART. TONER COMP. C/TN116 1K R$ 11,75');
  assert.equal(orders[1].text, '80 - pacotes verge 50fls R$ 8,98');
  assert.deepEqual(orders.map(order => order.title), ['Master', 'Potencial']);
  assert.deepEqual(orders.map(order => order.requestIds), [['record-1', '2'], ['3']]);
  assert.equal(new Set(orders.map(order => order.id)).size, 2);
  assert.ok(orders.every(group => !/Cardoso|Cliente interno|Informação interna|old-import|Master|Potencial/.test(group.text)));
  assert.deepEqual(rows, before, 'Gerar pedido não modifica status nem registros');
});

test('Produtos de clientes ou vendedores diferentes entram no mesmo texto do fornecedor sem perder linhas', () => {
  const rows = [request({id: 'one', quantity: 2, seller: 'Cardoso'}), request({id: 'two', quantity: 3, seller: 'Luiz'})];
  const orders = generateOrders(rows);
  assert.equal(orders.length, 1);
  const lines=orders[0].text.split('\n');assert.ok(lines[0].startsWith('02 - '));assert.ok(lines[1].startsWith('03 - '));
  assert.equal(orders[0].title, 'Master');
  assert.equal(rows[0].status, 'Pendente');
  assert.equal(rows[1].status, 'Pendente');
});
test('Pedido usa cotação, recorre ao custo se necessário e não inventa preço', () => {
  const result = generateOrders([
    request({referenceUnitPrice: null, unitCost: 15.2}),
    request({referenceUnitPrice: '', unitCost: 0, supplier: ''}),
    request({referenceUnitPrice: 0, supplier: 'RHB'}),
  ]);
  assert.ok(result[0].text.endsWith('R$ 15,20'));
  assert.equal(result[1].supplier, 'Fornecedor não informado');
  assert.ok(result[1].text.endsWith('R$ [informar valor]'));
  assert.equal(result[1].missingPrice, true);
  assert.ok(result[2].text.endsWith('R$ 0,00'));
  assert.deepEqual(generateOrders([]), []);
});
test('Comprado prepara quantidade, cotação como custo e data sem modificar registro original', () => {
  const original = request();
  const prepared = prepareStatus(original, 'Comprado');
  assert.equal(prepared.purchasedQty, 10);
  assert.equal(prepared.unitCost, 36.58);
  assert.ok(prepared.purchaseDate);
  assert.equal(original.status, 'Pendente');
  assert.equal(original.purchasedQty, 0);
  assert.equal(validateRequest(prepared).status, 'Comprado');
});
test('Quantidade efetivamente comprada determina Parcial, integral determina Comprado', () => {
  const form = prepareStatus(request(), 'Comprado');
  assert.equal(validateRequest({...form, purchasedQty: '3'}).status, 'Parcial');
  assert.equal(validateRequest({...form, purchasedQty: '10'}).status, 'Comprado');
  assert.equal(validateRequest(request()).status, 'Pendente');
  assert.equal(validateRequest({...form, purchasedQty: '3'}).importId, 'old-import');
});
test('Cancelado preserva os dados, pode ser reaberto e Pendente zera a quantidade comprada', () => {
  const bought = validateRequest(prepareStatus(request(), 'Comprado'));
  const cancelled = validateRequest(prepareStatus(bought, 'Cancelado'));
  assert.equal(cancelled.status, 'Cancelado');
  assert.equal(cancelled.purchasedQty, 10);
  assert.equal(purchasedValue(cancelled), 0);
  const pending = validateRequest(prepareStatus(cancelled, 'Pendente'));
  assert.equal(pending.status, 'Pendente');
  assert.equal(pending.purchasedQty, 0);
  assert.equal(purchasedValue(pending), 0);
  assert.equal(validateRequest(prepareStatus(cancelled, 'Comprado')).status, 'Comprado');
});
test('Validação impede quantidades inválidas e compras sem custo, fornecedor ou data válida', () => {
  const form = prepareStatus(request(), 'Comprado');
  for (const changes of [{purchasedQty: 11}, {purchasedQty: -1}, {purchasedQty: 1.5}, {quantity: 0},
    {purchasedQty: 0}, {unitCost: 0}, {unitCost: 'NaN'}, {supplier: ''}, {purchaseDate: ''},
    {purchaseDate: '2026-02-31'}, {date: ''}, {sku: ' '}, {referenceUnitPrice: -1}]) {
    assert.throws(() => validateRequest({...form, ...changes}));
  }
});
test('Indicadores excluem pendentes e cancelados e somam somente quantidades efetivas', () => {
  const rows = [request({status: 'Comprado', purchasedQty: 10, unitCost: 5}),
    request({status: 'Parcial', purchasedQty: 3, unitCost: 7, supplier: 'RHB'}),
    request({status: 'Pendente', purchasedQty: 10, unitCost: 100}),
    request({status: 'Cancelado', purchasedQty: 10, unitCost: 100}), request()];
  const summary = summarizePurchases(rows);
  assert.equal(summary.total, 71);
  assert.equal(summary.units, 13);
  assert.equal(summary.purchased, 1);
  assert.equal(summary.pending, 3);
  assert.equal(summary.purchases.length, 2);
  assert.equal(summary.purchases.filter(r => r.supplier === 'Master').reduce((sum, r) => sum + purchasedValue(r), 0), 50);
  assert.equal(summary.purchases.filter(r => r.supplier === 'RHB').reduce((sum, r) => sum + purchasedValue(r), 0), 21);
  assert.equal(isPurchased(rows[2]), false);
  assert.equal(isPurchased(rows[3]), false);
});
