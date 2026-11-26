import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeEntries,
  purchaseEntries,
  purchasePlan,
  recordPurchaseOperation,
  reconcilePurchaseEdit,
  resetPurchasedQuantity,
} from './purchaseLedger.js';
import { purchasedValue, summarizePurchases } from './purchases.js';
import { purchaseReport } from './purchaseReports.js';
const db = () => ({
  sellers: ['Cardoso', 'Luiz'],
  suppliers: ['Master', 'Potencial'],
  requests: [
    {
      id: 'a',
      sku: 'Toner',
      client: 'Cliente A',
      seller: 'Cardoso',
      supplier: 'Master',
      quantity: 10,
      purchasedQty: 0,
      unitCost: 0,
      referenceUnitPrice: 10,
      status: 'Pendente',
      date: '2026-11-04',
    },
    {
      id: 'b',
      sku: 'Papel',
      client: 'Cliente B',
      seller: 'Luiz',
      supplier: 'Potencial',
      quantity: 5,
      purchasedQty: 0,
      unitCost: 0,
      referenceUnitPrice: 4,
      status: 'Pendente',
      date: '2026-11-04',
    },
  ],
});
const full = (operationId = 'full') => ({ confirmed: true, operationId, mode: 'full' });

test('Completa usa saldo, preço e fornecedor cadastrados e só confirma após o resumo', () => {
  const source = db(),
    before = structuredClone(source),
    plan = purchasePlan(source.requests);
  assert.equal(plan.units, 15);
  assert.equal(plan.total, 120);
  assert.deepEqual(source, before);
  assert.throws(() => recordPurchaseOperation(source, ['a', 'b'], { mode: 'full' }));
  const next = recordPurchaseOperation(source, ['a', 'b'], full());
  assert.equal(summarizePurchases(next.requests).total, 120);
  assert.ok(next.requests.every((row) => row.status === 'Comprado'));
  assert.deepEqual(
    next.requests.map((row) => row.supplier),
    ['Master', 'Potencial'],
  );
  assert.deepEqual(
    next.requests.map((row) => row.client),
    ['Cliente A', 'Cliente B'],
  );
  assert.deepEqual(
    next.requests.map((row) => row.seller),
    ['Cardoso', 'Luiz'],
  );
  assert.ok(
    next.requests.every((row) => Number.isFinite(Date.parse(row.purchasedAt)) && row.purchaseDate),
  );
  assert.deepEqual(source, before);
});
test('Parcial soma apenas nova quantidade e completa somente saldo, mantendo preços anteriores', () => {
  let next = recordPurchaseOperation(db(), ['a'], {
    ...full('p1'),
    mode: 'partial',
    quantities: { a: 3 },
  });
  const first = structuredClone(next.requests[0].purchaseEntries[0]);
  assert.equal(next.requests[0].status, 'Parcial');
  assert.equal(next.requests[0].purchasedQty, 3);
  assert.equal(purchasedValue(next.requests[0]), 30);
  const plan = purchasePlan([next.requests[0]], { mode: 'full', prices: { a: 12 } });
  assert.equal(plan.units, 7);
  assert.equal(plan.total, 84);
  next = recordPurchaseOperation(next, ['a'], { ...full('p2'), prices: { a: 12 } });
  assert.equal(next.requests[0].purchasedQty, 10);
  assert.equal(next.requests[0].status, 'Comprado');
  assert.equal(purchasedValue(next.requests[0]), 114);
  assert.deepEqual(next.requests[0].purchaseEntries[0], first);
  assert.deepEqual(
    next.requests[0].purchaseEntries.map((entry) => [entry.quantity, entry.unitCost]),
    [
      [3, 10],
      [7, 12],
    ],
  );
  assert.equal(purchaseReport(next.requests).total, 114);
  assert.equal(purchaseReport(next.requests).purchases.length, 2);
});
test('Repetir confirmação é idempotente inclusive depois de recarregar e não recompra itens concluídos', () => {
  const action = { ...full('once'), mode: 'partial', quantities: { a: 2 } };
  const first = recordPurchaseOperation(db(), ['a'], action);
  const reloaded = JSON.parse(JSON.stringify(first));
  assert.strictEqual(recordPurchaseOperation(reloaded, ['a'], action), reloaded);
  assert.equal(recordPurchaseOperation(first, ['a'], full('rest')).requests[0].purchasedQty, 10);
  const complete = recordPurchaseOperation(db(), ['a'], full());
  assert.equal(purchasePlan(complete.requests).skipped.length, 1);
  const mixed = recordPurchaseOperation(complete, ['a', 'b'], full('other'));
  assert.equal(mixed.requests[0].purchaseEntries.length, 1);
  assert.equal(summarizePurchases(mixed.requests).total, 120);
  assert.throws(() => recordPurchaseOperation(complete, ['a'], full('again')));
});
test('Impede quantidade acima do saldo e compra sem preço/fornecedor, sem alterações parciais', () => {
  const source = db(),
    before = structuredClone(source);
  for (const quantities of [{ a: 11 }, { a: 0 }, { a: -1 }, { a: 1.5 }])
    assert.throws(() =>
      recordPurchaseOperation(source, ['a'], { ...full(), mode: 'partial', quantities }),
    );
  const missing = db();
  missing.requests[1].supplier = '';
  assert.throws(() => recordPurchaseOperation(missing, ['a', 'b'], full()));
  const noPrice = db();
  noPrice.requests[1].referenceUnitPrice = '';
  assert.throws(() => recordPurchaseOperation(noPrice, ['a', 'b'], full()));
  assert.equal(
    recordPurchaseOperation(noPrice, ['b'], { ...full(), prices: { b: 5 } }).requests[1]
      .purchasedQty,
    5,
  );
  assert.deepEqual(source, before);
});
test('Legado parcial é preservado com sua data e valor antes de acrescentar nova compra', () => {
  const source = db();
  source.requests[0] = {
    ...source.requests[0],
    status: 'Parcial',
    purchasedQty: 4,
    unitCost: 8,
    purchaseDate: '2026-10-10',
  };
  const next = recordPurchaseOperation(source, ['a'], full());
  assert.equal(next.requests[0].purchaseEntries[0].date, '2026-10-10');
  assert.equal(next.requests[0].purchaseEntries[0].purchasedAt, null);
  assert.equal(purchasedValue(next.requests[0]), 92);
  assert.equal(purchaseReport(next.requests, { from: '2026-10-01', to: '2026-10-31' }).total, 32);
});
test('Relatórios dividem parcelas por sua própria data e somam clientes/vendedores sem duplicar', () => {
  const source = db();
  source.requests[0] = {
    ...source.requests[0],
    purchasedQty: 10,
    status: 'Comprado',
    unitCost: 11.4,
    purchaseEntries: [
      {
        id: 'one',
        quantity: 3,
        unitCost: 10,
        date: '2026-10-20',
        purchasedAt: '2026-10-20T12:00:00Z',
      },
      {
        id: 'two',
        quantity: 7,
        unitCost: 12,
        date: '2026-11-04',
        purchasedAt: '2026-11-04T13:00:00Z',
      },
    ],
  };
  assert.equal(purchaseReport(source.requests, { from: '2026-10-01', to: '2026-10-31' }).total, 30);
  const november = purchaseReport(source.requests, { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(november.total, 84);
  assert.equal(november.byClient[0].total, 84);
  assert.equal(november.bySeller[0].total, 84);
  assert.equal(purchaseReport(source.requests).total, 114);
});
test('Correção individual preserva versão antiga e não altera outras parcelas', () => {
  let source = recordPurchaseOperation(db(), ['a'], {
    ...full('one'),
    mode: 'partial',
    quantities: { a: 3 },
  });
  source = recordPurchaseOperation(source, ['a'], full('two'));
  const row = source.requests[0],
    entry = row.purchaseEntries[0];
  const corrected = reconcilePurchaseEdit(
    row,
    { ...row, purchasedQty: 2, unitCost: 9, purchaseDate: entry.date },
    entry.id,
  );
  assert.equal(corrected.purchasedQty, 9);
  assert.equal(corrected.status, 'Parcial');
  assert.equal(purchasedValue(corrected), 88);
  assert.ok(corrected.purchaseEntries[0].voidedAt);
  assert.equal(corrected.purchaseEntries[0].quantity, 3);
  assert.deepEqual(corrected.purchaseEntries[1], row.purchaseEntries[1]);
  assert.equal(corrected.purchaseEntries.at(-1).replaces, entry.id);
});
test('Retorno a Pendente desfaz efeitos financeiros preservando histórico e admite compra corrigida', () => {
  const bought = recordPurchaseOperation(db(), ['a'], full()).requests[0];
  const reset = resetPurchasedQuantity(bought);
  assert.equal(reset.purchasedQty, 0);
  assert.equal(reset.status, 'Pendente');
  assert.equal(purchasedValue(reset), 0);
  assert.equal(purchaseEntries(reset).length, 1);
  assert.ok(purchaseEntries(reset)[0].voidedAt);
  const corrected = reconcilePurchaseEdit(reset, {
    ...reset,
    status: 'Comprado',
    purchasedQty: 10,
    unitCost: 10,
    purchaseDate: '2026-11-04',
  });
  assert.equal(activeEntries(corrected).length, 1);
  assert.equal(purchasedValue(corrected), 100);
});
test('Correção de legado para Pendente também mantém a compra antiga no histórico preservado', () => {
  const original = {
    ...db().requests[0],
    status: 'Parcial',
    purchasedQty: 3,
    unitCost: 8,
    purchaseDate: '2026-10-10',
  };
  const reset = reconcilePurchaseEdit(original, {
    ...original,
    status: 'Pendente',
    purchasedQty: 0,
  });
  assert.equal(reset.purchasedQty, 0);
  assert.equal(reset.purchaseEntries[0].quantity, 3);
  assert.equal(reset.purchaseEntries[0].unitCost, 8);
  assert.equal(reset.purchaseEntries[0].date, '2026-10-10');
  assert.ok(reset.purchaseEntries[0].voidedAt);
  assert.equal(purchasedValue(reset), 0);
});
