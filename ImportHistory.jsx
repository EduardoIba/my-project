import React from 'react';
import { requestBatches } from './whatsapp.js';
export default function ImportHistory({
  db,
  visibleRows,
  includeEmpty,
  onOpen,
  onPrint,
  onDelete,
}) {
  const visible = new Set(visibleRows.map((row) => row.id));
  const batches = requestBatches(db).filter(
    (batch) =>
      batch.rows.some((row) => visible.has(row.id)) || (includeEmpty && !batch.rows.length),
  );
  return (
    <div className="importHistory">
      <p className="muted">
        Cada lote corresponde a um salvamento. Abra uma solicitação para consultar ou corrigir
        somente seus produtos.
      </p>
      <div className="tableWrap">
        <table className="batchHistory">
          <thead>
            <tr>
              <th>Solicitação</th>
              <th>Fornecedor</th>
              <th>Produtos</th>
              <th>Salva em</th>
              <th>Situação das compras</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {batches.length ? (
              batches.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    {batch.label}
                    {batch.legacy && (
                      <small className="quantityBought">
                        Origem desconhecida; registros preservados sem formar um lote.
                      </small>
                    )}
                  </td>
                  <td>
                    {[...new Set(batch.rows.map((row) => row.supplier?.trim() || 'Não informado'))]
                      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
                      .join(', ') || 'Não informado'}
                  </td>
                  <td>{batch.rows.length}</td>
                  <td>
                    {batch.createdAt
                      ? new Date(batch.createdAt).toLocaleString('pt-BR')
                      : 'Não informada'}
                  </td>
                  <td className="batchStatus">
                    {['Pendente', 'Parcial', 'Comprado', 'Cancelado'].map((status) => {
                      const count = batch.rows.filter((row) => row.status === status).length;
                      return count ? (
                        <span key={status}>
                          {count} {status.toLowerCase()}
                          {count > 1 ? '(s)' : ''}
                        </span>
                      ) : null;
                    })}
                  </td>
                  <td>
                    <button
                      className="secondary"
                      aria-label={`Abrir ${batch.label}`}
                      onClick={() => onOpen(batch.id)}
                    >
                      Abrir
                    </button>{' '}
                    <button
                      type="button"
                      className="secondary"
                      disabled={!batch.rows.length}
                      aria-label={`Imprimir ${batch.label}`}
                      onClick={() => onPrint(batch.id)}
                    >
                      Imprimir
                    </button>{' '}
                    {!batch.legacy && (
                      <button
                        type="button"
                        className="link danger"
                        aria-label={`Excluir ${batch.label}`}
                        onClick={() => onDelete(batch.id)}
                      >
                        Excluir solicitação
                      </button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty" colSpan="6">
                  Nenhuma solicitação encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
