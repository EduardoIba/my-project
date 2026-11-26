import test from 'node:test';
import assert from 'node:assert/strict';
import { addSupplier, getSuppliers } from './catalogs.js';
import { removeSeller } from './sellers.js';
import { parseMessage } from '../../features/purchases/domain/whatsapp.js';
const source = () => ({
  suppliers: ['Master'],
  sellers: ['Cardoso'],
  requests: [{ id: 'keep', seller: 'Cardoso', purchasedQty: 2, unitCost: 10, status: 'Comprado' }],
  imports: [{ id: 'keep' }],
});
test('Novo fornecedor mantém cadastros e histórico e passa a ser reconhecido na importação', () => {
  const db = source(),
    next = addSupplier(db, '  Nova   Distribuidora ');
  assert.deepEqual(getSuppliers(next), ['Master', 'Nova Distribuidora']);
  assert.strictEqual(next.requests, db.requests);
  assert.strictEqual(next.sellers, db.sellers);
  assert.equal(db.suppliers.length, 1);
  const parsed = parseMessage('NOVA DISTRIBUIDORA BR\nCardoso\nCliente: Livre\n1 - Produto 10,00', {
    suppliers: next.suppliers,
    sellers: next.sellers,
  });
  assert.equal(parsed.items[0].supplier, 'Nova Distribuidora');
});
test('Fornecedor vazio ou duplicado com diferença de caixa/acentos/espaços é rejeitado', () => {
  assert.throws(() => addSupplier(source(), ' '));
  assert.throws(() => addSupplier(source(), ' MASTER '));
  assert.throws(() => addSupplier({ ...source(), suppliers: ['São José'] }, 'SAO   JOSE'));
});
test('Excluir vendedor remove apenas do cadastro ativo e mantém histórico integral', () => {
  const db = source(),
    next = removeSeller(db, 'Cardoso');
  assert.deepEqual(next.sellers, []);
  assert.strictEqual(next.requests, db.requests);
  assert.strictEqual(next.imports, db.imports);
  assert.equal(next.requests[0].seller, 'Cardoso');
  assert.equal(next.requests[0].purchasedQty, 2);
  assert.deepEqual(db.sellers, ['Cardoso']);
  assert.throws(() => removeSeller(db, 'Outro'));
});
