import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRequestAction} from './requestActions.js';
import {summarizePurchases} from './purchases.js';
import {REVIEW_ACTIONS, applyReviewAction, blankItem} from './whatsapp.js';

const db = () => ({suppliers: ['Master', 'Potencial'], sellers: ['Cardoso', 'Luiz'], cleanupVersion: 'real-use-1', imports: [{id: 'keep'}],
  requests: [1, 2, 3].map(id => ({id: String(id), seller: 'Cardoso', client: 'Cliente original', sku: `SKU-${id}`, supplier: 'Master',
    quantity: 10, purchasedQty: 0, unitCost: 0, referenceUnitPrice: 9.9, status: 'Pendente', date: '2026-11-03', purchaseDate: '', importId: 'keep'}))});

test('Edição em massa altera apenas campos escolhidos e registros selecionados', () => {
  const original = db();
  const next = applyRequestAction(original, ['1', '3'], {type: 'edit', patch: {supplier: 'Potencial', seller: 'Luiz', client: ' Novo cliente ', date: '2026-11-04'}});
  for (const row of [next.requests[0], next.requests[2]]) {
    assert.equal(row.supplier, 'Potencial'); assert.equal(row.seller, 'Luiz');
    assert.equal(row.client, 'Novo cliente'); assert.equal(row.date, '2026-11-04');
    for (const field of ['id', 'sku', 'quantity', 'purchasedQty', 'unitCost', 'referenceUnitPrice', 'status', 'importId']) assert.equal(row[field], original.requests.find(entry => entry.id === row.id)[field]);
  }
  assert.strictEqual(next.requests[1], original.requests[1]);
  assert.equal(original.requests[0].supplier, 'Master');
  assert.equal(next.cleanupVersion, 'real-use-1');
  const clientOnly = applyRequestAction(original, ['2'], {type: 'edit', patch: {client: 'Livre'}});
  assert.equal(clientOnly.requests[1].supplier, 'Master');
  assert.equal(clientOnly.requests[1].seller, 'Cardoso');
  assert.equal(clientOnly.requests[1].date, '2026-11-03');
});
test('Edição em massa rejeita campos proibidos, seleção vazia e valores inválidos', () => {
  for (const patch of [{}, {quantity: 99}, {sku: 'não'}, {unitCost: 20}, {supplier: 'Outro'}, {seller: 'Outro'}, {client: ''}, {date: '2026-02-31'}]) {
    assert.throws(() => applyRequestAction(db(), ['1'], {type: 'edit', patch}));
  }
  assert.throws(() => applyRequestAction(db(), [], {type: 'edit', patch: {client: 'Nome'}}));
});
test('Compras em massa exigem dados reais por registro e preservam tudo se qualquer linha falhar', () => {
  const original = db(), before = structuredClone(original);
  assert.throws(() => applyRequestAction(original, ['1', '2'], {type: 'status', status: 'Comprado'}));
  assert.throws(() => applyRequestAction(original, ['1', '2'], {type: 'status', status: 'Comprado', purchaseConfirmed: true}));
  const action = {type: 'status', status: 'Comprado', purchaseConfirmed: true, purchases: {
    '1': {purchasedQty: 10, unitCost: 8.5, purchaseDate: '2026-11-04'},
    '2': {purchasedQty: 3, unitCost: 7, purchaseDate: '2026-11-04'},
  }};
  assert.throws(() => applyRequestAction(original, ['1', '2'], {...action, purchases: {...action.purchases, '2': {...action.purchases['2'], unitCost: ''}}}));
  assert.deepEqual(original, before);
  const next = applyRequestAction(original, ['1', '2'], action);
  assert.equal(next.requests[0].status, 'Comprado');
  assert.equal(next.requests[1].status, 'Parcial');
  assert.equal(next.requests[1].purchasedQty, 3);
  assert.equal(next.requests[1].quantity, 10);
  assert.equal(summarizePurchases(next.requests).total, 106);
  assert.equal(next.requests[0].referenceUnitPrice, 9.9);
});
test('Cancelamento e retorno a Pendente em massa atualizam os indicadores', () => {
  const source = db(); source.requests[0] = {...source.requests[0], purchasedQty: 4, unitCost: 10, status: 'Parcial'};
  const cancelled = applyRequestAction(source, ['1', '2'], {type: 'status', status: 'Cancelado'});
  assert.equal(cancelled.requests[0].purchasedQty, 4);
  assert.equal(summarizePurchases(cancelled.requests).total, 0);
  const pending = applyRequestAction(cancelled, ['1', '2'], {type: 'status', status: 'Pendente'});
  assert.equal(pending.requests[0].purchasedQty, 0);
  assert.equal(pending.requests[0].status, 'Pendente');
  assert.equal(summarizePurchases(pending.requests).total, 0);
});
test('Exclusão em massa remove somente os IDs selecionados e preserva lotes e configurações', () => {
  const original = db();
  const next = applyRequestAction(original, ['1', '3'], {type: 'delete'});
  assert.deepEqual(next.requests.map(row => row.id), ['2']);
  assert.equal(original.requests.length, 3);
  assert.deepEqual(next.imports, original.imports);
  assert.deepEqual(next.suppliers, original.suppliers);
  assert.deepEqual(next.sellers, original.sellers);
});

function preview() {
  return {items: [blankItem({id: '1', client: 'Antigo', notes: 'Anterior'}), blankItem({id: '2', client: 'Manter'})],
    review: [{id: 'line', text: 'Nome livre', line: 4, resolution: ''}], originalMessage: 'Mensagem original'};
}
test('Como usar este texto: cliente substitui somente selecionados; observações acrescentam sem apagar', () => {
  const original = preview();
  const client = applyReviewAction(original, 'line', 'client', ['1']);
  assert.equal(client.items[0].client, 'Nome livre'); assert.equal(client.items[1].client, 'Manter');
  assert.ok(client.review[0].resolution.includes('Usar texto como cliente'));
  const notes = applyReviewAction(original, 'line', 'notes', ['1']);
  assert.equal(notes.items[0].notes, 'Anterior\nNome livre');
  assert.equal(notes.items[1].notes, '');
  assert.equal(notes.items[0].status, undefined);
  assert.throws(() => applyReviewAction(original, 'line', 'client', []));
  assert.throws(() => applyReviewAction(original, 'line', 'notes', []));
  assert.equal(original.items[0].client, 'Antigo');
});
test('Como usar este texto: produto cria linha para editar; manter original não altera produtos', () => {
  const original = preview();
  const product = applyReviewAction(original, 'line', 'product');
  assert.equal(product.items.length, 3);
  assert.equal(product.items[2].sku, 'Nome livre');
  assert.equal(product.items[2].originalLine, 'Nome livre');
  assert.equal(product.items[2].supplier, '');
  assert.equal(product.items[2].price, '');
  assert.equal(product.items[2].quantity, 1);
  assert.strictEqual(applyReviewAction(product, 'line', 'product'), product, 'Não duplica a linha se a ação for repetida');
  const kept = applyReviewAction(original, 'line', 'keep');
  assert.strictEqual(kept.items, original.items);
  assert.equal(kept.originalMessage, original.originalMessage);
  assert.equal(kept.review[0].resolution, 'Manter somente na mensagem original');
  assert.deepEqual(REVIEW_ACTIONS.map(option => option.value), ['client', 'notes', 'product', 'keep']);
});
