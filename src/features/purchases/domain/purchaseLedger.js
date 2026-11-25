import { localDate, makeId, validDate } from './whatsapp.js';

export function purchaseEntries(row) {
  if (Array.isArray(row.purchaseEntries)) return row.purchaseEntries;
  const quantity = Number(row.purchasedQty || 0);
  if (!quantity) return [];
  // Preserve the date/value already recorded, without inventing a time for legacy data.
  return [
    {
      id: `legacy-${row.id}`,
      quantity,
      unitCost: Number(row.unitCost || 0),
      date: row.purchaseDate || '',
      purchasedAt: row.purchasedAt || null,
      legacy: true,
    },
  ];
}
export const activeEntries = (row) => purchaseEntries(row).filter((entry) => !entry.voidedAt);
export const entryValue = (entry) =>
  Math.round(Number(entry.quantity) * Number(entry.unitCost) * 100) / 100;
export const ledgerValue = (row) =>
  activeEntries(row).reduce((cents, entry) => cents + Math.round(entryValue(entry) * 100), 0) / 100;
export const boughtQuantity = (row) =>
  activeEntries(row).reduce((sum, entry) => sum + Number(entry.quantity), 0);
export function registeredPrice(row) {
  if (Number(row.referenceUnitPrice) > 0) return Number(row.referenceUnitPrice);
  const last = activeEntries(row).at(-1);
  return Number(last?.unitCost || row.unitCost || 0);
}

export function purchasePlan(rows, { mode = 'full', quantities = {}, prices = {} } = {}) {
  const items = [],
    skipped = [],
    errors = [];
  for (const row of rows) {
    const remaining = Number(row.quantity) - boughtQuantity(row);
    if (row.status === 'Cancelado' || remaining <= 0) {
      skipped.push(row);
      continue;
    }
    const quantity = mode === 'full' ? remaining : Number(quantities[row.id] || 0);
    const unitCost =
      prices[row.id] !== '' && prices[row.id] != null
        ? Number(prices[row.id])
        : registeredPrice(row);
    if (!row.supplier) errors.push(`${row.sku}: informe o fornecedor na edição do produto.`);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > remaining)
      errors.push(`${row.sku}: informe uma quantidade entre 1 e ${remaining}.`);
    if (!Number.isFinite(unitCost) || unitCost <= 0)
      errors.push(`${row.sku}: informe um preço positivo em Ajustar preço pago.`);
    if (!Number.isFinite(quantity * unitCost)) errors.push(`${row.sku}: valor inválido.`);
    items.push({ requestId: row.id, quantity, unitCost, remaining });
  }
  return {
    items,
    skipped,
    errors,
    units: items.reduce((sum, item) => sum + item.quantity, 0),
    total:
      items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitCost * 100), 0) / 100,
  };
}

function sync(row, entries, status = row.status) {
  const active = entries.filter((entry) => !entry.voidedAt),
    quantity = active.reduce((sum, entry) => sum + Number(entry.quantity), 0);
  if (quantity > Number(row.quantity))
    throw new Error(`${row.sku}: a soma das compras supera a quantidade solicitada.`);
  const total = active.reduce((sum, entry) => sum + Math.round(entryValue(entry) * 100), 0) / 100;
  const last = active.at(-1);
  return {
    ...row,
    purchaseEntries: entries,
    purchasedQty: quantity,
    unitCost: quantity ? total / quantity : row.unitCost,
    purchaseDate: last?.date || '',
    purchasedAt: last?.purchasedAt || null,
    status:
      status === 'Cancelado'
        ? 'Cancelado'
        : quantity === Number(row.quantity)
          ? 'Comprado'
          : quantity > 0
            ? 'Parcial'
            : 'Pendente',
  };
}

