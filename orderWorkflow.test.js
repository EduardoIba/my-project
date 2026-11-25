import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmGeneratedOrders, orderStage, returnOrderToWaiting } from './orderWorkflow.js';
import { generateOrders, summarizePurchases } from './purchases.js';
import { applyRequestAction } from './requestActions.js';
import {
  commitImport,
  parseMessage,
  requestBatchId,
  requestBatches,
  saveManualRequest,
  LEGACY_BATCH,
} from './whatsapp.js';
import { purchaseReport } from './purchaseReports.js';
import { loadDatabase, DATA_KEY, PURCHASE_RESET_VERSION } from './storage.js';
const empty = () => ({
  purchaseResetVersion: PURCHASE_RESET_VERSION,
  sellers: ['Cardoso'],
  suppliers: ['Master', 'Potencial', 'Imprime'],
  requests: [],
  imports: [],
});
const firstText =
  'Master\nCardoso\nCliente: Cliente livre\n' +
  Array.from(
    { length: 5 },
    (_, i) => '05 - Produto Master ' + (i + 1) + ' ' + (i + 1) + ',00',
  ).join('\n') +
  '\nPotencial\n' +
  Array.from(
    { length: 3 },
    (_, i) => '03 - Produto Potencial ' + (i + 1) + ' ' + (i + 6) + ',00',
  ).join('\n');
const secondText =
  'Imprime\nCardoso\nCliente: Outro cliente\n' +
  Array.from({ length: 4 }, (_, i) => '01 - Produto Imprime ' + (i + 1) + ' 2,00').join('\n');
function save(db, id, text) {
  const parsed = parseMessage(text, {
    sellers: db.sellers,
    suppliers: db.suppliers,
    date: '2026-11-04',
  });
  return commitImport(db, { ...parsed, id, mode: 'request', originalMessage: text });
}
const rowsFor = (db, id) => db.requests.filter((row) => requestBatchId(row) === id);

