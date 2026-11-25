import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteRequestBatch } from './batchActions.js';
import { requestBatches, nextBatchSequence } from './whatsapp.js';
import { buildDispatchPrintHtml } from './src/shared/printing/dispatchPrint.js';
const db = {
  suppliers: ['Master'],
  sellers: ['Luiz'],
  activeBatchId: 'a',
  imports: [
    { id: 'a', sequence: 2 },
    { id: 'b', sequence: 1 },
  ],
  requests: [
    {
      id: '1',
      importId: 'a',
      supplier: 'Master',
      seller: 'Luiz',
      client: 'Cliente A',
      sku: 'Produto comprado',
      quantity: 2,
      status: 'Comprado',
      purchasedQty: 2,
      unitCost: 15,
      purchaseEntries: [{ quantity: 2, unitCost: 15 }],
    },
    {
      id: '2',
      importId: 'a',
      supplier: 'Potencial',
      seller: 'Luiz',
      client: 'Cliente B',
      sku: 'Produto pendente',
      quantity: 3,
      status: 'Pendente',
    },
    { id: '3', importId: 'b', sku: 'Outro lote' },
    { id: '4', sku: 'Legado' },
  ],
};
test('Exclusão inteira remove somente o lote e seus lançamentos, preservando demais registros e cadastros', () => {
  const before = structuredClone(db),
    next = deleteRequestBatch(db, 'a');
  assert.deepEqual(next.requests, db.requests.slice(2));
  assert.deepEqual(next.imports, [{ id: 'b', sequence: 1 }]);
  assert.equal(next.activeBatchId, '');
  assert.deepEqual(next.suppliers, db.suppliers);
  assert.deepEqual(next.sellers, db.sellers);
  assert.equal(nextBatchSequence(next), 3);
  assert.deepEqual(db, before);
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
  assert.throws(() => deleteRequestBatch(db, '__previous_records__'));
  assert.throws(() => deleteRequestBatch(db, 'missing'));
});
test('Impressão de uma solicitação inclui comprados e pendentes, sem misturar outros lotes nem valores', () => {
  const before = structuredClone(db),
    batch = requestBatches(db).find((b) => b.id === 'a');
  const html = buildDispatchPrintHtml(batch.rows, { batchLabel: batch.label });
  for (const text of ['Lote 002', 'Produto comprado', 'Produto pendente', 'Cliente A', 'Cliente B'])
    assert.ok(html.includes(text));
  assert.equal((html.match(/class="supplierPage"/g) || []).length, 2);
  assert.ok(!html.includes('Outro lote'));
  assert.ok(!html.includes('R$'));
  assert.deepEqual(db, before);
});
test('Exclusão preserva a numeração dos lotes antigos sem sequência explícita', () => {
  const old = { ...db, imports: [{ id: 'a' }, { id: 'b' }] };
  const next = deleteRequestBatch(old, 'a');
  assert.equal(requestBatches(next).find((b) => b.id === 'b').label, 'Lote 001');
  assert.equal(nextBatchSequence(next), 3);
});
