import { requestBatchId } from './whatsapp.js';
// Missing fields on legacy requests mean "unknown/not confirmed", never a
// fabricated record of earlier generation. Purchase status is independent.
export const orderStage = (row) => (row.orderStatus === 'generated' ? 'generated' : 'waiting');

export function confirmGeneratedOrders(db, messages) {
  if (!messages.length) throw new Error('Gere pelo menos uma mensagem antes de confirmar.');
  const byId = new Map();
  for (const message of messages) {
    const ids = message.requestIds || (message.requestId ? [message.requestId] : []);
    if (!ids.length || !message.text?.trim())
      throw new Error('Confira o texto de todos os pedidos antes de confirmar.');
    for (const id of ids) {
      if (byId.has(id)) throw new Error('A mesma solicitação aparece mais de uma vez no pedido.');
      if (!db.requests.some((row) => row.id === id))
        throw new Error('Uma solicitação foi removida. Gere os pedidos novamente.');
      byId.set(id, message);
    }
  }
  if (new Set(db.requests.filter((row) => byId.has(row.id)).map(requestBatchId)).size > 1)
    throw new Error('Confirme os pedidos de um único lote por vez.');
  const now = new Date().toISOString();
  return {
    ...db,
    requests: db.requests.map((row) =>
      byId.has(row.id)
        ? {
            ...row,
            orderStatus: 'generated',
            orderGeneratedAt: now,
            orderMessage: byId.get(row.id).text,
            orderTitle: byId.get(row.id).title,
            updatedAt: now,
          }
        : row,
    ),
  };
}

export function returnOrderToWaiting(db, id) {
  if (!db.requests.some((row) => row.id === id)) throw new Error('Solicitação não encontrada.');
  return {
    ...db,
    requests: db.requests.map((row) =>
      row.id === id ? { ...row, orderStatus: 'waiting', updatedAt: new Date().toISOString() } : row,
    ),
  };
}
