import {nextBatchSequence, requestBatches, requestBatchId} from './whatsapp.js';

export function deleteRequestBatch(db, id) {
  const batches = requestBatches(db);
  const batch = batches.find(entry => entry.id === id);
  if (!batch || batch.legacy) throw new Error('Selecione uma solicitação identificada para excluir.');
  const labels = new Map(batches.map(entry => [entry.id, entry.label]));
  return {...db,
    lastBatchSequence: nextBatchSequence(db) - 1,
    activeBatchId: db.activeBatchId === id ? '' : db.activeBatchId,
    requests: db.requests.filter(row => requestBatchId(row) !== id),
    imports: (db.imports || []).filter(entry => entry.id !== id).map(entry => ({...entry,
      sequence: entry.sequence || Number(labels.get(entry.id)?.replace('Lote ', '')),
    })),
  };
}
