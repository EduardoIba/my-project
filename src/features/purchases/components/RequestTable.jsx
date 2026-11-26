import React from 'react';
import { purchasedValue, purchaseDateLabel } from '../domain/purchases.js';
import { orderStage } from '../domain/orderWorkflow.js';
const currency = (n) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function RequestTable({
  rows,
  edit,
  cancel,
  remove,
  changeStatus,
  selected = [],
  onSelection,
  purchaseHistory = false,
  rowOffset = 0,
  returnOrder,
}) {
  const allSelected = !!rows.length && rows.every((row) => selected.includes(row.id));
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            {onSelection && (
              <th>
                <input
                  type="checkbox"
                  aria-label="Selecionar todas as solicitações visíveis"
                  checked={allSelected}
                  ref={(node) => {
                    if (node)
                      node.indeterminate =
                        !allSelected && rows.some((row) => selected.includes(row.id));
                  }}
                  onChange={(e) =>
                    onSelection(
                      e.target.checked
                        ? [...new Set([...selected, ...rows.map((row) => row.id)])]
                        : selected.filter((id) => !rows.some((row) => row.id === id)),
                    )
                  }
                />
              </th>
            )}
            {[
              'Nº',
              'Data da compra',
              'Produto',
              'Cliente',
              ...(purchaseHistory ? ['Vendedor'] : []),
              'Fornecedor',
              'Quantidade',
              'Preço unitário',
              ...(purchaseHistory ? ['Valor comprado'] : []),
              'Status da compra',
              'Ações',
            ].map((title) => (
              <th key={title}>{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={row.id}>
                {onSelection && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar solicitação ${rowOffset + index + 1}: ${row.sku}`}
                      checked={selected.includes(row.id)}
                      onChange={(e) =>
                        onSelection(
                          e.target.checked
                            ? [...selected, row.id]
                            : selected.filter((id) => id !== row.id),
                        )
                      }
                    />
                  </td>
                )}
                <td className="rowNumber">{rowOffset + index + 1}</td>
                <td>{purchaseDateLabel(row)}</td>
                <td className="productCell">
                  {row.sku}
                  {returnOrder && (
                    <small className="orderStageLabel">
                      {orderStage(row) === 'generated' ? 'Pedido gerado' : 'Aguardando envio'}
                    </small>
                  )}
                </td>
                <td>{row.client}</td>
                {purchaseHistory && <td>{row.seller}</td>}
                <td>{row.supplier || '—'}</td>
                <td>
                  {purchaseHistory ? row.purchasedQty : row.quantity}
                  <small className="quantityBought">
                    {purchaseHistory
                      ? `${row.quantity} solicitada(s)`
                      : `${row.purchasedQty || 0} comprada(s)`}
                  </small>
                </td>
                <td>
                  {purchaseHistory
                    ? currency(row.unitCost)
                    : row.referenceUnitPrice != null && row.referenceUnitPrice !== ''
                      ? currency(row.referenceUnitPrice)
                      : Number(row.unitCost) > 0
                        ? currency(row.unitCost)
                        : '—'}
                </td>
                {purchaseHistory && <td>{currency(purchasedValue(row))}</td>}
                <td>
                  {changeStatus ? (
                    <select
                      className={'status statusSelect ' + row.status.toLowerCase()}
                      aria-label={`Status de ${row.sku}`}
                      value={row.status}
                      onChange={(e) => changeStatus(row, e.target.value)}
                    >
                      <option value="Pendente">Pendente</option>
                      <option value="Comprado">Comprado</option>
                      {row.status === 'Parcial' && (
                        <option value="Parcial" disabled>
                          Parcial (automático)
                        </option>
                      )}
                      <option value="Cancelado">Cancelado</option>
                    </select>
                  ) : (
                    <span className={'status ' + row.status.toLowerCase()}>{row.status}</span>
                  )}
                </td>
                <td>
                  <button className="link" onClick={() => edit(row)}>
                    Editar
                  </button>
                  {(cancel || remove || returnOrder) && (
                    <details className="rowActions">
                      <summary>Mais</summary>
                      <div>
                        {returnOrder && orderStage(row) === 'generated' && (
                          <button className="link" onClick={() => returnOrder(row)}>
                            Marcar pedido para refazer
                          </button>
                        )}
                        {cancel && row.status !== 'Cancelado' && (
                          <button className="link danger" onClick={() => cancel(row)}>
                            Cancelar
                          </button>
                        )}
                        {remove && (
                          <button className="link danger" onClick={() => remove(row)}>
                            Excluir
                          </button>
                        )}
                      </div>
                    </details>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={9 + (onSelection ? 1 : 0) + (purchaseHistory ? 2 : 0)} className="empty">
                Nenhuma solicitação encontrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
