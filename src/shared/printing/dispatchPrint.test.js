import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDispatchPrintHtml } from './dispatchPrint.js';

test('Impressão ordena vendedores e preserva cada cliente, item completo e quantidade sem somar linhas', () => {
  const items = [
    {
      supplier: 'Master',
      seller: 'Luiz',
      client: 'Cliente B',
      sku: 'TN-1060 135G 50FOLHAS',
      quantity: 3,
      price: 15.99,
    },
    {
      supplier: 'Potencial',
      seller: 'Adriana',
      client: 'Cliente A',
      sku: 'Mesmo produto',
      quantity: 2,
      price: 99,
    },
    {
      supplier: 'Master',
      seller: 'Adriana',
      client: 'Cliente C',
      sku: 'Mesmo produto',
      quantity: 1,
      price: 99,
    },
  ];
  const before = structuredClone(items),
    html = buildDispatchPrintHtml(items);
  assert.ok(html.indexOf('Vendedor: Adriana') < html.indexOf('Vendedor: Luiz'));
  assert.equal((html.match(/<tr><td>/g) || []).length, 3);
  for (const value of [
    'Cliente A',
    'Cliente B',
    'Cliente C',
    'Master',
    'Potencial',
    'TN-1060 135G 50FOLHAS',
  ])
    assert.ok(html.includes(value));
  assert.ok(html.includes('<td>3</td>'));
  assert.ok(html.includes('<td>2</td>'));
  assert.ok(html.includes('<td>1</td>'));
  assert.equal(html.includes('R$'), false);
  assert.equal(html.includes('15,99'), false);
  assert.equal(html.includes('99,00'), false);
  assert.deepEqual(items, before);
});
test('Impressão usa apenas campos operacionais, escapa texto e sinaliza dados ausentes', () => {
  const html = buildDispatchPrintHtml(
    [
      {
        sku: '<script>alert(1)</script>',
        client: 'A & B',
        quantity: 1,
        unitCost: 123.45,
        notes: 'VALOR SECRETO',
        originalLine: 'R$ 123,45',
      },
    ],
    { unparsedCount: 2 },
  );
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('A &amp; B'));
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('VALOR SECRETO'), false);
  assert.equal(html.includes('123,45'), false);
  assert.ok(html.includes('Fornecedor não informado'));
  assert.ok(html.includes('Vendedor não informado'));
  assert.ok(html.includes('2 texto(s) não convertido(s)'));
  assert.throws(() => buildDispatchPrintHtml([]));
  assert.throws(() => buildDispatchPrintHtml([{ quantity: 0 }]));
  assert.throws(() => buildDispatchPrintHtml([{ quantity: 1.5 }]));
});

test('Cada fornecedor começa em uma nova página, com vendedores ordenados dentro dela', () => {
  const html = buildDispatchPrintHtml([
    { supplier: 'Potencial', seller: 'Luiz', client: 'Cliente P', sku: 'Produto P', quantity: 3 },
    { supplier: 'Master', seller: 'Luiz', client: 'Cliente M1', sku: 'Produto M1', quantity: 2 },
    { supplier: 'Master', seller: 'Adriana', client: 'Cliente M2', sku: 'Produto M2', quantity: 1 },
  ]);
  const pages = html.split('<section class="supplierPage"').slice(1);
  assert.equal(pages.length, 2);
  assert.ok(pages[0].includes('data-supplier="Master"'));
  assert.ok(pages[1].includes('data-supplier="Potencial"'));
  assert.ok(pages[0].indexOf('Vendedor: Adriana') < pages[0].indexOf('Vendedor: Luiz'));
  assert.ok(pages[0].includes('Produto M1'));
  assert.ok(pages[0].includes('Produto M2'));
  assert.equal(pages[0].includes('Produto P'), false);
  assert.ok(pages[1].includes('Produto P'));
  assert.equal(pages[1].includes('Produto M1'), false);
  assert.ok(html.includes('break-before:page'));
  assert.ok(html.includes('thead{display:table-header-group}'));
  assert.equal((html.match(/<tr><td>/g) || []).length, 3);
  assert.equal(html.includes('R$'), false);
});
