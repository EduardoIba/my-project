import assert from 'node:assert/strict';
import test from 'node:test';
import {accessKey, checkedQuantity, exportCsv, previewDistribution, validAccessKey} from './receivingWorkflow.js';

test('Leitura de chave preserva os dígitos, valida o checksum e rejeita entrada parcial', () => {
  assert.equal(accessKey(' 4126 1100-1234\r\n'), '412611001234');
  assert.equal(validAccessKey('35261198765432000199550010000001231111111111'), false);
  assert.equal(validAccessKey('35261198765432000199550010000001231111111110'), true);
  const prefix = '3526119876543200019955001000000123111111111';
  assert.equal(Array.from({length: 10}, (_, digit) => validAccessKey(prefix + digit)).filter(Boolean).length, 1);
  assert.equal(validAccessKey(prefix), false);
});

test('Zero é uma quantidade conferida e quantidades inválidas são rejeitadas', () => {
  assert.ok(checkedQuantity('0'));
  assert.ok(checkedQuantity('4.1234'));
  for (const value of ['', '-1', '1.33333', '1e1', 'Infinity']) assert.equal(checkedQuantity(value), false);
});

test('Prévia desconta o saldo entre itens na ordem original e não aloca embalagem incompatível', () => {
  const rank = [{request_id: 'new', batch_sequence: 2, pending_quantity: 4}, {request_id: 'old', batch_sequence: 1, pending_quantity: 3}];
  const pending = rank.map(row => ({...row, supplier_id: 'supplier', product_id: 'p', customer_position: 1, item_position: 1}));
  const items = [
    {id: 'b', item_number: 2, received: '3', productId: 'p', unit: 'UN'},
    {id: 'a', item_number: 1, received: '2', productId: 'p', unit: ' un '},
    {id: 'box', item_number: 3, received: '50', productId: 'p', unit: 'CX'},
  ];
  const products = [{id: 'p', name: 'Produto', unit: 'UN'}];
  assert.deepEqual(previewDistribution(items, pending, products, 'supplier').map(row =>
    [row.item_id, row.request_id, row.allocated_quantity]), [['a', 'old', 2], ['b', 'old', 1], ['b', 'new', 2]]);
  assert.deepEqual(previewDistribution(items, pending, [{...products[0], package_quantity: 10}], 'supplier'), []);
  assert.deepEqual(previewDistribution(items, pending, products, 'other'), []);
  assert.equal(pending[1].pending_quantity, 3);
});

test('CSV preserva aspas e neutraliza fórmulas provenientes dos dados', () => {
  assert.equal(exportCsv(['Cliente'], [['A "B"'], ['=1+1']]), '\ufeff"Cliente"\r\n"A ""B"""\r\n"\'=1+1"');
});
