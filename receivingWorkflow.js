export const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

export function accessKey(value) {
  return String(value)
    .trim()
    .replace(/[\s.-]/g, '');
}

export function validAccessKey(value) {
  if (!/^\d{44}$/.test(value)) return false;
  const sum = [...value.slice(0, 43)].reduce(
    (total, digit, index) => total + Number(digit) * (2 + ((42 - index) % 8)),
    0,
  );
  const digit = 11 - (sum % 11);
  return Number(value[43]) === (digit > 9 ? 0 : digit);
}

export function checkedQuantity(value) {
  return (
    value !== '' && /^\d+(?:\.\d{1,4})?$/.test(String(value)) && Number.isFinite(Number(value))
  );
}

export function previewDistribution(items, pending, products, supplier) {
  const catalog = new Map(products.map((product) => [product.id, product]));
  const balances = pending
    .filter((row) => row.supplier_id === supplier && row.product_id)
    .sort(
      (a, b) =>
        a.batch_sequence - b.batch_sequence ||
        a.customer_position - b.customer_position ||
        a.item_position - b.item_position,
    )
    .map((row) => ({ ...row, left: Math.round(Number(row.pending_quantity) * 10000) }));
  const rows = [];
  for (const item of [...items].sort((a, b) => a.item_number - b.item_number)) {
    const product = catalog.get(item.productId);
    if (
      !product ||
      Number(product.package_quantity ?? 1) !== 1 ||
      product.unit.trim().toUpperCase() !== item.unit.trim().toUpperCase() ||
      !checkedQuantity(item.received)
    )
      continue;
    let available = Math.round(Number(item.received) * 10000);
    for (const row of balances) {
      if (!available) break;
      if (row.product_id !== product.id || !row.left) continue;
      const amount = Math.min(row.left, available);
      row.left -= amount;
      available -= amount;
      rows.push({
        ...row,
        item_id: item.id,
        product_name: product.name,
        allocated_quantity: amount / 10000,
      });
    }
  }
  return rows;
}

export function exportCsv(headers, rows) {
  const encode = (value) => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  return '\ufeff' + [headers, ...rows].map((row) => row.map(encode).join(';')).join('\r\n');
}