test('Lote 001 com 5 Master e 3 Potencial gera exatamente duas mensagens; Lote 002 fica independente', () => {
  let db = save(empty(), 'first', firstText);
  assert.equal(db.activeBatchId, 'first');
  assert.equal(rowsFor(db, 'first').length, 8);
  const before = structuredClone(db),
    messages = generateOrders(rowsFor(db, 'first'));
  assert.equal(messages.length, 2);
  assert.deepEqual(
    messages.map((message) => message.text.split('\n').length),
    [5, 3],
  );
  assert.ok(
    messages.every(
      (message) => !message.text.includes('Cliente livre') && !message.text.includes('Cardoso'),
    ),
  );
  assert.deepEqual(db, before);
  db = confirmGeneratedOrders(db, messages);
  assert.equal(summarizePurchases(db.requests).total, 0);
  db = save(db, 'second', secondText);
  assert.equal(db.activeBatchId, 'second');
  assert.equal(rowsFor(db, 'second').length, 4);
  assert.equal(rowsFor(db, 'first').length, 8);
  assert.ok(rowsFor(db, 'first').every((row) => row.orderStatus === 'generated'));
  assert.ok(rowsFor(db, 'second').every((row) => row.orderStatus === 'waiting'));
  assert.deepEqual(
    requestBatches(db).map((batch) => batch.label),
    ['Lote 002', 'Lote 001'],
  );
  assert.throws(() => generateOrders(db.requests), /lotes diferentes/);
  const raw = JSON.stringify(db),
    storage = { getItem: (key) => (key === DATA_KEY ? raw : null) };
  const reloaded = loadDatabase(storage, {});
  assert.equal(reloaded.activeBatchId, 'second');
  assert.deepEqual(rowsFor(reloaded, 'first'), rowsFor(db, 'first'));
});
test('Dois eventos iguais no mesmo dia têm lotes independentes e repetição do token não duplica', () => {
  const first = save(empty(), 'one', firstText),
    second = save(first, 'two', firstText);
  assert.equal(rowsFor(second, 'one').length, 8);
  assert.equal(rowsFor(second, 'two').length, 8);
  assert.equal(second.requests.length, 16);
  assert.strictEqual(save(second, 'one', firstText), second);
});
test('Status, edição e exclusão em massa não transferem produtos nem afetam outro lote', () => {
  let db = save(save(empty(), 'first', firstText), 'second', secondText),
    second = structuredClone(rowsFor(db, 'second'));
  const selected = rowsFor(db, 'first')
    .slice(0, 2)
    .map((row) => row.id);
  db = applyRequestAction(db, selected, { type: 'edit', patch: { client: 'Corrigido' } });
  db = applyRequestAction(db, selected, {
    type: 'purchase',
    mode: 'full',
    operationId: 'actual',
    confirmed: true,
  });
  assert.ok(
    selected.every((id) => requestBatchId(db.requests.find((row) => row.id === id)) === 'first'),
  );
  assert.equal(purchaseReport(db.requests).total, 15); // 5 units at 1 + 5 units at 2
  assert.deepEqual(rowsFor(db, 'second'), second);
  db = applyRequestAction(db, selected, { type: 'delete' });
  assert.equal(rowsFor(db, 'first').length, 6);
  assert.equal(rowsFor(db, 'second').length, 4);
  assert.deepEqual(rowsFor(db, 'second'), second);
  assert.equal(purchaseReport(db.requests).total, 0);
});
test('Confirmação preserva texto editado, marca só IDs do fornecedor e não altera compra ou lote', () => {
  const db = save(empty(), 'first', firstText),
    before = structuredClone(db),
    messages = generateOrders(rowsFor(db, 'first').slice(0, 5));
  messages[0].text = 'Texto conferido';
  const next = confirmGeneratedOrders(db, messages);
  assert.ok(
    next.requests
      .slice(0, 5)
      .every((row) => row.orderMessage === 'Texto conferido' && row.orderStatus === 'generated'),
  );
  assert.ok(next.requests.slice(5).every((row) => row.orderStatus === 'waiting'));
  for (let i = 0; i < db.requests.length; i++)
    for (const field of ['id', 'importId', 'quantity', 'purchasedQty', 'unitCost', 'status'])
      assert.equal(next.requests[i][field], db.requests[i][field]);
  assert.deepEqual(db, before);
  assert.equal(confirmGeneratedOrders(next, messages).requests.length, 8);
});
test('Retorno da geração não altera o lote nem apaga compras parciais', () => {
  const db = save(empty(), 'first', firstText);
  db.requests[0] = {
    ...db.requests[0],
    status: 'Parcial',
    purchasedQty: 1,
    unitCost: 9,
    purchaseDate: '2026-11-03',
  };
  const confirmed = confirmGeneratedOrders(db, generateOrders([db.requests[0]])),
    row = confirmed.requests[0];
  const next = returnOrderToWaiting(confirmed, row.id);
  assert.equal(orderStage(next.requests[0]), 'waiting');
  assert.equal(next.requests[0].importId, 'first');
  assert.equal(purchaseReport(next.requests).total, 9);
});
test('Legados só são recuperados por identificador explícito; data e fornecedor iguais não criam lote', () => {
  const db = empty();
  db.requests = [
    { id: 'old1', supplier: 'Master', date: '2026-11-04' },
    { id: 'old2', supplier: 'Master', date: '2026-11-04' },
    { id: 'known', importId: 'original-event' },
  ];
  const before = structuredClone(db),
    batches = requestBatches(db);
  assert.equal(batches.find((batch) => batch.id === LEGACY_BATCH).rows.length, 2);
  assert.equal(batches.find((batch) => batch.id === 'original-event').rows.length, 1);
  assert.ok(batches.find((batch) => batch.id === LEGACY_BATCH).legacy);
  assert.deepEqual(db, before);
  assert.ok(db.requests.every((row) => row.orderStatus === undefined));
});
test('Cadastro manual novo também cria lote próprio sem mudar origem de registros existentes', () => {
  const db = save(empty(), 'first', firstText),
    item = { id: 'manual', sku: 'Manual', status: 'Pendente' };
  const next = saveManualRequest(db, item);
  assert.notEqual(next.activeBatchId, 'first');
  assert.equal(rowsFor(next, next.activeBatchId).length, 1);
  assert.equal(rowsFor(next, 'first').length, 8);
  assert.equal(requestBatches(next)[0].label, 'Lote 002');
});
test('Confirmação rejeita texto vazio, IDs removidos, duplicidade ou mistura de lotes sem modificar base', () => {
  const db = save(save(empty(), 'first', firstText), 'second', secondText),
    before = structuredClone(db);
  const messages = generateOrders(rowsFor(db, 'first'));
  for (const invalid of [
    [],
    [{ ...messages[0], text: '' }],
    [{ ...messages[0], requestIds: ['missing'] }],
    [messages[0], messages[0]],
    [messages[0], ...generateOrders(rowsFor(db, 'second'))],
  ])
    assert.throws(() => confirmGeneratedOrders(db, invalid));
  assert.deepEqual(db, before);
});
