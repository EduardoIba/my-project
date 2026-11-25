import { getSuppliers } from './catalogs.js';
import { validDate } from './whatsapp.js';
import { validateRequest } from './purchases.js';
import {
  recordPurchaseOperation,
  reconcilePurchaseEdit,
  resetPurchasedQuantity,
} from './purchaseLedger.js';

export function applyRequestAction(db, ids, action) {
  const selected = new Set(ids);
  const targets = db.requests.filter((row) => selected.has(row.id));
  if (!targets.length) throw new Error('Selecione pelo menos uma solicitação visível.');
  if (action.type === 'purchase') return recordPurchaseOperation(db, ids, action);
  if (action.type === 'delete')
    return { ...db, requests: db.requests.filter((row) => !selected.has(row.id)) };
  const updates = new Map();
  if (action.type === 'edit') {
    const patch = action.patch || {};
    const fields = Object.keys(patch);
    if (!fields.length) throw new Error('Marque pelo menos um campo para alterar.');
    if (fields.some((field) => !['supplier', 'seller', 'client', 'date'].includes(field)))
      throw new Error('Campo não permitido na edição em massa.');
    if ('supplier' in patch && !getSuppliers(db).includes(patch.supplier))
      throw new Error('Selecione um fornecedor cadastrado.');
    if ('seller' in patch && !db.sellers.includes(patch.seller))
      throw new Error('Selecione um vendedor cadastrado.');
    if ('client' in patch && !String(patch.client).trim())
      throw new Error('Preencha o nome do cliente.');
    if ('date' in patch && !validDate(patch.date))
      throw new Error('Informe uma data válida para a solicitação.');
    for (const row of targets)
      updates.set(row.id, {
        ...row,
        ...patch,
        ...('client' in patch ? { client: String(patch.client).trim() } : {}),
      });
  } else if (action.type === 'status') {
    if (!['Pendente', 'Comprado', 'Cancelado'].includes(action.status))
      throw new Error('Selecione um status válido. Parcial é calculado pela quantidade comprada.');
    if (action.status === 'Comprado' && !action.purchaseConfirmed)
      throw new Error('Confirme que os dados correspondem a compras realizadas.');
    const errors = [];
    for (const row of targets) {
      if (action.status === 'Comprado') {
        const actual = action.purchases?.[row.id];
        try {
          if (!actual) throw new Error('Informe quantidade, custo e data da compra.');
          // Only explicitly supplied actual purchase fields are accepted. No quote or
          // requested quantity is automatically converted into an actual purchase.
          updates.set(
            row.id,
            reconcilePurchaseEdit(
              row,
              validateRequest({
                ...row,
                status: 'Comprado',
                purchasedQty: actual.purchasedQty,
                unitCost: actual.unitCost,
                purchaseDate: actual.purchaseDate,
              }),
            ),
          );
        } catch (error) {
          errors.push(`${row.sku}: ${error.message}`);
        }
      } else
        updates.set(
          row.id,
          action.status === 'Pendente'
            ? resetPurchasedQuantity(row)
            : { ...row, status: action.status },
        );
    }
    if (errors.length) throw new Error(errors.join('\n'));
  } else throw new Error('Ação em massa inválida.');
  const updatedAt = new Date().toISOString();
  return {
    ...db,
    requests: db.requests.map((row) =>
      updates.has(row.id) ? { ...updates.get(row.id), updatedAt } : row,
    ),
  };
}
