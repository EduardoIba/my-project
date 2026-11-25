import { localDate, validDate, requestBatchId } from './whatsapp.js';
import { ledgerValue } from './purchaseLedger.js';

export function isPurchased(row) {
  return (
    ['Comprado', 'Parcial'].includes(row.status) &&
    Number.isFinite(Number(row.purchasedQty)) &&
    Number(row.purchasedQty) > 0
  );
}

export function purchasedValue(row) {
  if (Array.isArray(row.purchaseEntries)) return isPurchased(row) ? ledgerValue(row) : 0;
  const cost = Number(row.unitCost);
  return isPurchased(row) && Number.isFinite(cost) && cost >= 0
    ? Math.round(Number(row.purchasedQty) * cost * 100) / 100
    : 0;
}

export function purchaseDateLabel(row) {
  if (!isPurchased(row)) return '—';
  if (!validDate(row.purchaseDate)) return 'Não informada';
  const date = row.purchaseDate.split('-').reverse().join('/');
  return row.purchasedAt && Number.isFinite(Date.parse(row.purchasedAt))
    ? `${date} ${new Date(row.purchasedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : date;
}

export function summarizePurchases(rows) {
  const purchases = rows.filter(isPurchased);
  return {
    purchases,
    total: purchases.reduce((sum, row) => sum + Math.round(purchasedValue(row) * 100), 0) / 100,
    units: purchases.reduce((sum, row) => sum + Number(row.purchasedQty), 0),
    pending: rows.filter((row) => ['Pendente', 'Parcial'].includes(row.status)).length,
    purchased: rows.filter((row) => row.status === 'Comprado').length,
  };
}

// Selecting a status prepares the existing editor; nothing is recorded until Save.
export function prepareStatus(row, status) {
  if (status === 'Pendente') return { ...row, status, purchasedQty: 0 };
  if (status === 'Comprado')
    return {
      ...row,
      status,
      purchasedQty: Number(row.purchasedQty) > 0 ? row.purchasedQty : row.quantity,
      unitCost: Number(row.unitCost) > 0 ? row.unitCost : (row.referenceUnitPrice ?? ''),
      purchaseDate: row.purchaseDate || localDate(),
    };
  return { ...row, status };
}

export function statusForQuantity(form) {
  return form.status === 'Cancelado'
    ? 'Cancelado'
    : Number(form.purchasedQty) === Number(form.quantity) && Number(form.quantity) > 0
      ? 'Comprado'
      : Number(form.purchasedQty) > 0
        ? 'Parcial'
        : 'Pendente';
}

export function validateRequest(form) {
  const quantity = Number(form.quantity),
    purchasedQty = Number(form.purchasedQty || 0);
  const unitCost = Number(form.unitCost || 0);
  const referenceUnitPrice =
    form.referenceUnitPrice === '' || form.referenceUnitPrice == null
      ? null
      : Number(form.referenceUnitPrice);
  if (
    !form.client?.trim() ||
    !form.sku?.trim() ||
    !form.seller ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isSafeInteger(purchasedQty) ||
    purchasedQty < 0 ||
    purchasedQty > quantity ||
    !Number.isFinite(unitCost) ||
    unitCost < 0 ||
    (referenceUnitPrice !== null &&
      (!Number.isFinite(referenceUnitPrice) || referenceUnitPrice < 0))
  ) {
    throw new Error('Confira os campos obrigatórios, as quantidades e os valores.');
  }
  if (!validDate(form.date)) throw new Error('Informe uma data válida para a solicitação.');
  if (form.status === 'Comprado' && purchasedQty === 0)
    throw new Error('Informe a quantidade efetivamente comprada ou escolha Pendente.');
  if (purchasedQty > 0 && (!form.supplier || !validDate(form.purchaseDate) || unitCost <= 0)) {
    throw new Error('Para registrar compra, informe fornecedor, data e custo positivo.');
  }
  const status = statusForQuantity(form);
  return {
    ...form,
    client: form.client.trim(),
    sku: form.sku.trim(),
    quantity,
    purchasedQty,
    unitCost,
    referenceUnitPrice,
    status,
  };
}

export function generateOrders(rows) {
  if (new Set(rows.map(requestBatchId)).size > 1)
    throw new Error(
      'Abra uma única solicitação para gerar seus pedidos. Não misture produtos de lotes diferentes.',
    );
  const groups = new Map();
  for (const row of rows) {
    const supplier = row.supplier || 'Fornecedor não informado';
    const key = supplier.trim().toLocaleLowerCase('pt-BR');
    if (!groups.has(key))
      groups.set(key, {
        id: `supplier-${groups.size}`,
        supplier,
        title: supplier,
        requestIds: [],
        lines: [],
        missingPrice: false,
      });
    const group = groups.get(key);
    const reference = row.referenceUnitPrice;
    const price =
      reference != null && reference !== ''
        ? Number(reference)
        : Number(row.unitCost) > 0
          ? Number(row.unitCost)
          : null;
    const hasPrice = price !== null && Number.isFinite(price) && price >= 0;
    const amount = hasPrice
      ? price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '[informar valor]';
    group.requestIds.push(row.id);
    group.missingPrice ||= !hasPrice;
    group.lines.push(
      `${String(row.quantity).padStart(2, '0')} - ${String(row.sku).replace(/\s+/g, ' ').trim()} R$ ${amount}`,
    );
  }
  return [...groups.values()].map(({ lines, ...group }) => ({ ...group, text: lines.join('\n') }));
}
