import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { purchasedValue, purchaseDateLabel } from './purchases.js';
import { orderStage } from './orderWorkflow.js';

// Render the real JSX component with the existing Vite/esbuild dependency.
const compiled = transformSync(
  readFileSync(new URL('./RequestTable.jsx', import.meta.url), 'utf8'),
  { loader: 'jsx', format: 'cjs' },
).code;
const require = createRequire(import.meta.url);
const output = { exports: {} };
new Function('require', 'module', 'exports', compiled)(
  (name) =>
    name === './purchases.js'
      ? { purchasedValue, purchaseDateLabel }
      : name === './orderWorkflow.js'
        ? { orderStage }
        : require(name),
  output,
  output.exports,
);
const RequestTable = output.exports.default;
const numbers = (html) =>
  [...html.matchAll(/class="rowNumber">(\d+)</g)].map((match) => Number(match[1]));
const records = [
  { id: 'id-c', sku: 'SKU-C' },
  { id: 'id-a', sku: 'SKU-A' },
  { id: 'id-b', sku: 'SKU-B' },
].map((row) => ({
  ...row,
  client: 'Cliente',
  supplier: 'Master',
  quantity: 1,
  purchasedQty: 0,
  unitCost: 0,
  status: 'Pendente',
}));

test('Numeração visual acompanha os registros filtrados e ordenados sem alterar IDs', () => {
  const before = structuredClone(records);
  const rows = records
    .filter((row) => row.sku !== 'SKU-C')
    .sort((a, b) => a.sku.localeCompare(b.sku));
  const html = renderToStaticMarkup(React.createElement(RequestTable, { rows }));
  assert.deepEqual(numbers(html), [1, 2]);
  assert.ok(html.indexOf('SKU-A') < html.indexOf('SKU-B'));
  assert.deepEqual(records, before);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['id-a', 'id-b'],
  );
});
test('Numeração aceita deslocamento de página e tabela vazia não inventa linhas', () => {
  const html = renderToStaticMarkup(
    React.createElement(RequestTable, { rows: records.slice(0, 2), rowOffset: 20 }),
  );
  assert.deepEqual(numbers(html), [21, 22]);
  const empty = renderToStaticMarkup(
    React.createElement(RequestTable, { rows: [], rowOffset: 20 }),
  );
  assert.deepEqual(numbers(empty), []);
  assert.ok(empty.includes('Nenhuma solicitação encontrada'));
});