export function recordPurchaseOperation(db, ids, action) {
  if (!action.confirmed || !action.operationId)
    throw new Error('Confirme a compra antes de registrar.');
  if (
    db.requests.some((row) =>
      purchaseEntries(row).some((entry) => entry.operationId === action.operationId),
    )
  )
    return db;
  const rows = db.requests.filter((row) => ids.includes(row.id));
  if (!rows.length) throw new Error('Selecione os produtos que deseja comprar.');
  const plan = purchasePlan(rows, action);
  if (plan.errors.length) throw new Error(plan.errors.join('\n'));
  if (!plan.items.length) throw new Error('Não há quantidade pendente de compra nas selecionadas.');
  const now = new Date().toISOString(),
    date = localDate(),
    items = new Map(plan.items.map((item) => [item.requestId, item]));
  return {
    ...db,
    requests: db.requests.map((row) => {
      if (!items.has(row.id)) return row;
      const item = items.get(row.id);
      const entry = {
        id: makeId(),
        operationId: action.operationId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        date,
        purchasedAt: now,
      };
      return { ...sync(row, [...purchaseEntries(row), entry]), updatedAt: now };
    }),
  };
}

export function resetPurchasedQuantity(row) {
  const now = new Date().toISOString();
  return {
    ...sync(
      row,
      purchaseEntries(row).map((entry) =>
        entry.voidedAt ? entry : { ...entry, voidedAt: now, reason: 'Retorno a Pendente' },
      ),
      'Pendente',
    ),
    status: 'Pendente',
  };
}

export function reconcilePurchaseEdit(original, edited, entryId) {
  if (!original) return edited;
  const entries = purchaseEntries(original),
    active = entries.filter((entry) => !entry.voidedAt);
  const result = { ...original, ...edited };
  delete result.editingPurchaseEntryId;
  if (!entryId && edited.status === 'Pendente' && Number(edited.purchasedQty) === 0)
    return resetPurchasedQuantity({ ...result, purchaseEntries: entries });
  if (entryId) {
    const previous = active.find((entry) => entry.id === entryId);
    if (!previous) throw new Error('Lançamento não encontrado. Reabra o histórico de compras.');
    if (
      Number(edited.purchasedQty) === Number(previous.quantity) &&
      Number(edited.unitCost) === Number(previous.unitCost) &&
      edited.purchaseDate === previous.date
    )
      return sync(result, entries);
    const now = new Date().toISOString();
    const replacement =
      Number(edited.purchasedQty) > 0
        ? [
            {
              id: makeId(),
              quantity: Number(edited.purchasedQty),
              unitCost: Number(edited.unitCost),
              date: edited.purchaseDate,
              purchasedAt: edited.purchaseDate === previous.date ? previous.purchasedAt : null,
              correctedAt: now,
              replaces: previous.id,
            },
          ]
        : [];
    return sync(result, [
      ...entries.map((entry) =>
        entry.id === previous.id
          ? { ...entry, voidedAt: now, reason: 'Correção individual' }
          : entry,
      ),
      ...replacement,
    ]);
  }
  const changed =
    Number(edited.purchasedQty) !== Number(original.purchasedQty || 0) ||
    Number(edited.unitCost || 0) !== Number(original.unitCost || 0) ||
    edited.purchaseDate !== (original.purchaseDate || '');
  if (!changed) return active.length ? sync(result, entries) : result;
  if (active.length > 1)
    throw new Error(
      'Esta solicitação tem várias compras. Para corrigir quantidade, preço ou data, use Editar no lançamento correspondente em Relatórios → Histórico de compras.',
    );
  if (!active.length) {
    if (Array.isArray(original.purchaseEntries) && Number(edited.purchasedQty) > 0) {
      const now = new Date().toISOString();
      return sync(result, [
        ...entries,
        {
          id: makeId(),
          quantity: Number(edited.purchasedQty),
          unitCost: Number(edited.unitCost),
          date: edited.purchaseDate,
          purchasedAt: edited.purchaseDate === localDate() ? now : null,
        },
      ]);
    }
    return result; // Standard single purchase or old record: legacy adapter keeps compatibility.
  }
  return reconcilePurchaseEdit(original, edited, active[0].id);
}

export function purchaseHistoryRows(rows) {
  return rows
    .filter((row) => ['Comprado', 'Parcial'].includes(row.status) && Number(row.purchasedQty) > 0)
    .flatMap((row) =>
      activeEntries(row).map((entry) => ({
        ...row,
        id: `${row.id}:${entry.id}`,
        sourceRequestId: row.id,
        editingPurchaseEntryId: entry.id,
        purchaseEntries: undefined,
        purchasedQty: Number(entry.quantity),
        unitCost: Number(entry.unitCost),
        purchaseDate: entry.date,
        purchasedAt: entry.purchasedAt,
        purchaseEntryId: entry.id,
      })),
    );
}
